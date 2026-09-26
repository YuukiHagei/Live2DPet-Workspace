/**
 * DailyBrief — 每日简报 / 晚间复盘
 * 主进程定时器：检查时间 → 聚合数据 → 广播给渲染进程
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const WEATHER_CODES = {
    0: '晴', 1: '晴间多云', 2: '多云', 3: '阴',
    45: '雾', 48: '雾凇',
    51: '小毛毛雨', 53: '毛毛雨', 55: '大毛毛雨',
    61: '小雨', 63: '中雨', 65: '大雨',
    71: '小雪', 73: '中雪', 75: '大雪',
    80: '阵雨', 81: '中阵雨', 82: '强阵雨',
    95: '雷雨', 96: '雷雨冰雹', 99: '强雷雨冰雹'
};

function httpsGet(url, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: timeoutMs }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error('JSON parse failed')); }
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.on('error', reject);
    });
}

class DailyBrief {
    constructor(deps) {
        // deps: { configManager, dataStore, broadcast, dataDir }
        this.deps = deps;
        this.stateFile = path.join(deps.dataDir, 'daily-brief.json');
        this.state = { morningSentDate: null, eveningSentDate: null };
        this._weatherCache = { data: null, at: 0 };
        this._timer = null;
        this._sending = false;
        this._load();
    }

    _load() {
        try {
            if (fs.existsSync(this.stateFile)) {
                const raw = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
                this.state = { ...this.state, ...raw };
            }
        } catch (e) { console.warn('[DailyBrief] load failed:', e.message); }
    }

    _save() {
        try {
            fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
        } catch (e) { console.warn('[DailyBrief] save failed:', e.message); }
    }

    _dateKey(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    start() {
        if (this._timer) return;
        this._timer = setInterval(() => {
            this._check().catch(e => console.warn('[DailyBrief] check error:', e.message));
        }, 60000);
        // 启动后 15 秒补播
        setTimeout(() => {
            this._check().catch(e => console.warn('[DailyBrief] check error:', e.message));
        }, 15000);
        console.log('[DailyBrief] Scheduler started (every 60s)');
    }

    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
            console.log('[DailyBrief] Scheduler stopped');
        }
    }

    async _check() {
        if (this._sending) return;
        const cfg = await this.deps.configManager.loadConfigFile();
        const brief = cfg.brief || {};
        if (brief.enabled === false) return;

        const now = new Date();
        const today = this._dateKey(now);
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const currentTime = `${hh}:${mm}`;

        // 早报：在 morningTime 到 12:00 的窗口内
        if (brief.morningEnabled !== false) {
            const time = brief.morningTime || '07:30';
            if (this.state.morningSentDate !== today && currentTime >= time && currentTime <= '11:59') {
                console.log('[DailyBrief] Triggering morning brief');
                this._sending = true;
                try {
                    const context = this._buildMorningContext(now);
                    if (context) {
                        this.deps.broadcast('daily-brief-triggered', { type: 'morning', context });
                        this.state.morningSentDate = today;
                        this._save();
                    }
                } finally {
                    this._sending = false;
                }
                return;   // 一次只发一个
            }
        }

        // 晚报：在 eveningTime 到 23:59 的窗口内
        if (brief.eveningEnabled !== false) {
            const time = brief.eveningTime || '22:00';
            if (this.state.eveningSentDate !== today && currentTime >= time && currentTime <= '23:59') {
                console.log('[DailyBrief] Triggering evening brief');
                this._sending = true;
                try {
                    const context = this._buildEveningContext(now);
                    if (context) {
                        this.deps.broadcast('daily-brief-triggered', { type: 'evening', context });
                        this.state.eveningSentDate = today;
                        this._save();
                    }
                } finally {
                    this._sending = false;
                }
            }
        }
    }

    _buildMorningContext(now) {
        try {
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
            const todayEnd = todayStart + 86400000 - 1;

            const schedules = this.deps.dataStore.listSchedules({ from: todayStart, to: todayEnd });
            const todos = this.deps.dataStore.listTodos({ includeDone: false });
            const dueTodos = todos.filter(t => t.dueAt && t.dueAt <= todayEnd);
            const otherTodos = todos.filter(t => !t.dueAt || t.dueAt > todayEnd);
            const reminders = this.deps.dataStore.listReminders({ includeDone: false })
                .filter(r => r.remindAt >= todayStart && r.remindAt <= todayEnd);

            return {
                date: this._dateKey(now),
                weekday: ['日', '一', '二', '三', '四', '五', '六'][now.getDay()],
                schedules: schedules.map(s => ({
                    time: new Date(s.startAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
                    title: s.title,
                    location: s.location || ''
                })),
                reminders: reminders.map(r => ({
                    time: new Date(r.remindAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
                    text: r.text
                })),
                dueTodos: dueTodos.map(t => ({ text: t.text })),
                otherTodos: otherTodos.slice(0, 5).map(t => ({ text: t.text })),
                weather: ''   // 先占位，天气异步获取
            };
        } catch (e) {
            console.warn('[DailyBrief] buildMorning failed:', e.message);
            return null;
        }
    }

    _buildEveningContext(now) {
        try {
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
            const todayEnd = todayStart + 86400000 - 1;
            const tomorrowStart = todayEnd + 1;
            const tomorrowEnd = tomorrowStart + 86400000 - 1;

            const allTodos = this.deps.dataStore.listTodos({ includeDone: true });
            const completedToday = allTodos.filter(t => t.done && t.doneAt >= todayStart && t.doneAt <= todayEnd);
            const stillPending = allTodos.filter(t => !t.done);
            const dueToday = stillPending.filter(t => t.dueAt && t.dueAt <= todayEnd);

            const todaySchedules = this.deps.dataStore.listSchedules({ from: todayStart, to: todayEnd });
            const tomorrowSchedules = this.deps.dataStore.listSchedules({ from: tomorrowStart, to: tomorrowEnd });
            const tomorrowReminders = this.deps.dataStore.listReminders({ includeDone: false })
                .filter(r => r.remindAt >= tomorrowStart && r.remindAt <= tomorrowEnd);

            return {
                date: this._dateKey(now),
                weekday: ['日', '一', '二', '三', '四', '五', '六'][now.getDay()],
                completedToday: completedToday.map(t => ({ text: t.text })),
                pendingCount: stillPending.length,
                dueToday: dueToday.map(t => ({ text: t.text })),
                todayScheduleCount: todaySchedules.length,
                tomorrowSchedules: tomorrowSchedules.map(s => ({
                    time: new Date(s.startAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
                    title: s.title
                })),
                tomorrowReminders: tomorrowReminders.map(r => ({
                    time: new Date(r.remindAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
                    text: r.text
                }))
            };
        } catch (e) {
            console.warn('[DailyBrief] buildEvening failed:', e.message);
            return null;
        }
    }

    /**
     * 供 IPC：返回早报的结构化数据 + 天气（异步拉）
     */
    async getMorningContextWithWeather() {
        const now = new Date();
        const ctx = this._buildMorningContext(now);
        if (!ctx) return null;
        const cfg = await this.deps.configManager.loadConfigFile();
        const city = cfg.brief?.city?.trim();
        if (city) {
            ctx.weather = await this._getWeatherText(city);
        }
        return ctx;
    }

    async _getWeatherText(city) {
        // 使用缓存，1小时内有效
        if (this._weatherCache.data && Date.now() - this._weatherCache.at < 3600000) {
            return this._weatherCache.data;
        }
        try {
            const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`;
            const geoData = await httpsGet(geoUrl);
            if (!geoData.results || geoData.results.length === 0) return null;
            const lat = geoData.results[0].latitude;
            const lon = geoData.results[0].longitude;

            const wUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
                         `&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max` +
                         `&timezone=auto&forecast_days=1`;
            const wData = await httpsGet(wUrl);
            if (!wData.daily) return null;

            const max = wData.daily.temperature_2m_max[0];
            const min = wData.daily.temperature_2m_min[0];
            const code = wData.daily.weather_code[0];
            const uvIndex = wData.daily.uv_index_max[0];
            const desc = WEATHER_CODES[code] || '未知';

            const result = {
                desc: desc,
                tempMin: Math.round(min),
                tempMax: Math.round(max),
                uvIndex: uvIndex,
                text: `${desc}，${Math.round(min)}~${Math.round(max)}°C，紫外线指数 ${uvIndex}`
            };
            this._weatherCache = { data: result, at: Date.now() };
            return result;
        } catch (e) {
            console.warn('[DailyBrief] weather failed:', e.message);
            return null;
        }
    }

    /**
     * 供 IPC：手动触发
     */
    async triggerManually(type) {
        if (type === 'morning') {
            const ctx = await this.getMorningContextWithWeather();
            if (ctx) this.deps.broadcast('daily-brief-triggered', { type: 'morning', context: ctx, manual: true });
        } else if (type === 'evening') {
            const ctx = this._buildEveningContext(new Date());
            if (ctx) this.deps.broadcast('daily-brief-triggered', { type: 'evening', context: ctx, manual: true });
        }
    }
}

module.exports = { DailyBrief };