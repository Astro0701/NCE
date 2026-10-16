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

# 默认抽样：每级 2 课，优先挑体积小的
DEFAULT_SAMPLE = [
    "beginner-01",
    "beginner-02",
    "intermediate-13",
    "intermediate-25",
    "advanced-53",
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

    # ---------- 轻量索引（全部 111 课）----------
    slim = []
    for c in all_courses:
        cid = c["id"]
        vocab = c.get("vocabulary") or []
        slim.append({
            "id": cid,
            "level": c.get("level") or "",
            "number": c.get("number"),
            "title": c.get("title") or "",
            "duration": round(float(c.get("duration") or 0), 2),
            "cueCount": len(c.get("cues") or []),
            "vocabCount": len(vocab),
            "local": cid in sample_set,
        })
    # 按等级 → 课号排序，方便列表页直接渲染
    level_order = {"初级": 0, "中级": 1, "高级": 2}
    slim.sort(key=lambda x: (level_order.get(x["level"], 9), x["number"] or 0, x["id"]))

    payload = {
        "audioBase": args.audio_base,
        "lrcBase": "podcast/lrc/",
        "sampleCount": len(sample),
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
          f"（{len(slim)} 课，其中本地可播 {len(sample)} 课，"
          f"{os.path.getsize(out_js) / 1024:.0f} KB）")

    # ---------- 抽样课程的字幕 / 音频 / 词汇 ----------
    vocab_out = {}
    copied_lrc = copied_audio = 0
    missing = []
    for c in all_courses:
        cid = c["id"]
        if cid not in sample_set:
            continue
        vocab = c.get("vocabulary") or []
        if vocab:
            vocab_out[cid] = [
                {"term": v.get("term") or "", "definition": v.get("definition") or ""}
                for v in vocab if v.get("term")
            ]
        s_lrc = os.path.join(src, "lrc", f"{cid}.lrc")
        if os.path.exists(s_lrc):
            shutil.copy2(s_lrc, os.path.join(d_lrc, f"{cid}.lrc"))
            copied_lrc += 1
        s_audio = os.path.join(src, "audio", f"{cid}.m4a")
        if os.path.exists(s_audio) and os.path.getsize(s_audio) > 1024:
            shutil.copy2(s_audio, os.path.join(d_audio, f"{cid}.m4a"))
            copied_audio += 1
        else:
            missing.append(cid)

    out_vocab = os.path.join(dest, "podcast", "vocabulary.json")
    with open(out_vocab, "w", encoding="utf-8") as f:
        json.dump(vocab_out, f, ensure_ascii=False, indent=1)
    print(f"[2/3] 词汇 -> podcast/vocabulary.json  "
          f"（{sum(len(v) for v in vocab_out.values())} 个词条）")

    total = sum(os.path.getsize(os.path.join(d_audio, f))
                for f in os.listdir(d_audio) if f.endswith(".m4a"))
    print(f"[3/3] 复制完成：字幕 {copied_lrc} 个 / 音频 {copied_audio} 个（{total / 1048576:.1f} MB）")
    if missing:
        print(f"      ! 以下课程音频尚未下载完，已跳过：{', '.join(missing)}")
        print(f"        下载完成后重新运行本脚本即可补齐。")


if __name__ == "__main__":
    main()
