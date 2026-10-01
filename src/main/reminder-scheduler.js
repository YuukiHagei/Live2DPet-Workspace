/**
 * ReminderScheduler — 定时检查到点的提醒，广播给所有窗口。
 * 支持过期窗口（超出窗口的标记为"已错过"，不触发）。
 */

function createReminderScheduler(dataStore, deps) {
    const { BrowserWindow, configManager } = deps;
    let timer = null;
    const CHECK_INTERVAL_MS = 30000;   // 每 30 秒检查一次
    const DEFAULT_WINDOW_MIN = 30;

    async function getWindowMs() {
        try {
            if (!configManager) return DEFAULT_WINDOW_MIN * 60 * 1000;
            const cfg = await configManager.loadConfigFile();
            const min = cfg.reminder?.missedWindowMinutes;
            if (typeof min === 'number' && min > 0) return min * 60 * 1000;
            return DEFAULT_WINDOW_MIN * 60 * 1000;
        } catch {
            return DEFAULT_WINDOW_MIN * 60 * 1000;
        }
    }

    function broadcast(reminders) {
        if (!reminders || reminders.length === 0) return;
        const wins = BrowserWindow.getAllWindows();
        for (const r of reminders) {
            console.log(`[Reminder] Triggered: ${r.text} (id=${r.id})`);
            for (const w of wins) {
                if (!w.isDestroyed()) {
                    w.webContents.send('reminder-triggered', r);
                }
            }
            dataStore.markReminderTriggered(r.id);
        }
    }

    async function check() {
        try {
            const windowMs = await getWindowMs();
            const result = dataStore.processReminders(Date.now(), windowMs);
            if (result.due.length > 0) broadcast(result.due);
            if (result.missed.length > 0) {
                console.log(`[Reminder] ${result.missed.length} marked as missed`);
            }
            if (result.advanced.length > 0) {
                console.log(`[Reminder] ${result.advanced.length} repeated reminders advanced`);
            }
        } catch (err) {
            console.error('[Reminder] check failed:', err.message);
        }
    }

    function start() {
        if (timer) return;
        timer = setInterval(check, CHECK_INTERVAL_MS);
        console.log(`[Reminder] Scheduler started (every ${CHECK_INTERVAL_MS / 1000}s)`);
        // 启动后延迟 5 秒检查一次，处理错过的提醒
        setTimeout(check, 5000);
    }

    function stop() {
        if (timer) {
            clearInterval(timer);
            timer = null;
            console.log('[Reminder] Scheduler stopped');
        }
    }

    return { start, stop, check };
}

module.exports = { createReminderScheduler };