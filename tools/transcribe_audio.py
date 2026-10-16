#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
用 Whisper 把音频转写成带时间戳的英文文本。

依赖：mlx-whisper（Apple Silicon 专用，比 openai-whisper 快很多）
  /Users/wangyuhang/.workbuddy-ai/binaries/python/envs/default/bin/pip install mlx-whisper

国内下载模型慢的话，脚本会自动走 hf-mirror.com 镜像。

用法：
  python3 tools/transcribe_audio.py --input audio.mp3 --output out.json
  python3 tools/transcribe_audio.py --input audio.mp3 --output out.json --model small
  python3 tools/transcribe_audio.py --input audio.mp3 --output out.json --max-chars 110

输出 JSON：
  { "duration": 137.3, "model": "...", "language": "en",
    "cues": [ {"start": 0.0, "end": 2.4, "text": "..."} ] }
"""

import argparse
import json
import os
import subprocess
import sys

# 国内网络下 HuggingFace 常连不上，默认走镜像
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
# 关键：新版 huggingface_hub 默认走 xet 协议，权重会绕开镜像直连
# us.aws.cdn.hf.co，国内实测只有 ~200 KB/s。关掉 xet 退回普通 HTTP 走镜像。
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

MODELS = {
    "tiny": "mlx-community/whisper-tiny-mlx",
    "base": "mlx-community/whisper-base-mlx",
    "small": "mlx-community/whisper-small-mlx",
    "medium": "mlx-community/whisper-medium-mlx",
    "large": "mlx-community/whisper-large-v3-mlx",
    "turbo": "mlx-community/whisper-large-v3-turbo",
}


def to_wav(src, dst, sr=16000):
    """统一转成 16kHz 单声道 wav，whisper 对这个格式最稳。"""
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", src,
         "-ar", str(sr), "-ac", "1", dst, "-y"],
        check=True,
    )


def split_long(cues, max_chars):
    """把过长的句子按标点切成更短的片段，便于逐句点读。"""
    out = []
    for c in cues:
        text = c["text"].strip()
        if len(text) <= max_chars:
            out.append({**c, "text": text})
            continue
        # 按句末标点切
        parts, buf = [], ""
        for ch in text:
            buf += ch
            if ch in ".!?" and len(buf) >= max_chars * 0.4:
                parts.append(buf.strip())
                buf = ""
        if buf.strip():
            parts.append(buf.strip())
        if len(parts) <= 1:
            out.append({**c, "text": text})
            continue
        # 按字符数比例分配时间
        total = sum(len(p) for p in parts)
        t0, span = c["start"], c["end"] - c["start"]
        acc = 0
        for p in parts:
            s = t0 + span * (acc / total)
            acc += len(p)
            e = t0 + span * (acc / total)
            out.append({"start": round(s, 2), "end": round(e, 2), "text": p})
    return out


def main():
    ap = argparse.ArgumentParser(description="音频转写（Whisper / mlx-whisper）")
    ap.add_argument("--input", required=True, help="输入音频（mp3/m4a/wav 等）")
    ap.add_argument("--output", required=True, help="输出 JSON 路径")
    ap.add_argument("--model", default="turbo",
                    help="模型档位（tiny/base/small/medium/large/turbo），或直接给本地模型目录路径")
    ap.add_argument("--language", default="en")
    ap.add_argument("--max-chars", type=int, default=110, help="单句最大字符数，超出则切分")
    ap.add_argument("--keep-wav", action="store_true")
    args = ap.parse_args()

    src = os.path.abspath(args.input)
    if not os.path.exists(src):
        sys.exit(f"找不到输入文件：{src}")

    wav = os.path.join(os.path.dirname(os.path.abspath(args.output)), "_asr_tmp.wav")
    print(f"[1/3] 转码为 16kHz 单声道 ...", file=sys.stderr)
    to_wav(src, wav)

    # --model 既可以是档位名，也可以是本地模型目录（推荐：用 ModelScope 下好再用）
    if os.path.isdir(args.model):
        model_ref = os.path.abspath(args.model)
    else:
        model_ref = MODELS.get(args.model, args.model)

    print(f"[2/3] 加载模型 {model_ref} ...", file=sys.stderr)
    import mlx_whisper
    result = mlx_whisper.transcribe(
        wav,
        path_or_hf_repo=model_ref,
        language=args.language,
        word_timestamps=False,
        condition_on_previous_text=False,
        verbose=False,
    )

    cues = []
    for seg in result.get("segments", []):
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        cues.append({"start": round(float(seg["start"]), 2),
                     "end": round(float(seg["end"]), 2),
                     "text": text})
    raw_n = len(cues)
    cues = split_long(cues, args.max_chars)

    duration = cues[-1]["end"] if cues else 0.0
    out = {"duration": round(duration, 2), "model": model_ref,
           "language": args.language, "cues": cues}
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    if not args.keep_wav and os.path.exists(wav):
        os.remove(wav)

    print(f"[3/3] 完成：{raw_n} 段 → 切分后 {len(cues)} 句，"
          f"总长 {duration:.1f}s -> {args.output}", file=sys.stderr)
    for c in cues[:5]:
        print(f"  [{c['start']:6.2f}-{c['end']:6.2f}] {c['text'][:70]}", file=sys.stderr)


if __name__ == "__main__":
    main()
