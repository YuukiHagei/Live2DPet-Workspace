/**
 * ReportGenerator — 周报 / 月报
 * 定时器：检查时间 → 计算统计 → 广播给渲染进程
 */
const fs = require('fs');
const path = require('path');

class ReportGenerator {
    constructor(deps) {
        // deps: { configManager, dataStore, broadcast, dataDir }
        this.deps = deps;
        this.stateFile = path.join(deps.dataDir, 'report-state.json');
        this.reportsDir = path.join(deps.dataDir, 'reports');
        this.state = { lastWeeklyKey: null, lastMonthlyKey: null };
        this._timer = null;
        this._sending = false;

        if (!fs.existsSync(this.reportsDir)) fs.mkdirSync(this.reportsDir, { recursive: true });
        this._load();
    }

    _load() {
        try {
            if (fs.existsSync(this.stateFile)) {
                const raw = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
                this.state = { ...this.state, ...raw };
            }
        } catch (e) { console.warn('[Report] load failed:', e.message); }
    }

    _save() {
        try {
            fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
        } catch (e) { console.warn('[Report] save failed:', e.message); }
    }

    /**
     * ISO 周编号：2026-W39
     */
    _weekKey(d) {
        const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        const dayNum = tmp.getUTCDay() || 7;
        tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
        return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
    }

    _monthKey(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }

    /**
     * 本周一 00:00 的时间戳
     */
    _weekStart(now) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const day = d.getDay() || 7;   // 周日算 7
        d.setDate(d.getDate() - (day - 1));
        return d.getTime();
    }

    _monthStart(now) {
        return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    }

    start() {
        if (this._timer) return;
        this._timer = setInterval(() => {
            this._check().catch(e => console.warn('[Report] check error:', e.message));
        }, 60000);
        setTimeout(() => {
            this._check().catch(e => console.warn('[Report] check error:', e.message));
        }, 20000);
        console.log('[Report] Scheduler started (every 60s)');
    }

    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
            console.log('[Report] Scheduler stopped');
        }
    }

    async _check() {
        if (this._sending) return;
        const cfg = await this.deps.configManager.loadConfigFile();
        const rep = cfg.report || {};
        if (rep.enabled === false) return;

        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const currentTime = `${hh}:${mm}`;

        // === 周报：周日 21:00 之后 ===
        if (rep.weeklyEnabled !== false) {
            const targetTime = rep.weeklyTime || '21:00';
            const weekKey = this._weekKey(now);
            const isSunday = now.getDay() === 0;
            if (isSunday && this.state.lastWeeklyKey !== weekKey && currentTime >= targetTime) {
                console.log('[Report] Triggering weekly report');
                this._sending = true;
                try {
                    const stats = this.deps.dataStore.getPeriodStats(this._weekStart(now), Date.now());
                    this._saveReport('weekly', weekKey, stats);
                    this.deps.broadcast('report-triggered', { type: 'weekly', key: weekKey, stats });
                    this.state.lastWeeklyKey = weekKey;
                    this._save();
                } finally {
                    this._sending = false;
                }
                return;
            }
        }

        // === 月报：月末最后一天 21:00 之后 ===
        if (rep.monthlyEnabled !== false) {
            const targetTime = rep.monthlyTime || '21:00';
            const monthKey = this._monthKey(now);
            const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
            const isLastDay = tomorrow.getMonth() !== now.getMonth();
            if (isLastDay && this.state.lastMonthlyKey !== monthKey && currentTime >= targetTime) {
                console.log('[Report] Triggering monthly report');
                this._sending = true;
                try {
                    const stats = this.deps.dataStore.getPeriodStats(this._monthStart(now), Date.now());
                    this._saveReport('monthly', monthKey, stats);
                    this.deps.broadcast('report-triggered', { type: 'monthly', key: monthKey, stats });
                    this.state.lastMonthlyKey = monthKey;
                    this._save();
                } finally {
                    this._sending = false;
                }
            }
        }
    }

    _saveReport(type, key, stats) {
        try {
            const file = path.join(this.reportsDir, `${type}-${key}.json`);
            fs.writeFileSync(file, JSON.stringify(stats, null, 2));
            console.log(`[Report] Saved ${file}`);
        } catch (e) { console.warn('[Report] save file failed:', e.message); }
    }

    /**
     * 供 IPC：手动触发
     */
    async triggerManually(type) {
        const now = new Date();
        let stats, key;
        if (type === 'weekly') {
            key = this._weekKey(now);
            stats = this.deps.dataStore.getPeriodStats(this._weekStart(now), Date.now());
        } else {
            key = this._monthKey(now);
            stats = this.deps.dataStore.getPeriodStats(this._monthStart(now), Date.now());
        }
        this.deps.broadcast('report-triggered', { type, key, stats, manual: true });
        return { success: true };
    }
}

module.exports = { ReportGenerator };