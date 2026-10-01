/**
 * TimerScheduler — 每秒检查倒计时是否到点
 */
function createTimerScheduler(dataStore, deps) {
    // deps: { onTimerComplete, BrowserWindow }
    let _timer = null;
    let _running = false;

    function start() {
        if (_timer) return;
        _timer = setInterval(tick, 1000);
        console.log('[Timer] Scheduler started (every 1s)');
    }

    function stop() {
        if (_timer) {
            clearInterval(_timer);
            _timer = null;
            console.log('[Timer] Scheduler stopped');
        }
    }

    function tick() {
        if (_running) return;
        _running = true;
        try {
            const due = dataStore.getDueTimers();
            for (const t of due) {
                const result = dataStore.markTimerCompleted(t.id);
                if (result && result.timer && deps.onTimerComplete) {
                    try {
                        deps.onTimerComplete(result.timer, result.pomodoroTransition);
                    } catch (e) {
                        console.error('[Timer] onComplete error:', e.message);
                    }
                }
            }
        } catch (e) {
            console.error('[Timer] tick error:', e.message);
        } finally {
            _running = false;
        }
    }

    return { start, stop, tick };
}

module.exports = { createTimerScheduler };