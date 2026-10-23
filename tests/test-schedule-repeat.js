/**
 * Unit tests for 重复日程（schedule-repeat + DataStore 集成）
 * Run with: node --test tests/test-schedule-repeat.js
 *
 * 关键语义：重复日程 = 一条记录多次出现（每次时长不变），
 * 与「持续多天」的日程（startAt→endAt 跨天）是两回事。
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SR = require('../src/core/schedule-repeat');
const { DataStore } = require('../src/main/data-store');

// 2026-10-24 是周六
const SAT_0700 = new Date(2026, 9, 24, 7, 0, 0).getTime();
const SAT_0735 = new Date(2026, 9, 24, 7, 35, 0).getTime();

function keyOf(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('normalizeRepeat', () => {
    it('returns null for no repeat', () => {
        assert.strictEqual(SR.normalizeRepeat(null, SAT_0700), null);
        assert.strictEqual(SR.normalizeRepeat({ repeat: 'none' }, SAT_0700), null);
        assert.strictEqual(SR.normalizeRepeat({}, SAT_0700), null);
    });

    it('normalizes daily', () => {
        const r = SR.normalizeRepeat({ repeat: 'daily' }, SAT_0700);
        assert.strictEqual(r.freq, 'daily');
        assert.deepStrictEqual(r.weekdays, []);
        assert.strictEqual(r.until, null);
    });

    it('weekly without weekdays falls back to the base weekday', () => {
        const r = SR.normalizeRepeat({ repeat: 'weekly' }, SAT_0700);
        assert.deepStrictEqual(r.weekdays, [6]); // 周六
    });

    it('weekly keeps sorted unique weekdays', () => {
        const r = SR.normalizeRepeat({ repeat: 'weekly', weekdays: [5, 1, 1, 9, -1] }, SAT_0700);
        assert.deepStrictEqual(r.weekdays, [1, 5]);
    });

    it('date-only until becomes end of that day', () => {
        const r = SR.normalizeRepeat({ repeat: 'daily', repeatUntil: '2026-10-31' }, SAT_0700);
        const d = new Date(r.until);
        assert.strictEqual(d.getFullYear(), 2026);
        assert.strictEqual(d.getMonth(), 9);
        assert.strictEqual(d.getDate(), 31);
        assert.strictEqual(d.getHours(), 23);
    });

    it('rejects unknown freq', () => {
        assert.throws(() => SR.normalizeRepeat({ repeat: 'monthly' }, SAT_0700), /不支持的重复方式/);
    });
});

describe('expandSchedule', () => {
    const daily = {
        id: 'sch_1',
        title: '英语单词',
        startAt: SAT_0700,
        endAt: SAT_0735,
        repeat: { freq: 'daily', weekdays: [], until: null, exdates: [] }
    };

    it('keeps non-repeating schedules as a single item', () => {
        const once = { id: 'sch_2', title: '开会', startAt: SAT_0700, endAt: SAT_0735 };
        assert.strictEqual(SR.expandSchedule(once, SAT_0700 - 86400000, SAT_0700 + 86400000).length, 1);
        assert.strictEqual(SR.expandSchedule(once, SAT_0700 + 10 * 86400000, SAT_0700 + 11 * 86400000).length, 0);
    });

    it('expands every day with the same clock time', () => {
        const from = SAT_0700;
        const to = SAT_0700 + 3 * 86400000; // 4 天窗口
        const occ = SR.expandSchedule(daily, from, to);
        assert.strictEqual(occ.length, 4, `应展开 4 次，实际 ${occ.length}`);
        for (const o of occ) {
            assert.strictEqual(new Date(o.startAt).getHours(), 7);
            assert.strictEqual(new Date(o.startAt).getMinutes(), 0);
            // 每次都是 35 分钟，不是把日程拉长
            assert.strictEqual(o.endAt - o.startAt, 35 * 60000);
            assert.strictEqual(o.occurrenceOf, 'sch_1');
            assert.strictEqual(o.id, 'sch_1');
        }
        assert.deepStrictEqual(occ.map(o => keyOf(o.startAt)), ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
    });

    it('does not emit occurrences before the series start', () => {
        const occ = SR.expandSchedule(daily, SAT_0700 - 5 * 86400000, SAT_0700 + 86400000);
        assert.strictEqual(occ.length, 2);
        assert.strictEqual(keyOf(occ[0].startAt), '2026-10-24');
    });

    it('honours weekly weekdays', () => {
        const weekly = Object.assign({}, daily, {
            repeat: { freq: 'weekly', weekdays: [1, 3], until: null, exdates: [] } // 周一、周三
        });
        const occ = SR.expandSchedule(weekly, SAT_0700, SAT_0700 + 13 * 86400000);
        // 2026-10-24 周六 → 之后第一个周一是 10-26，周三是 10-28
        assert.deepStrictEqual(occ.map(o => keyOf(o.startAt)), ['2026-10-26', '2026-10-28', '2026-11-02', '2026-11-04']);
    });

    it('stops at until (inclusive)', () => {
        const limited = Object.assign({}, daily, {
            repeat: { freq: 'daily', weekdays: [], until: new Date(2026, 9, 26, 23, 59, 59, 999).getTime(), exdates: [] }
        });
        const occ = SR.expandSchedule(limited, SAT_0700, SAT_0700 + 10 * 86400000);
        assert.deepStrictEqual(occ.map(o => keyOf(o.startAt)), ['2026-10-24', '2026-10-25', '2026-10-26']);
    });

    it('skips exdates', () => {
        const withSkip = Object.assign({}, daily, {
            repeat: { freq: 'daily', weekdays: [], until: null, exdates: [SAT_0700 + 86400000] }
        });
        const occ = SR.expandSchedule(withSkip, SAT_0700, SAT_0700 + 2 * 86400000);
        assert.deepStrictEqual(occ.map(o => keyOf(o.startAt)), ['2026-10-24', '2026-10-26']);
    });

    it('caps runaway series', () => {
        const occ = SR.expandSchedule(daily, SAT_0700, SAT_0700 + 4000 * 86400000);
        assert.strictEqual(occ.length, SR.MAX_OCCURRENCES);
    });

    it('a multi-day event is still a single occurrence', () => {
        const sports = {
            id: 'sch_3', title: '运动会',
            startAt: SAT_0700,
            endAt: new Date(2026, 9, 26, 18, 0).getTime()
        };
        const occ = SR.expandSchedule(sports, SAT_0700, SAT_0700 + 5 * 86400000);
        assert.strictEqual(occ.length, 1, '持续多天不该被展开成多次');
    });
});

describe('describeRepeat', () => {
    it('renders daily / weekly / until', () => {
        assert.strictEqual(SR.describeRepeat(null), '');
        assert.strictEqual(SR.describeRepeat({ freq: 'daily' }), '每天');
        assert.strictEqual(SR.describeRepeat({ freq: 'weekly', weekdays: [1, 3] }), '每周一、三');
        assert.match(SR.describeRepeat({ freq: 'daily', until: new Date(2026, 9, 31, 23, 59).getTime() }), /每天（至 10月31日）/);
    });
});

describe('DataStore 集成', () => {
    let tmp;
    let store;

    before(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'l2d-repeat-test-'));
        store = new DataStore(path.join(tmp, 'data'));
    });

    after(() => {
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    });

    it('adds a daily schedule and lists every occurrence', () => {
        const s = store.addSchedule({
            title: '英语单词',
            startAt: SAT_0700,
            endAt: SAT_0735,
            repeat: 'daily'
        });
        assert.strictEqual(s.repeat.freq, 'daily');

        const list = store.listSchedules({ from: SAT_0700, to: SAT_0700 + 3 * 86400000 });
        const mine = list.filter(x => x.id === s.id);
        assert.strictEqual(mine.length, 4);
        assert.strictEqual(new Set(mine.map(x => x.occurrenceOf)).size, 1);
    });

    it('updates the repeat rule (and can cancel it)', () => {
        const s = store.addSchedule({ title: '晨跑', startAt: SAT_0700, endAt: SAT_0735, repeat: 'daily' });
        const r = store.updateSchedule({ idOrTitle: s.id, repeat: 'weekly', weekdays: [6] });
        assert.strictEqual(r.schedule.repeat.freq, 'weekly');
        assert.deepStrictEqual(r.schedule.repeat.weekdays, [6]);

        store.updateSchedule({ idOrTitle: s.id, repeat: 'none' });
        const list = store.listSchedules({ from: SAT_0700, to: SAT_0700 + 30 * 86400000 });
        assert.strictEqual(list.filter(x => x.id === s.id).length, 1, '取消重复后只剩一次');
    });

    it('skips one occurrence without touching the series', () => {
        const s = store.addSchedule({ title: '背单词', startAt: SAT_0700, endAt: SAT_0735, repeat: 'daily' });
        const list = store.listSchedules({ from: SAT_0700, to: SAT_0700 + 2 * 86400000 });
        const second = list.filter(x => x.id === s.id)[1];

        store.skipScheduleOccurrence({ idOrTitle: s.id, occurrenceStart: second.occurrenceStart });

        const after = store.listSchedules({ from: SAT_0700, to: SAT_0700 + 2 * 86400000 });
        const mine = after.filter(x => x.id === s.id);
        assert.strictEqual(mine.length, 2, '三天里跳过一次应剩两次');
        assert.ok(!mine.some(x => x.occurrenceStart === second.occurrenceStart), '被跳过的那次不该再出现');
    });

    it('refuses to skip a non-recurring schedule or an unknown occurrence', () => {
        const once = store.addSchedule({ title: '一次性', startAt: SAT_0700 });
        assert.throws(
            () => store.skipScheduleOccurrence({ idOrTitle: once.id, occurrenceStart: SAT_0700 }),
            /不是重复日程/
        );

        const s = store.addSchedule({ title: '每天读书', startAt: SAT_0700, repeat: 'daily' });
        assert.throws(
            () => store.skipScheduleOccurrence({ idOrTitle: s.id, occurrenceStart: SAT_0700 + 12345 }),
            /不在重复范围内/
        );
    });

    it('deleting a series removes every occurrence', () => {
        const s = store.addSchedule({ title: '临时重复', startAt: SAT_0700, endAt: SAT_0735, repeat: 'daily' });
        store.deleteSchedule({ idOrTitle: s.id });
        const list = store.listSchedules({ from: SAT_0700, to: SAT_0700 + 10 * 86400000 });
        assert.strictEqual(list.filter(x => x.id === s.id).length, 0);
    });

    it('persists the repeat rule to schedules.json', () => {
        const s = store.addSchedule({ title: '持久化测试', startAt: SAT_0700, endAt: SAT_0735, repeat: 'daily' });
        store._flush();
        const raw = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'schedules.json'), 'utf8'));
        const saved = raw.schedules.find(x => x.id === s.id);
        assert.ok(saved.repeat, 'repeat 字段应写入文件');
        assert.strictEqual(saved.repeat.freq, 'daily');
        assert.ok(!Array.isArray(saved.repeat), '不能写成展开后的多条');
    });
});
