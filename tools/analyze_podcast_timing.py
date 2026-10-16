#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
播客字幕时间轴质量分析（基于音频实测）

思路：
  1. 用 ffmpeg 静音检测拿到每课的「语音区间」和「静音区间」
  2. 该课真实语速 = 字幕总字符数 / 语音总时长
  3. 逐句算：这句文本按真实语速需要多少语音时间，而它的时间范围内实际有多少语音
  4. 差值 > 0 → 文本放不下，必然溢到下一句 → 播放时会听到重复
     差值 < 0 → 该句时间范围内语音比文本多 → 有内容没被转录出来

用法：
  python3 tools/analyze_podcast_timing.py --source ../english-pod-data
  python3 tools/analyze_podcast_timing.py --source ../english-pod-data --limit 10
  python3 tools/analyze_podcast_timing.py --source ../english-pod-data --json out.json
"""

import argparse
import concurrent.futures as cf
import json
import os
import re
import subprocess
import sys

SILENCE_RE_START = re.compile(r"silence_start: ([\d.]+)")
SILENCE_RE_END = re.compile(r"silence_end: ([\d.]+)")


def silence_map(path, noise="-32dB", dur=0.25):
    """返回静音区间 [(start, end), ...]；失败返回 None。"""
    try:
        out = subprocess.run(
            ["ffmpeg", "-hide_banner", "-nostats", "-i", path,
             "-af", f"silencedetect=noise={noise}:d={dur}", "-f", "null", "-"],
            capture_output=True, text=True, timeout=600,
        ).stderr
    except Exception:  # noqa: BLE001
        return None
    spans = []
    cur = None
    for line in out.splitlines():
        m = SILENCE_RE_START.search(line)
        if m:
            cur = float(m.group(1))
            continue
        m = SILENCE_RE_END.search(line)
        if m and cur is not None:
            spans.append((cur, float(m.group(1))))
            cur = None
    return spans


def speech_in(spans, a, b):
    """区间 [a, b] 内被静音覆盖的时长。"""
    total = 0.0
    for s, e in spans:
        lo, hi = max(a, s), min(b, e)
        if hi > lo:
            total += hi - lo
    return total


def analyze(course, audio_path):
    cues = course.get("cues") or []
    if not cues:
        return None
    spans = silence_map(audio_path)
    if spans is None:
        return None
    total = float(course.get("duration") or 0)
    if total <= 0:
        total = cues[-1]["end"]
    sil_total = sum(e - s for s, e in spans)
    speech_total = max(total - sil_total, 1.0)
    chars = sum(len(c["text"]) for c in cues)
    rate = chars / speech_total  # 真实语速（字符/秒语音）

    rows = []
    over_s = miss_s = 0.0
    over_n = miss_n = 0
    worst = 0.0
    for i, cu in enumerate(cues):
        d = cu["end"] - cu["start"]
        if d <= 0.3:
            continue
        sil_in = speech_in(spans, cu["start"], cu["end"])
        speech_avail = d - sil_in
        need = len(cu["text"]) / rate
        diff = need - speech_avail          # >0 溢出，<0 缺文本
        rows.append({"idx": i, "start": cu["start"], "end": cu["end"],
                     "chars": len(cu["text"]), "need": need,
                     "avail": speech_avail, "diff": diff, "text": cu["text"]})
        if diff > 0.5:
            over_s += diff
            over_n += 1
            worst = max(worst, diff)
        elif diff < -0.5:
            miss_s += -diff
            miss_n += 1

    return {
        "id": course["id"], "level": course.get("level"), "duration": total,
        "speech": speech_total, "silence": sil_total, "rate": rate,
        "chars": chars, "cues": len(rows),
        "over_s": over_s, "over_n": over_n, "worst": worst,
        "miss_s": miss_s, "miss_n": miss_n,
        "over_pct": over_s / max(speech_total, 1) * 100,
        "miss_pct": miss_s / max(speech_total, 1) * 100,
        "rows": rows,
    }


def main():
    ap = argparse.ArgumentParser(description="播客字幕时间轴质量分析")
    ap.add_argument("--source", default="../english-pod-data")
    ap.add_argument("--limit", type=int, default=0, help="只分析前 N 课")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--json", default="", help="把逐课结果写到 JSON")
    args = ap.parse_args()

    src = os.path.abspath(args.source)
    courses = json.load(open(os.path.join(src, "index.json"), encoding="utf-8"))
    if args.limit:
        courses = courses[: args.limit]

    results = []
    with cf.ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {
            ex.submit(analyze, c, os.path.join(src, "audio", f"{c['id']}.m4a")): c["id"]
            for c in courses
        }
        done = 0
        for fu in cf.as_completed(futs):
            r = fu.result()
            if r:
                results.append(r)
            done += 1
            if done % 10 == 0 or done == len(courses):
                print(f"  已分析 {done}/{len(courses)}", file=sys.stderr, flush=True)

    if not results:
        sys.exit("没有分析结果，请检查音频文件")

    results.sort(key=lambda r: r["over_pct"])
    print(f"\n{'课程':<18}{'等级':<5}{'语速':>7}{'溢出%':>8}{'溢出句':>7}"
          f"{'缺文本%':>9}{'缺文本句':>9}")
    for r in results:
        print(f"{r['id']:<18}{r['level']:<5}{r['rate']:>7.1f}{r['over_pct']:>7.1f}%"
              f"{r['over_n']:>7}{r['miss_pct']:>8.1f}%{r['miss_n']:>9}")

    n = len(results)
    print(f"\n=== 分布（按溢出占比）===")
    for lo, hi, label in [(0, 1, "<1%  基本正常"), (1, 3, "1-3% 轻微"),
                          (3, 6, "3-6% 明显"), (6, 1000, ">6%  严重")]:
        c = sum(1 for r in results if lo <= r["over_pct"] < hi)
        print(f"  {label:<14} {c:>3} 课 ({c / n * 100:.0f}%)")
    clean = [r for r in results if r["over_n"] == 0]
    print(f"\n零溢出句的课程: {len(clean)} 课"
          + (" —— " + ", ".join(r["id"] for r in clean) if clean else " —— 无"))

    if args.json:
        slim = [{k: v for k, v in r.items() if k != "rows"} for r in results]
        json.dump(slim, open(args.json, "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)
        print(f"\n逐课结果已写入 {args.json}")


if __name__ == "__main__":
    main()
