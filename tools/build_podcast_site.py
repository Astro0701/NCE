#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 fetch_english_pod.py 抓下来的原始数据，转换成站点可直接用的文件。

原始数据（仓库外，体积大）：
  english-pod-data/
    index.json          111 课全量（含 cues / vocabulary）
    audio/{id}.m4a
    lrc/{id}.lrc

站点产物（仓库内，只放抽样的几课，保持仓库轻量）：
  static/podcast-data.js     全量 111 课的轻量索引（无字幕正文，约 20 KB）
  podcast/vocabulary.json    抽样课程的词汇释义
  podcast/lrc/{id}.lrc       抽样课程的逐句字幕
  podcast/audio/{id}.m4a     抽样课程的音频

用法：
  python3 tools/build_podcast_site.py --source ../english-pod-data
  python3 tools/build_podcast_site.py --source ../english-pod-data --sample beginner-01,beginner-02
  python3 tools/build_podcast_site.py --source ../english-pod-data --all   # 全量进仓库（不推荐）

之后要换成 R2/CDN 托管，只改 static/podcast-data.js 里的 audioBase 即可。
"""

import argparse
import json
import os
import shutil
import sys

# 默认抽样课程。当前只保留 advanced-18：
# 全站 111 课里，它是唯一一节字幕时间轴完全对齐的（单句溢出 > 1.5s 的句子为 0），
# 其余课程均有不同程度的「播放时重复」问题。详见 tools/analyze_podcast_timing.py。
DEFAULT_SAMPLE = [
    "advanced-18",
]

# 线上把音频迁到对象存储后，改这里（例如 'https://audio.example.com/'）
DEFAULT_AUDIO_BASE = "podcast/audio/"


def main():
    ap = argparse.ArgumentParser(description="生成站点播客数据")
    ap.add_argument("--source", default="../english-pod-data", help="原始数据目录")
    ap.add_argument("--dest", default=".", help="站点仓库根目录")
    ap.add_argument("--sample", default=",".join(DEFAULT_SAMPLE),
                    help="抽样课程 id，逗号分隔；传 'none' 表示不复制任何音视频")
    ap.add_argument("--all", action="store_true", help="全量复制（体积很大）")
    ap.add_argument("--audio-base", default=DEFAULT_AUDIO_BASE, help="音频 URL 前缀")
    args = ap.parse_args()

    src = os.path.abspath(args.source)
    dest = os.path.abspath(args.dest)
    index_path = os.path.join(src, "index.json")
    if not os.path.exists(index_path):
        sys.exit(f"找不到 {index_path}，请先运行 tools/fetch_english_pod.py")

    with open(index_path, encoding="utf-8") as f:
        all_courses = json.load(f)

    if args.all:
        sample = [c["id"] for c in all_courses]
    elif args.sample.strip().lower() in ("none", ""):
        sample = []
    else:
        sample = [s.strip() for s in args.sample.split(",") if s.strip()]
    sample_set = set(sample)

    d_lrc = os.path.join(dest, "podcast", "lrc")
    d_audio = os.path.join(dest, "podcast", "audio")
    os.makedirs(d_lrc, exist_ok=True)
    os.makedirs(d_audio, exist_ok=True)
    os.makedirs(os.path.join(dest, "static"), exist_ok=True)

    # ---------- 轻量索引 ----------
    # 索引里只放「可播放」的课程：抽样进仓库的源站课程 + 仓库本地的自定义课程。
    # 未上线的课程不再出现在列表里（历史上会灰显，现已移除）。
    slim = []
    for c in all_courses:
        cid = c["id"]
        if cid not in sample_set:
            continue
        vocab = c.get("vocabulary") or []
        tr_vocab = None
        p = os.path.join(dest, "podcast", "i18n", f"{cid}.json")
        if os.path.exists(p):
            try:
                tr_vocab = (json.load(open(p, encoding="utf-8")) or {}).get("vocabulary")
            except Exception:  # noqa: BLE001
                tr_vocab = None
        slim.append({
            "id": cid,
            "level": c.get("level") or "",
            "number": c.get("number"),
            "title": c.get("title") or "",
            "duration": round(float(c.get("duration") or 0), 2),
            "cueCount": len(c.get("cues") or []),
            "vocabCount": len(tr_vocab) if tr_vocab else len(vocab),
            "audio": f"{args.audio_base}{cid}.m4a",
            "local": True,
            "origin": "source",
        })

    # 仓库本地的自定义课程（音频/LRC 直接放在仓库里）
    local_manifest = os.path.join(dest, "podcast", "local-courses.json")
    local_courses = []
    if os.path.exists(local_manifest):
        try:
            local_courses = (json.load(open(local_manifest, encoding="utf-8")) or {}).get("courses") or []
        except Exception as e:  # noqa: BLE001
            print(f"      ! podcast/local-courses.json 解析失败：{e}")
    for c in local_courses:
        cid = c.get("id")
        if not cid:
            continue
        audio_rel = c.get("audio") or f"podcast/audio/{cid}.mp3"
        if not os.path.exists(os.path.join(dest, audio_rel)):
            print(f"      ! 本地课程 {cid} 的音频不存在：{audio_rel}，已跳过")
            continue
        lrc_rel = c.get("lrc") or f"podcast/lrc/{cid}.lrc"
        cue_count = c.get("cueCount")
        if cue_count is None and os.path.exists(os.path.join(dest, lrc_rel)):
            cue_count = sum(1 for l in open(os.path.join(dest, lrc_rel), encoding="utf-8") if l.strip())
        slim.append({
            "id": cid,
            "level": c.get("level") or "初级",
            "number": c.get("number") or 0,
            "title": c.get("title") or cid,
            "duration": round(float(c.get("duration") or 0), 2),
            "cueCount": cue_count or 0,
            "vocabCount": len(c.get("vocabulary") or []),
            "audio": audio_rel,
            "local": True,
            "origin": "local",
        })

    # 按等级 → 课号排序，方便列表页直接渲染
    level_order = {"初级": 0, "中级": 1, "高级": 2}
    slim.sort(key=lambda x: (level_order.get(x["level"], 9), x["number"] or 0, x["id"]))

    payload = {
        "audioBase": args.audio_base,
        "lrcBase": "podcast/lrc/",
        "totalCount": len(slim),
        "courses": slim,
    }
    out_js = os.path.join(dest, "static", "podcast-data.js")
    with open(out_js, "w", encoding="utf-8") as f:
        f.write("/* 由 tools/build_podcast_site.py 生成，请勿手改 */\n")
        f.write("window.NCE_PODCAST = ")
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(f"[1/3] 索引 -> {os.path.relpath(out_js, dest)}  "
          f"（{len(slim)} 课，全部可播放；其中源站抽样 {len(sample)} 课、"
          f"本地课程 {len(local_courses)} 课，"
          f"{os.path.getsize(out_js) / 1024:.0f} KB）")

    # ---------- 抽样课程的字幕 / 音频 / 词汇 ----------
    vocab_out = {}
    copied_lrc = copied_audio = translated = 0
    missing = []
    i18n_dir = os.path.join(dest, "podcast", "i18n")
    for c in all_courses:
        cid = c["id"]
        if cid not in sample_set:
            continue

        # 词汇：优先用人工翻译文件里的中文释义，否则退回源站词汇
        tr = None
        tr_path = os.path.join(i18n_dir, f"{cid}.json")
        if os.path.exists(tr_path):
            try:
                tr = json.load(open(tr_path, encoding="utf-8"))
            except Exception as e:  # noqa: BLE001
                print(f"      ! {cid} 译文文件解析失败：{e}")
        if tr and tr.get("vocabulary"):
            vocab_out[cid] = [
                {"term": v.get("term") or "", "definition": v.get("definition") or ""}
                for v in tr["vocabulary"] if v.get("term")
            ]
        else:
            vocab = c.get("vocabulary") or []
            if vocab:
                vocab_out[cid] = [
                    {"term": v.get("term") or "", "definition": v.get("definition") or ""}
                    for v in vocab if v.get("term")
                ]

        # 字幕：英文原文 + 可选中文译文，写成 LRC 的 en|zh 形式
        s_lrc = os.path.join(src, "lrc", f"{cid}.lrc")
        if os.path.exists(s_lrc):
            lines = [l for l in open(s_lrc, encoding="utf-8").read().split("\n") if l.strip()]
            zh = (tr or {}).get("cues") or []
            if zh:
                if len(zh) != len(lines):
                    print(f"      ! {cid} 译文条数 {len(zh)} 与字幕行数 {len(lines)} 不符，已跳过译文")
                else:
                    merged = []
                    for line, t in zip(lines, zh):
                        t = t.replace("|", "／").replace("\n", " ").strip()
                        merged.append(f"{line}|{t}" if t else line)
                    lines = merged
                    translated += 1
            with open(os.path.join(d_lrc, f"{cid}.lrc"), "w", encoding="utf-8") as f:
                f.write("\n".join(lines) + "\n")
            copied_lrc += 1

        s_audio = os.path.join(src, "audio", f"{cid}.m4a")
        if os.path.exists(s_audio) and os.path.getsize(s_audio) > 1024:
            shutil.copy2(s_audio, os.path.join(d_audio, f"{cid}.m4a"))
            copied_audio += 1
        else:
            missing.append(cid)

    # 本地课程的词汇也写进 vocabulary.json
    for c in local_courses:
        cid = c.get("id")
        vocab = c.get("vocabulary") or []
        if cid and vocab:
            vocab_out[cid] = [
                {"term": v.get("term") or "", "definition": v.get("definition") or ""}
                for v in vocab if v.get("term")
            ]

    out_vocab = os.path.join(dest, "podcast", "vocabulary.json")
    with open(out_vocab, "w", encoding="utf-8") as f:
        json.dump(vocab_out, f, ensure_ascii=False, indent=1)
    print(f"[2/3] 词汇 -> podcast/vocabulary.json  "
          f"（{sum(len(v) for v in vocab_out.values())} 个词条）")

    total = sum(os.path.getsize(os.path.join(d_audio, f))
                for f in os.listdir(d_audio)
                if os.path.isfile(os.path.join(d_audio, f)) and not f.startswith("."))
    print(f"[3/3] 复制完成：字幕 {copied_lrc} 个（其中 {translated} 个含中文译文）"
          f" / 音频 {copied_audio} 个（{total / 1048576:.1f} MB）")
    if missing:
        print(f"      ! 以下课程音频尚未下载完，已跳过：{', '.join(missing)}")
        print(f"        下载完成后重新运行本脚本即可补齐。")


if __name__ == "__main__":
    main()
