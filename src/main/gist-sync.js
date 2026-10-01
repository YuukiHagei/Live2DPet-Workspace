/**
 * GistSync — 通过 GitHub Gist 同步数据
 * 架构：一个私有 Gist + 一个 live2dpet-data.json 文件
 */
const fs = require('fs');
const path = require('path');

const SYNC_FILES = [
    'todos.json', 'schedules.json', 'reminders.json', 'flashcards.json',
    'chat-memory.json', 'agent-history.json', 'user-profile.json', 'observations.json',
    'timers.json',
    'companion.json', 'daily-brief.json', 'report-state.json'
];

const FILE_KEYS = {
    'todos.json':      { arrayKey: 'todos',      idField: 'id' },
    'schedules.json':  { arrayKey: 'schedules',  idField: 'id' },
    'reminders.json':  { arrayKey: 'reminders',  idField: 'id' },
    'flashcards.json': { arrayKey: 'flashcards', idField: 'id' },
    'chat-memory.json':{ arrayKey: 'messages',   idField: null, special: 'chatMemory' }
};

const GIST_API = 'https://api.github.com/gists';
const GIST_FILENAME = 'live2dpet-data.json';
const TOLERANCE_MS = 5000;

/**
 * 判断一个 JSON 文件里数组是否为空
 * 返回 'empty' | 'nonempty' | 'unknown'
 */
function arrayFillState(content) {
    if (!content || typeof content !== 'string') return 'unknown';
    try {
        const obj = JSON.parse(content);
        for (const key of ['todos', 'schedules', 'reminders', 'flashcards', 'messages', 'observations']) {
            if (Array.isArray(obj[key])) {
                return obj[key].length === 0 ? 'empty' : 'nonempty';
            }
        }
    } catch {}
    return 'unknown';
}

/**
 * 检测是否危险覆盖（本地空/云端非空 或 本地非空/云端空）
 */
function isDangerousOverwrite(localContent, remoteContent) {
    const ls = arrayFillState(localContent);
    const rs = arrayFillState(remoteContent);
    if (ls === 'empty' && rs === 'nonempty') return 'local-empty';
    if (ls === 'nonempty' && rs === 'empty') return 'remote-empty';
    return null;
}

class GistSync {
    constructor(deps) {
        // deps: { configManager, dataDir, promptsDir }
        this.deps = deps;
        this._status = { lastResult: null, lastAt: 0, syncing: false };
        this._autoPushEnabled = false;
        this._autoPushTimer = null;
        this._pendingPush = false;
        this._unresolvedConflicts = null;
    }

    async _getConfig() {
        const cfg = await this.deps.configManager.loadConfigFile();
        const cloud = cfg.cloud || {};
        if (!cloud.enabled) throw new Error('云同步未启用');
        if (cloud.provider !== 'github-gist') throw new Error('当前 provider 不是 github-gist');
        if (!cloud.gistId) throw new Error('未配置 Gist ID');
        if (!cloud.githubToken) throw new Error('未配置 GitHub Token');
        return cloud;
    }

    async _api(method, urlPath, body) {
        const cloud = await this._getConfig();
        const url = urlPath ? `${GIST_API}/${urlPath}` : GIST_API;
        const opts = {
            method,
            headers: {
                'Authorization': `Bearer ${cloud.githubToken}`,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'Live2DPet-Workspace'
            }
        };
        if (body) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        const res = await fetch(url, opts);
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`GitHub API ${res.status}: ${text.slice(0, 200)}`);
        }
        return res.json();
    }

    /**
     * 拉取云端 Gist 内容。
     * 返回 { version, pushedAt, files, characters }
     */
    async fetchRemote() {
        const cloud = await this._getConfig();
        const gist = await this._api('GET', cloud.gistId);
        const gistFiles = gist.files || {};
        const dataFile = gistFiles[GIST_FILENAME];
        if (!dataFile) {
            return { version: 1, pushedAt: 0, files: {}, characters: {} };
        }
        let content = dataFile.content;
        // Gist 内容可能被截断（>1MB），需要拉 raw_url
        if (dataFile.truncated && dataFile.raw_url) {
            const res = await fetch(dataFile.raw_url);
            content = await res.text();
        }
        try {
            const parsed = JSON.parse(content);
            return {
                version: parsed.version || 1,
                pushedAt: parsed.pushedAt || 0,
                files: parsed.files || {},
                characters: parsed.characters || {}
            };
        } catch {
            return { version: 1, pushedAt: 0, files: {}, characters: {} };
        }
    }

    /**
     * 写回 Gist。
     */
    async writeRemote(data) {
        const cloud = await this._getConfig();
        const content = JSON.stringify(data, null, 2);
        await this._api('PATCH', cloud.gistId, {
            files: { [GIST_FILENAME]: { content } }
        });
    }

    /**
     * 读本地所有数据。
     */
    readLocal() {
        const files = {};
        for (const filename of SYNC_FILES) {
            const fp = path.join(this.deps.dataDir, filename);
            if (!fs.existsSync(fp)) continue;
            files[filename] = {
                content: fs.readFileSync(fp, 'utf8'),
                mtime: fs.statSync(fp).mtimeMs
            };
        }

        const characters = {};
        if (this.deps.promptsDir && fs.existsSync(this.deps.promptsDir)) {
            for (const f of fs.readdirSync(this.deps.promptsDir)) {
                if (!f.endsWith('.json')) continue;
                const fp = path.join(this.deps.promptsDir, f);
                try {
                    const content = fs.readFileSync(fp, 'utf8');
                    const data = JSON.parse(content);
                    // 只同步非内置卡
                    if (!data.builtin) {
                        characters[f] = {
                            content,
                            mtime: fs.statSync(fp).mtimeMs
                        };
                    }
                } catch (e) { /* ignore */ }
            }
        }
        return { files, characters };
    }

    /**
     * 冲突分析。
     */
    async analyzeConflicts() {
        const cloud = await this._getConfig();
        const lastSyncMap = cloud.lastSyncPerFile || {};
        const remote = await this.fetchRemote();
        const local = this.readLocal();

        const conflicts = [];
        const safe = [];

        // 数据文件
        const allNames = new Set([
            ...Object.keys(local.files),
            ...Object.keys(remote.files || {})
        ]);
        for (const name of allNames) {
            const localFile = local.files[name];
            const remoteFile = (remote.files || {})[name];

            if (!localFile && remoteFile) {
                safe.push({ filename: name, action: 'pull' });
                continue;
            }
            if (localFile && !remoteFile) {
                safe.push({ filename: name, action: 'push' });
                continue;
            }

            const lastSyncTs = lastSyncMap[name] || 0;
            const localChanged = localFile.mtime > lastSyncTs + TOLERANCE_MS;
            const remoteChanged = (remoteFile.mtime || 0) > lastSyncTs + TOLERANCE_MS;

            if (localChanged && remoteChanged) {
                conflicts.push({
                    filename: name,
                    localMtime: localFile.mtime,
                    remoteMtime: remoteFile.mtime
                });
            } else if (localChanged) {
                safe.push({ filename: name, action: 'push' });
            } else if (remoteChanged) {
                safe.push({ filename: name, action: 'pull' });
            }
        }

        // 角色卡
        const allChars = new Set([
            ...Object.keys(local.characters),
            ...Object.keys(remote.characters || {})
        ]);
        for (const name of allChars) {
            const localChar = local.characters[name];
            const remoteChar = (remote.characters || {})[name];

            if (!localChar && remoteChar) {
                safe.push({ filename: name, action: 'pull', isCharacter: true });
                continue;
            }
            if (localChar && !remoteChar) {
                safe.push({ filename: name, action: 'push', isCharacter: true });
                continue;
            }

            const key = `char:${name}`;
            const lastSyncTs = lastSyncMap[key] || 0;
            const localChanged = localChar.mtime > lastSyncTs + TOLERANCE_MS;
            const remoteChanged = (remoteChar.mtime || 0) > lastSyncTs + TOLERANCE_MS;

            if (localChanged && remoteChanged) {
                conflicts.push({
                    filename: name,
                    isCharacter: true,
                    localMtime: localChar.mtime,
                    remoteMtime: remoteChar.mtime
                });
            } else if (localChanged) {
                safe.push({ filename: name, action: 'push', isCharacter: true });
            } else if (remoteChanged) {
                safe.push({ filename: name, action: 'pull', isCharacter: true });
            }
        }

        return { conflicts, safe, remote, local };
    }

    /**
     * 执行同步。resolutions: { 'todos.json': 'local'|'remote'|'merge' }
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
            const analysis = await this.analyzeConflicts();
            const remote = analysis.remote;
            const local = analysis.local;

            // 最终要写入 Gist 的数据
            const finalFiles = { ...(remote.files || {}) };
            const finalChars = { ...(remote.characters || {}) };

            // 1. 处理无冲突
            for (const item of analysis.safe) {
                try {
                    if (item.isCharacter) {
                        if (item.action === 'push') {
                            finalChars[item.filename] = {
                                content: local.characters[item.filename].content,
                                mtime: local.characters[item.filename].mtime
                            };
                            result.pushed.push(`char:${item.filename}`);
                        } else if (item.action === 'pull') {
                            this._writeCharacter(item.filename, remote.characters[item.filename].content);
                            result.pulled.push(`char:${item.filename}`);
                        }
                        await this._markSynced(`char:${item.filename}`, Date.now());
                    } else {
                        // ★ 危险覆盖检查
                        const localContent = local.files[item.filename]?.content;
                        const remoteContent = remote.files?.[item.filename]?.content;
                        const danger = isDangerousOverwrite(localContent, remoteContent);
                        if (danger) {
                            console.warn(`[GistSync] Skip ${item.action} ${item.filename}: dangerous (${danger})`);
                            result.skipped.push(item.filename);
                            continue;
                        }

                        if (item.action === 'push') {
                            finalFiles[item.filename] = {
                                content: local.files[item.filename].content,
                                mtime: local.files[item.filename].mtime
                            };
                            result.pushed.push(item.filename);
                        } else if (item.action === 'pull') {
                            this._writeDataFile(item.filename, remote.files[item.filename].content);
                            result.pulled.push(item.filename);
                        }
                        await this._markSynced(item.filename, Date.now());
                    }
                } catch (err) {
                    result.failed.push({ filename: item.filename, error: err.message });
                }
            }

            // 2. 处理冲突
            for (const conflict of analysis.conflicts) {
                const choice = (resolutions || {})[conflict.filename];
                try {
                    const _localContent = conflict.isCharacter
                        ? local.characters[conflict.filename]?.content
                        : local.files[conflict.filename]?.content;
                    const _remoteContent = conflict.isCharacter
                        ? remote.characters?.[conflict.filename]?.content
                        : remote.files?.[conflict.filename]?.content;
                    const _danger = isDangerousOverwrite(_localContent, _remoteContent);
                    if (_danger) {
                        console.warn(`[GistSync] Skip conflict resolution for ${conflict.filename}: dangerous (${_danger})`);
                        result.skipped.push(conflict.filename);
                        continue;
                    }    
                    if (conflict.isCharacter) {
                        if (choice === 'local') {
                            finalChars[conflict.filename] = {
                                content: local.characters[conflict.filename].content,
                                mtime: Date.now()
                            };
                            result.pushed.push(`char:${conflict.filename}`);
                        } else if (choice === 'remote') {
                            this._writeCharacter(conflict.filename, remote.characters[conflict.filename].content);
                            result.pulled.push(`char:${conflict.filename}`);
                        } else {
                            result.skipped.push(`char:${conflict.filename}`);
                            continue;
                        }
                        await this._markSynced(`char:${conflict.filename}`, Date.now());
                    } else {
                        if (choice === 'local') {
                            finalFiles[conflict.filename] = {
                                content: local.files[conflict.filename].content,
                                mtime: Date.now()
                            };
                            result.pushed.push(conflict.filename);
                        } else if (choice === 'remote') {
                            this._writeDataFile(conflict.filename, remote.files[conflict.filename].content);
                            result.pulled.push(conflict.filename);
                        } else if (choice === 'merge') {
                            const merged = this._mergeData(
                                conflict.filename,
                                JSON.parse(local.files[conflict.filename].content),
                                JSON.parse(remote.files[conflict.filename].content)
                            );
                            const mergedStr = JSON.stringify(merged, null, 2);
                            this._writeDataFile(conflict.filename, mergedStr);
                            finalFiles[conflict.filename] = { content: mergedStr, mtime: Date.now() };
                            result.merged.push(conflict.filename);
                        } else {
                            result.skipped.push(conflict.filename);
                            continue;
                        }
                        await this._markSynced(conflict.filename, Date.now());
                    }
                } catch (err) {
                    result.failed.push({ filename: conflict.filename, error: err.message });
                }
            }

            // 3. 写回 Gist
            const payload = {
                version: 1,
                pushedAt: Date.now(),
                files: finalFiles,
                characters: finalChars
            };
            await this.writeRemote(payload);

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

    _writeDataFile(filename, content) {
        const fp = path.join(this.deps.dataDir, filename);
        // 备份
        const backupDir = path.join(this.deps.dataDir, '.backup');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
        if (fs.existsSync(fp)) {
            fs.copyFileSync(fp, path.join(backupDir, filename + '.bak'));
        }
        fs.writeFileSync(fp, content, 'utf8');
    }

    _writeCharacter(filename, content) {
        if (!this.deps.promptsDir) return;
        if (!fs.existsSync(this.deps.promptsDir)) fs.mkdirSync(this.deps.promptsDir, { recursive: true });
        const fp = path.join(this.deps.promptsDir, filename);
        if (fs.existsSync(fp)) {
            const backupDir = path.join(this.deps.promptsDir, '.backup');
            if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
            fs.copyFileSync(fp, path.join(backupDir, filename + '.bak'));
        }
        fs.writeFileSync(fp, content, 'utf8');
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

    async _markSynced(key, ts) {
        try {
            await this.deps.configManager.saveConfigFile({
                cloud: { lastSyncPerFile: { [key]: ts } }
            });
        } catch (e) {
            console.warn('[GistSync] mark synced failed:', e.message);
        }
    }

    // ========== 高层 API ==========

    async push() {
        try {
            const analysis = await this.analyzeConflicts();
            if (analysis.conflicts.length > 0) {
                this._unresolvedConflicts = analysis.conflicts;
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

    async pull() {
        const result = { ok: false, downloaded: [], failed: [], at: Date.now() };
        try {
            const remote = await this.fetchRemote();
            for (const [filename, fileData] of Object.entries(remote.files || {})) {
                try {
                    this._writeDataFile(filename, fileData.content);
                    result.downloaded.push(filename);
                    await this._markSynced(filename, Date.now());
                } catch (err) {
                    result.failed.push({ filename, error: err.message });
                }
            }
            for (const [filename, charData] of Object.entries(remote.characters || {})) {
                try {
                    this._writeCharacter(filename, charData.content);
                    result.downloaded.push(`char:${filename}`);
                    await this._markSynced(`char:${filename}`, Date.now());
                } catch (err) {
                    result.failed.push({ filename: `char:${filename}`, error: err.message });
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
            const cloud = await this._getConfig();
            const gist = await this._api('GET', cloud.gistId);
            return {
                ok: true,
                description: gist.description || '(无描述)',
                isPublic: !!gist.public,
                fileCount: Object.keys(gist.files || {}).length
            };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    async resetSyncState() {
        try {
            await this.deps.configManager.saveConfigFile({
                cloud: { lastSyncAt: 0, lastSyncPerFile: {} }
            });
            this._unresolvedConflicts = null;
            return true;
        } catch (e) {
            return false;
        }
    }

    // ========== 自动 push ==========

    setAutoPush(enabled) {
        this._autoPushEnabled = !!enabled;
        console.log('[GistSync] auto push:', this._autoPushEnabled ? 'ON' : 'OFF');
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
                console.log('[GistSync] auto push ok, pushed:', r.pushed?.length || 0);
            } else if (r.conflicts) {
                console.warn('[GistSync] auto push paused due to conflicts');
            }
        } catch (e) {
            console.warn('[GistSync] auto push error:', e.message);
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
            console.log('[GistSync] flush push on exit');
        } catch (e) {
            console.warn('[GistSync] flush push failed:', e.message);
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
}

module.exports = { GistSync, SYNC_FILES };