/**
 * Timer — 倒计时 / 正计时窗口
 */
class TimerApp {
    constructor() {
        this.timers = [];
        this.editing = null;
        this.creatingPomodoro = false;   // 是否在创建番茄钟
        this.defaultNotify = '到时间了';
        this._tickInterval = null;

        this.el = {
            closeBtn: document.getElementById('close-btn'),
            btnNew: document.getElementById('btn-new'),
            btnRefresh: document.getElementById('btn-refresh'),
            content: document.getElementById('content'),
            modalMask: document.getElementById('modal-mask'),
            modalTitle: document.getElementById('modal-title'),
            fName: document.getElementById('f-name'),
            fTypeRadios: document.querySelectorAll('input[name="f-type"]'),
            durationSection: document.getElementById('duration-section'),
            fHours: document.getElementById('f-hours'),
            fMinutes: document.getElementById('f-minutes'),
            fSeconds: document.getElementById('f-seconds'),
            fNotify: document.getElementById('f-notify'),
            fCalendar: document.getElementById('f-calendar'),
            modalStatus: document.getElementById('modal-status'),
            btnCancel: document.getElementById('btn-cancel'),
            btnSave: document.getElementById('btn-save')
        };

        this.init();
    }

    async init() {
        this.bindEvents();
        await this._loadDefaultNotify();
        await this.loadTimers();
        // 每秒刷新 UI
        this._tickInterval = setInterval(() => this.render(), 1000);

        if (window.electronAPI?.onTimerCompleted) {
            window.electronAPI.onTimerCompleted((timer) => {
                console.log('[Timer UI] completed:', timer.name);
                this.loadTimers();
            });
        }
        if (window.electronAPI?.onTimerUpdated) {
            window.electronAPI.onTimerUpdated(() => {
                this.loadTimers();
            });
        }
    }

    async _loadDefaultNotify() {
        try {
            const cfg = await window.electronAPI.loadConfig();
            if (cfg && cfg.timerDefaultNotify) {
                this.defaultNotify = cfg.timerDefaultNotify;
            }
        } catch (e) {
            console.warn('[Timer] load default notify failed:', e);
        }
    }

    bindEvents() {
        this.el.closeBtn.onclick = () => window.close();
        this.el.btnNew.onclick = () => this.openModal(null);
        this.el.btnRefresh.onclick = () => this.loadTimers();
        this.el.btnCancel.onclick = () => this.closeModal();
        this.el.btnSave.onclick = () => this.saveModal();

        this.el.fTypeRadios.forEach(r => {
            r.addEventListener('change', () => this.updateDurationVisibility());
        });

        // 快捷按钮用事件委托（modal 被重建后依然有效）
        this.el.modalMask.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-preset]');
            if (!btn) return;
            e.preventDefault();
            const sec = Number(btn.dataset.preset);
            this.el.fHours.value = 0;
            this.el.fMinutes.value = Math.floor(sec / 60);
            this.el.fSeconds.value = sec % 60;
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.el.modalMask.classList.contains('show')) {
                    this.closeModal();
                } else {
                    window.close();
                }
            }
        });

        document.getElementById('btn-new-pomodoro')?.addEventListener('click', () => this.openPomodoroModal());
        this.el.modalMask.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-pomo-preset]');
            if (!btn) return;
            e.preventDefault();
            const [w, b] = btn.dataset.pomoPreset.split(',').map(Number);
            document.getElementById('pomo-work').value = w;
            document.getElementById('pomo-break').value = b;
        });
    }

    updateDurationVisibility() {
        const type = this.getSelectedType();
        this.el.durationSection.style.display = type === 'countdown' ? '' : 'none';
        const notifySection = document.getElementById('notify-section');
        if (notifySection) {
            notifySection.style.display = type === 'countdown' ? '' : 'none';
        }
    }

    getSelectedType() {
        for (const r of this.el.fTypeRadios) {
            if (r.checked) return r.value;
        }
        return 'countdown';
    }

    async loadTimers() {
        try {
            const r = await window.electronAPI.timerList();
            this.timers = r.success ? r.timers : [];
            this.render();
        } catch (e) {
            console.error('[Timer] load failed:', e);
        }
    }

    render() {
        const now = Date.now();

        // 排序：running > paused > done；同类按创建时间倒序
        const sorted = this.timers.slice().sort((a, b) => {
            const order = { running: 0, paused: 1, done: 2 };
            const oa = order[a.state] ?? 3;
            const ob = order[b.state] ?? 3;
            if (oa !== ob) return oa - ob;
            return (b.createdAt || 0) - (a.createdAt || 0);
        });

        if (sorted.length === 0) {
            this.el.content.innerHTML = '<div class="empty">还没有任何计时<br><br>点上方「+ 新建」开始</div>';
            return;
        }

        const html = sorted.map(t => this.renderCard(t, now)).join('');
        this.el.content.innerHTML = html;

        // 绑定操作
        this.el.content.querySelectorAll('[data-action]').forEach(btn => {
            btn.onclick = async (e) => {
                const action = btn.dataset.action;
                const id = btn.dataset.id;
                await this.handleAction(action, id);
            };
        });
    }

    renderCard(t, now) {
        const elapsed = this._getElapsed(t, now);
        let display, badge, cardClass;

        // 番茄钟特殊处理
        if (t.pomodoroMode && t.pomodoro) {
            return this._renderPomodoroCard(t, now);
        }

        if (t.state === 'done') {
            cardClass = 'timer-card done';
            badge = '<span class="timer-badge done">已完成</span>';
            if (t.type === 'countdown') {
                display = this._fmt(t.durationMs);
            } else {
                display = this._fmt(elapsed);
            }
        } else if (t.state === 'paused') {
            cardClass = 'timer-card paused';
            badge = '<span class="timer-badge paused">已暂停</span>';
            display = t.type === 'countdown'
                ? this._fmt(Math.max(0, t.durationMs - elapsed))
                : this._fmt(elapsed);
        } else {
            cardClass = 'timer-card' + (t.type === 'countup' ? ' countup' : '');
            badge = '';
            display = t.type === 'countdown'
                ? this._fmt(Math.max(0, t.durationMs - elapsed))
                : this._fmt(elapsed);
        }

        let actions = '';
        if (t.state === 'running') {
            actions += `<button class="btn btn-secondary btn-sm" data-action="pause" data-id="${t.id}">⏸ 暂停</button>`;
            if (t.type === 'countup') {
                actions += `<button class="btn btn-primary btn-sm" data-action="stop" data-id="${t.id}">⏹ 停止</button>`;
            }
        } else if (t.state === 'paused') {
            actions += `<button class="btn btn-primary btn-sm" data-action="resume" data-id="${t.id}">▶ 继续</button>`;
            actions += `<button class="btn btn-secondary btn-sm" data-action="stop" data-id="${t.id}">⏹ 停止</button>`;
        } else if (t.state === 'done') {
            actions += `<button class="btn btn-primary btn-sm" data-action="restart" data-id="${t.id}">🔄 再计时</button>`;
        }
        actions += `<button class="btn btn-secondary btn-sm" data-action="edit" data-id="${t.id}">✎ 编辑</button>`;
        actions += `<button class="btn btn-danger btn-sm" data-action="delete" data-id="${t.id}">✕</button>`;

        return `
            <div class="${cardClass}">
                <div class="timer-header">
                    <div class="timer-name">${this._esc(t.name)}</div>
                    ${badge}
                </div>
                <div class="timer-display">${display}</div>
                <div class="timer-actions">${actions}</div>
            </div>
        `;
    }

    _renderPomodoroCard(t, now) {
        const elapsed = this._getElapsed(t, now);
        const p = t.pomodoro;
        const remain = Math.max(0, t.durationMs - elapsed);
        const display = this._fmt(remain);

        const phaseStr = { work: '工作中', break: '短休息', longBreak: '长休息' }[p.phase] || p.phase;
        const badgeText = t.state === 'paused' ? '已暂停'
                        : t.state === 'done' ? '已完成'
                        : `${phaseStr}`;
        const badgeClass = t.state === 'paused' ? 'paused'
                          : t.state === 'done' ? 'done' : '';

        let actions = '';
        if (t.state === 'running') {
            actions += `<button class="btn btn-secondary btn-sm" data-action="pause" data-id="${t.id}">⏸ 暂停</button>`;
            actions += `<button class="btn btn-danger btn-sm" data-action="stop" data-id="${t.id}">⏹ 结束番茄钟</button>`;
        } else if (t.state === 'paused') {
            actions += `<button class="btn btn-primary btn-sm" data-action="resume" data-id="${t.id}">▶ 继续</button>`;
            actions += `<button class="btn btn-danger btn-sm" data-action="stop" data-id="${t.id}">⏹ 结束番茄钟</button>`;
        } else if (t.state === 'done') {
            actions += `<button class="btn btn-primary btn-sm" data-action="restart-pomodoro" data-id="${t.id}">🍅 再来一轮</button>`;
        }
        actions += `<button class="btn btn-secondary btn-sm" data-action="edit" data-id="${t.id}">✎ 编辑</button>`;
        actions += `<button class="btn btn-danger btn-sm" data-action="delete" data-id="${t.id}">✕</button>`;

        return `
            <div class="timer-card ${t.state === 'done' ? 'done' : t.state === 'paused' ? 'paused' : 'pomodoro'}">
                <div class="timer-header">
                    <div class="timer-name">🍅 ${this._esc(t.name)}</div>
                    ${badgeText ? `<span class="timer-badge ${badgeClass}">${badgeText}</span>` : ''}
                </div>
                <div style="font-size:11px;color:#888;text-align:center;margin:4px 0;">
                    第 ${p.currentRound} / ${p.totalRounds} 轮 · 工作 ${p.workMin} 分 / 休息 ${p.breakMin} 分
                </div>
                <div class="timer-display">${display}</div>
                <div class="timer-actions">${actions}</div>
            </div>
        `;
    }

    _getElapsed(t, now) {
        if (t.state === 'paused') {
            // pauseTimer 已经把 (暂停时刻 - startedAt) 累加进 elapsedBeforePause
            return t.elapsedBeforePause || 0;
        }
        if (t.state === 'done') {
            return t.type === 'countdown' ? t.durationMs : (t.elapsedBeforePause || 0);
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

    async handleAction(action, id) {
        try {
            if (action === 'pause') {
                await window.electronAPI.timerPause(id);
                await this.loadTimers();
            } else if (action === 'resume') {
                await window.electronAPI.timerResume(id);
                await this.loadTimers();
            } else if (action === 'stop') {
                if (!confirm('确定停止吗？会记录到日程（若已勾选）。')) return;
                await window.electronAPI.timerStop(id);
                await this.loadTimers();
            } else if (action === 'restart') {
                this.openRestartModal(id);
            } else if (action === 'edit') {
                this.openModal(id);
            } else if (action === 'delete') {
                if (!confirm('确定删除吗？')) return;
                await window.electronAPI.timerDelete(id);
                await this.loadTimers();
            } else if (action === 'restart-pomodoro') {
                const t = this.timers.find(x => x.id === id);
                if (!t) return;
                if (!confirm(`重新开始番茄钟 "${t.name}"？`)) return;
                try {
                    await window.electronAPI.timerDelete(id);
                    await window.electronAPI.timerAddPomodoro({
                        name: t.name,
                        workMin: t.pomodoro.workMin,
                        breakMin: t.pomodoro.breakMin,
                        longBreakMin: t.pomodoro.longBreakMin,
                        roundsBeforeLong: t.pomodoro.roundsBeforeLong,
                        totalRounds: t.pomodoro.totalRounds
                    });
                    await this.loadTimers();
                } catch (e) {
                    alert('失败：' + e.message);
                }
            }
        } catch (e) {
            alert('操作失败：' + e.message);
        }
    }

    openModal(id) {
        this.editing = id;
        this.creatingPomodoro = false;   // ← 加这一行
        const t = id ? this.timers.find(x => x.id === id) : null;

        this.el.modalTitle.textContent = t ? '编辑计时' : '新建计时';
        this.el.btnSave.textContent = t ? '保存' : '开始';
        // 检测是否是番茄钟
        if (t && t.pomodoroMode && t.pomodoro) {
            this.el.modalTitle.textContent = '🍅 编辑番茄钟';
            this.el.fName.value = t.name;
            this.el.fName.disabled = true;  // 名称不可改
            document.getElementById('duration-section').style.display = 'none';
            document.getElementById('notify-section').style.display = 'none';
            const typeRowP = this.el.modalMask.querySelector('.type-row');
            if (typeRowP) typeRowP.style.display = 'none';
            const typeLabelP = document.getElementById('type-label');
            if (typeLabelP) typeLabelP.style.display = 'none';
            document.getElementById('pomodoro-section').style.display = '';
            const calRowP = this.el.fCalendar?.closest('.checkbox-row');
            if (calRowP) calRowP.style.display = 'none';
            document.getElementById('pomo-work').value = t.pomodoro.workMin;
            document.getElementById('pomo-break').value = t.pomodoro.breakMin;
            document.getElementById('pomo-long-break').value = t.pomodoro.longBreakMin;
            document.getElementById('pomo-rounds-before-long').value = t.pomodoro.roundsBeforeLong;
            document.getElementById('pomo-total-rounds').value = t.pomodoro.totalRounds;
            this.el.modalStatus.className = 'status-bar';
            this.el.modalMask.classList.add('show');
            return;
        }
        if (t) {
            this.el.fName.value = t.name;
            for (const r of this.el.fTypeRadios) {
                r.checked = (r.value === t.type);
                r.disabled = true;  // 类型不可改
            }
            const ms = t.durationMs || 0;
            this.el.fHours.value = Math.floor(ms / 3600000);
            this.el.fMinutes.value = Math.floor((ms % 3600000) / 60000);
            this.el.fSeconds.value = Math.floor((ms % 60000) / 1000);
            this.el.fNotify.value = t.notifyText || '';
            this.el.fCalendar.checked = t.writeToCalendar !== false;
        } else {
            this.el.fName.value = '';
            for (const r of this.el.fTypeRadios) {
                r.disabled = false;
            }
            this.el.fTypeRadios[0].checked = true;
            this.el.fTypeRadios[1].checked = false;
            this.el.fHours.value = 0;
            this.el.fMinutes.value = 3;
            this.el.fSeconds.value = 0;
            this.el.fNotify.value = this.defaultNotify || '到时间了';
            this.el.fCalendar.checked = true;
        }

        this.updateDurationVisibility();
        this.el.modalStatus.className = 'status-bar';
        // 恢复普通模式的 UI（如果之前被番茄钟模式改过）
        document.getElementById('duration-section').style.display = '';
        document.getElementById('notify-section').style.display = '';
        document.getElementById('pomodoro-section').style.display = 'none';
        const typeRowRestore = this.el.modalMask.querySelector('.type-row');
        if (typeRowRestore) typeRowRestore.style.display = '';
        const typeLabelRestore = document.getElementById('type-label');
        if (typeLabelRestore) typeLabelRestore.style.display = '';
        const calRowRestore = this.el.fCalendar?.closest('.checkbox-row');
        if (calRowRestore) calRowRestore.style.display = '';
        this.el.modalMask.classList.add('show');
        setTimeout(() => this.el.fName.focus(), 80);
    }

    openPomodoroModal() {
        this.editing = null;
        this.creatingPomodoro = true;

        this.el.modalTitle.textContent = '🍅 新建番茄钟';
        this.el.btnSave.textContent = '开始';

        this.el.fName.value = '番茄钟';
        // 隐藏类型/时长/提醒语
        document.getElementById('duration-section').style.display = 'none';
        document.getElementById('notify-section').style.display = 'none';
        // 隐藏类型按钮行（用 CSS 选择器处理）
        const typeRow = this.el.modalMask.querySelector('.type-row');
        if (typeRow) typeRow.style.display = 'none';
        const typeLabel = document.getElementById('type-label');
        if (typeLabel) typeLabel.style.display = 'none';
        // 显示番茄钟配置
        document.getElementById('pomodoro-section').style.display = '';
        // 隐藏"写入日程"复选框（番茄钟自己处理）
        const calRow = this.el.fCalendar?.closest('.checkbox-row');
        if (calRow) calRow.style.display = 'none';
        // 重置为默认
        document.getElementById('pomo-work').value = 25;
        document.getElementById('pomo-break').value = 5;
        document.getElementById('pomo-long-break').value = 15;
        document.getElementById('pomo-rounds-before-long').value = 4;
        document.getElementById('pomo-total-rounds').value = 4;

        this.el.modalStatus.className = 'status-bar';
        this.el.modalMask.classList.add('show');
        setTimeout(() => this.el.fName.focus(), 80);
    }

    closeModal() {
        this.el.modalMask.classList.remove('show');
        this.editing = null;
        this.creatingPomodoro = false;
        if (this.el.fName) this.el.fName.disabled = false;
    }

    async saveModal() {
        const name = this.el.fName.value.trim();
        if (!name) return this.showModalErr('名称不能为空');

        // ★ 番茄钟模式
        if (this.creatingPomodoro) {
            const workMin = Number(document.getElementById('pomo-work').value) || 25;
            const breakMin = Number(document.getElementById('pomo-break').value) || 5;
            const longBreakMin = Number(document.getElementById('pomo-long-break').value) || 15;
            const roundsBeforeLong = Number(document.getElementById('pomo-rounds-before-long').value) || 4;
            const totalRounds = Number(document.getElementById('pomo-total-rounds').value) || 4;

            this.el.btnSave.disabled = true;
            this.el.btnSave.textContent = '启动中...';
            try {
                const r = await window.electronAPI.timerAddPomodoro({
                    name, workMin, breakMin, longBreakMin, roundsBeforeLong, totalRounds
                });
                if (!r.success) {
                    this.showModalErr(r.error);
                    return;
                }
                this.closeModal();
                await this.loadTimers();
            } catch (e) {
                this.showModalErr(e.message);
            } finally {
                this.el.btnSave.disabled = false;
                this.el.btnSave.textContent = '开始';
            }
            return;
        }

        // 编辑番茄钟（只改时长，名称不改）
        const editingTimer = this.editing ? this.timers.find(x => x.id === this.editing) : null;
        if (editingTimer && editingTimer.pomodoroMode && editingTimer.pomodoro) {
            const workMin = Number(document.getElementById('pomo-work').value) || 25;
            const breakMin = Number(document.getElementById('pomo-break').value) || 5;
            const longBreakMin = Number(document.getElementById('pomo-long-break').value) || 15;
            const roundsBeforeLong = Number(document.getElementById('pomo-rounds-before-long').value) || 4;
            const totalRounds = Number(document.getElementById('pomo-total-rounds').value) || 4;
            try {
                await window.electronAPI.timerUpdate({
                    id: editingTimer.id,
                    name: editingTimer.name,
                    pomodoro: { workMin, breakMin, longBreakMin, roundsBeforeLong, totalRounds }
                });
                this.closeModal();
                await this.loadTimers();
            } catch (e) {
                this.showModalErr(e.message);
            }
            return;
        }

        // 普通计时器逻辑
        const type = this.getSelectedType();
        const h = Number(this.el.fHours.value) || 0;
        const m = Number(this.el.fMinutes.value) || 0;
        const s = Number(this.el.fSeconds.value) || 0;
        const durationMs = (h * 3600 + m * 60 + s) * 1000;

        if (!this.editing && type === 'countdown' && durationMs <= 0) {
            return this.showModalErr('倒计时时长必须大于 0');
        }

        // 正计时没有"到点"概念，不保存提醒语
        // 倒计时：用户清空则用默认值
        const rawNotify = this.el.fNotify.value.trim();
        const notifyText = type === 'countdown'
            ? (rawNotify || this.defaultNotify || '到时间了')
            : '';
        const writeToCalendar = this.el.fCalendar.checked;

        this.el.btnSave.disabled = true;
        this.el.btnSave.textContent = '处理中...';

        try {
            let r;
            if (this.editing) {
                r = await window.electronAPI.timerUpdate({
                    id: this.editing,
                    name,
                    notifyText,
                    writeToCalendar
                });
            } else {
                r = await window.electronAPI.timerAdd({
                    name, type, durationMs, notifyText, writeToCalendar
                });
            }
            if (!r.success) {
                this.showModalErr(r.error);
                return;
            }
            this.closeModal();
            await this.loadTimers();
        } catch (e) {
            this.showModalErr(e.message);
        } finally {
            this.el.btnSave.disabled = false;
            this.el.btnSave.textContent = this.editing ? '保存' : '开始';
        }
    }

    showModalErr(msg) {
        this.el.modalStatus.textContent = msg;
        this.el.modalStatus.className = 'status-bar show error';
    }

    /**
     * 完成后"再计时"：只改时长，不重填名称
     */
    openRestartModal(id) {
        const t = this.timers.find(x => x.id === id);
        if (!t) return;

        const isCountdown = t.type === 'countdown';
        const defaultMs = isCountdown ? t.durationMs : 0;

        const html = `
            <h3>继续 "${this._esc(t.name)}"</h3>
            ${isCountdown ? `
                <label>新的时长</label>
                <div class="duration-row">
                    <input type="number" id="rt-hours" value="${Math.floor(defaultMs / 3600000)}" min="0" max="999">
                    <span>时</span>
                    <input type="number" id="rt-minutes" value="${Math.floor((defaultMs % 3600000) / 60000)}" min="0" max="59">
                    <span>分</span>
                    <input type="number" id="rt-seconds" value="${Math.floor((defaultMs % 60000) / 1000)}" min="0" max="59">
                    <span>秒</span>
                </div>
            ` : `
                <p style="font-size:13px;color:#666;">将重新开始正计时。</p>
            `}
            <div class="modal-btns">
                <button class="btn-cancel" id="rt-cancel">取消</button>
                <button class="btn-save" id="rt-ok">开始</button>
            </div>
        `;

        // 复用已有模态框
        const modal = this.el.modalMask.querySelector('.modal');
        const originalHTML = modal.innerHTML;
        modal.innerHTML = html;

        document.getElementById('rt-cancel').onclick = () => {
            modal.innerHTML = originalHTML;
            this.rebindModalElements();
            this.closeModal();
        };
        document.getElementById('rt-ok').onclick = async () => {
            let newDurationMs = 0;
            if (isCountdown) {
                const h = Number(document.getElementById('rt-hours').value) || 0;
                const m = Number(document.getElementById('rt-minutes').value) || 0;
                const s = Number(document.getElementById('rt-seconds').value) || 0;
                newDurationMs = (h * 3600 + m * 60 + s) * 1000;
                if (newDurationMs <= 0) {
                    alert('时长必须大于 0');
                    return;
                }
            }
            try {
                await window.electronAPI.timerRestart(id, newDurationMs);
                modal.innerHTML = originalHTML;
                this.rebindModalElements();
                this.closeModal();
                await this.loadTimers();
            } catch (e) {
                alert('失败：' + e.message);
            }
        };

        this.el.modalMask.classList.add('show');
    }

    /**
     * openRestartModal 会替换 modal 内容，导致 this.el 里的引用失效，需要重绑
     */
    rebindModalElements() {
        this.el.modalTitle = document.getElementById('modal-title');
        this.el.fName = document.getElementById('f-name');
        this.el.fTypeRadios = document.querySelectorAll('input[name="f-type"]');
        this.el.durationSection = document.getElementById('duration-section');
        this.el.fHours = document.getElementById('f-hours');
        this.el.fMinutes = document.getElementById('f-minutes');
        this.el.fSeconds = document.getElementById('f-seconds');
        this.el.fNotify = document.getElementById('f-notify');
        this.el.fCalendar = document.getElementById('f-calendar');
        this.el.modalStatus = document.getElementById('modal-status');
        this.el.btnCancel = document.getElementById('btn-cancel');
        this.el.btnSave = document.getElementById('btn-save');

        if (this.el.btnCancel) this.el.btnCancel.onclick = () => this.closeModal();
        if (this.el.btnSave) this.el.btnSave.onclick = () => this.saveModal();
        this.el.fTypeRadios.forEach(r => {
            r.addEventListener('change', () => this.updateDurationVisibility());
        });
    }
}

document.addEventListener('DOMContentLoaded', () => new TimerApp());