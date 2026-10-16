(() => {
    document.addEventListener('DOMContentLoaded', () => {

        /** 正则常量 */
        const LINE_RE = /\[(\d+:\d+\.\d+)\](.*)/;
        const TIME_RE = /\[(\d+):(\d+(?:\.\d+)?)\]/;
        const INFO_RE = {
            album: /\[al:(.*)\]/,
            artist: /\[ar:(.*)\]/,
            title: /\[ti:(.*)\]/
        };

        const utils = window.NCEUtils;
        if (!utils) {
            console.error('NCEUtils is not available.');
            return;
        }

        const {
            createPlaceholderCover,
            deriveLrcUrl,
            parseCustomBookKey,
            loadStoredCustomData,
            prepareCustomLessons,
            openShare,
            detectShareEnvironment,
            escapeHtml,
            loadWordBook,
            addWordToBook,
            removeWordFromBook,
            isWordInBook,
            updateWordInBook,
            normalizeWord,
            speakWord,
            canSpeak
        } = utils;

        /** 读取 URL hash 并构造资源路径 */
        const hashSegment = location.hash.slice(1).split('?')[0];
        if (!hashSegment) {
            window.location.href = 'book.html';
            return;
        }

        const hashParts = hashSegment.split('/');
        const bookToken = hashParts[0] || '';
        const isCustomLesson = bookToken === 'CUSTOM';
        /** 播客路由：lesson.html#PODCAST/{courseId} */
        const isPodcastLesson = bookToken === 'PODCAST';
        const podcastConfig = window.NCE_PODCAST || null;
        const podcastCourses = (podcastConfig && Array.isArray(podcastConfig.courses))
            ? podcastConfig.courses
            : [];
        /** 当前播客课程（含标题/等级/词汇），非播客路由时为 null */
        let currentPodcastCourse = null;
        let customLessonsMap = {};

        function refreshCustomLessonsMap() {
            customLessonsMap = prepareCustomLessons(loadStoredCustomData(), { deriveLrc: true });
        }

        refreshCustomLessonsMap();

        let bookScr = '';
        let bookImgSrc = '';
        let mp3Src = '';
        let lrcSrc = '';
        let fallbackAlbum = '';
        let fallbackTitle = '';
        let defaultBookToken = bookToken;
        let defaultBookNumber = null;
        let lessonSlug = '';
        let customBookName = '';
        let customLessonIndex = -1;
        let currentLessonMeta = null;
        let customBookDisplayName = '';
        let customBookCover = '';

        if (isCustomLesson) {
            customBookName = decodeURIComponent(hashParts[1] || '');
            customLessonIndex = parseInt(hashParts[2], 10);
            const lessons = Array.isArray(customLessonsMap[customBookName]) ? customLessonsMap[customBookName] : [];
            currentLessonMeta = lessons[customLessonIndex];
            if (!customBookName || Number.isNaN(customLessonIndex) || !currentLessonMeta) {
                window.location.href = 'book.html';
                return;
            }
            mp3Src = currentLessonMeta.filename;
            lrcSrc = currentLessonMeta.lrc || deriveLrcUrl(mp3Src);
            const parsedBook = parseCustomBookKey(customBookName);
            customBookDisplayName = parsedBook.name;
            customBookCover = parsedBook.cover;
            bookScr = `book.html#CUSTOM/${encodeURIComponent(customBookName)}`;
            bookImgSrc = customBookCover || createPlaceholderCover(customBookDisplayName);
            fallbackAlbum = customBookDisplayName;
            fallbackTitle = currentLessonMeta.title || '';
        } else if (isPodcastLesson) {
            const podcastId = hashParts[1] ? decodeURIComponent(hashParts[1]) : '';
            currentPodcastCourse = podcastCourses.find((item) => item.id === podcastId) || null;
            if (!currentPodcastCourse) {
                window.location.href = 'podcast.html';
                return;
            }
            const audioBase = (podcastConfig && podcastConfig.audioBase) || 'podcast/audio/';
            const lrcBase = (podcastConfig && podcastConfig.lrcBase) || 'podcast/lrc/';
            // 索引里带完整路径（支持 mp3/m4a 等不同格式），缺失时按 id 推导
            mp3Src = currentPodcastCourse.audio || `${audioBase}${podcastId}.m4a`;
            lrcSrc = currentPodcastCourse.lrc || `${lrcBase}${podcastId}.lrc`;
            bookScr = 'podcast.html';
            bookImgSrc = 'images/podcast.svg';
            fallbackAlbum = `English Pod · ${currentPodcastCourse.level || ''}`.trim();
            fallbackTitle = currentPodcastCourse.title || podcastId;
        } else {
            defaultBookToken = bookToken || 'NCE1';
            defaultBookNumber = parseInt(defaultBookToken.replace('NCE', ''), 10);
            lessonSlug = hashParts[1] ? decodeURIComponent(hashParts[1]) : '';
            if (!defaultBookNumber || !lessonSlug) {
                window.location.href = 'book.html';
                return;
            }
            mp3Src = `${defaultBookToken}/${lessonSlug}.mp3`;
            lrcSrc = `${defaultBookToken}/${lessonSlug}.lrc`;
            bookScr = `book.html#${defaultBookToken}`;
            bookImgSrc = `images/${defaultBookToken}.jpg`;
            fallbackAlbum = '';
            fallbackTitle = lessonSlug;
        }


        /** DOM 引用 */
        const audio = document.getElementById('player');
        const content = document.getElementById('content');
        const bookEl = document.getElementById('book');
        const bookTitleEl = document.getElementById('book-title');
        const bookImgEl = document.getElementById('book-img');
        const lessonTitleEl = document.getElementById('lesson-title');
        const modesContainer = document.getElementById('playback-modes');
        const setAButton = document.getElementById('set-a');
        const setBButton = document.getElementById('set-b');
        const speedContainer = document.getElementById('playback-speed');
        const customSpeedButton = document.getElementById('speed-3x');
        const dictationModeCheckbox = document.getElementById('dictation-mode');
        const dictationContainer = document.getElementById('dictation-container');
        const shareContainer = document.getElementById('share-container');
        const shareTrigger = document.getElementById('share-trigger');
        const shareMenu = document.getElementById('share-menu');
        const shareFeedback = document.getElementById('share-feedback');
        const wechatPopover = document.getElementById('wechat-share-popover');
        const wechatQrImage = document.getElementById('wechat-share-qr');
        const wechatCloseBtn = document.getElementById('wechat-share-close');
        const hasNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
        const shareEnvironment = detectShareEnvironment ? detectShareEnvironment() : { isMobile: false, isWeChatBrowser: false };

        // Custom player controls
        const playPauseBtn = document.getElementById('play-pause-btn');
        const progressBar = document.getElementById('progress-bar');
        const progress = document.getElementById('progress');
        const timeDisplay = document.getElementById('time-display');
        const volumeBtn = document.getElementById('volume-btn');
        const volumeSlider = document.getElementById('volume-slider');
        let isDraggingProgress = false;
        let wasPlayingBeforeDrag = false;
        let pendingSeekTime = null;

        /** 数据结构 */
        const state = {
            data: [],          // [{en, cn, start, end}]
            album: fallbackAlbum,
            artist: '',
            title: fallbackTitle,
            segmentEnd: 0,
            activeIdx: -1,
            playbackMode: 'single-play', // 'single-play', 'single-loop', 'continuous', 'ab-loop'
            dictation: false,
            abLoop: { a: null, b: null },
            hasTranslation: false
        };
        audio.preload = 'auto';
        audio.src = mp3Src;
        audio.load();
        bookImgEl.src = bookImgSrc;
        bookImgEl.alt = isCustomLesson ? (customBookDisplayName || customBookName) : defaultBookToken;
        
        // Disable content interaction until audio is ready
        content.style.pointerEvents = 'none';
        content.style.opacity = '0.5';
        
        // Monitor audio loading and state changes
        let stalledCount = 0;
        let lastStalledTime = 0;
        // 必须先声明：markAudioReady 会在事件回调中被提前调用
        let audioReady = false;
        
        function enableAudioUi() {
            content.style.pointerEvents = '';
            content.style.opacity = '';
        }

        function markAudioReady(reason) {
            if (audio.error || audio.readyState < 1) {
                return;
            }
            if (!audioReady) {
                console.log('[AUDIO] Marking audio ready via', reason, '- readyState:', audio.readyState);
            }
            audioReady = true;
            enableAudioUi();
        }

        audio.addEventListener('loadstart', () => console.log('[AUDIO] loadstart - readyState:', audio.readyState));
        audio.addEventListener('loadedmetadata', () => {
            console.log('[AUDIO] loadedmetadata - readyState:', audio.readyState, 'duration:', audio.duration);
            markAudioReady('loadedmetadata');
        });
        audio.addEventListener('loadeddata', () => {
            console.log('[AUDIO] loadeddata - readyState:', audio.readyState);
            markAudioReady('loadeddata');
        });
        audio.addEventListener('canplay', () => {
            console.log('[AUDIO] canplay - readyState:', audio.readyState);
            stalledCount = 0; // Reset stalled counter on successful load
            markAudioReady('canplay');
        });
        audio.addEventListener('canplaythrough', () => console.log('[AUDIO] canplaythrough - readyState:', audio.readyState));
        audio.addEventListener('stalled', () => {
            const now = Date.now();
            stalledCount++;
            console.warn('[AUDIO] stalled - readyState:', audio.readyState, 'count:', stalledCount);
            
            // If stalled multiple times in short period, force reload
            if (stalledCount >= 2 && now - lastStalledTime < 5000) {
                console.error('[AUDIO] Multiple stalls detected, forcing reload');
                const currentTime = audio.currentTime;
                const wasPaused = audio.paused;
                audio.load();
                // Restore position after load
                audio.addEventListener('loadedmetadata', function restorePosition() {
                    audio.removeEventListener('loadedmetadata', restorePosition);
                    audio.currentTime = currentTime;
                    if (!wasPaused) {
                        audio.play().catch(e => console.error('[AUDIO] Play after reload failed:', e));
                    }
                }, { once: true });
                stalledCount = 0;
            }
            lastStalledTime = now;
        });
        audio.addEventListener('suspend', () => {
            console.warn('[AUDIO] suspend - readyState:', audio.readyState);
            markAudioReady('suspend');
        });
        audio.addEventListener('error', (e) => console.error('[AUDIO] Error loading:', audio.error, 'readyState:', audio.readyState));

        const displayModesContainer = document.getElementById('display-modes');
        const DISPLAY_MODE_EVENT = 'nce:displayModeAvailability';

        /** ------------------------------------------------- 
         *  Utilities
         * ------------------------------------------------- */
        function formatTime(seconds) {
            const minutes = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return `${minutes}:${secs < 10 ? '0' : ''}${secs}`;
        }

        function findSentenceIndexAtTime(time) {
            if (!Array.isArray(state.data) || !state.data.length) {
                return -1;
            }
            return state.data.findIndex(
                item => time >= item.start && (time < item.end || !item.end)
            );
        }

        function updateHighlightForTime(time, options = {}) {
            const { updateSegmentEnd = false } = options;
            const idx = findSentenceIndexAtTime(time);
            if (idx === -1) {
                // If no sentence found at this time, clear segmentEnd to prevent loop-back
                state.segmentEnd = 0;
                return;
            }
            highlight(idx, options);
            // Only update segmentEnd if explicitly requested
            // This prevents manual seeks from being overridden by playback logic
            if (updateSegmentEnd) {
                const sentence = state.data[idx];
                if (sentence) {
                    state.segmentEnd = sentence.end;
                }
            }
        }

        function updateSeekFromClientX(clientX) {
            const duration = audio.duration;
            if (!duration || Number.isNaN(duration)) {
                return null;
            }
            const rect = progressBar.getBoundingClientRect();
            const width = rect.width;
            if (!width) {
                return null;
            }
            let offsetX = clientX - rect.left;
            offsetX = Math.min(Math.max(offsetX, 0), width);
            const ratio = offsetX / width;
            const targetTime = ratio * duration;
            progress.style.width = `${ratio * 100}%`;
            timeDisplay.textContent = `${formatTime(targetTime)} / ${formatTime(duration)}`;
            return targetTime;
        }

        /** -------------------------------------------------
         *  分享功能
         * ------------------------------------------------- */
        let shareFeedbackTimer = null;

        function closeShareMenu() {
            if (!shareMenu || !shareTrigger) return;
            shareMenu.classList.remove('open');
            shareMenu.setAttribute('aria-hidden', 'true');
            shareTrigger.setAttribute('aria-expanded', 'false');
            shareTrigger.classList.remove('is-open');
        }

        function openShareMenu() {
            if (!shareMenu || !shareTrigger) return;
            hideWeChatPopover();
            if (shareFeedback) {
                shareFeedback.classList.remove('visible');
                shareFeedback.setAttribute('aria-hidden', 'true');
            }
            if (shareFeedbackTimer) {
                clearTimeout(shareFeedbackTimer);
                shareFeedbackTimer = null;
            }
            shareMenu.classList.add('open');
            shareMenu.setAttribute('aria-hidden', 'false');
            shareTrigger.setAttribute('aria-expanded', 'true');
            shareTrigger.classList.add('is-open');
        }

        function hideWeChatPopover() {
            if (!wechatPopover) return;
            wechatPopover.classList.remove('visible');
            wechatPopover.setAttribute('aria-hidden', 'true');
            if (wechatQrImage) {
                wechatQrImage.removeAttribute('src');
            }
        }

        function showWeChatPopover(payload) {
            if (!wechatPopover || !wechatQrImage) {
                showShareFeedback('浏览器限制，复制链接分享给好友吧');
                return;
            }
            if (!payload || !payload.qrImage) {
                showShareFeedback('二维码生成失败，稍后再试或改用其它方式');
                return;
            }
            wechatQrImage.src = payload.qrImage;
            wechatPopover.classList.add('visible');
            wechatPopover.setAttribute('aria-hidden', 'false');
        }

        function handleWeChatInternalShare(options) {
            const messages = [];
            if (shareEnvironment.isWeChatBrowser) {
                messages.push('请点击右上角菜单，选择“分享到朋友圈”或“发送给朋友”。');
            }
            if (!messages.length) {
                messages.push('请使用系统分享或复制链接转发给好友。');
            }
            showShareFeedback(messages.join(' '));
        }

        function showShareFeedback(message) {
            if (!shareFeedback || !message) {
                return;
            }
            hideWeChatPopover();
            shareFeedback.textContent = message;
            shareFeedback.classList.add('visible');
            shareFeedback.setAttribute('aria-hidden', 'false');
            if (shareFeedbackTimer) {
                clearTimeout(shareFeedbackTimer);
            }
            shareFeedbackTimer = setTimeout(() => {
                shareFeedback.classList.remove('visible');
                shareFeedback.setAttribute('aria-hidden', 'true');
                shareFeedbackTimer = null;
            }, 2800);
        }

        function getShareOptions() {
            const currentUrl = window.location.href;
            const lessonTitle = (lessonTitleEl ? lessonTitleEl.textContent : '') || state.title || fallbackTitle || document.title || '';
            const albumTitle = (bookTitleEl ? bookTitleEl.textContent : '') || state.album || fallbackAlbum || '';
            const cleanLesson = lessonTitle.trim() || '精选课程';
            const cleanAlbum = albumTitle.trim();
            const headline = cleanAlbum ? `《${cleanLesson}》 · ${cleanAlbum}` : `《${cleanLesson}》`;
            const benefitLine = '逐句精听 · 中英双显 · 听写训练';
            const invitation = cleanAlbum
                ? `我正在新概念英语中精读${headline}，一起来打卡进步吧！`
                : `我正在新概念英语中精读${headline}，一起坚持英语打卡吧！`;
            return {
                url: currentUrl,
                title: `${headline} | 新概念英语精读`,
                description: `${benefitLine}`,
                text: `${invitation}`,
                image: bookImgEl ? bookImgEl.src : ''
            };
        }

        function handleShare(target) {
            if (!openShare || !target) {
                return;
            }
            if (target === 'native' && !hasNativeShare) {
                showShareFeedback('当前浏览器不支持系统分享，试试复制链接吧');
                return;
            }
            const payload = openShare(target, {
                ...getShareOptions(),
                windowFeatures: 'width=680,height=580,top=88,left=120,toolbar=no,menubar=no,scrollbars=yes,resizable=yes'
            });
            if (!payload) {
                showShareFeedback('分享未完成，稍后再试或换个渠道吧');
                return;
            }
            switch (payload.mode) {
                case 'qr':
                    showWeChatPopover(payload);
                    break;
                case 'wechat-internal':
                    handleWeChatInternalShare(payload);
                    break;
                case 'copy':
                    showShareFeedback('链接已复制，快去邀请好友一起学习吧！');
                    break;
                case 'native':
                    showShareFeedback('已唤起系统分享，挑选好友一起打卡！');
                    break;
                default:
                    showShareFeedback('分享窗口已打开，邀好友共同进步！');
                    break;
            }
        }

        if (shareMenu && !hasNativeShare) {
            const nativeButtons = shareMenu.querySelectorAll('[data-requires-native="true"]');
            nativeButtons.forEach((btn) => btn.remove());
        }

        if (shareMenu && shareEnvironment.isMobile) {
            const weChatItem = shareMenu.querySelector('[data-share-target="wechat"] span:last-child');
            if (weChatItem) {
                weChatItem.textContent = shareEnvironment.isWeChatBrowser ? '微信内转发指南' : '微信好友速分享';
            }
        }

        if (shareTrigger) {
            shareTrigger.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (shareMenu && shareMenu.classList.contains('open')) {
                    closeShareMenu();
                } else {
                    openShareMenu();
                }
            });
        }

        if (shareMenu) {
            shareMenu.addEventListener('click', (event) => {
                const targetBtn = event.target.closest('[data-share-target]');
                if (!targetBtn) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                closeShareMenu();
                handleShare(targetBtn.dataset.shareTarget);
            });
        }

        if (shareContainer) {
            shareContainer.addEventListener('click', (event) => {
                event.stopPropagation();
            });
        }

        document.addEventListener('click', () => {
            closeShareMenu();
            hideWeChatPopover();
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closeShareMenu();
                hideWeChatPopover();
            }
        });

        if (wechatCloseBtn) {
            wechatCloseBtn.addEventListener('click', (event) => {
                event.preventDefault();
                hideWeChatPopover();
            });
        }

        if (wechatPopover) {
            wechatPopover.addEventListener('click', (event) => {
                event.stopPropagation();
            });
        }

        /** ------------------------------------------------- 
         *  元信息解析
         * ------------------------------------------------- */
        function parseInfo(line) {
            for (const key in INFO_RE) {
                const m = line.match(INFO_RE[key]);
                if (m) state[key] = m[1];
            }
        }

        /** ------------------------------------------------- 
         *  时间解析
         * ------------------------------------------------- */
        function parseTime(tag) {
            const m = TIME_RE.exec(tag);
            return m ? parseInt(m[1], 10) * 60 + parseFloat(m[2]) -0.5 : 0;
        }

        /** ------------------------------------------------- 
         *  LRC 解析
         * ------------------------------------------------- */
        async function loadLrc() {
            state.data = [];
            state.hasTranslation = false;
            try {
                const lrcRes = await fetch(lrcSrc);
                if (!lrcRes.ok) {
                    throw new Error(`Failed to load LRC: ${lrcRes.status}`);
                }
                
                // Read as ArrayBuffer to handle different encodings
                const buffer = await lrcRes.arrayBuffer();
                let text = '';
                
                // Try to decode with different encodings
                // Order matters: try most common encodings first
                const encodings = [
                    'utf-8',
                    'gbk',           // Simplified Chinese
                    'gb2312',        // Simplified Chinese (older)
                    'big5',          // Traditional Chinese
                    'windows-1252',  // Western European (ANSI)
                    'windows-1250',  // Central European (ANSI)
                    'iso-8859-1',    // Latin-1
                    'iso-8859-2',    // Latin-2 (Central European)
                    'shift-jis',     // Japanese
                    'euc-jp',        // Japanese
                    'euc-kr',        // Korean
                    'windows-1251'   // Cyrillic
                ];
                let decoded = false;
                let bestText = '';
                let bestScore = -1;
                
                for (const encoding of encodings) {
                    try {
                        const decoder = new TextDecoder(encoding, { fatal: true });
                        const decodedText = decoder.decode(buffer);
                        
                        // Check if the decoded text contains valid LRC format
                        if (!decodedText.includes('[') || !/\d+:\d+/.test(decodedText)) {
                            continue;
                        }
                        
                        // Score the decoded text quality
                        // Higher score = better decoding
                        let score = 0;
                        
                        // Penalty for replacement characters (�)
                        const replacementChars = (decodedText.match(/�/g) || []).length;
                        score -= replacementChars * 100;
                        
                        // Penalty for invalid Unicode sequences
                        const invalidChars = (decodedText.match(/[\uFFFD\uFFFE\uFFFF]/g) || []).length;
                        score -= invalidChars * 100;
                        
                        // Bonus for valid CJK characters (Chinese, Japanese, Korean)
                        const cjkChars = (decodedText.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []).length;
                        score += cjkChars * 2;
                        
                        // Bonus for valid ASCII printable characters
                        const asciiChars = (decodedText.match(/[\x20-\x7E]/g) || []).length;
                        score += asciiChars * 0.5;
                        
                        // If this is the best decoding so far, save it
                        if (score > bestScore) {
                            bestScore = score;
                            bestText = decodedText;
                            decoded = true;
                        }
                        
                        // If we have a perfect score (no replacement chars), use it immediately
                        if (replacementChars === 0 && invalidChars === 0 && score > 0) {
                            text = decodedText;
                            decoded = true;
                            break;
                        }
                    } catch (e) {
                        // Decoding failed with this encoding, try next
                        continue;
                    }
                }
                
                // Use the best decoded text if we found one
                if (decoded && bestText) {
                    text = bestText;
                } else {
                    // Fallback to UTF-8 if no encoding worked
                    const decoder = new TextDecoder('utf-8', { fatal: false });
                    text = decoder.decode(buffer);
                }
                
                const lines = text.split(/\r?\n/).filter(Boolean);

                lines.forEach((raw, i) => {
                    const line = raw.trim();
                    const match = line.match(LINE_RE);

                    if (!match) {
                        parseInfo(line);
                        return;
                    }

                    const start = parseTime(`[${match[1]}]`);
                    const contentAfterTimestamp = match[2] || '';
                    const [enRaw, cnRaw = ''] = contentAfterTimestamp.split('|');
                    const en = (enRaw || '').trim();
                    const cn = (cnRaw || '').trim();
                    
                    // Skip empty lines (lines with only timestamp but no text, or only whitespace)
                    if (!en && !cn) {
                        return;
                    }
                    
                    if (cn) {
                        state.hasTranslation = true;
                    }

                    let end = 0;
                    for (let j = i + 1; j < lines.length; j++) {
                        const nxt = lines[j].match(LINE_RE);
                        if (nxt) {
                            end = parseTime(`[${nxt[1]}]`);
                            break;
                        }
                    }
                    state.data.push({en, cn, start, end});
                });
            } catch (error) {
                console.error('Failed to load LRC:', error);
            }
            render();
            updateDisplayModeAvailability();
        }

        function updateDisplayModeAvailability() {
            if (displayModesContainer) {
                displayModesContainer.dataset.available = state.hasTranslation ? '1' : '0';
                if (state.hasTranslation) {
                    displayModesContainer.style.display = '';
                } else {
                    displayModesContainer.style.display = 'none';
                    content.classList.remove('bilingual-mode', 'cn-mode');
                    content.classList.add('en-mode');
                    try {
                        localStorage.setItem('displayMode', 'en-mode');
                    } catch (_) {
                        /* noop */
                    }
                }
            }
            document.dispatchEvent(new CustomEvent(DISPLAY_MODE_EVENT, {
                detail: { hasTranslation: state.hasTranslation }
            }));
        }


        /** ------------------------------------------------- 
         *  渲染
         * ------------------------------------------------- */
        function render() {
            bookEl.href = bookScr;
            const albumDisplay = state.album || fallbackAlbum;
            const titleDisplay = state.title || fallbackTitle;
            bookTitleEl.textContent = albumDisplay;
            lessonTitleEl.textContent = titleDisplay;

            content.innerHTML = state.data.map(
                (item, idx) =>
                    `<div class="sentence" data-idx="${idx}">
                    <div class="en">${escapeHtml(item.en)}</div>
                    <div class="cn">${escapeHtml(item.cn)}</div>
                </div>`
            ).join('');
        }

        /** ------------------------------------------------- 
         *  播放区间
         * ------------------------------------------------- */
        let pendingPlayRequest = null;
        let lastSeekTime = 0;
        const SEEK_DEBOUNCE_MS = 300; // 防抖间隔：300ms内的重复seek会被忽略（避免服务器过载）
        
        function playSegment(start, end) {
            if (!audioReady && !audio.error) {
                console.warn('[PLAY] Audio not marked ready yet, attempting playback anyway');
                if (audio.networkState === audio.NETWORK_IDLE || audio.readyState === 0) {
                    audio.load();
                }
            }
            
            const now = Date.now();
            // 防抖：如果距离上次seek太近，先记录位置但延迟执行
            if (now - lastSeekTime < SEEK_DEBOUNCE_MS) {
                console.log('[PLAY] Seek too fast, debouncing...');
                // 取消之前的延迟执行
                if (pendingPlayRequest && pendingPlayRequest.debounceTimeout) {
                    clearTimeout(pendingPlayRequest.debounceTimeout);
                }
                // 延迟执行
                const debounceTimeout = setTimeout(() => {
                    lastSeekTime = Date.now();
                    executePlaySegment(start, end);
                }, SEEK_DEBOUNCE_MS);
                
                if (pendingPlayRequest) {
                    pendingPlayRequest.debounceTimeout = debounceTimeout;
                } else {
                    pendingPlayRequest = { debounceTimeout };
                }
                return;
            }
            
            lastSeekTime = now;
            executePlaySegment(start, end);
        }
        
        function executePlaySegment(start, end) {
            console.log('[PLAY] playSegment called - start:', start, 'readyState:', audio.readyState, 'networkState:', audio.networkState);
            state.segmentEnd = end;
            
            // Check if audio is loaded and has valid source
            if (!audio.src || audio.error) {
                console.warn('[PLAY] Audio source not ready or has error');
                return;
            }
            
            // Cancel any pending play request
            if (pendingPlayRequest) {
                console.log('[PLAY] Cancelling previous pending request');
                if (pendingPlayRequest.timeout) {
                    clearTimeout(pendingPlayRequest.timeout);
                }
                if (pendingPlayRequest.handler) {
                    audio.removeEventListener('canplay', pendingPlayRequest.handler);
                }
                if (pendingPlayRequest.errorHandler) {
                    audio.removeEventListener('error', pendingPlayRequest.errorHandler);
                }
                pendingPlayRequest = null;
            }
            
            // Always try to seek, even if readyState is low
            // This handles the case where rapid seeks cause readyState to drop
            console.log('[PLAY] Seeking to:', start);
            
            try {
                audio.currentTime = start;
            } catch (e) {
                console.error('[PLAY] Failed to set currentTime:', e);
                return;
            }
            
            const tryPlay = label => {
                console.log(`[PLAY] ${label} - readyState:`, audio.readyState);
                audio.play().then(() => {
                    markAudioReady(`play:${label}`);
                }).catch(e => {
                    console.error(`[PLAY] ${label} failed:`, e);
                });
            };

            // Attempt playback immediately in the current user gesture for iOS.
            tryPlay('Immediate play attempt');

            if (audio.readyState < 2) {
                console.log('[PLAY] Audio needs more data (readyState:', audio.readyState, '), waiting for canplay...');

                const onCanPlay = () => {
                    console.log('[PLAY] canplay event fired, retrying play');
                    if (pendingPlayRequest && pendingPlayRequest.handler === onCanPlay) {
                        clearTimeout(pendingPlayRequest.timeout);
                        pendingPlayRequest = null;
                    }
                    tryPlay('Play after canplay');
                };

                const onError = () => {
                    console.error('[PLAY] Error event fired during wait');
                    if (pendingPlayRequest && pendingPlayRequest.errorHandler === onError) {
                        clearTimeout(pendingPlayRequest.timeout);
                        pendingPlayRequest = null;
                    }
                };

                const timeout = setTimeout(() => {
                    console.error('[PLAY] Timeout waiting for canplay - readyState:', audio.readyState, 'networkState:', audio.networkState);
                    audio.removeEventListener('canplay', onCanPlay);
                    audio.removeEventListener('error', onError);
                    pendingPlayRequest = null;
                    tryPlay('Forced play after timeout');
                }, 3000);

                pendingPlayRequest = { handler: onCanPlay, errorHandler: onError, timeout };

                audio.addEventListener('canplay', onCanPlay, { once: true });
                audio.addEventListener('error', onError, { once: true });
            }
        }

        /** ------------------------------------------------- 
         *  随机听写：记录「听过」的句子
         *  播放到的句子会进入 nceDictationPool，供随机听写页出题。
         *  为减少 localStorage 写入，先入内存队列，定时批量落盘。
         * ------------------------------------------------- */
        const BOOK_LABELS = { 1: '第一册', 2: '第二册', 3: '第三册', 4: '第四册' };
        const heardQueue = new Map();
        let heardFlushTimer = null;

        function flushHeardRecords() {
            if (heardFlushTimer) {
                clearTimeout(heardFlushTimer);
                heardFlushTimer = null;
            }
            if (!heardQueue.size) {
                return;
            }
            if (typeof utils.upsertDictationSentences !== 'function') {
                heardQueue.clear();
                return;
            }
            const records = Array.from(heardQueue.values());
            heardQueue.clear();
            try {
                utils.upsertDictationSentences(records);
            } catch (error) {
                console.warn('Failed to save dictation pool.', error);
            }
        }

        function queueHeardSentence(idx) {
            const item = state.data && state.data[idx];
            if (!item || !item.en) {
                return;
            }
            const bookToken = isCustomLesson ? 'CUSTOM' : defaultBookToken;
            const lessonId = isCustomLesson ? customBookName : lessonSlug;
            if (!lessonId) {
                return;
            }
            const key = `${bookToken}|${lessonId}|${idx}`;
            if (heardQueue.has(key)) {
                return;
            }
            const bookLabel = isCustomLesson
                ? (customBookDisplayName || '自定义课本')
                : (BOOK_LABELS[defaultBookNumber] || '新概念英语');
            heardQueue.set(key, {
                key,
                book: bookToken,
                bookLabel,
                lesson: lessonId,
                lessonTitle: state.title || fallbackTitle || '',
                idx,
                start: item.start,
                end: item.end,
                en: item.en,
                cn: item.cn,
                audio: mp3Src
            });
            if (!heardFlushTimer) {
                heardFlushTimer = setTimeout(flushHeardRecords, 3000);
            }
        }

        window.addEventListener('beforeunload', flushHeardRecords);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                flushHeardRecords();
            }
        });

        /** -------------------------------------------------
         *  学习时长统计
         *  页面可见且用户活跃（或音频播放中）时累计学习时长，
         *  首页「学习统计」卡片会展示今日、累计与连续天数。
         * ------------------------------------------------- */
        if (typeof utils.startStudyTimer === 'function') {
            utils.startStudyTimer({
                module: 'lesson',
                isEngaged: () => !!audio && !audio.paused && !audio.ended
            });
        }

        /** ------------------------------------------------- 
         *  高亮 & 自动滚动
         * ------------------------------------------------- */
        /** 听写模式下：用户点击句子后，需要立即进入输入状态的句子索引（-1 表示无） */
        let dictationRevealIdx = -1;

        function highlight(idx, options = {}) {
            const { force = false } = options;
            if (idx === state.activeIdx && !force) return;

            // Clean up any previous dictation input
            const oldInput = content.querySelector('.dictation-input');
            if (oldInput) {
                const parentSentence = oldInput.closest('.sentence');
                if (parentSentence) {
                    parentSentence.querySelector('.en').style.display = '';
                    parentSentence.querySelectorAll('.dictation-hint').forEach((el) => el.remove());
                }
                oldInput.remove();
            }
            // 清除上一句残留的「浅色待输入」状态
            content.querySelectorAll('.sentence.dictation-pending').forEach((el) => el.classList.remove('dictation-pending'));

            const prev = content.querySelector('.sentence.active');
            if (prev) prev.classList.remove('active');

            const cur = content.querySelector(`.sentence[data-idx="${idx}"]`);
            if (cur) {
                cur.classList.add('active');
                const scrollBlockPosition = state.dictation ? 'start' : 'center';
                cur.scrollIntoView({behavior: 'smooth', block: scrollBlockPosition});

                const enDiv = cur.querySelector('.en');
                if (state.dictation && state.playbackMode === 'single-play') {
                    // 听写模式：默认只浅色展示英文，用户点击该句后才出现输入框
                    if (dictationRevealIdx === idx) {
                        dictationRevealIdx = -1;
                        activateDictationForSentence(cur, idx);
                    } else {
                        showDictationPending(cur);
                    }
                } else {
                    if (enDiv) enDiv.style.display = '';
                }
            }
            state.activeIdx = idx;
            // 记录「听过」的句子，供随机听写出题
            queueHeardSentence(idx);
        }

        /**
         * 听写模式：浅淡展示英文，等待用户点击句子后再进入输入状态。
         * @param {HTMLElement} sentenceEl 句子元素。
         */
        function showDictationPending(sentenceEl) {
            if (!sentenceEl) return;
            // 已进入输入状态则不再覆盖
            if (sentenceEl.querySelector('.dictation-input')) return;
            sentenceEl.classList.add('dictation-pending');
            const enDiv = sentenceEl.querySelector('.en');
            if (enDiv) enDiv.style.display = '';
        }

        function activateDictationForSentence(sentenceEl, idx) {
            const enDiv = sentenceEl.querySelector('.en');
            if (enDiv) {
                enDiv.style.display = 'none';
            }

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'dictation-input';
            input.placeholder = '请输入英文句子...';
            input.autocomplete = 'off';
            input.autocapitalize = 'off';
            input.spellcheck = false;

            const hint = document.createElement('p');
            hint.className = 'dictation-hint';
            hint.setAttribute('aria-live', 'polite');

            sentenceEl.appendChild(input);
            sentenceEl.appendChild(hint);
            input.focus();

            // 比对时忽略大小写、空格与标点，只比对字母；
            // 同时做 NFKC 归一化，兼容中文输入法全角状态打出的全角字母（如 ＥＸＣＵＳＥ → EXCUSE）
            const normalize = (value) => String(value || '')
                .normalize('NFKC')
                .replace(/[^a-zA-Z]/g, '')
                .toLowerCase();
            const correctAnswer = normalize(state.data[idx] && state.data[idx].en);

            if (!correctAnswer) {
                input.disabled = true;
                hint.textContent = '该句没有可听写的英文内容';
                hint.classList.add('is-visible');
                return;
            }

            let solved = false;

            /** 统一更新输入框与提示的对错状态 */
            function setState(stateName, message) {
                input.classList.remove('is-correct', 'is-wrong');
                hint.classList.remove('is-correct', 'is-wrong', 'is-visible');
                if (stateName) {
                    input.classList.add(stateName);
                    hint.classList.add(stateName);
                }
                hint.textContent = message || '';
                if (message) {
                    hint.classList.add('is-visible');
                }
            }

            function commonPrefixLength(a, b) {
                const limit = Math.min(a.length, b.length);
                let i = 0;
                while (i < limit && a[i] === b[i]) {
                    i++;
                }
                return i;
            }

            function finishCorrect() {
                if (solved) return;
                solved = true;
                setState('is-correct', '✓ 拼写正确！');
                input.disabled = true;
                if (enDiv) {
                    enDiv.style.display = '';
                }
                const nextIdx = idx + 1;
                setTimeout(() => {
                    if (nextIdx < state.data.length) {
                        const { start, end } = state.data[nextIdx];
                        playSegment(start, end);
                    } else {
                        audio.pause();
                        // 最后一句完成，清理界面
                        input.remove();
                        hint.remove();
                        sentenceEl.classList.remove('active');
                        state.activeIdx = -1;
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                }, 700);
            }

            /** 实时校验：完全正确 -> 通过；与答案前缀不符 -> 判错 */
            function evaluate() {
                if (solved) return;
                const userInput = normalize(input.value);
                if (userInput === correctAnswer) {
                    finishCorrect();
                    return;
                }
                if (!userInput) {
                    setState(null, '');
                    return;
                }
                if (correctAnswer.startsWith(userInput)) {
                    // 目前与答案一致，只是还没输完
                    setState(null, '');
                    return;
                }
                const matched = commonPrefixLength(userInput, correctAnswer);
                setState('is-wrong', `✗ 拼写有误，已正确 ${matched}/${correctAnswer.length} 个字母`);
            }

            input.addEventListener('input', evaluate);
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    evaluate();
                }
            });
        }

        /** ------------------------------------------------- 
         *  Custom Player Logic
         * ------------------------------------------------- */
        playPauseBtn.addEventListener('click', () => {
            if (audio.paused) {
                if (state.activeIdx !== -1) {
                    // If there's an active sentence, play from its start
                    const { start, end } = state.data[state.activeIdx];
                    playSegment(start, end);
                } else {
                    // If no active sentence, play from the beginning of the first sentence
                    const { start, end } = state.data[0];
                    playSegment(start, end);
                }
            } else {
                audio.pause();
            }
        });

        audio.addEventListener('play', () => {
            playPauseBtn.classList.remove('play');
            playPauseBtn.classList.add('pause');
        });

        audio.addEventListener('pause', () => {
            playPauseBtn.classList.remove('pause');
            playPauseBtn.classList.add('play');
        });

        audio.addEventListener('loadedmetadata', () => {
            timeDisplay.textContent = `${formatTime(0)} / ${formatTime(audio.duration)}`;
        });

        progressBar.addEventListener('click', e => {
            const rect = progressBar.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const width = progressBar.clientWidth;
            const duration = audio.duration;
            if (!width || !duration || Number.isNaN(duration)) {
                return;
            }
            
            // Check if audio is ready
            if (audio.readyState < 2 || audio.error) {
                console.warn('Audio not ready for seeking');
                return;
            }
            
            const targetTime = (clickX / width) * duration;
            // Clear segmentEnd to prevent immediate loop back
            state.segmentEnd = 0;
            audio.currentTime = targetTime;
            updateHighlightForTime(targetTime, { force: true, updateSegmentEnd: false });
        });

        progressBar.addEventListener('pointerdown', e => {
            // Check if audio is ready before allowing drag
            if (audio.readyState < 2 || audio.error) {
                return;
            }
            
            if (e.pointerType === 'touch') {
                e.preventDefault();
            }
            const targetTime = updateSeekFromClientX(e.clientX);
            if (targetTime === null) {
                return;
            }
            isDraggingProgress = true;
            wasPlayingBeforeDrag = !audio.paused;
            if (wasPlayingBeforeDrag) {
                audio.pause();
            }
            if (progressBar.setPointerCapture) {
                try {
                    progressBar.setPointerCapture(e.pointerId);
                } catch (_) {
                    /* noop */
                }
            }
            pendingSeekTime = targetTime;
            updateHighlightForTime(targetTime, { force: true, updateSegmentEnd: false });
        });

        progressBar.addEventListener('pointermove', e => {
            if (!isDraggingProgress) return;
            if (e.pointerType === 'touch') {
                e.preventDefault();
            }
            const targetTime = updateSeekFromClientX(e.clientX);
            if (targetTime === null) {
                return;
            }
            pendingSeekTime = targetTime;
            updateHighlightForTime(targetTime, { force: true, updateSegmentEnd: false });
        });

        function finalizeSeek(e) {
            if (!isDraggingProgress) return;
            isDraggingProgress = false;
            if (progressBar.releasePointerCapture) {
                try {
                    progressBar.releasePointerCapture(e.pointerId);
                } catch (_) {
                    /* noop */
                }
            }
            if (pendingSeekTime !== null) {
                // Clear segmentEnd BEFORE setting currentTime to prevent immediate loop back
                state.segmentEnd = 0;
                audio.currentTime = pendingSeekTime;
            }
            if (wasPlayingBeforeDrag) {
                const playPromise = audio.play();
                if (playPromise && typeof playPromise.catch === 'function') {
                    playPromise.catch(() => {});
                }
            }
            pendingSeekTime = null;
        }

        progressBar.addEventListener('pointerup', finalizeSeek);
        progressBar.addEventListener('pointercancel', finalizeSeek);

        volumeBtn.addEventListener('click', () => {
            audio.muted = !audio.muted;
        });

        audio.addEventListener('volumechange', () => {
            if (audio.muted || audio.volume === 0) {
                volumeBtn.classList.remove('volume-high');
                volumeBtn.classList.add('volume-muted');
                volumeSlider.value = 0;
            } else {
                volumeBtn.classList.remove('volume-muted');
                volumeBtn.classList.add('volume-high');
                volumeSlider.value = audio.volume;
            }
        });

        volumeSlider.addEventListener('input', e => {
            audio.volume = e.target.value;
            audio.muted = e.target.value === '0';
        });


        /** ------------------------------------------------- 
         *  事件绑定（委托）
         * ------------------------------------------------- */
        content.addEventListener('click', e => {
            const target = e.target.closest('.sentence');
            if (!target) return;
            const idx = Number(target.dataset.idx);
            const {start, end} = state.data[idx];
            console.log('[CLICK] Sentence clicked - readyState:', audio.readyState, 'networkState:', audio.networkState, 'error:', audio.error);

            // 听写模式：只有点击句子框后才展示输入框
            if (state.dictation && state.playbackMode === 'single-play' && !target.querySelector('.dictation-input')) {
                target.classList.remove('dictation-pending');
                if (idx === state.activeIdx) {
                    // 点击的是当前句：直接进入输入状态
                    activateDictationForSentence(target, idx);
                } else {
                    // 点击的是其它句：先切过去，高亮该句时再进入输入状态
                    dictationRevealIdx = idx;
                }
            }

            playSegment(start, end);
        });

        dictationModeCheckbox.addEventListener('change', e => {
            state.dictation = e.target.checked;

            // Re-render the current sentence to apply/remove dictation view
            if (state.activeIdx !== -1) {
                highlight(state.activeIdx, { force: true });
            }

            // If dictation is turned ON and audio is paused, start playing.
            if (state.dictation && audio.paused) {
                let playIndex = state.activeIdx;

                // If no sentence is active, start from the beginning.
                if (playIndex === -1) {
                    playIndex = 0;
                }

                // Ensure the index is valid before trying to play.
                if (playIndex >= 0 && playIndex < state.data.length) {
                    const { start, end } = state.data[playIndex];
                    playSegment(start, end);
                }
            }
        });

        modesContainer.addEventListener('click', e => {
            if (e.target.tagName !== 'BUTTON') return;

            const mode = e.target.id.replace('mode-', '');
            if (['single-play', 'single-loop', 'continuous', 'ab-loop'].includes(mode)) {
                state.playbackMode = mode;
                localStorage.setItem('playbackMode', mode);

                // Update active button
                for (const child of modesContainer.children) {
                    child.classList.remove('active');
                }
                e.target.classList.add('active');

                // Show/hide A-B buttons
                if (mode === 'ab-loop') {
                    setAButton.style.display = 'inline-block';
                    setBButton.style.display = 'inline-block';
                } else {
                    setAButton.style.display = 'none';
                    setBButton.style.display = 'none';
                }

                // Handle dictation mode availability
                if (mode === 'single-play') {
                    dictationContainer.style.display = '';
                } else {
                    dictationContainer.style.display = 'none';
                    dictationModeCheckbox.checked = false;
                    state.dictation = false;
                    // If a sentence is active, re-highlight to remove dictation input
                    if (state.activeIdx !== -1) {
                        highlight(state.activeIdx, { force: true });
                    }
                }

                if (audio.paused) {
                    if (state.activeIdx !== -1) {
                        // If there's an active sentence, play from its start
                        let nextIdx = state.activeIdx;
                        if (mode === 'single-play' || mode === 'continuous') {
                            nextIdx++;
                        }
                        if (nextIdx === state.data.length) {
                            nextIdx = 0;
                        }
                        const { start, end } = state.data[nextIdx];
                        playSegment(start, end);
                    } else {
                        // If no active sentence, play from the beginning of the first sentence
                        const { start, end } = state.data[0];
                        playSegment(start, end);
                    }
                }
            }
        });

        setAButton.addEventListener('click', () => {
            if (state.activeIdx !== -1) {
                state.abLoop.a = state.data[state.activeIdx].start;
                setAButton.textContent = `A: ${state.abLoop.a.toFixed(1)}`;
                // Reset B if A is set after B
                state.abLoop.b = null;
                setBButton.textContent = '设置B点';
            }
        });

        setBButton.addEventListener('click', () => {
            if (state.activeIdx !== -1 && state.abLoop.a !== null) {
                const bPoint = state.data[state.activeIdx].end;
                if (bPoint > state.abLoop.a) {
                    state.abLoop.b = bPoint;
                    setBButton.textContent = `B: ${state.abLoop.b.toFixed(1)}`;
                    // Start playing the loop
                    audio.currentTime = state.abLoop.a;
                    audio.play();
                }
            }
        });

        const CUSTOM_SPEED_KEY = 'nceCustomPlaybackSpeed';
        let customSpeedPressTimer = null;
        let customSpeedLongPressTriggered = false;
        let suppressNextSpeedClick = false;

        function getCustomSpeed() {
            const stored = parseFloat(localStorage.getItem(CUSTOM_SPEED_KEY));
            if (!Number.isFinite(stored) || stored < 0.25 || stored > 5) {
                return 3;
            }
            return stored;
        }

        function formatSpeedLabel(value) {
            return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
        }

        function updateCustomSpeedButtonLabel(value = getCustomSpeed()) {
            if (customSpeedButton) {
                customSpeedButton.textContent = `${formatSpeedLabel(value)}x`;
            }
        }

        function clearCustomSpeedPressTimer() {
            if (customSpeedPressTimer) {
                clearTimeout(customSpeedPressTimer);
                customSpeedPressTimer = null;
            }
        }

        function promptCustomSpeed() {
            clearCustomSpeedPressTimer();
            const current = getCustomSpeed();
            const input = window.prompt('请输入自定义播放倍速 (0.25 - 5 之间)', formatSpeedLabel(current));
            if (input === null) {
                return;
            }
            const numeric = parseFloat(String(input).replace(/[^0-9.]+/g, ''));
            if (!Number.isFinite(numeric) || numeric < 0.25 || numeric > 5) {
                window.alert('请输入有效的倍速数值（0.25 - 5 之间）');
                return;
            }
            const normalized = Math.round(numeric * 100) / 100;
            localStorage.setItem(CUSTOM_SPEED_KEY, normalized);
            updateCustomSpeedButtonLabel(normalized);
            audio.playbackRate = normalized;
            localStorage.setItem('playbackSpeed', '3x');
            for (const child of speedContainer.children) {
                child.classList.remove('active');
            }
            if (customSpeedButton) {
                customSpeedButton.classList.add('active');
            }
        }

        if (customSpeedButton) {
            updateCustomSpeedButtonLabel();
            customSpeedButton.addEventListener('pointerdown', e => {
                if (e.button !== undefined && e.button !== 0) {
                    return;
                }
                customSpeedLongPressTriggered = false;
                clearCustomSpeedPressTimer();
                customSpeedPressTimer = setTimeout(() => {
                    customSpeedLongPressTriggered = true;
                    promptCustomSpeed();
                }, 600);
            });
            const cancelCustomSpeedPress = e => {
                if (customSpeedLongPressTriggered) {
                    suppressNextSpeedClick = true;
                    if (e) {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                }
                clearCustomSpeedPressTimer();
            };
            customSpeedButton.addEventListener('pointerup', cancelCustomSpeedPress);
            customSpeedButton.addEventListener('pointerleave', cancelCustomSpeedPress);
            customSpeedButton.addEventListener('pointercancel', cancelCustomSpeedPress);
        }

        speedContainer.addEventListener('click', e => {
            if (e.target.tagName !== 'BUTTON') return;
            if (suppressNextSpeedClick) {
                suppressNextSpeedClick = false;
                return;
            }

            const speed = e.target.id.replace('speed-', ''); // e.g., '1x', '3x'
            let playbackRate = parseFloat(speed);
            if (e.target.id === 'speed-3x') {
                playbackRate = getCustomSpeed();
                localStorage.setItem('playbackSpeed', '3x');
            } else {
                localStorage.setItem('playbackSpeed', speed);
            }
            audio.playbackRate = playbackRate;

            // Update active button
            for (const child of speedContainer.children) {
                child.classList.remove('active');
            }
            e.target.classList.add('active');
        });

        audio.addEventListener('timeupdate', () => {
            const cur = audio.currentTime;
            const duration = audio.duration;

            // Update progress bar and time display (skip if dragging to avoid flickering)
            if (duration && !isDraggingProgress) {
                progress.style.width = `${(cur / duration) * 100}%`;
                timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(duration)}`;
            }

            // Skip all playback logic while dragging
            if (isDraggingProgress) {
                return;
            }

            // A-B Loop logic
            if (state.playbackMode === 'ab-loop' && state.abLoop.a !== null && state.abLoop.b !== null && cur >= state.abLoop.b) {
                audio.currentTime = state.abLoop.a;
                return; // Return to avoid other logic
            }

            // Sentence-based logic for other modes
            if (state.segmentEnd && cur >= state.segmentEnd) {
                let shouldReturn = true;
                switch (state.playbackMode) {
                    case 'single-play':
                        audio.pause();
                        // By returning here, we prevent the findIndex and highlight logic below from running,
                        // which stops the highlight from jumping to the next sentence.
                        return;
                    case 'single-loop':
                        if (state.activeIdx !== -1) {
                            const { start } = state.data[state.activeIdx];
                            audio.currentTime = start;
                        }
                        break;
                    case 'continuous':
                    case 'ab-loop':
                        const nextIdx = state.activeIdx + 1;
                        if (state.activeIdx !== -1 && nextIdx < state.data.length) {
                            const {start, end} = state.data[nextIdx];
                            playSegment(start, end);
                            shouldReturn = false; // Allow highlight to update
                        } else {
                            audio.pause();
                            state.segmentEnd = 0;
                        }
                        break;
                }
                if (shouldReturn) return;
            }

            // Find and highlight current sentence
            const idx = findSentenceIndexAtTime(cur);
            if (idx !== -1) {
                highlight(idx);
                // Update segmentEnd for the current sentence if not already set
                if (!state.segmentEnd && state.data[idx]) {
                    state.segmentEnd = state.data[idx].end;
                }
            } else {
                // No sentence at current time - clear segmentEnd to prevent issues
                state.segmentEnd = 0;
            }
        });

        function loadSettings() {
            const savedMode = localStorage.getItem('playbackMode') || 'single-play';
            const savedSpeed = localStorage.getItem('playbackSpeed') || '1x';

            // Apply mode
            state.playbackMode = savedMode;
            document.getElementById(`mode-${savedMode}`).classList.add('active');
            if (savedMode === 'ab-loop') {
                setAButton.style.display = 'inline-block';
                setBButton.style.display = 'inline-block';
            }

            // Handle dictation mode availability on load
            if (savedMode === 'single-play') {
                dictationContainer.style.display = '';
            } else {
                dictationContainer.style.display = 'none';
            }

            // Apply speed
            const savedButton = document.getElementById(`speed-${savedSpeed}`);
            const appliedSpeed = savedSpeed === '3x' ? getCustomSpeed() : parseFloat(savedSpeed);
            audio.playbackRate = appliedSpeed;
            if (savedButton) {
                savedButton.classList.add('active');
            }
            if (customSpeedButton) {
                updateCustomSpeedButtonLabel();
            }
        }

        // Keyboard shortcuts handler
        document.addEventListener('keydown', e => {
            // If in dictation mode, handle dictation-specific behavior
            if (state.dictation) {
                const dictationInput = content.querySelector('.dictation-input');
                if (dictationInput) {
                    // If focus is already on an interactive element, do nothing for dictation.
                    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') {
                        return;
                    }
                    dictationInput.focus();
                }
                // In dictation mode, ignore keyboard shortcuts except for specific keys
                return;
            }

            // Don't handle shortcuts if user is typing in an input field or button
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
                return;
            }

            // Don't handle shortcuts if modifier keys are pressed (except for system shortcuts)
            if (e.ctrlKey || e.metaKey || e.altKey) {
                return;
            }

            switch (e.key) {
                case 'ArrowLeft':
                    // Left arrow: Previous sentence
                    e.preventDefault();
                    if (state.activeIdx > 0) {
                        const prevIdx = state.activeIdx - 1;
                        const { start, end } = state.data[prevIdx];
                        playSegment(start, end);
                    }
                    break;

                case 'ArrowRight':
                    // Right arrow: Next sentence
                    e.preventDefault();
                    if (state.activeIdx < state.data.length - 1) {
                        const nextIdx = state.activeIdx + 1;
                        const { start, end } = state.data[nextIdx];
                        playSegment(start, end);
                    }
                    break;

                case ' ':
                    // Space: Play/Pause
                    e.preventDefault();
                    if (audio.paused) {
                        if (state.activeIdx !== -1) {
                            const { start, end } = state.data[state.activeIdx];
                            playSegment(start, end);
                        } else if (state.data.length > 0) {
                            const { start, end } = state.data[0];
                            playSegment(start, end);
                        }
                    } else {
                        audio.pause();
                    }
                    break;

                case 'ArrowUp':
                    // Up arrow: Previous speed
                    e.preventDefault();
                    changeSpeed('previous');
                    break;

                case 'ArrowDown':
                    // Down arrow: Next speed
                    e.preventDefault();
                    changeSpeed('next');
                    break;
            }
        });

        // Function to handle speed changes
        function changeSpeed(direction) {
            const speedButtons = Array.from(speedContainer.children);
            const activeButton = speedButtons.find(btn => btn.classList.contains('active'));
            let currentIndex = activeButton ? speedButtons.indexOf(activeButton) : 0;

            if (direction === 'previous') {
                currentIndex = currentIndex > 0 ? currentIndex - 1 : speedButtons.length - 1;
            } else if (direction === 'next') {
                currentIndex = currentIndex < speedButtons.length - 1 ? currentIndex + 1 : 0;
            }

            const targetButton = speedButtons[currentIndex];
            if (targetButton) {
                targetButton.click();
            }
        }

        // 初始化
        loadSettings();
        loadLrc().then(r => {
            // LRC loaded successfully
        });

        /** -------------------------------------------------
         *  播客词汇表（仅 #PODCAST/... 路由）
         * ------------------------------------------------- */
        const podcastVocabEl = document.getElementById('podcast-vocab');

        function renderPodcastVocab(list) {
            if (!podcastVocabEl) {
                return;
            }
            const items = list.map((item, i) => `
                <div class="podcast-vocab__item" data-idx="${i}">
                    <div class="podcast-vocab__head">
                        <span class="podcast-vocab__term">${escapeHtml(item.term)}</span>
                        <button type="button" class="podcast-vocab__add" data-word="${escapeHtml(item.term)}"
                                title="加入错题本">+</button>
                    </div>
                    <p class="podcast-vocab__def">${escapeHtml(item.definition)}</p>
                </div>`).join('');

            podcastVocabEl.innerHTML = `
                <h3 class="podcast-vocab__heading">
                    本课词汇 <span class="podcast-vocab__count">${list.length}</span>
                </h3>
                <hr>
                <div class="podcast-vocab__grid">${items}</div>`;
            podcastVocabEl.hidden = false;

            podcastVocabEl.querySelectorAll('.podcast-vocab__term').forEach((el) => {
                el.addEventListener('click', () => speakWord(el.textContent));
            });
            podcastVocabEl.querySelectorAll('.podcast-vocab__add').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const word = btn.dataset.word || '';
                    addWordToBook({
                        word,
                        sentence: '',
                        translation: '',
                        book: 'English Pod',
                        lesson: currentPodcastCourse ? currentPodcastCourse.title : ''
                    });
                    updateWordbookCount();
                    btn.classList.add('is-added');
                    btn.textContent = '✓';
                });
            });
        }

        async function loadPodcastVocabulary() {
            if (!isPodcastLesson || !podcastVocabEl || !currentPodcastCourse) {
                return;
            }
            try {
                const res = await fetch('podcast/vocabulary.json');
                if (!res.ok) {
                    return;
                }
                const all = await res.json();
                const list = Array.isArray(all[currentPodcastCourse.id]) ? all[currentPodcastCourse.id] : [];
                if (list.length) {
                    renderPodcastVocab(list);
                }
            } catch (error) {
                console.error('Failed to load podcast vocabulary:', error);
            }
        }

        loadPodcastVocabulary();

        // Lesson navigation functionality
        const prevLessonBtn = document.getElementById('prev-lesson');
        const nextLessonBtn = document.getElementById('next-lesson');
        let defaultLessonsMap = {};
        let currentLessonIndex = isCustomLesson ? customLessonIndex : -1;

        // Load lessons data
        async function loadLessonsData() {
            if (isPodcastLesson) {
                // 播客课程列表来自 window.NCE_PODCAST，无需再拉 data.json
                updateNavigationButtons();
                return;
            }
            try {
                const dataRes = await fetch('static/data.json');
                defaultLessonsMap = await dataRes.json();
            } catch (error) {
                console.error('Failed to load lessons data:', error);
                defaultLessonsMap = {};
            } finally {
                refreshCustomLessonsMap();
                updateNavigationButtons();
            }
        }

        // Update navigation buttons state
        /** 播客的「同等级课程」列表，用于上一课/下一课串联 */
        function getPodcastSiblings() {
            if (!currentPodcastCourse) {
                return [];
            }
            return podcastCourses.filter((item) => item.level === currentPodcastCourse.level);
        }

        function updateNavigationButtons() {
            if (!prevLessonBtn || !nextLessonBtn) {
                return;
            }

            if (isCustomLesson) {
                const lessons = Array.isArray(customLessonsMap[customBookName]) ? customLessonsMap[customBookName] : [];
                prevLessonBtn.disabled = customLessonIndex <= 0;
                nextLessonBtn.disabled = customLessonIndex >= lessons.length - 1;
            } else if (isPodcastLesson) {
                const siblings = getPodcastSiblings();
                const idx = siblings.findIndex((item) => item.id === currentPodcastCourse.id);
                currentLessonIndex = idx;
                prevLessonBtn.disabled = idx <= 0;
                nextLessonBtn.disabled = idx === -1 || idx >= siblings.length - 1;
            } else {
                const lessons = defaultLessonsMap[String(defaultBookNumber)] || [];
                const index = lessons.findIndex((lesson) => lesson.filename === lessonSlug);
                currentLessonIndex = index;
                prevLessonBtn.disabled = index <= 0;
                nextLessonBtn.disabled = index === -1 || index >= lessons.length - 1;
            }
        }

        if (prevLessonBtn) {
            prevLessonBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (isCustomLesson) {
                    if (customLessonIndex > 0) {
                        const lessons = Array.isArray(customLessonsMap[customBookName]) ? customLessonsMap[customBookName] : [];
                        const prevLesson = lessons[customLessonIndex - 1];
                        if (prevLesson) {
                            window.location.href = `lesson.html#CUSTOM/${encodeURIComponent(customBookName)}/${customLessonIndex - 1}`;
                            window.location.reload();
                        }
                    }
                    return;
                }

                if (isPodcastLesson) {
                    const siblings = getPodcastSiblings();
                    const target = currentLessonIndex > 0 ? siblings[currentLessonIndex - 1] : null;
                    if (target) {
                        window.location.href = `lesson.html#PODCAST/${encodeURIComponent(target.id)}`;
                        window.location.reload();
                    }
                    return;
                }

                const lessons = defaultLessonsMap[String(defaultBookNumber)] || [];
                if (currentLessonIndex > 0) {
                    const prevLesson = lessons[currentLessonIndex - 1];
                    if (prevLesson) {
                        window.location.href = `lesson.html#NCE${defaultBookNumber}/${encodeURIComponent(prevLesson.filename)}`;
                        window.location.reload();
                    }
                }
            });
        }

        if (nextLessonBtn) {
            nextLessonBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (isCustomLesson) {
                    const lessons = Array.isArray(customLessonsMap[customBookName]) ? customLessonsMap[customBookName] : [];
                    if (customLessonIndex < lessons.length - 1) {
                        const nextLesson = lessons[customLessonIndex + 1];
                        if (nextLesson) {
                            window.location.href = `lesson.html#CUSTOM/${encodeURIComponent(customBookName)}/${customLessonIndex + 1}`;
                            window.location.reload();
                        }
                    }
                    return;
                }

                if (isPodcastLesson) {
                    const siblings = getPodcastSiblings();
                    const target = (currentLessonIndex > -1 && currentLessonIndex < siblings.length - 1)
                        ? siblings[currentLessonIndex + 1]
                        : null;
                    if (target) {
                        window.location.href = `lesson.html#PODCAST/${encodeURIComponent(target.id)}`;
                        window.location.reload();
                    }
                    return;
                }

                const lessons = defaultLessonsMap[String(defaultBookNumber)] || [];
                if (currentLessonIndex > -1 && currentLessonIndex < lessons.length - 1) {
                    const nextLesson = lessons[currentLessonIndex + 1];
                    if (nextLesson) {
                        window.location.href = `lesson.html#NCE${defaultBookNumber}/${encodeURIComponent(nextLesson.filename)}`;
                        window.location.reload();
                    }
                }
            });
        }

        loadLessonsData();

        /** -------------------------------------------------
         *  错题本（生词本）
         * ------------------------------------------------- */

        const wordbookToggle = document.getElementById('wordbook-toggle');
        const wordbookDrawer = document.getElementById('wordbook-drawer');
        const wordbookClose = document.getElementById('wordbook-close');
        const wordbookBackdrop = document.getElementById('wordbook-backdrop');
        const wordbookList = document.getElementById('wordbook-list');
        const wordbookEmpty = document.getElementById('wordbook-empty');
        const wordbookCount = document.getElementById('wordbook-count');
        const wordbookSearch = document.getElementById('wordbook-search');
        const wordbookClear = document.getElementById('wordbook-clear');
        const wordbookAutoplay = document.getElementById('wordbook-autoplay');
        const wordPopover = document.getElementById('word-popover');
        const wordPopoverText = document.getElementById('word-popover-text');
        const wordPopoverAdd = document.getElementById('word-popover-add');
        const wordPopoverSpeak = document.getElementById('word-popover-speak');
        const wordPopoverHint = document.getElementById('word-popover-hint');

        const AUTOPLAY_KEY = 'nceWordbookAutoplay';
        const MOBILE_QUERY = '(max-width: 768px)';

        /** 当前划词上下文 */
        let pendingSelection = null;

        function isMobileLayout() {
            return typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_QUERY).matches;
        }

        /**
         * 同步播放器实际高度到 CSS 变量，避免抽屉被换行后的播放器遮挡。
         * 播放器在移动端会 flex-wrap 换行，高度并不固定。
         */
        function syncPlayerHeight() {
            const playerContainer = document.querySelector('.player-container');
            if (!playerContainer) {
                return;
            }
            const height = playerContainer.getBoundingClientRect().height;
            if (height > 0) {
                document.documentElement.style.setProperty('--player-height', `${Math.round(height)}px`);
            }
        }

        syncPlayerHeight();
        window.addEventListener('resize', syncPlayerHeight);
        window.addEventListener('orientationchange', syncPlayerHeight);
        if (typeof ResizeObserver === 'function') {
            const playerContainer = document.querySelector('.player-container');
            if (playerContainer) {
                new ResizeObserver(syncPlayerHeight).observe(playerContainer);
            }
        }

        /** -------------------------------------------------
         *  抽屉开合
         * ------------------------------------------------- */

        function openWordbook() {
            if (!wordbookDrawer) return;
            syncPlayerHeight();
            renderWordbook();
            wordbookDrawer.classList.add('is-open');
            wordbookDrawer.setAttribute('aria-hidden', 'false');
            if (wordbookToggle) {
                wordbookToggle.classList.add('is-open');
                wordbookToggle.setAttribute('aria-expanded', 'true');
            }
            // 抽屉打开时隐藏分享按钮，避免遮挡抽屉的关闭按钮
            if (shareContainer) {
                shareContainer.style.visibility = 'hidden';
            }
            if (wordbookBackdrop && isMobileLayout()) {
                wordbookBackdrop.hidden = false;
                requestAnimationFrame(() => wordbookBackdrop.classList.add('is-visible'));
            }
        }

        function closeWordbook() {
            if (!wordbookDrawer) return;
            wordbookDrawer.classList.remove('is-open');
            wordbookDrawer.setAttribute('aria-hidden', 'true');
            if (wordbookToggle) {
                wordbookToggle.classList.remove('is-open');
                wordbookToggle.setAttribute('aria-expanded', 'false');
            }
            if (shareContainer) {
                shareContainer.style.visibility = '';
            }
            if (wordbookBackdrop) {
                wordbookBackdrop.classList.remove('is-visible');
                setTimeout(() => {
                    if (!wordbookBackdrop.classList.contains('is-visible')) {
                        wordbookBackdrop.hidden = true;
                    }
                }, 300);
            }
        }

        function toggleWordbook() {
            if (wordbookDrawer && wordbookDrawer.classList.contains('is-open')) {
                closeWordbook();
            } else {
                openWordbook();
            }
        }

        /** -------------------------------------------------
         *  渲染列表
         * ------------------------------------------------- */

        function updateWordbookCount() {
            if (!wordbookCount) return;
            const total = loadWordBook().length;
            wordbookCount.textContent = total > 99 ? '99+' : String(total);
            wordbookCount.hidden = total === 0;
        }

        function renderWordbook() {
            if (!wordbookList) return;
            const keyword = (wordbookSearch ? wordbookSearch.value : '').trim().toLowerCase();
            const all = loadWordBook();
            const items = keyword
                ? all.filter(
                    (item) =>
                        item.word.includes(keyword) ||
                        item.sentence.toLowerCase().includes(keyword) ||
                        item.translation.toLowerCase().includes(keyword)
                )
                : all;

            wordbookList.innerHTML = '';
            updateWordbookCount();

            if (!items.length) {
                if (wordbookEmpty) {
                    wordbookEmpty.style.display = '';
                    wordbookEmpty.innerHTML = keyword
                        ? '没有匹配的生词。'
                        : '还没有生词。<br>在课文中用鼠标划选一个英文单词，点击「加入错题本」。';
                }
                return;
            }
            if (wordbookEmpty) {
                wordbookEmpty.style.display = 'none';
            }

            const fragment = document.createDocumentFragment();
            items.forEach((item) => {
                fragment.appendChild(createWordCard(item));
            });
            wordbookList.appendChild(fragment);
        }

        /**
         * 构建单张生词卡片。全部使用 textContent 写入，杜绝 HTML 注入。
         * @param {Object} item 生词条目。
         * @returns {HTMLElement} 卡片元素。
         */
        function createWordCard(item) {
            const card = document.createElement('div');
            card.className = 'wordbook-card';
            card.dataset.word = item.word;
            card.setAttribute('role', 'listitem');
            if (item.mastered) {
                card.classList.add('is-mastered');
            }

            const head = document.createElement('div');
            head.className = 'wordbook-card__head';

            const wordEl = document.createElement('span');
            wordEl.className = 'wordbook-card__word';
            wordEl.textContent = item.word;
            wordEl.title = '点击朗读';

            const speakBtn = document.createElement('button');
            speakBtn.type = 'button';
            speakBtn.className = 'wordbook-card__speak';
            speakBtn.textContent = '🔊';
            speakBtn.setAttribute('aria-label', `朗读 ${item.word}`);
            speakBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                handleSpeak(item.word, speakBtn);
            });

            head.append(wordEl, speakBtn);
            card.appendChild(head);

            if (item.sentence) {
                const sentenceEl = document.createElement('p');
                sentenceEl.className = 'wordbook-card__sentence';
                sentenceEl.textContent = item.sentence;
                card.appendChild(sentenceEl);
            }

            if (item.translation) {
                const translationEl = document.createElement('p');
                translationEl.className = 'wordbook-card__translation';
                translationEl.textContent = item.translation;
                card.appendChild(translationEl);
            }

            if (item.lesson) {
                const metaEl = document.createElement('p');
                metaEl.className = 'wordbook-card__meta';
                const parts = [];
                if (item.book) parts.push(item.book);
                parts.push(item.lesson);
                if (item.reviewCount > 0) parts.push(`复习 ${item.reviewCount} 次`);
                metaEl.textContent = parts.join(' · ');
                card.appendChild(metaEl);
            }

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'wordbook-card__remove';
            removeBtn.textContent = '×';
            removeBtn.setAttribute('aria-label', `移除 ${item.word}`);
            removeBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                removeWordFromBook(item.word);
                renderWordbook();
            });
            card.appendChild(removeBtn);

            // 点击卡片：朗读 + 累加复习次数
            card.addEventListener('click', () => {
                if (wordbookAutoplay && wordbookAutoplay.checked) {
                    handleSpeak(item.word);
                }
                updateWordInBook(item.word, { reviewCount: item.reviewCount + 1 });
                const metaEl = card.querySelector('.wordbook-card__meta');
                if (metaEl) {
                    const parts = [];
                    if (item.book) parts.push(item.book);
                    if (item.lesson) parts.push(item.lesson);
                    parts.push(`复习 ${item.reviewCount + 1} 次`);
                    metaEl.textContent = parts.join(' · ');
                }
                item.reviewCount += 1;
            });

            return card;
        }

        /**
         * 朗读并给出视觉反馈。
         * @param {string} word 单词。
         * @param {HTMLElement} [btn] 触发按钮，用于临时禁用。
         */
        function handleSpeak(word, btn) {
            if (!canSpeak()) {
                return false;
            }
            const ok = speakWord(word);
            if (ok && btn) {
                btn.disabled = true;
                setTimeout(() => {
                    btn.disabled = false;
                }, 600);
            }
            return ok;
        }

        /** -------------------------------------------------
         *  划词捕获
         * ------------------------------------------------- */

        /**
         * 判断选区是否落在课文区域内，并返回所在句子与单词。
         * @returns {Object|null} 上下文对象。
         */
        function readSelection() {
            const selection = window.getSelection();
            if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
                return null;
            }
            const raw = selection.toString().trim();
            if (!raw) {
                return null;
            }
            const word = normalizeWord(raw);
            if (!word) {
                return null;
            }

            const range = selection.getRangeAt(0);
            // 选区必须位于课文内容区内
            if (!content.contains(range.commonAncestorContainer)) {
                return null;
            }
            const sentenceEl = (range.startContainer.nodeType === 1
                ? range.startContainer
                : range.startContainer.parentElement
            )?.closest('.sentence');
            if (!sentenceEl) {
                return null;
            }
            const idx = Number(sentenceEl.dataset.idx);
            const sentenceData = state.data[idx];
            if (!sentenceData) {
                return null;
            }

            // 计算浮层位置：优先选区上方，空间不足则置于下方
            const rect = range.getBoundingClientRect();
            return {
                word,
                sentence: sentenceData.en,
                translation: sentenceData.cn,
                rect
            };
        }

        function hideWordPopover() {
            if (!wordPopover) return;
            wordPopover.classList.remove('is-visible');
            wordPopover.setAttribute('aria-hidden', 'true');
            pendingSelection = null;
        }

        function showWordPopover(context) {
            if (!wordPopover || !context) return;
            pendingSelection = context;

            if (wordPopoverText) {
                wordPopoverText.textContent = context.word;
            }
            if (wordPopoverHint) {
                wordPopoverHint.textContent = '';
            }
            if (wordPopoverAdd) {
                const exists = isWordInBook(context.word);
                wordPopoverAdd.disabled = exists;
                wordPopoverAdd.textContent = exists ? '已在错题本' : '加入错题本';
            }

            wordPopover.classList.add('is-visible');
            wordPopover.setAttribute('aria-hidden', 'false');

            // 定位：先渲染再测量，避免尺寸为 0
            const popoverRect = wordPopover.getBoundingClientRect();
            const gap = 10;
            const viewportW = window.innerWidth;
            const viewportH = window.innerHeight;

            let left = context.rect.left + context.rect.width / 2 - popoverRect.width / 2;
            left = Math.min(Math.max(left, 8), viewportW - popoverRect.width - 8);

            let top = context.rect.top - popoverRect.height - gap;
            if (top < 8) {
                top = context.rect.bottom + gap;
            }
            top = Math.min(Math.max(top, 8), viewportH - popoverRect.height - 8);

            wordPopover.style.left = `${Math.round(left)}px`;
            wordPopover.style.top = `${Math.round(top)}px`;
        }

        // 划词结束后弹出浮层。使用 mouseup / touchend 而非 selectionchange，
        // 因为后者在拖动过程中会高频触发。
        function handleSelectionEnd(event) {
            // 浮层内部的点击不应重新触发划词逻辑
            if (wordPopover && event.target instanceof Node && wordPopover.contains(event.target)) {
                return;
            }
            // 短暂延迟，让浏览器先完成选区更新
            setTimeout(() => {
                const context = readSelection();
                if (context) {
                    showWordPopover(context);
                } else {
                    hideWordPopover();
                }
            }, 10);
        }

        content.addEventListener('mouseup', handleSelectionEnd);
        content.addEventListener('touchend', handleSelectionEnd);

        // 点击空白处收起浮层（但保留选区，方便用户点「加入」）
        document.addEventListener('mousedown', (event) => {
            if (!wordPopover || !wordPopover.classList.contains('is-visible')) {
                return;
            }
            if (wordPopover.contains(event.target)) {
                return;
            }
            hideWordPopover();
        });

        if (wordPopoverAdd) {
            wordPopoverAdd.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!pendingSelection) return;
                const { added } = addWordToBook({
                    word: pendingSelection.word,
                    sentence: pendingSelection.sentence,
                    translation: pendingSelection.translation,
                    book: isCustomLesson ? customBookName : defaultBookToken,
                    lesson: isCustomLesson ? String(customLessonIndex + 1) : lessonSlug
                });
                updateWordbookCount();
                if (wordPopoverAdd) {
                    wordPopoverAdd.disabled = true;
                    wordPopoverAdd.textContent = '已在错题本';
                }
                if (wordPopoverHint) {
                    wordPopoverHint.textContent = added ? '已加入错题本' : '该单词已在错题本中';
                }
                if (wordbookDrawer && wordbookDrawer.classList.contains('is-open')) {
                    renderWordbook();
                }
                // 收起选区，避免浮层残留
                const selection = window.getSelection();
                if (selection) {
                    selection.removeAllRanges();
                }
                setTimeout(hideWordPopover, 900);
            });
        }

        if (wordPopoverSpeak) {
            wordPopoverSpeak.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!pendingSelection) return;
                const ok = handleSpeak(pendingSelection.word, wordPopoverSpeak);
                if (wordPopoverHint) {
                    wordPopoverHint.textContent = ok ? '' : '当前浏览器不支持语音合成';
                }
            });
        }

        /** -------------------------------------------------
         *  事件绑定
         * ------------------------------------------------- */

        if (wordbookToggle) {
            wordbookToggle.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleWordbook();
            });
        }
        if (wordbookClose) {
            wordbookClose.addEventListener('click', closeWordbook);
        }
        if (wordbookBackdrop) {
            wordbookBackdrop.addEventListener('click', closeWordbook);
        }
        // 点击抽屉以外的区域（如左侧课文区）收起错题本
        document.addEventListener('pointerdown', (event) => {
            if (!wordbookDrawer || !wordbookDrawer.classList.contains('is-open')) {
                return;
            }
            const target = event.target;
            if (!(target instanceof Node)) {
                return;
            }
            // 点在抽屉内部或开关按钮上时不收起
            if (wordbookDrawer.contains(target)) {
                return;
            }
            if (wordbookToggle && wordbookToggle.contains(target)) {
                return;
            }
            closeWordbook();
        });
        if (wordbookSearch) {
            wordbookSearch.addEventListener('input', renderWordbook);
        }
        if (wordbookClear) {
            wordbookClear.addEventListener('click', () => {
                if (!loadWordBook().length) {
                    return;
                }
                if (window.confirm('确定要清空错题本吗？此操作不可撤销。')) {
                    clearWordBook();
                    renderWordbook();
                }
            });
        }
        if (wordbookAutoplay) {
            // 默认开启自动发音
            let saved = null;
            try {
                saved = localStorage.getItem(AUTOPLAY_KEY);
            } catch (_) {
                /* noop */
            }
            wordbookAutoplay.checked = saved === null ? true : saved === '1';
            wordbookAutoplay.addEventListener('change', () => {
                try {
                    localStorage.setItem(AUTOPLAY_KEY, wordbookAutoplay.checked ? '1' : '0');
                } catch (_) {
                    /* noop */
                }
            });
        }

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                if (wordPopover && wordPopover.classList.contains('is-visible')) {
                    hideWordPopover();
                    return;
                }
                if (wordbookDrawer && wordbookDrawer.classList.contains('is-open')) {
                    closeWordbook();
                }
            }
        });

        // 语音列表在部分浏览器异步加载，提前触发一次以填充缓存
        if (canSpeak()) {
            window.speechSynthesis.getVoices();
            window.speechSynthesis.addEventListener('voiceschanged', () => {
                window.speechSynthesis.getVoices();
            });
        }

        // 初始渲染计数
        updateWordbookCount();

    })
})();
