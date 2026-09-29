/**
 * DataStore — 待办 / 日程的本地 JSON 存储。
 */
const fs = require('fs');
const path = require('path');

function generateId(prefix) {
    const rand = Math.random().toString(36).slice(2, 6);
    return `${prefix}_${Date.now()}_${rand}`;
}

/**
 * 宽松解析时间：接受 ISO 字符串、数字、常见中文格式。
 * 返回毫秒时间戳，失败返回 null。
 */
function parseTime(input) {
    if (input === null || input === undefined || input === '') return null;
    if (typeof input === 'number') return input;
    if (typeof input !== 'string') return null;
    const s = input.trim();
    if (!s) return null;

    // 纯数字（时间戳）
    if (/^\d{10,13}$/.test(s)) return Number(s);

    // ISO / 标准格式
    let d = new Date(s);
    if (!isNaN(d.getTime())) return d.getTime();

    // "2026/09/22 15:00"
    const m1 = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (m1) {
        const [, y, mo, da, hh, mi] = m1;
        d = new Date(Number(y), Number(mo) - 1, Number(da),
                     Number(hh || 0), Number(mi || 0));
        if (!isNaN(d.getTime())) return d.getTime();
    }

    return null;
}

class DataStore {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.todosFile = path.join(dataDir, 'todos.json');
        this.schedulesFile = path.join(dataDir, 'schedules.json');
        this.remindersFile = path.join(dataDir, 'reminders.json');
        this.flashcardsFile = path.join(dataDir, 'flashcards.json');
        this.todos = [];
        this.schedules = [];
        this.reminders = [];
        this.flashcards = [];
        this._dirty = false;
        this._flushTimer = null;

        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        this._load();
    }

    _load() {
        try {
            if (fs.existsSync(this.todosFile)) {
                const data = JSON.parse(fs.readFileSync(this.todosFile, 'utf8'));
                this.todos = Array.isArray(data.todos) ? data.todos : [];
            }
            if (fs.existsSync(this.schedulesFile)) {
                const data = JSON.parse(fs.readFileSync(this.schedulesFile, 'utf8'));
                this.schedules = Array.isArray(data.schedules) ? data.schedules : [];
            }
            if (fs.existsSync(this.flashcardsFile)) {
                const data = JSON.parse(fs.readFileSync(this.flashcardsFile, 'utf8'));
                this.flashcards = Array.isArray(data.flashcards) ? data.flashcards : [];
            }
            console.log(`[DataStore] loaded: ${this.todos.length} todos, ${this.schedules.length} schedules, ${this.reminders.length} reminders, ${this.flashcards.length} cards`);
        } catch (err) {
            console.error('[DataStore] load failed:', err.message);
        }
    }

    _markDirty() {
        this._dirty = true;
        if (this._flushTimer) return;
        this._flushTimer = setTimeout(() => {
            this._flushTimer = null;
            this._flush();
        }, 500);
    }

    _flush() {
        if (!this._dirty) return;
        try {
            fs.writeFileSync(this.todosFile, JSON.stringify({ todos: this.todos }, null, 2));
            fs.writeFileSync(this.schedulesFile, JSON.stringify({ schedules: this.schedules }, null, 2));
            fs.writeFileSync(this.remindersFile, JSON.stringify({ reminders: this.reminders }, null, 2));
            fs.writeFileSync(this.flashcardsFile, JSON.stringify({ flashcards: this.flashcards }, null, 2));
            this._dirty = false;
        } catch (err) {
            console.error('[DataStore] flush failed:', err.message);
        }
    }

    // ========== 待办 ==========

    addTodo({ text, dueAt, priority }) {
        if (!text || !text.trim()) throw new Error('待办内容不能为空');
        const todo = {
            id: generateId('todo'),
            text: text.trim(),
            done: false,
            createdAt: Date.now(),
            dueAt: parseTime(dueAt),
            doneAt: null,
            priority: ['low', 'normal', 'high'].includes(priority) ? priority : 'normal'
        };
        this.todos.push(todo);
        this._markDirty();
        return todo;
    }

    listTodos({ includeDone = false, limit = 20 } = {}) {
        let list = this.todos.slice();
        if (!includeDone) list = list.filter(t => !t.done);
        // 排序：优先展示未完成 + 按 dueAt / createdAt 升序
        list.sort((a, b) => {
            if (a.done !== b.done) return a.done ? 1 : -1;
            const ta = a.dueAt || a.createdAt;
            const tb = b.dueAt || b.createdAt;
            return ta - tb;
        });
        return list.slice(0, limit);
    }

    completeTodo({ idOrText }) {
        if (!idOrText) throw new Error('缺少待办 ID 或文字');
        const needle = idOrText.trim();
        // 先按 ID
        let target = this.todos.find(t => t.id === needle && !t.done);
        // 再按文字模糊匹配（未完成中）
        if (!target) {
            target = this.todos.find(t => !t.done && t.text.includes(needle));
        }
        if (!target) throw new Error(`未找到待办：${needle}`);
        target.done = true;
        target.doneAt = Date.now();
        this._markDirty();
        return target;
    }

    updateTodo({ idOrText, text, dueAt, priority, done }) {
        if (!idOrText) throw new Error('缺少待办 ID 或文字');
        const needle = idOrText.trim();
        let target = this.todos.find(t => t.id === needle);
        if (!target) {
            target = this.todos.find(t => t.text.includes(needle));
        }
        if (!target) throw new Error(`未找到待办：${needle}`);

        const changes = [];
        if (typeof text === 'string' && text.trim()) {
            target.text = text.trim();
            changes.push(`文字→"${target.text}"`);
        }
        if (dueAt !== undefined) {
            const newDue = parseTime(dueAt);
            if (dueAt !== null && dueAt !== '' && newDue === null) {
                throw new Error(`无法解析截止时间：${dueAt}`);
            }
            target.dueAt = newDue;
            changes.push(newDue ? `截止→${new Date(newDue).toLocaleString('zh-CN')}` : '截止→清空');
        }
        if (priority && ['low', 'normal', 'high'].includes(priority)) {
            target.priority = priority;
            changes.push(`优先级→${priority}`);
        }
        if (typeof done === 'boolean') {
            target.done = done;
            target.doneAt = done ? Date.now() : null;
            changes.push(done ? '标记完成' : '重新打开');
        }

        if (changes.length === 0) throw new Error('没有提供任何要修改的字段');
        this._markDirty();
        return { todo: target, changes };
    }

    deleteTodo({ idOrText }) {
        if (!idOrText) throw new Error('缺少待办 ID 或文字');
        const needle = idOrText.trim();
        let idx = this.todos.findIndex(t => t.id === needle);
        if (idx === -1) {
            idx = this.todos.findIndex(t => t.text.includes(needle));
        }
        if (idx === -1) throw new Error(`未找到待办：${needle}`);
        const removed = this.todos.splice(idx, 1)[0];
        this._markDirty();
        return removed;
    }

    // ========== 日程 ==========

    addSchedule({ title, startAt, endAt, location, notes }) {
        if (!title || !title.trim()) throw new Error('日程标题不能为空');
        const start = parseTime(startAt);
        if (start === null) throw new Error(`无法解析开始时间：${startAt}`);
        const end = parseTime(endAt);
        const schedule = {
            id: generateId('sch'),
            title: title.trim(),
            startAt: start,
            endAt: end,
            location: (location || '').trim(),
            notes: (notes || '').trim(),
            createdAt: Date.now()
        };
        this.schedules.push(schedule);
        this._markDirty();
        return schedule;
    }

    listSchedules({ from, to } = {}) {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const fromTs = parseTime(from) ?? todayStart;
        const toTs = parseTime(to) ?? (todayStart + 7 * 86400000);

        return this.schedules
            .filter(s => {
                const sStart = s.startAt;
                const sEnd = s.endAt || s.startAt;
                // 日程与查询区间有交集：日程开始 ≤ 查询结束 且 日程结束 ≥ 查询开始
                return sStart <= toTs && sEnd >= fromTs;
            })
            .sort((a, b) => a.startAt - b.startAt);
    }

    updateSchedule({ idOrTitle, title, startAt, endAt, location, notes }) {
        if (!idOrTitle) throw new Error('缺少日程 ID 或标题');
        const needle = idOrTitle.trim();
        let target = this.schedules.find(s => s.id === needle);
        if (!target) {
            target = this.schedules.find(s => s.title.includes(needle));
        }
        if (!target) throw new Error(`未找到日程：${needle}`);

        const changes = [];
        if (typeof title === 'string' && title.trim() && title.trim() !== target.title) {
            target.title = title.trim();
            changes.push('标题');
        }
        if (startAt !== undefined && startAt !== '') {
            const ts = parseTime(startAt);
            if (ts === null) throw new Error(`无法解析开始时间：${startAt}`);
            target.startAt = ts;
            changes.push('开始时间');
        }
        if (endAt !== undefined) {
            if (endAt === '' || endAt === null) {
                target.endAt = null;
                changes.push('结束时间');
            } else {
                const ts = parseTime(endAt);
                if (ts === null) throw new Error(`无法解析结束时间：${endAt}`);
                target.endAt = ts;
                changes.push('结束时间');
            }
        }
        if (typeof location === 'string') {
            target.location = location.trim();
            changes.push('地点');
        }
        if (typeof notes === 'string') {
            target.notes = notes.trim();
            changes.push('备注');
        }

        if (changes.length === 0) throw new Error('没有提供任何要修改的字段');
        this._markDirty();
        return { schedule: target, changes };
    }

    deleteSchedule({ idOrTitle }) {
        if (!idOrTitle) throw new Error('缺少日程 ID 或标题');
        const needle = idOrTitle.trim();
        let idx = this.schedules.findIndex(s => s.id === needle);
        if (idx === -1) {
            idx = this.schedules.findIndex(s => s.title.includes(needle));
        }
        if (idx === -1) throw new Error(`未找到日程：${needle}`);
        const removed = this.schedules.splice(idx, 1)[0];
        this._markDirty();
        return removed;
    }

    // ========== 提醒 ==========

    addReminder({ text, remindAt, repeat }) {
        if (!text || !text.trim()) throw new Error('提醒内容不能为空');
        const at = parseTime(remindAt);
        if (at === null) throw new Error(`无法解析提醒时间：${remindAt}`);
        const reminder = {
            id: generateId('rem'),
            text: text.trim(),
            remindAt: at,
            repeat: repeat || 'none',   // none / daily / weekly
            createdAt: Date.now(),
            done: false,
            triggeredAt: null
        };
        this.reminders.push(reminder);
        this._markDirty();
        return reminder;
    }

    listReminders({ includeDone = false, limit = 30 } = {}) {
        let list = this.reminders.slice();
        if (!includeDone) list = list.filter(r => !r.done);
        list.sort((a, b) => a.remindAt - b.remindAt);
        return list.slice(0, limit);
    }

    /**
     * 找出应该触发的提醒（到点 + 未完成）。
     * 返回数组，调用方负责播放和标记。
     */
    getDueReminders(now = Date.now()) {
        return this.reminders.filter(r => !r.done && r.remindAt <= now);
    }

    /**
     * 标记提醒已触发。
     * - repeat=none：done=true
     * - repeat=daily：remindAt += 1 天
     * - repeat=weekly：remindAt += 7 天
     */
    markReminderTriggered(id) {
        const r = this.reminders.find(x => x.id === id);
        if (!r) return null;
        r.triggeredAt = Date.now();
        if (r.repeat === 'daily') {
            r.remindAt += 86400000;
        } else if (r.repeat === 'weekly') {
            r.remindAt += 7 * 86400000;
        } else {
            r.done = true;
        }
        this._markDirty();
        return r;
    }

    updateReminder({ idOrText, text, remindAt, repeat }) {
        if (!idOrText) throw new Error('缺少提醒 ID 或文字');
        const needle = idOrText.trim();
        let target = this.reminders.find(r => r.id === needle);
        if (!target) {
            target = this.reminders.find(r => !r.done && r.text.includes(needle));
        }
        if (!target) throw new Error(`未找到提醒：${needle}`);

        const changes = [];
        if (typeof text === 'string' && text.trim()) {
            target.text = text.trim();
            changes.push('文字');
        }
        if (remindAt !== undefined && remindAt !== '') {
            const ts = parseTime(remindAt);
            if (ts === null) throw new Error(`无法解析提醒时间：${remindAt}`);
            target.remindAt = ts;
            changes.push('提醒时间');
        }
        if (repeat && ['none', 'daily', 'weekly'].includes(repeat)) {
            target.repeat = repeat;
            changes.push('重复');
        }

        if (changes.length === 0) throw new Error('没有提供任何要修改的字段');
        this._markDirty();
        return { reminder: target, changes };
    }
    deleteReminder({ idOrText }) {
        if (!idOrText) throw new Error('缺少提醒 ID 或文字');
        const needle = idOrText.trim();
        let idx = this.reminders.findIndex(r => r.id === needle);
        if (idx === -1) {
            idx = this.reminders.findIndex(r => !r.done && r.text.includes(needle));
        }
        if (idx === -1) throw new Error(`未找到提醒：${needle}`);
        const removed = this.reminders.splice(idx, 1)[0];
        this._markDirty();
        return removed;
    }

    // ========== 调试 ==========

    // ========== 复习卡片（SM-2） ==========

    addFlashcard({ front, back, tags, subject }) {
        if (!front || !front.trim()) throw new Error('卡片正面不能为空');
        if (!back || !back.trim()) throw new Error('卡片背面不能为空');

        // 去重：如果已有相同正面，返回已存在的
        const existing = this.flashcards.find(c => c.front.trim() === front.trim());
        if (existing) {
            return { card: existing, duplicate: true };
        }

        const now = Date.now();
        const card = {
            id: generateId('card'),
            front: front.trim(),
            back: back.trim(),
            tags: Array.isArray(tags) ? tags.filter(t => t && t.trim()).map(t => t.trim()) : [],
            subject: (subject || '').trim(),
            createdAt: now,
            dueAt: now,           // 新建的立刻可复习
            interval: 0,          // 天
            easeFactor: 2.5,      // EF 初始值
            repetitions: 0,
            lastReviewedAt: null,
            reviewHistory: []
        };
        this.flashcards.push(card);
        this._markDirty();
        return { card, duplicate: false };
    }

    listFlashcards({ subject, tag, limit = 50 } = {}) {
        let list = this.flashcards.slice();
        if (subject) list = list.filter(c => c.subject === subject);
        if (tag) list = list.filter(c => c.tags.includes(tag));
        list.sort((a, b) => a.dueAt - b.dueAt);
        return list.slice(0, limit);
    }

    getDueCards({ limit = 20, subject } = {}) {
        const now = Date.now();
        let list = this.flashcards.filter(c => c.dueAt <= now);
        if (subject) list = list.filter(c => c.subject === subject);
        list.sort((a, b) => a.dueAt - b.dueAt);
        return list.slice(0, limit);
    }

    reviewFlashcard({ idOrFront, rating }) {
        if (!idOrFront) throw new Error('缺少卡片 ID 或正面文字');
        if (!['again', 'hard', 'good', 'easy'].includes(rating)) {
            throw new Error('评分必须是 again / hard / good / easy');
        }

        const needle = idOrFront.trim();
        let target = this.flashcards.find(c => c.id === needle);
        if (!target) {
            target = this.flashcards.find(c => c.front.includes(needle));
        }
        if (!target) throw new Error(`未找到卡片：${needle}`);

        // SM-2 核心
        const q = { again: 1, hard: 3, good: 4, easy: 5 }[rating];

        // 更新 EF
        let newEF = target.easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
        newEF = Math.max(1.3, newEF);

        let newInterval, newReps;

        if (q < 3) {
            // 忘了 → 重置
            newReps = 0;
            newInterval = 1;
        } else {
            newReps = target.repetitions + 1;
            if (newReps === 1) {
                newInterval = 1;
            } else if (newReps === 2) {
                newInterval = 6;
            } else {
                newInterval = Math.round(target.interval * newEF);
            }
            // rating 微调
            if (rating === 'hard') newInterval = Math.max(1, Math.round(newInterval * 0.8));
            if (rating === 'easy') newInterval = Math.round(newInterval * 1.3);
        }

        const dueAt = Date.now() + newInterval * 86400000;

        // 保存
        target.easeFactor = Number(newEF.toFixed(3));
        target.interval = newInterval;
        target.repetitions = newReps;
        target.dueAt = dueAt;
        target.lastReviewedAt = Date.now();

        // 保留最近 10 次复习记录
        target.reviewHistory.push({
            at: Date.now(),
            rating,
            interval: newInterval
        });
        if (target.reviewHistory.length > 10) {
            target.reviewHistory = target.reviewHistory.slice(-10);
        }

        this._markDirty();
        return target;
    }

    updateFlashcard({ idOrFront, front, back, tags, subject, resetProgress, dueAt }) {
        if (!idOrFront) throw new Error('缺少卡片 ID 或正面文字');
        const needle = idOrFront.trim();
        let target = this.flashcards.find(c => c.id === needle);
        if (!target) {
            target = this.flashcards.find(c => c.front.includes(needle));
        }
        if (!target) throw new Error(`未找到卡片：${needle}`);

        const changes = [];
        if (typeof front === 'string' && front.trim() && front.trim() !== target.front) {
            target.front = front.trim();
            changes.push('正面');
        }
        if (typeof back === 'string' && back.trim() && back.trim() !== target.back) {
            target.back = back.trim();
            changes.push('背面');
        }
        if (Array.isArray(tags)) {
            target.tags = tags.filter(t => t && t.trim()).map(t => t.trim());
            changes.push('标签');
        }
        if (typeof subject === 'string') {
            target.subject = subject.trim();
            changes.push('科目');
        }
        // 手动设置复习时间（不走 SM-2）
        if (dueAt !== undefined) {
            const newDue = parseTime(dueAt);
            if (dueAt !== null && dueAt !== '' && newDue === null) {
                throw new Error(`无法解析复习时间：${dueAt}`);
            }
            target.dueAt = newDue;
            changes.push('复习时间');
        }
        if (resetProgress === true) {
            target.interval = 0;
            target.easeFactor = 2.5;
            target.repetitions = 0;
            target.dueAt = Date.now();
            target.lastReviewedAt = null;
            changes.push('复习进度');
        }

        if (changes.length === 0) throw new Error('没有提供任何要修改的字段');
        this._markDirty();
        return { card: target, changes };
    }

    deleteFlashcard({ idOrFront }) {
        if (!idOrFront) throw new Error('缺少卡片 ID 或正面文字');
        const needle = idOrFront.trim();
        let idx = this.flashcards.findIndex(c => c.id === needle);
        if (idx === -1) {
            idx = this.flashcards.findIndex(c => c.front.includes(needle));
        }
        if (idx === -1) throw new Error(`未找到卡片：${needle}`);
        const removed = this.flashcards.splice(idx, 1)[0];
        this._markDirty();
        return removed;
    }

    getFlashcardStats() {
        const now = Date.now();
        const total = this.flashcards.length;
        const due = this.flashcards.filter(c => c.dueAt <= now).length;
        // 按 subject 聚合
        const bySubject = {};
        for (const c of this.flashcards) {
            const key = c.subject || '(未分类)';
            if (!bySubject[key]) bySubject[key] = { total: 0, due: 0, avgEF: 0, sumEF: 0 };
            bySubject[key].total++;
            if (c.dueAt <= now) bySubject[key].due++;
            bySubject[key].sumEF += c.easeFactor;
        }
        for (const key in bySubject) {
            bySubject[key].avgEF = Number((bySubject[key].sumEF / bySubject[key].total).toFixed(2));
            delete bySubject[key].sumEF;
        }
        return { total, due, bySubject };
    }
    
    /**
     * 生成某时间段的统计。
     * @param {number} fromTs 起始时间戳（含）
     * @param {number} toTs   结束时间戳（含）
     */
    getPeriodStats(fromTs, toTs) {
        // === 待办 ===
        const todosCreated = this.todos.filter(t => t.createdAt >= fromTs && t.createdAt <= toTs);
        const todosCompleted = this.todos.filter(t => t.done && t.doneAt >= fromTs && t.doneAt <= toTs);
        const todosPending = this.todos.filter(t => !t.done);
        const todosOverdue = todosPending.filter(t => t.dueAt && t.dueAt < toTs);

        // === 日程 ===（有交集就算，包括跨天）
        const schedules = this.schedules.filter(s => {
            const sStart = s.startAt;
            const sEnd = s.endAt || s.startAt;
            return sStart <= toTs && sEnd >= fromTs;
        });

        // === 提醒 ===
        const reminders = this.reminders.filter(r => r.remindAt >= fromTs && r.remindAt <= toTs);

        // === 复习卡片 ===
        const cardsCreated = this.flashcards.filter(c => c.createdAt >= fromTs && c.createdAt <= toTs);
        const reviews = [];   // { cardId, subject, rating }
        for (const c of this.flashcards) {
            for (const h of c.reviewHistory || []) {
                if (h.at >= fromTs && h.at <= toTs) {
                    reviews.push({ cardId: c.id, subject: c.subject || '(未分类)', rating: h.rating });
                }
            }
        }

        // === 按科目聚合 ===
        const bySubject = {};
        const ensure = (key) => {
            if (!bySubject[key]) bySubject[key] = { total: 0, reviews: 0, again: 0, hard: 0, good: 0, easy: 0, sumEF: 0 };
        };
        for (const c of this.flashcards) {
            const key = c.subject || '(未分类)';
            ensure(key);
            bySubject[key].total++;
            bySubject[key].sumEF += c.easeFactor;
        }
        for (const r of reviews) {
            ensure(r.subject);
            bySubject[r.subject].reviews++;
            bySubject[r.subject][r.rating]++;
        }
        for (const key in bySubject) {
            const s = bySubject[key];
            s.avgEF = s.total > 0 ? Number((s.sumEF / s.total).toFixed(2)) : 0;
            const failed = s.again + s.hard;
            s.failRate = s.reviews > 0 ? Number((failed / s.reviews * 100).toFixed(1)) : 0;
            delete s.sumEF;
        }

        return {
            from: fromTs,
            to: toTs,
            todos: {
                created: todosCreated.length,
                completed: todosCompleted.length,
                pending: todosPending.length,
                overdue: todosOverdue.length,
                completedList: todosCompleted.map(t => t.text)
            },
            schedules: {
                count: schedules.length,
                list: schedules.map(s => ({
                    time: new Date(s.startAt).toLocaleString('zh-CN'),
                    title: s.title
                }))
            },
            reminders: {
                count: reminders.length
            },
            flashcards: {
                created: cardsCreated.length,
                reviewCount: reviews.length,
                bySubject
            }
        };
    }

    getStats() {
        return {
            todos: this.todos.length,
            todosPending: this.todos.filter(t => !t.done).length,
            schedules: this.schedules.length,
            reminders: this.reminders.length,
            remindersPending: this.reminders.filter(r => !r.done).length,
            flashcards: this.flashcards.length,
            flashcardsDue: this.flashcards.filter(c => c.dueAt <= Date.now()).length
        };
    }
}

module.exports = { DataStore, parseTime };