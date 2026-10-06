/**
 * Window Manager — extracted from main.js
 * Handles settings window, pet window, chat bubble, and window control IPC handlers.
 */

const CSP = "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; " +
    "connect-src * data: blob:; img-src * data: file: blob:; " +
    "media-src * data: blob:; font-src 'self' data:";

function applyCSP(win) {
    win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [CSP]
            }
        });
    });
}

function registerWindowHandlers(ctx, ipcMain, deps) {
    // deps: { BrowserWindow, path, screen, updateTrayMenu, basePath }
    ctx.chatBubbleInChatMode = false;
    ctx.windowAnchor = ctx.windowAnchor || 'above';
    ctx.agentMode = false;
    ctx.agentMode = 'chat';   // 'chat' | 'agent' | 'plan'
    ctx.proactiveEnabled = ctx.proactiveEnabled !== false;
    ctx.agentHistorySnapshot = { summary: '', recent: [] };
    ctx.agentHistoryWindow = null;
    ctx.observationSnapshot = { observations: [], contacts: {} };
    ctx.observationWindow = null;
    ctx.flashcardReviewWindow = null;
    ctx.calendarWindow = null;
        // 计算窗口位置（anchor: above | below | left | right）
    function computeAnchorPos(petBounds, W, H, anchor) {
        const PET = petBounds;
        switch (anchor) {
            case 'below':
                return { x: Math.round(PET.x + (PET.width - W) / 2),
                         y: Math.round(PET.y + PET.height) };
            case 'left':
                return { x: Math.round(PET.x - W - 8),
                         y: Math.round(PET.y + (PET.height - H) / 2) };
            case 'right':
                return { x: Math.round(PET.x + PET.width + 8),
                         y: Math.round(PET.y + (PET.height - H) / 2) };
            case 'above':
            default:
                return { x: Math.round(PET.x + (PET.width - W) / 2),
                         y: Math.round(PET.y - H) };
        }
    }

    function setWindowAnchor(anchor) {
        console.log('[ChatDialog] setWindowAnchor:', anchor);
        ctx.windowAnchor = anchor;
        if (ctx.chatBubbleWindow && !ctx.chatBubbleWindow.isDestroyed() && ctx.chatBubbleInChatMode) {
            const W = 380, H = 380;
            const pb = ctx.petWindow.getBounds();
            const pos = computeAnchorPos(pb, W, H, anchor);
            ctx.chatBubbleWindow.setBounds({
                x: Math.max(0, pos.x), y: Math.max(0, pos.y), width: W, height: H
            });
        }
    }

    // 获取当前锚点配置（从 config.json 读，默认 above）
    async function getAnchor() {
        try {
            const config = await deps.configManager.loadConfigFile();
            return config.bubble?.anchor || 'above';
        } catch { return 'above'; }
    }

    function createSettingsWindow() {
        ctx.settingsWindow = new deps.BrowserWindow({
            width: 480,
            height: 600,
            frame: true,
            resizable: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: deps.path.join(deps.basePath, 'preload.js')
            }
        });
        ctx.settingsWindow.loadFile(deps.path.join(deps.basePath, 'index.html'));
        ctx.settingsWindow.on('close', (e) => {
            if (!ctx.isQuitting) {
                e.preventDefault();
                ctx.settingsWindow.hide();
                return;
            }
        });
        ctx.settingsWindow.on('closed', () => { ctx.settingsWindow = null; });
        applyCSP(ctx.settingsWindow);
    }

    // ========== Pet Window ==========

    ipcMain.handle('clear-agent-history', async () => {
        const { BrowserWindow } = require('electron');
        for (const w of BrowserWindow.getAllWindows()) {
            if (!w.isDestroyed()) w.webContents.send('clear-agent-history');
        }
        // 立即清空主进程缓存
        ctx.agentHistorySnapshot = { summary: '', recent: [] };
        // 通知所有窗口刷新
        for (const w of BrowserWindow.getAllWindows()) {
            if (!w.isDestroyed()) w.webContents.send('agent-history-updated');
        }
        return { success: true };
    });

    ipcMain.handle('clear-chat-memory', async () => {
        const { BrowserWindow } = require('electron');
        console.log('[Main] Broadcasting clear-chat-memory');
        for (const w of BrowserWindow.getAllWindows()) {
            if (!w.isDestroyed()) w.webContents.send('clear-chat-memory');
        }
        return { success: true };
    });

    ipcMain.handle('clear-observation-data', async () => {
        const { BrowserWindow } = require('electron');
        console.log('[Main] Broadcasting clear-observation-data');
        ctx.observationSnapshot = { observations: [], contacts: {} };
        for (const w of BrowserWindow.getAllWindows()) {
            if (!w.isDestroyed()) {
                w.webContents.send('clear-observation-data');
                w.webContents.send('observation-updated');
            }
        }
        return { success: true };
    });

    ipcMain.handle('create-pet-window', async (event, data) => {
        try {
            if (ctx.petWindow && !ctx.petWindow.isDestroyed()) {
                ctx.petWindow.focus();
                return { success: true, message: 'already open' };
            }
            if (data) ctx.characterData = { ...ctx.characterData, ...data };

            ctx.petWindow = new deps.BrowserWindow({
                width: 300, height: 300,
                frame: false, transparent: true, alwaysOnTop: true,
                resizable: false, minimizable: false, maximizable: false,
                fullscreenable: false, skipTaskbar: true,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    preload: deps.path.join(deps.basePath, 'preload.js')
                }
            });
            ctx.petWindow.setAlwaysOnTop(true, 'screen-saver');
            ctx.petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
            ctx.petWindow.loadFile(deps.path.join(deps.basePath, 'desktop-pet.html'));
            applyCSP(ctx.petWindow);

            const { screen } = require('electron');
            const primaryDisplay = screen.getPrimaryDisplay();
            const { width, height } = primaryDisplay.workAreaSize;
            ctx.petWindow.setPosition(width - 220, height - 220);

            ctx.petWindow.on('closed', () => {
                ctx.petWindow = null;
                if (ctx.chatBubbleWindow && !ctx.chatBubbleWindow.isDestroyed()) ctx.chatBubbleWindow.close();
                if (ctx.settingsWindow && !ctx.settingsWindow.isDestroyed()) {
                    ctx.settingsWindow.webContents.send('pet-window-closed');
                }
                deps.updateTrayMenu();
            });

            // Hide settings window to tray when pet starts
            if (ctx.settingsWindow && !ctx.settingsWindow.isDestroyed()) {
                ctx.settingsWindow.hide();
            }
            deps.updateTrayMenu();

            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('close-pet-window', async () => {
        try {
            if (ctx.petWindow && !ctx.petWindow.isDestroyed()) ctx.petWindow.close();
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('update-pet-character', async (event, data) => {
        try {
            if (data) ctx.characterData = { ...ctx.characterData, ...data };
            if (ctx.petWindow && !ctx.petWindow.isDestroyed()) {
                ctx.petWindow.webContents.send('character-update', ctx.characterData);
            }
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-character-data', async () => {
        return ctx.characterData;
    });

    // ========== Window Control ==========

    ipcMain.handle('set-window-size', async (event, width, height) => {
        try {
            if (ctx.petWindow && !ctx.petWindow.isDestroyed()) ctx.petWindow.setSize(width, height);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('set-window-position', async (event, x, y, w, h) => {
        try {
            if (ctx.petWindow && !ctx.petWindow.isDestroyed()) {
                if (w && h) {
                    ctx.petWindow.setBounds({ x, y, width: w, height: h });
                } else {
                    ctx.petWindow.setPosition(x, y);
                }
            }
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-window-bounds', async () => {
        if (ctx.petWindow && !ctx.petWindow.isDestroyed()) return ctx.petWindow.getBounds();
        return { x: 0, y: 0, width: 200, height: 200 };
    });

    ipcMain.handle('get-window-position', async () => {
        if (ctx.petWindow && !ctx.petWindow.isDestroyed()) {
            const pos = ctx.petWindow.getPosition();
            return { x: pos[0], y: pos[1] };
        }
        return { x: 0, y: 0 };
    });

    // ========== Chat Bubble ==========

    ipcMain.handle('show-pet-chat', async (event, message, autoCloseTime = 8000, isUserReply = false) => {
        try {
            if (!ctx.petWindow || ctx.petWindow.isDestroyed()) return { success: false, error: 'no pet window' };

            // 对话模式中：
            if (ctx.chatBubbleInChatMode && ctx.chatBubbleWindow && !ctx.chatBubbleWindow.isDestroyed()) {
                // 无论主动还是回复，都追加到对话窗口
                ctx.chatBubbleWindow.webContents.send('chat-bubble-message', {
                    message,
                    autoCloseTime: 0,
                    proactive: !isUserReply
                });
                return { success: true };
            }
            if (!ctx.petWindow || ctx.petWindow.isDestroyed()) return { success: false, error: 'no pet window' };

            // 复用已有气泡 → 切回小尺寸并显示（这是 AI 主动说话的场景）
            if (ctx.chatBubbleWindow && !ctx.chatBubbleWindow.isDestroyed()) {
                const W = 260, H = 180;
                const pb = ctx.petWindow.getBounds();
                const pos = computeAnchorPos(pb, W, H, ctx.windowAnchor);
                ctx.chatBubbleWindow.setBounds({
                    x: Math.max(0, pos.x), y: Math.max(0, pos.y),
                    width: W, height: H
                });
                ctx.chatBubbleWindow.show();
                ctx.chatBubbleWindow.webContents.send('chat-bubble-message', { message, autoCloseTime, proactive: true });
                return { success: true };
            }
            const petBounds = ctx.petWindow.getBounds();

            const pos = computeAnchorPos(petBounds, 260, 180, ctx.windowAnchor);
            ctx.chatBubbleWindow = new deps.BrowserWindow({
                width: 260, height: 180,
                x: Math.max(0, pos.x),
                y: Math.max(0, pos.y),
                frame: false, transparent: true, alwaysOnTop: true,
                resizable: true, minimizable: false, maximizable: false,
                fullscreenable: false, skipTaskbar: true,
                focusable: true,          // ← 改成 true，输入框才能获得焦点
                show: false,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    preload: deps.path.join(deps.basePath, 'preload.js')
                }
            });
            ctx.chatBubbleWindow.setAlwaysOnTop(true, 'screen-saver');
            ctx.chatBubbleWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
            await ctx.chatBubbleWindow.loadFile(deps.path.join(deps.basePath, 'pet-chat-bubble.html'));
            applyCSP(ctx.chatBubbleWindow);

            // 显示窗口并聚焦，让用户可以立刻打字
            ctx.chatBubbleWindow.showInactive();

            setTimeout(() => {
                if (ctx.chatBubbleWindow && !ctx.chatBubbleWindow.isDestroyed()) {
                    ctx.chatBubbleWindow.webContents.send('chat-bubble-message', { message, autoCloseTime });
                }
            }, 500);

            ctx.chatBubbleWindow.on('closed', () => { ctx.chatBubbleWindow = null; });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('close-chat-bubble', async () => {
        try {
            if (ctx.chatBubbleWindow && !ctx.chatBubbleWindow.isDestroyed()) {
                ctx.chatBubbleWindow.close();
            }
            ctx.chatBubbleInChatMode = false;
            {
                const { BrowserWindow } = require('electron');
                for (const w of BrowserWindow.getAllWindows()) {
                    if (!w.isDestroyed()) w.webContents.send('chat-mode-change', false);
                }
            }
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('send-user-message', async (event, text) => {
        try {
            const { BrowserWindow } = require('electron');
            const wins = BrowserWindow.getAllWindows();
            console.log(`[Main] Broadcasting user-message to ${wins.length} window(s):`, text);
            for (const win of wins) {
                if (!win.isDestroyed()) {
                    win.webContents.send('user-message', text);
                }
            }
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

        // ========== Open Chat Dialog ==========

    async function openChatDialog() {
        if (!ctx.petWindow || ctx.petWindow.isDestroyed()) {
            return { success: false, error: 'no pet window' };
        }
        try {
            if (ctx.chatBubbleWindow && !ctx.chatBubbleWindow.isDestroyed()) {
                ctx.chatBubbleWindow.destroy();
                ctx.chatBubbleWindow = null;
            }

            const W = 380, H = 380;
            const pb = ctx.petWindow.getBounds();
            const pos = computeAnchorPos(pb, W, H, ctx.windowAnchor);
            const x = Math.max(0, pos.x);
            const y = Math.max(0, pos.y);
            console.log('[ChatDialog] open at', x, y, 'anchor=', ctx.windowAnchor);

            ctx.chatBubbleInChatMode = true;
            {
                const { BrowserWindow } = require('electron');
                for (const w of BrowserWindow.getAllWindows()) {
                    if (!w.isDestroyed()) w.webContents.send('chat-mode-change', true);
                }
            }

            const win = new deps.BrowserWindow({
                width: W, height: H, x, y,
                frame: false, transparent: true, alwaysOnTop: true,
                resizable: false, skipTaskbar: true, focusable: true,
                show: false,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    preload: deps.path.join(deps.basePath, 'preload.js')
                }
            });
            ctx.chatBubbleWindow = win;
            win.setAlwaysOnTop(true, 'screen-saver');
            win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

            win.on('closed', () => {
                if (ctx.chatBubbleWindow === win) ctx.chatBubbleWindow = null;
                ctx.chatBubbleInChatMode = false;
            });

            await win.loadFile(
                deps.path.join(deps.basePath, 'pet-chat-bubble.html'),
                { query: { mode: 'chat' } }
            );
            applyCSP(win);

            win.once('ready-to-show', () => {
                win.show();
                win.focus();
            });
            setTimeout(() => {
                if (ctx.chatBubbleWindow === win && !win.isDestroyed() && !win.isVisible()) {
                    win.show();
                    win.focus();
                }
            }, 2000);

            return { success: true };
        } catch (err) {
            console.error('[ChatDialog] error:', err);
            return { success: false, error: err.message };
        }
    }

    ipcMain.handle('get-window-anchor', async () => ({ success: true, anchor: ctx.windowAnchor }));
    ipcMain.handle('set-window-anchor', async (e, a) => { setWindowAnchor(a); return { success: true }; });

    ipcMain.handle('read-file', async (event, filePath) => {
        try {
            const fs = require('fs');
            const content = fs.readFileSync(filePath, 'utf8');
            return { success: true, content: content.slice(0, 4000) };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });
    ipcMain.handle('write-file', async (event, filePath, content) => {
        try {
            const fs = require('fs');
            fs.writeFileSync(filePath, content, 'utf8');
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('list-dir', async (event, dirPath) => {
        try {
            const fs = require('fs');
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            const lines = entries.map(e => (e.isDirectory() ? '[D] ' : '[F] ') + e.name);
            return { success: true, content: lines.join('\n').slice(0, 4000) };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });
    // ========== Agent 工具（扩展） ==========
    ipcMain.handle('list-dir-tree', async (event, dirPath, maxDepth = 2) => {
        try {
            const fs = require('fs');
            const path = require('path');
            const depth = Math.min(Math.max(1, parseInt(maxDepth) || 2), 3);
            const lines = [];
            const MAX_ENTRIES = 200;

            function walk(dir, prefix, level) {
                if (lines.length >= MAX_ENTRIES) return;
                if (level > depth) return;
                let entries;
                try {
                    entries = fs.readdirSync(dir, { withFileTypes: true });
                } catch { return; }
                entries.sort((a, b) => {
                    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
                    return a.name.localeCompare(b.name);
                });
                for (const e of entries) {
                    if (lines.length >= MAX_ENTRIES) { lines.push(prefix + '... (truncated)'); return; }
                    if (e.name.startsWith('.') && e.name !== '.gitignore' && e.name !== '.env') continue;
                    lines.push(prefix + (e.isDirectory() ? '[D] ' : '[F] ') + e.name);
                    if (e.isDirectory() && level < depth) {
                        walk(path.join(dir, e.name), prefix + '  ', level + 1);
                    }
                }
            }
            walk(dirPath, '', 1);
            return { success: true, content: lines.join('\n') };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('search-files', async (event, rootPath, pattern, maxResults = 50) => {
        try {
            const fs = require('fs');
            const path = require('path');
            const limit = Math.min(Math.max(1, parseInt(maxResults) || 50), 200);
            const MAX_SCAN = 10000;
            const matches = [];
            let scanned = 0;

            // 把通配符转成正则
            const regexStr = '^' + pattern
                .replace(/[.+^${}()|[\]\\]/g, '\\$&')
                .replace(/\*/g, '.*')
                .replace(/\?/g, '.') + '$';
            const re = new RegExp(regexStr, 'i');

            function walk(dir, level) {
                if (matches.length >= limit || scanned >= MAX_SCAN || level > 6) return;
                let entries;
                try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
                for (const e of entries) {
                    if (matches.length >= limit || scanned >= MAX_SCAN) return;
                    scanned++;
                    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist' || e.name === 'build') continue;
                    const full = path.join(dir, e.name);
                    if (e.isDirectory()) {
                        walk(full, level + 1);
                    } else if (re.test(e.name)) {
                        matches.push(full);
                    }
                }
            }
            walk(rootPath, 0);
            return { success: true, content: matches.join('\n') || '(无匹配)', count: matches.length };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('grep-text', async (event, rootPath, pattern, filePattern = '', maxResults = 30) => {
        try {
            const fs = require('fs');
            const path = require('path');
            const limit = Math.min(Math.max(1, parseInt(maxResults) || 30), 100);
            const MAX_FILES = 500;
            const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

            let re;
            try { re = new RegExp(pattern, 'i'); } catch (e) {
                return { success: false, error: '正则表达式无效：' + e.message };
            }

            let fileRe = null;
            if (filePattern) {
                const fStr = '^' + filePattern
                    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
                    .replace(/\*/g, '.*')
                    .replace(/\?/g, '.') + '$';
                fileRe = new RegExp(fStr, 'i');
            }

            const results = [];
            let filesScanned = 0;

            function walk(dir, level) {
                if (results.length >= limit || filesScanned >= MAX_FILES || level > 6) return;
                let entries;
                try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
                for (const e of entries) {
                    if (results.length >= limit || filesScanned >= MAX_FILES) return;
                    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist' || e.name === 'build') continue;
                    const full = path.join(dir, e.name);
                    if (e.isDirectory()) {
                        walk(full, level + 1);
                    } else {
                        if (fileRe && !fileRe.test(e.name)) continue;
                        filesScanned++;
                        try {
                            const stat = fs.statSync(full);
                            if (stat.size > MAX_FILE_SIZE) continue;
                            const content = fs.readFileSync(full, 'utf8');
                            if (content.includes('\u0000')) continue; // 二进制
                            const lines = content.split('\n');
                            for (let i = 0; i < lines.length && results.length < limit; i++) {
                                if (re.test(lines[i])) {
                                    const truncated = lines[i].length > 200 ? lines[i].slice(0, 200) + '...' : lines[i];
                                    results.push(`${full}:${i + 1}: ${truncated.trim()}`);
                                }
                            }
                        } catch {}
                    }
                }
            }
            walk(rootPath, 0);
            return { success: true, content: results.join('\n') || '(无匹配)', count: results.length };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('open-url', async (event, url) => {
        try {
            const { shell } = require('electron');
            if (!/^https?:\/\//i.test(url)) {
                return { success: false, error: '只允许 http/https URL' };
            }
            await shell.openExternal(url);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ========== 工具策略 ==========

    ipcMain.handle('get-tool-policies', async () => {
        try {
            const config = await deps.configManager.loadConfigFile();
            return { success: true, policies: config.agent?.toolPolicies || {} };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('set-tool-policies', async (event, policies) => {
        try {
            await deps.configManager.saveConfigFile({ agent: { toolPolicies: policies } });
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });
    // ========== Agent History ==========

    ipcMain.on('sync-agent-history', (event, data) => {
        if (data && typeof data === 'object') {
            ctx.agentHistorySnapshot = {
                summary: data.summary || '',
                recent: Array.isArray(data.recent) ? data.recent : []
            };
            // 通知历史窗口刷新
            const { BrowserWindow } = require('electron');
            for (const w of BrowserWindow.getAllWindows()) {
                if (!w.isDestroyed()) w.webContents.send('agent-history-updated');
            }
        }
    });

    ipcMain.handle('get-agent-history-snapshot', async () => {
        return { success: true, data: ctx.agentHistorySnapshot };
    });

    // ========== Observation ==========

    ipcMain.on('sync-observation', (event, data) => {
        if (data && typeof data === 'object') {
            ctx.observationSnapshot = {
                observations: Array.isArray(data.observations) ? data.observations : [],
                contacts: data.contacts && typeof data.contacts === 'object' ? data.contacts : {}
            };
            const { BrowserWindow } = require('electron');
            for (const w of BrowserWindow.getAllWindows()) {
                if (!w.isDestroyed()) w.webContents.send('observation-updated');
            }
        }
    });

    ipcMain.handle('get-observation-snapshot', async () => {
        return { success: true, data: ctx.observationSnapshot };
    });

    ctx.userProfileWindow = ctx.userProfileWindow || null;

    async function openUserProfileWindow() {
        try {
            if (ctx.userProfileWindow && !ctx.userProfileWindow.isDestroyed()) {
                ctx.userProfileWindow.focus();
                return { success: true };
            }

            const { screen } = require('electron');
            const primary = screen.getPrimaryDisplay();
            const { width, height } = primary.workAreaSize;
            const W = 460, H = 560;
            const x = Math.round((width - W) / 2);
            const y = Math.round((height - H) / 2);

            ctx.userProfileWindow = new deps.BrowserWindow({
                width: W, height: H, x, y,
                frame: true,
                resizable: true,
                minimizable: true,
                maximizable: false,
                title: '用户画像',
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    preload: deps.path.join(deps.basePath, 'preload.js')
                }
            });
            await ctx.userProfileWindow.loadFile(deps.path.join(deps.basePath, 'user-profile.html'));
            applyCSP(ctx.userProfileWindow);

            ctx.userProfileWindow.on('closed', () => {
                ctx.userProfileWindow = null;
            });

            return { success: true };
        } catch (err) {
            console.error('[UserProfileWindow] open failed:', err);
            return { success: false, error: err.message };
        }
    }

    async function openObservationWindow() {
        try {
            if (ctx.observationWindow && !ctx.observationWindow.isDestroyed()) {
                ctx.observationWindow.focus();
                return { success: true };
            }

            const { screen } = require('electron');
            const primary = screen.getPrimaryDisplay();
            const { width, height } = primary.workAreaSize;
            const W = 480, H = 600;
            const x = Math.round((width - W) / 2);
            const y = Math.round((height - H) / 2);

            ctx.observationWindow = new deps.BrowserWindow({
                width: W, height: H, x, y,
                frame: true,
                resizable: true,
                minimizable: true,
                maximizable: false,
                title: '观察数据',
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    preload: deps.path.join(deps.basePath, 'preload.js')
                }
            });
            await ctx.observationWindow.loadFile(deps.path.join(deps.basePath, 'observation-viewer.html'));
            applyCSP(ctx.observationWindow);

            ctx.observationWindow.on('closed', () => {
                ctx.observationWindow = null;
            });

            return { success: true };
        } catch (err) {
            console.error('[ObservationWindow] open failed:', err);
            return { success: false, error: err.message };
        }
    }

    async function openFlashcardReviewWindow() {
        try {
            if (ctx.flashcardReviewWindow && !ctx.flashcardReviewWindow.isDestroyed()) {
                ctx.flashcardReviewWindow.focus();
                return { success: true };
            }

            const { screen } = require('electron');
            const primary = screen.getPrimaryDisplay();
            const { width, height } = primary.workAreaSize;
            const W = 520, H = 620;
            const x = Math.round((width - W) / 2);
            const y = Math.round((height - H) / 2);

            ctx.flashcardReviewWindow = new deps.BrowserWindow({
                width: W, height: H, x, y,
                frame: true,
                resizable: true,
                minimizable: true,
                maximizable: false,
                title: '复习卡片',
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    preload: deps.path.join(deps.basePath, 'preload.js')
                }
            });
            await ctx.flashcardReviewWindow.loadFile(deps.path.join(deps.basePath, 'flashcard-review.html'));
            applyCSP(ctx.flashcardReviewWindow);

            ctx.flashcardReviewWindow.on('closed', () => {
                ctx.flashcardReviewWindow = null;
            });

            return { success: true };
        } catch (err) {
            console.error('[FlashcardReview] open failed:', err);
            return { success: false, error: err.message };
        }
    }

    ctx.timerWindow = ctx.timerWindow || null;
    ctx.timerBubbleWindow = ctx.timerBubbleWindow || null;

    function openTimerBubble() {
        if (ctx.timerBubbleWindow && !ctx.timerBubbleWindow.isDestroyed()) {
            ctx.timerBubbleWindow.show();
            ctx.timerBubbleWindow.focus();
            return { success: true };
        }
        try {
            const { screen } = require('electron');
            const primary = screen.getPrimaryDisplay();
            const { width, height } = primary.workAreaSize;
            // 默认位置：右上角
            let x = width - 220;
            let y = 60;

            ctx.timerBubbleWindow = new deps.BrowserWindow({
                width: 200, height: 64,
                x, y,
                frame: false,
                transparent: true,
                alwaysOnTop: true,
                resizable: false,
                minimizable: false,
                maximizable: false,
                fullscreenable: false,
                skipTaskbar: true,
                focusable: true,
                hasShadow: false,
                webPreferences: {
                    preload: deps.path.join(deps.basePath, 'preload.js'),
                    nodeIntegration: false,
                    contextIsolation: true
                }
            });
            // 关闭贴边动画，避免拖动时视觉"变形"
            try {
                ctx.timerBubbleWindow.setWindowButtonVisibility?.(false);
            } catch {}
            ctx.timerBubbleWindow.setAlwaysOnTop(true, 'screen-saver');
            ctx.timerBubbleWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
            ctx.timerBubbleWindow.loadFile(deps.path.join(deps.basePath, 'timer-bubble.html'));
            applyCSP(ctx.timerBubbleWindow);

            ctx.timerBubbleWindow.on('closed', () => {
                ctx.timerBubbleWindow = null;
            });

            // 异步读取保存的位置
            (async () => {
                try {
                    const cfg = await deps.configManager.loadConfigFile();
                    const pos = cfg.timerBubble;
                    if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
                        // 边界检查：位置是否在当前屏幕可见范围内
                        const screen = require('electron').screen;
                        const displays = screen.getAllDisplays();
                        let visible = false;
                        for (const d of displays) {
                            const b = d.workArea;
                            if (pos.x >= b.x - 50 && pos.x <= b.x + b.width - 50 &&
                                pos.y >= b.y - 50 && pos.y <= b.y + b.height - 30) {
                                visible = true;
                                break;
                            }
                        }
                        if (visible && ctx.timerBubbleWindow && !ctx.timerBubbleWindow.isDestroyed()) {
                            ctx.timerBubbleWindow.setPosition(pos.x, pos.y);
                        }
                    }
                } catch (e) {}
            })();

            return { success: true };
        } catch (err) {
            console.error('[TimerBubble] open failed:', err);
            return { success: false, error: err.message };
        }
    }

    function closeTimerBubble() {
        if (ctx.timerBubbleWindow && !ctx.timerBubbleWindow.isDestroyed()) {
            ctx.timerBubbleWindow.close();
        }
        return { success: true };
    }

    function resizeTimerBubble(newHeight) {
        if (!ctx.timerBubbleWindow || ctx.timerBubbleWindow.isDestroyed()) return { success: false };
        try {
            const bounds = ctx.timerBubbleWindow.getBounds();
            const h = Math.max(40, Math.min(200, newHeight));
            if (bounds.height !== h) {
                ctx.timerBubbleWindow.setBounds({ ...bounds, height: h });
            }
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    function timerBubbleGetPos() {
        if (!ctx.timerBubbleWindow || ctx.timerBubbleWindow.isDestroyed()) return { x: 0, y: 0 };
        const [x, y] = ctx.timerBubbleWindow.getPosition();
        return { x, y };
    }

    function timerBubbleSetPos(x, y) {
        if (!ctx.timerBubbleWindow || ctx.timerBubbleWindow.isDestroyed()) return;
        // ★ 用 setBounds 显式带上当前宽高，防止 setPosition 偶发引起尺寸变化
        const b = ctx.timerBubbleWindow.getBounds();
        ctx.timerBubbleWindow.setBounds({
            x: Math.round(x),
            y: Math.round(y),
            width: b.width,
            height: b.height
        });
    }

    async function timerBubbleSavePos() {
        if (!ctx.timerBubbleWindow || ctx.timerBubbleWindow.isDestroyed()) return;
        const [x, y] = ctx.timerBubbleWindow.getPosition();
        try {
            await deps.configManager.saveConfigFile({ timerBubble: { x, y } });
        } catch (e) {
            console.warn('[TimerBubble] save pos failed:', e.message);
        }
    }
    
    function openTimerWindow() {
        if (ctx.timerWindow && !ctx.timerWindow.isDestroyed()) {
            ctx.timerWindow.show();
            ctx.timerWindow.focus();
            return { success: true };
        }
        try {
            ctx.timerWindow = new deps.BrowserWindow({
                width: 480,
                height: 620,
                title: '倒计时 / 计时',
                resizable: true,
                minimizable: true,
                maximizable: false,
                icon: deps.path.join(deps.basePath, 'assets', 'app-icon.ico'),
                webPreferences: {
                    preload: deps.path.join(deps.basePath, 'preload.js'),
                    nodeIntegration: false,
                    contextIsolation: true
                }
            });
            ctx.timerWindow.setMenuBarVisibility(false);
            ctx.timerWindow.loadFile(deps.path.join(deps.basePath, 'timer.html'));
            applyCSP(ctx.timerWindow);
            ctx.timerWindow.on('closed', () => { ctx.timerWindow = null; });
            return { success: true };
        } catch (err) {
            console.error('[TimerWindow] open failed:', err);
            return { success: false, error: err.message };
        }
    }

    async function openCalendarWindow() {
        try {
            if (ctx.calendarWindow && !ctx.calendarWindow.isDestroyed()) {
                ctx.calendarWindow.focus();
                return { success: true };
            }

            const { screen } = require('electron');
            const primary = screen.getPrimaryDisplay();
            const { width, height } = primary.workAreaSize;
            const W = 460, H = 680;
            const x = Math.round((width - W) / 2);
            const y = Math.round((height - H) / 2);

            ctx.calendarWindow = new deps.BrowserWindow({
                width: W, height: H, x, y,
                frame: true,
                resizable: true,
                minimizable: true,
                maximizable: false,
                title: '日历',
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    preload: deps.path.join(deps.basePath, 'preload.js')
                }
            });
            await ctx.calendarWindow.loadFile(deps.path.join(deps.basePath, 'calendar.html'));
            applyCSP(ctx.calendarWindow);

            ctx.calendarWindow.on('closed', () => {
                ctx.calendarWindow = null;
            });

            return { success: true };
        } catch (err) {
            console.error('[Calendar] open failed:', err);
            return { success: false, error: err.message };
        }
    }

    ipcMain.handle('open-calendar', async () => openCalendarWindow());

    ipcMain.handle('open-flashcard-review', async () => openFlashcardReviewWindow());

    ipcMain.handle('open-observation-window', async () => openObservationWindow());

    async function openAgentHistoryWindow() {
        try {
            if (ctx.agentHistoryWindow && !ctx.agentHistoryWindow.isDestroyed()) {
                ctx.agentHistoryWindow.focus();
                return { success: true };
            }

            const { screen } = require('electron');
            const primary = screen.getPrimaryDisplay();
            const { width, height } = primary.workAreaSize;
            const W = 480, H = 560;
            const x = Math.round((width - W) / 2);
            const y = Math.round((height - H) / 2);

            ctx.agentHistoryWindow = new deps.BrowserWindow({
                width: W, height: H, x, y,
                frame: true,
                resizable: true,
                minimizable: true,
                maximizable: false,
                title: 'Agent 历史',
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    preload: deps.path.join(deps.basePath, 'preload.js')
                }
            });
            await ctx.agentHistoryWindow.loadFile(deps.path.join(deps.basePath, 'agent-history.html'));
            applyCSP(ctx.agentHistoryWindow);

            ctx.agentHistoryWindow.on('closed', () => {
                ctx.agentHistoryWindow = null;
            });

            return { success: true };
        } catch (err) {
            console.error('[AgentHistory] open failed:', err);
            return { success: false, error: err.message };
        }
    }

    ipcMain.handle('open-agent-history', async () => openAgentHistoryWindow());
    ipcMain.handle('set-agent-mode', async (event, mode) => {
        // 兼容旧格式（boolean）
        if (typeof mode === 'boolean') mode = mode ? 'agent' : 'chat';
        if (!['chat', 'agent', 'plan'].includes(mode)) mode = 'chat';
        ctx.agentMode = mode;
        console.log('[Agent] Mode:', ctx.agentMode);
        const { BrowserWindow } = require('electron');
        for (const w of BrowserWindow.getAllWindows()) {
            if (!w.isDestroyed()) w.webContents.send('agent-mode-change', ctx.agentMode);
        }
        return { success: true };
    });
    ipcMain.handle('send-chat-status', async (event, icon, text) => {
        const { BrowserWindow } = require('electron');
        for (const w of BrowserWindow.getAllWindows()) {
            if (!w.isDestroyed()) w.webContents.send('chat-status-message', { icon, text });
        }
        return { success: true };
    });
    ipcMain.handle('request-confirmation', async (event, reqId, tool, args) => {
        const { BrowserWindow } = require('electron');
        console.log('[Agent] Confirmation requested:', reqId, tool);
        for (const w of BrowserWindow.getAllWindows()) {
            if (!w.isDestroyed()) w.webContents.send('confirmation-request', { reqId, tool, args });
        }
        return { success: true };
    });

    ipcMain.handle('respond-confirmation', async (event, reqId, allow) => {
        const { BrowserWindow } = require('electron');
        console.log('[Agent] Confirmation result:', reqId, allow);
        for (const w of BrowserWindow.getAllWindows()) {
            if (!w.isDestroyed()) w.webContents.send('confirmation-result', { reqId, allow });
        }
        return { success: true };
    });
    ipcMain.handle('request-plan-approval', async (event, reqId, planText) => {
        const { BrowserWindow } = require('electron');
        console.log('[Agent] Plan approval requested:', reqId);
        for (const w of BrowserWindow.getAllWindows()) {
            if (!w.isDestroyed()) w.webContents.send('plan-approval-request', { reqId, planText });
        }
        return { success: true };
    });

    ipcMain.handle('respond-plan-approval', async (event, reqId, approved) => {
        const { BrowserWindow } = require('electron');
        console.log('[Agent] Plan approval result:', reqId, approved);
        for (const w of BrowserWindow.getAllWindows()) {
            if (!w.isDestroyed()) w.webContents.send('plan-approval-result', { reqId, approved });
        }
        return { success: true };
    });
    ipcMain.handle('get-agent-mode', async () => ({ success: true, mode: ctx.agentMode }));
    ipcMain.handle('open-chat-dialog', async () => openChatDialog());
    ipcMain.handle('resize-chat-bubble', async (event, width, height) => {
        try {
            if (ctx.chatBubbleWindow && !ctx.chatBubbleWindow.isDestroyed() && ctx.petWindow && !ctx.petWindow.isDestroyed()) {
                const w = Math.max(220, width);
                const h = Math.max(140, height);  // 最小高度，保证输入框可见
                const petBounds = ctx.petWindow.getBounds();
                ctx.chatBubbleWindow.setBounds({
                    x: Math.round(petBounds.x + (petBounds.width - w) / 2),
                    y: Math.round(petBounds.y - h + petBounds.height * 0.25),
                    width: w, height: h
                });
                if (!ctx.chatBubbleWindow.isVisible()) {
                    ctx.chatBubbleWindow.showInactive();
                }
            }
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    function setProactiveState(enabled) {
        ctx.proactiveEnabled = !!enabled;
        console.log('[Proactive] Set to:', ctx.proactiveEnabled);

        // 保存到 config
        if (deps.configManager) {
            deps.configManager.saveConfigFile({ proactiveEnabled: ctx.proactiveEnabled })
                .catch(e => console.warn('[Proactive] Save failed:', e.message));
        }

        // 广播给所有窗口
        const { BrowserWindow } = require('electron');
        for (const w of BrowserWindow.getAllWindows()) {
            if (!w.isDestroyed()) w.webContents.send('proactive-state-change', ctx.proactiveEnabled);
        }
        return { success: true, enabled: ctx.proactiveEnabled };
    }

    ipcMain.handle('get-proactive-state', async () => {
        return { enabled: ctx.proactiveEnabled !== false };
    });

    ipcMain.handle('set-proactive-state', async (event, enabled) => setProactiveState(enabled));

    // 注册计时相关 IPC
    ipcMain.handle('open-timer', async () => openTimerWindow());
    ipcMain.handle('open-timer-bubble', async () => openTimerBubble());
    ipcMain.handle('close-timer-bubble', async () => closeTimerBubble());
    ipcMain.handle('resize-timer-bubble', async (e, h) => resizeTimerBubble(h));
    ipcMain.handle('timer-bubble-get-pos', async () => timerBubbleGetPos());
    ipcMain.handle('timer-bubble-set-pos', async (e, x, y) => { timerBubbleSetPos(x, y); return { success: true }; });
    ipcMain.handle('timer-bubble-save-pos', async () => { await timerBubbleSavePos(); return { success: true }; });
    ipcMain.handle('open-user-profile', async () => openUserProfileWindow());


    return {
        createSettingsWindow,
        openChatDialog,
        setWindowAnchor,
        openAgentHistoryWindow,
        openObservationWindow,
        setProactiveState,
        openFlashcardReviewWindow,
        openCalendarWindow,
        openTimerWindow,
        openTimerBubble,
        closeTimerBubble,
        openUserProfileWindow
    };
}

module.exports = { registerWindowHandlers };
