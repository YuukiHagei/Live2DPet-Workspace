/**
 * Gist API 客户端
 */
(function (global) {
    'use strict';

    const API = 'https://api.github.com/gists';

    async function request(method, path, body, token) {
        const url = path ? `${API}/${path}` : API;
        const opts = {
            method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            }
        };
        if (body) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        const res = await fetch(url, opts);
        if (!res.ok) {
            let msg = `HTTP ${res.status}`;
            try {
                const err = await res.json();
                msg += ': ' + (err.message || JSON.stringify(err));
            } catch (e) { /* ignore */ }
            throw new Error(msg);
        }
        return res.json();
    }

    /**
     * 拉取整个 Gist 里的 live2dpet-data.json
     * 返回 { version, pushedAt, files, characters }
     */
    async function fetchData(gistId, token) {
        const gist = await request('GET', gistId, null, token);
        const gistFiles = gist.files || {};
        const dataFile = gistFiles['live2dpet-data.json'];
        if (!dataFile) {
            throw new Error('Gist 里没有 live2dpet-data.json 文件（先在电脑端上传一次）');
        }

        let content = dataFile.content;
        if (dataFile.truncated && dataFile.raw_url) {
            const res = await fetch(dataFile.raw_url);
            content = await res.text();
        }

        const parsed = JSON.parse(content);
        return {
            version: parsed.version || 1,
            pushedAt: parsed.pushedAt || 0,
            files: parsed.files || {},
            characters: parsed.characters || {}
        };
    }

    /**
     * 测试连接
     */
    async function test(gistId, token) {
        const gist = await request('GET', gistId, null, token);
        return {
            description: gist.description || '(无描述)',
            isPublic: !!gist.public,
            fileCount: Object.keys(gist.files || {}).length
        };
    }

    /**
     * 解析单个文件的 content 字符串为对象
     */
    function parseFile(data, filename) {
        const f = data.files?.[filename];
        if (!f || !f.content) return null;
        try {
            return JSON.parse(f.content);
        } catch {
            return null;
        }
    }

    global.GistAPI = { fetchData, test, parseFile };
})(window);