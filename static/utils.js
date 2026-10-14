(() => {
    function hashString(input) {
        let hash = 0;
        const str = String(input || '');
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return hash;
    }

    /**
     * 转义 HTML 特殊字符，用于任何拼接进 innerHTML 的动态文本。
     * 官方 LRC 与自定义课程内容都视为不可信输入。
     * @param {*} value 待转义的值。
     * @returns {string} 可安全插入 HTML 的字符串。
     */
    function escapeHtml(value) {
        return String(value === null || value === undefined ? '' : value).replace(/[&<>'"]/g, (char) => {
            switch (char) {
                case '&':
                    return '&amp;';
                case '<':
                    return '&lt;';
                case '>':
                    return '&gt;';
                case '"':
                    return '&quot;';
                case '\'':
                    return '&#39;';
                default:
                    return char;
            }
        });
    }

    function escapeForSvg(value) {
        return String(value || '').replace(/[&<>'"]/g, (char) => {
            switch (char) {
                case '&':
                    return '&amp;';
                case '<':
                    return '&lt;';
                case '>':
                    return '&gt;';
                case '"':
                    return '&quot;';
                case '\'':
                    return '&#39;';
                default:
                    return char;
            }
        });
    }

    function createPlaceholderCover(label, options = {}) {
        const base = (label || '自定义').trim();
        const displayText = base ? base.slice(0, 4) : '自定义';
        const width = Number.isFinite(options.width) ? options.width : 200;
        const height = Number.isFinite(options.height) ? options.height : 200;
        const fontSize = Number.isFinite(options.fontSize) ? options.fontSize : Math.round(Math.min(width, height) * 0.24);
        const colors = ['#1DB954', '#4CAF50', '#2ECC71', '#27AE60', '#00BFA5'];
        const color = colors[Math.abs(hashString(base)) % colors.length];
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
            <defs>
                <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="${color}" stop-opacity="0.85"/>
                    <stop offset="100%" stop-color="${color}" stop-opacity="0.45"/>
                </linearGradient>
            </defs>
            <rect width="${width}" height="${height}" rx="${Math.round(Math.min(width, height) * 0.04)}" fill="url(#g)"/>
            <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="#FFFFFF"
                font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="${fontSize}">
                ${escapeForSvg(displayText)}
            </text>
        </svg>`;
        return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
    }

    function deriveLrcUrl(filename) {
        if (!filename) {
            return '';
        }
        const queryIndex = filename.indexOf('?');
        const hashIndex = filename.indexOf('#');
        let endIndex = filename.length;
        if (queryIndex !== -1) {
            endIndex = queryIndex;
        }
        if (hashIndex !== -1 && hashIndex < endIndex) {
            endIndex = hashIndex;
        }
        const base = filename.slice(0, endIndex);
        const suffix = filename.slice(endIndex);
        const dotIndex = base.lastIndexOf('.');
        const replaced = dotIndex === -1 ? `${base}.lrc` : `${base.slice(0, dotIndex)}.lrc`;
        return `${replaced}${suffix}`;
    }

    function parseCustomBookKey(rawKey) {
        const str = String(rawKey || '');
        const parts = str.split('|');
        const name = (parts.shift() || '自定义课程').trim() || '自定义课程';
        const cover = parts.length ? parts.join('|').trim() : '';
        return { raw: str, name, cover };
    }

    function loadStoredCustomData() {
        const stored = localStorage.getItem('nceCustomData');
        if (!stored) {
            return null;
        }
        try {
            const parsed = JSON.parse(stored);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
        } catch (_) {
            return null;
        }
    }

    function formatCustomData(data) {
        try {
            return JSON.stringify(data, null, 2);
        } catch (_) {
            return '';
        }
    }

    function sanitizeCustomDataInput(parsed) {
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('根对象必须是以书名为键的对象。');
        }
        const sanitized = {};
        Object.keys(parsed).forEach((bookName) => {
            const lessons = parsed[bookName];
            if (!Array.isArray(lessons)) {
                throw new Error(`“${bookName}” 的数据必须是数组。`);
            }
            sanitized[bookName] = lessons.map((lesson, index) => {
                if (!lesson || typeof lesson !== 'object' || Array.isArray(lesson)) {
                    throw new Error(`“${bookName}” 第 ${index + 1} 项必须是对象。`);
                }
                const title = lesson.title ? String(lesson.title).trim() : '';
                const filename = lesson.filename ? String(lesson.filename).trim() : '';
                if (!title || !filename) {
                    throw new Error(`“${bookName}” 第 ${index + 1} 项缺少 title 或 filename。`);
                }
                const sanitizedLesson = { title, filename };
                const lrc = lesson.lrc ? String(lesson.lrc).trim() : '';
                if (lrc) {
                    sanitizedLesson.lrc = lrc;
                }
                return sanitizedLesson;
            });
        });
        return sanitized;
    }

    function prepareCustomLessons(raw, options = {}) {
        const derive = options.deriveLrc !== false;
        const filterEmpty = options.filterEmpty !== false;
        const prepared = {};
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return prepared;
        }
        Object.keys(raw).forEach((bookName) => {
            const lessons = Array.isArray(raw[bookName]) ? raw[bookName] : [];
            const normalized = lessons
                .map((lesson) => {
                    if (!lesson || typeof lesson !== 'object' || Array.isArray(lesson)) {
                        return null;
                    }
                    const title = lesson.title ? String(lesson.title).trim() : '';
                    const filename = lesson.filename ? String(lesson.filename).trim() : '';
                    if (!title || !filename) {
                        return null;
                    }
                    const preparedLesson = { title, filename };
                    const lrc = lesson.lrc ? String(lesson.lrc).trim() : '';
                    preparedLesson.lrc = lrc || (derive ? deriveLrcUrl(filename) : '');
                    if (!preparedLesson.lrc) {
                        delete preparedLesson.lrc;
                    }
                    return preparedLesson;
                })
                .filter(Boolean);
            if (normalized.length || !filterEmpty) {
                prepared[bookName] = normalized;
            }
        });
        return prepared;
    }

    function getCustomLessonsWithDefaults() {
        const raw = loadStoredCustomData();
        return prepareCustomLessons(raw, { deriveLrc: true });
    }

    function normalizeShareOptions(rawOptions = {}) {
        const win = typeof window !== 'undefined' ? window : null;
        const doc = typeof document !== 'undefined' ? document : null;
        const baseUrl = rawOptions.url || (win && win.location ? win.location.href : '');
        let url = String(baseUrl || '').trim();
        if (url && win) {
            try {
                url = new URL(url, win.location.href).toString();
            } catch (_) {
                url = String(url);
            }
        }
        const titleSource = rawOptions.title || (doc ? doc.title : '');
        const descriptionSource = rawOptions.description || rawOptions.summary || '';
        const textSource = rawOptions.text || '';
        const imageSource = rawOptions.image || rawOptions.pic || '';
        return {
            url,
            title: String(titleSource || '').trim(),
            description: String(descriptionSource || '').trim(),
            text: String(textSource || '').trim(),
            image: String(imageSource || '').trim()
        };
    }

    function detectShareEnvironment() {
        const win = typeof window !== 'undefined' ? window : null;
        if (!win || typeof navigator === 'undefined') {
            return {
                isMobile: false,
                isWeChatBrowser: false
            };
        }
        const ua = navigator.userAgent || navigator.vendor || '';
        const isWeChatBrowser = /micromessenger/i.test(ua);
        const isMobile = /android|iphone|ipad|ipod|mobile/i.test(ua);
        return {
            isMobile,
            isWeChatBrowser
        };
    }

    function buildSharePayload(target, options = {}) {
        const normalizedTarget = String(target || '').toLowerCase();
        const { url, title, description, text, image } = normalizeShareOptions(options);
        const composedText = [text, title, description].filter(Boolean).join(' ') || url;
        const searchPic = options.searchPic === false ? '0' : '1';
        switch (normalizedTarget) {
            case 'weibo': {
                const params = new URLSearchParams();
                if (url) params.set('url', url);
                if (composedText) params.set('title', composedText);
                if (image) params.set('pic', image);
                params.set('searchPic', searchPic);
                return {
                    platform: 'weibo',
                    mode: 'popup',
                    url: `https://service.weibo.com/share/share.php?${params.toString()}`
                };
            }
            case 'qq': {
                const params = new URLSearchParams();
                if (url) params.set('url', url);
                if (title || text) params.set('title', title || text);
                if (description) params.set('summary', description);
                if (image) params.set('pics', image);
                return {
                    platform: 'qq',
                    mode: 'popup',
                    url: `https://connect.qq.com/widget/shareqq/index.html?${params.toString()}`
                };
            }
            case 'qzone': {
                const params = new URLSearchParams();
                if (url) params.set('url', url);
                if (title) params.set('title', title);
                if (description) params.set('desc', description);
                if (composedText) params.set('summary', composedText);
                if (image) params.set('pics', image);
                return {
                    platform: 'qzone',
                    mode: 'popup',
                    url: `https://sns.qzone.qq.com/cgi-bin/qzshare/cgi_qzshare_onekey?${params.toString()}`
                };
            }
            case 'wechat': {
                const env = detectShareEnvironment();
                if (env.isWeChatBrowser) {
                    return {
                        platform: 'wechat',
                        mode: 'wechat-internal',
                        url,
                        title: title || composedText,
                        text: composedText
                    };
                }
                const preferNative = env.isMobile && typeof navigator !== 'undefined' && typeof navigator.share === 'function';
                if (preferNative) {
                    return {
                        platform: 'wechat',
                        mode: 'native',
                        url,
                        title: title || composedText,
                        text: composedText
                    };
                }
                const sizeOption = Number.isFinite(options.qrSize) ? Math.round(options.qrSize) : 180;
                const size = Math.min(Math.max(sizeOption, 80), 512);
                const qrUrl = url ? `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}` : '';
                return {
                    platform: 'wechat',
                    mode: 'qr',
                    url,
                    qrImage: qrUrl,
                    title: title || composedText
                };
            }
            case 'native': {
                return {
                    platform: 'native',
                    mode: 'native',
                    url,
                    title: title || '',
                    text: composedText
                };
            }
            case 'copy': {
                return {
                    platform: 'copy',
                    mode: 'copy',
                    url,
                    text: composedText
                };
            }
            default:
                return {
                    platform: normalizedTarget || 'generic',
                    mode: 'link',
                    url,
                    title,
                    text: composedText,
                    description,
                    image
                };
        }
    }

    function openShare(target, options = {}) {
        const payload = buildSharePayload(target, options);
        if (!payload) {
            return null;
        }
        const win = typeof window !== 'undefined' ? window : null;
        if (payload.mode === 'popup' && payload.url && win) {
            const features = options.windowFeatures || 'width=600,height=540,top=100,left=100,toolbar=no,menubar=no,scrollbars=yes,resizable=yes';
            win.open(payload.url, '_blank', features);
        } else if (payload.mode === 'native' && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
            const shareData = {
                title: payload.title || options.title || '',
                text: payload.text || options.text || '',
                url: payload.url || options.url || ''
            };
            navigator.share(shareData).catch(() => {
                /* noop */
            });
        } else if (payload.mode === 'copy' && options.autoCopy !== false && typeof navigator !== 'undefined' && navigator.clipboard && payload.url) {
            navigator.clipboard.writeText(payload.url).catch(() => {
                /* noop */
            });
        }
        return payload;
    }



    /** -------------------------------------------------
     *  错题本（生词本）
     * ------------------------------------------------- */

    const WORD_BOOK_KEY = 'nceWordBook';
    const WORD_BOOK_LIMIT = 500;

    /**
     * 规范化单词：仅保留字母、连字符与撇号，转小写。
     * 含数字、尖括号等非字母字符的输入一律拒绝，避免把 HTML 片段
     * 或编号误存为生词。
     * @param {*} raw 原始输入。
     * @returns {string} 规范化后的单词，非法时返回空串。
     */
    function normalizeWord(raw) {
        const source = String(raw === null || raw === undefined ? '' : raw).trim();
        if (!source) {
            return '';
        }
        // 仅允许单个词：字母、撇号、连字符。含空格/数字/尖括号等一律拒绝，
        // 避免把多词选区、编号或 HTML 片段误存为生词。
        if (!/^[A-Za-z'\-]+$/.test(source)) {
            return '';
        }
        const cleaned = source
            .replace(/[^A-Za-z'\-]/g, '')
            .replace(/^['\-]+|['\-]+$/g, '')
            .toLowerCase();
        // 至少包含一个字母，且长度合理
        if (!/[a-z]/.test(cleaned) || cleaned.length > 48) {
            return '';
        }
        return cleaned;
    }

    /**
     * 读取错题本列表。任何异常都退化为空数组，避免阻塞页面。
     * @returns {Array<Object>} 生词条目数组。
     */
    function loadWordBook() {
        let stored = null;
        try {
            stored = localStorage.getItem(WORD_BOOK_KEY);
        } catch (error) {
            console.warn('Unable to read word book.', error);
            return [];
        }
        if (!stored) {
            return [];
        }
        try {
            const parsed = JSON.parse(stored);
            if (!Array.isArray(parsed)) {
                return [];
            }
            // 逐条净化，丢弃结构损坏的条目
            return parsed
                .map((item) => {
                    if (!item || typeof item !== 'object' || Array.isArray(item)) {
                        return null;
                    }
                    const word = normalizeWord(item.word);
                    if (!word) {
                        return null;
                    }
                    return {
                        word,
                        sentence: String(item.sentence || '').slice(0, 500),
                        translation: String(item.translation || '').slice(0, 500),
                        book: String(item.book || ''),
                        lesson: String(item.lesson || ''),
                        addedAt: Number.isFinite(item.addedAt) ? item.addedAt : Date.now(),
                        reviewCount: Number.isFinite(item.reviewCount) ? item.reviewCount : 0,
                        mastered: item.mastered === true
                    };
                })
                .filter(Boolean);
        } catch (error) {
            console.warn('Word book data is corrupted, resetting.', error);
            return [];
        }
    }

    /**
     * 写入错题本列表。
     * @param {Array<Object>} list 生词条目数组。
     * @returns {boolean} 写入成功返回 true。
     */
    function saveWordBook(list) {
        if (!Array.isArray(list)) {
            return false;
        }
        try {
            localStorage.setItem(WORD_BOOK_KEY, JSON.stringify(list.slice(0, WORD_BOOK_LIMIT)));
            return true;
        } catch (error) {
            console.warn('Unable to save word book.', error);
            return false;
        }
    }

    /**
     * 判断单词是否已在错题本中。
     * @param {string} word 单词。
     * @returns {boolean} 已存在返回 true。
     */
    function isWordInBook(word) {
        const target = normalizeWord(word);
        if (!target) {
            return false;
        }
        return loadWordBook().some((item) => item.word === target);
    }

    /**
     * 添加单词到错题本。同一单词只保留首次记录，重复添加仅累加复习次数。
     * @param {Object} entry 生词条目。
     * @returns {{added: boolean, word: string}} 添加结果。
     */
    function addWordToBook(entry) {
        const word = normalizeWord(entry && entry.word);
        if (!word) {
            return { added: false, word: '' };
        }
        const list = loadWordBook();
        const existing = list.find((item) => item.word === word);
        if (existing) {
            existing.reviewCount += 1;
            saveWordBook(list);
            return { added: false, word };
        }
        list.unshift({
            word,
            sentence: String((entry && entry.sentence) || '').slice(0, 500),
            translation: String((entry && entry.translation) || '').slice(0, 500),
            book: String((entry && entry.book) || ''),
            lesson: String((entry && entry.lesson) || ''),
            addedAt: Date.now(),
            reviewCount: 0,
            mastered: false
        });
        saveWordBook(list);
        return { added: true, word };
    }

    /**
     * 从错题本移除单词。
     * @param {string} word 单词。
     * @returns {boolean} 是否发生了删除。
     */
    function removeWordFromBook(word) {
        const target = normalizeWord(word);
        if (!target) {
            return false;
        }
        const list = loadWordBook();
        const next = list.filter((item) => item.word !== target);
        if (next.length === list.length) {
            return false;
        }
        saveWordBook(next);
        return true;
    }

    /**
     * 更新单词条目的部分字段（如复习次数、掌握状态）。
     * @param {string} word 单词。
     * @param {Object} patch 需要合并的字段。
     * @returns {boolean} 是否更新成功。
     */
    function updateWordInBook(word, patch) {
        const target = normalizeWord(word);
        if (!target || !patch || typeof patch !== 'object') {
            return false;
        }
        const list = loadWordBook();
        const item = list.find((entry) => entry.word === target);
        if (!item) {
            return false;
        }
        if (Number.isFinite(patch.reviewCount)) {
            item.reviewCount = patch.reviewCount;
        }
        if (typeof patch.mastered === 'boolean') {
            item.mastered = patch.mastered;
        }
        saveWordBook(list);
        return true;
    }

    /**
     * 清空错题本。
     * @returns {boolean} 是否清空成功。
     */
    function clearWordBook() {
        return saveWordBook([]);
    }

    /** -------------------------------------------------
     *  单词发音（浏览器内置 TTS）
     * ------------------------------------------------- */

    let cachedVoices = null;

    /**
     * 获取英文语音列表，优先选择美音。
     * @returns {SpeechSynthesisVoice|null} 可用语音。
     */
    function pickEnglishVoice() {
        if (typeof window === 'undefined' || !window.speechSynthesis) {
            return null;
        }
        const voices = cachedVoices || window.speechSynthesis.getVoices() || [];
        if (!voices.length) {
            return null;
        }
        cachedVoices = voices;
        const english = voices.filter((voice) => /^en(-|_|$)/i.test(voice.lang || ''));
        if (!english.length) {
            return null;
        }
        // 优先 en-US，其次任意英文语音
        return (
            english.find((voice) => /^en[-_]US$/i.test(voice.lang)) ||
            english.find((voice) => /^en[-_]GB$/i.test(voice.lang)) ||
            english[0]
        );
    }

    /**
     * 检测当前环境是否支持语音合成。
     * @returns {boolean} 支持返回 true。
     */
    function canSpeak() {
        return typeof window !== 'undefined' && !!window.speechSynthesis &&
            typeof window.SpeechSynthesisUtterance === 'function';
    }

    /**
     * 朗读单词。使用浏览器内置 TTS，无需网络。
     * @param {string} word 待朗读单词。
     * @param {Object} [options] 配置项。
     * @param {number} [options.rate] 语速，默认 0.9。
     * @returns {boolean} 是否成功发起朗读。
     */
    function speakWord(word, options = {}) {
        const text = String(word || '').trim();
        if (!text || !canSpeak()) {
            return false;
        }
        try {
            // 打断上一次朗读，避免快速连点造成排队
            window.speechSynthesis.cancel();
            const utterance = new window.SpeechSynthesisUtterance(text);
            const voice = pickEnglishVoice();
            if (voice) {
                utterance.voice = voice;
                utterance.lang = voice.lang;
            } else {
                utterance.lang = 'en-US';
            }
            const rate = Number.isFinite(options.rate) ? options.rate : 0.9;
            utterance.rate = Math.min(Math.max(rate, 0.5), 2);
            utterance.pitch = 1;
            window.speechSynthesis.speak(utterance);
            return true;
        } catch (error) {
            console.warn('Speech synthesis failed.', error);
            return false;
        }
    }

    /** -------------------------------------------------
     *  随机听写：题库（记录用户听过的句子）
     * ------------------------------------------------- */

    const DICTATION_POOL_KEY = 'nceDictationPool';
    const DICTATION_POOL_LIMIT = 3000;

    /**
     * 听写答案归一化：忽略大小写、空格与标点，并把全角转半角（NFKC）。
     * @param {*} value 原始文本。
     * @returns {string} 归一化后的字符串。
     */
    function normalizeAnswer(value) {
        return String(value === null || value === undefined ? '' : value)
            .normalize('NFKC')
            .replace(/[^a-zA-Z]/g, '')
            .toLowerCase();
    }

    /**
     * 读取听写题库。题库以「句子」为单位，键为 `book|lesson|idx`。
     * @returns {Object} 题库对象；任何异常都退化为空对象。
     */
    function loadDictationPool() {
        let stored = null;
        try {
            stored = localStorage.getItem(DICTATION_POOL_KEY);
        } catch (_) {
            return {};
        }
        if (!stored) {
            return {};
        }
        try {
            const parsed = JSON.parse(stored);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_) {
            return {};
        }
    }

    /**
     * 写入听写题库。
     * @param {Object} pool 题库对象。
     * @returns {boolean} 是否写入成功。
     */
    function saveDictationPool(pool) {
        if (!pool || typeof pool !== 'object' || Array.isArray(pool)) {
            return false;
        }
        try {
            localStorage.setItem(DICTATION_POOL_KEY, JSON.stringify(pool));
            return true;
        } catch (_) {
            return false;
        }
    }

    /**
     * 批量写入/更新「听过的句子」，保留已有的答题统计字段。
     * @param {Array<Object>} records 句子记录数组，每项必须含 key。
     * @returns {number} 新增的条数。
     */
    function upsertDictationSentences(records) {
        if (!Array.isArray(records) || !records.length) {
            return 0;
        }
        const pool = loadDictationPool();
        const now = Date.now();
        let added = 0;
        records.forEach((rec) => {
            if (!rec || !rec.key) {
                return;
            }
            const existing = pool[rec.key];
            if (existing) {
                existing.en = rec.en;
                existing.cn = rec.cn;
                existing.start = rec.start;
                existing.end = rec.end;
                existing.audio = rec.audio;
                if (rec.lessonTitle) existing.lessonTitle = rec.lessonTitle;
                if (rec.bookLabel) existing.bookLabel = rec.bookLabel;
                existing.lastHeardAt = now;
            } else {
                pool[rec.key] = Object.assign({}, rec, {
                    correctCount: 0,
                    wrongCount: 0,
                    firstHeardAt: now,
                    lastHeardAt: now
                });
                added += 1;
            }
        });
        // 超限时按最近听过时间裁剪最旧的数据
        const keys = Object.keys(pool);
        if (keys.length > DICTATION_POOL_LIMIT) {
            keys.sort((a, b) => (pool[a].lastHeardAt || 0) - (pool[b].lastHeardAt || 0));
            keys.slice(0, keys.length - DICTATION_POOL_LIMIT).forEach((key) => {
                delete pool[key];
            });
        }
        saveDictationPool(pool);
        return added;
    }

    const utils = {
        hashString,
        escapeForSvg,
        escapeHtml,
        createPlaceholderCover,
        deriveLrcUrl,
        parseCustomBookKey,
        loadStoredCustomData,
        formatCustomData,
        sanitizeCustomDataInput,
        prepareCustomLessons,
        getCustomLessonsWithDefaults,
        detectShareEnvironment,
        buildSharePayload,
        openShare,
        // 错题本（生词本）
        loadWordBook,
        saveWordBook,
        addWordToBook,
        removeWordFromBook,
        isWordInBook,
        updateWordInBook,
        clearWordBook,
        normalizeWord,
        speakWord,
        canSpeak,
        // 随机听写题库
        DICTATION_POOL_KEY,
        normalizeAnswer,
        loadDictationPool,
        saveDictationPool,
        upsertDictationSentences
    };

    if (typeof window !== 'undefined') {
        window.NCEUtils = Object.freeze(utils);
    }
})();
