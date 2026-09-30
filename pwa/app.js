/**
 * Live2DPet PWA — 主逻辑
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'live2dpet_pwa_config';

    // ========== 配置管理 ==========

    function loadConfig() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const cfg = JSON.parse(raw);
            if (!cfg.gistId || !cfg.token) return null;
            return cfg;
        } catch { return null; }
    }

    function saveConfig(cfg) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    }

    function clearConfig() {
        localStorage.removeItem(STORAGE_KEY);
    }

    // ========== 状态 ==========

    let config = null;
    let gistData = null;      // { files, characters, pushedAt }
    let activeTab = 'todos';

    // ========== DOM ==========

    const $setupScreen = document.getElementById('setup-screen');
    const $mainScreen = document.getElementById('main-screen');
    const $content = document.getElementById('content');

    // ========== 工具 ==========

    function showStatus(el, msg, type) {
        if (!el) return;
        el.textContent = msg;
        el.className = 'status-bar show ' + (type || 'info');
        if (type === 'success' || type === 'error') {
            setTimeout(() => { el.className = 'status-bar'; }, 4000);
        }
    }

    function fmtTime(ts) {
        const d = new Date(ts);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

    function fmtDate(ts) {
        const d = new Date(ts);
        return `${d.getMonth() + 1}/${d.getDate()}`;
    }

    function fmtDateTime(ts) {
        const d = new Date(ts);
        return `${d.getMonth() + 1}月${d.getDate()}日 ${fmtTime(ts)}`;
    }

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

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

        if (!gistId) return showStatus(statusEl, '请填写 Gist ID', 'error');
        if (!token) return showStatus(statusEl, '请填写 GitHub Token', 'error');

        btn.disabled = true;
        btn.textContent = '连接中...';
        showStatus(statusEl, '正在测试连接...', 'info');

        try {
            await GistAPI.test(gistId, token);
            config = { gistId, token };
            saveConfig(config);
            showStatus(statusEl, '连接成功，加载数据...', 'success');
            await refreshData();
            showMain();
        } catch (err) {
            showStatus(statusEl, '失败：' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = '连接';
        }
    });

    // ========== 数据刷新 ==========

    async function refreshData() {
        if (!config) return;
        const data = await GistAPI.fetchData(config.gistId, config.token);
        gistData = data;
        renderActiveTab();
    }

    document.getElementById('btn-refresh').addEventListener('click', async () => {
        const btn = document.getElementById('btn-refresh');
        btn.textContent = '⏳';
        try {
            await refreshData();
        } catch (err) {
            alert('刷新失败：' + err.message);
        } finally {
            btn.textContent = '⟳';
        }
    });

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
        if (activeTab === 'settings') {
            renderSettings();
            return;
        }
        if (!gistData) {
            $content.innerHTML = '<div class="empty"><div class="emoji">⏳</div>加载中...</div>';
            return;
        }
        if (activeTab === 'todos') renderTodos();
        else if (activeTab === 'schedules') renderSchedules();
        else if (activeTab === 'flashcards') renderFlashcards();
    }

    // ========== 渲染：待办 ==========

    function renderTodos() {
        const data = GistAPI.parseFile(gistData, 'todos.json');
        const todos = data?.todos || [];

        if (todos.length === 0) {
            $content.innerHTML = '<div class="empty"><div class="emoji">✅</div>没有待办</div>';
            return;
        }

        // 排序：未完成在前，然后按 dueAt / createdAt
        const sorted = todos.slice().sort((a, b) => {
            if (a.done !== b.done) return a.done ? 1 : -1;
            const ta = a.dueAt || a.createdAt || 0;
            const tb = b.dueAt || b.createdAt || 0;
            return ta - tb;
        });

        const html = sorted.map(t => {
            const cls = 'card todo' + (t.done ? ' done' : '');
            const timeStr = t.dueAt ? fmtDate(t.dueAt) : '—';
            const metaParts = [];
            if (t.priority === 'high') metaParts.push('<span class="card-pill high">高</span>');
            if (t.dueAt && t.dueAt < Date.now() && !t.done) metaParts.push('<span class="card-pill due">已逾期</span>');
            if (t.done) metaParts.push('<span class="card-pill">已完成</span>');

            return `<div class="${cls}">
                <div class="card-header">
                    <div class="card-time">${timeStr}</div>
                    <div class="card-body">
                        <div class="card-title">${escapeHtml(t.text)}</div>
                        ${metaParts.length ? '<div class="card-meta">' + metaParts.join('') + '</div>' : ''}
                    </div>
                </div>
            </div>`;
        }).join('');

        $content.innerHTML = html;
    }

    // ========== 渲染：日程 ==========

    function renderSchedules() {
        const data = GistAPI.parseFile(gistData, 'schedules.json');
        const schedules = data?.schedules || [];

        if (schedules.length === 0) {
            $content.innerHTML = '<div class="empty"><div class="emoji">📅</div>没有日程</div>';
            return;
        }

        const now = Date.now();
        // 过滤未来和最近 30 天内的
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

        const html = filtered.map(s => {
            const startStr = fmtDateTime(s.startAt);
            const endStr = s.endAt ? ' 至 ' + fmtDateTime(s.endAt) : '';
            const metaParts = [];
            if (s.location) metaParts.push('📍 ' + escapeHtml(s.location));
            if (s.notes) metaParts.push(escapeHtml(s.notes));

            return `<div class="card schedule">
                <div class="card-header">
                    <div class="card-time">${fmtDate(s.startAt)}</div>
                    <div class="card-body">
                        <div class="card-title">${escapeHtml(s.title)}</div>
                        <div class="card-meta">${startStr}${endStr}</div>
                        ${metaParts.length ? '<div class="card-meta">' + metaParts.join(' · ') + '</div>' : ''}
                    </div>
                </div>
            </div>`;
        }).join('');

        $content.innerHTML = html;
    }

    // ========== 渲染：复习卡片 ==========

    function renderFlashcards() {
        const data = GistAPI.parseFile(gistData, 'flashcards.json');
        const cards = data?.flashcards || [];

        if (cards.length === 0) {
            $content.innerHTML = '<div class="empty"><div class="emoji">📇</div>没有卡片</div>';
            return;
        }

        const now = Date.now();
        const sorted = cards.slice().sort((a, b) => (a.dueAt || 0) - (b.dueAt || 0));

        // 统计
        const dueCount = sorted.filter(c => (c.dueAt || 0) <= now).length;

        const header = `<div class="settings-section" style="margin-bottom:12px;">
            <h2>📊 统计</h2>
            <p>总计 ${sorted.length} 张，待复习 <strong style="color:#e87eb8">${dueCount}</strong> 张</p>
        </div>`;

        const html = sorted.slice(0, 100).map(c => {
            const isDue = (c.dueAt || 0) <= now;
            const dueStr = isDue ? '🔴 待复习' : '📅 ' + fmtDate(c.dueAt);
            const metaParts = [];
            if (c.subject) metaParts.push('<span class="card-pill">' + escapeHtml(c.subject) + '</span>');
            (c.tags || []).forEach(t => metaParts.push('<span class="card-pill">' + escapeHtml(t) + '</span>'));
            metaParts.push('<span class="card-pill">' + dueStr + '</span>');

            return `<div class="card flashcard">
                <div class="card-header">
                    <div class="card-body">
                        <div class="card-title">${escapeHtml(c.front)}</div>
                        <div class="card-meta">${metaParts.join(' ')}</div>
                    </div>
                </div>
            </div>`;
        }).join('');

        $content.innerHTML = header + html;
    }

    // ========== 渲染：设置 ==========

    function renderSettings() {
        const lastSync = gistData?.pushedAt
            ? new Date(gistData.pushedAt).toLocaleString('zh-CN')
            : '(未知)';

        const fileCount = Object.keys(gistData?.files || {}).length;
        const charCount = Object.keys(gistData?.characters || {}).length;

        $content.innerHTML = `
            <div class="settings-section">
                <h2>连接信息</h2>
                <p>Gist ID: <code>${escapeHtml(config?.gistId || '')}</code></p>
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
                <p>数据来源：GitHub Gist（私有）</p>
                <p>电脑端编辑 → 上传 → 手机刷新即可看到最新数据。</p>
            </div>
        `;

        document.getElementById('btn-reload').addEventListener('click', async () => {
            await refreshData();
        });
        document.getElementById('btn-disconnect').addEventListener('click', () => {
            if (!confirm('断开连接？下次需要重新输入 Gist ID 和 Token。')) return;
            clearConfig();
            config = null;
            gistData = null;
            showSetup();
        });
    }

    // ========== 启动 ==========

    async function init() {
        // 注册 SW
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js').catch(() => {});
        }

        // 读取配置
        config = loadConfig();
        if (!config) {
            showSetup();
            return;
        }

        showMain();
        try {
            await refreshData();
        } catch (err) {
            $content.innerHTML = `<div class="empty"><div class="emoji">⚠️</div>加载失败：${escapeHtml(err.message)}<br><br><button class="btn-secondary" style="width:auto;padding:8px 20px;margin-top:12px;border:none;border-radius:8px;cursor:pointer;" onclick="location.reload()">重试</button></div>`;
        }
    }

    init();
})();