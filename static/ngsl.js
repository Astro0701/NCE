/* ============================================================
   NGSL 核心词表 · 列表逻辑
   数据来自 static/ngsl-data.js：window.NCE_NGSL
   每条形如 [单词, 词频排名, 音标, 中文释义, 英文释义]

   功能：
   - 区间筛选 + 中英文搜索 + 分块渲染（滚动加载）
   - 显示模式：中英 / 英文 / 中文（与 lesson.html 行为一致，存 localStorage）
   - 听写模式：看中文写英文，实时校验，答错显示答案
   ============================================================ */

(function () {
    'use strict';

    var PAYLOAD = window.NCE_NGSL || null;
    if (!PAYLOAD || !Array.isArray(PAYLOAD.words) || !PAYLOAD.words.length) {
        return;
    }

    var ALL = PAYLOAD.words;
    var TOTAL = ALL.length;

    /** 每次渲染的条数（2809 条一次性插入会卡，分块追加） */
    var CHUNK = 200;

    /** 显示模式持久化键（与 lesson.html 的 displayMode 分开，互不影响） */
    var DISPLAY_MODE_KEY = 'ngslDisplayMode';

    var listEl = document.getElementById('ngsl-list');
    var summaryEl = document.getElementById('ngsl-summary');
    var hintEl = document.getElementById('ngsl-hint');
    var emptyEl = document.getElementById('ngsl-empty');
    var searchEl = document.getElementById('ngsl-search');
    var tabsEl = document.getElementById('ngsl-tabs');
    var modesEl = document.getElementById('ngsl-modes');
    var dictationEl = document.getElementById('ngsl-dictation');
    var sentinelEl = document.getElementById('ngsl-sentinel');

    /** 当前状态 */
    var state = {
        range: 'all',
        query: '',
        filtered: ALL,
        rendered: 0,
        displayMode: 'bilingual-mode',
        dictation: false
    };

    /** 已答对的词条（按 rank 记），切模式后保留 */
    var solved = new Set();

    var observer = null;

    /* ---------------- 显示模式 ---------------- */

    function loadDisplayMode() {
        var saved = null;
        try {
            saved = localStorage.getItem(DISPLAY_MODE_KEY);
        } catch (e) {
            saved = null;
        }
        var allowed = ['bilingual-mode', 'en-mode', 'cn-mode'];
        if (saved && allowed.indexOf(saved) !== -1) {
            state.displayMode = saved;
        }
    }

    function applyDisplayMode(mode) {
        if (!mode) return;
        state.displayMode = mode;
        listEl.classList.remove('bilingual-mode', 'en-mode', 'cn-mode');
        listEl.classList.add(mode);

        if (modesEl) {
            var btns = modesEl.querySelectorAll('button[data-mode]');
            for (var i = 0; i < btns.length; i++) {
                btns[i].classList.toggle('active', btns[i].getAttribute('data-mode') === mode);
            }
        }
        try {
            localStorage.setItem(DISPLAY_MODE_KEY, mode);
        } catch (e) {
            /* 忽略写入失败（隐私模式等） */
        }
        updateHint();
    }

    function updateHint() {
        if (!hintEl) return;
        if (state.dictation) {
            hintEl.textContent = '看中文写英文，点输入框可听发音';
        } else if (state.displayMode === 'cn-mode') {
            hintEl.textContent = '只显示中文，试着回想英文单词，点任意词条听发音';
        } else if (state.displayMode === 'en-mode') {
            hintEl.textContent = '点击任意单词即可朗读';
        } else {
            hintEl.textContent = '点击任意单词即可朗读';
        }
    }

    /* ---------------- 发音 ---------------- */

    function speak(text, rowEl) {
        if (!window.NCEUtils || typeof window.NCEUtils.speakWord !== 'function') {
            return;
        }
        if (rowEl) {
            rowEl.classList.add('is-speaking');
            window.setTimeout(function () {
                rowEl.classList.remove('is-speaking');
            }, 700);
        }
        window.NCEUtils.speakWord(text, { rate: 0.9 });
    }

    /* ---------------- 过滤与渲染 ---------------- */

    function parseRange(range) {
        if (!range || range === 'all') return [1, TOTAL];
        var parts = range.split('-');
        var lo = parseInt(parts[0], 10);
        var hi = parseInt(parts[1], 10);
        if (!isFinite(lo)) lo = 1;
        if (!isFinite(hi)) hi = TOTAL;
        return [lo, hi];
    }

    function applyFilter() {
        var bounds = parseRange(state.range);
        var q = state.query.trim().toLowerCase();
        var out = [];

        for (var i = 0; i < ALL.length; i++) {
            var item = ALL[i];
            var rank = item[1];
            if (rank < bounds[0] || rank > bounds[1]) continue;
            if (q) {
                var word = String(item[0] || '').toLowerCase();
                var zh = String(item[3] || '');
                if (word.indexOf(q) === -1 && zh.indexOf(q) === -1) continue;
            }
            out.push(item);
        }

        // 有关键词时按匹配优先级排序：前缀命中 → 包含命中
        if (q) {
            out.sort(function (a, b) {
                var aw = String(a[0]).toLowerCase();
                var bw = String(b[0]).toLowerCase();
                var ap = aw.indexOf(q) === 0 ? 0 : 1;
                var bp = bw.indexOf(q) === 0 ? 0 : 1;
                if (ap !== bp) return ap - bp;
                return a[1] - b[1];
            });
        }

        state.filtered = out;
        state.rendered = 0;
        listEl.innerHTML = '';
        updateSummary();
        renderChunk();
        setupObserver();
    }

    function updateSummary() {
        var bounds = parseRange(state.range);
        var n = state.filtered.length;
        var label = state.range === 'all'
            ? '全部 ' + TOTAL + ' 词'
            : '第 ' + bounds[0] + '–' + bounds[1] + ' 词';
        var text = label + ' · 共 ' + n + ' 条';
        if (state.query) {
            text += ' · 关键词「' + state.query + '」';
        }
        if (state.dictation) {
            text += ' · 已答对 ' + solved.size;
        }
        summaryEl.textContent = text;
        emptyEl.hidden = n !== 0;
    }

    /** 答案比对：忽略大小写、空格与标点，只比字母 */
    function normalizeAnswer(value) {
        return String(value || '')
            .normalize('NFKC')
            .replace(/[^a-zA-Z]/g, '')
            .toLowerCase();
    }

    /** 创建普通词条（非听写） */
    function createNormalItem(item) {
        var word = item[0];
        var rank = item[1];
        var ipa = item[2];
        var zh = item[3];

        var row = document.createElement('div');
        row.className = 'ngsl-item';
        row.setAttribute('role', 'listitem');
        row.setAttribute('tabindex', '0');
        row.setAttribute('aria-label', word + ' ' + ipa + ' ' + zh);

        var rankEl = document.createElement('span');
        rankEl.className = 'ngsl-item__rank';
        rankEl.textContent = rank;

        var wordEl = document.createElement('span');
        wordEl.className = 'ngsl-item__word';
        wordEl.textContent = word;

        var ipaEl = document.createElement('span');
        ipaEl.className = 'ngsl-item__ipa';
        ipaEl.textContent = ipa;

        var zhEl = document.createElement('span');
        zhEl.className = 'ngsl-item__zh';
        zhEl.textContent = zh;

        var speakEl = document.createElement('span');
        speakEl.className = 'ngsl-item__speak';
        speakEl.textContent = '🔊';

        row.appendChild(rankEl);
        row.appendChild(wordEl);
        row.appendChild(ipaEl);
        row.appendChild(zhEl);
        row.appendChild(speakEl);

        function play() {
            speak(word, row);
        }
        row.addEventListener('click', play);
        row.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                play();
            }
        });

        return row;
    }

    /** 创建听写词条：中文 + 输入框 */
    function createDictationItem(item) {
        var word = item[0];
        var rank = item[1];
        var ipa = item[2];
        var zh = item[3];

        var row = document.createElement('div');
        row.className = 'ngsl-item ngsl-item--dictation';
        row.setAttribute('role', 'listitem');

        var rankEl = document.createElement('span');
        rankEl.className = 'ngsl-item__rank';
        rankEl.textContent = rank;

        var zhEl = document.createElement('span');
        zhEl.className = 'ngsl-item__zh';
        zhEl.textContent = zh;

        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'ngsl-dict-input';
        input.placeholder = '输入英文单词…';
        input.autocomplete = 'off';
        input.autocapitalize = 'off';
        input.spellcheck = false;
        input.setAttribute('aria-label', '请输入「' + zh + '」对应的英文单词');

        var speakEl = document.createElement('span');
        speakEl.className = 'ngsl-item__speak';
        speakEl.textContent = '🔊';
        speakEl.style.opacity = '1';
        speakEl.setAttribute('role', 'button');
        speakEl.setAttribute('tabindex', '0');
        speakEl.setAttribute('aria-label', '朗读该单词');

        var answerEl = document.createElement('span');
        answerEl.className = 'ngsl-dict-answer';

        row.appendChild(rankEl);
        row.appendChild(zhEl);
        row.appendChild(input);
        row.appendChild(speakEl);
        row.appendChild(answerEl);

        var answer = normalizeAnswer(word);

        // 已答对过的直接回填并标绿
        if (solved.has(rank)) {
            input.value = word;
            input.classList.add('is-correct');
            input.readOnly = true;
        }

        function play() {
            speak(word, row);
        }

        speakEl.addEventListener('click', function (e) {
            e.stopPropagation();
            play();
        });
        speakEl.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                play();
            }
        });

        // 聚焦即朗读（已答对的不再读）
        input.addEventListener('focus', function () {
            if (!solved.has(rank)) play();
        });

        input.addEventListener('input', function () {
            if (solved.has(rank)) return;
            var val = normalizeAnswer(input.value);
            input.classList.remove('is-correct', 'is-wrong');
            answerEl.classList.remove('is-visible');

            if (!val) return;

            if (val === answer) {
                input.classList.add('is-correct');
                input.readOnly = true;
                solved.add(rank);
                updateSummary();
                // 自动跳到下一个未答对的输入框
                window.setTimeout(function () {
                    var next = row.nextElementSibling;
                    while (next && !next.querySelector('.ngsl-dict-input')) {
                        next = next.nextElementSibling;
                    }
                    if (next) {
                        var ni = next.querySelector('.ngsl-dict-input');
                        if (ni && !ni.readOnly) ni.focus();
                    }
                }, 220);
            } else if (answer.indexOf(val) !== 0) {
                // 已经不是正确答案的前缀 → 判错
                input.classList.add('is-wrong');
                answerEl.textContent = '正确答案：' + word;
                answerEl.classList.add('is-visible');
            }
        });

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !input.readOnly) {
                var val = normalizeAnswer(input.value);
                if (val && val !== answer) {
                    input.classList.add('is-wrong');
                    answerEl.textContent = '正确答案：' + word;
                    answerEl.classList.add('is-visible');
                }
            }
        });

        return row;
    }

    function createItem(item) {
        return state.dictation ? createDictationItem(item) : createNormalItem(item);
    }

    function renderChunk() {
        var total = state.filtered.length;
        if (state.rendered >= total) {
            return;
        }

        var end = Math.min(state.rendered + CHUNK, total);
        var frag = document.createDocumentFragment();
        for (var i = state.rendered; i < end; i++) {
            frag.appendChild(createItem(state.filtered[i]));
        }
        listEl.appendChild(frag);
        state.rendered = end;
    }

    function setupObserver() {
        if (!('IntersectionObserver' in window)) {
            while (state.rendered < state.filtered.length) renderChunk();
            return;
        }
        // 每次重新过滤都要重建观察器：若上次结果很少（比如只命中 1 条），
        // 观察器可能已被回收，必须重新 observe，否则后续滚动不再加载。
        if (observer) observer.disconnect();
        observer = new IntersectionObserver(function (entries) {
            for (var i = 0; i < entries.length; i++) {
                if (entries[i].isIntersecting) renderChunk();
            }
        }, { rootMargin: '600px 0px' });
        observer.observe(sentinelEl);
    }

    /* ---------------- 事件绑定 ---------------- */

    if (tabsEl) {
        tabsEl.addEventListener('click', function (e) {
            var btn = e.target.closest('button[data-range]');
            if (!btn) return;
            var buttons = tabsEl.querySelectorAll('button');
            for (var i = 0; i < buttons.length; i++) {
                buttons[i].classList.remove('active');
            }
            btn.classList.add('active');
            state.range = btn.getAttribute('data-range');
            applyFilter();
        });
    }

    if (modesEl) {
        modesEl.addEventListener('click', function (e) {
            var btn = e.target.closest('button[data-mode]');
            if (!btn) return;
            applyDisplayMode(btn.getAttribute('data-mode'));
        });
    }

    if (dictationEl) {
        dictationEl.addEventListener('change', function () {
            state.dictation = dictationEl.checked;
            listEl.classList.toggle('is-dictation', state.dictation);
            updateHint();
            applyFilter();
        });
    }

    if (searchEl) {
        var timer = null;
        searchEl.addEventListener('input', function () {
            window.clearTimeout(timer);
            timer = window.setTimeout(function () {
                state.query = searchEl.value || '';
                applyFilter();
            }, 160);
        });
    }

    /* ---------------- 初始化 ---------------- */

    loadDisplayMode();
    applyDisplayMode(state.displayMode);
    applyFilter();
})();
