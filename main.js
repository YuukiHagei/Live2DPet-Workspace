/**
 * main.js — Electron main process orchestrator.
 * All logic has been extracted into src/main/ modules.
 * This file wires them together and manages the app lifecycle.
 */
const { app, BrowserWindow, ipcMain, desktopCapturer, Menu, Tray, dialog, shell, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

const { createStartupSync } = require('./src/main/startup-sync');
const { GistSync } = require('./src/main/gist-sync');
const { CloudSync } = require('./src/main/cloud-sync');
const { ReportGenerator } = require('./src/main/report-generator');
const { DailyBrief } = require('./src/main/daily-brief');
const { CompanionTracker } = require('./src/main/companion-tracker');
const { DataStore } = require('./src/main/data-store');
const { registerAgentToolsIPC } = require('./src/main/agent-tools-ipc');
const { createReminderScheduler } = require('./src/main/reminder-scheduler');
const { AppContext } = require('./src/main/app-context');
const { createConfigManager } = require('./src/main/config-manager');
const { createI18nHelper } = require('./src/main/i18n-helper');
const { createTrayManager } = require('./src/main/tray-manager');
const { registerWindowHandlers } = require('./src/main/window-manager');
const { registerScreenCapture } = require('./src/main/screen-capture');
const { registerUtilityIPC } = require('./src/main/utility-ipc');
const { registerCharacterHandlers } = require('./src/main/character-manager');
const { registerEmotionIPC } = require('./src/main/emotion-ipc');
const { registerTTSIPC } = require('./src/main/tts-ipc');
const { registerEnhanceIPC } = require('./src/main/enhance-ipc');
const { registerDefaultAudioIPC } = require('./src/main/default-audio-ipc');
const { registerModelImport } = require('./src/main/model-import');
const { createPathUtils } = require('./src/utils/path-utils');
const { TTSService } = require('./src/core/tts-service');
const { TranslationService } = require('./src/core/translation-service');
const { McpManager } = require('./src/main/mcp-client');

// ========== Shared State ==========

const ctx = new AppContext();
const configManager = createConfigManager(app);
let dataStore = null;   // 在 whenReady 里初始化
const { mt } = createI18nHelper(ctx);
const basePath = __dirname;
// 根据配置返回当前活跃的云同步实例
async function getActiveCloudSync() {
    const cfg = await configManager.loadConfigFile();
    const provider = cfg.cloud?.provider || 'github-gist';
    if (provider === 'github-gist') return ctx.gistSync;
    return ctx.cloudSync;
}
// 内置工具名列表（避免和 MCP 工具重名）
const BUILTIN_TOOL_NAMES = [
    'read_file', 'write_file', 'list_dir', 'list_dir_tree',
    'search_files', 'grep_text', 'open_url'
];
// 打包后 mcp-server.js 在 resources/app.asar.unpacked 下，dev 模式在项目根目录
const mcpServerPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked')
    : basePath;
const mcpManager = new McpManager(basePath, mcpServerPath);

// ========== Register Modules ==========

const { createSettingsWindow, openChatDialog, setWindowAnchor, openAgentHistoryWindow, openObservationWindow, setProactiveState, openFlashcardReviewWindow, openCalendarWindow } = registerWindowHandlers(ctx, ipcMain, {
    BrowserWindow, path, basePath, configManager,
    updateTrayMenu: () => trayManager.updateTrayMenu()
});

const trayManager = createTrayManager(ctx, {
    Tray, Menu, path, mt, basePath, app, createSettingsWindow
});

registerScreenCapture(ctx, ipcMain, { desktopCapturer, powerMonitor });

registerUtilityIPC(ctx, ipcMain, {
    configManager, mt, Menu, shell, app, createSettingsWindow, openChatDialog,
    setWindowAnchor, openAgentHistoryWindow, openObservationWindow, setProactiveState,
    openFlashcardReviewWindow, openCalendarWindow
});

registerCharacterHandlers(ctx, ipcMain, {
    fs, path, crypto, app, dialog, configManager
});

registerEmotionIPC(ctx, ipcMain);

registerTTSIPC(ctx, ipcMain, {
    configManager, fs, path, app, mt
});

registerEnhanceIPC(ctx, ipcMain, { app, fs, https, http });

registerDefaultAudioIPC(ctx, ipcMain, {
    app, fs, path, configManager
});

registerModelImport(ctx, ipcMain, {
    app, fs, path, dialog, mt, configManager, BrowserWindow
});

ipcMain.handle('mcp-list-tools', async () => {
    try {
        return { success: true, tools: mcpManager.listAllTools() };
    } catch (err) {
        console.error('[MCP] listTools failed:', err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('mcp-call-tool', async (event, name, args) => {
    try {
        const r = await mcpManager.callTool(name, args);
        return { success: true, result: r.result };
    } catch (err) {
        console.error('[MCP] callTool failed:', err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('mcp-get-status', async () => {
    try {
        return { success: true, ...mcpManager.getStatus() };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('mcp-reload', async () => {
    try {
        const cfg = await configManager.loadConfigFile();
        await mcpManager.reload(cfg.mcp?.servers || [], BUILTIN_TOOL_NAMES);
        return { success: true, ...mcpManager.getStatus() };
    } catch (err) {
        console.error('[MCP] Reload failed:', err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('cloud-test-connection', async () => {
    try {
        const active = await getActiveCloudSync();
        return { success: true, ...(await active.testConnection()) };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('cloud-push', async () => {
    try {
        const active = await getActiveCloudSync();
        return { success: true, result: await active.push() };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('cloud-pull', async () => {
    try {
        const active = await getActiveCloudSync();
        return { success: true, result: await active.pull() };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('cloud-status', async () => {
    const active = await getActiveCloudSync();
    return { success: true, status: active.getStatus() };
});

ipcMain.handle('cloud-reset-client', async () => {
    const active = await getActiveCloudSync();
    if (active.reset) active.reset();
    return { success: true };
});

ipcMain.handle('cloud-analyze-conflicts', async () => {
    try {
        const active = await getActiveCloudSync();
        return { success: true, ...(await active.analyzeConflicts()) };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('cloud-sync-with-resolutions', async (event, resolutions) => {
    try {
        const active = await getActiveCloudSync();
        return { success: true, result: await active.syncWithResolutions(resolutions || {}) };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('cloud-get-unresolved-conflicts', async () => {
    const active = await getActiveCloudSync();
    return { success: true, conflicts: active.getUnresolvedConflicts() };
});

ipcMain.handle('cloud-reset-sync-state', async () => {
    try {
        const active = await getActiveCloudSync();
        await active.resetSyncState();
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('cloud-set-auto-push', async (event, enabled) => {
    try {
        const active = await getActiveCloudSync();
        if (active) active.setAutoPush(!!enabled);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('mcp-test-server', async (event, config) => {
    try {
        return await mcpManager.testServer(config);
    } catch (err) {
        return { success: false, error: err.message };
    }
});
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        // 第二个实例启动时，聚焦到第一个实例
        if (ctx.settingsWindow) {
            ctx.settingsWindow.show();
            ctx.settingsWindow.focus();
        }
    });
}
// ========== App Lifecycle ==========

app.whenReady().then(async () => {
    ipcMain.handle('get-companion-stats', async () => {
        try {
            return { success: true, stats: ctx.companionTracker.getStats() };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });
    ctx.pathUtils = createPathUtils(app, path);
    // 初始化数据层
    const dataDir = path.join(app.getPath('userData'), 'data');
    dataStore = new DataStore(dataDir);
    ctx.cloudSync = new CloudSync({
        configManager,
        dataDir,
        dataStore
    });
    // Gist 同步（需要 promptsDir 以便同步角色卡）
    const promptsDir = path.join(app.getPath('userData'), 'prompts');
    ctx.gistSync = new GistSync({
        configManager,
        dataDir,
        promptsDir
    });

    // 数据变更 → 触发云同步 debounce
    dataStore.onChange(async () => {
        try {
            const active = await getActiveCloudSync();
            if (active) active.scheduleAutoPush();
        } catch {}
    });

    try {
        const cfg = await configManager.loadConfigFile();
        const autoOn = cfg.cloud?.enabled && cfg.cloud?.autoPush !== false;
        const active = await getActiveCloudSync();
        active.setAutoPush(autoOn);
    } catch (e) {
        console.warn('[Cloud] init auto push failed:', e.message);
    }
    ctx.companionTracker = new CompanionTracker(dataDir);
    // 注册待办/日程 IPC（必须在 dataStore 初始化之后）
    registerAgentToolsIPC(ctx, ipcMain, { dataStore });
    // 每日简报
    ctx.dailyBrief = new DailyBrief({
        configManager,
        dataStore,
        dataDir,
        broadcast: (channel, payload) => {
            const { BrowserWindow } = require('electron');
            for (const w of BrowserWindow.getAllWindows()) {
                if (!w.isDestroyed()) w.webContents.send(channel, payload);
            }
        }
    });
    ctx.dailyBrief.start();

    ipcMain.handle('brief-get-morning-context', async () => {
        try {
            const ctxData = await ctx.dailyBrief.getMorningContextWithWeather();
            return { success: true, context: ctxData };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });
    ipcMain.handle('brief-trigger', async (event, type) => {
        try {
            await ctx.dailyBrief.triggerManually(type);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });
    ipcMain.handle('brief-get-state', async () => {
        return { success: true, state: ctx.dailyBrief.state };
    });
    ipcMain.handle('brief-reset-state', async () => {
        ctx.dailyBrief.state = { morningSentDate: null, eveningSentDate: null };
        ctx.dailyBrief._save();
        return { success: true };
    });
    
    // 周报/月报
    ctx.reportGenerator = new ReportGenerator({
        configManager,
        dataStore,
        dataDir,
        broadcast: (channel, payload) => {
            const { BrowserWindow } = require('electron');
            for (const w of BrowserWindow.getAllWindows()) {
                if (!w.isDestroyed()) w.webContents.send(channel, payload);
            }
        }
    });
    ctx.reportGenerator.start();

    ipcMain.handle('report-trigger', async (event, type) => {
        try {
            return await ctx.reportGenerator.triggerManually(type);
        } catch (err) {
            return { success: false, error: err.message };
        }
    });
    ipcMain.handle('report-reset-state', async () => {
        ctx.reportGenerator.state = { lastWeeklyKey: null, lastMonthlyKey: null };
        ctx.reportGenerator._save();
        return { success: true };
    });
    // 启动提醒调度器
    ctx.reminderScheduler = createReminderScheduler(dataStore, { BrowserWindow });
    ctx.reminderScheduler.start();
    try {
        const cfg = await configManager.loadConfigFile();
        ctx._cachedLang = cfg.uiLanguage || 'en';
        ctx.proactiveEnabled = cfg.proactiveEnabled !== false;
    } catch {}

    ctx.ttsService = new TTSService();
    ctx.translationService = new TranslationService();

    // ★ 先初始化 TTS，再创建窗口（避免渲染进程提前查询 TTS 状态）
    try {
        const voicevoxDir = ctx.pathUtils.getVoicevoxPath();
        if (voicevoxDir && fs.existsSync(voicevoxDir)) {
            const config = await configManager.loadConfigFile();
            const vvmFiles = config.tts?.vvmFiles || ['0.vvm', '8.vvm'];
            const gpuMode = config.tts?.gpuMode || false;
            const ok = ctx.ttsService.init(voicevoxDir, vvmFiles, { gpuMode });
            if (ok) {
                if (config.tts) ctx.ttsService.setConfig(config.tts);
                if (config.apiKey) {
                    const tl = config.translation || {};
                    ctx.translationService.configure({
                        apiKey: tl.apiKey || config.apiKey,
                        baseURL: tl.baseURL || config.baseURL || 'https://openrouter.ai/api/v1',
                        modelName: tl.modelName || config.modelName || 'x-ai/grok-4.1-fast'
                    });
                }
            }
        } else {
            console.log('[TTS] voicevox_core not found, TTS disabled');
        }
    } catch (err) {
        console.error('[TTS] Init failed:', err.message);
    }

    // 启动后延迟 8 秒静默同步一次
    setTimeout(async () => {
        try {
            const startupSync = createStartupSync({
                getActiveCloudSync,
                configManager
            });
            const result = await startupSync.run();
            console.log('[StartupSync] result:', JSON.stringify(result));
        } catch (err) {
            console.warn('[StartupSync] failed:', err.message);
        }
    }, 8000);

    // ★ 再创建窗口（此时 TTS 已就绪）
    createSettingsWindow();
    trayManager.createTray();
});

app.on('window-all-closed', () => {
    if (ctx.tray) return;
    if (process.platform !== 'darwin') app.quit();
});

let _quitting = false;
app.on('before-quit', async (e) => {
    if (_quitting) return;

    // 如果有待处理的云同步，先 flush 再退出
    let active = null;
    try { active = await getActiveCloudSync(); } catch {}

    if (active?.hasPendingPush()) {
        e.preventDefault();
        _quitting = true;
        console.log('[App] Flushing pending cloud push before quit...');
        try {
            await active.flushPendingPush();
        } catch (err) {
            console.warn('[App] Flush failed:', err.message);
        }
        app.quit();
        return;
    }

    ctx.isQuitting = true;
    if (ctx.reminderScheduler) ctx.reminderScheduler.stop();
    if (ctx.dailyBrief) ctx.dailyBrief.stop();
    if (ctx.reportGenerator) ctx.reportGenerator.stop();
});

