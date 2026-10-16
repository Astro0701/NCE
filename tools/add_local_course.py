#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把一个本地音频 + 转写 JSON + 译文 JSON 组装成一节播客课程。

做四件事：
  1. 生成双语 LRC（[mm:ss.xx]english|中文）
  2. 把音频复制进 podcast/audio/
  3. 把课程元数据 + 词汇写进 podcast/local-courses.json
  4. 校验条数与文件完整性

用法：
  python3 tools/add_local_course.py \
      --audio /path/to/audio.mp3 \
      --transcript /tmp/asr/batch/xxx.json \
      --i18n podcast/i18n/<id>.json \
      --id <id>

其中 --i18n 指向的文件需要包含：id / title / level / number / cues(中文数组) / vocabulary
（cues 条数必须与转写一致）
"""

import argparse
import hashlib
import json
import os
import shutil
import sys


def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def ts(t):
    m = int(t // 60)
    s = t - m * 60
    return f"[{m:02d}:{s:05.2f}]"


def main():
    ap = argparse.ArgumentParser(description="组装一节本地播客课程")
    ap.add_argument("--audio", required=True)
    ap.add_argument("--transcript", required=True, help="转写 JSON（含 cues: [{start,end,text}]）")
    ap.add_argument("--i18n", required=True, help="译文 JSON")
    ap.add_argument("--id", required=True)
    ap.add_argument("--dest", default=".")
    args = ap.parse_args()

    dest = os.path.abspath(args.dest)
    tr = json.load(open(args.i18n, encoding="utf-8"))
    asr = json.load(open(args.transcript, encoding="utf-8"))
    cid = args.id

    cues = asr["cues"]
    zh = tr.get("cues") or []
    if len(zh) != len(cues):
        sys.exit(f"✗ 译文条数 {len(zh)} 与转写句数 {len(cues)} 不一致，请先补齐")

    # ---- 1. 双语 LRC ----
    lines = []
    for en, cn in zip(cues, zh):
        cn = cn.replace("|", "／").replace("\n", " ").strip()
        lines.append(f"{ts(en['start'])}{en['text']}{'|' + cn if cn else ''}")
    d_lrc = os.path.join(dest, "podcast", "lrc")
    os.makedirs(d_lrc, exist_ok=True)
    lrc_rel = f"podcast/lrc/{cid}.lrc"
    with open(os.path.join(dest, lrc_rel), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"  字幕 -> {lrc_rel}  ({len(lines)} 行)")

    # ---- 2. 音频 ----
    ext = os.path.splitext(args.audio)[1].lower()
    d_audio = os.path.join(dest, "podcast", "audio")
    os.makedirs(d_audio, exist_ok=True)
    audio_rel = f"podcast/audio/{cid}{ext}"
    shutil.copy2(args.audio, os.path.join(dest, audio_rel))
    ok = md5(args.audio) == md5(os.path.join(dest, audio_rel))
    size_mb = os.path.getsize(args.audio) / 1048576
    print(f"  音频 -> {audio_rel}  ({size_mb:.2f} MB, MD5 {'一致 ✓' if ok else '不一致 ✗'})")
    if not ok:
        sys.exit("✗ 音频复制校验失败")

    # ---- 3. 写入 local-courses.json ----
    manifest = os.path.join(dest, "podcast", "local-courses.json")
    data = {"_note": "仓库本地的播客课程（音频/LRC 直接放在仓库里，不依赖源站数据）。"
                     "新增课程时在这里加一条，然后重跑 tools/build_podcast_site.py。",
            "courses": []}
    if os.path.exists(manifest):
        try:
            data = json.load(open(manifest, encoding="utf-8"))
            data.setdefault("courses", [])
        except Exception:  # noqa: BLE001
            pass

    entry = {
        "id": cid,
        "level": tr.get("level") or "初级",
        "number": tr.get("number") or 0,
        "title": tr.get("title") or cid,
        "duration": round(float(tr.get("duration") or asr.get("duration") or 0), 2),
        "audio": audio_rel,
        "lrc": lrc_rel,
        "vocabulary": tr.get("vocabulary") or [],
    }
    data["courses"] = [c for c in data["courses"] if c.get("id") != cid] + [entry]
    data["courses"].sort(key=lambda c: (c.get("level", ""), c.get("number") or 0))
    with open(manifest, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"  清单 -> podcast/local-courses.json（现共 {len(data['courses'])} 节）")

    print(f"  ✓ {cid} 组装完成：{len(lines)} 句 / {len(entry['vocabulary'])} 词 / "
          f"{entry['duration']:.1f}s")


if __name__ == "__main__":
    main()
