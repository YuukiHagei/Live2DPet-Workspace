/**
 * PWA AI 聊天
 * 配置存 localStorage，聊天记录也存 localStorage（不参与 Gist 同步）
 */
(function (global) {
    'use strict';

    const CONFIG_KEY = 'live2dpet_pwa_ai_config';
    const HISTORY_KEY = 'live2dpet_pwa_chat_history';
    const MAX_HISTORY = 20;

    function loadAIConfig() {
        try {
            const cfg = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
            if (cfg?.baseURL && cfg?.apiKey && cfg?.modelName) return cfg;
        } catch {}
        return null;
    }

    function saveAIConfig(cfg) {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    }

    function clearAIConfig() {
        localStorage.removeItem(CONFIG_KEY);
    }

    function loadHistory() {
        try {
            const h = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
            return Array.isArray(h) ? h : [];
        } catch { return []; }
    }

    function saveHistory(h) {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-MAX_HISTORY)));
    }

    function clearHistory() {
        localStorage.removeItem(HISTORY_KEY);
    }

    /**
     * 从 Gist characters 里挑第一张非内置角色卡
     * 返回解析后的角色卡对象（data 字段），找不到返回 null
     */
    function pickCharacter(characters) {
        if (!characters) return null;
        for (const [filename, item] of Object.entries(characters)) {
            try {
                const parsed = JSON.parse(item.content);
                if (parsed.builtin) continue;
                return parsed.data || parsed;
            } catch {}
        }
        // 没有非内置卡，退回任意一张
        const first = Object.values(characters)[0];
        if (!first) return null;
        try {
            const parsed = JSON.parse(first.content);
            return parsed.data || parsed;
        } catch { return null; }
    }

    function buildSystemPrompt(character, gistData) {
        const parts = [];

        // 角色设定
        if (character) {
            if (character.description) parts.push(character.description);
            if (character.personality) parts.push(character.personality);
            if (character.scenario) parts.push(character.scenario);
            if (character.rules) parts.push('---\n' + character.rules);
        } else {
            parts.push('你是一个桌面宠物伴侣，回答简短自然。');
        }

        // 当前时间
        const now = new Date();
        const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
        const timeStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${weekdays[now.getDay()]} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        parts.push('---\n【当前时间】现在是 ' + timeStr + '。用户问时间时直接回答，不要说你不知道。');

        // ★ 注入用户画像
        const profileText = buildProfileText(gistData);
        if (profileText) {
            parts.push('---\n【关于用户】\n' + profileText);
        }

        // ★ 注入观察日志
        const obsText = buildObservationText(gistData);
        if (obsText) {
            parts.push('---\n' + obsText);
        }

        // 语言
        if (character?.language) {
            parts.push('用' + character.language + '回答。');
        }

        return parts.join('\n\n');
    }

    /**
     * 从 Gist 数据里读 user-profile.json 并格式化
     */
    function buildProfileText(gistData) {
        const profile = parseGistFile(gistData, 'user-profile.json');
        if (!profile) return '';
        const lines = [];
        if (profile.name) lines.push(`名字：${profile.name}`);
        if (profile.occupation) lines.push(`身份：${profile.occupation}`);
        if (profile.goals?.length) lines.push(`目标：${profile.goals.join('、')}`);
        if (profile.preferences?.length) lines.push(`偏好：${profile.preferences.join('、')}`);
        if (profile.background?.length) lines.push(`背景：${profile.background.join('、')}`);
        return lines.join('\n');
    }

    /**
     * 从 Gist 数据里读 observations.json 并格式化
     */
    function buildObservationText(gistData) {
        const obs = parseGistFile(gistData, 'observations.json');
        if (!obs) return '';

        const parts = [];

        // 常联系的人（top 8）
        const contacts = obs.contacts || {};
        const sorted = Object.entries(contacts)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 8);
        if (sorted.length > 0) {
            const lines = sorted.map(([name, c]) => {
                const daysAgo = Math.floor((Date.now() - c.lastSeen) / 86400000);
                const lastSeenStr = daysAgo === 0 ? '今天' :
                                    daysAgo === 1 ? '昨天' :
                                    daysAgo < 7 ? `${daysAgo} 天前` : '更早';
                let line = `- ${name}（${c.count} 次，最近 ${lastSeenStr}）`;
                if (Array.isArray(c.topics) && c.topics.length > 0) {
                    line += ` 话题：${c.topics.join('、')}`;
                }
                return line;
            });
            parts.push('【常联系的人】\n' + lines.join('\n'));
        }

        // 最近 5 条聊天观察
        const recent = (obs.observations || []).slice(-20).reverse()
            .filter(o => o.contact).slice(0, 5);
        if (recent.length > 0) {
            const lines = recent.map(o => {
                const minsAgo = Math.round((Date.now() - o.time) / 60000);
                const timeStr = minsAgo < 1 ? '刚刚' :
                                minsAgo < 60 ? `${minsAgo} 分钟前` :
                                `${Math.round(minsAgo / 60)} 小时前`;
                return `- ${timeStr}：和 ${o.contact} 聊天`;
            });
            parts.push('【最近聊天】\n' + lines.join('\n'));
        }

        return parts.join('\n\n');
    }

    /**
     * 从 gistData.files 里解析某个文件
     */
    function parseGistFile(gistData, filename) {
        const f = gistData?.files?.[filename];
        if (!f?.content) return null;
        try { return JSON.parse(f.content); } catch { return null; }
    }

    async function callAI(messages, config) {
        const url = config.baseURL.replace(/\/+$/, '') + '/chat/completions';
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + config.apiKey
            },
            body: JSON.stringify({
                model: config.modelName,
                messages,
                max_tokens: 1024,
                temperature: 0.7
            })
        });
        if (!res.ok) {
            let err = 'HTTP ' + res.status;
            try {
                const j = await res.json();
                err += ': ' + (j.error?.message || JSON.stringify(j));
            } catch {}
            throw new Error(err);
        }
        const data = await res.json();
        return data.choices?.[0]?.message?.content || '';
    }

    global.PwaChat = {
        loadAIConfig, saveAIConfig, clearAIConfig,
        loadHistory, saveHistory, clearHistory,
        pickCharacter, buildSystemPrompt, callAI,
        buildProfileText, buildObservationText
    };
})(window);