/**
 * CompanionTracker — 记录宠物陪伴用户的天数。
 */
const fs = require('fs');
const path = require('path');

class CompanionTracker {
    constructor(dataDir) {
        this.file = path.join(dataDir, 'companion.json');
        this.data = {
            firstMetAt: null,
            lastSeenAt: null,
            totalDays: 0,
            totalLaunches: 0
        };
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        this._load();
        this._update();
    }

    _load() {
        try {
            if (fs.existsSync(this.file)) {
                const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
                this.data = { ...this.data, ...raw };
            }
        } catch (err) {
            console.error('[Companion] load failed:', err.message);
        }
    }

    _save() {
        try {
            fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
        } catch (err) {
            console.error('[Companion] save failed:', err.message);
        }
    }

    _update() {
        const now = Date.now();
        if (!this.data.firstMetAt) {
            this.data.firstMetAt = now;
            console.log('[Companion] 初次见面记录:', new Date(now).toLocaleString('zh-CN'));
        }
        this.data.lastSeenAt = now;
        this.data.totalLaunches = (this.data.totalLaunches || 0) + 1;
        this.data.totalDays = this._calcDays(this.data.firstMetAt, now);
        this._save();
        console.log(`[Companion] 第 ${this.data.totalDays} 天 · 第 ${this.data.totalLaunches} 次启动`);
    }

    _calcDays(startTs, endTs) {
        const s = new Date(startTs);
        const e = new Date(endTs);
        const sDay = new Date(s.getFullYear(), s.getMonth(), s.getDate()).getTime();
        const eDay = new Date(e.getFullYear(), e.getMonth(), e.getDate()).getTime();
        return Math.floor((eDay - sDay) / 86400000) + 1;
    }

    getStats() {
        const now = Date.now();
        return {
            firstMetAt: this.data.firstMetAt,
            lastSeenAt: this.data.lastSeenAt,
            totalDays: this._calcDays(this.data.firstMetAt, now),
            totalLaunches: this.data.totalLaunches,
            firstMetStr: new Date(this.data.firstMetAt).toLocaleDateString('zh-CN'),
            isFirstLaunch: this.data.totalLaunches === 1
        };
    }
}

module.exports = { CompanionTracker };