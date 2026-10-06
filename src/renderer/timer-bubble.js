/**
 * TimerBubble — 悬浮显示进行中的倒计时/正计时
 * - 每秒本地重算剩余时间
 * - 每 3 秒从主进程拉一次完整状态
 * - 悬停显示暂停/继续/结束按钮
 * - 结构缓存：只在条目变化时重建 DOM，避免 hover 闪烁
 */
class TimerBubble {
    constructor() {
        this.timers = [];
        this.el = document.getElementById('bubble');
        this._lastHeight = 0;
        this._structKey = '';
        this._tickInterval = null;
        this._pollInterval = null;
        this.init();
    }

    async init() {
        // 事件委托：任何按钮点击都在这里处理
        this.el.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            e.stopPropagation();
            e.preventDefault();
            this._handleAction(btn.dataset.action, btn.dataset.id);
        });

        // ========== JS 拖动（rAF 节流 + 同步获取起点） ==========
        let dragging = false;
        let startScreenX = 0, startScreenY = 0;
        let startWinX = 0, startWinY = 0;
        let rafPending = false;
        let pendingX = 0, pendingY = 0;

        this.el.addEventListener('mousedown', async (e) => {
            if (e.target.closest('[data-action]')) return;
            if (e.button !== 0) return;
            e.preventDefault();

            // 先同步拿窗口位置，再进入拖动状态
            let pos;
            try {
                pos = await window.electronAPI.timerBubbleGetPos();
            } catch {
                return;
            }

            dragging = true;
            startScreenX = e.screenX;
            startScreenY = e.screenY;
            startWinX = pos.x;
            startWinY = pos.y;
            this.el.classList.add('dragging');
        });

        window.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const dx = e.screenX - startScreenX;
            const dy = e.screenY - startScreenY;
            pendingX = Math.round(startWinX + dx);
            pendingY = Math.round(startWinY + dy);

            if (rafPending) return;
            rafPending = true;
            requestAnimationFrame(() => {
                rafPending = false;
                window.electronAPI.timerBubbleSetPos(pendingX, pendingY);
            });
        });

        window.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            this.el.classList.remove('dragging');
            window.electronAPI.timerBubbleSavePos();
        });

        await this.refresh();

        // 每秒重算剩余时间
        this._tickInterval = setInterval(() => {
            this.render();
            this._maybeResize();
        }, 1000);

        // 每 3 秒拉一次完整状态
        this._pollInterval = setInterval(() => this.refresh(), 3000);

        // 倒计时到点 → 立刻刷新
        if (window.electronAPI?.onTimerCompleted) {
            window.electronAPI.onTimerCompleted(() => this.refresh());
        }
        // 主窗口或 Agent 操作了计时器 → 立刻刷新
        if (window.electronAPI?.onTimerUpdated) {
            window.electronAPI.onTimerUpdated(() => this.refresh());
        }
    }

    async refresh() {
        try {
            const r = await window.electronAPI.timerList();
            this.timers = r.success ? r.timers : [];
            this.render();
            this._maybeResize();
        } catch (e) {
            console.warn('[TimerBubble] refresh failed:', e);
        }
    }

    async _handleAction(action, id) {
        try {
            if (action === 'pause') {
                await window.electronAPI.timerPause(id);
            } else if (action === 'resume') {
                await window.electronAPI.timerResume(id);
            } else if (action === 'stop') {
                if (!confirm('确定结束这个计时吗？')) return;
                await window.electronAPI.timerStop(id);
            }
            // 立刻刷新（不等 3 秒 poll）
            await this.refresh();
        } catch (e) {
            console.warn('[TimerBubble] action failed:', e);
        }
    }

    render() {
        const now = Date.now();

        const active = this.timers
            .filter(t => t.state === 'running' || t.state === 'paused')
            .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

        if (active.length === 0) {
            this.el.innerHTML = '<div class="empty">无进行中的计时</div>';
            this._structKey = '';
            return;
        }

        const MAX_SHOW = 3;
        const show = active.slice(0, MAX_SHOW);
        const rest = active.length - show.length;

        // 结构 key：id + state + type，变化时全量重建，否则只更新文本
        const structKey = show.map(t => `${t.id}|${t.state}|${t.type}`).join('~') + `#${rest}`;

        if (structKey !== this._structKey) {
            // 结构变了：全量重建
            const rowsHtml = show.map(t => this._renderRow(t, now)).join('');
            const moreHtml = rest > 0 ? `<div class="more">还有 ${rest} 个</div>` : '';
            this.el.innerHTML = rowsHtml + moreHtml;
            this._structKey = structKey;
        } else {
            // 结构没变：只更新时间和图标，保留 DOM（避免 hover 闪烁）
            for (const t of show) {
                const row = this.el.querySelector(`[data-tid="${t.id}"]`);
                if (!row) continue;
                const timeEl = row.querySelector('.time');
                const iconEl = row.querySelector('.icon');
                if (timeEl) {
                    const elapsed = this._getElapsed(t, now);
                    if (t.type === 'countdown') {
                        timeEl.textContent = this._fmt(Math.max(0, t.durationMs - elapsed));
                    } else {
                        timeEl.textContent = this._fmt(elapsed);
                    }
                }
                if (iconEl) {
                    iconEl.textContent = t.type === 'countdown'
                        ? (t.state === 'paused' ? '⏸' : '⏳')
                        : (t.state === 'paused' ? '⏸' : '⏱');
                }
            }
        }
    }

    _renderRow(t, now) {
        const elapsed = this._getElapsed(t, now);
        let display, timeClass;
        if (t.type === 'countdown') {
            display = this._fmt(Math.max(0, t.durationMs - elapsed));
            timeClass = t.state === 'paused' ? 'time paused' : 'time';
        } else {
            display = this._fmt(elapsed);
            timeClass = t.state === 'paused' ? 'time paused' : 'time countup';
        }
        const icon = t.type === 'countdown'
            ? (t.state === 'paused' ? '⏸' : '⏳')
            : (t.state === 'paused' ? '⏸' : '⏱');

        // 暂停/继续按钮
        let toggleBtn = '';
        if (t.state === 'running') {
            toggleBtn = `<button class="row-action-btn" data-action="pause" data-id="${t.id}" title="暂停">⏸</button>`;
        } else if (t.state === 'paused') {
            toggleBtn = `<button class="row-action-btn" data-action="resume" data-id="${t.id}" title="继续">▶</button>`;
        }

        // 结束按钮
        const stopBtn = `<button class="row-action-btn close" data-action="stop" data-id="${t.id}" title="结束计时">×</button>`;

        return `<div class="row" data-tid="${t.id}">
            <span class="icon">${icon}</span>
            <span class="name">${t.pomodoroMode ? '🍅 ' : ''}${this._esc(t.name)}</span>
            <span class="${timeClass}">${display}</span>
            <div class="row-actions">${toggleBtn}${stopBtn}</div>
        </div>`;
    }

    _maybeResize() {
        const active = this.timers.filter(t => t.state === 'running' || t.state === 'paused');
        const shown = Math.min(active.length, 3);
        const hasMore = active.length > 3;

        let h;
        if (shown === 0) {
            h = 44;
        } else {
            h = 12 + shown * 26 + (hasMore ? 18 : 0);
        }
        h = Math.max(44, Math.min(180, h));

        // 拖动中不调整尺寸，避免和拖动冲突
        if (this.el.classList.contains('dragging')) return;

        if (h !== this._lastHeight) {
            this._lastHeight = h;
            window.electronAPI?.resizeTimerBubble?.(h);
        }
    }

    _getElapsed(t, now) {
        if (t.state === 'paused') {
            return t.elapsedBeforePause || 0;
        }
        return (t.elapsedBeforePause || 0) + (now - (t.startedAt || now));
    }

    _fmt(ms) {
        if (!ms || ms < 0) ms = 0;
        const totalSec = Math.floor(ms / 1000);
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        if (h > 0) {
            return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    _esc(s) {
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
}

document.addEventListener('DOMContentLoaded', () => new TimerBubble());