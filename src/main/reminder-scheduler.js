/**
 * ReminderScheduler — 定时检查到点的提醒，广播给所有窗口。
 */

function createReminderScheduler(dataStore, deps) {
    const { BrowserWindow } = deps;
    let timer = null;
    const CHECK_INTERVAL_MS = 30000;   // 每 30 秒检查一次

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

    function check() {
        try {
            const due = dataStore.getDueReminders();
            if (due.length > 0) broadcast(due);
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