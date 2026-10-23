/**
 * schedule-repeat.js — 日程重复规则（纯函数，无依赖）
 *
 * 语义：一条日程记录带一个 repeat 规则，读取时展开成「每天/每周的那几次」。
 * 这一点与「持续多天」的日程（运动会连续三天、国庆七天）严格区分：
 *   - 持续多天：一条记录，startAt → endAt 跨越多天；日历上画色带
 *   - 重复日程：一条记录，每次都是 startAt→endAt 这段时长；日历上每天各一条
 *
 * 存储形状（schedules.json 里每条日程多一个字段）：
 *   repeat: {
 *     freq: 'daily' | 'weekly',
 *     weekdays: [0..6],      // 仅 weekly 用，0=周日
 *     until: number | null,  // 截止到哪一天（当天 23:59:59.999，含当天）
 *     exdates: [number]      // 被跳过的「某一次」的 occurrenceStart
 *   }
 * 没有 repeat 字段 = 不重复（兼容旧数据，无需迁移）。
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ScheduleRepeat = api;
})(typeof window !== 'undefined' ? window : null, function () {
    const DAY_MS = 86400000;
    const MAX_OCCURRENCES = 400; // 单条日程在一次查询里最多展开多少条，防病态循环

    const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

    function startOfDay(ts) {
        const d = new Date(ts);
        return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    }

    function endOfDay(ts) {
        return startOfDay(ts) + DAY_MS - 1;
    }

    function toTs(value) {
        if (value === null || value === undefined || value === '') return null;
        if (typeof value === 'number') return Number.isFinite(value) ? value : null;
        if (typeof value !== 'string') return null;
        const s = value.trim();
        if (!s) return null;
        if (/^\d{10,13}$/.test(s)) return Number(s);
        // 纯日期 "2026-10-31" 按本地时区当天 0 点解析（避免 UTC 偏移把日期挪一天）
        const dateOnly = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (dateOnly) {
            const [, y, m, d] = dateOnly;
            return new Date(Number(y), Number(m) - 1, Number(d)).getTime();
        }
        const d = new Date(s);
        return isNaN(d.getTime()) ? null : d.getTime();
    }

    function normalizeWeekdays(input) {
        if (!input) return [];
        const arr = Array.isArray(input) ? input : String(input).split(/[,，\s]+/);
        const out = [];
        for (const raw of arr) {
            const n = Number(raw);
            if (Number.isInteger(n) && n >= 0 && n <= 6 && !out.includes(n)) out.push(n);
        }
        return out.sort((a, b) => a - b);
    }

    /**
     * 把「用户/模型给的重复描述」规范成存储用的对象。
     * 接受的形状：
     *   repeat: { freq, weekdays, until, exdates }
     *   repeat: 'daily' | 'weekly' | 'none'
     *   扁平的 weekday/until 字段（配合 repeat 字符串）
     * @param {object} input  { repeat, weekdays, repeatUntil/until }
     * @param {number} baseStart 系列第一次的开始时间（weekly 没指定周几时用它兜底）
     * @returns {object|null} null 表示不重复
     */
    function normalizeRepeat(input, baseStart) {
        if (!input) return null;
        const src = typeof input === 'object' ? input : { repeat: input };
        let freq = src.repeat;
        let weekdays = src.weekdays;
        let until = src.repeatUntil !== undefined ? src.repeatUntil : src.until;
        let exdates = src.exdates;

        if (freq && typeof freq === 'object') {
            weekdays = freq.weekdays !== undefined ? freq.weekdays : weekdays;
            until = freq.until !== undefined ? freq.until : until;
            exdates = freq.exdates !== undefined ? freq.exdates : exdates;
            freq = freq.freq;
        }

        if (!freq || freq === 'none' || freq === 'never') return null;
        if (freq !== 'daily' && freq !== 'weekly') {
            throw new Error(`不支持的重复方式：${freq}（只支持 daily / weekly / none）`);
        }

        let days = normalizeWeekdays(weekdays);
        if (freq === 'daily') {
            days = []; // 每天不需要周几
        } else if (days.length === 0) {
            // 每周但没说周几：默认跟第一次的星期几一致
            const base = new Date(baseStart || Date.now());
            days = [base.getDay()];
        }

        const untilTs = toTs(until);
        const cleanExdates = Array.isArray(exdates)
            ? exdates.map(toTs).filter((v) => v !== null).sort((a, b) => a - b)
            : [];

        return {
            freq,
            weekdays: days,
            until: untilTs === null ? null : endOfDay(untilTs),
            exdates: cleanExdates
        };
    }

    function matchesDay(repeat, date, baseWeekday) {
        if (repeat.freq === 'daily') return true;
        if (repeat.freq === 'weekly') {
            const days = repeat.weekdays && repeat.weekdays.length
                ? repeat.weekdays
                : [typeof baseWeekday === 'number' ? baseWeekday : date.getDay()];
            return days.includes(date.getDay());
        }
        return false;
    }

    /**
     * 展开一条日程在 [fromTs, toTs] 窗口内的所有「出现」。
     * 不重复的日程：窗口外返回 []，窗口内返回一条原样对象。
     * 重复的日程：返回若干条副本，startAt/endAt 换成当次的时间，
     *   并带上 occurrenceOf（系列 id）与 occurrenceStart（当次开始时间）。
     */
    function expandSchedule(schedule, fromTs, toTs) {
        if (!schedule || typeof schedule.startAt !== 'number') return [];
        const from = typeof fromTs === 'number' ? fromTs : -Infinity;
        const to = typeof toTs === 'number' ? toTs : Infinity;
        const baseStart = schedule.startAt;
        const baseEnd = typeof schedule.endAt === 'number' ? schedule.endAt : null;
        const duration = baseEnd !== null ? Math.max(0, baseEnd - baseStart) : 0;
        const repeat = schedule.repeat;

        if (!repeat || !repeat.freq || repeat.freq === 'none') {
            const end = baseEnd !== null ? baseEnd : baseStart;
            if (baseStart <= to && end >= from) return [schedule];
            return [];
        }

        const until = typeof repeat.until === 'number' ? repeat.until : null;
        const exdates = new Set(Array.isArray(repeat.exdates) ? repeat.exdates : []);
        const baseDate = new Date(baseStart);
        const hh = baseDate.getHours();
        const mi = baseDate.getMinutes();
        const ss = baseDate.getSeconds();
        const ms = baseDate.getMilliseconds();

        // 起点：查询窗口左边界往前推一个「时长」，这样跨午夜的长日程也能被查到
        const earliest = startOfDay(Math.max(from - duration, startOfDay(baseStart)));
        const latest = startOfDay(Math.min(to, until === null ? to : until));
        if (latest < earliest) return [];

        const out = [];
        for (let dayTs = earliest; dayTs <= latest; dayTs += DAY_MS) {
            const day = new Date(dayTs);
            if (dayTs < startOfDay(baseStart)) continue;
            if (!matchesDay(repeat, day, baseDate.getDay())) continue;

            const occStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh, mi, ss, ms).getTime();
            if (occStart < baseStart) continue;
            if (until !== null && occStart > until) break;
            if (exdates.has(occStart)) continue;

            const occEnd = baseEnd !== null ? occStart + duration : null;
            const occEndForOverlap = occEnd !== null ? occEnd : occStart;
            if (occStart > to || occEndForOverlap < from) continue;

            out.push(Object.assign({}, schedule, {
                startAt: occStart,
                endAt: occEnd,
                occurrenceOf: schedule.id,
                occurrenceStart: occStart,
                // 系列本身的起点/终点，给编辑界面用：
                // 在「某一天」点开时应该编辑系列，而不是把系列起点挪到那一天
                seriesStartAt: baseStart,
                seriesEndAt: baseEnd
            }));
            if (out.length >= MAX_OCCURRENCES) break;
        }
        return out;
    }

    /** 给界面/模型看的自然语言描述，如「每天」「每周一、三」「每天（至 10月31日）」 */
    function describeRepeat(repeat) {
        if (!repeat || !repeat.freq) return '';
        let text;
        if (repeat.freq === 'daily') {
            text = '每天';
        } else if (repeat.freq === 'weekly') {
            const days = (repeat.weekdays || []).slice().sort((a, b) => a - b);
            text = '每周' + (days.length ? days.map((d) => WEEKDAY_NAMES[d]).join('、') : '');
        } else {
            return '';
        }
        if (typeof repeat.until === 'number') {
            const d = new Date(repeat.until);
            text += `（至 ${d.getMonth() + 1}月${d.getDate()}日）`;
        }
        return text;
    }

    return {
        DAY_MS,
        MAX_OCCURRENCES,
        WEEKDAY_NAMES,
        startOfDay,
        endOfDay,
        toTs,
        normalizeWeekdays,
        normalizeRepeat,
        expandSchedule,
        describeRepeat
    };
});
