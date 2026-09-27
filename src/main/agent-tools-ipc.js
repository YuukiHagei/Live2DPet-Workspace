/**
 * Agent 工具 IPC — 待办 / 日程
 */
function registerAgentToolsIPC(ctx, ipcMain, deps) {
    const { dataStore } = deps;

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
}

module.exports = { registerAgentToolsIPC };