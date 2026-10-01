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
        this.chatMemoryFile = path.join(dataDir, 'chat-memory.json');
        this.agentHistoryFile = path.join(dataDir, 'agent-history.json');
        this.userProfileFile = path.join(dataDir, 'user-profile.json');
        this.observationsFile = path.join(dataDir, 'observations.json');
        this.timersFile = path.join(dataDir, 'timers.json');
        this.todos = [];
        this.schedules = [];
        this.reminders = [];
        this.flashcards = [];
        this.chatMemory = [];
        this.agentHistory = { summary: '', recent: [] };
        this.userProfile = { name: '', occupation: '', goals: [], preferences: [], background: [], updatedAt: 0 };
        this.observations = { observations: [], contacts: {} };
        this.timers = [];
        this._dirty = false;
        this._flushTimer = null;
        this._changeListeners = [];

        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        this._load();
    }

    _load() {
        this._loadErrors = {};
        this._blockedFiles = new Set();
        let needsRewrite = false;

        const readJson = (file) => {
            if (!fs.existsSync(file)) return null;
            try {
                return JSON.parse(fs.readFileSync(file, 'utf8'));
            } catch (err) {
                console.error(`[DataStore] load failed for ${path.basename(file)}:`, err.message);
                this._loadErrors[path.basename(file)] = err.message;
                try {
                    const backup = file + '.corrupted-' + Date.now();
                    fs.copyFileSync(file, backup);
                    console.warn(`[DataStore] Corrupted file backed up: ${path.basename(backup)}`);
                } catch {}
                this._blockedFiles.add(path.basename(file));
                return undefined;
            }
        };

        // 智能解包：处理 {key: [...]} 或 {key: {key: [...]}} 或更深层
        // 返回 { arr, nested } — nested 表示解了一层以上（需要修复写回）
        const unwrapArray = (obj, key) => {
            if (!obj) return { arr: [], nested: false };
            let cur = obj;
            let depth = 0;
            for (let i = 0; i < 8; i++) {
                if (Array.isArray(cur)) {
                    return { arr: cur, nested: depth > 0 };
                }
                if (cur && typeof cur === 'object' && Array.isArray(cur[key])) {
                    return { arr: cur[key], nested: depth > 0 };
                }
                if (cur && typeof cur === 'object' && cur[key] && typeof cur[key] === 'object') {
                    cur = cur[key];
                    depth++;
                    continue;
                }
                break;
            }
            return { arr: [], nested: depth > 0 };
        };

        const td = readJson(this.todosFile);
        if (td !== undefined) {
            const r = unwrapArray(td, 'todos');
            this.todos = r.arr;
            if (r.nested) needsRewrite = true;
        }

        const sd = readJson(this.schedulesFile);
        if (sd !== undefined) {
            const r = unwrapArray(sd, 'schedules');
            this.schedules = r.arr;
            if (r.nested) needsRewrite = true;
        }

        const rd = readJson(this.remindersFile);
        if (rd !== undefined) {
            const r = unwrapArray(rd, 'reminders');
            this.reminders = r.arr;
            if (r.nested) needsRewrite = true;
        }

        const fd = readJson(this.flashcardsFile);
        if (fd !== undefined) {
            const r = unwrapArray(fd, 'flashcards');
            this.flashcards = r.arr;
            if (r.nested) needsRewrite = true;
        }

        const cd = readJson(this.chatMemoryFile);
        if (cd !== undefined) {
            const r = unwrapArray(cd, 'messages');
            this.chatMemory = r.arr;
            if (r.nested) needsRewrite = true;
        }

        const tm = readJson(this.timersFile);
        if (tm !== undefined) {
            const r = unwrapArray(tm, 'timers');
            this.timers = r.arr;
            if (r.nested) needsRewrite = true;
        }

        // agent-history — 类似解包，但目标是对象
        const ad = readJson(this.agentHistoryFile);
        if (ad !== undefined) {
            let cur = ad;
            let depth = 0;
            for (let i = 0; i < 8; i++) {
                if (cur && typeof cur === 'object' &&
                    (cur.summary !== undefined || Array.isArray(cur.recent))) {
                    break;
                }
                if (cur && typeof cur === 'object' &&
                    cur['agent-history'] && typeof cur['agent-history'] === 'object') {
                    cur = cur['agent-history'];
                    depth++;
                    continue;
                }
                break;
            }
            this.agentHistory = {
                summary: cur?.summary || '',
                recent: Array.isArray(cur?.recent) ? cur.recent : []
            };
            if (depth > 0) needsRewrite = true;
        }

        // user-profile — 类似解包
        const ud = readJson(this.userProfileFile);
        if (ud !== undefined && ud && typeof ud === 'object') {
            let cur = ud;
            let depth = 0;
            for (let i = 0; i < 8; i++) {
                if (cur && typeof cur === 'object' &&
                    (cur.name !== undefined || cur.occupation !== undefined ||
                     Array.isArray(cur.goals) || Array.isArray(cur.preferences))) {
                    break;
                }
                if (cur && typeof cur === 'object' &&
                    cur['user-profile'] && typeof cur['user-profile'] === 'object') {
                    cur = cur['user-profile'];
                    depth++;
                    continue;
                }
                break;
            }
            this.userProfile = { ...this.userProfile, ...cur };
            if (depth > 0) needsRewrite = true;
        }

        // observations — 类似解包
        const od = readJson(this.observationsFile);
        if (od !== undefined) {
            let cur = od;
            let depth = 0;
            for (let i = 0; i < 8; i++) {
                if (cur && typeof cur === 'object' &&
                    Array.isArray(cur.observations)) {
                    break;
                }
                if (cur && typeof cur === 'object' &&
                    cur['observations'] && typeof cur['observations'] === 'object' &&
                    !Array.isArray(cur['observations'])) {
                    cur = cur['observations'];
                    depth++;
                    continue;
                }
                break;
            }
            this.observations = {
                observations: Array.isArray(cur?.observations) ? cur.observations : [],
                contacts: cur?.contacts && typeof cur.contacts === 'object' ? cur.contacts : {}
            };
            if (depth > 0) needsRewrite = true;
        }

        console.log(`[DataStore] loaded: ${this.todos.length} todos, ${this.schedules.length} schedules, ${this.reminders.length} reminders, ${this.flashcards.length} cards`);

        // ★ 检测到嵌套 → 标记脏，让下次 flush 写回正确格式
        if (needsRewrite) {
            console.warn('[DataStore] Detected nested JSON structure, will rewrite on next flush');
            this._markDirty();
        }

        if (Object.keys(this._loadErrors).length > 0) {
            console.warn('[DataStore] Some files failed to load:', this._loadErrors);
        }
    }

    onChange(fn) {
        if (typeof fn === 'function') this._changeListeners.push(fn);
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
        const blocked = this._blockedFiles || new Set();
        try {
            if (!blocked.has('todos.json') && Array.isArray(this.todos))
                fs.writeFileSync(this.todosFile, JSON.stringify({ todos: this.todos }, null, 2));
            if (!blocked.has('schedules.json') && Array.isArray(this.schedules))
                fs.writeFileSync(this.schedulesFile, JSON.stringify({ schedules: this.schedules }, null, 2));
            if (!blocked.has('reminders.json') && Array.isArray(this.reminders))
                fs.writeFileSync(this.remindersFile, JSON.stringify({ reminders: this.reminders }, null, 2));
            if (!blocked.has('flashcards.json') && Array.isArray(this.flashcards))
                fs.writeFileSync(this.flashcardsFile, JSON.stringify({ flashcards: this.flashcards }, null, 2));
            if (!blocked.has('chat-memory.json') && Array.isArray(this.chatMemory))
                fs.writeFileSync(this.chatMemoryFile, JSON.stringify({ messages: this.chatMemory }, null, 2));
            if (!blocked.has('agent-history.json'))
                fs.writeFileSync(this.agentHistoryFile, JSON.stringify(this.agentHistory, null, 2));
            if (!blocked.has('user-profile.json'))
                fs.writeFileSync(this.userProfileFile, JSON.stringify(this.userProfile, null, 2));
            if (!blocked.has('observations.json'))
                fs.writeFileSync(this.observationsFile, JSON.stringify(this.observations, null, 2));
            if (!blocked.has('timers.json') && Array.isArray(this.timers))
                fs.writeFileSync(this.timersFile, JSON.stringify({ timers: this.timers }, null, 2));
            this._dirty = false;
            // 通知监听者
            for (const fn of this._changeListeners) {
                try { fn(); } catch (e) { console.warn('[DataStore] listener error:', e.message); }
            }
        } catch (err) {
            console.error('[DataStore] flush failed:', err.message);
        }
    }

    // ========== 待办 ==========

    addTodo({ text, dueAt, priority }) {
        if (!text || !text.trim()) throw new Error('待办内容不能为空');
        const now = Date.now();
        const todo = {
            id: generateId('todo'),
            text: text.trim(),
            done: false,
            createdAt: now,
            dueAt: parseTime(dueAt),
            doneAt: null,
            priority: ['low', 'normal', 'high'].includes(priority) ? priority : 'normal',
            updatedAt: now
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
        target.updatedAt = Date.now();
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
        target.updatedAt = Date.now();
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
        const now = Date.now();
        const schedule = {
            id: generateId('sch'),
            title: title.trim(),
            startAt: start,
            endAt: end,
            location: (location || '').trim(),
            notes: (notes || '').trim(),
            createdAt: now,
            updatedAt: now
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
        target.updatedAt = Date.now();
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
        const now = Date.now();
        const reminder = {
            id: generateId('rem'),
            text: text.trim(),
            remindAt: at,
            repeat: repeat || 'none',
            createdAt: now,
            done: false,
            missed: false,
            triggeredAt: null,
            updatedAt: now
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
     * 一次性处理到点/过期/重复的提醒。
     * @param {number} now 当前时间戳
     * @param {number} windowMs 过期窗口（毫秒），超过此窗口的视为"已错过"
     * @returns {{ due: Array, missed: Array, advanced: Array }}
     */
    processReminders(now = Date.now(), windowMs = 30 * 60 * 1000) {
        const due = [];
        const missed = [];
        const advanced = [];

        for (const r of this.reminders) {
            if (r.done) continue;
            if (r.missed) continue;    // 已标记错过，跳过
            if (r.remindAt > now) continue;   // 还没到点

            const age = now - r.remindAt;

            if (r.repeat && r.repeat !== 'none') {
                // 重复提醒：窗口内正常触发，过期太久静默推进
                if (age <= windowMs) {
                    due.push(r);
                } else {
                    const stepMs = r.repeat === 'daily' ? 86400000 : 7 * 86400000;
                    do { r.remindAt += stepMs; } while (r.remindAt <= now);
                    r.updatedAt = now;
                    advanced.push(r);
                }
            } else {
                // 一次性提醒
                if (age <= windowMs) {
                    due.push(r);
                } else {
                    r.missed = true;
                    r.updatedAt = now;
                    missed.push(r);
                }
            }
        }

        if (missed.length > 0 || advanced.length > 0) this._markDirty();
        return { due, missed, advanced };
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
        const now = Date.now();
        if (r.repeat === 'daily') {
            // 一直加到未来，避免延迟触发导致跳过一天
            do { r.remindAt += 86400000; } while (r.remindAt <= now);
        } else if (r.repeat === 'weekly') {
            do { r.remindAt += 7 * 86400000; } while (r.remindAt <= now);
        } else {
            r.done = true;
        }
        r.updatedAt = now;   // 云同步用
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
            // 改了时间 → 重置所有已触发状态，让提醒重新生效
            target.missed = false;
            target.done = false;
            target.doneAt = null;
            target.triggeredAt = null;
            changes.push('提醒时间');
        }
        if (repeat && ['none', 'daily', 'weekly'].includes(repeat)) {
            target.repeat = repeat;
            changes.push('重复');
        }

        if (changes.length === 0) throw new Error('没有提供任何要修改的字段');
        target.updatedAt = Date.now();
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
            dueAt: now,
            interval: 0,
            easeFactor: 2.5,
            repetitions: 0,
            lastReviewedAt: null,
            reviewHistory: [],
            updatedAt: now
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

        target.updatedAt = Date.now();
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
        target.updatedAt = Date.now();
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

    // ========== 普通对话记忆 ==========

    loadChatMemory() {
        return this.chatMemory.slice();
    }

    saveChatMemory(messages) {
        if (!Array.isArray(messages)) throw new Error('messages 必须是数组');
        // 只保留最近 12 条（和渲染端一致）
        this.chatMemory = messages.slice(-12);
        this._markDirty();
        return this.chatMemory;
    }

    clearChatMemory() {
        this.chatMemory = [];
        this._markDirty();
    }

    // ========== Agent 历史 ==========

    loadAgentHistory() {
        return this.agentHistory;
    }

    saveAgentHistory(data) {
        if (!data || typeof data !== 'object') throw new Error('data 必须是对象');
        this.agentHistory = {
            summary: typeof data.summary === 'string' ? data.summary : '',
            recent: Array.isArray(data.recent) ? data.recent : []
        };
        this._markDirty();
        return this.agentHistory;
    }

    clearAgentHistory() {
        this.agentHistory = { summary: '', recent: [] };
        this._markDirty();
    }

    // ========== 用户画像 ==========

    loadUserProfile() {
        return this.userProfile;
    }

    saveUserProfile(data) {
        if (!data || typeof data !== 'object') throw new Error('data 必须是对象');
        this.userProfile = { ...this.userProfile, ...data };
        this._markDirty();
        return this.userProfile;
    }

    clearUserProfile() {
        this.userProfile = { name: '', occupation: '', goals: [], preferences: [], background: [], updatedAt: 0 };
        this._markDirty();
    }

    // ========== 观察日志 ==========

    loadObservations() {
        return this.observations;
    }

    saveObservations(data) {
        if (!data || typeof data !== 'object') throw new Error('data 必须是对象');
        this.observations = {
            observations: Array.isArray(data.observations) ? data.observations : [],
            contacts: data.contacts && typeof data.contacts === 'object' ? data.contacts : {}
        };
        this._markDirty();
        return this.observations;
    }

    clearObservations() {
        this.observations = { observations: [], contacts: {} };
        this._markDirty();
    }

    // ========== 倒计时 / 正计时 ==========

    addTimer({ name, type, durationMs, notifyText, writeToCalendar }) {
        if (!name || !name.trim()) throw new Error('名称不能为空');
        const t = type === 'countup' ? 'countup' : 'countdown';
        if (t === 'countdown') {
            const d = Number(durationMs);
            if (!Number.isFinite(d) || d <= 0) throw new Error('倒计时时长必须大于 0');
        }
        const now = Date.now();
        const timer = {
            id: generateId('tmr'),
            name: name.trim(),
            type: t,
            durationMs: t === 'countdown' ? Number(durationMs) : null,
            state: 'running',
            startedAt: now,
            elapsedBeforePause: 0,
            pausedAt: null,
            completedAt: null,
            notifyText: (notifyText || '').trim(),
            writeToCalendar: writeToCalendar !== false,
            createdAt: now,
            updatedAt: now
        };
        this.timers.push(timer);
        this._markDirty();
        return timer;
    }

    /**
     * 创建番茄钟（只创建第一个工作阶段）
     */
    addPomodoro({ name, workMin, breakMin, longBreakMin, roundsBeforeLong, totalRounds, notifyText }) {
        const now = Date.now();
        const w = Number(workMin) || 25;
        const b = Number(breakMin) || 5;
        const lb = Number(longBreakMin) || 15;
        const rbl = Number(roundsBeforeLong) || 4;
        const tr = Number(totalRounds) || 4;

        const timer = {
            id: generateId('pom'),
            name: (name || '番茄钟').trim(),
            type: 'countdown',
            durationMs: w * 60000,
            state: 'running',
            startedAt: now,
            elapsedBeforePause: 0,
            pausedAt: null,
            completedAt: null,
            notifyText: (notifyText || '').trim(),
            writeToCalendar: false,     // 番茄钟不写阶段日程
            createdAt: now,
            updatedAt: now,
            pomodoroMode: true,
            pomodoro: {
                workMin: w,
                breakMin: b,
                longBreakMin: lb,
                roundsBeforeLong: rbl,
                totalRounds: tr,
                currentRound: 1,
                phase: 'work',
                completedWorkRounds: 0    // 累计完成的工作轮数
            }
        };
        this.timers.push(timer);
        this._markDirty();
        return timer;
    }

    /**
     * 番茄钟推进到下一阶段（原地修改，不改 state）
     */
    _advancePomodoro(t) {
        const p = t.pomodoro;
        const now = Date.now();

        if (p.phase === 'work') {
            // 工作阶段结束 → 累计完成轮数
            p.completedWorkRounds = (p.completedWorkRounds || 0) + 1;
            const needLong = (p.completedWorkRounds % p.roundsBeforeLong === 0);
            if (needLong) {
                p.phase = 'longBreak';
                t.durationMs = p.longBreakMin * 60000;
            } else {
                p.phase = 'break';
                t.durationMs = p.breakMin * 60000;
            }
        } else {
            // 休息阶段结束 → 判断是否全部结束
            const nextRound = p.currentRound + 1;
            if (nextRound > p.totalRounds) {
                // 全部完成
                t.state = 'done';
                t.completedAt = now;
                t.elapsedBeforePause = t.durationMs;
                t.updatedAt = now;
                this._markDirty();
                return;
            }
            p.currentRound = nextRound;
            p.phase = 'work';
            t.durationMs = p.workMin * 60000;
        }

        // 应用新阶段
        t.startedAt = now;
        t.elapsedBeforePause = 0;
        t.pausedAt = null;
        t.updatedAt = now;
        this._markDirty();
    }

    listTimers() {
        return this.timers.slice();
    }

    getTimer(id) {
        return this.timers.find(t => t.id === id) || null;
    }

    pauseTimer(id) {
        const t = this.getTimer(id);
        if (!t) throw new Error('找不到计时器');
        if (t.state !== 'running') throw new Error('当前状态不能暂停');
        t.elapsedBeforePause += Date.now() - t.startedAt;
        t.pausedAt = Date.now();
        t.state = 'paused';
        t.updatedAt = Date.now();
        this._markDirty();
        return t;
    }

    resumeTimer(id) {
        const t = this.getTimer(id);
        if (!t) throw new Error('找不到计时器');
        if (t.state !== 'paused') throw new Error('当前状态不能继续');
        t.startedAt = Date.now();
        t.pausedAt = null;
        t.state = 'running';
        t.updatedAt = Date.now();
        this._markDirty();
        return t;
    }

    /**
     * 完成后继续：重置状态，改时长（倒计时）或清零（正计时）
     */
    restartTimer(id, newDurationMs) {
        const t = this.getTimer(id);
        if (!t) throw new Error('找不到计时器');
        const now = Date.now();
        if (t.type === 'countdown') {
            const d = Number(newDurationMs);
            if (!Number.isFinite(d) || d <= 0) throw new Error('时长必须大于 0');
            t.durationMs = d;
        }
        t.state = 'running';
        t.startedAt = now;
        t.elapsedBeforePause = 0;
        t.pausedAt = null;
        t.completedAt = null;
        t.updatedAt = now;
        this._markDirty();
        return t;
    }

    stopTimer(id) {
        const t = this.getTimer(id);
        if (!t) throw new Error('找不到计时器');
        const now = Date.now();
        // 把"最后一段运行时长"固定到 elapsedBeforePause
        if (t.state === 'running') {
            t.elapsedBeforePause = (t.elapsedBeforePause || 0) + (now - (t.startedAt || now));
        }
        t.state = 'done';
        t.completedAt = now;
        t.updatedAt = now;
        this._markDirty();
        return t;
    }

    updateTimer({ id, name, notifyText, writeToCalendar, durationMs, pomodoro }) {
        const t = this.getTimer(id);
        if (!t) throw new Error('找不到计时器');
        const changes = [];
        if (typeof name === 'string' && name.trim() && name.trim() !== t.name) {
            t.name = name.trim();
            changes.push('名称');
        }
        if (args.pomodoro && t.pomodoroMode && t.pomodoro) {
            const p = args.pomodoro;
            if (Number.isFinite(p.workMin) && p.workMin > 0) t.pomodoro.workMin = p.workMin;
            if (Number.isFinite(p.breakMin) && p.breakMin > 0) t.pomodoro.breakMin = p.breakMin;
            if (Number.isFinite(p.longBreakMin) && p.longBreakMin > 0) t.pomodoro.longBreakMin = p.longBreakMin;
            if (Number.isFinite(p.roundsBeforeLong) && p.roundsBeforeLong > 0) t.pomodoro.roundsBeforeLong = p.roundsBeforeLong;
            if (Number.isFinite(p.totalRounds) && p.totalRounds > 0) t.pomodoro.totalRounds = p.totalRounds;
            changes.push('番茄钟参数');
        }
        if (typeof notifyText === 'string') {
            t.notifyText = notifyText.trim();
            changes.push('提醒语');
        }
        if (typeof writeToCalendar === 'boolean') {
            t.writeToCalendar = writeToCalendar;
            changes.push('写日程');
        }
        if (durationMs !== undefined && t.type === 'countdown' && t.state !== 'running') {
            const d = Number(durationMs);
            if (Number.isFinite(d) && d > 0) {
                t.durationMs = d;
                changes.push('时长');
            }
        }
        if (changes.length === 0) throw new Error('没有提供任何要修改的字段');
        t.updatedAt = Date.now();
        this._markDirty();
        return { timer: t, changes };
    }

    deleteTimer(id) {
        const idx = this.timers.findIndex(t => t.id === id);
        if (idx === -1) throw new Error('找不到计时器');
        const removed = this.timers.splice(idx, 1)[0];
        this._markDirty();
        return removed;
    }

    /**
     * 计算计时器当前"已过毫秒"
     */
    getTimerElapsed(t) {
        if (t.state === 'paused') {
            return t.elapsedBeforePause;
        }
        if (t.state === 'done') {
            return t.type === 'countdown' ? t.durationMs : t.elapsedBeforePause;
        }
        return t.elapsedBeforePause + (Date.now() - t.startedAt);
    }

    /**
     * 找出已完成的倒计时（running + 到点）
     */
    getDueTimers(now = Date.now()) {
        return this.timers.filter(t => {
            if (t.state !== 'running') return false;
            if (t.type !== 'countdown') return false;
            return this.getTimerElapsed(t) >= t.durationMs;
        });
    }

    /**
     * 标记倒计时完成
     */
    markTimerCompleted(id) {
        const t = this.getTimer(id);
        if (!t) return null;
        const now = Date.now();

        // ★ 番茄钟：不标记 done，而是原地推进到下一阶段
        if (t.pomodoroMode && t.pomodoro) {
            const prevPhase = t.pomodoro.phase;
            const prevRound = t.pomodoro.currentRound;
            this._advancePomodoro(t);
            return {
                timer: t,
                pomodoroTransition: {
                    prevPhase,
                    prevRound,
                    finished: t.state === 'done'
                }
            };
        }

        // 普通计时器
        t.state = 'done';
        t.completedAt = now;
        t.elapsedBeforePause = t.durationMs;
        t.updatedAt = now;
        this._markDirty();
        return { timer: t, pomodoroTransition: null };
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