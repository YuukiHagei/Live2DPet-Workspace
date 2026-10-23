/**
 * DataBackupIPC — 本地备份：把全部数据导出成单个 JSON 文件，或从该文件导入。
 *
 * 与云同步（gist-sync / cloud-sync）的区别：
 *   1. 完全离线，不需要账号，不依赖网络；
 *   2. 默认不包含 config.json（里面有 API 密钥），只有用户显式勾选才包含；
 *   3. 导入前强制把将被覆盖的本地文件备份到 data/.backup/import-<时间戳>/；
 *   4. 导入后必须重启才生效 —— 因为 DataStore、计时器/提醒调度器都持有内存态，
 *      不重启会出现「界面还是旧数据」甚至旧数据把导入结果盖回去。
 *
 * 数据安全约定（继承 data-store.js 的历史教训）：
 *   - 备份里若没有任何实体数据，拒绝导入（防止空文件清空现有数据）；
 *   - 只覆盖备份里出现的文件，备份里没有的本地文件原样保留；
 *   - 文件名走白名单正则，拒绝路径穿越。
 */
const fs = require('fs');
const path = require('path');

const BACKUP_FORMAT = 'live2dpet-backup';
const BACKUP_SCHEMA = 1;
// 只允许写这种形状的文件名：不含路径分隔符，强制 .json 结尾
const JSON_FILE_RE = /^[A-Za-z0-9._-]+\.json$/;

// 用于给用户展示「导出了多少条」的字段映射。只影响统计，不影响写入内容。
const COUNT_KEYS = {
    'todos.json': 'todos',
    'schedules.json': 'schedules',
    'reminders.json': 'reminders',
    'flashcards.json': 'flashcards',
    'timers.json': 'timers',
    'chat-memory.json': 'messages'
};

// 展示用的中文名（只用于状态栏文案）
const COUNT_LABELS = {
    todos: '待办',
    schedules: '日程',
    reminders: '提醒',
    flashcards: '卡片',
    timers: '计时器',
    messages: '对话记忆'
};

function pad2(n) {
    return String(n).padStart(2, '0');
}

/** 20261023-193045，用于文件名与备份目录名 */
function stamp(d = new Date()) {
    return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`
        + `-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

/**
 * 智能解包：与 data-store.js 的 unwrapArray 同一套规则，
 * 处理历史事故留下的 {"todos": {"todos": [...]}} 这种嵌套（最多 8 层）。
 */
function unwrapArray(obj, key) {
    let cur = obj;
    for (let i = 0; i < 8; i++) {
        if (Array.isArray(cur)) return cur;
        if (!cur || typeof cur !== 'object') return [];
        if (Array.isArray(cur[key])) return cur[key];
        if (cur[key] && typeof cur[key] === 'object') {
            cur = cur[key];
            continue;
        }
        return [];
    }
    return [];
}

function listJsonFiles(dir) {
    if (!dir || !fs.existsSync(dir)) return [];
    try {
        return fs.readdirSync(dir)
            .filter((name) => JSON_FILE_RE.test(name))
            .filter((name) => {
                try {
                    return fs.statSync(path.join(dir, name)).isFile();
                } catch {
                    return false;
                }
            })
            .sort();
    } catch {
        return [];
    }
}

/** 读 JSON；损坏或不存在返回 undefined（损坏时不抛错，让它从备份里缺席即可） */
function readJsonSafe(file) {
    if (!file || !fs.existsSync(file)) return undefined;
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        console.warn(`[DataBackup] 跳过无法解析的文件 ${path.basename(file)}:`, err.message);
        return undefined;
    }
}

/** 写 JSON：先写 .tmp 再 rename，避免中途崩溃留下半个文件 */
function writeJsonAtomic(file, value) {
    const tmp = `${file}.import-tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
    try {
        fs.renameSync(tmp, file);
    } catch (err) {
        // Windows 上目标被占用时 rename 会失败，退化成直接覆盖
        try { fs.unlinkSync(tmp); } catch {}
        fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
    }
}

/**
 * 在 parentDir 下取一个不冲突的目录路径。
 * 同一秒内连续导入两次时，stamp() 是一样的，直接 mkdir 会复用同一个备份目录，
 * 导致上一次的备份被覆盖 —— 这里用 -2/-3 后缀避让。
 */
function uniqueDir(parentDir, baseName) {
    let candidate = path.join(parentDir, baseName);
    let i = 2;
    while (fs.existsSync(candidate)) {
        candidate = path.join(parentDir, `${baseName}-${i}`);
        i++;
        if (i > 99) break;
    }
    return candidate;
}

function dirStats(dir) {
    const files = listJsonFiles(dir);
    let bytes = 0;
    for (const name of files) {
        try { bytes += fs.statSync(path.join(dir, name)).size; } catch {}
    }
    return { files, bytes };
}

/** 统计各实体的条数（给 UI 显示，顺带用于空数据拦截） */
function computeCounts(dataMap) {
    const counts = {};
    for (const [file, key] of Object.entries(COUNT_KEYS)) {
        counts[key] = dataMap[file] === undefined ? 0 : unwrapArray(dataMap[file], key).length;
    }
    return counts;
}

function formatCounts(counts) {
    return Object.keys(COUNT_KEYS)
        .map((file) => COUNT_KEYS[file])
        .filter((key, i, arr) => arr.indexOf(key) === i)
        .map((key) => `${COUNT_LABELS[key] || key} ${counts[key] || 0}`)
        .join(' · ');
}

function registerDataBackupIPC(ctx, ipcMain, deps) {
    const { app, dialog, dataDir, promptsDir, configPath, dataStore } = deps;
    const reportsDir = path.join(dataDir, 'reports');

    // ========== 信息：数据目录 + 各实体条数（给设置页显示） ==========

    ipcMain.handle('data-backup-info', async () => {
        try {
            const data = {};
            const dirs = [dataDir];
            for (const dir of dirs) {
                for (const name of listJsonFiles(dir)) {
                    const v = readJsonSafe(path.join(dir, name));
                    if (v !== undefined) data[name] = v;
                }
            }
            const counts = computeCounts(data);
            const promptCount = listJsonFiles(promptsDir).length;
            const reportCount = listJsonFiles(reportsDir).length;
            const stats = dirStats(dataDir);
            return {
                success: true,
                dataDir,
                counts,
                promptCount,
                reportCount,
                fileCount: stats.files.length,
                totalBytes: stats.bytes,
                summary: formatCounts(counts)
            };
        } catch (err) {
            console.error('[DataBackup] info failed:', err.message);
            return { success: false, error: err.message };
        }
    });

    // ========== 导出 ==========

    ipcMain.handle('data-backup-export', async (event, options = {}) => {
        try {
            const includeConfig = !!options.includeConfig;
            const bundle = buildBundle({ includeConfig });

            const suggested = path.join(
                app.getPath('documents'),
                `Live2DPet-backup-${stamp()}.json`
            );
            const res = await dialog.showSaveDialog({
                title: '导出 Live2DPet 备份',
                defaultPath: suggested,
                filters: [{ name: 'JSON 备份', extensions: ['json'] }]
            });
            if (res.canceled || !res.filePath) return { success: false, canceled: true };

            writeJsonAtomic(res.filePath, bundle);
            const bytes = fs.statSync(res.filePath).size;
            console.log('[DataBackup] exported:', res.filePath, bytes, 'bytes');
            return {
                success: true,
                path: res.filePath,
                bytes,
                counts: bundle.counts,
                includedConfig: !!bundle.config,
                promptCount: Object.keys(bundle.prompts || {}).length,
                summary: formatCounts(bundle.counts)
            };
        } catch (err) {
            console.error('[DataBackup] export failed:', err.message);
            return { success: false, error: err.message };
        }
    });

    // ========== 导入 ==========

    ipcMain.handle('data-backup-import', async () => {
        try {
            const picked = await dialog.showOpenDialog({
                title: '选择 Live2DPet 备份文件',
                properties: ['openFile'],
                filters: [{ name: 'JSON 备份', extensions: ['json'] }]
            });
            if (picked.canceled || !picked.filePaths?.length) {
                return { success: false, canceled: true };
            }
            const file = picked.filePaths[0];

            let raw;
            try {
                raw = JSON.parse(fs.readFileSync(file, 'utf8'));
            } catch (err) {
                return { success: false, error: `文件不是合法的 JSON：${err.message}` };
            }
            const bundle = validateBundle(raw);
            if (!bundle.ok) return { success: false, error: bundle.error };

            // 空数据拦截：备份里一条实体数据都没有，绝不覆盖本地
            const counts = computeCounts(bundle.data);
            const total = Object.values(counts).reduce((a, b) => a + b, 0);
            const promptCount = Object.keys(bundle.prompts).length;
            if (total === 0 && promptCount === 0) {
                return {
                    success: false,
                    error: '备份文件里没有任何待办/日程/提醒/卡片/计时器/记忆，已拒绝导入（防止清空现有数据）。'
                };
            }

            // 覆盖前让用户看清楚要发生什么
            const detailLines = [
                `备份时间：${bundle.meta.exportedAt || '未知'}`,
                `来源版本：${bundle.meta.appVersion || '未知'}`,
                `内容：${formatCounts(counts)}`,
                promptCount ? `角色卡：${promptCount} 个` : null,
                bundle.config ? '包含设置（会覆盖当前 config.json，含 API 密钥）' : '不含设置（API 密钥等保持不变）',
                `本地文件会先备份到：data\\.backup\\import-*`,
                '',
                '导入后需要重启应用才会生效。'
            ].filter(Boolean);

            const confirm = await dialog.showMessageBox({
                type: 'warning',
                title: '确认导入备份',
                message: '确定用这个备份覆盖本地数据吗？',
                detail: detailLines.join('\n'),
                buttons: ['取消', '导入'],
                defaultId: 0,
                cancelId: 0,
                noLink: true
            });
            if (confirm.response !== 1) return { success: false, canceled: true };

            // ---- 1. 先把内存态落盘，再把将要被覆盖的文件整份备份 ----
            try {
                if (dataStore && dataStore._flushTimer) {
                    clearTimeout(dataStore._flushTimer);
                    dataStore._flushTimer = null;
                }
                if (dataStore && typeof dataStore._flush === 'function') dataStore._flush();
            } catch (err) {
                console.warn('[DataBackup] pre-flush failed:', err.message);
            }

            const backupDir = uniqueDir(path.join(dataDir, '.backup'), `import-${stamp()}`);
            fs.mkdirSync(backupDir, { recursive: true });
            const backedUp = [];
            const copyIfExists = (src, dst) => {
                try {
                    if (fs.existsSync(src)) {
                        fs.copyFileSync(src, dst);
                        backedUp.push(path.basename(dst));
                    }
                } catch (err) {
                    console.warn('[DataBackup] backup copy failed:', src, err.message);
                }
            };

            for (const name of Object.keys(bundle.data)) {
                copyIfExists(path.join(dataDir, name), path.join(backupDir, name));
            }
            for (const name of Object.keys(bundle.reports)) {
                const dstDir = path.join(backupDir, 'reports');
                fs.mkdirSync(dstDir, { recursive: true });
                copyIfExists(path.join(reportsDir, name), path.join(dstDir, name));
            }
            for (const name of Object.keys(bundle.prompts)) {
                const dstDir = path.join(backupDir, 'prompts');
                fs.mkdirSync(dstDir, { recursive: true });
                copyIfExists(path.join(promptsDir, name), path.join(dstDir, name));
            }
            if (bundle.config) copyIfExists(configPath, path.join(backupDir, 'config.json'));

            // ---- 2. 关掉云同步自动上传，避免退出时把旧内存态推上云端 ----
            for (const sync of [ctx.gistSync, ctx.cloudSync]) {
                try { if (sync && typeof sync.setAutoPush === 'function') sync.setAutoPush(false); } catch {}
            }

            // ---- 3. 写入（只覆盖备份里出现的文件） ----
            const written = [];
            for (const [name, value] of Object.entries(bundle.data)) {
                writeJsonAtomic(path.join(dataDir, name), value);
                written.push(name);
            }
            if (Object.keys(bundle.reports).length) {
                fs.mkdirSync(reportsDir, { recursive: true });
                for (const [name, value] of Object.entries(bundle.reports)) {
                    writeJsonAtomic(path.join(reportsDir, name), value);
                }
            }
            if (Object.keys(bundle.prompts).length) {
                fs.mkdirSync(promptsDir, { recursive: true });
                for (const [name, value] of Object.entries(bundle.prompts)) {
                    writeJsonAtomic(path.join(promptsDir, name), value);
                }
            }
            if (bundle.config) {
                fs.mkdirSync(path.dirname(configPath), { recursive: true });
                writeJsonAtomic(configPath, bundle.config);
            }

            // ---- 4. 冻结内存态，防止 500ms debounce 把旧数据写回去 ----
            try {
                if (dataStore && Array.isArray(dataStore._flushTimer)) {
                    // 理论上不会走到这里，留一手防御
                }
                if (dataStore && dataStore._blockedFiles) {
                    for (const name of written) dataStore._blockedFiles.add(name);
                } else if (dataStore) {
                    dataStore._blockedFiles = new Set(written);
                }
                if (dataStore) dataStore._dirty = false;
                if (dataStore && dataStore._flushTimer) {
                    clearTimeout(dataStore._flushTimer);
                    dataStore._flushTimer = null;
                }
            } catch (err) {
                console.warn('[DataBackup] freeze in-memory state failed:', err.message);
            }

            console.log('[DataBackup] imported:', written.join(', '), '=> backup at', backupDir);

            // ---- 5. 询问是否立即重启 ----
            const restart = await dialog.showMessageBox({
                type: 'question',
                title: '导入完成',
                message: '数据已导入，需要重启应用才会生效。',
                detail: `已写入：${written.join('、') || '（无）'}\n原数据备份在：${backupDir}`,
                buttons: ['现在重启', '稍后再重启'],
                defaultId: 0,
                cancelId: 1,
                noLink: true
            });

            const result = {
                success: true,
                written,
                counts,
                summary: formatCounts(counts),
                promptCount,
                includedConfig: !!bundle.config,
                backupDir,
                restarted: restart.response === 0
            };

            if (restart.response === 0) {
                const autoStart = app.getLoginItemSettings?.().openAtLogin;
                app.relaunch({ args: process.argv.slice(1).concat(autoStart ? [] : []) });
                app.exit(0);
            }
            return result;
        } catch (err) {
            console.error('[DataBackup] import failed:', err.message);
            return { success: false, error: err.message };
        }
    });

    // ========== 重启（导入后手动触发） ==========

    ipcMain.handle('data-backup-restart', async () => {
        try {
            app.relaunch({ args: process.argv.slice(1) });
            app.exit(0);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    // ========== 内部实现 ==========

    function buildBundle({ includeConfig }) {
        const data = {};
        for (const name of listJsonFiles(dataDir)) {
            const v = readJsonSafe(path.join(dataDir, name));
            if (v !== undefined) data[name] = v;
        }

        const reports = {};
        for (const name of listJsonFiles(reportsDir)) {
            const v = readJsonSafe(path.join(reportsDir, name));
            if (v !== undefined) reports[name] = v;
        }

        const prompts = {};
        for (const name of listJsonFiles(promptsDir)) {
            const v = readJsonSafe(path.join(promptsDir, name));
            if (v !== undefined) prompts[name] = v;
        }

        const bundle = {
            format: BACKUP_FORMAT,
            schema: BACKUP_SCHEMA,
            appVersion: app.getVersion(),
            exportedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
            exportedAtIso: new Date().toISOString(),
            platform: process.platform,
            counts: computeCounts(data),
            data,
            reports,
            prompts
        };

        if (includeConfig) {
            const cfg = readJsonSafe(configPath);
            if (cfg !== undefined) bundle.config = cfg;
        }
        return bundle;
    }

    /** 校验并把任意输入规范成 { ok, data, reports, prompts, config, meta } */
    function validateBundle(raw) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return { ok: false, error: '不是有效的备份文件（顶层必须是对象）。' };
        }
        // 允许两种来源：本功能导出的（带 format），或手工拼的（只带 data）
        if (raw.format && raw.format !== BACKUP_FORMAT) {
            return { ok: false, error: `不是 Live2DPet 备份文件（format=${raw.format}）。` };
        }
        if (raw.schema && Number(raw.schema) > BACKUP_SCHEMA) {
            return {
                ok: false,
                error: `备份来自更新版本的程序（schema=${raw.schema}），当前程序只支持 ${BACKUP_SCHEMA}。请先升级程序。`
            };
        }

        const pickFiles = (src) => {
            const out = {};
            if (!src || typeof src !== 'object' || Array.isArray(src)) return out;
            for (const [name, value] of Object.entries(src)) {
                // 白名单：拒绝 ..\ 之类，拒绝非 json
                if (!JSON_FILE_RE.test(name)) continue;
                if (value === null || typeof value !== 'object') continue;
                out[name] = value;
            }
            return out;
        };

        const data = pickFiles(raw.data);
        if (Object.keys(data).length === 0) {
            return { ok: false, error: '备份文件里没有数据（缺少 data 段）。' };
        }

        const config = (raw.config && typeof raw.config === 'object' && !Array.isArray(raw.config))
            ? raw.config
            : null;

        return {
            ok: true,
            data,
            reports: pickFiles(raw.reports),
            prompts: pickFiles(raw.prompts),
            config,
            meta: {
                exportedAt: raw.exportedAt || raw.exportedAtIso || '',
                appVersion: raw.appVersion || ''
            }
        };
    }
}

module.exports = { registerDataBackupIPC };
