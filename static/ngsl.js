/* ============================================================
   NGSL 核心词表 · 列表逻辑
   数据来自 static/ngsl-data.js：window.NCE_NGSL
   每条形如 [单词, 词频排名, 音标, 中文释义, 英文释义]
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

    var listEl = document.getElementById('ngsl-list');
    var summaryEl = document.getElementById('ngsl-summary');
    var emptyEl = document.getElementById('ngsl-empty');
    var searchEl = document.getElementById('ngsl-search');
    var tabsEl = document.getElementById('ngsl-tabs');
    var sentinelEl = document.getElementById('ngsl-sentinel');

    /** 当前状态 */
    var state = {
        range: 'all',
        query: '',
        filtered: ALL,
        rendered: 0
    };

    var observer = null;

    /** 解析区间 "501-1000" → [501, 1000] */
    function parseRange(range) {
        if (!range || range === 'all') return [1, TOTAL];
        var parts = range.split('-');
        var lo = parseInt(parts[0], 10);
        var hi = parseInt(parts[1], 10);
        if (!isFinite(lo)) lo = 1;
        if (!isFinite(hi)) hi = TOTAL;
        return [lo, hi];
    }

    /** 按区间 + 关键词过滤 */
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

    /** 更新摘要文字 */
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
        summaryEl.textContent = text;
        emptyEl.hidden = n !== 0;
    }

    /** 创建一条词条 DOM */
    function createItem(item) {
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

        function speak() {
            if (!window.NCEUtils || typeof window.NCEUtils.speakWord !== 'function') {
                return;
            }
            row.classList.add('is-speaking');
            window.setTimeout(function () {
                row.classList.remove('is-speaking');
            }, 700);
            window.NCEUtils.speakWord(word, { rate: 0.9 });
        }

        row.addEventListener('click', speak);
        row.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                speak();
            }
        });

        return row;
    }

    /** 追加渲染一块 */
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

    /** 滚动到底部继续加载 */
    function setupObserver() {
        if (!('IntersectionObserver' in window)) {
            // 不支持时一次性渲染
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

    /** 区间切换 */
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

    /** 搜索（防抖） */
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

    // 初始化（applyFilter 内部会调用 setupObserver）
    applyFilter();
})();
