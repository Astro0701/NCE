/* ============================================================
   English Pod · 列表页逻辑
   数据来源：static/podcast-data.js（由 tools/build_podcast_site.py 生成）
   ============================================================ */
(() => {
    document.addEventListener('DOMContentLoaded', () => {
        const config = window.NCE_PODCAST;
        const listEl = document.getElementById('podcast-list');
        const emptyEl = document.getElementById('podcast-empty');
        const summaryEl = document.getElementById('podcast-summary');
        const tabsEl = document.getElementById('podcast-tabs');
        const searchEl = document.getElementById('podcast-search');

        if (!config || !Array.isArray(config.courses) || !listEl) {
            return;
        }

        const courses = config.courses;
        let activeLevel = '全部';
        let keyword = '';

        function escapeHtml(str) {
            return String(str == null ? '' : str).replace(/[&<>"']/g, (ch) => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            }[ch]));
        }

        function formatDuration(seconds) {
            const total = Math.round(Number(seconds) || 0);
            if (!total) {
                return '--';
            }
            const m = Math.floor(total / 60);
            const s = total % 60;
            return `${m}:${String(s).padStart(2, '0')}`;
        }

        /** 读取播客的播放进度：{ courseId: {position, timestamp} } */
        function readProgress() {
            const map = {};
            try {
                const history = JSON.parse(localStorage.getItem('ncePlaybackHistory') || '[]');
                history.forEach((item) => {
                    if (!item || item.book !== 'PODCAST' || !item.lesson) {
                        return;
                    }
                    if (!map[item.lesson]) {
                        map[item.lesson] = {
                            position: Number(item.lastPosition) || 0,
                            timestamp: Number(item.timestamp) || 0
                        };
                    }
                });
            } catch (_) {
                /* noop */
            }
            return map;
        }

        function matches(course) {
            if (activeLevel !== '全部' && course.level !== activeLevel) {
                return false;
            }
            if (!keyword) {
                return true;
            }
            const haystack = `${course.title || ''} ${course.id || ''}`.toLowerCase();
            return haystack.includes(keyword);
        }

        function render() {
            const progress = readProgress();
            const utils = window.NCEUtils;
            const studyCounts = (utils && typeof utils.getLessonStudyCounts === 'function')
                ? utils.getLessonStudyCounts('PODCAST')
                : {};
            const visible = courses.filter(matches);

            listEl.innerHTML = visible.map((course) => {
                const playable = course.local !== false;
                const prog = progress[course.id];
                const meta = [
                    `<span>${formatDuration(course.duration)}</span>`,
                    `<span>${course.cueCount} 句</span>`,
                    `<span>${course.vocabCount} 词汇</span>`
                ];
                if (prog && prog.position > 3) {
                    meta.push(`<span>已听至 ${formatDuration(prog.position)}</span>`);
                }
                const studyCount = Number(studyCounts[course.id]) || 0;
                if (studyCount > 0) {
                    meta.push(`<span>已学习 ${studyCount} 次</span>`);
                }

                const inner = `
                    <div class="podcast-card__top">
                        <span class="podcast-card__level" data-level="${escapeHtml(course.level)}">${escapeHtml(course.level)}</span>
                        <span class="podcast-card__ep">EP ${course.number}</span>
                    </div>
                    <h3 class="podcast-card__title">${escapeHtml(course.title)}</h3>
                    <div class="podcast-card__meta">${meta.join('')}</div>
                    ${playable ? '' : '<span class="podcast-card__badge">未上线</span>'}`;

                if (!playable) {
                    return `<div class="podcast-card is-locked" role="listitem">${inner}</div>`;
                }
                return `<a class="podcast-card" role="listitem"
                           href="lesson.html#PODCAST/${encodeURIComponent(course.id)}">${inner}</a>`;
            }).join('');

            emptyEl.hidden = visible.length > 0;

            const totalMinutes = Math.round(courses.reduce((s, c) => s + (Number(c.duration) || 0), 0) / 60);
            summaryEl.innerHTML = `共 <strong>${courses.length}</strong> 节课，`
                + `当前显示 <strong>${visible.length}</strong> 节，`
                + `总时长约 <strong>${totalMinutes}</strong> 分钟`;
        }

        if (tabsEl) {
            tabsEl.addEventListener('click', (e) => {
                const btn = e.target.closest('button[data-level]');
                if (!btn) {
                    return;
                }
                activeLevel = btn.dataset.level;
                tabsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
                render();
            });
        }

        if (searchEl) {
            searchEl.addEventListener('input', () => {
                keyword = searchEl.value.trim().toLowerCase();
                render();
            });
        }

        render();

        // 从课程页返回（含 bfcache 恢复）时刷新学习次数
        window.addEventListener('pageshow', (event) => {
            if (event.persisted) {
                render();
            }
        });
    });
})();
