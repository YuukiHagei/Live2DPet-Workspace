/**
 * CloudSync — 坚果云 WebDAV 同步
 * 只同步 data/ 目录下的 JSON 文件，不碰 models/ voicevox_core/ 等大文件
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('webdav');

// 要同步的文件白名单（相对 data/ 目录）
const SYNC_FILES = [
    'todos.json',
    'schedules.json',
    'reminders.json',
    'flashcards.json',
    'chat-memory.json',
    'companion.json',
    'daily-brief.json',
    'report-state.json'
];

class CloudSync {
    constructor(deps) {
        // deps: { configManager, dataDir }
        this.deps = deps;
        this.client = null;
        this._status = { lastResult: null, lastAt: 0, syncing: false };
    }

    /**
     * 根据配置建立 WebDAV 客户端。
     * 配置不完整时返回 null。
     */
    async _ensureClient() {
        const cfg = await this.deps.configManager.loadConfigFile();
        const cloud = cfg.cloud || {};
        if (!cloud.enabled) {
            throw new Error('云同步未启用');
        }
        if (!cloud.webdavUrl || !cloud.username || !cloud.appPassword) {
            throw new Error('云同步配置不完整（URL / 用户名 / 应用密码）');
        }
        if (!this.client) {
            this.client = createClient(cloud.webdavUrl, {
                username: cloud.username,
                password: cloud.appPassword
            });
        }
        return { client: this.client, remotePath: cloud.remotePath || '/Live2DPet' };
    }

    /**
     * 把 data/ 下的白名单文件上传到坚果云。
     */
    async push() {
        if (this._status.syncing) throw new Error('已有同步任务进行中');
        this._status.syncing = true;
        const result = { ok: false, uploaded: [], failed: [], at: Date.now() };
        try {
            const { client, remotePath } = await this._ensureClient();

            // 确保远程目录存在
            await this._ensureRemoteDir(client, remotePath);

            for (const filename of SYNC_FILES) {
                const localFile = path.join(this.deps.dataDir, filename);
                if (!fs.existsSync(localFile)) continue;

                const remoteFile = `${remotePath}/${filename}`;
                try {
                    const content = fs.readFileSync(localFile, 'utf8');
                    await client.putFileContents(remoteFile, content, { overwrite: true });
                    result.uploaded.push(filename);
                } catch (err) {
                    result.failed.push({ filename, error: err.message });
                }
            }
            result.ok = result.failed.length === 0;
            // ★ 成功后写入 config，供 UI 显示"上次同步"
            if (result.ok) {
                try {
                    await this.deps.configManager.saveConfigFile({
                        cloud: { lastSyncAt: result.at }
                    });
                } catch (e) {
                    console.warn('[CloudSync] save lastSyncAt failed:', e.message);
                }
            }
        } catch (err) {
            result.error = err.message;
        } finally {
            this._status.syncing = false;
            this._status.lastResult = result;
            this._status.lastAt = result.at;
        }
        return result;
    }

    /**
     * 从坚果云下载白名单文件，覆盖 data/ 下的本地文件。
     * 覆盖前会备份原文件到 data/.backup/ 目录，以防下载内容损坏。
     */
    async pull() {
        if (this._status.syncing) throw new Error('已有同步任务进行中');
        this._status.syncing = true;
        const result = { ok: false, downloaded: [], failed: [], at: Date.now() };
        try {
            const { client, remotePath } = await this._ensureClient();

            const backupDir = path.join(this.deps.dataDir, '.backup');
            if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

            for (const filename of SYNC_FILES) {
                const remoteFile = `${remotePath}/${filename}`;
                const localFile = path.join(this.deps.dataDir, filename);
                try {
                    if (!(await client.exists(remoteFile))) continue;
                    const content = await client.getFileContents(remoteFile, { format: 'text' });

                    // 校验是合法 JSON，避免把损坏内容写进本地
                    try { JSON.parse(content); } catch {
                        result.failed.push({ filename, error: '远程内容不是合法 JSON' });
                        continue;
                    }

                    // 备份本地文件
                    if (fs.existsSync(localFile)) {
                        fs.copyFileSync(localFile, path.join(backupDir, filename + '.bak'));
                    }
                    fs.writeFileSync(localFile, content, 'utf8');
                    result.downloaded.push(filename);
                } catch (err) {
                    result.failed.push({ filename, error: err.message });
                }
            }
            result.ok = result.failed.length === 0;
        } catch (err) {
            result.error = err.message;
        } finally {
            this._status.syncing = false;
            this._status.lastResult = result;
            this._status.lastAt = result.at;
        }
        return result;
    }

    /**
     * 测试连接（不传输数据）
     */
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

    getStatus() {
        return {
            syncing: this._status.syncing,
            lastResult: this._status.lastResult,
            lastAt: this._status.lastAt
        };
    }

    /**
     * 切换配置后需要重建 client
     */
    reset() {
        this.client = null;
    }
}

module.exports = { CloudSync, SYNC_FILES };