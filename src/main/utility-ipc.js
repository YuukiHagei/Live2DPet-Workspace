/**
 * UtilityIPC — General utility IPC handlers.
 * Extracted from main.js lines 532-592.
 */
const { isValidURL } = require('./validators');

function registerUtilityIPC(ctx, ipcMain, deps) {
    const { configManager, mt, Menu, shell, app } = deps;

    ipcMain.handle('load-config', async () => {
        return await configManager.loadConfigFile();
    });

    ipcMain.handle('save-config', async (event, data) => {
        if (data.uiLanguage) ctx._cachedLang = data.uiLanguage;
        const result = await configManager.saveConfigFile(data);
        // Reconfigure translation service when translation settings change
        if (data.translation && ctx.translationService) {
            const config = await configManager.loadConfigFile();
            const tl = config.translation || {};
            ctx.translationService.configure({
                apiKey: tl.apiKey || config.apiKey,
                baseURL: tl.baseURL || config.baseURL || 'https://openrouter.ai/api/v1',
                modelName: tl.modelName || config.modelName || 'x-ai/grok-4.1-fast'
            });
        }
        // Notify pet window to hot-reload model config
        if (data.model && ctx.petWindow && !ctx.petWindow.isDestroyed()) {
            const config = await configManager.loadConfigFile();
            ctx.petWindow.webContents.send('model-config-update', config.model);
        }
        return result;
    });

    ipcMain.handle('get-cursor-position', async () => {
        const { screen } = require('electron');
        return screen.getCursorScreenPoint();
    });

    ipcMain.handle('show-pet-context-menu', async () => {
        if (!ctx.petWindow || ctx.petWindow.isDestroyed()) return;
        const sizes = [200, 300, 400, 500];
        const template = [
            { label: mt('main.size'), submenu: sizes.map(s => ({
                label: `${s}x${s}`,
                click: () => {
                    ctx.petWindow.setResizable(true);
                    ctx.petWindow.setSize(s, s);
                    ctx.petWindow.setResizable(false);
                    ctx.petWindow.webContents.send('size-changed', s);
                }
            }))},
            { type: 'separator' },
            { label: '窗口位置', submenu: [
                { label: '宠物上方', click: () => deps.setWindowAnchor('above') },
                { label: '宠物下方', click: () => deps.setWindowAnchor('below') },
                { label: '宠物左侧', click: () => deps.setWindowAnchor('left') },
                { label: '宠物右侧', click: () => deps.setWindowAnchor('right') }
            ]},
            { label: '开始对话', click: () => { deps.openChatDialog(); } },
            { label: '主动说话', type: 'checkbox', checked: ctx.proactiveEnabled !== false, click: (menuItem) => {
                if (deps.setProactiveState) deps.setProactiveState(menuItem.checked);
            }},
            { label: '查看 Agent 历史', click: () => { deps.openAgentHistoryWindow(); } },
            { label: '查看观察数据', click: () => { deps.openObservationWindow(); } },
            { label: '复习卡片', click: () => { deps.openFlashcardReviewWindow(); } },
            { label: '日历', click: () => { deps.openCalendarWindow(); } },
            { type: 'separator' },
            { label: mt('main.settings'), click: () => {
                if (ctx.settingsWindow && !ctx.settingsWindow.isDestroyed()) {
                    ctx.settingsWindow.show(); ctx.settingsWindow.focus();
                } else { deps.createSettingsWindow(); }
            }},
            { label: mt('main.close'), click: () => { if (ctx.petWindow && !ctx.petWindow.isDestroyed()) ctx.petWindow.close(); }}
        ];
        Menu.buildFromTemplate(template).popup({ window: ctx.petWindow });
    });

    ipcMain.handle('get-gender-term', async () => {
        return { success: true, term: 'you' };
    });

    ipcMain.handle('open-dev-tools', async () => {
        if (ctx.petWindow && !ctx.petWindow.isDestroyed()) ctx.petWindow.webContents.openDevTools();
        return { success: true };
    });

    ipcMain.handle('get-app-path', async () => {
        return app.getAppPath();
    });

    ipcMain.handle('open-external', async (_, url) => {
        if (!isValidURL(url)) return { success: false, error: 'invalid URL' };
        await shell.openExternal(url);
    });

    ipcMain.handle('show-settings', async () => {
        if (ctx.settingsWindow && !ctx.settingsWindow.isDestroyed()) {
            ctx.settingsWindow.show();
            ctx.settingsWindow.focus();
        } else {
            deps.createSettingsWindow();
        }
        return { success: true };
    });

    // Forward renderer console.log to main process stdout (no --enable-logging needed)
    ipcMain.on('renderer-log', (_, level, args) => {
        const fn = console[level] || console.log;
        fn.apply(console, args);
    });
}

module.exports = { registerUtilityIPC };
