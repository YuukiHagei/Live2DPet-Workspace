/**
 * Calendar — 日程日历视图
 */
class CalendarApp {
    constructor() {
        this.viewDate = new Date();        // 当前月份（任意一天，用于定位）
        this.selectedDate = new Date();    // 当前选中的日期
        this.schedules = [];               // 当前月份的所有日程
        this.todos = [];                   // 所有未完成待办
        this.editing = null;               // { id } 编辑中；null 新建

        this.el = {
            closeBtn: document.getElementById('close-btn'),
            btnPrev: document.getElementById('btn-prev'),
            btnNext: document.getElementById('btn-next'),
            btnToday: document.getElementById('btn-today'),
            monthTitle: document.getElementById('month-title'),
            grid: document.getElementById('calendar-grid'),
            detailDate: document.getElementById('detail-date'),
            btnAdd: document.getElementById('btn-add'),
            itemList: document.getElementById('item-list'),
            modalMask: document.getElementById('modal-mask'),
            modalTitle: document.getElementById('modal-title'),
            fTitle: document.getElementById('f-title'),
            fStart: document.getElementById('f-start'),
            fEnd: document.getElementById('f-end'),
            fLocation: document.getElementById('f-location'),
            fNotes: document.getElementById('f-notes'),
            btnSave: document.getElementById('btn-save'),
            btnDelete: document.getElementById('btn-delete'),
            btnCancel: document.getElementById('btn-cancel')
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
        this.el.btnAdd.onclick = () => this.openModal(null);
        this.el.btnSave.onclick = () => this.saveModal();
        this.el.btnDelete.onclick = () => this.deleteModal();
        this.el.btnCancel.onclick = () => this.closeModal();

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.el.modalMask.classList.contains('show')) {
                    this.closeModal();
                } else {
                    window.close();
                }
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
        await this.loadSchedules();
        await this.loadTodos();
        this.renderMonth();
        this.renderDetail();
    }

    async loadSchedules() {
        const y = this.viewDate.getFullYear();
        const m = this.viewDate.getMonth();
        // 覆盖前后一个月的缓冲，避免相邻格子标记缺失
        const from = new Date(y, m - 1, 1).getTime();
        const to = new Date(y, m + 2, 0, 23, 59, 59).getTime();
        try {
            const r = await window.electronAPI.agentListSchedules({ from, to });
            this.schedules = r.success ? r.schedules : [];
        } catch (e) {
            console.error('[Calendar] load schedules failed:', e);
            this.schedules = [];
        }
    }

    async loadTodos() {
        try {
            const r = await window.electronAPI.agentListTodos({ includeDone: false, limit: 200 });
            this.todos = r.success ? r.todos : [];
        } catch (e) {
            console.error('[Calendar] load todos failed:', e);
            this.todos = [];
        }
    }

    // ========== 日历网格 ==========

    renderMonth() {
        const y = this.viewDate.getFullYear();
        const m = this.viewDate.getMonth();
        this.el.monthTitle.textContent = `${y} 年 ${m + 1} 月`;

        const firstDay = new Date(y, m, 1);
        const startWeekday = firstDay.getDay();   // 0=周日
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

            // 标记
            const dots = document.createElement('div');
            dots.className = 'day-dots';

            const daySchedules = this._schedulesOfDay(dayKey);
            const dayTodos = this._todosOfDay(dayKey);

            const total = daySchedules.length + dayTodos.length;
            if (total > 0 && total <= 4) {
                for (let k = 0; k < daySchedules.length; k++) {
                    const dot = document.createElement('span');
                    dot.className = 'dot';
                    dots.appendChild(dot);
                }
                for (let k = 0; k < dayTodos.length; k++) {
                    const dot = document.createElement('span');
                    dot.className = 'dot todo';
                    dots.appendChild(dot);
                }
            } else if (total > 4) {
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

    _dateKey(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    _tsToDateKey(ts) {
        return this._dateKey(new Date(ts));
    }

    _schedulesOfDay(dayKey) {
        return this.schedules.filter(s => this._tsToDateKey(s.startAt) === dayKey);
    }

    _todosOfDay(dayKey) {
        return this.todos.filter(t => t.dueAt && this._tsToDateKey(t.dueAt) === dayKey);
    }

    // ========== 日期详情 ==========

    renderDetail() {
        const d = this.selectedDate;
        const dayKey = this._dateKey(d);
        const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        this.el.detailDate.textContent = `${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`;

        const daySchedules = this._schedulesOfDay(dayKey).sort((a, b) => a.startAt - b.startAt);
        const dayTodos = this._todosOfDay(dayKey);

        this.el.itemList.innerHTML = '';

        if (daySchedules.length === 0 && dayTodos.length === 0) {
            const hint = document.createElement('div');
            hint.className = 'empty-hint';
            hint.textContent = '这天没有安排';
            this.el.itemList.appendChild(hint);
        }

        for (const s of daySchedules) {
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
            if (s.location) {
                const meta = document.createElement('div');
                meta.className = 'item-meta';
                meta.textContent = '@ ' + s.location;
                main.appendChild(meta);
            }
            item.appendChild(main);

            const del = document.createElement('button');
            del.className = 'item-del';
            del.textContent = '×';
            del.title = '删除';
            del.onclick = (e) => {
                e.stopPropagation();
                this.deleteItem('schedule', s.id);
            };
            item.appendChild(del);

            item.onclick = () => this.openModal(s);
            this.el.itemList.appendChild(item);
        }

        for (const t of dayTodos) {
            const item = document.createElement('div');
            item.className = 'item todo';

            const time = document.createElement('span');
            time.className = 'item-time';
            time.textContent = this._formatTime(t.dueAt);
            item.appendChild(time);

            const main = document.createElement('div');
            main.className = 'item-main';
            const title = document.createElement('div');
            title.className = 'item-title';
            title.textContent = t.text;
            main.appendChild(title);
            const meta = document.createElement('div');
            meta.className = 'item-meta';
            meta.textContent = '待办截止';
            main.appendChild(meta);
            item.appendChild(main);

            // 待办只显示，不在这里编辑（避免功能重叠）
            this.el.itemList.appendChild(item);
        }
    }

    _formatTime(ts) {
        const d = new Date(ts);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

    // ========== 模态框 ==========

    openModal(schedule) {
        this.editing = schedule ? { id: schedule.id } : null;
        this.el.modalTitle.textContent = schedule ? '编辑日程' : '新建日程';

        if (schedule) {
            this.el.fTitle.value = schedule.title || '';
            this.el.fStart.value = this._tsToLocalInput(schedule.startAt);
            this.el.fEnd.value = schedule.endAt ? this._tsToLocalInput(schedule.endAt) : '';
            this.el.fLocation.value = schedule.location || '';
            this.el.fNotes.value = schedule.notes || '';
            this.el.btnDelete.style.display = '';
        } else {
            this.el.fTitle.value = '';
            // 默认：选中日期的整点
            const d = this.selectedDate;
            const def = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10, 0);
            this.el.fStart.value = this._tsToLocalInput(def.getTime());
            this.el.fEnd.value = '';
            this.el.fLocation.value = '';
            this.el.fNotes.value = '';
            this.el.btnDelete.style.display = 'none';
        }

        this.el.modalMask.classList.add('show');
        setTimeout(() => this.el.fTitle.focus(), 50);
    }

    closeModal() {
        this.el.modalMask.classList.remove('show');
        this.editing = null;
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

    async saveModal() {
        const title = this.el.fTitle.value.trim();
        if (!title) { alert('标题不能为空'); return; }
        const startAt = this._localInputToTs(this.el.fStart.value);
        if (!startAt) { alert('请填写开始时间'); return; }
        const endAt = this._localInputToTs(this.el.fEnd.value);
        const location = this.el.fLocation.value.trim();
        const notes = this.el.fNotes.value.trim();

        this.el.btnSave.disabled = true;
        this.el.btnSave.textContent = '保存中...';

        try {
            let r;
            if (this.editing) {
                r = await window.electronAPI.agentUpdateSchedule({
                    idOrTitle: this.editing.id,
                    title, startAt, endAt: endAt || '', location, notes
                });
            } else {
                r = await window.electronAPI.agentAddSchedule({
                    title, startAt, endAt, location, notes
                });
            }
            if (!r.success) {
                alert('保存失败：' + r.error);
                return;
            }
            this.closeModal();
            await this.reload();
        } catch (err) {
            alert('保存异常：' + err.message);
        } finally {
            this.el.btnSave.disabled = false;
            this.el.btnSave.textContent = '保存';
        }
    }

    async deleteModal() {
        if (!this.editing) return;
        if (!confirm('确定删除这个日程吗？')) return;
        try {
            const r = await window.electronAPI.agentDeleteSchedule({ idOrTitle: this.editing.id });
            if (!r.success) { alert('删除失败：' + r.error); return; }
            this.closeModal();
            await this.reload();
        } catch (err) {
            alert('删除异常：' + err.message);
        }
    }

    async deleteItem(type, id) {
        if (type !== 'schedule') return;
        if (!confirm('确定删除这个日程吗？')) return;
        try {
            const r = await window.electronAPI.agentDeleteSchedule({ idOrTitle: id });
            if (!r.success) { alert('删除失败：' + r.error); return; }
            await this.reload();
        } catch (err) {
            alert('删除异常：' + err.message);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => new CalendarApp());