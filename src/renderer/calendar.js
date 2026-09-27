/**
 * Calendar — 日程中心（日程 / 待办 / 提醒 / 复习卡片）
 */
class CalendarApp {
    constructor() {
        this.viewDate = new Date();
        this.selectedDate = new Date();
        this.schedules = [];
        this.todos = [];
        this.reminders = [];
        this.cards = [];
        this.editing = { type: null, id: null };

        this.el = {
            closeBtn: document.getElementById('close-btn'),
            btnPrev: document.getElementById('btn-prev'),
            btnNext: document.getElementById('btn-next'),
            btnToday: document.getElementById('btn-today'),
            monthTitle: document.getElementById('month-title'),
            grid: document.getElementById('calendar-grid'),
            detailDate: document.getElementById('detail-date'),
            btnAdd: document.getElementById('btn-add'),
            addMenu: document.getElementById('add-menu'),
            itemList: document.getElementById('item-list'),
            undatedSection: document.getElementById('undated-section'),
            undatedList: document.getElementById('undated-list'),
            undatedCount: document.getElementById('undated-count'),
            repeatReminderSection: document.getElementById('repeat-reminder-section'),
            repeatReminderList: document.getElementById('repeat-reminder-list'),
            repeatReminderCount: document.getElementById('repeat-reminder-count'),
            // schedule modal
            modalSchedule: document.getElementById('modal-schedule'),
            schedTitleLabel: document.getElementById('sched-title-label'),
            schedTitle: document.getElementById('sched-title'),
            schedStart: document.getElementById('sched-start'),
            schedEnd: document.getElementById('sched-end'),
            schedLocation: document.getElementById('sched-location'),
            schedNotes: document.getElementById('sched-notes'),
            schedSave: document.getElementById('sched-save'),
            schedDelete: document.getElementById('sched-delete'),
            schedCancel: document.getElementById('sched-cancel'),
            // todo modal
            modalTodo: document.getElementById('modal-todo'),
            todoTitleLabel: document.getElementById('todo-title-label'),
            todoText: document.getElementById('todo-text'),
            todoDue: document.getElementById('todo-due'),
            todoPriority: document.getElementById('todo-priority'),
            todoSave: document.getElementById('todo-save'),
            todoDelete: document.getElementById('todo-delete'),
            todoCancel: document.getElementById('todo-cancel'),
            // reminder modal
            modalReminder: document.getElementById('modal-reminder'),
            remTitleLabel: document.getElementById('rem-title-label'),
            remText: document.getElementById('rem-text'),
            remTime: document.getElementById('rem-time'),
            remRepeat: document.getElementById('rem-repeat'),
            remSave: document.getElementById('rem-save'),
            remDelete: document.getElementById('rem-delete'),
            remCancel: document.getElementById('rem-cancel'),
            // card modal
            modalCard: document.getElementById('modal-card'),
            cardFrontPreview: document.getElementById('card-front-preview'),
            cardDue: document.getElementById('card-due'),
            cardSave: document.getElementById('card-save'),
            cardCancel: document.getElementById('card-cancel')
        };

        this.init();
    }

    async init() {
        this.bindEvents();
        await this.reload();
    }

    bindEvents() {
        this.el.closeBtn.onclick = () => window.close();
        this.el.btnPrev.onclick = () => this.shiftMonth(-1);
        this.el.btnNext.onclick = () => this.shiftMonth(1);
        this.el.btnToday.onclick = () => {
            this.viewDate = new Date();
            this.selectedDate = new Date();
            this.reload();
        };

        // 新建下拉
        this.el.btnAdd.onclick = (e) => {
            e.stopPropagation();
            this.el.addMenu.classList.toggle('show');
        };
        document.addEventListener('click', () => {
            this.el.addMenu.classList.remove('show');
        });
        this.el.addMenu.querySelectorAll('div').forEach(item => {
            item.onclick = (e) => {
                e.stopPropagation();
                const type = item.dataset.type;
                this.el.addMenu.classList.remove('show');
                if (type === 'schedule') this.openScheduleModal(null);
                else if (type === 'todo') this.openTodoModal(null);
                else if (type === 'reminder') this.openReminderModal(null);
            };
        });

        // 模态框按钮
        this.el.schedSave.onclick = () => this.saveSchedule();
        this.el.schedDelete.onclick = () => this.deleteSchedule();
        this.el.schedCancel.onclick = () => this.closeModal('schedule');
        this.el.todoSave.onclick = () => this.saveTodo();
        this.el.todoDelete.onclick = () => this.deleteTodo();
        this.el.todoCancel.onclick = () => this.closeModal('todo');
        this.el.remSave.onclick = () => this.saveReminder();
        this.el.remDelete.onclick = () => this.deleteReminder();
        this.el.remCancel.onclick = () => this.closeModal('reminder');
        this.el.cardSave.onclick = () => this.saveCardDue();
        this.el.cardCancel.onclick = () => this.closeModal('card');

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.el.modalSchedule.classList.contains('show')) return this.closeModal('schedule');
                if (this.el.modalTodo.classList.contains('show')) return this.closeModal('todo');
                if (this.el.modalReminder.classList.contains('show')) return this.closeModal('reminder');
                if (this.el.modalCard.classList.contains('show')) return this.closeModal('card');
                window.close();
            }
        });
    }

    shiftMonth(delta) {
        const d = new Date(this.viewDate);
        d.setMonth(d.getMonth() + delta);
        this.viewDate = d;
        this.reload();
    }

    async reload() {
        await Promise.all([
            this.loadSchedules(),
            this.loadTodos(),
            this.loadReminders(),
            this.loadCards()
        ]);
        this.renderMonth();
        this.renderUndated();
        this.renderRepeatReminders();
        this.renderDetail();
    }

    async loadSchedules() {
        const y = this.viewDate.getFullYear();
        const m = this.viewDate.getMonth();
        const from = new Date(y, m - 1, 1).getTime();
        const to = new Date(y, m + 2, 0, 23, 59, 59).getTime();
        try {
            const r = await window.electronAPI.agentListSchedules({ from, to });
            this.schedules = r.success ? r.schedules : [];
        } catch (e) { this.schedules = []; }
    }

    async loadTodos() {
        try {
            const r = await window.electronAPI.agentListTodos({ includeDone: true, limit: 500 });
            this.todos = r.success ? r.todos : [];
        } catch (e) { this.todos = []; }
    }

    async loadReminders() {
        try {
            const r = await window.electronAPI.agentListReminders({ includeDone: false, limit: 200 });
            this.reminders = r.success ? r.reminders : [];
        } catch (e) { this.reminders = []; }
    }

    async loadCards() {
        try {
            const r = await window.electronAPI.agentListFlashcards({ limit: 500 });
            this.cards = r.success ? r.cards : [];
        } catch (e) { this.cards = []; }
    }

    // ========== 日期工具 ==========

    _dateKey(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    _tsToDateKey(ts) { return this._dateKey(new Date(ts)); }
    _dateKeyToTs(key) {
        const [y, m, d] = key.split('-').map(Number);
        return new Date(y, m - 1, d).getTime();
    }
    _tsToLocalInput(ts) {
        const d = new Date(ts);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    _localInputToTs(str) {
        if (!str) return null;
        const d = new Date(str);
        return isNaN(d.getTime()) ? null : d.getTime();
    }
    _formatTime(ts) {
        const d = new Date(ts);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

    // ========== 月视图 ==========

    renderMonth() {
        const y = this.viewDate.getFullYear();
        const m = this.viewDate.getMonth();
        this.el.monthTitle.textContent = `${y} 年 ${m + 1} 月`;

        const firstDay = new Date(y, m, 1);
        const startWeekday = firstDay.getDay();
        const startDate = new Date(y, m, 1 - startWeekday);

        const todayKey = this._dateKey(new Date());
        const selectedKey = this._dateKey(this.selectedDate);

        this.el.grid.innerHTML = '';

        for (let i = 0; i < 42; i++) {
            const d = new Date(startDate);
            d.setDate(startDate.getDate() + i);
            const dayKey = this._dateKey(d);
            const isOther = d.getMonth() !== m;

            const cell = document.createElement('div');
            cell.className = 'day-cell';
            if (isOther) cell.classList.add('other-month');
            if (dayKey === todayKey) cell.classList.add('today');
            if (dayKey === selectedKey) cell.classList.add('selected');

            const num = document.createElement('div');
            num.className = 'day-num';
            num.textContent = d.getDate();
            cell.appendChild(num);

            // 多天日程
            const multiDayList = this._schedulesCoveringDay(dayKey).filter(s => {
                const startDay = this._tsToDateKey(s.startAt);
                const endDay = s.endAt ? this._tsToDateKey(s.endAt) : startDay;
                return startDay !== endDay;
            });
            if (multiDayList.length > 0) {
                cell.classList.add('has-multi-day');
                if (multiDayList.some(s => this._tsToDateKey(s.startAt) === dayKey)) cell.classList.add('multi-start');
                if (multiDayList.some(s => {
                    const endDay = s.endAt ? this._tsToDateKey(s.endAt) : this._tsToDateKey(s.startAt);
                    return endDay === dayKey;
                })) cell.classList.add('multi-end');
            }

            // 圆点
            const dots = document.createElement('div');
            dots.className = 'day-dots';

            const dScheds = this._schedulesOfDay(dayKey);
            const dTodos = this._todosOfDay(dayKey);
            const dRems = this._remindersOfDay(dayKey);
            const dCards = this._cardsOfDay(dayKey);
            const total = dScheds.length + dTodos.length + dRems.length + dCards.length;

            if (total > 0 && total <= 5) {
                dScheds.forEach(() => {
                    const s = document.createElement('span'); s.className = 'dot schedule'; dots.appendChild(s);
                });
                dTodos.forEach(() => {
                    const s = document.createElement('span'); s.className = 'dot todo'; dots.appendChild(s);
                });
                dRems.forEach(() => {
                    const s = document.createElement('span'); s.className = 'dot reminder'; dots.appendChild(s);
                });
                dCards.forEach(() => {
                    const s = document.createElement('span'); s.className = 'dot card'; dots.appendChild(s);
                });
            } else if (total > 5) {
                const cnt = document.createElement('span');
                cnt.className = 'dot-count';
                cnt.textContent = total;
                dots.appendChild(cnt);
            }
            cell.appendChild(dots);

            cell.onclick = () => {
                this.selectedDate = new Date(d);
                this.viewDate = new Date(d);
                this.renderMonth();
                this.renderDetail();
            };

            this.el.grid.appendChild(cell);
        }
    }

    // ========== 数据查询 ==========

    _schedulesOfDay(dayKey) {
        return this.schedules.filter(s => {
            if (this._tsToDateKey(s.startAt) !== dayKey) return false;
            const endDay = s.endAt ? this._tsToDateKey(s.endAt) : this._tsToDateKey(s.startAt);
            return endDay === dayKey;
        });
    }

    _schedulesCoveringDay(dayKey) {
        const dayStart = this._dateKeyToTs(dayKey);
        const dayEnd = dayStart + 86400000 - 1;
        return this.schedules.filter(s => {
            const start = s.startAt;
            const end = s.endAt || s.startAt;
            return start <= dayEnd && end >= dayStart;
        });
    }

    _todosOfDay(dayKey) {
        return this.todos.filter(t => t.dueAt && this._tsToDateKey(t.dueAt) === dayKey);
    }

    _remindersOfDay(dayKey) {
        // 重复提醒不标在日历上（用户选项C）
        return this.reminders.filter(r => {
            if (r.repeat && r.repeat !== 'none') return false;
            return this._tsToDateKey(r.remindAt) === dayKey;
        });
    }

    _cardsOfDay(dayKey) {
        return this.cards.filter(c => this._tsToDateKey(c.dueAt) === dayKey);
    }

    // ========== 无日期待办 ==========

    renderUndated() {
        const list = this.todos.filter(t => !t.done && !t.dueAt);
        if (list.length === 0) {
            this.el.undatedSection.style.display = 'none';
            return;
        }
        this.el.undatedSection.style.display = '';
        this.el.undatedCount.textContent = `${list.length} 项`;
        this.el.undatedList.innerHTML = '';
        for (const t of list) {
            this.el.undatedList.appendChild(this._buildTodoItem(t));
        }
    }
    
    renderRepeatReminders() {
        const list = this.reminders.filter(r => r.repeat && r.repeat !== 'none' && !r.done);
        if (list.length === 0) {
            this.el.repeatReminderSection.style.display = 'none';
            return;
        }
        this.el.repeatReminderSection.style.display = '';
        this.el.repeatReminderCount.textContent = `${list.length} 项`;
        this.el.repeatReminderList.innerHTML = '';

        // 排序：每天优先于每周，然后按时间
        list.sort((a, b) => {
            const order = { daily: 0, weekly: 1 };
            const oa = order[a.repeat] ?? 2;
            const ob = order[b.repeat] ?? 2;
            if (oa !== ob) return oa - ob;
            return a.remindAt - b.remindAt;
        });

        for (const r of list) {
            this.el.repeatReminderList.appendChild(this._buildRepeatReminderItem(r));
        }
    }

    _buildRepeatReminderItem(r) {
        const item = document.createElement('div');
        item.className = 'item reminder';

        const time = document.createElement('span');
        time.className = 'item-time';
        time.textContent = this._formatTime(r.remindAt);
        item.appendChild(time);

        const main = document.createElement('div');
        main.className = 'item-main';

        const title = document.createElement('div');
        title.className = 'item-title';
        title.textContent = r.text;
        main.appendChild(title);

        const meta = document.createElement('div');
        meta.className = 'item-meta';
        const parts = ['🔁'];
        if (r.repeat === 'daily') parts.push('每天');
        else if (r.repeat === 'weekly') parts.push('每周');
        meta.textContent = parts.join(' · ');
        main.appendChild(meta);

        item.appendChild(main);

        const btnDel = document.createElement('button');
        btnDel.className = 'btn-del';
        btnDel.textContent = '×';
        btnDel.title = '删除';
        btnDel.style.cssText = 'background:transparent;border:none;color:#ccc;cursor:pointer;padding:2px 6px;border-radius:4px;font-size:13px;';
        btnDel.onmouseenter = () => { btnDel.style.background = '#ffe5e5'; btnDel.style.color = '#e08080'; };
        btnDel.onmouseleave = () => { btnDel.style.background = 'transparent'; btnDel.style.color = '#ccc'; };
        btnDel.onclick = (e) => { e.stopPropagation(); this.confirmDeleteReminder(r); };
        item.appendChild(btnDel);

        item.onclick = () => this.openReminderModal(r);
        return item;
    }

    // ========== 日期详情 ==========

    renderDetail() {
        const d = this.selectedDate;
        const dayKey = this._dateKey(d);
        const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        this.el.detailDate.textContent = `${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`;

        const dScheds = this._schedulesCoveringDay(dayKey).sort((a, b) => a.startAt - b.startAt);
        const dTodos = this._todosOfDay(dayKey).sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0));
        const dRems = this._remindersOfDay(dayKey).sort((a, b) => a.remindAt - b.remindAt);
        const dCards = this._cardsOfDay(dayKey);

        this.el.itemList.innerHTML = '';

        if (dScheds.length + dTodos.length + dRems.length + dCards.length === 0) {
            const hint = document.createElement('div');
            hint.className = 'empty-hint';
            hint.textContent = '这天没有安排';
            this.el.itemList.appendChild(hint);
            return;
        }

        for (const s of dScheds) {
            this.el.itemList.appendChild(this._buildScheduleItem(s));
        }
        for (const t of dTodos) {
            this.el.itemList.appendChild(this._buildTodoItem(t));
        }
        for (const r of dRems) {
            this.el.itemList.appendChild(this._buildReminderItem(r));
        }
        for (const c of dCards) {
            this.el.itemList.appendChild(this._buildCardItem(c));
        }
    }

    _buildScheduleItem(s) {
        const item = document.createElement('div');
        item.className = 'item schedule';
        const time = document.createElement('span');
        time.className = 'item-time';
        time.textContent = this._formatTime(s.startAt);
        item.appendChild(time);
        const main = document.createElement('div');
        main.className = 'item-main';
        const title = document.createElement('div');
        title.className = 'item-title';
        title.textContent = s.title;
        main.appendChild(title);
        const meta = document.createElement('div');
        meta.className = 'item-meta';
        const parts = ['📅 日程'];
        if (s.location) parts.push('@ ' + s.location);
        if (s.endAt) parts.push('至 ' + new Date(s.endAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }));
        meta.textContent = parts.join(' · ');
        main.appendChild(meta);
        item.appendChild(main);
        item.onclick = () => this.openScheduleModal(s);
        return item;
    }

    _buildTodoItem(t) {
        const item = document.createElement('div');
        item.className = 'item todo' + (t.done ? ' done' : '');
        const time = document.createElement('span');
        time.className = 'item-time';
        time.textContent = t.dueAt ? this._formatTime(t.dueAt) : '—';
        item.appendChild(time);
        const main = document.createElement('div');
        main.className = 'item-main';
        const title = document.createElement('div');
        title.className = 'item-title';
        title.textContent = t.text;
        main.appendChild(title);
        const meta = document.createElement('div');
        meta.className = 'item-meta';
        const parts = ['✅ 待办'];
        if (t.priority === 'high') parts.push('🔴 高');
        else if (t.priority === 'low') parts.push('🟢 低');
        if (t.done) parts.push('已完成');
        meta.textContent = parts.join(' · ');
        main.appendChild(meta);
        item.appendChild(main);

        const actions = document.createElement('div');
        actions.className = 'item-actions';
        if (!t.done) {
            const btnComplete = document.createElement('button');
            btnComplete.className = 'btn-complete';
            btnComplete.textContent = '✓';
            btnComplete.title = '完成';
            btnComplete.onclick = (e) => { e.stopPropagation(); this.completeTodo(t); };
            actions.appendChild(btnComplete);
        }
        const btnDel = document.createElement('button');
        btnDel.className = 'btn-del';
        btnDel.textContent = '×';
        btnDel.title = '删除';
        btnDel.onclick = (e) => { e.stopPropagation(); this.confirmDeleteTodo(t); };
        actions.appendChild(btnDel);
        item.appendChild(actions);

        item.onclick = () => this.openTodoModal(t);
        return item;
    }

    _buildReminderItem(r) {
        const item = document.createElement('div');
        item.className = 'item reminder';
        const time = document.createElement('span');
        time.className = 'item-time';
        time.textContent = this._formatTime(r.remindAt);
        item.appendChild(time);
        const main = document.createElement('div');
        main.className = 'item-main';
        const title = document.createElement('div');
        title.className = 'item-title';
        title.textContent = r.text;
        main.appendChild(title);
        const meta = document.createElement('div');
        meta.className = 'item-meta';
        const parts = ['⏰ 提醒'];
        if (r.repeat === 'daily') parts.push('每天');
        else if (r.repeat === 'weekly') parts.push('每周');
        meta.textContent = parts.join(' · ');
        main.appendChild(meta);
        item.appendChild(main);

        const btnDel = document.createElement('button');
        btnDel.className = 'btn-del';
        btnDel.textContent = '×';
        btnDel.title = '删除';
        btnDel.style.cssText = 'background:transparent;border:none;color:#ccc;cursor:pointer;padding:2px 6px;border-radius:4px;font-size:13px;';
        btnDel.onmouseenter = () => { btnDel.style.background = '#ffe5e5'; btnDel.style.color = '#e08080'; };
        btnDel.onmouseleave = () => { btnDel.style.background = 'transparent'; btnDel.style.color = '#ccc'; };
        btnDel.onclick = (e) => { e.stopPropagation(); this.confirmDeleteReminder(r); };
        item.appendChild(btnDel);

        item.onclick = () => this.openReminderModal(r);
        return item;
    }

    _buildCardItem(c) {
        const item = document.createElement('div');
        item.className = 'item card';
        const time = document.createElement('span');
        time.className = 'item-time';
        time.textContent = '复习';
        item.appendChild(time);
        const main = document.createElement('div');
        main.className = 'item-main';
        const title = document.createElement('div');
        title.className = 'item-title';
        title.textContent = c.front;
        main.appendChild(title);
        const meta = document.createElement('div');
        meta.className = 'item-meta';
        const parts = ['📇 复习卡片'];
        if (c.subject) parts.push(c.subject);
        meta.textContent = parts.join(' · ');
        main.appendChild(meta);
        item.appendChild(main);
        item.onclick = () => this.openCardModal(c);
        return item;
    }

    // ========== 待办快捷操作 ==========

    async completeTodo(t) {
        try {
            const r = await window.electronAPI.agentCompleteTodo({ idOrText: t.id });
            if (!r.success) { alert('操作失败：' + r.error); return; }
            await this.reload();
        } catch (e) { alert('异常：' + e.message); }
    }

    async confirmDeleteTodo(t) {
        if (!confirm(`确定删除待办「${t.text}」吗？`)) return;
        try {
            const r = await window.electronAPI.agentDeleteTodo({ idOrText: t.id });
            if (!r.success) { alert('删除失败：' + r.error); return; }
            await this.reload();
        } catch (e) { alert('异常：' + e.message); }
    }

    async confirmDeleteReminder(r) {
        if (!confirm(`确定删除提醒「${r.text}」吗？`)) return;
        try {
            const res = await window.electronAPI.agentDeleteReminder({ idOrText: r.id });
            if (!res.success) { alert('删除失败：' + res.error); return; }
            await this.reload();
        } catch (e) { alert('异常：' + e.message); }
    }

    // ========== 模态框操作 ==========

    closeModal(type) {
        if (type === 'schedule') this.el.modalSchedule.classList.remove('show');
        if (type === 'todo') this.el.modalTodo.classList.remove('show');
        if (type === 'reminder') this.el.modalReminder.classList.remove('show');
        if (type === 'card') this.el.modalCard.classList.remove('show');
        this.editing = { type: null, id: null };
    }

    // ---- 日程 ----

    openScheduleModal(s) {
        this.editing = { type: 'schedule', id: s ? s.id : null };
        this.el.schedTitleLabel.textContent = s ? '编辑日程' : '新建日程';
        if (s) {
            this.el.schedTitle.value = s.title || '';
            this.el.schedStart.value = this._tsToLocalInput(s.startAt);
            this.el.schedEnd.value = s.endAt ? this._tsToLocalInput(s.endAt) : '';
            this.el.schedLocation.value = s.location || '';
            this.el.schedNotes.value = s.notes || '';
            this.el.schedDelete.style.display = '';
        } else {
            this.el.schedTitle.value = '';
            const d = this.selectedDate;
            const def = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10, 0);
            this.el.schedStart.value = this._tsToLocalInput(def.getTime());
            this.el.schedEnd.value = '';
            this.el.schedLocation.value = '';
            this.el.schedNotes.value = '';
            this.el.schedDelete.style.display = 'none';
        }
        this.el.modalSchedule.classList.add('show');
        setTimeout(() => this.el.schedTitle.focus(), 50);
    }

    async saveSchedule() {
        const title = this.el.schedTitle.value.trim();
        if (!title) { alert('标题不能为空'); return; }
        const startAt = this._localInputToTs(this.el.schedStart.value);
        if (!startAt) { alert('请填写开始时间'); return; }
        const endAt = this._localInputToTs(this.el.schedEnd.value);
        const location = this.el.schedLocation.value.trim();
        const notes = this.el.schedNotes.value.trim();

        this.el.schedSave.disabled = true;
        this.el.schedSave.textContent = '保存中...';
        try {
            let r;
            if (this.editing.id) {
                r = await window.electronAPI.agentUpdateSchedule({
                    idOrTitle: this.editing.id,
                    title, startAt, endAt: endAt || '', location, notes
                });
            } else {
                r = await window.electronAPI.agentAddSchedule({ title, startAt, endAt, location, notes });
            }
            if (!r.success) { alert('保存失败：' + r.error); return; }
            this.closeModal('schedule');
            await this.reload();
        } catch (e) { alert('异常：' + e.message); }
        finally {
            this.el.schedSave.disabled = false;
            this.el.schedSave.textContent = '保存';
        }
    }

    async deleteSchedule() {
        if (!this.editing.id) return;
        if (!confirm('确定删除这个日程吗？')) return;
        try {
            const r = await window.electronAPI.agentDeleteSchedule({ idOrTitle: this.editing.id });
            if (!r.success) { alert('删除失败：' + r.error); return; }
            this.closeModal('schedule');
            await this.reload();
        } catch (e) { alert('异常：' + e.message); }
    }

    // ---- 待办 ----

    openTodoModal(t) {
        this.editing = { type: 'todo', id: t ? t.id : null };
        this.el.todoTitleLabel.textContent = t ? '编辑待办' : '新建待办';
        if (t) {
            this.el.todoText.value = t.text || '';
            this.el.todoDue.value = t.dueAt ? this._tsToLocalInput(t.dueAt) : '';
            this.el.todoPriority.value = t.priority || 'normal';
            this.el.todoDelete.style.display = '';
        } else {
            this.el.todoText.value = '';
            const d = this.selectedDate;
            const def = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 18, 0);
            this.el.todoDue.value = this._tsToLocalInput(def.getTime());
            this.el.todoPriority.value = 'normal';
            this.el.todoDelete.style.display = 'none';
        }
        this.el.modalTodo.classList.add('show');
        setTimeout(() => this.el.todoText.focus(), 50);
    }

    async saveTodo() {
        const text = this.el.todoText.value.trim();
        if (!text) { alert('内容不能为空'); return; }
        const dueAt = this._localInputToTs(this.el.todoDue.value);
        const priority = this.el.todoPriority.value;

        this.el.todoSave.disabled = true;
        this.el.todoSave.textContent = '保存中...';
        try {
            let r;
            if (this.editing.id) {
                r = await window.electronAPI.agentUpdateTodo({
                    idOrText: this.editing.id,
                    text, dueAt: dueAt || null, priority
                });
            } else {
                r = await window.electronAPI.agentAddTodo({ text, dueAt, priority });
            }
            if (!r.success) { alert('保存失败：' + r.error); return; }
            this.closeModal('todo');
            await this.reload();
        } catch (e) { alert('异常：' + e.message); }
        finally {
            this.el.todoSave.disabled = false;
            this.el.todoSave.textContent = '保存';
        }
    }

    async deleteTodo() {
        if (!this.editing.id) return;
        if (!confirm('确定删除这个待办吗？')) return;
        try {
            const r = await window.electronAPI.agentDeleteTodo({ idOrText: this.editing.id });
            if (!r.success) { alert('删除失败：' + r.error); return; }
            this.closeModal('todo');
            await this.reload();
        } catch (e) { alert('异常：' + e.message); }
    }

    // ---- 提醒 ----

    openReminderModal(r) {
        this.editing = { type: 'reminder', id: r ? r.id : null };
        this.el.remTitleLabel.textContent = r ? '编辑提醒' : '新建提醒';
        if (r) {
            this.el.remText.value = r.text || '';
            this.el.remTime.value = this._tsToLocalInput(r.remindAt);
            this.el.remRepeat.value = r.repeat || 'none';
            this.el.remDelete.style.display = '';
        } else {
            this.el.remText.value = '';
            const d = this.selectedDate;
            const def = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0);
            this.el.remTime.value = this._tsToLocalInput(def.getTime());
            this.el.remRepeat.value = 'none';
            this.el.remDelete.style.display = 'none';
        }
        this.el.modalReminder.classList.add('show');
        setTimeout(() => this.el.remText.focus(), 50);
    }

    async saveReminder() {
        const text = this.el.remText.value.trim();
        if (!text) { alert('内容不能为空'); return; }
        const remindAt = this._localInputToTs(this.el.remTime.value);
        if (!remindAt) { alert('请填写提醒时间'); return; }
        const repeat = this.el.remRepeat.value;

        this.el.remSave.disabled = true;
        this.el.remSave.textContent = '保存中...';
        try {
            let r;
            if (this.editing.id) {
                r = await window.electronAPI.agentUpdateReminder({
                    idOrText: this.editing.id,
                    text, remindAt, repeat
                });
            } else {
                r = await window.electronAPI.agentAddReminder({ text, remindAt, repeat });
            }
            if (!r.success) { alert('保存失败：' + r.error); return; }
            this.closeModal('reminder');
            await this.reload();
        } catch (e) { alert('异常：' + e.message); }
        finally {
            this.el.remSave.disabled = false;
            this.el.remSave.textContent = '保存';
        }
    }

    async deleteReminder() {
        if (!this.editing.id) return;
        if (!confirm('确定删除这个提醒吗？')) return;
        try {
            const r = await window.electronAPI.agentDeleteReminder({ idOrText: this.editing.id });
            if (!r.success) { alert('删除失败：' + r.error); return; }
            this.closeModal('reminder');
            await this.reload();
        } catch (e) { alert('异常：' + e.message); }
    }

    // ---- 复习卡片改期 ----

    openCardModal(c) {
        this.editing = { type: 'card', id: c.id };
        this.el.cardFrontPreview.textContent = c.front;
        this.el.cardDue.value = this._tsToLocalInput(c.dueAt);
        this.el.modalCard.classList.add('show');
    }

    async saveCardDue() {
        if (!this.editing.id) return;
        const dueAt = this._localInputToTs(this.el.cardDue.value);
        if (!dueAt) { alert('请选择日期'); return; }
        this.el.cardSave.disabled = true;
        this.el.cardSave.textContent = '保存中...';
        try {
            const r = await window.electronAPI.agentUpdateFlashcard({
                idOrFront: this.editing.id,
                dueAt
            });
            if (!r.success) { alert('保存失败：' + r.error); return; }
            this.closeModal('card');
            await this.reload();
        } catch (e) { alert('异常：' + e.message); }
        finally {
            this.el.cardSave.disabled = false;
            this.el.cardSave.textContent = '保存';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => new CalendarApp());