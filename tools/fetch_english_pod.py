#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
English Pod (english.52131415.xyz) 资源抓取脚本

抓取内容：
  1. 课程清单        GET /api/courses
  2. 单课详情(字幕/词汇)  GET /api/courses/{id}
  3. 音频文件        GET /media/{id}?v=4

输出目录结构（默认 ./podcast-data）：
  podcast-data/
    index.json              汇总清单（含标题/等级/时长/字幕/词汇）
    courses/{id}.json       单课详情（原始 API 响应）
    audio/{id}.m4a          音频
    lrc/{id}.lrc            由 cues 生成的 LRC 歌词（可直接给点读播放器用）

用法：
  python3 tools/fetch_english_pod.py --list                # 只看清单，不下载
  python3 tools/fetch_english_pod.py --limit 3             # 试抓 3 课
  python3 tools/fetch_english_pod.py                       # 全量抓取（约 1.9 GB）
  python3 tools/fetch_english_pod.py --audio-only          # 只补音频
  python3 tools/fetch_english_pod.py --meta-only           # 只补元数据

特性：断点续传（已存在且大小正确则跳过）、并发下载、失败重试、实时进度。
"""

import argparse
import concurrent.futures as cf
import json
import os
import random
import shutil
import sys
import threading
import time
import urllib.error
import urllib.request

BASE = "https://english.52131415.xyz"
# Cloudflare 会拦截默认的 Python-urllib UA，必须伪装
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "*/*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": BASE + "/",
}

_print_lock = threading.Lock()


def log(msg):
    with _print_lock:
        print(msg, flush=True)


def fetch(url, timeout=60, retries=4):
    """带重试与退避的 GET，返回 bytes。"""
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            if attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1) + random.random())
    raise RuntimeError(f"请求失败 {url}: {last}")


def fetch_json(url, timeout=30, retries=4):
    return json.loads(fetch(url, timeout=timeout, retries=retries).decode("utf-8"))


def download_audio(course_id, dest, timeout=180, retries=4, force=False):
    """下载音频，返回 (字节数, 是否命中缓存)。已存在且非空则跳过（force=True 时强制重下）。"""
    if not force and os.path.exists(dest) and os.path.getsize(dest) > 1024:
        return os.path.getsize(dest), True
    url = f"{BASE}/media/{course_id}?v=4"
    tmp = dest + ".part"
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                # 关键：记录服务端声明的长度。连接中途断开时 urllib 未必抛异常，
                # 会静默写入半截文件，必须自己比对字节数。
                declared = r.headers.get("Content-Length")
                declared = int(declared) if declared and declared.isdigit() else None
                with open(tmp, "wb") as f:
                    shutil.copyfileobj(r, f, length=1 << 16)
            size = os.path.getsize(tmp)
            if declared is not None and size != declared:
                raise RuntimeError(f"字节数不符：收到 {size}，应为 {declared}")
            if size < 1024:
                raise RuntimeError(f"文件过小 ({size} B)")
            os.replace(tmp, dest)
            return size, False
        except Exception as e:  # noqa: BLE001
            last = e
            if os.path.exists(tmp):
                os.remove(tmp)
            if attempt < retries - 1:
                time.sleep(2 * (attempt + 1) + random.random())
    raise RuntimeError(f"下载失败 {course_id}: {last}")


def remote_size(course_id, timeout=30, retries=3):
    """查询服务端该音频的字节数，失败返回 -1。"""
    url = f"{BASE}/media/{course_id}?v=4"
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS, method="HEAD")
            with urllib.request.urlopen(req, timeout=timeout) as r:
                val = r.headers.get("Content-Length")
                return int(val) if val and val.isdigit() else -1
        except Exception:  # noqa: BLE001
            if attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1) + random.random())
    return -1


def cues_to_lrc(cues):
    """把 cues([{start,end,text}]) 转成 LRC 文本。"""
    lines = []
    for c in cues:
        try:
            t = float(c.get("start") or 0)
        except (TypeError, ValueError):
            continue
        m = int(t // 60)
        s = t - m * 60
        text = (c.get("text") or "").replace("\n", " ").strip()
        if text:
            lines.append(f"[{m:02d}:{s:05.2f}]{text}")
    return "\n".join(lines) + ("\n" if lines else "")


def fmt_size(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024


def main():
    ap = argparse.ArgumentParser(description="抓取 English Pod 课程与音频")
    ap.add_argument("--out", default="podcast-data", help="输出目录（默认 ./podcast-data）")
    ap.add_argument("--limit", type=int, default=0, help="只抓前 N 课（0 = 全部）")
    ap.add_argument("--workers", type=int, default=4, help="音频并发数（默认 4）")
    ap.add_argument("--list", action="store_true", help="只列出课程清单")
    ap.add_argument("--meta-only", action="store_true", help="只抓元数据，不下载音频")
    ap.add_argument("--audio-only", action="store_true", help="只下载音频")
    ap.add_argument("--no-lrc", action="store_true", help="不生成 LRC 文件")
    ap.add_argument("--verify", action="store_true",
                    help="逐个与服务器核对字节数，自动重下被截断的文件（较慢但可靠）")
    args = ap.parse_args()

    out = os.path.abspath(args.out)
    d_courses = os.path.join(out, "courses")
    d_audio = os.path.join(out, "audio")
    d_lrc = os.path.join(out, "lrc")
    for d in (out, d_courses, d_audio, d_lrc):
        os.makedirs(d, exist_ok=True)

    log(f"[1/3] 获取课程清单 {BASE}/api/courses ...")
    courses = fetch_json(f"{BASE}/api/courses")
    if args.limit:
        courses = courses[: args.limit]
    total_dur = sum(float(c.get("duration") or 0) for c in courses)
    log(f"      共 {len(courses)} 课，音频总时长 {total_dur / 3600:.1f} 小时")

    if args.list:
        for c in courses:
            log(f"  {c['id']:<18} {c['level']:<4} EP{c['number']:<3} "
                f"{float(c.get('duration') or 0) / 60:5.1f}min  {c['title']}")
        return

    # ---------- 元数据 ----------
    details = {}
    if not args.audio_only:
        log(f"[2/3] 抓取单课详情（字幕 / 词汇）...")
        def get_detail(c):
            cid = c["id"]
            path = os.path.join(d_courses, f"{cid}.json")
            if os.path.exists(path) and os.path.getsize(path) > 200:
                try:
                    return cid, json.load(open(path, encoding="utf-8")), True
                except Exception:  # noqa: BLE001
                    pass
            d = fetch_json(f"{BASE}/api/courses/{cid}")
            with open(path, "w", encoding="utf-8") as f:
                json.dump(d, f, ensure_ascii=False, indent=1)
            if not args.no_lrc:
                with open(os.path.join(d_lrc, f"{cid}.lrc"), "w", encoding="utf-8") as f:
                    f.write(cues_to_lrc(d.get("cues") or []))
            return cid, d, False

        with cf.ThreadPoolExecutor(max_workers=8) as ex:
            futs = {ex.submit(get_detail, c): c["id"] for c in courses}
            done = 0
            for fu in cf.as_completed(futs):
                try:
                    cid, d, cached = fu.result()
                    details[cid] = d
                except Exception as e:  # noqa: BLE001
                    log(f"      ! {futs[fu]} 详情失败: {e}")
                done += 1
                if done % 20 == 0 or done == len(courses):
                    log(f"      {done}/{len(courses)}")
        log(f"      详情完成：{len(details)} 课，"
            f"{sum(len(d.get('cues') or []) for d in details.values())} 条字幕，"
            f"{sum(len(d.get('vocabulary') or []) for d in details.values())} 个词汇")
    else:
        for c in courses:
            p = os.path.join(d_courses, f"{c['id']}.json")
            if os.path.exists(p):
                try:
                    details[c["id"]] = json.load(open(p, encoding="utf-8"))
                except Exception:  # noqa: BLE001
                    pass

    # ---------- 汇总索引 ----------
    index = []
    for c in courses:
        d = details.get(c["id"], {})
        index.append({
            "id": c["id"],
            "level": c.get("level"),
            "number": c.get("number"),
            "fileNumber": c.get("fileNumber"),
            "title": c.get("title"),
            "originalTitle": c.get("originalTitle"),
            "duration": c.get("duration"),
            "available": c.get("available"),
            "noteCount": c.get("noteCount"),
            "audio": f"audio/{c['id']}.m4a",
            "lrc": f"lrc/{c['id']}.lrc" if os.path.exists(os.path.join(d_lrc, f"{c['id']}.lrc")) else None,
            "cueCount": len(d.get("cues") or []),
            "vocabulary": d.get("vocabulary") or [],
            "cues": d.get("cues") or [],
            "chapters": d.get("chapters") or [],
        })
    with open(os.path.join(out, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
    log(f"      汇总索引已写入 {os.path.join(out, 'index.json')}")

    # ---------- 音频 ----------
    if not args.meta_only:
        log(f"[3/3] 下载音频（并发 {args.workers}）...")

        def local_path(cid):
            return os.path.join(d_audio, f"{cid}.m4a")

        def usable(cid):
            """本地文件是否存在且大小正确（--verify 时与服务器核对）。"""
            p = local_path(cid)
            if not (os.path.exists(p) and os.path.getsize(p) > 1024):
                return False
            if not args.verify:
                return True
            expected = remote_size(cid)
            if expected <= 0:
                # 查不到远端大小，保守起见保留本地文件
                return True
            return os.path.getsize(p) == expected

        if args.verify:
            log("      校验模式：逐个与服务器核对字节数（较慢）")
        jobs = [c for c in courses if not usable(c["id"])]
        skipped = len(courses) - len(jobs)
        if skipped:
            log(f"      已存在 {skipped} 课，跳过")
        total_bytes = 0
        done = 0
        lock = threading.Lock()

        def job(c):
            # verify 模式下命中的是「大小不符」的文件，需要强制重下
            return c["id"], download_audio(
                c["id"], os.path.join(d_audio, f"{c['id']}.m4a"), force=args.verify
            )

        if jobs:
            with cf.ThreadPoolExecutor(max_workers=args.workers) as ex:
                futs = {ex.submit(job, c): c["id"] for c in jobs}
                for fu in cf.as_completed(futs):
                    try:
                        cid, (size, cached) = fu.result()
                        with lock:
                            total_bytes += size
                            done += 1
                            log(f"      [{done}/{len(jobs)}] {cid}  "
                                f"{'缓存' if cached else fmt_size(size)}  "
                                f"累计 {fmt_size(total_bytes)}")
                    except Exception as e:  # noqa: BLE001
                        log(f"      ! {futs[fu]} 失败: {e}")
        log(f"      音频完成：新增 {done} 课，累计 {fmt_size(total_bytes)}")

    log("\n完成。输出目录：" + out)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
