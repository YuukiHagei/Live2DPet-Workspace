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

    function buildSystemPrompt(character) {
        if (!character) {
            return '你是一个桌面宠物伴侣，回答简短自然。';
        }
        const parts = [];
        if (character.description) parts.push(character.description);
        if (character.personality) parts.push(character.personality);
        if (character.scenario) parts.push(character.scenario);
        if (character.rules) parts.push('---\n' + character.rules);

        // 当前时间
        const now = new Date();
        const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
        const timeStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${weekdays[now.getDay()]} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        parts.push('---\n【当前时间】现在是 ' + timeStr + '。用户问时间时直接回答。');

        if (character.language) {
            parts.push('用' + character.language + '回答。');
        }
        return parts.join('\n\n');
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
        pickCharacter, buildSystemPrompt, callAI
    };
})(window);