(function () {
    'use strict';

    const STORAGE_KEY = 'live2dpet_pwa_config';
    let config = null;
    let gistData = null;    // { version, pushedAt, files, characters }
    let parsed = null;      // { todos: {...}, schedules: {...}, flashcards: {...} }
    let activeTab = 'todos';
    let reviewState = null; // { card, flipped, index, queue }

    // ========== 配置 ==========
    function loadConfig() {
        try {
            const cfg = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            if (cfg?.gistId && cfg?.token) return cfg;
        } catch {}
        return null;
    }
    function saveConfig(cfg) { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); }
    function clearConfig() { localStorage.removeItem(STORAGE_KEY); }

    // ========== DOM ==========
    const $setupScreen = document.getElementById('setup-screen');
    const $mainScreen = document.getElementById('main-screen');
    const $content = document.getElementById('content');
    const $pageTitle = document.getElementById('page-title');
    const $btnAdd = document.getElementById('btn-add');
    const $modalMask = document.getElementById('modal-mask');
    const $modal = document.getElementById('modal');
    const $toast = document.getElementById('toast');

    // ========== 工具 ==========
    function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }
    function fmtTime(ts) {
        const d = new Date(ts);
        return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }
    function fmtDate(ts) {
        const d = new Date(ts);
        return `${d.getMonth()+1}/${d.getDate()}`;
    }
    function fmtDateTime(ts) {
        const d = new Date(ts);
        return `${d.getMonth()+1}月${d.getDate()}日 ${fmtTime(ts)}`;
    }
    function toLocalInput(ts) {
        const d = new Date(ts);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }
    function genId(prefix) {
        const rand = Math.random().toString(36).slice(2, 6);
        return `${prefix}_${Date.now()}_${rand}`;
    }
    function toast(msg) {
        $toast.textContent = msg;
        $toast.classList.add('show');
        setTimeout(() => $toast.classList.remove('show'), 1800);
    }

    // ========== 模态框 ==========
    function openModal(html) {
        $modal.innerHTML = html;
        $modalMask.classList.add('show');
    }
    function closeModal() {
        $modalMask.classList.remove('show');
    }
    $modalMask.addEventListener('click', (e) => {
        if (e.target === $modalMask) closeModal();
    });

    // ========== 屏幕切换 ==========
    function showSetup() {
        $setupScreen.style.display = '';
        $mainScreen.style.display = 'none';
    }
    function showMain() {
        $setupScreen.style.display = 'none';
        $mainScreen.style.display = '';
    }

    // ========== 首次连接 ==========
    document.getElementById('btn-connect').addEventListener('click', async () => {
        const btn = document.getElementById('btn-connect');
        const statusEl = document.getElementById('setup-status');
        const gistId = document.getElementById('input-gist-id').value.trim();
        const token = document.getElementById('input-github-token').value.trim();
        if (!gistId) return showSetupStatus(statusEl, '请填写 Gist ID', 'error');
        if (!token) return showSetupStatus(statusEl, '请填写 GitHub Token', 'error');

        btn.disabled = true; btn.textContent = '连接中...';
        showSetupStatus(statusEl, '正在测试连接...', 'info');
        try {
            await GistAPI.test(gistId, token);
            config = { gistId, token };
            saveConfig(config);
            showSetupStatus(statusEl, '连接成功', 'success');
            await refreshData();
            showMain();
        } catch (err) {
            showSetupStatus(statusEl, '失败：' + err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = '连接';
        }
    });
    function showSetupStatus(el, msg, type) {
        el.textContent = msg;
        el.className = 'status-bar show ' + (type || 'info');
    }

    // ========== 数据同步 ==========
    function parseAll() {
        parsed = {
            todos: GistAPI.parseFile(gistData, 'todos.json') || { todos: [] },
            schedules: GistAPI.parseFile(gistData, 'schedules.json') || { schedules: [] },
            flashcards: GistAPI.parseFile(gistData, 'flashcards.json') || { flashcards: [] }
        };
    }
    function serialize() {
        gistData.files['todos.json'] = { content: JSON.stringify(parsed.todos, null, 2), mtime: Date.now() };
        gistData.files['schedules.json'] = { content: JSON.stringify(parsed.schedules, null, 2), mtime: Date.now() };
        gistData.files['flashcards.json'] = { content: JSON.stringify(parsed.flashcards, null, 2), mtime: Date.now() };
        gistData.pushedAt = Date.now();
    }
    async function refreshData() {
        if (!config) return;
        gistData = await GistAPI.fetchData(config.gistId, config.token);
        parseAll();
        renderActiveTab();
    }
    async function syncToGist() {
        serialize();
        await GistAPI.writeData(config.gistId, config.token, {
            version: gistData.version,
            pushedAt: gistData.pushedAt,
            files: gistData.files,
            characters: gistData.characters
        });
    }

    // ========== Tab 切换 ==========
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            activeTab = tab.dataset.tab;
            renderActiveTab();
        });
    });

    function renderActiveTab() {
        // 根据 tab 显示/隐藏 "+" 按钮
        if (activeTab === 'todos' || activeTab === 'schedules') {
            $btnAdd.style.display = '';
        } else {
            $btnAdd.style.display = 'none';
        }
        const titles = { todos: '待办', schedules: '日程', flashcards: '卡片', settings: '设置' };
        $pageTitle.textContent = 'Live2DPet · ' + (titles[activeTab] || '');

        if (activeTab === 'settings') return renderSettings();
        if (activeTab === 'chat') return renderChat();
        if (!parsed) {
            $content.innerHTML = '<div class="empty"><div class="emoji">⏳</div>加载中...</div>';
            return;
        }
        if (activeTab === 'todos') renderTodos();
        else if (activeTab === 'schedules') renderSchedules();
        else if (activeTab === 'flashcards') renderFlashcards();
    }

    // ========== 刷新按钮 ==========
    document.getElementById('btn-refresh').addEventListener('click', async () => {
        const btn = document.getElementById('btn-refresh');
        btn.textContent = '⏳';
        try { await refreshData(); toast('已刷新'); }
        catch (err) { toast('刷新失败：' + err.message); }
        finally { btn.textContent = '⟳'; }
    });

    // ========== 新建按钮 ==========
    $btnAdd.addEventListener('click', () => {
        if (activeTab === 'todos') showAddTodoModal();
        else if (activeTab === 'schedules') showAddScheduleModal();
    });

    // ============================================================
    // 待办
    // ============================================================
    function renderTodos() {
        const todos = parsed.todos?.todos || [];
        if (todos.length === 0) {
            $content.innerHTML = '<div class="empty"><div class="emoji">✅</div>没有待办<br>点右上角 + 添加</div>';
            return;
        }
        const sorted = todos.slice().sort((a, b) => {
            if (a.done !== b.done) return a.done ? 1 : -1;
            const ta = a.dueAt || a.createdAt || 0;
            const tb = b.dueAt || b.createdAt || 0;
            return ta - tb;
        });
        $content.innerHTML = sorted.map(t => {
            const cls = 'card todo' + (t.done ? ' done' : '');
            const timeStr = t.dueAt ? fmtDate(t.dueAt) : '—';
            const metaParts = [];
            if (t.priority === 'high') metaParts.push('<span class="card-pill high">高</span>');
            if (t.dueAt && t.dueAt < Date.now() && !t.done) metaParts.push('<span class="card-pill due">已逾期</span>');
            return `<div class="${cls}" data-id="${t.id}">
                <div class="card-header">
                    <div class="todo-check ${t.done ? 'checked' : ''}" data-action="toggle">${t.done ? '✓' : ''}</div>
                    <div class="card-time">${timeStr}</div>
                    <div class="card-body tappable" data-action="edit">
                        <div class="card-title">${escapeHtml(t.text)}</div>
                        ${metaParts.length ? '<div class="card-meta">' + metaParts.join('') + '</div>' : ''}
                    </div>
                </div>
            </div>`;
        }).join('');

        // 事件委托
        $content.querySelectorAll('.card').forEach(card => {
            const id = card.dataset.id;
            card.querySelector('[data-action="toggle"]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleTodo(id);
            });
            card.querySelector('[data-action="edit"]')?.addEventListener('click', () => {
                showEditTodoModal(id);
            });
        });
    }

    function findTodo(id) {
        return parsed.todos.todos.find(t => t.id === id);
    }

    async function toggleTodo(id) {
        const t = findTodo(id);
        if (!t) return;
        t.done = !t.done;
        t.doneAt = t.done ? Date.now() : null;
        t.updatedAt = Date.now();
        try {
            await syncToGist();
            renderTodos();
            toast(t.done ? '已完成' : '已恢复');
        } catch (err) {
            // 回滚
            t.done = !t.done;
            t.doneAt = t.done ? Date.now() : null;
            toast('保存失败：' + err.message);
        }
    }

    function showAddTodoModal() {
        const def = new Date();
        def.setHours(18, 0, 0, 0);
        openModal(`
            <h2>新建待办</h2>
            <label>内容</label>
            <input type="text" id="m-todo-text" placeholder="要做什么？" autocomplete="off">
            <label>截止时间（可选）</label>
            <input type="datetime-local" id="m-todo-due" value="${toLocalInput(def.getTime())}">
            <label>优先级</label>
            <select id="m-todo-priority">
                <option value="low">低</option>
                <option value="normal" selected>普通</option>
                <option value="high">高</option>
            </select>
            <div class="modal-btns">
                <button class="btn-cancel" id="m-cancel">取消</button>
                <button class="btn-save" id="m-save">保存</button>
            </div>
        `);
        document.getElementById('m-cancel').onclick = closeModal;
        document.getElementById('m-save').onclick = async () => {
            const text = document.getElementById('m-todo-text').value.trim();
            if (!text) return toast('内容不能为空');
            const dueStr = document.getElementById('m-todo-due').value;
            const dueAt = dueStr ? new Date(dueStr).getTime() : null;
            const priority = document.getElementById('m-todo-priority').value;

            const now = Date.now();
            const todo = {
                id: genId('todo'),
                text,
                done: false,
                createdAt: now,
                dueAt,
                doneAt: null,
                priority,
                updatedAt: now
            };
            parsed.todos.todos.push(todo);
            try {
                await syncToGist();
                closeModal();
                renderTodos();
                toast('已添加');
            } catch (err) {
                parsed.todos.todos = parsed.todos.todos.filter(t => t.id !== todo.id);
                toast('保存失败：' + err.message);
            }
        };
        setTimeout(() => document.getElementById('m-todo-text')?.focus(), 100);
    }

    function showEditTodoModal(id) {
        const t = findTodo(id);
        if (!t) return;
        openModal(`
            <h2>编辑待办</h2>
            <label>内容</label>
            <input type="text" id="m-todo-text" value="${escapeHtml(t.text)}" autocomplete="off">
            <label>截止时间（可选）</label>
            <input type="datetime-local" id="m-todo-due" value="${t.dueAt ? toLocalInput(t.dueAt) : ''}">
            <label>优先级</label>
            <select id="m-todo-priority">
                <option value="low" ${t.priority==='low'?'selected':''}>低</option>
                <option value="normal" ${t.priority==='normal'||!t.priority?'selected':''}>普通</option>
                <option value="high" ${t.priority==='high'?'selected':''}>高</option>
            </select>
            <div class="modal-btns">
                <button class="btn-delete" id="m-delete">删除</button>
                <button class="btn-cancel" id="m-cancel">取消</button>
                <button class="btn-save" id="m-save">保存</button>
            </div>
        `);
        document.getElementById('m-cancel').onclick = closeModal;
        document.getElementById('m-delete').onclick = async () => {
            if (!confirm('确定删除这个待办吗？')) return;
            parsed.todos.todos = parsed.todos.todos.filter(x => x.id !== id);
            try {
                await syncToGist();
                closeModal();
                renderTodos();
                toast('已删除');
            } catch (err) { toast('删除失败：' + err.message); }
        };
        document.getElementById('m-save').onclick = async () => {
            const text = document.getElementById('m-todo-text').value.trim();
            if (!text) return toast('内容不能为空');
            const dueStr = document.getElementById('m-todo-due').value;
            const prev = { ...t };
            t.text = text;
            t.dueAt = dueStr ? new Date(dueStr).getTime() : null;
            t.priority = document.getElementById('m-todo-priority').value;
            t.updatedAt = Date.now();
            try {
                await syncToGist();
                closeModal();
                renderTodos();
                toast('已保存');
            } catch (err) {
                Object.assign(t, prev);
                toast('保存失败：' + err.message);
            }
        };
    }

    // ============================================================
    // 日程
    // ============================================================
    function renderSchedules() {
        const schedules = parsed.schedules?.schedules || [];
        if (schedules.length === 0) {
            $content.innerHTML = '<div class="empty"><div class="emoji">📅</div>没有日程<br>点右上角 + 添加</div>';
            return;
        }
        const now = Date.now();
        const from = now - 30 * 86400000;
        const filtered = schedules
            .filter(s => {
                const end = s.endAt || s.startAt;
                return end >= from;
            })
            .sort((a, b) => a.startAt - b.startAt);
        if (filtered.length === 0) {
            $content.innerHTML = '<div class="empty"><div class="emoji">📅</div>没有近期日程</div>';
            return;
        }
        $content.innerHTML = filtered.map(s => {
            const startStr = fmtDateTime(s.startAt);
            const endStr = s.endAt ? ' 至 ' + fmtDateTime(s.endAt) : '';
            const metaParts = [];
            if (s.location) metaParts.push('📍 ' + escapeHtml(s.location));
            if (s.notes) metaParts.push(escapeHtml(s.notes));
            return `<div class="card schedule" data-id="${s.id}">
                <div class="card-header">
                    <div class="card-time">${fmtDate(s.startAt)}</div>
                    <div class="card-body tappable" data-action="edit">
                        <div class="card-title">${escapeHtml(s.title)}</div>
                        <div class="card-meta">${startStr}${endStr}</div>
                        ${metaParts.length ? '<div class="card-meta">' + metaParts.join(' · ') + '</div>' : ''}
                    </div>
                </div>
            </div>`;
        }).join('');

        $content.querySelectorAll('.card').forEach(card => {
            card.querySelector('[data-action="edit"]')?.addEventListener('click', () => {
                showEditScheduleModal(card.dataset.id);
            });
        });
    }

    function showAddScheduleModal() {
        const def = new Date();
        def.setMinutes(0, 0, 0);
        def.setHours(def.getHours() + 1);
        openModal(`
            <h2>新建日程</h2>
            <label>标题</label>
            <input type="text" id="m-sch-title" placeholder="如：和导师开会" autocomplete="off">
            <label>开始时间</label>
            <input type="datetime-local" id="m-sch-start" value="${toLocalInput(def.getTime())}">
            <label>结束时间（可选）</label>
            <input type="datetime-local" id="m-sch-end">
            <label>地点（可选）</label>
            <input type="text" id="m-sch-location" placeholder="如：图书馆">
            <label>备注（可选）</label>
            <textarea id="m-sch-notes" rows="2"></textarea>
            <div class="modal-btns">
                <button class="btn-cancel" id="m-cancel">取消</button>
                <button class="btn-save" id="m-save">保存</button>
            </div>
        `);
        document.getElementById('m-cancel').onclick = closeModal;
        document.getElementById('m-save').onclick = async () => {
            const title = document.getElementById('m-sch-title').value.trim();
            if (!title) return toast('标题不能为空');
            const startStr = document.getElementById('m-sch-start').value;
            if (!startStr) return toast('请填写开始时间');
            const endStr = document.getElementById('m-sch-end').value;
            const now = Date.now();
            const sch = {
                id: genId('sch'),
                title,
                startAt: new Date(startStr).getTime(),
                endAt: endStr ? new Date(endStr).getTime() : null,
                location: document.getElementById('m-sch-location').value.trim(),
                notes: document.getElementById('m-sch-notes').value.trim(),
                createdAt: now,
                updatedAt: now
            };
            parsed.schedules.schedules.push(sch);
            try {
                await syncToGist();
                closeModal();
                renderSchedules();
                toast('已添加');
            } catch (err) {
                parsed.schedules.schedules = parsed.schedules.schedules.filter(x => x.id !== sch.id);
                toast('保存失败：' + err.message);
            }
        };
        setTimeout(() => document.getElementById('m-sch-title')?.focus(), 100);
    }

    function showEditScheduleModal(id) {
        const s = parsed.schedules.schedules.find(x => x.id === id);
        if (!s) return;
        openModal(`
            <h2>编辑日程</h2>
            <label>标题</label>
            <input type="text" id="m-sch-title" value="${escapeHtml(s.title)}" autocomplete="off">
            <label>开始时间</label>
            <input type="datetime-local" id="m-sch-start" value="${toLocalInput(s.startAt)}">
            <label>结束时间（可选）</label>
            <input type="datetime-local" id="m-sch-end" value="${s.endAt ? toLocalInput(s.endAt) : ''}">
            <label>地点（可选）</label>
            <input type="text" id="m-sch-location" value="${escapeHtml(s.location || '')}">
            <label>备注（可选）</label>
            <textarea id="m-sch-notes" rows="2">${escapeHtml(s.notes || '')}</textarea>
            <div class="modal-btns">
                <button class="btn-delete" id="m-delete">删除</button>
                <button class="btn-cancel" id="m-cancel">取消</button>
                <button class="btn-save" id="m-save">保存</button>
            </div>
        `);
        document.getElementById('m-cancel').onclick = closeModal;
        document.getElementById('m-delete').onclick = async () => {
            if (!confirm('确定删除这个日程吗？')) return;
            parsed.schedules.schedules = parsed.schedules.schedules.filter(x => x.id !== id);
            try {
                await syncToGist();
                closeModal();
                renderSchedules();
                toast('已删除');
            } catch (err) { toast('删除失败：' + err.message); }
        };
        document.getElementById('m-save').onclick = async () => {
            const title = document.getElementById('m-sch-title').value.trim();
            if (!title) return toast('标题不能为空');
            const startStr = document.getElementById('m-sch-start').value;
            if (!startStr) return toast('请填写开始时间');
            const endStr = document.getElementById('m-sch-end').value;
            const prev = { ...s };
            s.title = title;
            s.startAt = new Date(startStr).getTime();
            s.endAt = endStr ? new Date(endStr).getTime() : null;
            s.location = document.getElementById('m-sch-location').value.trim();
            s.notes = document.getElementById('m-sch-notes').value.trim();
            s.updatedAt = Date.now();
            try {
                await syncToGist();
                closeModal();
                renderSchedules();
                toast('已保存');
            } catch (err) {
                Object.assign(s, prev);
                toast('保存失败：' + err.message);
            }
        };
    }

    // ============================================================
    // 复习卡片
    // ============================================================
    function renderFlashcards() {
        const cards = parsed.flashcards?.flashcards || [];
        const now = Date.now();
        const dueCards = cards.filter(c => (c.dueAt || 0) <= now);

        if (cards.length === 0) {
            $content.innerHTML = '<div class="empty"><div class="emoji">📇</div>没有卡片</div>';
            return;
        }

        if (dueCards.length > 0) {
            // 显示复习视图
            const queue = dueCards.slice(0, 20);
            reviewState = { queue, index: 0, flipped: false };
            renderReviewView();
        } else {
            // 显示卡片列表
            const header = `<div class="settings-section" style="margin-bottom:12px;">
                <h2>📊 统计</h2>
                <p>总计 ${cards.length} 张，今天无待复习 🎉</p>
            </div>`;
            const html = cards.slice(0, 100).map(c => {
                const metaParts = [];
                if (c.subject) metaParts.push('<span class="card-pill">' + escapeHtml(c.subject) + '</span>');
                (c.tags || []).forEach(t => metaParts.push('<span class="card-pill">' + escapeHtml(t) + '</span>'));
                metaParts.push('<span class="card-pill">📅 ' + fmtDate(c.dueAt) + '</span>');
                return `<div class="card flashcard">
                    <div class="card-body">
                        <div class="card-title">${escapeHtml(c.front)}</div>
                        <div class="card-meta">${metaParts.join(' ')}</div>
                    </div>
                </div>`;
            }).join('');
            $content.innerHTML = header + html;
        }
    }

    function renderReviewView() {
        if (!reviewState || reviewState.index >= reviewState.queue.length) {
            $content.innerHTML = '<div class="empty"><div class="emoji">🎉</div>复习完成！<br><br><button class="btn-secondary" style="width:auto;padding:10px 24px;margin-top:12px;border:none;border-radius:8px;cursor:pointer;" id="btn-done">返回列表</button></div>';
            document.getElementById('btn-done')?.addEventListener('click', () => { reviewState = null; renderFlashcards(); });
            return;
        }
        const card = reviewState.queue[reviewState.index];
        const flipped = reviewState.flipped;

        $content.innerHTML = `
            <div class="settings-section" style="margin-bottom:12px;text-align:center;">
                <p>${reviewState.index + 1} / ${reviewState.queue.length}${card.subject ? ' · ' + escapeHtml(card.subject) : ''}</p>
            </div>
            <div class="review-card" id="review-card">
                ${flipped ? escapeHtml(card.back) : escapeHtml(card.front)}
            </div>
            <div class="review-hint">${flipped ? '选择记忆程度' : '点击卡片查看答案'}</div>
            ${flipped ? `
                <div class="review-rating">
                    <button class="rating-again" data-rating="again">忘了</button>
                    <button class="rating-hard" data-rating="hard">勉强</button>
                    <button class="rating-good" data-rating="good">记得</button>
                    <button class="rating-easy" data-rating="easy">太简单</button>
                </div>
            ` : ''}
        `;

        document.getElementById('review-card').onclick = () => {
            reviewState.flipped = !reviewState.flipped;
            renderReviewView();
        };
        $content.querySelectorAll('.review-rating button').forEach(btn => {
            btn.onclick = () => rateCard(btn.dataset.rating);
        });
    }

    async function rateCard(rating) {
        if (!reviewState) return;
        const card = reviewState.queue[reviewState.index];
        const prev = { ...card };
        applySM2(card, rating);
        try {
            await syncToGist();
            reviewState.index++;
            reviewState.flipped = false;
            renderReviewView();
        } catch (err) {
            Object.assign(card, prev);
            toast('保存失败：' + err.message);
        }
    }

    function applySM2(card, rating) {
        const q = { again: 1, hard: 3, good: 4, easy: 5 }[rating];
        let newEF = card.easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
        newEF = Math.max(1.3, newEF);
        let newInterval, newReps;
        if (q < 3) {
            newReps = 0;
            newInterval = 1;
        } else {
            newReps = (card.repetitions || 0) + 1;
            if (newReps === 1) newInterval = 1;
            else if (newReps === 2) newInterval = 6;
            else newInterval = Math.round((card.interval || 1) * newEF);
            if (rating === 'hard') newInterval = Math.max(1, Math.round(newInterval * 0.8));
            if (rating === 'easy') newInterval = Math.round(newInterval * 1.3);
        }
        card.easeFactor = Number(newEF.toFixed(3));
        card.interval = newInterval;
        card.repetitions = newReps;
        card.dueAt = Date.now() + newInterval * 86400000;
        card.lastReviewedAt = Date.now();
        card.updatedAt = Date.now();
        card.reviewHistory = [...(card.reviewHistory || []).slice(-9), { at: Date.now(), rating, interval: newInterval }];
    }

    // ============================================================
    // 设置
    // ============================================================
    function renderSettings() {
        const lastSync = gistData?.pushedAt ? new Date(gistData.pushedAt).toLocaleString('zh-CN') : '(未知)';
        const fileCount = Object.keys(gistData?.files || {}).length;
        const charCount = Object.keys(gistData?.characters || {}).length;
        $content.innerHTML = `
            <div class="settings-section">
                <h2>连接信息</h2>
                <p>Gist ID：<code>${escapeHtml(config?.gistId || '')}</code></p>
                <p>数据文件：${fileCount} 个</p>
                <p>角色卡：${charCount} 张</p>
                <p>云端版本时间：${lastSync}</p>
            </div>
            <div class="settings-section">
                <h2>操作</h2>
                <button class="btn-secondary" id="btn-reload">重新加载数据</button>
                <button class="btn-danger" id="btn-disconnect">断开连接</button>
            </div>
            <div class="settings-section">
                <h2>关于</h2>
                <p>Live2DPet Workspace · MIT License</p>
                <p>在手机上编辑后，数据会自动推回 Gist。电脑端下次同步时会看到。</p>
            </div>
        `;
        document.getElementById('btn-reload').onclick = async () => {
            try { await refreshData(); toast('已重新加载'); }
            catch (err) { toast('加载失败：' + err.message); }
        };
        document.getElementById('btn-disconnect').onclick = () => {
            if (!confirm('断开连接？下次需要重新输入 Gist ID 和 Token。')) return;
            clearConfig();
            config = null;
            gistData = null;
            parsed = null;
            showSetup();
        };
    }

    // ========== 启动 ==========
    async function init() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js').catch(() => {});
        }
        config = loadConfig();
        if (!config) return showSetup();
        showMain();
        try {
            await refreshData();
        } catch (err) {
            $content.innerHTML = `<div class="empty"><div class="emoji">⚠️</div>加载失败：${escapeHtml(err.message)}<br><br><button class="btn-secondary" style="width:auto;padding:10px 24px;margin-top:12px;border:none;border-radius:8px;cursor:pointer;" onclick="location.reload()">重试</button></div>`;
        }
    }

    // ============================================================
    // AI 聊天
    // ============================================================

    let chatSending = false;

    function renderChat() {
        const aiCfg = PwaChat.loadAIConfig();
        if (!aiCfg) {
            renderChatSetup();
            return;
        }

        const history = PwaChat.loadHistory();
        const character = PwaChat.pickCharacter(gistData?.characters);
        const charName = character?.name || '助手';

        // 生成消息 HTML
        const messagesHtml = history.length === 0
            ? `<div class="empty" style="padding:30px 20px;">
                 <div class="emoji">💬</div>
                 和 ${escapeHtml(charName)} 聊天
               </div>`
            : history.map(m => {
                const isUser = m.role === 'user';
                return `<div class="msg ${isUser ? 'user' : 'ai'}">
                    <div class="msg-bubble">${escapeHtml(m.content).replace(/\n/g, '<br>')}</div>
                </div>`;
              }).join('');

        $content.innerHTML = `
            <div class="chat-container">
                <div class="chat-messages" id="chat-messages">
                    ${messagesHtml}
                    <div id="chat-thinking" style="display:none" class="msg ai">
                        <div class="msg-bubble"><span class="typing">···</span></div>
                    </div>
                </div>
                <div class="chat-input-bar">
                    <input type="text" id="chat-input" placeholder="说点什么..." autocomplete="off">
                    <button id="chat-send" class="chat-send-btn">➤</button>
                </div>
            </div>
        `;

        // 滚动到底部
        const msgContainer = document.getElementById('chat-messages');
        if (msgContainer) msgContainer.scrollTop = msgContainer.scrollHeight;

        // 绑定事件
        const input = document.getElementById('chat-input');
        const sendBtn = document.getElementById('chat-send');

        const doSend = async () => {
            const text = input.value.trim();
            if (!text || chatSending) return;
            input.value = '';
            await sendChatMessage(text);
        };

        sendBtn.onclick = doSend;
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                doSend();
            }
        });
    }

    function renderChatSetup() {
        $content.innerHTML = `
            <div class="settings-section">
                <h2>配置 AI 聊天</h2>
                <p>使用 OpenAI 兼容的 API。填写后保存在本机，不会上传。</p>
                <label>API 地址</label>
                <input type="text" id="ai-baseurl" placeholder="https://api.deepseek.com" value="">
                <label>API Key</label>
                <input type="password" id="ai-apikey" placeholder="sk-...">
                <label>模型名称</label>
                <input type="text" id="ai-model" placeholder="deepseek-chat">
                <div style="margin-top:14px;">
                    <button class="btn-secondary" id="ai-save-btn">保存并开始聊天</button>
                </div>
                <div id="ai-setup-status" class="status-bar"></div>
            </div>
        `;

        document.getElementById('ai-save-btn').onclick = () => {
            const baseURL = document.getElementById('ai-baseurl').value.trim();
            const apiKey = document.getElementById('ai-apikey').value.trim();
            const modelName = document.getElementById('ai-model').value.trim();
            const statusEl = document.getElementById('ai-setup-status');
            if (!baseURL || !apiKey || !modelName) {
                statusEl.textContent = '请填写全部字段';
                statusEl.className = 'status-bar show error';
                return;
            }
            PwaChat.saveAIConfig({ baseURL, apiKey, modelName });
            renderChat();
        };
    }

    async function sendChatMessage(text) {
        if (chatSending) return;
        chatSending = true;

        const aiCfg = PwaChat.loadAIConfig();
        if (!aiCfg) { chatSending = false; return; }

        // 1. 追加用户消息
        let history = PwaChat.loadHistory();
        history.push({ role: 'user', content: text, ts: Date.now() });
        PwaChat.saveHistory(history);
        renderChat();

        // 2. 显示"思考中"
        const thinking = document.getElementById('chat-thinking');
        if (thinking) thinking.style.display = '';
        const msgContainer = document.getElementById('chat-messages');
        if (msgContainer) msgContainer.scrollTop = msgContainer.scrollHeight;

        // 3. 构建请求
        const character = PwaChat.pickCharacter(gistData?.characters);
        const sysPrompt = PwaChat.buildSystemPrompt(character);

        const messages = [
            { role: 'system', content: sysPrompt },
            ...history.slice(-10).map(m => ({ role: m.role, content: m.content }))
        ];

        try {
            const reply = await PwaChat.callAI(messages, aiCfg);
            if (reply) {
                history = PwaChat.loadHistory();
                history.push({ role: 'assistant', content: reply, ts: Date.now() });
                PwaChat.saveHistory(history);
            }
        } catch (err) {
            history = PwaChat.loadHistory();
            history.push({ role: 'assistant', content: '⚠️ 出错了：' + err.message, ts: Date.now() });
            PwaChat.saveHistory(history);
        } finally {
            chatSending = false;
            renderChat();
        }
    }

    init();
})();