# 新录音处理工作流（tape → 上线）

> 本文件是**唯一权威流程**。以后用户往 `tape/` 放新录音，就严格按本文执行，
> 九步全部完成才算结束。本文随仓库版本控制，流程有变时同步更新。

---

## 0. 目录与工具

| 项 | 路径 |
|---|---|
| 待处理音频目录 | `/Users/wangyuhang/Downloads/NCE/tape/` |
| 转写模型（1.5 GB，**已固化，勿动**） | `/Users/wangyuhang/Downloads/NCE/whisper-turbo/` |
| 语音转写脚本 | `tools/transcribe_audio.py` |
| 课程组装脚本 | `tools/add_local_course.py` |
| 站点数据构建脚本 | `tools/build_podcast_site.py` |
| 课程清单 | `podcast/local-courses.json` |
| 译文源文件 | `podcast/i18n/{课程id}.json` |
| 双语字幕产物 | `podcast/lrc/{课程id}.lrc` |
| 音频产物 | `podcast/audio/{课程id}.{ext}` |
| 本地调试服务 | `python3 http_server.py`（端口 8082） |
| 远端 | `github.com/Astro0701/NCE.git`，GitHub Pages 自动部署 |

Python 解释器：`/Users/wangyuhang/.workbuddy-ai/binaries/python/envs/default/bin/python`
（mlx-whisper 装在这里）。

---

## 1. 清点 tape 并**查重**（最容易漏的一步）

```bash
ls -la /Users/wangyuhang/Downloads/NCE/tape/
```

再按文件名去 `podcast/local-courses.json` 里查 id。**tape 里可能混有已经
处理过的音频**（用户重复放置），不要重复加工：

| 情况 | 处理 |
|---|---|
| id 已在 `local-courses.json` | 已上线，跳过，只做第 9 步清理 |
| 找不到 | 新音频，走完整流程 |

早期已验证：同一文件在不同目录下 MD5 一致即可认定为同一份。

---

## 2. 转写

```bash
python3 tools/transcribe_audio.py \
  --input "/Users/wangyuhang/Downloads/NCE/tape/xxx.mp3" \
  --output /tmp/asr/x.json \
  --model /Users/wangyuhang/Downloads/NCE/whisper-turbo
```

- 自动转 16 kHz 单声道再识别；约 80x 实时，7 分钟音频约 11 秒
- 输出 JSON：`{duration, cues:[{start,end,text}]}`
- **模型路径必须是上面的固化目录，不要用 `/tmp/asr/...`**——重启即被清空

---

## 3. 通读全文，定三样东西

读完整转写再动手，确定：

1. **标题**（英文，和现有课程风格一致）
2. **等级**：初级 / 中级 / 高级。判断依据是词汇密度与语速，不是时长——
   含大量术语（如 neuroplasticity / prosody）或自然语速长对话的归高级
3. **编号**：`number` 只影响同级内的排序，取该等级下未占用的整数即可

---

## 4. 人工翻译 + 写词汇

新建 `podcast/i18n/{id}.json`：

```json
{
  "id": "...",
  "title": "...",
  "level": "初级|中级|高级",
  "number": 3,
  "duration": 136.82,
  "note": "来源与转写说明；如有 ASR 误识别在此注明",
  "cues": ["第 1 句译文", "第 2 句译文", "..."],
  "vocabulary": [{"term": "...", "definition": "中文释义"}]
}
```

**硬性要求**：

- `cues` 条数**必须等于**转写 `cues` 条数，一条不能少
- 译文里不能出现 `|`（会被当成 LRC 分隔符，脚本会自动替换成 `／`，但别依赖）
- 英文例句可保留原文不译，如 `"I'll look into it."`，方便跟读
- 遇到 ASR 明显误识别（如把 *brake* 听成 *break*），按正确词义翻译并在 `note` 里说明
- 遇到两位说话人声音交叠导致转写混乱，正常翻译并在 `note` 里注明

> ### ⚠ 最大的坑：英文原句被切成两段
> 转写常把一句话断成两条 cue，例如
> `"…you reduce the cognitive load"` + `"for the rest of the day."`。
> 翻译时极易只译一条、漏掉另一条，**导致后面所有译文整体后移一句**。
>
> **对策**：译完立刻核对条数；并在断句附近（通常 25–30 句一带）抽查中英对应。

**词汇**：挑本课真正出现的实用词，8–14 条为宜，释义用中文。

---

## 5. 组装

```bash
python3 tools/add_local_course.py \
  --audio "/Users/wangyuhang/Downloads/NCE/tape/xxx.mp3" \
  --transcript /tmp/asr/x.json \
  --i18n podcast/i18n/{id}.json \
  --id {id}
```

脚本会做四件事：生成双语 LRC → 复制音频进仓库 → 写入 `local-courses.json`
→ **校验条数与音频 MD5**。条数不符会直接报错退出（这正是第 4 步坑的保险）。

---

## 6. 构建站点数据

```bash
python3 tools/build_podcast_site.py
```

脚本只读仓库内的 `local-courses.json`，**不依赖任何外部数据目录**。
预期输出：课程总数 = 原有节数 + 1。

---

## 7. 本地校验（必须做，不能跳过）

```bash
python3 http_server.py   # 端口 8082，CORS + Range

export PATH="/Users/wangyuhang/.workbuddy-ai/binaries/node/versions/22.22.2-6/bin:$PATH"
agent-browser open "http://localhost:8082/podcast.html"
agent-browser open "http://localhost:8082/lesson.html#PODCAST/{id}"
```

**逐项确认**：

- [ ] 列表页卡片数 = 预期总数，且**无灰显**（全部可播放）
- [ ] 播放页标题、等级徽章正确
- [ ] 音频 `readyState = 4`（已加载），`duration` 与源文件相符
- [ ] 句子数 = 转写句数，`.cn` 元素数量与句子数相等
- [ ] 中文**实际可见**（`getComputedStyle(cn).display !== 'none'`）
- [ ] 中英 / 英文 / 中文 三个切换按钮都在且能点
- [ ] 词汇面板条数正确，单词可点读
- [ ] 顺手点一下播放，确认音频真的在走

> **注意**：浏览器会缓存 LRC。若中文没出现，先 `curl` 本地
> `podcast/lrc/{id}.lrc` 确认文件本身带 `|中文`，再 `agent-browser close`
> 重开，不要盲目改代码。

---

## 8. 提交并推送

```bash
git add -A
git commit -m "feat: 新增播客《标题》"
git push origin main
```

- 提交信息用 Conventional Commits + 中文描述
- 推送前先 `git fetch`，远程有新提交就 `git rebase origin/main`
- 该环境偶发 `SSL_ERROR_SYSCALL`，重试即可
- 推完**等 GitHub Pages 部署完**（通常 1–2 分钟），再 `curl` 线上
  `podcast-data.js` 的 `totalCount`、`podcast/lrc/{id}.lrc` 行数与中文数、
  音频 Range 请求，三者都对才算完成

---

## 9. 清理 tape 内容（保留目录）

```bash
# 删前必须 MD5 比对，确认仓库已有完全一致的副本
# 通过后用系统 trash 移入废纸篓（可恢复），不要用 rm
/usr/bin/trash /Users/wangyuhang/Downloads/NCE/tape/xxx.mp3
```

- 只删**本轮已处理完并已推送**的文件
- **`tape/` 目录本身要保留，不要 `rmdir`**——用户会一直往这个固定目录里放新录音，
  目录不存在会打断工作流
- 顺手删 `.DS_Store`，但目录留着

---

## 命令速查

```bash
MODEL=/Users/wangyuhang/Downloads/NCE/whisper-turbo
TAPE=/Users/wangyuhang/Downloads/NCE/tape

# 转写
python3 tools/transcribe_audio.py --input "$TAPE/x.mp3" --output /tmp/asr/x.json --model $MODEL
# 组装
python3 tools/add_local_course.py --audio "$TAPE/x.mp3" --transcript /tmp/asr/x.json \
    --i18n podcast/i18n/{id}.json --id {id}
# 构建
python3 tools/build_podcast_site.py
# 校验服务器
python3 http_server.py
# 推送
git add -A && git commit -m "feat: 新增播客《标题》" && git push origin main
# 清理
/usr/bin/trash "$TAPE/x.mp3"
```

---

## 踩坑记录

| 现象 | 原因 | 对策 |
|---|---|---|
| HuggingFace 下载只有 ~200 KB/s | 新版 `huggingface_hub` 默认走 xet 协议，绕过镜像直连 AWS CDN | 设 `HF_HUB_DISABLE_XET=1`；模型从 **ModelScope** 下（8.9 MB/s，支持断点续传） |
| 译文整体后移一句 | 英文原句被转写切成两条 cue，漏译其中一条 | 译完核对 `cues` 条数 == 转写句数；断句附近抽查 |
| 中文不显示 | 历史版本把「无中文时强制的 en-mode」写进了 `localStorage.displayMode` | 已修复（`nceDisplayModeMigrated` 一次性迁移），不再持久化强制状态 |
| 线上看着没更新 | GitHub Pages 部署有延迟 / 浏览器缓存 LRC | 等 1–2 分钟再 curl；`agent-browser close` 重开 |
| `brew install` 失败 | 沙箱拦截 `sandbox-exec` | Python 用 venv + 清华镜像 `pip install -i https://pypi.tuna.tsinghua.edu.cn/simple` |
| 音频复制后内容不对 | 网络中断导致静默写半截文件 | `add_local_course.py` 会自动比对 MD5，不一致即报错 |
