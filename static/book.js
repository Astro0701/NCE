(() => {
    document.addEventListener('DOMContentLoaded', () => {
        const DEFAULT_BOOKS = [1, 2, 3, 4];
        const defaultContainers = DEFAULT_BOOKS.map((num) => document.getElementById(`book-${num}`));
        const lessonContainers = DEFAULT_BOOKS.reduce((acc, num) => {
            acc[num] = document.getElementById(`book-${num}-lessons`);
            return acc;
        }, {});
        const prevButtons = document.querySelectorAll('#prev-book');
        const nextButtons = document.querySelectorAll('#next-book');
        const customRoot = document.getElementById('custom-books-root');

        let defaultLessonsData = {};
        let customLessonsData = {};
        let customBookNames = [];
        let history = JSON.parse(localStorage.getItem('ncePlaybackHistory') || '[]');

        /** 重新读取最近播放记录（从课程页返回时列表要显示最新的 last-read） */
        function refreshStoredHistory() {
            history = JSON.parse(localStorage.getItem('ncePlaybackHistory') || '[]');
        }

        /** 读取某本课本各课的学习次数，供列表徽标渲染 */
        function getLessonStudyCountsFor(bookToken) {
            if (!utils || typeof utils.getLessonStudyCounts !== 'function') {
                return {};
            }
            return utils.getLessonStudyCounts(bookToken) || {};
        }

        let currentDefaultBook = 1;
        let currentCustomBookIndex = 0;
        let customElements = null;
        const utils = window.NCEUtils;
        if (!utils) {
            console.error('NCEUtils is not available.');
            return;
        }

        const {
            createPlaceholderCover,
            parseCustomBookKey,
            getCustomLessonsWithDefaults,
            escapeHtml
        } = utils;

        function parseHash() {
            const hash = (location.hash || '').slice(1).split('?')[0];
            if (!hash) {
                return { type: 'default', defaultBook: 1 };
            }
            const parts = hash.split('/');
            const key = parts[0];
            if (key === 'CUSTOM') {
                const bookName = decodeURIComponent(parts[1] || '');
                return { type: 'custom', customBookName: bookName };
            }
            const num = parseInt(key.replace('NCE', ''), 10);
            if (!Number.isInteger(num) || num < 1 || num > 4) {
                return { type: 'default', defaultBook: 1 };
            }
            return { type: 'default', defaultBook: num };
        }

        function getDefaultLastRead(bookNumber) {
            const target = String(bookNumber);
            return history.find((entry) => {
                if (!entry) return false;
                const isDefault = !entry.bookType || entry.bookType === 'default';
                return isDefault && entry.book === target;
            });
        }

        function getCustomLastRead(bookName) {
            return history.find((entry) => {
                if (!entry) return false;
                if (entry.bookType === 'custom') {
                    return entry.customBookName === bookName;
                }
                return entry.book === 'CUSTOM' && entry.customBookName === bookName;
            });
        }

        function renderDefaultLessons(bookNumber) {
            const container = lessonContainers[bookNumber];
            if (!container) {
                return;
            }
            const lessons = defaultLessonsData[bookNumber];
            if (!Array.isArray(lessons)) {
                container.innerHTML = '';
                return;
            }
            const lastRead = getDefaultLastRead(bookNumber);
            const lastLesson = lastRead ? lastRead.lesson : null;
            const studyCounts = getLessonStudyCountsFor(`NCE${bookNumber}`);

            container.innerHTML = '';
            lessons.forEach((lesson, index) => {
                let lessonNumber = index + 1;
                if (bookNumber === 1) {
                    lessonNumber = index * 2 + 1;
                    lessonNumber = `${lessonNumber}&${lessonNumber + 1}`;
                }
                const studyCount = Number(studyCounts[lesson.filename]) || 0;
                const element = document.createElement('a');
                element.href = `lesson.html#NCE${bookNumber}/${encodeURIComponent(lesson.filename)}`;
                element.className = 'lesson-item';
                if (lastLesson && lastLesson === lesson.filename) {
                    element.classList.add('last-read');
                }
                element.innerHTML = `
                    <span class="lesson-number">第${lessonNumber}课</span>
                    <span class="lesson-title">${escapeHtml(lesson.title)}</span>
                    <span class="lesson-study-badge${studyCount > 0 ? '' : ' is-empty'}">${studyCount > 0 ? `已学习 ${studyCount} 次` : '未学习'}</span>
                `;
                container.appendChild(element);
            });
        }

        function renderAllDefaultLessons() {
            DEFAULT_BOOKS.forEach(renderDefaultLessons);
        }

        function setDefaultNavState(bookNumber) {
            prevButtons.forEach((btn) => {
                btn.disabled = bookNumber === 1;
            });
            nextButtons.forEach((btn) => {
                btn.disabled = bookNumber === 4;
            });
        }

        function hideAllContainers() {
            defaultContainers.forEach((container) => {
                if (container) {
                    container.classList.remove('active');
                }
            });
            if (customElements) {
                customElements.container.classList.remove('active');
            }
        }

        function renderDefaultBook(bookNumber) {
            if (!lessonContainers[bookNumber]) {
                return;
            }
            hideAllContainers();
            const container = document.getElementById(`book-${bookNumber}`);
            if (container) {
                container.classList.add('active');
            }
            setDefaultNavState(bookNumber);
            currentDefaultBook = bookNumber;
        }

        function ensureCustomElements() {
            if (customElements || !customRoot) {
                return customElements;
            }
            const container = document.createElement('div');
            container.id = 'custom-book-container';
            container.className = 'book-container';

            container.innerHTML = `
                <div class="book-header">
                    <button id="custom-prev-book" class="nav-btn" title="上一本">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="15 18 9 12 15 6"></polyline>
                        </svg>
                    </button>
                    <img id="custom-book-cover" src="" alt="Custom Book">
                    <div class="book-title">
                        <h3 id="custom-book-title"></h3>
                        <hr>
                        <p id="custom-book-subtitle"></p>
                    </div>
                    <button id="custom-next-book" class="nav-btn" title="下一本">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                    </button>
                </div>
                <hr>
                <div class="lessons-grid" id="custom-lessons"></div>
            `;
            customRoot.appendChild(container);

            const elements = {
                container,
                prevBtn: container.querySelector('#custom-prev-book'),
                nextBtn: container.querySelector('#custom-next-book'),
                cover: container.querySelector('#custom-book-cover'),
                title: container.querySelector('#custom-book-title'),
                subtitle: container.querySelector('#custom-book-subtitle'),
                lessons: container.querySelector('#custom-lessons')
            };

            elements.prevBtn.addEventListener('click', () => {
                if (currentCustomBookIndex > 0) {
                    const target = customBookNames[currentCustomBookIndex - 1];
                    location.hash = `CUSTOM/${encodeURIComponent(target)}`;
                }
            });

            elements.nextBtn.addEventListener('click', () => {
                if (currentCustomBookIndex < customBookNames.length - 1) {
                    const target = customBookNames[currentCustomBookIndex + 1];
                    location.hash = `CUSTOM/${encodeURIComponent(target)}`;
                }
            });

            customElements = elements;
            return customElements;
        }

        function renderCustomBook(bookName) {
            if (!customBookNames.length) {
                location.hash = `NCE${currentDefaultBook}`;
                renderDefaultBook(currentDefaultBook);
                return;
            }

            let targetName = bookName || customBookNames[0];
            let idx = customBookNames.indexOf(targetName);
            if (idx === -1) {
                idx = 0;
                targetName = customBookNames[0];
            }

            const elements = ensureCustomElements();
            if (!elements) {
                return;
            }

            hideAllContainers();
            elements.container.classList.add('active');

            const lessons = customLessonsData[targetName] || [];
            const { name: displayName, cover } = parseCustomBookKey(targetName);
            elements.cover.src = cover || createPlaceholderCover(displayName);
            elements.cover.alt = displayName;
            elements.title.textContent = displayName;
            elements.subtitle.textContent = lessons.length ? `共 ${lessons.length} 课` : '暂无课程';
            elements.lessons.innerHTML = '';

            const lastRead = getCustomLastRead(targetName);
            let lastIndex = Number.isInteger(lastRead?.customLessonIndex) ? lastRead.customLessonIndex : NaN;
            if (Number.isNaN(lastIndex) && lastRead && typeof lastRead.lesson === 'string') {
                const parsed = parseInt(lastRead.lesson, 10);
                if (!Number.isNaN(parsed)) {
                    lastIndex = parsed;
                }
            }
            const studyCounts = getLessonStudyCountsFor(targetName);

            lessons.forEach((lesson, lessonIdx) => {
                const item = document.createElement('a');
                item.className = 'lesson-item';
                item.href = `lesson.html#CUSTOM/${encodeURIComponent(targetName)}/${lessonIdx}`;
                const studyCount = Number(studyCounts[lesson.filename]) || 0;
                item.innerHTML = `
                    <span class="lesson-number">第${lessonIdx + 1}课</span>
                    <span class="lesson-title">${escapeHtml(lesson.title)}</span>
                    <span class="lesson-study-badge${studyCount > 0 ? '' : ' is-empty'}">${studyCount > 0 ? `已学习 ${studyCount} 次` : '未学习'}</span>
                `;
                if (!Number.isNaN(lastIndex) && lastIndex === lessonIdx) {
                    item.classList.add('last-read');
                }
                elements.lessons.appendChild(item);
            });

            elements.prevBtn.disabled = idx <= 0;
            elements.nextBtn.disabled = idx >= customBookNames.length - 1;

            currentCustomBookIndex = idx;
            const expectedHash = `#CUSTOM/${encodeURIComponent(targetName)}`;
            if (location.hash !== expectedHash) {
                location.hash = `CUSTOM/${encodeURIComponent(targetName)}`;
            }
        }

        function applyHashView() {
            const info = parseHash();
            if (info.type === 'custom') {
                renderCustomBook(info.customBookName);
            } else {
                renderDefaultBook(info.defaultBook);
                const expectedHash = `#NCE${info.defaultBook}`;
                if (location.hash !== expectedHash) {
                    location.hash = `NCE${info.defaultBook}`;
                }
            }
        }

        prevButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                if (currentDefaultBook > 1) {
                    location.hash = `NCE${currentDefaultBook - 1}`;
                }
            });
        });

        nextButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                if (currentDefaultBook < 4) {
                    location.hash = `NCE${currentDefaultBook + 1}`;
                }
            });
        });

        window.addEventListener('hashchange', () => {
            applyHashView();
        });

        /** 从课程页返回（含 bfcache 恢复）或切回标签页时，刷新学习次数与最近播放 */
        function refreshLessonViews() {
            refreshStoredHistory();
            renderAllDefaultLessons();
            if (customElements && customElements.container.classList.contains('active')) {
                renderCustomBook(customBookNames[currentCustomBookIndex]);
            }
        }

        window.addEventListener('pageshow', (event) => {
            if (event.persisted) {
                refreshLessonViews();
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                refreshLessonViews();
            }
        });

        async function loadData() {
            try {
                const dataRes = await fetch('static/data.json');
                defaultLessonsData = await dataRes.json();
            } catch (error) {
                console.error('Failed to load default lessons data:', error);
                defaultLessonsData = {};
            }
            customLessonsData = getCustomLessonsWithDefaults();
            customBookNames = Object.keys(customLessonsData).filter((name) => {
                const lessons = customLessonsData[name];
                return Array.isArray(lessons) && lessons.length > 0;
            });
        }

        loadData().then(() => {
            renderAllDefaultLessons();
            applyHashView();
        });
    });
})();