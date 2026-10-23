/**
 * Unit tests for 本地备份（导出 / 导入）
 * Run with: node --test tests/test-data-backup.js
 *
 * 不启动 Electron：用假的 ipcMain / dialog / app / dataStore 驱动
 * src/main/data-backup-ipc.js，在临时目录里验证真实文件读写。
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { registerDataBackupIPC } = require('../src/main/data-backup-ipc');

let tmpRoot;
let dataDir;
let promptsDir;
let configPath;
let exportPath;
let handlers;
let dataStore;
let openFile;

const SEED = {
    'todos.json': { todos: [{ id: 't1', text: '买猫粮', done: false }, { id: 't2', text: '交作业', done: true }] },
    'schedules.json': { schedules: [{ id: 's1', title: '考研复习', startAt: 1, endAt: 2 }] },
    'reminders.json': { reminders: [{ id: 'r1', text: '喝水', at: 1 }] },
    'flashcards.json': { flashcards: [{ id: 'c1', front: 'A', back: 'B' }] },
    'timers.json': { timers: [{ id: 'tm1', name: '番茄', state: 'done' }] },
    'chat-memory.json': { messages: [{ role: 'user', content: '你好' }] },
    'user-profile.json': { name: '仁楮', occupation: '美术史论', goals: [], preferences: [], background: [], updatedAt: 1 }
};

function writeDataTree() {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(promptsDir, { recursive: true });
    for (const [name, value] of Object.entries(SEED)) {
        fs.writeFileSync(path.join(dataDir, name), JSON.stringify(value, null, 2));
    }
    fs.writeFileSync(path.join(promptsDir, 'char1.json'), JSON.stringify({ name: '小铃' }));
    fs.writeFileSync(configPath, JSON.stringify({ apiKey: 'sk-secret' }));
}

before(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'l2d-backup-test-'));
    dataDir = path.join(tmpRoot, 'data');
    promptsDir = path.join(tmpRoot, 'prompts');
    configPath = path.join(tmpRoot, 'config.json');
    exportPath = path.join(tmpRoot, 'backup.json');
    writeDataTree();

    handlers = {};
    const ipcMain = { handle: (channel, fn) => { handlers[channel] = fn; } };
    const dialog = {
        showSaveDialog: async () => ({ canceled: false, filePath: exportPath }),
        showOpenDialog: async () => ({ canceled: false, filePaths: [openFile] }),
        // 第一个确认框（含「导入」按钮）选导入；第二个（重启询问）选稍后
        showMessageBox: async (opts) => ({ response: opts.buttons.includes('导入') ? 1 : 1 })
    };
    const app = {
        getPath: () => tmpRoot,
        getVersion: () => '2.1.0',
        relaunch: () => { throw new Error('relaunch 不应被调用（测试选了稍后重启）'); },
        exit: () => { throw new Error('exit 不应被调用'); }
    };
    dataStore = {
        _dirty: false,
        _flushTimer: null,
        _blockedFiles: new Set(),
        _flush: () => {}
    };

    registerDataBackupIPC(
        { gistSync: { setAutoPush() {} }, cloudSync: { setAutoPush() {} } },
        ipcMain,
        { app, dialog, dataDir, promptsDir, configPath, dataStore }
    );
});

after(() => {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});

describe('data-backup-info', () => {
    it('reports counts, prompts and data dir', async () => {
        const r = await handlers['data-backup-info']();
        assert.strictEqual(r.success, true);
        assert.strictEqual(r.counts.todos, 2);
        assert.strictEqual(r.counts.schedules, 1);
        assert.strictEqual(r.promptCount, 1);
        assert.strictEqual(r.dataDir, dataDir);
    });
});

describe('导出', () => {
    it('writes a bundle with data, reports and prompts', async () => {
        const r = await handlers['data-backup-export']({}, { includeConfig: false });
        assert.strictEqual(r.success, true);
        assert.ok(fs.existsSync(exportPath));

        const bundle = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
        assert.strictEqual(bundle.format, 'live2dpet-backup');
        assert.strictEqual(bundle.schema, 1);
        assert.strictEqual(Object.keys(bundle.data).length, Object.keys(SEED).length);
        assert.strictEqual(Object.keys(bundle.prompts).length, 1);
        assert.strictEqual(bundle.counts.todos, 2);
        assert.strictEqual(bundle.counts.messages, 1);
    });

    it('does not include config.json (API keys) by default', async () => {
        const bundle = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
        assert.strictEqual(bundle.config, undefined);
    });

    it('includes config.json only when opted in', async () => {
        const withConfig = path.join(tmpRoot, 'backup-with-config.json');
        const r = await handlers['data-backup-export']({}, { includeConfig: true });
        assert.strictEqual(r.success, true);
        // showSaveDialog 固定返回 exportPath，所以这里单独用一次导出校验 bundle 结构
        const bundle = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
        assert.strictEqual(bundle.config.apiKey, 'sk-secret');
        assert.ok(withConfig); // 路径仅占位，避免未使用变量
    });
});

describe('导入', () => {
    it('restores overwritten and deleted files, and backs up first', async () => {
        openFile = exportPath;
        // 破坏本地数据
        fs.writeFileSync(path.join(dataDir, 'todos.json'), JSON.stringify({ todos: [{ id: 'x', text: '被篡改' }] }));
        fs.unlinkSync(path.join(dataDir, 'schedules.json'));
        fs.writeFileSync(path.join(promptsDir, 'char1.json'), JSON.stringify({ name: '被改' }));

        const r = await handlers['data-backup-import']();
        assert.strictEqual(r.success, true);
        assert.strictEqual(r.restarted, false);
        assert.ok(r.written.includes('todos.json'));

        const todos = JSON.parse(fs.readFileSync(path.join(dataDir, 'todos.json'), 'utf8'));
        assert.strictEqual(todos.todos.length, 2);
        assert.strictEqual(todos.todos[0].text, '买猫粮');
        assert.ok(fs.existsSync(path.join(dataDir, 'schedules.json')), '被删的文件应恢复');
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(promptsDir, 'char1.json'), 'utf8')).name, '小铃');
        assert.ok(fs.existsSync(path.join(dataDir, '.backup')), '应创建 .backup 目录');
    });

    it('creates a distinct backup dir for two imports in the same second', async () => {
        openFile = exportPath;
        await handlers['data-backup-import']();
        const dirs = fs.readdirSync(path.join(dataDir, '.backup')).filter((d) => d.startsWith('import-'));
        assert.ok(dirs.length >= 2, `期望至少两个备份目录，实际 ${dirs.join(',')}`);
        for (const d of dirs) {
            assert.ok(fs.existsSync(path.join(dataDir, '.backup', d, 'todos.json')), `${d} 里应有 todos.json`);
        }
    });

    it('freezes the in-memory store so stale writes cannot overwrite the import', async () => {
        assert.strictEqual(dataStore._dirty, false);
        assert.ok(dataStore._blockedFiles.has('todos.json'));
    });

    it('rejects an empty backup instead of wiping local data', async () => {
        const emptyPath = path.join(tmpRoot, 'empty.json');
        fs.writeFileSync(emptyPath, JSON.stringify({
            format: 'live2dpet-backup',
            schema: 1,
            data: { 'todos.json': { todos: [] } },
            prompts: {}
        }));
        openFile = emptyPath;
        const r = await handlers['data-backup-import']();
        assert.strictEqual(r.success, false);
        assert.match(r.error, /没有任何/);
        const todos = JSON.parse(fs.readFileSync(path.join(dataDir, 'todos.json'), 'utf8'));
        assert.strictEqual(todos.todos.length, 2, '拒绝后本地数据不能被清空');
    });

    it('filters path traversal entries in the bundle', async () => {
        const evilPath = path.join(tmpRoot, 'evil.json');
        fs.writeFileSync(evilPath, JSON.stringify({
            format: 'live2dpet-backup',
            schema: 1,
            data: {
                '../../evil.json': { hacked: true },
                'todos.json': { todos: [{ id: 'ok', text: '合法' }] }
            }
        }));
        openFile = evilPath;
        const r = await handlers['data-backup-import']();
        assert.strictEqual(r.success, true);
        assert.deepStrictEqual(r.written, ['todos.json']);
    });

    it('reports a readable error for invalid JSON', async () => {
        const badPath = path.join(tmpRoot, 'bad.json');
        fs.writeFileSync(badPath, '{ not json');
        openFile = badPath;
        const r = await handlers['data-backup-import']();
        assert.strictEqual(r.success, false);
        assert.match(r.error, /JSON/);
    });

    it('rejects a backup from a newer schema', async () => {
        const futurePath = path.join(tmpRoot, 'future.json');
        fs.writeFileSync(futurePath, JSON.stringify({
            format: 'live2dpet-backup',
            schema: 99,
            data: { 'todos.json': { todos: [{ id: 'a' }] } }
        }));
        openFile = futurePath;
        const r = await handlers['data-backup-import']();
        assert.strictEqual(r.success, false);
        assert.match(r.error, /schema/);
    });
});
