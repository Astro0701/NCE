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
     * 把词表里的写法转成 TTS 能稳定读对的文本。
     *
     * 引擎对「孤立的大写单字母」会走字母名逻辑：`I` 容易被读成 /ɪ/ 或字母名列表音，
     * `A` 容易被读成 /eɪ/，而不是词表音标里的 /aɪ/、/ə/。
     * 用音标反查一张小表给出等价的拼写形式，让引擎按普通单词朗读，读音才与页面音标一致。
     * @param {string} text 词表里的原始写法。
     * @returns {string} 适合朗读的文本。
     */
    const SPEAK_OVERRIDES = {
        'a': 'a',        // /ə/ 冠词，小写时引擎读弱读形式
        'i': 'eye',      // /aɪ/ 代词，拼作 eye 保证读 /aɪ/
        'true': 'true',
        'false': 'false'
    };

    function toSpeakable(text) {
        const key = String(text || '').trim().toLowerCase();
        if (Object.prototype.hasOwnProperty.call(SPEAK_OVERRIDES, key)) {
            return SPEAK_OVERRIDES[key];
        }
        return String(text || '').trim();
    }

    /**
     * 朗读单词。使用浏览器内置 TTS，无需网络。
     * @param {string} word 待朗读单词。
     * @param {Object} [options] 配置项。
     * @param {number} [options.rate] 语速，默认 0.9。
     * @returns {boolean} 是否成功发起朗读。
     */
    function speakWord(word, options = {}) {
        const text = toSpeakable(word);
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

    /** -------------------------------------------------
     *  学习时长统计
     *  仅在页面可见且用户活跃（或音频播放中）时累计，
     *  按「天 + 模块」记录，数据保存在 localStorage。
     * ------------------------------------------------- */

    const STUDY_TIME_KEY = 'nceStudyTime';
    const STUDY_TIME_VERSION = 1;
    const STUDY_DAY_LIMIT = 400;

    /**
     * 本地时区日期键（YYYY-MM-DD）。
     * 使用 Object.prototype.toString 判断日期，兼容跨 realm（iframe）传入的 Date。
     * @param {Date} [date] 日期对象，默认当前时间。
     * @returns {string} 日期键。
     */
    function getStudyDayKey(date) {
        const isDate = date && Object.prototype.toString.call(date) === '[object Date]';
        const d = isDate && !Number.isNaN(date.getTime()) ? date : new Date();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${d.getFullYear()}-${month}-${day}`;
    }

    function createEmptyStudyTime() {
        return { version: STUDY_TIME_VERSION, days: {}, updatedAt: 0 };
    }

    /**
     * 净化单日记录：仅保留合法模块名与非负整数秒数。
     * @param {*} raw 原始单日记录。
     * @returns {Object} 净化后的记录。
     */
    function sanitizeStudyEntry(raw) {
        const entry = {};
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return entry;
        }
        Object.keys(raw).forEach((mod) => {
            if (!/^[A-Za-z0-9_-]{1,24}$/.test(mod)) {
                return;
            }
            const seconds = Math.floor(Number(raw[mod]));
            if (Number.isFinite(seconds) && seconds > 0) {
                entry[mod] = seconds;
            }
        });
        return entry;
    }

    function sumStudyEntry(entry) {
        if (!entry || typeof entry !== 'object') {
            return 0;
        }
        return Object.keys(entry).reduce((acc, mod) => acc + (Number(entry[mod]) || 0), 0);
    }

    /**
     * 读取学习时长数据。任何异常都退化为空数据，避免阻塞页面。
     * @returns {{version: number, days: Object, updatedAt: number}} 学习时长数据。
     */
    function loadStudyTime() {
        let stored = null;
        try {
            stored = localStorage.getItem(STUDY_TIME_KEY);
        } catch (_) {
            return createEmptyStudyTime();
        }
        if (!stored) {
            return createEmptyStudyTime();
        }
        try {
            const parsed = JSON.parse(stored);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return createEmptyStudyTime();
            }
            const sourceDays = parsed.days && typeof parsed.days === 'object' && !Array.isArray(parsed.days)
                ? parsed.days
                : {};
            const days = {};
            Object.keys(sourceDays).forEach((key) => {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
                    return;
                }
                const entry = sanitizeStudyEntry(sourceDays[key]);
                if (sumStudyEntry(entry) > 0) {
                    days[key] = entry;
                }
            });
            // 超限时丢弃最旧的数据（YYYY-MM-DD 可直接按字典序排序）
            const keys = Object.keys(days).sort();
            if (keys.length > STUDY_DAY_LIMIT) {
                keys.slice(0, keys.length - STUDY_DAY_LIMIT).forEach((key) => {
                    delete days[key];
                });
            }
            return {
                version: STUDY_TIME_VERSION,
                days,
                updatedAt: Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : 0
            };
        } catch (_) {
            return createEmptyStudyTime();
        }
    }

    /**
     * 写入学习时长数据。
     * @param {Object} data 学习时长数据。
     * @returns {boolean} 是否写入成功。
     */
    function saveStudyTime(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            return false;
        }
        try {
            localStorage.setItem(STUDY_TIME_KEY, JSON.stringify(data));
            return true;
        } catch (_) {
            return false;
        }
    }

    /**
     * 累加学习时长（秒）。采用「读取-合并-写回」，多标签页同时学习也不会互相覆盖。
     * @param {number} seconds 本次累计的秒数。
     * @param {string} moduleName 模块名，如 lesson / dictation。
     * @returns {boolean} 是否写入成功。
     */
    function addStudyTime(seconds, moduleName) {
        const secs = Math.round(Number(seconds));
        if (!Number.isFinite(secs) || secs <= 0) {
            return false;
        }
        const mod = String(moduleName || 'study').slice(0, 24) || 'study';
        const data = loadStudyTime();
        const dayKey = getStudyDayKey();
        if (!data.days[dayKey]) {
            data.days[dayKey] = {};
        }
        data.days[dayKey][mod] = (data.days[dayKey][mod] || 0) + secs;
        data.updatedAt = Date.now();
        return saveStudyTime(data);
    }

    /**
     * 汇总学习统计数据。
     * @returns {{today: number, todayByModule: Object, total: number, streak: number, studiedDays: number, last7: Array, updatedAt: number}} 统计数据。
     */
    function getStudyStats() {
        const data = loadStudyTime();
        const days = data.days;
        const todayEntry = days[getStudyDayKey()] || {};

        let total = 0;
        Object.keys(days).forEach((key) => {
            total += sumStudyEntry(days[key]);
        });

        // 连续学习天数：今天有学习则从今天起算，否则从昨天起算（今天还没学不算断）
        let streak = 0;
        const cursor = new Date();
        if (sumStudyEntry(days[getStudyDayKey(cursor)]) <= 0) {
            cursor.setDate(cursor.getDate() - 1);
        }
        while (sumStudyEntry(days[getStudyDayKey(cursor)]) > 0) {
            streak += 1;
            cursor.setDate(cursor.getDate() - 1);
        }

        const last7 = [];
        for (let offset = 6; offset >= 0; offset -= 1) {
            const date = new Date();
            date.setDate(date.getDate() - offset);
            const key = getStudyDayKey(date);
            const entry = days[key] || {};
            last7.push({
                date: key,
                weekday: date.getDay(),
                total: sumStudyEntry(entry),
                lesson: Math.floor(Number(entry.lesson)) || 0,
                dictation: Math.floor(Number(entry.dictation)) || 0
            });
        }

        return {
            today: sumStudyEntry(todayEntry),
            todayByModule: Object.assign({}, todayEntry),
            total,
            streak,
            studiedDays: Object.keys(days).length,
            last7,
            updatedAt: data.updatedAt
        };
    }

    /**
     * 格式化学习时长。
     * @param {number} seconds 秒数。
     * @returns {string} 形如「30 秒」「25 分钟」「1 小时 30 分」。
     */
    function formatStudyDuration(seconds) {
        const secs = Math.max(0, Math.floor(Number(seconds) || 0));
        if (secs <= 0) {
            return '0 分钟';
        }
        if (secs < 60) {
            return `${secs} 秒`;
        }
        const minutes = Math.floor(secs / 60);
        if (minutes < 60) {
            return `${minutes} 分钟`;
        }
        const hours = Math.floor(minutes / 60);
        const rest = minutes % 60;
        return rest > 0 ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
    }

    /**
     * 启动学习时长追踪器。
     * 计时条件：页面可见，且用户近期有交互（或 isEngaged 返回 true，如音频播放中）；
     * 空闲超过 idleTimeout 暂停计时，长时间无交互后即使处于播放状态也停止计时。
     * @param {Object} [options] 配置项。
     * @param {string} [options.module] 模块名，如 lesson / dictation。
     * @param {number} [options.tickInterval] 心跳间隔（毫秒，最小 5000，默认 15000）。
     * @param {number} [options.idleTimeout] 空闲判定阈值（毫秒，默认 3 分钟）。
     * @param {number} [options.engagementGraceTimeout] 无交互仍持续计时的上限（毫秒，默认 30 分钟）。
     * @param {Function} [options.isEngaged] 返回 true 表示处于持续学习状态（如音频播放中）。
     * @param {Function} [options.isEnabled] 返回 false 时暂停计时（如听写未开始）。
     * @returns {{stop: Function, flush: Function, getPending: Function}} 控制器。
     */
    function startStudyTimer(options = {}) {
        const win = typeof window !== 'undefined' ? window : null;
        const doc = typeof document !== 'undefined' ? document : null;
        if (!win || !doc) {
            return { stop() {}, flush() {}, getPending() { return 0; } };
        }

        const moduleName = String(options.module || 'study').slice(0, 24) || 'study';
        const tickInterval = Math.max(5000, Number(options.tickInterval) || 15000);
        const idleTimeout = Math.max(30000, Number(options.idleTimeout) || 3 * 60 * 1000);
        const engagementGrace = Math.max(idleTimeout, Number(options.engagementGraceTimeout) || 30 * 60 * 1000);
        const isEngaged = typeof options.isEngaged === 'function' ? options.isEngaged : null;
        const isEnabled = typeof options.isEnabled === 'function' ? options.isEnabled : null;
        const FLUSH_THRESHOLD = 20; // 秒：攒够 20 秒写一次 localStorage，减少写入频率

        let lastTick = Date.now();
        let lastActivity = Date.now();
        let pending = 0;
        let stopped = false;

        function markActivity() {
            lastActivity = Date.now();
        }

        const activityEvents = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'wheel', 'touchstart'];
        activityEvents.forEach((type) => {
            win.addEventListener(type, markActivity, { passive: true, capture: true });
        });

        function flush() {
            if (pending <= 0) {
                return;
            }
            const seconds = Math.round(pending);
            if (seconds <= 0) {
                pending = 0;
                return;
            }
            try {
                if (addStudyTime(seconds, moduleName)) {
                    pending = 0;
                }
            } catch (_) {
                /* 写入失败时保留 pending，下次再试 */
            }
        }

        function accumulate(now, accumulateOptions) {
            const ignoreHidden = !!(accumulateOptions && accumulateOptions.ignoreHidden);
            const delta = Math.min((now - lastTick) / 1000, 60);
            lastTick = now;
            if (stopped || delta <= 0) {
                return;
            }
            if (!ignoreHidden && doc.hidden) {
                return;
            }
            if (isEnabled && !isEnabled()) {
                return;
            }
            const interactedRecently = (now - lastActivity) < idleTimeout;
            const engaged = isEngaged ? !!isEngaged() : false;
            const longIdle = (now - lastActivity) > engagementGrace;
            if (!interactedRecently && !(engaged && !longIdle)) {
                return;
            }
            pending += delta;
            if (pending >= FLUSH_THRESHOLD) {
                flush();
            }
        }

        function tick() {
            accumulate(Date.now());
        }

        function handleVisibilityChange() {
            if (doc.hidden) {
                // 隐藏前把这段可见时间结清
                accumulate(Date.now(), { ignoreHidden: true });
                flush();
            } else {
                lastTick = Date.now();
                lastActivity = Date.now();
            }
        }

        const timer = win.setInterval(tick, tickInterval);
        doc.addEventListener('visibilitychange', handleVisibilityChange);
        win.addEventListener('pagehide', flush);
        win.addEventListener('beforeunload', flush);

        function stop() {
            if (stopped) {
                return;
            }
            accumulate(Date.now(), { ignoreHidden: true });
            flush();
            stopped = true;
            win.clearInterval(timer);
            activityEvents.forEach((type) => {
                win.removeEventListener(type, markActivity, { capture: true });
            });
            doc.removeEventListener('visibilitychange', handleVisibilityChange);
            win.removeEventListener('pagehide', flush);
            win.removeEventListener('beforeunload', flush);
        }

        return { stop, flush, getPending: () => pending };
    }

    /** -------------------------------------------------
     *  课程学习次数统计
     *  记录每一课被学习的次数：打开课程页并实际播放音频记一次，
     *  按「课本 + 课时」存储，数据保存在 localStorage。
     * ------------------------------------------------- */

    const LESSON_STUDY_KEY = 'nceLessonStudyCount';
    const LESSON_STUDY_VERSION = 1;
    const LESSON_STUDY_LIMIT = 1000;

    function createEmptyLessonStudy() {
        return { version: LESSON_STUDY_VERSION, books: {}, updatedAt: 0 };
    }

    /**
     * 净化课本 / 课时标识，空值或超长（异常数据）返回空串。
     * @param {*} key 原始标识。
     * @returns {string} 净化后的标识。
     */
    function sanitizeLessonStudyKey(key) {
        const str = String(key == null ? '' : key).trim();
        if (!str || str.length > 300) {
            return '';
        }
        return str;
    }

    /**
     * 读取学习次数数据。任何异常都退化为空数据，避免阻塞页面。
     * @returns {{version: number, books: Object, updatedAt: number}} 学习次数数据。
     */
    function loadLessonStudy() {
        let stored = null;
        try {
            stored = localStorage.getItem(LESSON_STUDY_KEY);
        } catch (_) {
            return createEmptyLessonStudy();
        }
        if (!stored) {
            return createEmptyLessonStudy();
        }
        try {
            const parsed = JSON.parse(stored);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return createEmptyLessonStudy();
            }
            const sourceBooks = parsed.books && typeof parsed.books === 'object' && !Array.isArray(parsed.books)
                ? parsed.books
                : {};
            const books = {};
            const entries = [];
            Object.keys(sourceBooks).forEach((bookKey) => {
                const book = sanitizeLessonStudyKey(bookKey);
                const sourceLessons = sourceBooks[bookKey];
                if (!book || !sourceLessons || typeof sourceLessons !== 'object' || Array.isArray(sourceLessons)) {
                    return;
                }
                const lessons = {};
                Object.keys(sourceLessons).forEach((lessonKey) => {
                    const lesson = sanitizeLessonStudyKey(lessonKey);
                    const raw = sourceLessons[lessonKey];
                    if (!lesson || !raw || typeof raw !== 'object' || Array.isArray(raw)) {
                        return;
                    }
                    const count = Math.floor(Number(raw.count));
                    if (!Number.isFinite(count) || count <= 0) {
                        return;
                    }
                    const lastAt = Math.floor(Number(raw.lastAt));
                    lessons[lesson] = { count, lastAt: Number.isFinite(lastAt) ? lastAt : 0 };
                    entries.push({ book, lesson, lastAt: lessons[lesson].lastAt });
                });
                if (Object.keys(lessons).length) {
                    books[book] = lessons;
                }
            });
            // 超限时丢弃最久未学习的课程
            if (entries.length > LESSON_STUDY_LIMIT) {
                entries.sort((a, b) => a.lastAt - b.lastAt);
                entries.slice(0, entries.length - LESSON_STUDY_LIMIT).forEach(({ book, lesson }) => {
                    if (books[book]) {
                        delete books[book][lesson];
                        if (!Object.keys(books[book]).length) {
                            delete books[book];
                        }
                    }
                });
            }
            return {
                version: LESSON_STUDY_VERSION,
                books,
                updatedAt: Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : 0
            };
        } catch (_) {
            return createEmptyLessonStudy();
        }
    }

    /**
     * 写入学习次数数据。
     * @param {Object} data 学习次数数据。
     * @returns {boolean} 是否写入成功。
     */
    function saveLessonStudy(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            return false;
        }
        try {
            localStorage.setItem(LESSON_STUDY_KEY, JSON.stringify(data));
            return true;
        } catch (_) {
            return false;
        }
    }

    /**
     * 给一课记一次学习（次数 +1）。采用「读取-合并-写回」，多标签页不会互相覆盖。
     * @param {string} bookToken 课本标识，如 NCE1 / CUSTOM 课本键 / PODCAST。
     * @param {string} lessonId 课时标识，如音频文件名 / 播客课程 id。
     * @returns {number} 记录成功返回新次数，失败返回 0。
     */
    function recordLessonStudy(bookToken, lessonId) {
        const book = sanitizeLessonStudyKey(bookToken);
        const lesson = sanitizeLessonStudyKey(lessonId);
        if (!book || !lesson) {
            return 0;
        }
        const data = loadLessonStudy();
        if (!data.books[book]) {
            data.books[book] = {};
        }
        const entry = data.books[book][lesson] || { count: 0, lastAt: 0 };
        entry.count = Math.floor(Number(entry.count) || 0) + 1;
        entry.lastAt = Date.now();
        data.books[book][lesson] = entry;
        data.updatedAt = Date.now();
        return saveLessonStudy(data) ? entry.count : 0;
    }

    /**
     * 读取一课的累计学习次数。
     * @param {string} bookToken 课本标识。
     * @param {string} lessonId 课时标识。
     * @returns {number} 学习次数（无记录返回 0）。
     */
    function getLessonStudyCount(bookToken, lessonId) {
        const book = sanitizeLessonStudyKey(bookToken);
        const lesson = sanitizeLessonStudyKey(lessonId);
        if (!book || !lesson) {
            return 0;
        }
        const data = loadLessonStudy();
        const entry = data.books[book] && data.books[book][lesson];
        return entry ? Math.floor(Number(entry.count) || 0) : 0;
    }

    /**
     * 读取一本课本下所有课的学习次数，供列表渲染。
     * @param {string} bookToken 课本标识。
     * @returns {Object} 形如 { 课时标识: 次数 }，无记录的课时不出现。
     */
    function getLessonStudyCounts(bookToken) {
        const book = sanitizeLessonStudyKey(bookToken);
        if (!book) {
            return {};
        }
        const data = loadLessonStudy();
        const source = data.books[book] || {};
        const result = {};
        Object.keys(source).forEach((lesson) => {
            const count = Math.floor(Number(source[lesson] && source[lesson].count) || 0);
            if (count > 0) {
                result[lesson] = count;
            }
        });
        return result;
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
        toSpeakable,
        canSpeak,
        // 随机听写题库
        DICTATION_POOL_KEY,
        normalizeAnswer,
        loadDictationPool,
        saveDictationPool,
        upsertDictationSentences,
        // 学习时长统计
        STUDY_TIME_KEY,
        getStudyDayKey,
        loadStudyTime,
        saveStudyTime,
        addStudyTime,
        getStudyStats,
        formatStudyDuration,
        startStudyTimer,
        // 课程学习次数统计
        LESSON_STUDY_KEY,
        loadLessonStudy,
        saveLessonStudy,
        recordLessonStudy,
        getLessonStudyCount,
        getLessonStudyCounts
    };

    if (typeof window !== 'undefined') {
        window.NCEUtils = Object.freeze(utils);
    }
})();
