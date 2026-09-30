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
            try { const err = await res.json(); msg += ': ' + (err.message || JSON.stringify(err)); } catch {}
            throw new Error(msg);
        }
        return res.json();
    }

    async function fetchData(gistId, token) {
        const gist = await request('GET', gistId, null, token);
        const gistFiles = gist.files || {};
        const dataFile = gistFiles['live2dpet-data.json'];
        if (!dataFile) throw new Error('Gist 里没有 live2dpet-data.json 文件（先在电脑端上传一次）');

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

    async function writeData(gistId, token, payload) {
        const content = JSON.stringify(payload, null, 2);
        await request('PATCH', gistId, {
            files: { 'live2dpet-data.json': { content } }
        });
    }

    async function test(gistId, token) {
        const gist = await request('GET', gistId, null, token);
        return {
            description: gist.description || '(无描述)',
            isPublic: !!gist.public,
            fileCount: Object.keys(gist.files || {}).length
        };
    }

    function parseFile(data, filename) {
        const f = data.files?.[filename];
        if (!f || !f.content) return null;
        try { return JSON.parse(f.content); } catch { return null; }
    }

    global.GistAPI = { fetchData, writeData, test, parseFile };
})(window);