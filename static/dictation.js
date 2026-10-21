(() => {
    document.addEventListener('DOMContentLoaded', () => {
        const utils = window.NCEUtils;
        if (!utils || typeof utils.loadDictationPool !== 'function' || typeof utils.normalizeAnswer !== 'function') {
            console.error('NCEUtils (dictation) is not available. 请强制刷新页面以加载最新的 utils.js。');
            return;
        }

        const normalize = utils.normalizeAnswer;

        /** DOM 引用 */
        const emptyEl = document.getElementById('dictation-empty');
        const startEl = document.getElementById('dictation-start');
        const practiceEl = document.getElementById('dictation-practice');
        const startCountEl = document.getElementById('dictation-start-count');
        const startBtn = document.getElementById('dictation-start-btn');
        const statsEl = document.getElementById('dictation-stats');
        const metaEl = document.getElementById('dictation-meta');
        const cnEl = document.getElementById('dictation-cn');
        const replayBtn = document.getElementById('dictation-replay');
        const inputEl = document.getElementById('dictation-input');
        const feedbackEl = document.getElementById('dictation-feedback');
        const revealEl = document.getElementById('dictation-reveal');
        const showBtn = document.getElementById('dictation-show');
        const skipBtn = document.getElementById('dictation-skip');
        const nextBtn = document.getElementById('dictation-next');
        const backfillBtn = document.getElementById('dictation-backfill');
        const backfillMsg = document.getElementById('dictation-backfill-msg');
        const audio = document.getElementById('dictation-audio');

        /** 题库：{ "book|lesson|idx": { en, cn, start, end, audio, correctCount, ... } } */
        let pool = utils.loadDictationPool();

        let queue = [];          // 本轮题目队列
        let queueTotal = 0;      // 本轮题目总数
        let roundIndex = 0;      // 本轮已出题数
        let current = null;      // 当前题目记录
        let target = '';         // 当前题目的归一化答案
        let answered = false;    // 当前题是否已结束（答对或已显示答案）
        let wrongCounted = false;// 当前题是否已计过一次错误
        let sessionCorrect = 0;  // 本次练习答对数
        let pendingPlay = false; // 等待元数据加载后播放

        /** -------------------------------------------------
         *  数据
         * ------------------------------------------------- */
        function listRecords() {
            return Object.keys(pool)
                .map((key) => pool[key])
                .filter((rec) => rec && rec.en && rec.audio);
        }

        function savePool() {
            utils.saveDictationPool(pool);
        }

        function shuffle(list) {
            const arr = list.slice();
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                const tmp = arr[i];
                arr[i] = arr[j];
                arr[j] = tmp;
            }
            return arr;
        }

        /** 优先出「没答对过」的句子，其余随机补充 */
        function buildQueue() {
            const records = listRecords();
            const fresh = shuffle(records.filter((rec) => !rec.correctCount));
            const reviewed = shuffle(records.filter((rec) => rec.correctCount > 0));
            queue = fresh.concat(reviewed);
            queueTotal = queue.length;
            roundIndex = 0;
        }

        /** -------------------------------------------------
         *  视图
         * ------------------------------------------------- */
        function showView(view) {
            if (emptyEl) emptyEl.hidden = view !== 'empty';
            if (startEl) startEl.hidden = view !== 'start';
            if (practiceEl) practiceEl.hidden = view !== 'practice';
        }

        function renderStats() {
            if (!statsEl) return;
            const total = listRecords().length;
            const done = Math.min(roundIndex, queueTotal);
            statsEl.innerHTML = `题库 <b>${total}</b> 句 · 本轮 <b>${done}/${queueTotal}</b> · 本次答对 <b>${sessionCorrect}</b>`;
        }

        function setFeedback(stateName, message) {
            if (!inputEl || !feedbackEl) return;
            inputEl.classList.remove('is-correct', 'is-wrong');
            feedbackEl.classList.remove('is-correct', 'is-wrong');
            if (stateName) {
                inputEl.classList.add(stateName);
                feedbackEl.classList.add(stateName);
            }
            feedbackEl.textContent = message || '';
        }

        function commonPrefixLength(a, b) {
            const limit = Math.min(a.length, b.length);
            let i = 0;
            while (i < limit && a[i] === b[i]) {
                i += 1;
            }
            return i;
        }

        /** -------------------------------------------------
         *  播放
         * ------------------------------------------------- */
        function playCurrent() {
            if (!current || !audio) return;
            const src = current.audio;
            if (audio.dataset.src !== src) {
                audio.dataset.src = src;
                audio.src = src;
                pendingPlay = true;
                try {
                    audio.load();
                } catch (_) {
                    /* noop */
                }
                return;
            }
            seekAndPlay();
        }

        function seekAndPlay() {
            if (!current || !audio) return;
            try {
                audio.currentTime = Number(current.start) || 0;
            } catch (_) {
                /* noop */
            }
            const promise = audio.play();
            if (promise && typeof promise.catch === 'function') {
                promise.catch(() => {
                    /* 自动播放可能被浏览器拦截，用户点「播放 / 重听」即可 */
                });
            }
        }

        if (audio) {
            audio.addEventListener('loadedmetadata', () => {
                if (pendingPlay) {
                    pendingPlay = false;
                    seekAndPlay();
                }
            });
            // 播到该句结束时间就停下
            audio.addEventListener('timeupdate', () => {
                if (!current) return;
                const end = Number(current.end) || 0;
                const limit = end > 0 ? end : audio.duration;
                if (limit && audio.currentTime >= limit) {
                    audio.pause();
                }
            });
        }

        /** -------------------------------------------------
         *  出题与判定
         * ------------------------------------------------- */
        function nextQuestion() {
            if (!queue.length) {
                buildQueue();
                if (!queue.length) {
                    showView('empty');
                    return;
                }
            }
            current = queue.shift();
            roundIndex += 1;
            answered = false;
            wrongCounted = false;
            target = normalize(current.en);

            if (inputEl) {
                inputEl.value = '';
                inputEl.disabled = false;
            }
            if (revealEl) {
                revealEl.hidden = true;
                revealEl.textContent = '';
            }
            if (nextBtn) nextBtn.hidden = true;
            setFeedback(null, '');

            if (metaEl) metaEl.textContent = current.bookLabel || '';
            if (cnEl) {
                cnEl.textContent = current.cn || '';
                cnEl.hidden = !current.cn;
            }

            renderStats();
            playCurrent();

            // 桌面端自动聚焦输入框，方便直接打字
            if (inputEl && window.matchMedia && window.matchMedia('(min-width: 769px)').matches) {
                inputEl.focus();
            }
        }

        function markCorrect() {
            if (answered || !current) return;
            answered = true;
            current.correctCount = (current.correctCount || 0) + 1;
            current.lastResult = 'correct';
            savePool();
            sessionCorrect += 1;
            setFeedback('is-correct', '✓ 拼写正确！');
            if (inputEl) inputEl.disabled = true;
            if (audio) audio.pause();
            renderStats();
            setTimeout(nextQuestion, 900);
        }

        function countWrong() {
            if (wrongCounted || !current) return;
            wrongCounted = true;
            current.wrongCount = (current.wrongCount || 0) + 1;
            current.lastResult = 'wrong';
            savePool();
        }

        function evaluate() {
            if (answered || !current || !inputEl) return;
            const userInput = normalize(inputEl.value);
            if (userInput === target) {
                markCorrect();
                return;
            }
            if (!userInput) {
                setFeedback(null, '');
                return;
            }
            if (target.startsWith(userInput)) {
                setFeedback(null, '');
                return;
            }
            countWrong();
            const matched = commonPrefixLength(userInput, target);
            setFeedback('is-wrong', `✗ 拼写有误，已正确 ${matched}/${target.length} 个字母`);
        }

        function revealAnswer() {
            if (answered || !current) return;
            countWrong();
            answered = true;
            if (inputEl) inputEl.disabled = true;
            if (audio) audio.pause();
            setFeedback(null, '');
            if (revealEl) {
                revealEl.hidden = false;
                revealEl.textContent = `正确答案：${current.en}`;
            }
            if (nextBtn) nextBtn.hidden = false;
        }

        /** -------------------------------------------------
         *  从「最近播放」生成题库（回填）
         * ------------------------------------------------- */
        async function parseLrc(url) {
            const res = await fetch(url);
            if (!res.ok) {
                throw new Error(`LRC ${res.status}`);
            }
            const buffer = await res.arrayBuffer();
            let text = '';
            const encodings = ['utf-8', 'gbk', 'gb18030', 'big5'];
            for (const enc of encodings) {
                try {
                    const decoded = new TextDecoder(enc, { fatal: true }).decode(buffer);
                    if (decoded.includes('[') && /\d+:\d+/.test(decoded)) {
                        text = decoded;
                        break;
                    }
                } catch (_) {
                    /* 换下一种编码 */
                }
            }
            if (!text) {
                text = new TextDecoder('utf-8').decode(buffer);
            }

            const lines = text.split(/\r?\n/).filter(Boolean);
            const lineRe = /^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/;
            const timeRe = /\[(\d+):(\d+(?:\.\d+)?)\]/;
            const out = [];
            lines.forEach((raw, i) => {
                const m = raw.trim().match(lineRe);
                if (!m) return;
                // 不做整体偏移：字幕时间轴本身是准的，减 0.5 秒会让每句都从
                // 上一句的尾巴开始播，听写时会听到多余的音。（同 lesson.js）
                const start = parseInt(m[1], 10) * 60 + parseFloat(m[2]);
                const parts = (m[3] || '').split('|');
                const en = (parts[0] || '').trim();
                const cn = (parts[1] || '').trim();
                if (!en && !cn) return;
                let end = 0;
                for (let j = i + 1; j < lines.length; j += 1) {
                    const nxt = lines[j].match(timeRe);
                    if (nxt) {
                        end = parseInt(nxt[1], 10) * 60 + parseFloat(nxt[2]);
                        break;
                    }
                }
                out.push({ en, cn, start, end });
            });
            return out;
        }

        async function backfillFromHistory() {
            let history = [];
            try {
                history = JSON.parse(localStorage.getItem('ncePlaybackHistory') || '[]');
            } catch (_) {
                history = [];
            }
            const labels = ['一', '二', '三', '四'];
            const records = [];
            for (const entry of history) {
                if (!entry) continue;
                const isCustom = entry.bookType === 'custom' || entry.book === 'CUSTOM';
                if (isCustom) continue;
                const num = parseInt(entry.book, 10);
                const lesson = entry.lesson;
                if (!num || num < 1 || num > 4 || !lesson) continue;
                const bookToken = `NCE${num}`;
                const bookLabel = `第${labels[num - 1]}册`;
                try {
                    const data = await parseLrc(`${bookToken}/${lesson}.lrc`);
                    data.forEach((item, idx) => {
                        if (!item.en) return;
                        records.push({
                            key: `${bookToken}|${lesson}|${idx}`,
                            book: bookToken,
                            bookLabel,
                            lesson,
                            lessonTitle: entry.title || '',
                            idx,
                            start: item.start,
                            end: item.end,
                            en: item.en,
                            cn: item.cn,
                            audio: `${bookToken}/${lesson}.mp3`
                        });
                    });
                } catch (error) {
                    console.warn('Backfill failed for', lesson, error);
                }
            }
            return utils.upsertDictationSentences(records);
        }

        /** -------------------------------------------------
         *  事件绑定
         * ------------------------------------------------- */
        if (inputEl) {
            inputEl.addEventListener('input', evaluate);
            inputEl.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    evaluate();
                }
            });
        }
        if (replayBtn) replayBtn.addEventListener('click', playCurrent);
        if (showBtn) showBtn.addEventListener('click', revealAnswer);
        if (nextBtn) nextBtn.addEventListener('click', nextQuestion);
        if (skipBtn) {
            skipBtn.addEventListener('click', () => {
                // 还有其它题目时放回队尾，否则直接下一题，避免只剩一题时死循环
                if (current && queue.length > 0) {
                    queue.push(current);
                }
                nextQuestion();
            });
        }
        if (startBtn) {
            startBtn.addEventListener('click', () => {
                buildQueue();
                if (!queue.length) {
                    showView('empty');
                    return;
                }
                showView('practice');
                nextQuestion();
            });
        }
        if (backfillBtn) {
            backfillBtn.addEventListener('click', async () => {
                backfillBtn.disabled = true;
                if (backfillMsg) backfillMsg.textContent = '正在生成题库…';
                let added = 0;
                try {
                    added = await backfillFromHistory();
                } catch (error) {
                    console.warn('Backfill failed.', error);
                }
                pool = utils.loadDictationPool();
                backfillBtn.disabled = false;
                if (backfillMsg) {
                    backfillMsg.textContent = added > 0 ? `已生成 ${added} 句` : '没有可生成的句子';
                }
                if (added > 0) {
                    setTimeout(init, 600);
                }
            });
        }

        /** -------------------------------------------------
         *  学习时长统计
         *  仅在练习界面展示时计时，听音与输入都算学习状态。
         * ------------------------------------------------- */
        if (typeof utils.startStudyTimer === 'function') {
            utils.startStudyTimer({
                module: 'dictation',
                isEnabled: () => !!(practiceEl && !practiceEl.hidden),
                isEngaged: () => !!audio && !audio.paused && !audio.ended
            });
        }

        /** -------------------------------------------------
         *  初始化
         * ------------------------------------------------- */
        function init() {
            const total = listRecords().length;
            if (!total) {
                showView('empty');
                if (backfillBtn) {
                    let hasHistory = false;
                    try {
                        hasHistory = JSON.parse(localStorage.getItem('ncePlaybackHistory') || '[]').length > 0;
                    } catch (_) {
                        hasHistory = false;
                    }
                    backfillBtn.hidden = !hasHistory;
                }
                return;
            }
            if (startCountEl) {
                startCountEl.textContent = `题库已有 ${total} 句`;
            }
            showView('start');
        }

        init();
    });
})();
