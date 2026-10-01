/**
 * Agent 工具 IPC — 待办 / 日程
 */
function registerAgentToolsIPC(ctx, ipcMain, deps) {
    const { dataStore } = deps;

    // 广播 timer 变化给所有窗口
    function broadcastTimerUpdate() {
        const { BrowserWindow } = require('electron');
        for (const w of BrowserWindow.getAllWindows()) {
            if (!w.isDestroyed()) w.webContents.send('timer-updated');
        }
    }

    // ========== 待办 ==========

    ipcMain.handle('agent-add-todo', async (event, args) => {
        try {
            const todo = dataStore.addTodo(args || {});
            return { success: true, todo };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('agent-list-todos', async (event, args) => {
        try {
            const list = dataStore.listTodos(args || {});
            return { success: true, todos: list };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('agent-complete-todo', async (event, args) => {
        try {
            const todo = dataStore.completeTodo(args || {});
            return { success: true, todo };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('agent-update-todo', async (event, args) => {
        try {
            const r = dataStore.updateTodo(args || {});
            return { success: true, todo: r.todo, changes: r.changes };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('agent-delete-todo', async (event, args) => {
        try {
            const todo = dataStore.deleteTodo(args || {});
            return { success: true, todo };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ========== 日程 ==========

    ipcMain.handle('agent-add-schedule', async (event, args) => {
        try {
            const sch = dataStore.addSchedule(args || {});
            return { success: true, schedule: sch };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('agent-list-schedules', async (event, args) => {
        try {
            const list = dataStore.listSchedules(args || {});
            return { success: true, schedules: list };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('agent-update-schedule', async (event, args) => {
        try {
            const r = dataStore.updateSchedule(args || {});
            return { success: true, schedule: r.schedule, changes: r.changes };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('agent-delete-schedule', async (event, args) => {
        try {
            const schedule = dataStore.deleteSchedule(args || {});
            return { success: true, schedule };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ========== 提醒 ==========

    ipcMain.handle('agent-add-reminder', async (event, args) => {
        try {
            const r = dataStore.addReminder(args || {});
            return { success: true, reminder: r };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('agent-list-reminders', async (event, args) => {
        try {
            const list = dataStore.listReminders(args || {});
            return { success: true, reminders: list };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('agent-update-reminder', async (event, args) => {
        try {
            const r = dataStore.updateReminder(args || {});
            return { success: true, reminder: r.reminder, changes: r.changes };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });
    
    ipcMain.handle('agent-delete-reminder', async (event, args) => {
        try {
            const r = dataStore.deleteReminder(args || {});
            return { success: true, reminder: r };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ========== 复习卡片 ==========

    ipcMain.handle('agent-add-flashcard', async (event, args) => {
        try {
            const r = dataStore.addFlashcard(args || {});
            return { success: true, card: r.card, duplicate: r.duplicate };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('agent-list-flashcards', async (event, args) => {
        try {
            const list = dataStore.listFlashcards(args || {});
            return { success: true, cards: list };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('agent-get-due-cards', async (event, args) => {
        try {
            const list = dataStore.getDueCards(args || {});
            return { success: true, cards: list };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('agent-review-flashcard', async (event, args) => {
        try {
            const card = dataStore.reviewFlashcard(args || {});
            return { success: true, card };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('agent-delete-flashcard', async (event, args) => {
        try {
            const card = dataStore.deleteFlashcard(args || {});
            return { success: true, card };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('agent-update-flashcard', async (event, args) => {
        try {
            const r = dataStore.updateFlashcard(args || {});
            return { success: true, card: r.card, changes: r.changes };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('agent-flashcard-stats', async () => {
        try {
            return { success: true, stats: dataStore.getFlashcardStats() };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ========== 普通对话记忆 ==========

    ipcMain.handle('agent-load-chat-memory', async () => {
        try {
            return { success: true, messages: dataStore.loadChatMemory() };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('agent-save-chat-memory', async (event, messages) => {
        try {
            dataStore.saveChatMemory(messages || []);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('agent-clear-chat-memory', async () => {
        try {
            dataStore.clearChatMemory();
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ========== Agent 历史 ==========

    ipcMain.handle('agent-load-agent-history', async () => {
        try {
            return { success: true, data: dataStore.loadAgentHistory() };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('agent-save-agent-history', async (event, data) => {
        try {
            dataStore.saveAgentHistory(data || {});
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('agent-clear-agent-history', async () => {
        try {
            dataStore.clearAgentHistory();
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ========== 用户画像 ==========

    ipcMain.handle('agent-load-user-profile', async () => {
        try {
            return { success: true, data: dataStore.loadUserProfile() };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('agent-save-user-profile', async (event, data) => {
        try {
            dataStore.saveUserProfile(data || {});
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('agent-clear-user-profile', async () => {
        try {
            dataStore.clearUserProfile();
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ========== 观察日志 ==========

    ipcMain.handle('agent-load-observations', async () => {
        try {
            return { success: true, data: dataStore.loadObservations() };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('agent-save-observations', async (event, data) => {
        try {
            dataStore.saveObservations(data || {});
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('agent-clear-observations', async () => {
        try {
            dataStore.clearObservations();
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ========== 倒计时 / 正计时 ==========

    ipcMain.handle('timer-add', async (event, args) => {
        try {
            const t = dataStore.addTimer(args || {});
            broadcastTimerUpdate();
            return { success: true, timer: t };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('timer-add-pomodoro', async (event, args) => {
        try {
            const t = dataStore.addPomodoro(args || {});
            broadcastTimerUpdate();
            return { success: true, timer: t };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('timer-list', async () => {
        try {
            return { success: true, timers: dataStore.listTimers() };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('timer-pause', async (event, id) => {
        try {
            const t = dataStore.pauseTimer(id);
            broadcastTimerUpdate();
            return { success: true, timer: t };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('timer-resume', async (event, id) => {
        try {
            const t = dataStore.resumeTimer(id);
            broadcastTimerUpdate();
            return { success: true, timer: t };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('timer-restart', async (event, id, newDurationMs) => {
        try {
            const t = dataStore.restartTimer(id, newDurationMs);
            broadcastTimerUpdate();
            return { success: true, timer: t };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('timer-stop', async (event, id) => {
        try {
            const t = dataStore.stopTimer(id);
            if (t) {
                const { BrowserWindow } = require('electron');
                for (const w of BrowserWindow.getAllWindows()) {
                    if (!w.isDestroyed()) {
                        w.webContents.send('timer-completed', { timer: t, pomodoroTransition: null });
                    }
                }
            }
            broadcastTimerUpdate();
            return { success: true, timer: t };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('timer-update', async (event, args) => {
        try {
            const r = dataStore.updateTimer(args || {});
            broadcastTimerUpdate();
            return { success: true, timer: r.timer, changes: r.changes };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('timer-delete', async (event, id) => {
        try {
            const t = dataStore.deleteTimer(id);
            broadcastTimerUpdate();
            return { success: true, timer: t };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });
}

module.exports = { registerAgentToolsIPC };