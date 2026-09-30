/**
 * CloudSync — 坚果云 WebDAV 同步（支持冲突检测与合并）
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('webdav');

const SYNC_FILES = [
    'todos.json', 'schedules.json', 'reminders.json', 'flashcards.json',
    'chat-memory.json', 'agent-history.json', 'user-profile.json', 'observations.json',
    'companion.json', 'daily-brief.json', 'report-state.json'
];


// 时间戳容差：5 秒内的偏差视为"没变"
const MTIME_TOLERANCE_MS = 5000;
// 每个数组型文件用哪个字段作为合并 key
const FILE_KEYS = {
    'todos.json':      { arrayKey: 'todos',      idField: 'id' },
    'schedules.json':  { arrayKey: 'schedules',  idField: 'id' },
    'reminders.json':  { arrayKey: 'reminders',  idField: 'id' },
    'flashcards.json': { arrayKey: 'flashcards', idField: 'id' },
    'chat-memory.json':{ arrayKey: 'messages',   idField: null, special: 'chatMemory' }
};

class CloudSync {
    constructor(deps) {
        this.deps = deps;
        this.client = null;
        this._status = { lastResult: null, lastAt: 0, syncing: false };
        this._autoPushEnabled = false;
        this._autoPushTimer = null;
        this._pendingPush = false;
        this._unresolvedConflicts = null;
    }

    async _ensureClient() {
        const cfg = await this.deps.configManager.loadConfigFile();
        const cloud = cfg.cloud || {};
        if (!cloud.enabled) throw new Error('云同步未启用');
        if (!cloud.webdavUrl || !cloud.username || !cloud.appPassword) {
            throw new Error('云同步配置不完整');
        }
        if (!this.client) {
            this.client = createClient(cloud.webdavUrl, {
                username: cloud.username,
                password: cloud.appPassword
            });
        }
        return { client: this.client, remotePath: cloud.remotePath || '/Live2DPet', cloud };
    }

    /**
     * 分析每个文件的冲突状态。
     * 返回 { conflicts: [...], safe: [{filename, action}] }
     */
    async analyzeConflicts() {
        const { client, remotePath, cloud } = await this._ensureClient();
        const lastSyncMap = cloud.lastSyncPerFile || {};
        const conflicts = [];
        const safe = [];

        await this._ensureRemoteDir(client, remotePath);

        for (const filename of SYNC_FILES) {
            const localFile = path.join(this.deps.dataDir, filename);
            if (!fs.existsSync(localFile)) continue;

            const localMtime = fs.statSync(localFile).mtimeMs;

            const remoteFile = `${remotePath}/${filename}`;
            let remoteMtime = 0;
            let remoteExists = false;
            try {
                const stat = await client.stat(remoteFile);
                remoteExists = true;
                remoteMtime = new Date(stat.lastmod).getTime();
            } catch (err) {
                if (err.response?.status !== 404) throw err;
            }

            if (!remoteExists) {
                safe.push({ filename, action: 'push' });
                continue;
            }

            const lastSyncTs = lastSyncMap[filename] || 0;
            const localChanged = localMtime > lastSyncTs + MTIME_TOLERANCE_MS;
            const remoteChanged = remoteMtime > lastSyncTs + MTIME_TOLERANCE_MS;

            if (localChanged && remoteChanged) {
                conflicts.push({ filename, localMtime, remoteMtime, lastSync: lastSyncTs });
            } else if (localChanged) {
                safe.push({ filename, action: 'push' });
            } else if (remoteChanged) {
                safe.push({ filename, action: 'pull' });
            }
            // 都没变 → 跳过
        }

        return { conflicts, safe };
    }

    /**
     * 根据用户选择执行同步。
     * resolutions: { 'todos.json': 'local' | 'remote' | 'merge' | 'skip', ... }
     */
    async syncWithResolutions(resolutions) {
        if (this._status.syncing) throw new Error('已有同步任务进行中');
        this._status.syncing = true;
        const result = {
            ok: false,
            pushed: [], pulled: [], merged: [], skipped: [],
            failed: [], at: Date.now()
        };
        try {
            const { client, remotePath } = await this._ensureClient();
            const analysis = await this.analyzeConflicts();

            // 1. 处理无冲突文件
            for (const item of analysis.safe) {
                try {
                    if (item.action === 'push') {
                        const remoteMtime = await this._pushFile(client, remotePath, item.filename);
                        result.pushed.push(item.filename);
                        await this._markSynced(item.filename, remoteMtime);
                    } else if (item.action === 'pull') {
                        await this._pullFile(client, remotePath, item.filename);
                        result.pulled.push(item.filename);
                        // pull 后也要读云端 mtime 作为基准
                        try {
                            const stat = await client.stat(`${remotePath}/${item.filename}`);
                            await this._markSynced(item.filename, new Date(stat.lastmod).getTime());
                        } catch {
                            await this._markSynced(item.filename);
                        }
                    }
                } catch (err) {
                    result.failed.push({ filename: item.filename, error: err.message });
                }
            }

            // 2. 处理冲突文件
            for (const conflict of analysis.conflicts) {
                const choice = (resolutions || {})[conflict.filename];
                try {
                    let remoteMtime = null;
                    if (choice === 'local') {
                        remoteMtime = await this._pushFile(client, remotePath, conflict.filename);
                        result.pushed.push(conflict.filename);
                    } else if (choice === 'remote') {
                        await this._pullFile(client, remotePath, conflict.filename);
                        result.pulled.push(conflict.filename);
                    } else if (choice === 'merge') {
                        remoteMtime = await this._mergeFile(client, remotePath, conflict.filename);
                        result.merged.push(conflict.filename);
                    } else {
                        result.skipped.push(conflict.filename);
                        continue;
                    }
                    if (remoteMtime) {
                        await this._markSynced(conflict.filename, remoteMtime);
                    } else {
                        try {
                            const stat = await client.stat(`${remotePath}/${conflict.filename}`);
                            await this._markSynced(conflict.filename, new Date(stat.lastmod).getTime());
                        } catch {
                            await this._markSynced(conflict.filename);
                        }
                    }
                } catch (err) {
                    result.failed.push({ filename: conflict.filename, error: err.message });
                }
            }

            this._unresolvedConflicts = null;
            result.ok = result.failed.length === 0;
        } catch (err) {
            result.error = err.message;
        } finally {
            this._status.syncing = false;
            this._status.lastResult = result;
            this._status.lastAt = result.at;

            if (result.ok) {
                try {
                    await this.deps.configManager.saveConfigFile({
                        cloud: { lastSyncAt: result.at }
                    });
                } catch (e) { /* ignore */ }
            }
        }
        return result;
    }

    async _pushFile(client, remotePath, filename) {
        const localFile = path.join(this.deps.dataDir, filename);
        const content = fs.readFileSync(localFile, 'utf8');
        const remoteFile = `${remotePath}/${filename}`;
        await client.putFileContents(remoteFile, content, { overwrite: true });
        // ★ 上传后立刻读回服务器 mtime，作为下次比较的基准
        try {
            const stat = await client.stat(remoteFile);
            return new Date(stat.lastmod).getTime();
        } catch {
            return Date.now();
        }
    }

    async _pullFile(client, remotePath, filename) {
        const remoteFile = `${remotePath}/${filename}`;
        const localFile = path.join(this.deps.dataDir, filename);
        const content = await client.getFileContents(remoteFile, { format: 'text' });
        try { JSON.parse(content); } catch {
            throw new Error('远程内容不是合法 JSON');
        }
        if (fs.existsSync(localFile)) {
            const backupDir = path.join(this.deps.dataDir, '.backup');
            if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
            fs.copyFileSync(localFile, path.join(backupDir, filename + '.bak'));
        }
        fs.writeFileSync(localFile, content, 'utf8');
    }

    async _mergeFile(client, remotePath, filename) {
        const localFile = path.join(this.deps.dataDir, filename);
        const remoteFile = `${remotePath}/${filename}`;

        const localObj = JSON.parse(fs.readFileSync(localFile, 'utf8'));
        const remoteRaw = await client.getFileContents(remoteFile, { format: 'text' });
        const remoteObj = JSON.parse(remoteRaw);

        const merged = this._mergeData(filename, localObj, remoteObj);

        const backupDir = path.join(this.deps.dataDir, '.backup');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
        fs.copyFileSync(localFile, path.join(backupDir, filename + '.merge.bak'));

        const mergedStr = JSON.stringify(merged, null, 2);
        fs.writeFileSync(localFile, mergedStr, 'utf8');
        await client.putFileContents(remoteFile, mergedStr, { overwrite: true });
        try {
            const stat = await client.stat(remoteFile);
            return new Date(stat.lastmod).getTime();
        } catch {
            return Date.now();
        }
    }

    _mergeData(filename, localObj, remoteObj) {
        const meta = FILE_KEYS[filename];

        if (meta?.special === 'chatMemory') {
            return this._mergeChatMemory(localObj, remoteObj);
        }

        if (meta?.arrayKey && meta.idField) {
            const localArr = Array.isArray(localObj[meta.arrayKey]) ? localObj[meta.arrayKey] : [];
            const remoteArr = Array.isArray(remoteObj[meta.arrayKey]) ? remoteObj[meta.arrayKey] : [];
            const merged = this._mergeArray(localArr, remoteArr, meta.idField);
            return { ...remoteObj, ...localObj, [meta.arrayKey]: merged };
        }

        // 未知类型：以本地为准
        return localObj;
    }

    _mergeArray(localArr, remoteArr, idField) {
        const map = new Map();
        for (const item of localArr) {
            if (item && item[idField] != null) map.set(item[idField], item);
        }
        for (const item of remoteArr) {
            if (!item || item[idField] == null) continue;
            const existing = map.get(item[idField]);
            if (!existing) {
                map.set(item[idField], item);
            } else {
                const lt = existing.updatedAt || existing.createdAt || 0;
                const rt = item.updatedAt || item.createdAt || 0;
                if (rt > lt) map.set(item[idField], item);
            }
        }
        return Array.from(map.values());
    }

    _mergeChatMemory(localObj, remoteObj) {
        const localArr = Array.isArray(localObj.messages) ? localObj.messages : [];
        const remoteArr = Array.isArray(remoteObj.messages) ? remoteObj.messages : [];
        const seen = new Set();
        const merged = [];
        const all = [...localArr, ...remoteArr];
        all.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        for (const m of all) {
            const key = `${m.role}|${m.timestamp}|${(m.content || '').slice(0, 50)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(m);
        }
        return { messages: merged.slice(-12) };
    }

    async _markSynced(filename, mtime) {
        try {
            await this.deps.configManager.saveConfigFile({
                cloud: { lastSyncPerFile: { [filename]: mtime || Date.now() } }
            });
        } catch (e) {
            console.warn('[CloudSync] mark synced failed:', e.message);
        }
    }

    /** 静默 push（自动同步用）：遇冲突不解决，只处理无冲突文件 */
    async push() {
        try {
            const analysis = await this.analyzeConflicts();
            if (analysis.conflicts.length > 0) {
                this._unresolvedConflicts = analysis.conflicts;
                console.warn('[CloudSync] conflicts detected:', analysis.conflicts.map(c => c.filename));
                if (this._autoPushEnabled) {
                    return { ok: false, conflicts: analysis.conflicts, at: Date.now(), skipped: true };
                }
            }
            const resolutions = {};
            for (const c of analysis.conflicts) resolutions[c.filename] = 'skip';
            return await this.syncWithResolutions(resolutions);
        } catch (err) {
            return { ok: false, error: err.message, at: Date.now() };
        }
    }

    /** 强制 pull：云端覆盖本地 */
    async pull() {
        const result = { ok: false, downloaded: [], failed: [], at: Date.now() };
        try {
            const { client, remotePath } = await this._ensureClient();
            for (const filename of SYNC_FILES) {
                try {
                    const remoteFile = `${remotePath}/${filename}`;
                    if (!(await client.exists(remoteFile))) continue;
                    await this._pullFile(client, remotePath, filename);
                    result.downloaded.push(filename);
                    await this._markSynced(filename);
                } catch (err) {
                    result.failed.push({ filename, error: err.message });
                }
            }
            result.ok = result.failed.length === 0;
        } catch (err) {
            result.error = err.message;
        }
        this._status.lastResult = result;
        this._status.lastAt = result.at;
        return result;
    }

    async testConnection() {
        try {
            const { client, remotePath } = await this._ensureClient();
            const rootExists = await client.exists('/');
            if (!rootExists) return { ok: false, error: '根目录不可访问' };
            await this._ensureRemoteDir(client, remotePath);
            return { ok: true, remotePath };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    async _ensureRemoteDir(client, remotePath) {
        const parts = remotePath.split('/').filter(Boolean);
        let cur = '';
        for (const p of parts) {
            cur += '/' + p;
            if (!(await client.exists(cur))) {
                await client.createDirectory(cur);
            }
        }
    }

    setAutoPush(enabled) {
        this._autoPushEnabled = !!enabled;
        console.log('[CloudSync] auto push:', this._autoPushEnabled ? 'ON' : 'OFF');
    }

    scheduleAutoPush() {
        if (!this._autoPushEnabled) return;
        if (this._autoPushTimer) clearTimeout(this._autoPushTimer);
        this._autoPushTimer = setTimeout(() => {
            this._autoPushTimer = null;
            this._doAutoPush();
        }, 5000);
    }

    async _doAutoPush() {
        if (this._status.syncing) {
            this._pendingPush = true;
            return;
        }
        try {
            const r = await this.push();
            if (r.ok) {
                console.log('[CloudSync] auto push ok, pushed:', r.pushed?.length || 0);
            } else if (r.conflicts) {
                console.warn('[CloudSync] auto push paused due to conflicts');
            }
        } catch (e) {
            console.warn('[CloudSync] auto push error:', e.message);
        }
        if (this._pendingPush) {
            this._pendingPush = false;
            this.scheduleAutoPush();
        }
    }

    async flushPendingPush() {
        if (this._autoPushTimer) {
            clearTimeout(this._autoPushTimer);
            this._autoPushTimer = null;
        }
        if (!this._autoPushEnabled) return;
        if (this._status.syncing) return;
        try {
            await this.push();
            console.log('[CloudSync] flush push on exit');
        } catch (e) {
            console.warn('[CloudSync] flush push failed:', e.message);
        }
    }

    hasPendingPush() {
        return this._autoPushTimer !== null;
    }

    getStatus() {
        return {
            syncing: this._status.syncing,
            lastResult: this._status.lastResult,
            lastAt: this._status.lastAt,
            unresolvedConflicts: this._unresolvedConflicts
        };
    }

    getUnresolvedConflicts() {
        return this._unresolvedConflicts;
    }

    reset() {
        this.client = null;
    }

    /**
     * 清空 lastSyncPerFile 记录，强制下次同步当作"首次同步"。
     * 用于修复因时间戳偏差导致的假冲突。
     */
    async resetSyncState() {
        try {
            await this.deps.configManager.saveConfigFile({
                cloud: { lastSyncAt: 0, lastSyncPerFile: {} }
            });
            this._unresolvedConflicts = null;
            console.log('[CloudSync] sync state reset');
            return true;
        } catch (e) {
            console.warn('[CloudSync] reset sync state failed:', e.message);
            return false;
        }
    }
}

module.exports = { CloudSync, SYNC_FILES };