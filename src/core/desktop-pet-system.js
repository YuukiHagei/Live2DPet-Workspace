/**
 * AgentHistory — 管理 Agent 模式对话历史。
 * 策略：滑动窗口保留最近原文 + 旧消息压缩为摘要。
 */
class AgentHistory {
    static MAX_RECENT = 20;
    static SUMMARY_TRIGGER = 30;

    constructor(aiClient) {
        this.aiClient = aiClient;
        this.summary = '';
        this.recent = [];
        this._summarizing = false;
    }

    async load() {
        try {
            // 1. 优先从 JSON 文件读
            if (window.electronAPI?.agentLoadAgentHistory) {
                const r = await window.electronAPI.agentLoadAgentHistory();
                if (r.success && r.data && (r.data.recent?.length > 0 || r.data.summary)) {
                    this.summary = r.data.summary || '';
                    this.recent = Array.isArray(r.data.recent) ? r.data.recent : [];
                    console.log('[AgentHistory] loaded from file:', this.recent.length, 'recent,', this.summary.length, 'chars summary');
                    return;
                }
            }

            // 2. JSON 为空 → 尝试从 localStorage 迁移（只做一次）
            const migrated = localStorage.getItem('live2dpet_agent_history_migrated');
            if (!migrated) {
                const raw = localStorage.getItem('live2dpet_agent_history');
                if (raw) {
                    try {
                        const data = JSON.parse(raw);
                        this.summary = data.summary || '';
                        this.recent = Array.isArray(data.recent) ? data.recent : [];
                        if (this.recent.length > 0 || this.summary) {
                            if (window.electronAPI?.agentSaveAgentHistory) {
                                await window.electronAPI.agentSaveAgentHistory({
                                    summary: this.summary,
                                    recent: this.recent
                                });
                            }
                            console.log('[AgentHistory] migrated from localStorage:', this.recent.length, 'recent');
                        }
                    } catch (e) {
                        console.warn('[AgentHistory] migration parse failed:', e);
                    }
                }
                localStorage.setItem('live2dpet_agent_history_migrated', '1');
            }

            if (this.recent.length === 0 && !this.summary) {
                console.log('[AgentHistory] empty, starting fresh');
            }
        } catch (e) {
            console.warn('[AgentHistory] load failed:', e);
        }
    }

    save() {
        const payload = { summary: this.summary, recent: this.recent };
        // 持久化到 JSON
        if (window.electronAPI?.agentSaveAgentHistory) {
            window.electronAPI.agentSaveAgentHistory(payload).catch(e => {
                console.warn('[AgentHistory] save failed:', e);
            });
        }
        // 同步到主进程内存，供历史窗口读取
        if (window.electronAPI?.syncAgentHistory) {
            window.electronAPI.syncAgentHistory(payload);
        }
    }

    getMessages() { return [...this.recent]; }
    getSummary() { return this.summary; }

    appendMany(messages) {
        for (const m of messages) this.recent.push(m);
        this.save();
        if (this.recent.length > AgentHistory.SUMMARY_TRIGGER) {
            this._triggerSummary();
        }
    }

    clear() {
        this.summary = '';
        this.recent = [];
        if (window.electronAPI?.agentClearAgentHistory) {
            window.electronAPI.agentClearAgentHistory().catch(() => {});
        }
        if (window.electronAPI?.syncAgentHistory) {
            window.electronAPI.syncAgentHistory({ summary: '', recent: [] });
        }
        console.log('[AgentHistory] cleared');
    }

    _triggerSummary() {
        if (this._summarizing) return;
        if (!this.aiClient?.isConfigured()) return;

        const overflow = this.recent.length - AgentHistory.MAX_RECENT;
        if (overflow <= 0) return;

        const toSummarize = this.recent.slice(0, overflow);
        this.recent = this.recent.slice(overflow);
        this.save();

        this._summarizing = true;
        console.log('[AgentHistory] 触发摘要，压缩', toSummarize.length, '条消息');

        this._generateSummary(toSummarize)
            .then(newSummary => {
                if (newSummary) {
                    this.summary = this.summary ? this.summary + '\n' + newSummary : newSummary;
                    this.save();
                    console.log('[AgentHistory] 摘要已更新，总长', this.summary.length, '字符');
                }
            })
            .catch(err => console.warn('[AgentHistory] 摘要失败:', err.message))
            .finally(() => { this._summarizing = false; });
    }

    async _generateSummary(messages) {
        const lines = [];
        for (const m of messages) {
            if (m.role === 'user') {
                lines.push(`用户：${m.content}`);
            } else if (m.role === 'assistant' && m.content) {
                lines.push(`AI：${m.content}`);
            }
        }
        const text = lines.join('\n');
        if (!text.trim()) return '';

        const prompt = this.summary
            ? `已有摘要：\n${this.summary}\n\n新增对话：\n${text}\n\n请把以上内容合并成一段不超过 300 字的新摘要。保留关键信息（用户身份、目标、偏好、进行中的任务、重要事实），用第三人称陈述。只输出摘要本身，不要任何前缀或解释。`
            : `以下是一段对话：\n${text}\n\n请用不超过 300 字总结关键信息（用户身份、目标、偏好、进行中的任务、重要事实），用第三人称陈述。只输出摘要本身。`;

        const result = await this.aiClient.callAPI([
            { role: 'system', content: '你是一个对话摘要助手。只输出摘要内容，不加任何前缀。' },
            { role: 'user', content: prompt }
        ]);
        return (result || '').trim();
    }
}
/**
 * UserProfile — 用户画像卡片，长期记住关于用户的事实。
 * 每 N 轮对话异步让 AI 更新一次，不打扰用户。
 */
class UserProfile {
    static UPDATE_EVERY = 5;

    constructor(aiClient) {
        this.aiClient = aiClient;
        this.data = { name: '', occupation: '', goals: [], preferences: [], background: [], updatedAt: 0 };
        this._roundsSinceUpdate = 0;
        this._updating = false;
        this._getRecentMessages = () => [];
    }

    async load() {
        try {
            // 1. 优先从 JSON 文件读
            if (window.electronAPI?.agentLoadUserProfile) {
                const r = await window.electronAPI.agentLoadUserProfile();
                if (r.success && r.data && Object.keys(r.data).length > 0) {
                    // 判断是否真有数据（避免全是空字段）
                    const d = r.data;
                    const hasData = d.name || d.occupation
                        || (d.goals?.length) || (d.preferences?.length) || (d.background?.length);
                    if (hasData) {
                        this.data = { ...this.data, ...d };
                        console.log('[UserProfile] loaded from file:', this.getSummaryText().slice(0, 100));
                        return;
                    }
                }
            }

            // 2. JSON 为空 → 尝试从 localStorage 迁移（只做一次）
            const migrated = localStorage.getItem('live2dpet_user_profile_migrated');
            if (!migrated) {
                const raw = localStorage.getItem('live2dpet_user_profile');
                if (raw) {
                    try {
                        const data = JSON.parse(raw);
                        this.data = { ...this.data, ...data };
                        if (window.electronAPI?.agentSaveUserProfile) {
                            await window.electronAPI.agentSaveUserProfile(this.data);
                        }
                        console.log('[UserProfile] migrated from localStorage');
                    } catch (e) { /* ignore */ }
                }
                localStorage.setItem('live2dpet_user_profile_migrated', '1');
            }
        } catch (e) {
            console.warn('[UserProfile] load failed:', e);
        }
    }

    save() {
        if (window.electronAPI?.agentSaveUserProfile) {
            window.electronAPI.agentSaveUserProfile(this.data).catch(e => {
                console.warn('[UserProfile] save failed:', e);
            });
        }
    }

    clear() {
        this.data = { name: '', occupation: '', goals: [], preferences: [], background: [], updatedAt: 0 };
        this._roundsSinceUpdate = 0;
        if (window.electronAPI?.agentClearUserProfile) {
            window.electronAPI.agentClearUserProfile().catch(() => {});
        }
        console.log('[UserProfile] cleared');
    }

    setRecentMessagesGetter(fn) { this._getRecentMessages = fn; }

    isEmpty() {
        const d = this.data;
        return !d.name && !d.occupation &&
               !(d.goals?.length) && !(d.preferences?.length) && !(d.background?.length);
    }

    getSummaryText() {
        const d = this.data;
        const lines = [];
        if (d.name) lines.push(`名字：${d.name}`);
        if (d.occupation) lines.push(`身份：${d.occupation}`);
        if (d.goals?.length) lines.push(`目标：${d.goals.join('、')}`);
        if (d.preferences?.length) lines.push(`偏好：${d.preferences.join('、')}`);
        if (d.background?.length) lines.push(`背景：${d.background.join('、')}`);
        return lines.join('\n');
    }

    tick() {
        this._roundsSinceUpdate++;
        if (this._roundsSinceUpdate >= UserProfile.UPDATE_EVERY) {
            this._triggerUpdate();
        }
    }

    _triggerUpdate() {
        if (this._updating || !this.aiClient?.isConfigured()) return;
        this._updating = true;
        this._roundsSinceUpdate = 0;

        const recent = this._getRecentMessages().slice(-20);
        if (recent.length === 0) { this._updating = false; return; }

        const lines = recent.map(m => `${m.role === 'user' ? '用户' : 'AI'}：${m.content}`).join('\n');
        const current = JSON.stringify(this.data, null, 2);

        const prompt = `你是一个用户信息提取助手。从对话中提取关于用户的**长期稳定信息**，更新到用户画像 JSON。

【现有画像】
${current}

【最近对话】
${lines}

规则：
- 只提取长期有效的信息（名字、身份、目标、偏好、背景），不提取临时的（今天做了什么、当前心情）
- 已有字段有新信息就更新，没提到就保持
- 数组字段最多 5 条
- 输出必须是合法 JSON，不加任何解释，不要 markdown 代码块

输出格式：
{"name":"","occupation":"","goals":[],"preferences":[],"background":[]}`;

        this.aiClient.callAPI([
            { role: 'system', content: '你只输出合法 JSON。' },
            { role: 'user', content: prompt }
        ]).then(result => {
            const parsed = this._parse(result);
            if (parsed) {
                this.data = { ...this.data, ...parsed, updatedAt: Date.now() };
                this.save();
                console.log('[UserProfile] updated:', JSON.stringify(this.data));
            }
        }).catch(err => console.warn('[UserProfile] update failed:', err.message))
          .finally(() => { this._updating = false; });
    }

    _parse(text) {
        if (!text) return null;
        const tryParse = (s) => { try { return this._sanitize(JSON.parse(s)); } catch { return null; } };
        return tryParse(text) || tryParse((text.match(/\{[\s\S]*\}/) || [])[0]);
    }

    _sanitize(obj) {
        if (!obj || typeof obj !== 'object') return null;
        const out = {};
        if (typeof obj.name === 'string') out.name = obj.name.slice(0, 50);
        if (typeof obj.occupation === 'string') out.occupation = obj.occupation.slice(0, 50);
        for (const key of ['goals', 'preferences', 'background']) {
            if (Array.isArray(obj[key])) {
                out[key] = obj[key].filter(s => typeof s === 'string')
                    .map(s => s.slice(0, 80)).slice(0, 5);
            }
        }
        return out;
    }
}
/**
 * ObservationLog — 记录窗口活动，提取联系人，统计关系。
 * 全部本地计算，不调用 AI。
 */
class ObservationLog {
    static MAX_OBSERVATIONS = 50;
    static CONTACT_TOP_N = 8;
    static TOPIC_UPDATE_EVERY = 5;
    static MAX_TOPICS_PER_CONTACT = 8;

    constructor(aiClient) {
        this.aiClient = aiClient || null;
        this.observations = [];
        this.contacts = {};
        this._topicUpdating = false;
        this._contactObsCount = {};
        this._lastTopicCount = {};
    }

    async load() {
        try {
            // 1. 优先从 JSON 文件读
            if (window.electronAPI?.agentLoadObservations) {
                const r = await window.electronAPI.agentLoadObservations();
                if (r.success && r.data) {
                    this.observations = Array.isArray(r.data.observations) ? r.data.observations : [];
                    this.contacts = r.data.contacts && typeof r.data.contacts === 'object' ? r.data.contacts : {};
                    console.log('[Observation] loaded from file:', this.observations.length, 'obs,', Object.keys(this.contacts).length, 'contacts');
                    // 兼容旧数据
                    for (const name in this.contacts) {
                        if (!Array.isArray(this.contacts[name].topics)) {
                            this.contacts[name].topics = [];
                        }
                    }
                    if (this.observations.length > 0 || Object.keys(this.contacts).length > 0) return;
                }
            }

            // 2. JSON 为空 → 尝试从 localStorage 迁移（只做一次）
            const migrated = localStorage.getItem('live2dpet_observations_migrated');
            if (!migrated) {
                const raw = localStorage.getItem('live2dpet_observations');
                if (raw) {
                    try {
                        const data = JSON.parse(raw);
                        this.observations = Array.isArray(data.observations) ? data.observations : [];
                        this.contacts = data.contacts && typeof data.contacts === 'object' ? data.contacts : {};
                        for (const name in this.contacts) {
                            if (!Array.isArray(this.contacts[name].topics)) {
                                this.contacts[name].topics = [];
                            }
                        }
                        if (this.observations.length > 0 || Object.keys(this.contacts).length > 0) {
                            if (window.electronAPI?.agentSaveObservations) {
                                await window.electronAPI.agentSaveObservations({
                                    observations: this.observations,
                                    contacts: this.contacts
                                });
                            }
                            console.log('[Observation] migrated from localStorage');
                        }
                    } catch (e) { /* ignore */ }
                }
                localStorage.setItem('live2dpet_observations_migrated', '1');
            }
        } catch (e) {
            console.warn('[Observation] load failed:', e);
        }
    }

    save() {
        const payload = { observations: this.observations, contacts: this.contacts };
        if (window.electronAPI?.agentSaveObservations) {
            window.electronAPI.agentSaveObservations(payload).catch(e => {
                console.warn('[Observation] save failed:', e);
            });
        }
        if (window.electronAPI?.syncObservation) {
            window.electronAPI.syncObservation(payload);
        }
    }

    clear() {
        this.observations = [];
        this.contacts = {};
        if (window.electronAPI?.agentClearObservations) {
            window.electronAPI.agentClearObservations().catch(() => {});
        }
        if (window.electronAPI?.syncObservation) {
            window.electronAPI.syncObservation({ observations: [], contacts: {} });
        }
        console.log('[Observation] cleared');
    }

    record(appName, windowTitle) {
        if (!windowTitle) return null;
        const contact = this._extractContact(appName, windowTitle);

        this.observations.push({
            time: Date.now(),
            app: appName || '',
            title: windowTitle,
            contact
        });
        if (this.observations.length > ObservationLog.MAX_OBSERVATIONS) {
            this.observations = this.observations.slice(-ObservationLog.MAX_OBSERVATIONS);
        }

        if (contact) {
            this._updateContact(contact, appName);
            if (!this._contactObsCount[contact]) this._contactObsCount[contact] = 0;
            this._contactObsCount[contact]++;
        }
        this.save();
        return contact;
    }

    _extractContact(ownerName, title) {
        if (!title) return null;
        const app = (ownerName || '').toLowerCase();
        const t = title.trim();
        if (!t) return null;
        if (t.length > 30) return null;

        if (app.includes('wechat') || app.includes('weixin')) {
            const mainTitles = ['微信', 'wechat', 'weixin'];
            const skipTitles = [
                '文件传输助手', '订阅号', '新的朋友', '微信团队',
                '微信公众平台', '服务通知', '微信支付', '搜索', '设置',
                '图片和视频', '朋友圈', '看一看', '搜一搜', '收藏',
                '聊天记录', '公众号'
            ];
            const tl = t.toLowerCase();
            if (mainTitles.some(m => tl === m.toLowerCase())) return null;
            if (skipTitles.some(s => t === s)) return null;
            return t.replace(/\s*\(\d+\)\s*$/, '').trim() || null;
        }

        if (app.includes('qq') && !app.includes('qqmusic') && !app.includes('qqbrowser') && !app.includes('qqmail')) {
            const mainTitles = ['qq', '腾讯qq'];
            const skipTitles = ['qq邮箱', '搜索', '设置'];
            const tl = t.toLowerCase();
            if (mainTitles.some(m => tl === m.toLowerCase())) return null;
            if (skipTitles.some(s => t === s)) return null;
            return t.replace(/\s*\(\d+\)\s*$/, '').trim() || null;
        }

        if (app.includes('dingtalk')) {
            if (t === '钉钉' || t === 'DingTalk' || t === '搜索') return null;
            return t.replace(/\s*\(\d+\)\s*$/, '').trim() || null;
        }

        if (app.includes('feishu') || app.includes('lark')) {
            if (t === '飞书' || t === 'Feishu' || t === 'Lark' || t === '搜索') return null;
            return t.replace(/\s*\(\d+\)\s*$/, '').trim() || null;
        }

        if (app.includes('telegram')) {
            if (t.toLowerCase() === 'telegram') return null;
            return t.replace(/\s*\(\d+\)\s*$/, '').trim() || null;
        }

        if (app.includes('discord')) {
            if (t.toLowerCase() === 'discord') return null;
            return t.replace(/\s*\(\d+\)\s*$/, '').trim() || null;
        }

        return null;
    }

    _updateContact(name, appName) {
        const now = Date.now();
        if (!this.contacts[name]) {
            this.contacts[name] = {
                count: 0,
                firstSeen: now,
                lastSeen: now,
                apps: [],
                topics: []
            };
        }
        const c = this.contacts[name];
        c.count++;
        c.lastSeen = now;
        if (appName && !c.apps.includes(appName)) {
            c.apps.push(appName);
        }
    }

    maybeUpdateTopics(contact, screenshotBase64) {
        if (!contact || !screenshotBase64) return;
        if (this._topicUpdating) return;
        if (!this.aiClient?.isConfigured()) return;

        const count = this._contactObsCount[contact] || 0;
        const lastTriggered = this._lastTopicCount[contact] || 0;
        if (count - lastTriggered < ObservationLog.TOPIC_UPDATE_EVERY) return;

        this._lastTopicCount[contact] = count;
        this._doTopicUpdate(contact, screenshotBase64);
    }

    async _doTopicUpdate(contact, screenshotBase64) {
        this._topicUpdating = true;
        const existing = this.contacts[contact]?.topics || [];

        const prompt = `你是话题提取助手。根据截图，提取用户和「${contact}」聊天的话题关键词。

【已有话题】
${existing.length > 0 ? existing.join('、') : '(暂无)'}

【要求】
- 提取 2-5 个最相关的话题标签，每个 2-6 个字
- 用抽象标签（如"论文"、"选题"、"毕设"、"课程"、"生活"），不要具体句子
- 已有话题仍适用的保留，新话题补充
- 如果截图不是聊天内容或看不清，返回 []
- 只输出 JSON 数组，不要任何解释

示例输出：["论文","选题","毕设"]`;

        try {
            const result = await this.aiClient.callAPI([
                { role: 'system', content: '你只输出合法 JSON 数组。' },
                { role: 'user', content: [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + screenshotBase64 } }
                ]}
            ]);

            const parsed = this._parseTopics(result);
            if (parsed && parsed.length > 0) {
                const merged = [...new Set([...existing, ...parsed])]
                    .slice(0, ObservationLog.MAX_TOPICS_PER_CONTACT);
                if (!this.contacts[contact]) this.contacts[contact] = { count: 0, topics: [] };
                this.contacts[contact].topics = merged;
                this.save();
                console.log(`[Observation] topics for "${contact}":`, merged.join('、'));
            }
        } catch (err) {
            console.warn('[Observation] topic update failed:', err.message);
        } finally {
            this._topicUpdating = false;
        }
    }

    _parseTopics(text) {
        if (!text) return null;
        const tryParse = (s) => {
            try {
                const arr = JSON.parse(s);
                if (!Array.isArray(arr)) return null;
                return arr.filter(x => typeof x === 'string' && x.length >= 2 && x.length <= 10)
                    .map(x => x.trim()).slice(0, 5);
            } catch { return null; }
        };
        return tryParse(text) || tryParse((text.match(/\[[\s\S]*\]/) || [])[0]);
    }

    buildPromptBlock() {
        const parts = [];

        const sorted = Object.entries(this.contacts)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, ObservationLog.CONTACT_TOP_N);
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

        const recent = this.observations.slice(-20).reverse()
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

    getContactCount() { return Object.keys(this.contacts).length; }
    getObservationCount() { return this.observations.length; }
}
/**
 * Standalone Desktop Pet System
 * No game engine dependency - runs independently
 */
class DesktopPetSystem {
    constructor() {
        this.isActive = false;
        this.aiClient = null;
        this.promptBuilder = null;
        this.systemPrompt = null;
        this.detectionInterval = null;
        this.detectionIntervalMs = 10000;
        this.lastAppName = null;
        this.isRequesting = false;
        this.emotionSystem = null;

        // Audio state machine + playback tracking
        this.audioStateMachine = null;
        this.currentAudio = null;
        this.currentAudioUrl = null;
        this.currentSession = null;

        // Screenshot: captured on-demand in sendRequest (VLM captures independently)
        this.screenshotTimer = null; // kept for API compat, unused

        // Window focus tracking (1s sampling, cleared after each AI request)
        this.focusTimer = null;
        this.focusTracker = {};

        // Recent discussion pool: timestamped responses + LLM analysis for anti-repetition
        this.recentPool = [];       // [{response, timestamp, analysis}]
        this.recentPoolTTL = 30000; // 30s expiry

        // Message double-buffer: always play the latest, skip stale ones
        this.pendingMessage = null;   // next message to play (overwritten by newer)
        this.isPlayingMessage = false; // lock: currently playing a session
        this.chatGapMs = 5000;        // minimum gap between two message sessions

        // Enhancement orchestrator
        this.enhancer = null;
        this._showLayout = false; // desktop layout in prompt, default off

        // Hit interaction buffer
        this._hitBuffer = [];     // [{area, timestamp, description}]
        this._hitCount = 0;       // session total
        this._agentModeType = 'chat';   // 'chat' | 'agent' | 'plan'
        this.agentHistory = null;
        this._pendingConfirmations = new Map();
        this._pendingPlanApprovals = new Map();
        this.userProfile = null;
        this.observationLog = null;
        this.chatHistory = [];
        this._proactiveEnabled = true;
        this._toolPolicies = {};
    }

    async init() {
        this.aiClient = new AIChatClient();
        await this.aiClient.init();
        this.agentHistory = new AgentHistory(this.aiClient);
        await this.agentHistory.load();
        this.userProfile = new UserProfile(this.aiClient);
        await this.userProfile.load();
        this.userProfile.setRecentMessagesGetter(() => this.chatHistory);
        await this._loadChatMemory();
        this.observationLog = new ObservationLog(this.aiClient);
        await this.observationLog.load();
        this.observationLog.save();   // ★ 把数据同步到主进程，供观察窗口读取
        // 陪伴天数
        this.companionStats = null;
        if (window.electronAPI?.getCompanionStats) {
            try {
                const r = await window.electronAPI.getCompanionStats();
                if (r.success) {
                    this.companionStats = r.stats;
                    console.log('[DesktopPetSystem] 陪伴天数:', r.stats.totalDays, '天');
                }
            } catch {}
        }

        this.promptBuilder = new PetPromptBuilder();
        await this.promptBuilder.init();

        this.systemPrompt = this.promptBuilder.buildSystemPrompt();

        this.emotionSystem = new EmotionSystem(this);
        await this.emotionSystem.loadConfig();

        // Audio state machine
        this.audioStateMachine = new AudioStateMachine();
        await this._initAudioState();

        if (window.electronAPI?.onClearAgentHistory) {
            window.electronAPI.onClearAgentHistory(() => this.clearAgentHistory());
        }

        if (window.electronAPI?.onClearChatMemory) {
            window.electronAPI.onClearChatMemory(() => this.clearChatMemory());
        }
        
        if (window.electronAPI?.onClearObservationData) {
            window.electronAPI.onClearObservationData(() => this.clearObservationData());
        }
        // 主动说话开关
        if (window.electronAPI?.getProactiveState) {
            try {
                const r = await window.electronAPI.getProactiveState();
                this._proactiveEnabled = r.enabled !== false;
                console.log('[DesktopPetSystem] Proactive enabled:', this._proactiveEnabled);
            } catch {}
        }
        if (window.electronAPI?.onProactiveStateChange) {
            window.electronAPI.onProactiveStateChange((enabled) => {
                this._proactiveEnabled = enabled;
                console.log('[DesktopPetSystem] Proactive state changed:', enabled);
            });
        }
        // 工具策略
        if (window.electronAPI?.getToolPolicies) {
            try {
                const r = await window.electronAPI.getToolPolicies();
                if (r.success) this._toolPolicies = r.policies || {};
                console.log('[DesktopPetSystem] Tool policies loaded:', Object.keys(this._toolPolicies).length);
            } catch {}
        }

        // Enhancement orchestrator (only if master toggle enabled)
        if (typeof EnhancementOrchestrator !== 'undefined') {
            try {
                const config = await window.electronAPI.loadConfig();
                if (config.enhance?.enabled) {
                    this.enhancer = new EnhancementOrchestrator(this.aiClient);
                    await this.enhancer.init();
                }
            } catch {}
        }

        // Listen for hit events from pet window
        if (window.electronAPI?.onPetHit) {
            window.electronAPI.onPetHit((data) => this._onHit(data));
        }
        
        // Listen for user messages from chat bubble
        if (window.electronAPI?.onUserMessage) {
            window.electronAPI.onUserMessage((text) => this.handleUserMessage(text));
        }
        // Track chat mode (dialog open/close)
        this._chatMode = false;
        if (window.electronAPI?.onChatModeChange) {
            window.electronAPI.onChatModeChange((isOpen) => {
                this._chatMode = isOpen;
                console.log('[DesktopPetSystem] Chat mode:', isOpen);
            });
        }
        if (window.electronAPI?.onAgentModeChange) {
            window.electronAPI.onAgentModeChange((mode) => {
                if (typeof mode === 'boolean') mode = mode ? 'agent' : 'chat';
                this._agentModeType = mode;
                console.log('[DesktopPetSystem] Agent mode:', mode);
            });
        }

        // 初始模式读取
        if (window.electronAPI?.getAgentMode) {
            try {
                const r = await window.electronAPI.getAgentMode();
                this._agentModeType = r.mode || 'chat';
            } catch {}
        }
        if (window.electronAPI?.onConfirmationResult) {
            window.electronAPI.onConfirmationResult(({ reqId, allow }) => {
                const resolve = this._pendingConfirmations.get(reqId);
                if (resolve) {
                    this._pendingConfirmations.delete(reqId);
                    resolve(allow);
                }
            });
        }
        if (window.electronAPI?.onPlanApprovalResult) {
            window.electronAPI.onPlanApprovalResult(({ reqId, approved }) => {
                const resolve = this._pendingPlanApprovals.get(reqId);
                if (resolve) {
                    this._pendingPlanApprovals.delete(reqId);
                    resolve(approved);
                }
            });
        }
        // 提醒触发
        if (window.electronAPI?.onReminderTriggered) {
            window.electronAPI.onReminderTriggered((r) => {
                console.log('[DesktopPetSystem] Reminder triggered:', r.text);
                const atStr = new Date(r.remindAt).toLocaleString('zh-CN');
                const msg = `⏰ 提醒：${r.text}`;
                this.pendingMessage = { text: msg, isUserReply: false };
                this._processQueue();
            });
        }
        // 每日简报
        if (window.electronAPI?.onDailyBriefTriggered) {
            window.electronAPI.onDailyBriefTriggered((data) => this.handleDailyBrief(data));
        }
        // 周报/月报
        if (window.electronAPI?.onReportTriggered) {
            window.electronAPI.onReportTriggered((data) => this.handleReport(data));
        }
        // 监听倒计时完成
        if (window.electronAPI?.onTimerCompleted) {
            window.electronAPI.onTimerCompleted((timer, pomodoroTransition) => {
                this.handleTimerComplete(timer, pomodoroTransition).catch(e =>
                    console.warn('[Timer] handle failed:', e.message)
                );
            });
        }
        console.log('[DesktopPetSystem] Initialized');
    }

    async _initAudioState() {
        if (!window.electronAPI) return;
        // Load preferred mode from config
        try {
            const config = await window.electronAPI.loadConfig();
            const mode = config.tts?.audioMode || 'tts';
            this.audioStateMachine.setPreferredMode(mode);
        } catch (e) {}
        // Check TTS availability
        if (window.electronAPI.ttsGetStatus) {
            try {
                const status = await window.electronAPI.ttsGetStatus();
                this.audioStateMachine.setTTSAvailable(status.initialized && !status.degraded);
            } catch (e) {}
        }
        // Load default audio clips
        if (window.electronAPI.loadDefaultAudio) {
            try {
                const result = await window.electronAPI.loadDefaultAudio();
                if (result.success && result.files.length > 0) {
                    const clips = result.files.map(f => {
                        const bytes = Uint8Array.from(atob(f.base64), c => c.charCodeAt(0));
                        const blob = new Blob([bytes], { type: 'audio/wav' });
                        return new Audio(URL.createObjectURL(blob));
                    });
                    this.audioStateMachine.setDefaultAudioAvailable(true, clips);
                }
            } catch (e) {}
        }
        console.log('[DesktopPetSystem] Audio mode:', this.audioStateMachine.effectiveMode);
    }

    async start() {
        if (this.isActive) return;
        if (!this.aiClient.isConfigured()) {
            console.warn('[DesktopPetSystem] API not configured');
            if (window.electronAPI) window.electronAPI.showSettings();
            return;
        }

        try {
            const result = await window.electronAPI.createPetWindow({});
            if (result.success) {
                this.isActive = true;
                this.startDetection();
                this.startFocusTimer();
                this.emotionSystem.start();
                console.log('[DesktopPetSystem] Started');

                // ★ 开场消息
                await this._maybeGreet();
            }
        } catch (error) {
            console.error('[DesktopPetSystem] Failed to start:', error);
        }
    }

    /**
     * 播放开场消息（可自定义模板，默认"欢迎回来，{name}"）。
     */
    async _maybeGreet() {
        try {
            const config = await window.electronAPI.loadConfig();
            const startup = config.startup || {};
            if (startup.enabled === false) return;

            // 兼容旧配置：优先用 messages 数组，其次用 messageTemplate
            let templates = [];
            if (Array.isArray(startup.messages) && startup.messages.length > 0) {
                templates = startup.messages.filter(s => typeof s === 'string' && s.trim());
            } else if (startup.messageTemplate) {
                templates = [startup.messageTemplate];
            }
            if (templates.length === 0) return;

            // ★ 随机选一条
            const template = templates[Math.floor(Math.random() * templates.length)].trim();
            if (!template) return;

            // 取用户名字，为空时用"哥哥"
            const name = (this.userProfile?.data?.name || '').trim() || '哥哥';
            const days = this.companionStats?.totalDays || 1;
            const message = template
                .replace(/\{name\}/g, name)
                .replace(/\{days\}/g, String(days));

            // 延迟 2 秒，等宠物窗口完全就绪
            await new Promise(r => setTimeout(r, 2000));

            // 走 MessageSession 流程，正常播放 TTS
            this.pendingMessage = { text: message, isUserReply: false };
            this._processQueue();
            console.log('[DesktopPetSystem] Greet:', message);
        } catch (err) {
            console.warn('[DesktopPetSystem] Greet failed:', err.message);
        }
    }

    async stop() {
        if (!this.isActive) return;
        this.stopDetection();
        this.stopFocusTimer();
        this.stopCurrentAudio();
        this.emotionSystem.stop();
        if (this.enhancer) await this.enhancer.stop();
        try {
            await window.electronAPI.closePetWindow();
        } catch (e) {}
        this.isActive = false;
        this.focusTracker = {};
        this.recentPool = [];
        this._hitBuffer = [];
        this._hitCount = 0;
        this.pendingMessage = null;
        this.isPlayingMessage = false;
        console.log('[DesktopPetSystem] Stopped');
    }

    startDetection() {
        this.stopDetection();
        this.detectionInterval = setInterval(() => this.tick(), this.detectionIntervalMs);
        setTimeout(() => this.tick(), 3000);
        console.log(`[DesktopPetSystem] Detection started, interval: ${this.detectionIntervalMs}ms`);
    }

    stopDetection() {
        if (this.detectionInterval) {
            clearInterval(this.detectionInterval);
            this.detectionInterval = null;
        }
    }

    setInterval(ms) {
        this.detectionIntervalMs = Math.max(10000, ms);
        if (this.isActive) this.startDetection();
    }

    // ========== Focus Tracking (1s) ==========

    startFocusTimer() {
        this.stopFocusTimer();
        this.focusTimer = setInterval(() => this.focusTick(), 1000);
        console.log('[DesktopPetSystem] Focus timer started (1s interval)');
    }

    stopFocusTimer() {
        if (this.focusTimer) {
            clearInterval(this.focusTimer);
            this.focusTimer = null;
        }
    }

    async focusTick() {
        if (!this.isActive) return;
        try {
            const result = await window.electronAPI.getActiveWindow();
            if (!result?.success || !result.data?.owner?.name) return;
            if (this.shouldSkipApp(result.data.owner.name)) return;
            const windowKey = result.data.title || result.data.owner.name;
            if (!this.focusTracker[windowKey]) this.focusTracker[windowKey] = 0;
            this.focusTracker[windowKey] += 1;
            if (this.enhancer) this.enhancer.onFocusTick(windowKey);
        } catch (e) {}
    }

    // ========== Knowledge Layer ==========

    /**
     * i18n helper — delegates to prompt builder's _t()
     */
    _t(key) {
        return this.promptBuilder ? this.promptBuilder._t(key) : key;
    }

    buildDynamicContext() {
        const parts = [];

        // Self-awareness: appearance (know but don't mention)
        parts.push(this._t('sys.selfAwareness'));

        // Window focus tracking summary (top 5) — core focus content
        if (Object.keys(this.focusTracker).length > 0) {
            const secLabel = this._t('sys.seconds');
            const focusEntries = Object.entries(this.focusTracker)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([name, seconds]) => `${this._shortenTitle(name)}: ${seconds}${secLabel}`)
                .join(', ');
            parts.push(this._t('sys.windowUsage') + focusEntries);
        }

        // Anti-repetition: structural pattern detection from recent pool
        this._pruneRecentPool();
        const recentResponses = this.recentPool.map(e => e.response);
        if (recentResponses.length >= 2) {
            const hint = this._detectRepetition(recentResponses.slice(-4));
            if (hint) parts.push(hint);
        }

        // Anti-repetition: semantic topic/habit avoidance from LLM analysis
        const poolContext = this._buildPoolContext();
        if (poolContext) parts.push(poolContext);

        return parts.join('\n');
    }

    /**
     * Detect repeated sentence patterns in recent responses.
     * Returns a hint string if repetition is found, or empty string.
     */
    _detectRepetition(responses) {
        if (responses.length < 2) return '';
        const patterns = [];

        // Check for repeated question marks (rhetorical questions)
        const questionCount = responses.filter(r => r.includes('？') || r.includes('?')).length;
        if (questionCount >= 2) patterns.push(this._t('sys.patternQuestion'));

        // Check for repeated opening words (first 2 chars)
        const openings = responses.map(r => r.slice(0, 2));
        if (openings.length >= 2 && new Set(openings).size === 1) {
            patterns.push(this._t('sys.patternOpening'));
        }

        // Check for repeated sentence-ending patterns (last 4 chars before punctuation)
        const endings = responses.map(r => {
            const clean = r.replace(/[。！？…\s]+$/, '');
            return clean.slice(-4);
        });
        if (endings.length >= 2 && new Set(endings).size === 1) {
            patterns.push(this._t('sys.patternEnding'));
        }

        // Check for similar response length (all within ±20% of mean)
        if (responses.length >= 3) {
            const lengths = responses.map(r => r.length);
            const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
            const allSimilar = mean > 0 && lengths.every(l => Math.abs(l - mean) / mean <= 0.2);
            if (allSimilar) patterns.push(this._t('sys.patternLength'));
        }

        // Check for exclamation overuse
        const exclCount = responses.filter(r => r.includes('！') || r.includes('!')).length;
        if (exclCount >= 3) patterns.push(this._t('sys.patternExclamation'));

        // Check for ellipsis overuse
        const ellipsisCount = responses.filter(r => r.includes('…') || r.includes('...')).length;
        if (ellipsisCount >= 3) patterns.push(this._t('sys.patternEllipsis'));

        if (patterns.length > 0) {
            return this._t('sys.antiRepetition').replace('{0}', patterns.join('、'));
        }
        return '';
    }

    // ========== Main Tick & Request ==========

    async tick() {
        if (!this.isActive || this.isRequesting || !this.aiClient.isConfigured()) return;
        if (this._proactiveEnabled === false) return;   // ★ 主动说话关闭

        try {
            const result = await window.electronAPI.getActiveWindow();
            if (!result?.success || !result.data?.owner?.name) return;

            if (this.shouldSkipApp(result.data.owner.name)) return;

            const windowTitle = result.data.title || result.data.owner.name;
            const ownerName = result.data.owner.name || '';
            const bounds = result.data.bounds;
            this.lastAppName = windowTitle;
            await this.sendRequest(windowTitle, bounds, ownerName);
        } catch (error) {
            console.error('[DesktopPetSystem] Tick error:', error);
        }
    }

    stopCurrentAudio() {
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio = null;
        }
        if (this.currentAudioUrl) {
            URL.revokeObjectURL(this.currentAudioUrl);
            this.currentAudioUrl = null;
        }
    }

    /**
     * Prepare audio for playback (synthesis/loading phase).
     * Returns { play: () => Promise<void>, duration: number } or null.
     */
    async prepareAudio(text) {
        if (!this.audioStateMachine) return null;
        const mode = this.audioStateMachine.effectiveMode;

        if (mode === 'tts' && window.electronAPI?.ttsSynthesize) {
            // ★ VOICEVOX native 在 CPU 模式下对特殊字符极不稳定，必须彻底清洗
            // ★ 长文本（早报/晚报等）：压缩到 25 字，避免翻译成 60+ 字日语后合成崩溃
            //   短文本（日常对话）：保持 40 字
            const MAX_TTS_LEN = text.length > 60 ? 25 : 40;
            let ttsText = text
                // 1. 省略号换成逗号
                .replace(/[…]+/g, '，')
                .replace(/\.{2,}/g, '，')
                // 2. 删除所有引号和括号（中英文都清）
                .replace(/[""'']/g, '')
                .replace(/[「」『』【】《》〈〉\[\]（）()]/g, '')
                // 3. 删除 emoji 和非常规符号（保留中英文数字和基本标点）
                .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
                // 4. 合并连续标点
                .replace(/，{2,}/g, '，')
                .replace(/。{2,}/g, '。')
                .replace(/，。/g, '。')
                .replace(/。，/g, '。')
                // 5. 去掉首尾空白和标点
                .replace(/^[，。、！？\s]+/, '')
                .replace(/[，。、！？\s]+$/, '')
                .trim();

            // ★ 智能截断：优先在标点处切
            if (ttsText.length > MAX_TTS_LEN) {
                let cut = ttsText.slice(0, MAX_TTS_LEN);
                // 找最后一个标点
                const lastPunct = Math.max(
                    cut.lastIndexOf('，'),
                    cut.lastIndexOf('。'),
                    cut.lastIndexOf('、'),
                    cut.lastIndexOf('！'),
                    cut.lastIndexOf('？')
                );
                // 标点在合理位置（超过 60% 处）就在那切
                if (lastPunct > MAX_TTS_LEN * 0.6) {
                    cut = cut.slice(0, lastPunct);
                }
                // 再清理末尾标点和空白
                cut = cut.replace(/[，。、！？\s]+$/, '');
                ttsText = cut;
            }
            if (!ttsText || ttsText.length < 2) return null;   // 太短也跳过

            try {
                const result = await window.electronAPI.ttsSynthesize(ttsText);
                if (!result.success || !result.wav) return null;

                const audio = this._createAudioFromBase64(result.wav);
                // Wait for metadata to get duration
                const duration = await new Promise((resolve, reject) => {
                    audio.addEventListener('loadedmetadata', () => resolve(audio.duration * 1000));
                    audio.addEventListener('error', () => reject(new Error('audio load failed')));
                });

                return {
                    duration,
                    play: () => this._playPreparedAudio(audio)
                };
            } catch (e) {
                console.warn('[TTS] Prepare failed:', e.message);
                return null;
            }
        } else if (mode === 'default-audio') {
            const clip = this.audioStateMachine.getRandomClip();
            if (!clip) return null;
            const audio = clip.cloneNode();
            return {
                duration: 0, // unknown for default clips
                play: () => this._playPreparedAudio(audio)
            };
        }
        return null; // silent
    }

    _createAudioFromBase64(base64) {
        const wavBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const blob = new Blob([wavBytes], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio._objectUrl = url;
        return audio;
    }

    /**
     * Play a prepared Audio element. Returns Promise that resolves when playback ends.
     */
    _playPreparedAudio(audio) {
        this.stopCurrentAudio();
        this.currentAudio = audio;
        this.currentAudioUrl = audio._objectUrl || null;
        return new Promise(resolve => {
            audio.addEventListener('ended', () => { this.stopCurrentAudio(); resolve(); });
            audio.addEventListener('error', () => { this.stopCurrentAudio(); resolve(); });
            audio.play().catch(() => { this.stopCurrentAudio(); resolve(); });
        });
    }

    shouldSkipApp(appName) {
        const skip = ['desktop-pet', 'electron'];
        return skip.some(s => appName.toLowerCase().includes(s));
    }

    /**
     * Shorten a window title for prompt use.
     * Strips common browser/app suffixes and truncates.
     */
    _shortenTitle(title, maxLen = 30) {
        if (!title) return '';
        // Strip trailing " - AppName" patterns (browser suffixes, IDE names, etc.)
        let short = title.replace(/\s*[-–—]\s*(?:Google Chrome|Microsoft\s*Edge|Firefox|Brave|Opera|Safari|Cursor|Visual Studio Code|VSCode|Code)$/i, '');
        if (short.length > maxLen) short = short.slice(0, maxLen) + '…';
        return short;
    }

    // ========== Hit Interaction ==========

    /**
     * Handle interaction event from pet window.
     * @param {{type: string, area: string, durationMs: number, size?: number}} data
     */
    _onHit(data) {
        const now = Date.now();
        this._hitCount++;
        const entry = {
            type: data.type || 'click',
            area: data.area || 'body',
            durationMs: data.durationMs || 0,
            timestamp: now,
            extra: data.size ? { size: data.size } : null
        };
        this._hitBuffer.push(entry);
        while (this._hitBuffer.length > 20) this._hitBuffer.shift();
        console.log(`[DesktopPetSystem] Interaction #${this._hitCount}: ${entry.type} ${entry.area}`);
    }

    /**
     * Build interaction context string for injection into AI prompt.
     * Uses configurable action descriptions from character card hitActions.
     * Format: 过去一分钟里(描述)N次,(描述)N次
     * Clears buffer after reading.
     */
    _buildHitContext() {
        if (this._hitBuffer.length === 0) return '';
        const now = Date.now();
        const recent = this._hitBuffer.filter(h => now - h.timestamp < 60000);
        if (recent.length === 0) {
            this._hitBuffer = [];
            return '';
        }

        // Get configurable descriptions from character card, fallback to i18n defaults
        const ha = this.promptBuilder?.characterPrompt?.hitActions || {};
        const types = ['click', 'touch', 'drag', 'swipe', 'resize'];
        const desc = {};
        for (const type of types) {
            desc[type] = (ha[type] && ha[type].trim()) || this._t(`sys.hitDefault.${type}`);
        }

        // Count by type
        const counts = {};
        for (const h of recent) {
            counts[h.type] = (counts[h.type] || 0) + 1;
        }

        const parts = [];
        for (const type of types) {
            if (counts[type]) {
                parts.push(this._t('sys.hitCount').replace('{0}', desc[type]).replace('{1}', counts[type]));
            }
        }

        if (parts.length === 0) {
            this._hitBuffer = [];
            return '';
        }

        this._hitBuffer = [];
        return '\n' + this._t('sys.hitContext').replace('{0}', parts.join(','));
    }

    // ========== Recent Discussion Pool ==========

    /**
     * Prune expired entries from the recent pool.
     */
    _pruneRecentPool() {
        const now = Date.now();
        this.recentPool = this.recentPool.filter(e => now - e.timestamp < this.recentPoolTTL);
    }

    /**
     * Fire-and-forget: call LLM to extract topics and speech habits from a response.
     */
    async _analyzeResponse(entry) {
        if (!this.aiClient?.isConfigured()) return;
        try {
            const prompt = this._t('sys.analyzePrompt');
            const result = await this.aiClient.callAPI([
                { role: 'system', content: prompt },
                { role: 'user', content: entry.response }
            ]);
            if (result) {
                const parsed = this._parseAnalysis(result);
                if (parsed) {
                    entry.analysis = parsed;
                    console.log('[DesktopPetSystem] Analysis:', JSON.stringify(parsed));
                }
            }
        } catch (e) {
            console.warn('[DesktopPetSystem] Analysis error:', e.message);
        }
    }

    /**
     * Parse JSON analysis from LLM response.
     */
    _parseAnalysis(text) {
        if (!text) return null;
        try {
            const parsed = JSON.parse(text);
            if (parsed.topics || parsed.habits) return parsed;
        } catch {}
        const match = text.match(/\{[\s\S]*?\}/);
        if (match) {
            try {
                const parsed = JSON.parse(match[0]);
                if (parsed.topics || parsed.habits) return parsed;
            } catch {}
        }
        return null;
    }

    /**
     * Build avoidance context from recent pool analyses.
     */
    _buildPoolContext() {
        this._pruneRecentPool();
        const analyses = this.recentPool
            .filter(e => e.analysis)
            .map(e => e.analysis);
        if (analyses.length === 0) return '';

        const parts = [];

        // Collect all topics
        const topics = [...new Set(analyses.flatMap(a => a.topics || []))];
        if (topics.length > 0) {
            parts.push(this._t('sys.topicAvoid').replace('{0}', topics.join('、')));
        }

        // Collect all habits
        const habits = [...new Set(analyses.flatMap(a => a.habits || []))];
        if (habits.length > 0) {
            parts.push(this._t('sys.habitAvoid').replace('{0}', habits.join('、')));
        }

        return parts.join('\n');
    }

    // ========== Message Double-Buffer ==========

    /**
     * Log the full request text (system prompt + history + user message),
     * stripping base64 image data for readability.
     */
    _logRequestText(messages) {
        const lines = messages.map(m => {
            const role = m.role;
            let text;
            if (typeof m.content === 'string') {
                text = m.content;
            } else if (Array.isArray(m.content)) {
                text = m.content
                    .filter(c => c.type === 'text')
                    .map(c => c.text)
                    .join(' ');
                const imgCount = m.content.filter(c => c.type === 'image_url').length;
                if (imgCount > 0) text += ` [+${imgCount} image(s)]`;
            } else {
                text = JSON.stringify(m.content);
            }
            return `[${role}] ${text}`;
        });
        console.log(`[DesktopPetSystem] === Request (${messages.length} messages) ===\n${lines.join('\n')}`);
    }

    async _processQueue() {
        if (this.isPlayingMessage) return;
        this.isPlayingMessage = true;

        while (this.pendingMessage && this.isActive) {
            // pendingMessage 可能是 string（AI 主动）或 { text, isUserReply }（用户对话回复）
            const payload = this.pendingMessage;
            this.pendingMessage = null;
            const text = typeof payload === 'string' ? payload : payload.text;
            const isUserReply = typeof payload === 'object' && payload.isUserReply === true;
            // 对话模式下的主动说话：跳过 TTS，只显示文字
            const skipTTS = (!isUserReply && this._chatMode === true)
                          || (typeof payload === 'object' && payload.skipTTS === true);

            if (this.currentSession) this.currentSession.cancel();
            this.stopCurrentAudio();
            if (this.emotionSystem) this.emotionSystem.forceRevert();

            const session = MessageSession.create(text);
            session.isUserReply = isUserReply;
            session.skipTTS = skipTTS;
            this.currentSession = session;
            await session.run(this);

            // Wait minimum gap before playing next message
            if (this.chatGapMs > 0 && this.pendingMessage) {
                await new Promise(r => setTimeout(r, this.chatGapMs));
            }
        }

        this.isPlayingMessage = false;
    }

    /**
     * 处理周报/月报。
     */
    async handleReport(data) {
        if (!data || !data.type || !data.stats) return;
        console.log('[DesktopPetSystem] Report:', data.type, data.key);

        try {
            const text = data.type === 'weekly'
                ? await this._generateWeeklyReport(data)
                : await this._generateMonthlyReport(data);
            if (!text || !text.trim()) {
                console.warn('[DesktopPetSystem] Report empty');
                return;
            }
            this.pendingMessage = { text: text.trim(), isUserReply: false };
            this._processQueue();
        } catch (err) {
            console.error('[DesktopPetSystem] Report failed:', err.message);
        }
    }

    async _generateWeeklyReport({ key, stats }) {
        const lines = [];
        lines.push(`周期：${key}`);
        lines.push(`待办：本周新建 ${stats.todos.created}，完成 ${stats.todos.completed}，待处理 ${stats.todos.pending}（逾期 ${stats.todos.overdue}）`);
        lines.push(`日程：本周 ${stats.schedules.count} 个`);
        lines.push(`提醒：本周 ${stats.reminders.count} 个`);
        lines.push(`复习：本周新建 ${stats.flashcards.created} 张卡，复习 ${stats.flashcards.reviewCount} 次`);

        const subjects = Object.entries(stats.flashcards.bySubject);
        if (subjects.length > 0) {
            lines.push('按科目：');
            for (const [subj, s] of subjects) {
                lines.push(`  · ${subj}：${s.total} 张，本周复习 ${s.reviews} 次，错题率 ${s.failRate}%，平均 EF ${s.avgEF}`);
            }
        }

        const prompt = `现在是周日晚上，请用你的角色口吻给用户一段简短的周报（100-150 字）。

【本周数据】
${lines.join('\n')}

【要求】
- 亲切自然，像角色本人说话
- 重点：这周完成情况 + 哪个科目需要加强
- 如果有逾期/未完成的，温和提醒，不要责备
- 结尾可以给一点下周的鼓励
- 只输出内容，不要任何前缀`;

        try {
            const rolePrompt = this.promptBuilder.buildSystemPrompt(this.buildDynamicContext());
            const sys = rolePrompt + '\n\n【本次任务】用你的角色口吻播报周报。不要用"主人"或拟声词。';
            return await this.aiClient.callAPI([
                { role: 'system', content: sys },
                { role: 'user', content: prompt }
            ]);
        } catch (e) {
            console.warn('[DesktopPetSystem] WeeklyReport AI failed:', e.message);
            return this._fallbackWeeklyReport(stats);
        }
    }

    async _generateMonthlyReport({ key, stats }) {
        const lines = [];
        lines.push(`周期：${key}`);
        lines.push(`待办：本月新建 ${stats.todos.created}，完成 ${stats.todos.completed}，待处理 ${stats.todos.pending}（逾期 ${stats.todos.overdue}）`);
        lines.push(`日程：本月 ${stats.schedules.count} 个`);
        lines.push(`复习：本月新建 ${stats.flashcards.created} 张卡，复习 ${stats.flashcards.reviewCount} 次`);

        const subjects = Object.entries(stats.flashcards.bySubject);
        if (subjects.length > 0) {
            lines.push('按科目：');
            for (const [subj, s] of subjects) {
                lines.push(`  · ${subj}：${s.total} 张，本月复习 ${s.reviews} 次，错题率 ${s.failRate}%，平均 EF ${s.avgEF}`);
            }
        }

        const prompt = `现在是月末，请用你的角色口吻给用户一段简短的月报（150-200 字）。

【本月数据】
${lines.join('\n')}

【要求】
- 亲切自然，像角色本人说话
- 重点：整体进度 + 各科目掌握情况（根据错题率和 EF 判断）
- 如果有科目错题率高或长期没复习，可以建议改进
- 结尾可以给下个月的鼓励
- 只输出内容，不要任何前缀`;

        try {
            const rolePrompt = this.promptBuilder.buildSystemPrompt(this.buildDynamicContext());
            const sys = rolePrompt + '\n\n【本次任务】用你的角色口吻播报月报。不要用"主人"或拟声词。';
            return await this.aiClient.callAPI([
                { role: 'system', content: sys },
                { role: 'user', content: prompt }
            ]);
        } catch (e) {
            console.warn('[DesktopPetSystem] MonthlyReport AI failed:', e.message);
            return this._fallbackMonthlyReport(stats);
        }
    }

    _fallbackWeeklyReport(stats) {
        const parts = [];
        parts.push(`这周完成了 ${stats.todos.completed} 件待办`);
        if (stats.todos.overdue > 0) parts.push(`${stats.todos.overdue} 件逾期`);
        parts.push(`复习了 ${stats.flashcards.reviewCount} 次`);
        return parts.join('，') + '。下周继续加油！';
    }

    _fallbackMonthlyReport(stats) {
        const parts = [];
        parts.push(`这个月完成了 ${stats.todos.completed} 件待办`);
        parts.push(`复习了 ${stats.flashcards.reviewCount} 次`);
        const subjects = Object.entries(stats.flashcards.bySubject);
        if (subjects.length > 0) {
            const top = subjects.sort((a, b) => b[1].failRate - a[1].failRate)[0];
            if (top[1].failRate > 30) parts.push(`「${top[0]}」错题率偏高，建议加强`);
        }
        return parts.join('，') + '。';
    }

    /**
     * 处理每日简报（早报/晚报）。
     */
    async handleDailyBrief(data) {
        if (!data || !data.type || !data.context) return;
        console.log('[DesktopPetSystem] DailyBrief:', data.type);

        try {
            // 早报需要天气，从主进程再拉一次（含天气）
            let context = data.context;
            if (data.type === 'morning' && !context.weather && window.electronAPI?.briefGetMorningContext) {
                try {
                    const r = await window.electronAPI.briefGetMorningContext();
                    if (r.success && r.context) context = r.context;
                } catch {}
            }

            let text;
            if (data.type === 'morning') {
                text = await this._generateMorningBrief(context);
            } else {
                text = await this._generateEveningBrief(context);
            }

            if (!text || !text.trim()) {
                console.warn('[DesktopPetSystem] DailyBrief empty, skip');
                return;
            }

            this.pendingMessage = { text: text.trim(), isUserReply: false };
            this._processQueue();
        } catch (err) {
            console.error('[DesktopPetSystem] DailyBrief failed:', err.message);
        }
    }

    async _generateMorningBrief(ctx) {
        const lines = [];
        lines.push(`今天是 ${ctx.date} 星期${ctx.weekday}`);

        // ★ 结构化天气
        let weatherBlock = '';
        if (ctx.weather && typeof ctx.weather === 'object') {
            weatherBlock = `\n【天气详情】\n` +
                `- 天气：${ctx.weather.desc}\n` +
                `- 温度：${ctx.weather.tempMin}~${ctx.weather.tempMax}°C\n` +
                `- 紫外线指数：${ctx.weather.uvIndex}`;
        } else if (typeof ctx.weather === 'string' && ctx.weather) {
            weatherBlock = `\n【天气详情】\n${ctx.weather}`;
        }

        if (ctx.schedules.length > 0) {
            lines.push('今日日程：');
            for (const s of ctx.schedules) {
                lines.push(`  · ${s.time} ${s.title}${s.location ? ' @' + s.location : ''}`);
            }
        }
        if (ctx.reminders.length > 0) {
            lines.push('今日提醒：');
            for (const r of ctx.reminders) lines.push(`  · ${r.time} ${r.text}`);
        }
        if (ctx.dueTodos.length > 0) {
            lines.push('今日到期待办：');
            for (const t of ctx.dueTodos) lines.push(`  · ${t.text}`);
        }
        if (ctx.otherTodos.length > 0) {
            lines.push('其他待办：');
            for (const t of ctx.otherTodos) lines.push(`  · ${t.text}`);
        }
        if (lines.length <= 1 && !weatherBlock) lines.push('今天没有特别的安排。');

        const prompt = `现在是早上，请用你的角色口吻给用户一句早报（80-120 字）。

【今日信息】
${lines.join('\n')}
${weatherBlock}

【穿衣建议参考标准】
- 气温 < 5℃：厚羽绒服、围巾手套
- 5~15℃：厚夹克、薄棉衣、毛衣
- 15~22℃：夹克、风衣、薄外套
- 22~27℃：长袖T恤、衬衫
- > 27℃：短袖、薄长裤

【防晒建议参考标准（基于紫外线指数 UV）】
- UV < 3：无需特别防晒
- UV 3~5：建议涂防晒霜、戴太阳镜
- UV 6~7：需要 SPF30+ 防晒霜、帽子，避免正午外出
- UV 8+：必须全面防晒（帽子+墨镜+高倍防晒+避免外出）

【要求】
- 亲切自然，像角色本人说话，不要机械
- 必须包含天气概述，并结合温度给出穿衣建议、结合紫外线给出防晒建议
- 如果有日程/提醒/到期待办，简短提一下最重要的 1 件
- 不要用"早上好"这种机械问候开头
- 天气是重点，其他信息次要
【关于日程时间的说明】
- "全天（进行中）"表示该日程从今天之前就开始了，今天一整天都在进行中
- "XX:XX 起（跨天）"表示该日程从今天 XX:XX 开始，会持续到明天或更晚
- 单纯的 "XX:XX" 表示今天当天开始和结束
- 只输出内容，不要任何前缀或引号`;

        try {
            const rolePrompt = this.promptBuilder.buildSystemPrompt(this.buildDynamicContext());
            const sys = rolePrompt + '\n\n【本次任务】现在是早上，用你的角色口吻向用户发一句简短的早报，关心一下天气和穿着。不要违反角色设定，不要用"主人"或拟声词。';
            return await this.aiClient.callAPI([
                { role: 'system', content: sys },
                { role: 'user', content: prompt }
            ]);
        } catch (e) {
            console.warn('[DesktopPetSystem] MorningBrief AI failed:', e.message);
            return this._fallbackMorningBrief(ctx);
        }
    }

    _fallbackMorningBrief(ctx) {
        const parts = [];

        // ★ 天气优先
        if (ctx.weather && typeof ctx.weather === 'object') {
            const w = ctx.weather;
            parts.push(`今天${w.desc}，${w.tempMin}~${w.tempMax}°C`);

            // 穿衣建议
            let outfit = '';
            if (w.tempMax < 5) outfit = '要穿厚羽绒服，注意保暖';
            else if (w.tempMax < 15) outfit = '厚外套或毛衣合适';
            else if (w.tempMax < 22) outfit = '薄外套就够了';
            else if (w.tempMax < 27) outfit = '长袖T恤正合适';
            else outfit = '短袖为主，注意防暑';
            parts.push(outfit);

            // 防晒建议
            if (w.uvIndex >= 8) parts.push('紫外线很强，务必做好全面防晒');
            else if (w.uvIndex >= 6) parts.push('紫外线较强，记得涂防晒霜、戴帽子');
            else if (w.uvIndex >= 3) parts.push('建议涂点防晒霜');
        }

        if (ctx.schedules.length > 0) {
            const s = ctx.schedules[0];
            parts.push(`另外今天 ${s.time} 有「${s.title}」`);
        } else if (ctx.dueTodos.length > 0) {
            parts.push(`有 ${ctx.dueTodos.length} 件待办今天到期`);
        }

        if (parts.length === 0) return '早，今天没什么特别的安排，慢慢来。';
        return parts.join('，') + '。';
    }

    async _generateEveningBrief(ctx) {
        const lines = [];
        lines.push(`今天是 ${ctx.date} 星期${ctx.weekday}，现在是晚上`);
        if (ctx.completedToday.length > 0) {
            lines.push('今天完成的：');
            for (const t of ctx.completedToday) lines.push(`  ✓ ${t.text}`);
        } else {
            lines.push('今天没有标记完成的待办。');
        }
        if (ctx.dueToday.length > 0) {
            lines.push('今天到期但仍未完成：');
            for (const t of ctx.dueToday) lines.push(`  ⚠ ${t.text}`);
        } else if (ctx.pendingCount > 0) {
            lines.push(`还有 ${ctx.pendingCount} 件待办未完成。`);
        }
        if (ctx.tomorrowSchedules.length > 0) {
            lines.push('明天日程：');
            for (const s of ctx.tomorrowSchedules) lines.push(`  · ${s.time} ${s.title}`);
        }
        if (ctx.tomorrowReminders.length > 0) {
            lines.push('明天提醒：');
            for (const r of ctx.tomorrowReminders) lines.push(`  · ${r.time} ${r.text}`);
        }

        const prompt = `现在是晚上，请用你的角色口吻给用户一句简短的晚间复盘（不超过 70 字）。

【今日信息】
${lines.join('\n')}

要求：
- 亲切自然，像角色本人说话
- 优先提：今天完成 > 未完成 > 明天要做
- 如果今天什么都没完成，温和鼓励，不要责备
- 挑选重要的说，不要照念列表
- 结尾可以有一句关心（比如早点休息）
- 只输出内容，不要任何前缀或引号`;

        try {
            const rolePrompt = this.promptBuilder.buildSystemPrompt(this.buildDynamicContext());
            const sys = rolePrompt + '\n\n【本次任务】现在是晚上，用你的角色口吻向用户发一句简短的晚间复盘和晚安。不要违反角色设定，不要用"主人"或拟声词。';
            return await this.aiClient.callAPI([
                { role: 'system', content: sys },
                { role: 'user', content: prompt }
            ]);
        } catch (e) {
            console.warn('[DesktopPetSystem] EveningBrief AI failed:', e.message);
            return this._fallbackEveningBrief(ctx);
        }
    }

    _fallbackEveningBrief(ctx) {
        const parts = [];
        if (ctx.completedToday.length > 0) parts.push(`完成了 ${ctx.completedToday.length} 件事`);
        if (ctx.pendingCount > 0) parts.push(`还有 ${ctx.pendingCount} 件没完成`);
        if (ctx.tomorrowSchedules.length > 0) parts.push(`明天有 ${ctx.tomorrowSchedules.length} 个日程`);
        if (parts.length === 0) return '今天就这样啦，早点休息。';
        return parts.join('，') + '。早点休息。';
    }

    /**
     * 处理用户主动发来的消息。
     * 与 sendRequest 不同：不截屏、不看窗口，直接用 system prompt + 用户输入调用 AI。
     */
    async handleUserMessage(text) {
        if (!this.aiClient?.isConfigured()) {
            window.electronAPI.showPetChat('AI 还没配置好，请先在设置里填写 API Key', 0);
            return;
        }

        // Agent 模式：走带工具的调用
        if (this._agentModeType === 'agent') {
            return this.handleAgentMessage(text);
        }
        // Plan 模式：先规划，用户确认后执行
        if (this._agentModeType === 'plan') {
            return this.handlePlanMode(text);
        }

        try {
            const dynamicContext = this.buildDynamicContext();
            let currentSystemPrompt = this.promptBuilder.buildSystemPrompt(dynamicContext);

            // ★ 注入用户画像
            if (this.userProfile && !this.userProfile.isEmpty()) {
                currentSystemPrompt += '\n\n【关于用户】\n' + this.userProfile.getSummaryText();
            }

            // ★ 注入观察日志
            if (this.observationLog) {
                const obsBlock = this.observationLog.buildPromptBlock();
                if (obsBlock) currentSystemPrompt += '\n\n' + obsBlock;
            }

            // ★ 注入陪伴天数
            if (this.companionStats) {
                const cs = this.companionStats;
                currentSystemPrompt += `\n\n【陪伴信息】你已经陪伴用户 ${cs.totalDays} 天（自 ${cs.firstMetStr} 起），累计启动 ${cs.totalLaunches} 次。用户问起时可以自然提及，但不要每次都说。`;
            }

            // ★ 构建历史消息，跨天时插入日期标记
            const recent = this.chatHistory.slice(-10);
            const historyMessages = [];
            let lastDate = null;
            for (const m of recent) {
                const ts = m.timestamp || 0;
                const dateKey = this._dateKey(ts);
                // 只在日期变化时插标记，且只有前后都有消息时才插
                if (lastDate !== null && dateKey !== lastDate && dateKey !== 'unknown' && lastDate !== 'unknown') {
                    historyMessages.push({ role: 'system', content: `【${this._formatDate(ts)}】` });
                }
                historyMessages.push({ role: m.role, content: m.content });
                lastDate = dateKey;
            }

            const messages = [
                { role: 'system', content: currentSystemPrompt },
                ...historyMessages,
                { role: 'user', content: text }
            ];

            this._logRequestText(messages);
            const response = await this.aiClient.callAPI(messages);

            if (response) {
                // ★ 存进对话记忆 + 触发画像更新
                this._appendChatMemory('user', text);
                this._appendChatMemory('assistant', response);
                if (this.userProfile) this.userProfile.tick();

                this.pendingMessage = { text: response, isUserReply: true };
                this._processQueue();

                const entry = { response, timestamp: Date.now(), analysis: null };
                this.recentPool.push(entry);
                this._analyzeResponse(entry).catch(() => {});
            }
        } catch (error) {
            console.error('[DesktopPetSystem] handleUserMessage failed:', error);
            window.electronAPI.showPetChat('出错了：' + error.message, 0);
        }
    }
    /**
     * Plan 模式：先让 AI 生成执行计划，用户批准后再执行。
     */
    async handlePlanMode(userText) {
        if (!this.aiClient?.isConfigured()) {
            window.electronAPI.showPetChat('AI 还没配置好，请先在设置里填写 API Key', 0);
            return;
        }

        try {
            window.electronAPI.sendChatStatus('📋', '正在规划...');

            // 1. 生成计划（不带工具，只让 AI 输出步骤）
            const planMessages = [
                {
                    role: 'system',
                    content: '你是一个任务规划助手。针对用户的任务，列出一个清晰的执行计划。\n\n要求：\n- 每条步骤用 "1. 2. 3." 编号\n- 每步说明要做什么，尽量具体\n- 计划最多 5-8 步，简洁明确\n- 只输出计划文本，不要调用任何工具\n- 不要加任何前缀或结尾问候'
                },
                { role: 'user', content: userText }
            ];

            const planText = await this.aiClient.callAPI(planMessages);
            if (!planText || !planText.trim()) {
                window.electronAPI.showPetChat('计划生成失败，请重试', 0);
                return;
            }

            // 2. 显示计划卡片，等用户确认
            const reqId = 'plan-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
            const approved = await this._requestPlanApproval(reqId, planText.trim());

            if (!approved) {
                window.electronAPI.showPetChat('已取消执行', 0);
                console.log('[Plan] User cancelled');
                return;
            }

            console.log('[Plan] Approved, executing...');

            // 3. 批准后走正常 Agent 执行，注入计划
            return this.handleAgentMessage(userText, planText.trim());

        } catch (err) {
            console.error('[Plan] Error:', err);
            window.electronAPI.showPetChat('规划失败：' + err.message, 0);
        }
    }

    /**
     * 请求用户批准计划。返回 Promise<boolean>。
     */
    async _requestPlanApproval(reqId, planText) {
        return new Promise((resolve) => {
            this._pendingPlanApprovals.set(reqId, resolve);
            window.electronAPI.requestPlanApproval(reqId, planText);
            // 10 分钟超时，自动取消
            setTimeout(() => {
                if (this._pendingPlanApprovals.has(reqId)) {
                    this._pendingPlanApprovals.delete(reqId);
                    console.log('[Plan] Approval timeout, auto-cancel');
                    resolve(false);
                }
            }, 10 * 60 * 1000);
        });
    }
    async handleAgentMessage(userText, planText) {
        const builtinTools = [
            {
                type: 'function',
                function: {
                    name: 'read_file',
                    description: '读取指定路径的文件内容（只读，安全）。',
                    parameters: {
                        type: 'object',
                        properties: { path: { type: 'string', description: '文件的绝对路径' } },
                        required: ['path']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'write_file',
                    description: '把内容写入指定文件（会修改磁盘，需要用户确认）。',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: { type: 'string', description: '文件的绝对路径' },
                            content: { type: 'string', description: '要写入的内容' }
                        },
                        required: ['path', 'content']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'list_dir',
                    description: '列出指定目录下的文件（只读，安全）。',
                    parameters: {
                        type: 'object',
                        properties: { path: { type: 'string', description: '目录的绝对路径' } },
                        required: ['path']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'list_dir_tree',
                    description: '递归列出目录树（最多 3 层）。适合快速了解项目结构。',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: { type: 'string', description: '目录绝对路径' },
                            maxDepth: { type: 'number', description: '递归深度，1-3，默认 2' }
                        },
                        required: ['path']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'search_files',
                    description: '按文件名搜索。支持通配符 * 和 ?。例如 "*.js" 或 "test*"。',
                    parameters: {
                        type: 'object',
                        properties: {
                            rootPath: { type: 'string', description: '搜索起始目录' },
                            pattern: { type: 'string', description: '文件名通配符，如 "*.log"' },
                            maxResults: { type: 'number', description: '最多返回几条，默认 50' }
                        },
                        required: ['rootPath', 'pattern']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'grep_text',
                    description: '按内容搜索文本。用正则表达式在文件内容里找匹配的行。',
                    parameters: {
                        type: 'object',
                        properties: {
                            rootPath: { type: 'string', description: '搜索起始目录' },
                            pattern: { type: 'string', description: '正则表达式，如 "TODO|FIXME"' },
                            filePattern: { type: 'string', description: '可选，限定文件名，如 "*.js"' },
                            maxResults: { type: 'number', description: '最多返回几条，默认 30' }
                        },
                        required: ['rootPath', 'pattern']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'open_url',
                    description: '用默认浏览器打开一个 http/https 链接。',
                    parameters: {
                        type: 'object',
                        properties: {
                            url: { type: 'string', description: '要打开的完整 URL' }
                        },
                        required: ['url']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'add_todo',
                    description: '添加待办事项。用户说"提醒我..."、"别忘了..."、"要做..."、"记一下..."时调用。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '待办内容' },
                            dueAt: { type: 'string', description: '截止时间（ISO 格式，如 2026-09-23T15:00:00），可选' },
                            priority: { type: 'string', description: 'low / normal / high，默认 normal' }
                        },
                        required: ['text']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'list_todos',
                    description: '列出待办事项。用户问"我还有什么要做"、"未完成的待办"、"待办列表"时调用。',
                    parameters: {
                        type: 'object',
                        properties: {
                            includeDone: { type: 'boolean', description: '是否包含已完成，默认 false' },
                            limit: { type: 'number', description: '最多返回几条，默认 20' }
                        }
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'complete_todo',
                    description: '标记待办为已完成。用户说"做完了"、"完成了"、"买了"、"搞定了"时调用。',
                    parameters: {
                        type: 'object',
                        properties: {
                            idOrText: { type: 'string', description: '待办的 ID 或文字关键词' }
                        },
                        required: ['idOrText']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'add_schedule',
                    description: '添加日程安排。用户说"X点要..."、"约了..."、"安排..."、"开会"时调用。',
                    parameters: {
                        type: 'object',
                        properties: {
                            title: { type: 'string', description: '日程标题' },
                            startAt: { type: 'string', description: '开始时间（ISO 格式，如 2026-09-23T15:00:00）' },
                            endAt: { type: 'string', description: '结束时间（ISO 格式，可选）' },
                            location: { type: 'string', description: '地点（可选）' },
                            notes: { type: 'string', description: '备注（可选）' }
                        },
                        required: ['title', 'startAt']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'list_schedules',
                    description: '查询日程安排。用户问"今天有什么安排"、"这周忙不忙"、"有什么日程"时调用。',
                    parameters: {
                        type: 'object',
                        properties: {
                            from: { type: 'string', description: '起始时间（ISO 格式，默认今天 0 点）' },
                            to: { type: 'string', description: '结束时间（ISO 格式，默认 7 天后）' }
                        }
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'update_schedule',
                    description: '修改已有日程。用户说"把X改到Y时间"、"X改成..."、"日程改期"时调用。',
                    parameters: {
                        type: 'object',
                        properties: {
                            idOrTitle: { type: 'string', description: '日程 ID 或标题关键词' },
                            title: { type: 'string', description: '新标题（可选）' },
                            startAt: { type: 'string', description: '新开始时间（ISO 格式，可选）' },
                            endAt: { type: 'string', description: '新结束时间（ISO 格式，传空字符串清空，可选）' },
                            location: { type: 'string', description: '新地点（可选）' },
                            notes: { type: 'string', description: '新备注（可选）' }
                        },
                        required: ['idOrTitle']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'delete_schedule',
                    description: '删除日程。用户说"取消X日程"、"删掉X这个安排"时调用。',
                    parameters: {
                        type: 'object',
                        properties: {
                            idOrTitle: { type: 'string', description: '日程 ID 或标题关键词' }
                        },
                        required: ['idOrTitle']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'update_todo',
                    description: '修改已有待办。用户说"把X改成Y"、"截止时间改到..."、"X这条不要了改成..."时调用。',
                    parameters: {
                        type: 'object',
                        properties: {
                            idOrText: { type: 'string', description: '待办 ID 或文字关键词' },
                            text: { type: 'string', description: '新的待办内容（可选）' },
                            dueAt: { type: 'string', description: '新的截止时间（ISO 格式，传空字符串清空，可选）' },
                            priority: { type: 'string', description: 'low / normal / high（可选）' },
                            done: { type: 'boolean', description: 'true 标记完成，false 重新打开（可选）' }
                        },
                        required: ['idOrText']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'delete_todo',
                    description: '真删除待办（不是标记完成）。用户说"删掉X"、"X不用了删了"、"清理掉X"时调用。',
                    parameters: {
                        type: 'object',
                        properties: {
                            idOrText: { type: 'string', description: '待办 ID 或文字关键词' }
                        },
                        required: ['idOrText']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'add_reminder',
                    description: '添加定时提醒。用户说"X点提醒我..."、"X分钟后提醒我..."、"日程结束后提醒我..."时调用。**跟 add_todo 不同**：todo 是"要做的事"，reminder 是"到点提醒"。如果用户说"某日程结束后提醒我"，先 list_schedules 查出该日程的 endAt，再用 endAt 作为 remindAt。',
                    parameters: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '提醒内容' },
                            remindAt: { type: 'string', description: '提醒时间（ISO 格式，如 2026-09-23T20:00:00）' },
                            repeat: { type: 'string', description: 'none / daily / weekly，默认 none' }
                        },
                        required: ['text', 'remindAt']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'list_reminders',
                    description: '列出未触发的提醒。用户问"我设了什么提醒"、"有哪些提醒"时调用。',
                    parameters: {
                        type: 'object',
                        properties: {
                            includeDone: { type: 'boolean', description: '是否包含已完成，默认 false' }
                        }
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'delete_reminder',
                    description: '删除提醒。用户说"取消 X 提醒"、"删掉那个提醒"时调用。',
                    parameters: {
                        type: 'object',
                        properties: {
                            idOrText: { type: 'string', description: '提醒的 ID 或文字关键词' }
                        },
                        required: ['idOrText']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'add_flashcard',
                    description: '添加复习卡片。用户说"把X加卡"、"记一张卡片：X→Y"、"帮我记：X是Y"时调用。',
                    parameters: {
                        type: 'object',
                        properties: {
                            front: { type: 'string', description: '卡片正面（问题/概念）' },
                            back: { type: 'string', description: '卡片背面（答案/解释）' },
                            tags: {
                                type: 'array',
                                items: { type: 'string' },
                                description: '标签数组，如 ["哲学", "康德"]（可选）'
                            },
                            subject: { type: 'string', description: '所属科目，如"西方哲学史"（可选，用于统计）' }
                        },
                        required: ['front', 'back']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'update_flashcard',
                    description: '修改已有复习卡片。用户说"把X这张卡的背面改成..."、"给这张卡加标签..."、"把科目改成..."时调用。',
                    parameters: {
                        type: 'object',
                        properties: {
                            idOrFront: { type: 'string', description: '卡片 ID 或正面文字关键词' },
                            front: { type: 'string', description: '新的正面（可选）' },
                            back: { type: 'string', description: '新的背面（可选）' },
                            tags: {
                                type: 'array',
                                items: { type: 'string' },
                                description: '新标签数组（可选，传空数组清空标签）'
                            },
                            subject: { type: 'string', description: '新科目（可选）' },
                            resetProgress: { type: 'boolean', description: 'true 重置复习进度（可选）' }
                        },
                        required: ['idOrFront']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'list_flashcards',
                    description: '列出复习卡片。用户问"我有哪些卡片"、"看看我的卡片"时调用。',
                    parameters: {
                        type: 'object',
                        properties: {
                            subject: { type: 'string', description: '按科目筛选（可选）' },
                            tag: { type: 'string', description: '按标签筛选（可选）' },
                            limit: { type: 'number', description: '最多返回几条，默认 50' }
                        }
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'get_due_cards',
                    description: '获取待复习的卡片。用户说"开始复习"、"今天要复习什么"时调用。',
                    parameters: {
                        type: 'object',
                        properties: {
                            subject: { type: 'string', description: '按科目筛选（可选）' },
                            limit: { type: 'number', description: '最多返回几条，默认 20' }
                        }
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'review_flashcard',
                    description: '给复习卡片打分，更新下次复习时间。用户复习后说"忘了"、"勉强"、"记得"、"太简单"时调用。',
                    parameters: {
                        type: 'object',
                        properties: {
                            idOrFront: { type: 'string', description: '卡片 ID 或正面文字关键词' },
                            rating: {
                                type: 'string',
                                description: '评分：again(忘了) / hard(勉强) / good(记得) / easy(太简单)'
                            }
                        },
                        required: ['idOrFront', 'rating']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'delete_flashcard',
                    description: '删除复习卡片。用户说"删掉这张卡"、"X这张不要了"时调用。',
                    parameters: {
                        type: 'object',
                        properties: {
                            idOrFront: { type: 'string', description: '卡片 ID 或正面文字关键词' }
                        },
                        required: ['idOrFront']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'get_flashcard_stats',
                    description: '查看卡片统计（总数、待复习数、按科目分布）。用户问"我有多少卡"、"复习进度"时调用。',
                    parameters: { type: 'object', properties: {} }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'add_timer',
                    description: '创建一个倒计时或正计时。用户说"帮我 X 分钟后提醒我..."、"计时 X 分钟"、"倒计时 X 分钟 做某事"、"开始一个正计时叫 学习"时调用。**注意区分**：如果用户说了具体时长就是倒计时（countdown）；如果说"开始计时"没给时长就是正计时（countup）。',
                    parameters: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: '计时器名称，如"泡面"、"专注学习"' },
                            type: { type: 'string', description: 'countdown（倒计时，需给时长）或 countup（正计时），默认 countdown' },
                            durationMinutes: { type: 'number', description: '倒计时时长（分钟），仅 countdown 时必填' },
                            durationSeconds: { type: 'number', description: '倒计时时长的额外秒数（可选，用于 30 秒这种）' },
                            notifyText: { type: 'string', description: '倒计时到点的提醒语（可选，默认"XX到时间了"）' }
                        },
                        required: ['name']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'list_timers',
                    description: '列出当前的倒计时/正计时。用户问"我还有哪些计时"、"我的倒计时"、"现在计时器还剩多久"时调用。',
                    parameters: { type: 'object', properties: {} }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'pause_timer',
                    description: '暂停一个正在运行的计时器。用户说"暂停一下倒计时"、"暂停泡面"时调用。',
                    parameters: {
                        type: 'object',
                        properties: {
                            idOrName: { type: 'string', description: '计时器 ID 或名称关键词' }
                        },
                        required: ['idOrName']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'resume_timer',
                    description: '继续一个已暂停的计时器。用户说"继续倒计时"、"恢复泡面"时调用。',
                    parameters: {
                        type: 'object',
                        properties: {
                            idOrName: { type: 'string', description: '计时器 ID 或名称关键词' }
                        },
                        required: ['idOrName']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'delete_timer',
                    description: '删除一个计时器。用户说"取消倒计时"、"删掉泡面那个计时"时调用。',
                    parameters: {
                        type: 'object',
                        properties: {
                            idOrName: { type: 'string', description: '计时器 ID 或名称关键词' }
                        },
                        required: ['idOrName']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'add_pomodoro',
                    description: '启动一个番茄钟（工作→休息循环）。用户说"开始番茄钟"、"番茄钟 25 分钟"、"专注模式"时调用。',
                    parameters: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: '番茄钟名称，默认"番茄钟"' },
                            workMin: { type: 'number', description: '每轮工作时长（分钟），默认 25' },
                            breakMin: { type: 'number', description: '每轮休息时长（分钟），默认 5' },
                            longBreakMin: { type: 'number', description: '长休息时长（分钟），默认 15' },
                            roundsBeforeLong: { type: 'number', description: '每几轮后长休息，默认 4' },
                            totalRounds: { type: 'number', description: '总共几轮，默认 4' }
                        }
                    }
                }
            }
        ];

        // 拉取 MCP 工具
        let mcpTools = [];
        try {
            const r = await window.electronAPI.mcpListTools();
            if (r.success && Array.isArray(r.tools)) {
                mcpTools = r.tools.map(t => ({
                    type: 'function',
                    function: {
                        name: t.name,
                        description: t.description || '',
                        parameters: t.parameters || { type: 'object', properties: {} }
                    }
                }));
            }
        } catch (err) {
            console.warn('[Agent] Failed to load MCP tools:', err.message);
        }

        const tools = [...builtinTools, ...mcpTools];

        // ★ 从历史构建 system + messages
        const now = new Date();
        const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
        const timeStr = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月${String(now.getDate()).padStart(2, '0')}日 星期${weekdays[now.getDay()]} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        let baseSys = '你是一个能调用工具的智能助手，帮助用户完成任务。回答用中文，简洁直接。';
        baseSys += `\n\n【当前时间】\n现在是 ${timeStr}。你可以直接使用这个时间。用户问"现在几点"、"今天几号"、"星期几"时直接回答，不要说你不知道。`;
        baseSys += '\n\n【关于历史】你的历史工具调用记录可能被摘要压缩，因此你不一定记得每轮具体调用了什么工具。如果用户提到"之前"或"刚才"做过什么，不要轻易否认（例如不要说"我从没执行过搜索"）。不确定时说明"我记不清具体细节，但可以重新执行"，或直接重新执行。';
        if (this.companionStats) {
            baseSys += `\n\n【陪伴信息】你已经陪伴用户 ${this.companionStats.totalDays} 天。`;
        }
        if (planText) {
            baseSys += '\n\n【已批准的执行计划】\n' + planText + '\n\n请严格按照这个计划执行，逐步调用工具完成任务。如果计划中某步无法完成，跳过并继续下一步。';
        }
        const summary = this.agentHistory.getSummary();
        const sysContent = summary
            ? baseSys + '\n\n【历史对话摘要】\n' + summary
            : baseSys;

        const historyMessages = this.agentHistory.getMessages();
        const messages = [
            { role: 'system', content: sysContent },
            ...historyMessages,
            { role: 'user', content: userText }
        ];

        try {
            window.electronAPI.sendChatStatus('🤔', 'Agent 正在思考...');
            console.log('[Agent] history:', historyMessages.length, 'msgs, summary:', summary.length, 'chars');

            let response = await this._callAPIWithTools(messages, tools);

            let round = 0;
            while (response.tool_calls && round < 10) {
                round++;

                // 把整批 tool_calls 记入 assistant 消息
                messages.push({ role: 'assistant', content: null, tool_calls: response.tool_calls });

                // ★ 限制单轮最多执行 5 个工具，防止 AI 一次调太多
                const calls = response.tool_calls.slice(0, 5);
                const skipped = response.tool_calls.slice(5);

                for (const toolCall of calls) {
                    const toolName = toolCall.function.name;
                    let argsPreview = toolCall.function.arguments || '';
                    if (argsPreview.length > 80) argsPreview = argsPreview.slice(0, 80) + '...';
                    window.electronAPI.sendChatStatus('🔧', `调用 ${toolName}：${argsPreview}`);

                    let toolResult;
                    try {
                        const args = JSON.parse(toolCall.function.arguments);
                        const policy = this._getToolPolicy(toolName);

                        if (policy === 'deny') {
                            toolResult = '用户策略禁止调用此工具。请换一种方式或告知用户。';
                        } else if (policy === 'ask') {
                            window.electronAPI.sendChatStatus('⚠️', `等待确认：${toolName}`);
                            const allow = await this._requestConfirmation(toolName, JSON.stringify(args));
                            if (!allow) {
                                toolResult = '用户拒绝了此操作。请不要重试，改问用户想怎么做。';
                            } else {
                                toolResult = await this._executeToolByName(toolName, args);
                            }
                        } else {
                            toolResult = await this._executeToolByName(toolName, args);
                        }
                    } catch (err) {
                        toolResult = '工具执行失败：' + err.message;
                    }

                    const resultPreview = toolResult.length > 60 ? toolResult.slice(0, 60) + '...' : toolResult;
                    const isError = toolResult.startsWith('工具执行失败') || toolResult.startsWith('读文件失败');
                    window.electronAPI.sendChatStatus(
                        isError ? '❌' : '✅',
                        isError ? resultPreview : `完成（${toolResult.length} 字符）：${resultPreview}`
                    );

                    // ★ 每个 tool_call 都推一条 tool 响应
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: toolResult
                    });
                }

                // 超出限制的 tool_call 也要补一条响应，否则 API 会报错
                for (const toolCall of skipped) {
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: '本轮工具调用过多，跳过未执行。请下一轮再试。'
                    });
                }

                response = await this._callAPIWithTools(messages, tools);
            }
            // 如果达到 round 上限还有 tool_calls，清空它避免误判
            if (response.tool_calls && round >= 10) {
                console.warn('[Agent] Reached max rounds with pending tool_calls');
                response.tool_calls = null;
            }
            // ★ 检测空响应：如果 content 为空，说明 API 返回了异常
            let finalText = (response.content || '').trim();
            if (!finalText) {
                console.warn('[Agent] Empty response, retrying without tools...');
                try {
                    // 再调一次，不带 tools，强制 AI 用文本总结
                    messages.push({
                        role: 'user',
                        content: '请基于以上工具调用结果，用简洁的文字给出最终答复。不要再调用工具。'
                    });
                    const retryResp = await this._callAPIWithTools(messages, []);
                    finalText = (retryResp.content || '').trim();
                } catch (e) {
                    console.warn('[Agent] Retry failed:', e.message);
                }
            }
            if (!finalText) finalText = '(工具已执行，但 AI 未生成最终回复)';

            this.pendingMessage = { text: finalText, isUserReply: true, skipTTS: true };
            this._processQueue();

            // ★ 只把 user + 最终 assistant 存进历史
            this.agentHistory.appendMany([
                { role: 'user', content: userText },
                { role: 'assistant', content: finalText }
            ]);
        } catch (err) {
            console.error('[Agent] Error:', err);
            window.electronAPI.showPetChat('Agent 出错：' + err.message, 0);
        }
    }
    
    /**
     * 番茄钟阶段切换 / 结束
     */
    async _handlePomodoroPhase(timer, transition) {
        const p = timer.pomodoro;
        const isPaused = timer.state === 'paused';

        // === 情况 A：阶段刚结束（自动切换） ===
        if (transition && !transition.finished) {
            const prev = transition.prevPhase;
            const next = p.phase;

            let text;
            if (prev === 'work' && next === 'break') {
                text = `第 ${p.currentRound} 轮工作完成，休息 ${p.breakMin} 分钟吧`;
            } else if (prev === 'work' && next === 'longBreak') {
                text = `第 ${p.completedWorkRounds} 轮工作完成，长休息 ${p.longBreakMin} 分钟`;
            } else if (prev === 'break') {
                text = `休息结束，开始第 ${p.currentRound} 轮工作`;
            } else if (prev === 'longBreak') {
                text = `长休息结束，开始第 ${p.currentRound} 轮工作`;
            } else {
                text = `番茄钟继续：第 ${p.currentRound} 轮`;
            }

            this.pendingMessage = { text, isUserReply: false };
            this._processQueue();
            return;
        }

        // === 情况 B：整个番茄钟完成（自然走完最后一轮） ===
        if (transition && transition.finished) {
            const totalMin = p.completedWorkRounds * p.workMin;
            const text = `🍅 番茄钟完成！共 ${p.completedWorkRounds} 轮，累计专注 ${totalMin} 分钟`;
            this.pendingMessage = { text, isUserReply: false };
            this._processQueue();
            await this._writePomodoroSummary(timer);
            return;
        }

        // === 情况 C：用户手动停止（无 transition） ===
        const completedRounds = p.phase === 'work'
            ? (p.completedWorkRounds || 0)
            : (p.completedWorkRounds || 0);
        if (completedRounds > 0) {
            const totalMin = completedRounds * p.workMin;
            const text = `🍅 番茄钟已结束，完成 ${completedRounds} 轮，累计专注 ${totalMin} 分钟`;
            this.pendingMessage = { text, isUserReply: false };
            this._processQueue();
            await this._writePomodoroSummary(timer);
        } else {
            // 一轮都没完成，不写日程不播报
            console.log('[Pomodoro] Stopped before completing any round, no summary');
        }
    }

    /**
     * 写番茄钟总结日程
     */
    async _writePomodoroSummary(timer) {
        const p = timer.pomodoro;
        const rounds = p.completedWorkRounds || 0;
        if (rounds === 0) return;

        try {
            const startAt = timer.startedAt;
            const endAt = timer.completedAt || Date.now();
            await window.electronAPI.agentAddSchedule({
                title: `🍅 番茄钟 - ${rounds} 轮`,
                startAt,
                endAt,
                location: '',
                notes: `工作 ${p.workMin} 分 × ${rounds} 轮，休息 ${p.breakMin} 分 / 长休息 ${p.longBreakMin} 分`
            });
            console.log('[Pomodoro] Summary written:', rounds, 'rounds');
        } catch (e) {
            console.warn('[Pomodoro] write summary failed:', e.message);
        }
    }
    
    /**
     * 倒计时完成：播报 + 写日程
     */
    /**
     * 计时完成：播报 + 写日程
     * 倒计时 → 用用户自定义提醒语（或默认"到时间了"）
     * 正计时 → 自动生成"任务结束，本次共用时 X"总结
     */
    async handleTimerComplete(timer, pomodoroTransition) {
        if (!timer) return;
        console.log('[DesktopPetSystem] Timer completed:', timer.name, timer.type,
            pomodoroTransition ? 'pomodoro-transition' : '');

        // ★ 番茄钟单独处理
        if (timer.pomodoroMode && timer.pomodoro) {
            return this._handlePomodoroPhase(timer, pomodoroTransition);
        }

        // 1. 生成播报文本
        let notifyText;
        if (timer.type === 'countup') {
            // stopTimer 已把全部用时固定到 elapsedBeforePause
            const elapsed = timer.elapsedBeforePause || 0;
            const duration = this._fmtDuration(elapsed);
            notifyText = `「${timer.name}」任务结束，本次共用时 ${duration}`;
        } else {
            notifyText = (timer.notifyText || '').trim() || `「${timer.name}」到时间了`;
        }

        this.pendingMessage = { text: notifyText, isUserReply: false };
        this._processQueue();

        // 2. 写入日程
        if (timer.writeToCalendar !== false) {
            try {
                const startAt = timer.startedAt;
                const endAt = timer.completedAt || Date.now();
                await window.electronAPI.agentAddSchedule({
                    title: timer.name,
                    startAt,
                    endAt,
                    location: '',
                    notes: timer.type === 'countdown' ? '由倒计时生成' : '由正计时生成'
                });
                console.log('[DesktopPetSystem] Timer 写入日程:', timer.name);
            } catch (e) {
                console.warn('[DesktopPetSystem] Timer 写日程失败:', e.message);
            }
        }
    }

    /**
     * 格式化时长（毫秒 → 中文描述）
     */
    _fmtDuration(ms) {
        const totalSec = Math.round(ms / 1000);
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        if (h > 0) return `${h} 小时 ${m} 分`;
        if (m > 0) return `${m} 分 ${s} 秒`;
        return `${s} 秒`;
    }


    clearAgentHistory() {
        if (this.agentHistory) this.agentHistory.clear();
    }

    clearChatMemory() {
        this.chatHistory = [];
        if (window.electronAPI?.agentClearChatMemory) {
            window.electronAPI.agentClearChatMemory().catch(() => {});
        }
        if (this.userProfile) this.userProfile.clear();
        console.log('[ChatMemory] cleared (chat + profile)');
    }

    clearObservationData() {
        if (this.observationLog) this.observationLog.clear();
        console.log('[Observation] cleared (observations + contacts)');
    }

    async refreshToolPolicies() {
        if (!window.electronAPI?.getToolPolicies) return;
        try {
            const r = await window.electronAPI.getToolPolicies();
            if (r.success) this._toolPolicies = r.policies || {};
        } catch {}
    }

    // ========== 普通对话记忆（方案 B） ==========

    async _loadChatMemory() {
        try {
            // 1. 优先从 JSON 文件读
            if (window.electronAPI?.agentLoadChatMemory) {
                const r = await window.electronAPI.agentLoadChatMemory();
                if (r.success && Array.isArray(r.messages) && r.messages.length > 0) {
                    this.chatHistory = r.messages.map(m => ({
                        role: m.role,
                        content: m.content,
                        timestamp: m.timestamp || 0
                    }));
                    console.log('[ChatMemory] loaded from file:', this.chatHistory.length, 'messages');
                    return;
                }
            }

            // 2. JSON 为空 → 尝试从 localStorage 迁移（只做一次）
            const migrated = localStorage.getItem('live2dpet_chat_memory_migrated');
            if (!migrated) {
                const raw = localStorage.getItem('live2dpet_chat_memory');
                if (raw) {
                    try {
                        const arr = JSON.parse(raw);
                        if (Array.isArray(arr) && arr.length > 0) {
                            this.chatHistory = arr.map(m => ({
                                role: m.role,
                                content: m.content,
                                timestamp: m.timestamp || 0
                            }));
                            // 写入 JSON 文件
                            if (window.electronAPI?.agentSaveChatMemory) {
                                await window.electronAPI.agentSaveChatMemory(this.chatHistory);
                            }
                            console.log('[ChatMemory] migrated from localStorage:', this.chatHistory.length, 'messages');
                        }
                    } catch (e) {
                        console.warn('[ChatMemory] migration parse failed:', e);
                    }
                }
                // 打标记，下次不再尝试迁移（避免每次启动都扫 localStorage）
                localStorage.setItem('live2dpet_chat_memory_migrated', '1');
            }

            if (this.chatHistory.length === 0) {
                console.log('[ChatMemory] empty, starting fresh');
            }
        } catch (e) {
            console.warn('[ChatMemory] load failed:', e);
            this.chatHistory = [];
        }
    }

    _saveChatMemory() {
        if (window.electronAPI?.agentSaveChatMemory) {
            // Fire and forget，失败只记日志，不阻塞调用方
            window.electronAPI.agentSaveChatMemory(this.chatHistory).catch(e => {
                console.warn('[ChatMemory] save failed:', e);
            });
        }
    }

    _appendChatMemory(role, content) {
        this.chatHistory.push({ role, content, timestamp: Date.now() });
        const MAX = 12;
        if (this.chatHistory.length > MAX) {
            this.chatHistory = this.chatHistory.slice(-MAX);
        }
        this._saveChatMemory();
    }
    
    _dateKey(ts) {
        if (!ts) return 'unknown';
        const d = new Date(ts);
        return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    }

    _formatDate(ts) {
        const d = new Date(ts);
        const now = new Date();
        const isToday = this._dateKey(ts) === this._dateKey(now.getTime());
        const y = new Date(now.getTime() - 86400000);
        const isYesterday = this._dateKey(ts) === this._dateKey(y.getTime());
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        if (isToday) return `今天 ${hh}:${mm}`;
        if (isYesterday) return `昨天 ${hh}:${mm}`;
        return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
    }
    /**
     * 检查工具策略。
     * 返回 'allow' / 'ask' / 'deny'
     */
    _getToolPolicy(toolName) {
        const p = this._toolPolicies[toolName];
        if (p === 'allow' || p === 'ask' || p === 'deny') return p;
        // 待办/日程类本地工具默认允许，避免每次都弹确认
        const localTools = ['add_todo', 'list_todos', 'complete_todo', 'update_todo', 'delete_todo', 'add_schedule', 'list_schedules', 'update_schedule', 'delete_schedule', 'add_reminder', 'list_reminders', 'delete_reminder', 'add_flashcard', 'update_flashcard', 'list_flashcards', 'get_due_cards', 'review_flashcard', 'delete_flashcard', 'get_flashcard_stats', 'add_timer', 'list_timers', 'pause_timer', 'resume_timer', 'delete_timer', 'add_pomodoro'];
        if (localTools.includes(toolName)) return 'allow';
        return 'ask';
    }
    /**
     * 按工具名执行。
     */
    async _executeToolByName(name, args) {
        const builtinNames = ['read_file', 'write_file', 'list_dir', 'list_dir_tree', 'search_files', 'grep_text', 'open_url', 'add_todo', 'list_todos', 'complete_todo', 'update_todo', 'delete_todo', 'add_schedule', 'list_schedules', 'update_schedule', 'delete_schedule', 'add_reminder', 'list_reminders', 'delete_reminder', 'add_flashcard', 'update_flashcard', 'list_flashcards', 'get_due_cards', 'review_flashcard', 'delete_flashcard', 'get_flashcard_stats', 'add_timer', 'list_timers', 'pause_timer', 'resume_timer', 'delete_timer'];

        if (name === 'read_file') {
            const r = await window.electronAPI.readFile(args.path);
            return r.success ? r.content : ('读文件失败：' + r.error);
        }
        if (name === 'list_dir') {
            const r = await window.electronAPI.listDir(args.path);
            return r.success ? r.content : ('列目录失败：' + r.error);
        }
        if (name === 'list_dir_tree') {
            const r = await window.electronAPI.listDirTree(args.path, args.maxDepth || 2);
            return r.success ? r.content : ('列目录树失败：' + r.error);
        }
        if (name === 'search_files') {
            const r = await window.electronAPI.searchFiles(args.rootPath, args.pattern, args.maxResults || 50);
            return r.success ? r.content : ('搜索失败：' + r.error);
        }
        if (name === 'grep_text') {
            const r = await window.electronAPI.grepText(args.rootPath, args.pattern, args.filePattern || '', args.maxResults || 30);
            return r.success ? r.content : ('内容搜索失败：' + r.error);
        }
        if (name === 'open_url') {
            const r = await window.electronAPI.openUrl(args.url);
            return r.success ? '已打开链接' : ('打开失败：' + r.error);
        }
        if (name === 'write_file') {
            const r = await window.electronAPI.writeFile(args.path, args.content);
            return r.success ? '写入成功' : ('写入失败：' + r.error);
        }
        if (!builtinNames.includes(name)) {
            window.electronAPI.sendChatStatus('🔧', `MCP 工具：${name}`);
            const r = await window.electronAPI.mcpCallTool(name, args);
            if (r.success) {
                return typeof r.result === 'string' ? r.result : JSON.stringify(r.result);
            } else {
                return 'MCP 工具执行失败：' + r.error;
            }
        }
        // ========== 待办 / 日程 ==========
        if (name === 'add_todo') {
            const r = await window.electronAPI.agentAddTodo(args);
            if (!r.success) return '添加待办失败：' + r.error;
            return `已添加待办：${r.todo.text}（ID: ${r.todo.id}）`;
        }
        if (name === 'list_todos') {
            const r = await window.electronAPI.agentListTodos(args);
            if (!r.success) return '查询待办失败：' + r.error;
            if (r.todos.length === 0) return '暂无待办';
            const lines = r.todos.map(t => {
                const dueStr = t.dueAt ? ` (截止 ${new Date(t.dueAt).toLocaleString('zh-CN')})` : '';
                const doneStr = t.done ? '✅' : '⬜';
                return `${doneStr} ${t.text}${dueStr}`;
            });
            return lines.join('\n');
        }
        if (name === 'complete_todo') {
            const r = await window.electronAPI.agentCompleteTodo(args);
            if (!r.success) return '标记完成失败：' + r.error;
            return `已完成：${r.todo.text}`;
        }
        if (name === 'update_todo') {
            const r = await window.electronAPI.agentUpdateTodo(args);
            if (!r.success) return '修改待办失败：' + r.error;
            const t = r.todo;
            const dueStr = t.dueAt ? ` (截止 ${new Date(t.dueAt).toLocaleString('zh-CN')})` : '';
            return `已修改：${t.text}${dueStr}\n变更：${r.changes.join('，')}`;
        }
        if (name === 'delete_todo') {
            const r = await window.electronAPI.agentDeleteTodo(args);
            if (!r.success) return '删除待办失败：' + r.error;
            return `已删除：${r.todo.text}`;
        }
        if (name === 'add_schedule') {
            const r = await window.electronAPI.agentAddSchedule(args);
            if (!r.success) return '添加日程失败：' + r.error;
            const s = r.schedule;
            const startStr = new Date(s.startAt).toLocaleString('zh-CN');
            const endStr = s.endAt ? new Date(s.endAt).toLocaleString('zh-CN') : '';
            const timeRange = endStr ? `${startStr} 至 ${endStr}` : startStr;
            const loc = s.location ? ` @ ${s.location}` : '';
            return `已添加日程：${s.title}（${timeRange}${loc}）`;
        }
        if (name === 'list_schedules') {
            const r = await window.electronAPI.agentListSchedules(args);
            if (!r.success) return '查询日程失败：' + r.error;
            if (r.schedules.length === 0) return '该时间段暂无日程';
            const lines = r.schedules.map(s => {
                const startStr = new Date(s.startAt).toLocaleString('zh-CN');
                const endStr = s.endAt ? new Date(s.endAt).toLocaleString('zh-CN') : '';
                const timeRange = endStr ? `${startStr} 至 ${endStr}` : startStr;
                const loc = s.location ? ` @ ${s.location}` : '';
                const notes = s.notes ? ` [备注：${s.notes}]` : '';
                return `📅 ${s.title}${loc} —— ${timeRange}${notes}`;
            });
            return lines.join('\n');
        }
        if (name === 'update_schedule') {
            const r = await window.electronAPI.agentUpdateSchedule(args);
            if (!r.success) return '修改日程失败：' + r.error;
            const s = r.schedule;
            const startStr = new Date(s.startAt).toLocaleString('zh-CN');
            const endStr = s.endAt ? new Date(s.endAt).toLocaleString('zh-CN') : '';
            const timeRange = endStr ? `${startStr} 至 ${endStr}` : startStr;
            const loc = s.location ? ` @ ${s.location}` : '';
            return `已修改日程：${s.title}（${timeRange}${loc}）\n变更：${r.changes.join('，')}`;
        }
        if (name === 'delete_schedule') {
            const r = await window.electronAPI.agentDeleteSchedule(args);
            if (!r.success) return '删除日程失败：' + r.error;
            return `已删除日程：${r.schedule.title}`;
        }
        if (name === 'add_reminder') {
            const r = await window.electronAPI.agentAddReminder(args);
            if (!r.success) return '添加提醒失败：' + r.error;
            const rm = r.reminder;
            const atStr = new Date(rm.remindAt).toLocaleString('zh-CN');
            const repeatStr = rm.repeat === 'daily' ? '（每天）' :
                              rm.repeat === 'weekly' ? '（每周）' : '';
            return `已添加提醒：${rm.text} —— ${atStr}${repeatStr}`;
        }
        if (name === 'list_reminders') {
            const r = await window.electronAPI.agentListReminders(args);
            if (!r.success) return '查询提醒失败：' + r.error;
            if (r.reminders.length === 0) return '暂无提醒';
            const lines = r.reminders.map(rm => {
                const atStr = new Date(rm.remindAt).toLocaleString('zh-CN');
                const repeatStr = rm.repeat === 'daily' ? ' 🔁每天' :
                                  rm.repeat === 'weekly' ? ' 🔁每周' : '';
                return `⏰ ${rm.text} —— ${atStr}${repeatStr}`;
            });
            return lines.join('\n');
        }
        if (name === 'delete_reminder') {
            const r = await window.electronAPI.agentDeleteReminder(args);
            if (!r.success) return '删除提醒失败：' + r.error;
            return `已删除提醒：${r.reminder.text}`;
        }
        // ========== 复习卡片 ==========
        if (name === 'add_flashcard') {
            const r = await window.electronAPI.agentAddFlashcard(args);
            if (!r.success) return '添加卡片失败：' + r.error;
            if (r.duplicate) return `已存在相同正面卡片（ID: ${r.card.id}）`;
            const tags = r.card.tags.length > 0 ? ` [${r.card.tags.join(', ')}]` : '';
            const subj = r.card.subject ? ` 科目：${r.card.subject}` : '';
            return `已添加卡片：${r.card.front} → ${r.card.back}${tags}${subj}`;
        }
        if (name === 'update_flashcard') {
            const r = await window.electronAPI.agentUpdateFlashcard(args);
            if (!r.success) return '修改卡片失败：' + r.error;
            const c = r.card;
            return `已修改卡片：${c.front}\n变更：${r.changes.join('，')}`;
        }
        if (name === 'list_flashcards') {
            const r = await window.electronAPI.agentListFlashcards(args);
            if (!r.success) return '查询卡片失败：' + r.error;
            if (r.cards.length === 0) return '暂无卡片';
            const lines = r.cards.map(c => {
                const dueStr = c.dueAt <= Date.now() ? ' 🔴到期' : ` 📅${new Date(c.dueAt).toLocaleDateString('zh-CN')}`;
                const subj = c.subject ? `[${c.subject}] ` : '';
                const tags = c.tags.length > 0 ? ` (${c.tags.join(', ')})` : '';
                return `${subj}${c.front}${tags}${dueStr}`;
            });
            return lines.join('\n');
        }
        if (name === 'get_due_cards') {
            const r = await window.electronAPI.agentGetDueCards(args);
            if (!r.success) return '查询到期卡片失败：' + r.error;
            if (r.cards.length === 0) return '🎉 今天没有要复习的卡片';
            const lines = r.cards.map((c, i) => {
                const subj = c.subject ? `[${c.subject}] ` : '';
                return `${i + 1}. ${subj}${c.front}`;
            });
            return `有 ${r.cards.length} 张待复习：\n` + lines.join('\n');
        }
        if (name === 'review_flashcard') {
            const r = await window.electronAPI.agentReviewFlashcard(args);
            if (!r.success) return '评分失败：' + r.error;
            const c = r.card;
            const nextDate = new Date(c.dueAt).toLocaleDateString('zh-CN');
            const ratingCn = { again: '忘了', hard: '勉强', good: '记得', easy: '太简单' }[args.rating] || args.rating;
            return `已评分「${ratingCn}」：${c.front}\n下次复习：${nextDate}（${c.interval} 天后，EF=${c.easeFactor}）`;
        }
        if (name === 'delete_flashcard') {
            const r = await window.electronAPI.agentDeleteFlashcard(args);
            if (!r.success) return '删除卡片失败：' + r.error;
            return `已删除卡片：${r.card.front}`;
        }
        if (name === 'get_flashcard_stats') {
            const r = await window.electronAPI.agentFlashcardStats();
            if (!r.success) return '查询统计失败：' + r.error;
            const s = r.stats;
            if (s.total === 0) return '还没有任何卡片';
            const lines = [`📊 总计 ${s.total} 张，待复习 ${s.due} 张`];
            for (const [subj, data] of Object.entries(s.bySubject)) {
                lines.push(`  · ${subj}：${data.total} 张（待复习 ${data.due}，平均 EF ${data.avgEF}）`);
            }
            return lines.join('\n');
        }
        // ========== 倒计时 / 正计时 ==========
        if (name === 'add_timer') {
            const timerType = args.type === 'countup' ? 'countup' : 'countdown';
            let durationMs = 0;
            if (timerType === 'countdown') {
                const min = Number(args.durationMinutes) || 0;
                const sec = Number(args.durationSeconds) || 0;
                durationMs = (min * 60 + sec) * 1000;
                if (durationMs <= 0) {
                    return '创建失败：倒计时需要给出时长（durationMinutes 或 durationSeconds）';
                }
            }
            const r = await window.electronAPI.timerAdd({
                name: args.name,
                type: timerType,
                durationMs,
                notifyText: args.notifyText || '',
                writeToCalendar: true
            });
            if (!r.success) return '创建计时失败：' + r.error;
            const t = r.timer;
            if (timerType === 'countdown') {
                const min = Math.floor(durationMs / 60000);
                const sec = Math.floor((durationMs % 60000) / 1000);
                const durStr = min > 0 ? `${min} 分${sec > 0 ? ' ' + sec + ' 秒' : ''}` : `${sec} 秒`;
                return `已创建倒计时：${t.name}（${durStr}）`;
            } else {
                return `已创建正计时：${t.name}（点"停止"时结束）`;
            }
        }
        if (name === 'add_pomodoro') {
            const r = await window.electronAPI.timerAddPomodoro({
                name: args.name || '番茄钟',
                workMin: args.workMin || 25,
                breakMin: args.breakMin || 5,
                longBreakMin: args.longBreakMin || 15,
                roundsBeforeLong: args.roundsBeforeLong || 4,
                totalRounds: args.totalRounds || 4
            });
            if (!r.success) return '创建番茄钟失败：' + r.error;
            const t = r.timer;
            return `🍅 番茄钟已启动：工作 ${t.pomodoro.workMin} 分 / 休息 ${t.pomodoro.breakMin} 分，共 ${t.pomodoro.totalRounds} 轮`;
        }
        if (name === 'list_timers') {
            const r = await window.electronAPI.timerList();
            if (!r.success) return '查询计时失败：' + r.error;
            if (r.timers.length === 0) return '当前没有任何计时';
            const now = Date.now();
            const lines = r.timers.map(t => {
                let display;
                const elapsed = (t.state === 'paused')
                    ? (t.elapsedBeforePause || 0)
                    : (t.state === 'done')
                        ? (t.type === 'countdown' ? t.durationMs : (t.elapsedBeforePause || 0))
                        : (t.elapsedBeforePause || 0) + (now - (t.startedAt || now));
                if (t.type === 'countdown') {
                    const remain = Math.max(0, t.durationMs - elapsed);
                    display = this._fmtDuration(remain);
                } else {
                    display = this._fmtDuration(elapsed);
                }
                const stateStr = t.state === 'running' ? '进行中' :
                                 t.state === 'paused' ? '已暂停' : '已完成';
                if (t.pomodoroMode && t.pomodoro) {
                    const phaseStr = { work: '工作中', break: '短休息', longBreak: '长休息' }[t.pomodoro.phase] || t.pomodoro.phase;
                    return `🍅 ${t.name}（第 ${t.pomodoro.currentRound}/${t.pomodoro.totalRounds} 轮 · ${phaseStr}，${stateStr}）：${display}`;
                }
                const typeStr = t.type === 'countdown' ? '倒计时' : '正计时';
                return `⏱ ${t.name}（${typeStr}，${stateStr}）：${display}`;
            });
            return lines.join('\n');
        }
        if (name === 'pause_timer') {
            const t = await this._findTimerByNameOrId(args.idOrName);
            if (!t) return `未找到计时器：${args.idOrName}`;
            const r = await window.electronAPI.timerPause(t.id);
            if (!r.success) return '暂停失败：' + r.error;
            return `已暂停：${r.timer.name}`;
        }
        if (name === 'resume_timer') {
            const t = await this._findTimerByNameOrId(args.idOrName);
            if (!t) return `未找到计时器：${args.idOrName}`;
            const r = await window.electronAPI.timerResume(t.id);
            if (!r.success) return '继续失败：' + r.error;
            return `已继续：${r.timer.name}`;
        }
        if (name === 'delete_timer') {
            const t = await this._findTimerByNameOrId(args.idOrName);
            if (!t) return `未找到计时器：${args.idOrName}`;
            const r = await window.electronAPI.timerDelete(t.id);
            if (!r.success) return '删除失败：' + r.error;
            return `已删除计时器：${t.name}`;
        }
        return '未知工具';
    }

    /**
     * 按名称或 ID 查找计时器
     */
    async _findTimerByNameOrId(idOrName) {
        if (!idOrName) return null;
        const needle = String(idOrName).trim();
        try {
            const r = await window.electronAPI.timerList();
            if (!r.success) return null;
            const list = r.timers || [];
            // 先按 ID 精确匹配
            let hit = list.find(t => t.id === needle);
            if (hit) return hit;
            // 再按名称模糊匹配（优先 running/paused）
            const byName = list.filter(t => t.name.includes(needle));
            if (byName.length === 0) return null;
            hit = byName.find(t => t.state === 'running')
               || byName.find(t => t.state === 'paused')
               || byName[0];
            return hit;
        } catch {
            return null;
        }
    }

    async _requestConfirmation(toolName, args) {
        const reqId = 'req-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        return new Promise((resolve) => {
            this._pendingConfirmations.set(reqId, resolve);
            window.electronAPI.requestConfirmation(reqId, toolName, args);
            // 5 分钟超时，自动拒绝
            setTimeout(() => {
                if (this._pendingConfirmations.has(reqId)) {
                    this._pendingConfirmations.delete(reqId);
                    resolve(false);
                }
            }, 5 * 60 * 1000);
        });
    }

    async _callAPIWithTools(messages, tools) {
        const cfg = this.aiClient.getConfig();
        const res = await fetch(`${cfg.baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${cfg.apiKey}`
            },
            body: JSON.stringify({
                model: cfg.modelName,
                messages,
                tools,
                tool_choice: 'auto',
                max_tokens: 4096,
                temperature: 0.6
            })
        });
        if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
        const data = await res.json();
        return data.choices[0].message;
    }

    async sendRequest(appName, bounds, ownerName) {
        if (this.isRequesting) return;
        this.isRequesting = true;

        try {
            // Fetch all open windows for layout context (default off)
            let layoutSummary = '';
            if (this._showLayout && window.electronAPI?.getOpenWindows) {
                try {
                    const winResult = await window.electronAPI.getOpenWindows();
                    if (winResult?.success && winResult.data.length > 0) {
                        const lines = winResult.data
                            .filter(w => {
                                if (!w.owner?.name || this.shouldSkipApp(w.owner.name)) return false;
                                // Skip minimized windows (taskbar button size)
                                const b = w.bounds;
                                return b && b.width > 200 && b.height > 200;
                            })
                            .slice(0, 5)
                            .map(w => {
                                const b = w.bounds;
                                const size = b ? `${b.width}x${b.height}` : '?';
                                return `${this._shortenTitle(w.title || w.owner.name)} [${size}]`;
                            });
                        if (lines.length > 2) {
                            layoutSummary = '\n' + this._t('sys.windowLayout') + lines.join(', ');
                        }
                    }
                } catch (e) {}
            }

            // System idle time (seconds since last keyboard/mouse input)
            let idleInfo = '';
            if (window.electronAPI?.getSystemIdleTime) {
                try {
                    const idleSec = await window.electronAPI.getSystemIdleTime();
                    if (idleSec >= 60) {
                        idleInfo = '\n' + this._t('sys.userIdle').replace('{0}', idleSec);
                    }
                } catch (e) {}
            }

            // Pet window position (for self-identification in screenshots)
            let petPosInfo = '';
            if (window.electronAPI?.getWindowBounds) {
                try {
                    const pb = await window.electronAPI.getWindowBounds();
                    if (pb) {
                        petPosInfo = '\n' + this._t('sys.petPosition')
                            .replace('{x}', pb.x).replace('{y}', pb.y)
                            .replace('{w}', pb.width).replace('{h}', pb.height);
                    }
                } catch (e) {}
            }

            // Build fresh system prompt with dynamic context
            // Enhancement side-effects (search, memory) — VLM context not injected into prompt
            if (this.enhancer) {
                await this.enhancer.beforeRequest(appName, null);
            }

            // ★ 记录观察（仅一次，不调 AI）
            let currentContact = null;
            if (this.observationLog && appName) {
                currentContact = this.observationLog.record(ownerName || appName, appName);
            }

            let metaInfo = '';
            if (this.emotionSystem) {
                const nextEmotion = this.emotionSystem.nextEmotionBuffer;
                if (nextEmotion) {
                    metaInfo += '\n' + this._t('sys.toneHint').replace('{0}', nextEmotion);
                }
            }
            metaInfo += idleInfo + petPosInfo + layoutSummary;

            // ★ 注入观察日志到 system prompt
            let obsBlock = '';
            if (this.observationLog) {
                obsBlock = this.observationLog.buildPromptBlock();
            }

            let dynamicContext = this.buildDynamicContext() + metaInfo;
            if (obsBlock) {
                dynamicContext += '\n\n' + obsBlock;
            }
            const currentSystemPrompt = this.promptBuilder.buildSystemPrompt(dynamicContext);

            const boundsInfo = bounds ? ` [${bounds.width}x${bounds.height}]` : '';
            const hitContext = this._buildHitContext();
            const textPrompt = this.promptBuilder.getAppDetectionPrompt(this._shortenTitle(appName, 50) + boundsInfo) + hitContext;

            // Gather screenshots: HQ fresh capture + one older from mipmap
            const screenshots = [];
            const maxScreenshots = 2;
            if (window.electronAPI?.getScreenCaptureHQ) {
                try {
                    const fresh = await window.electronAPI.getScreenCaptureHQ(appName);
                    if (fresh) screenshots.push({ base64: fresh, timestamp: Date.now() });
                } catch (e) {}
            }
            if (!screenshots.length && window.electronAPI?.getScreenCapture) {
                try {
                    const fresh = await window.electronAPI.getScreenCapture();
                    if (fresh) screenshots.push({ base64: fresh, timestamp: Date.now() });
                } catch (e) {}
            }
            if (this.enhancer?.vlmExtractor) {
                const older = this.enhancer.vlmExtractor.getScreenshotsForMainAI(1);
                for (const entry of older) {
                    if (screenshots.length > 0 && entry.base64 === screenshots[0].base64) continue;
                    if (screenshots.length < maxScreenshots) screenshots.push(entry);
                }
            }

            // Build messages: system + optional keyframe context + current user message
            // ★ 话题分析（异步，不阻塞当前请求）
            if (currentContact && screenshots.length > 0) {
                this.observationLog.maybeUpdateTopics(currentContact, screenshots[0].base64);
            }

            const messages = [
                { role: 'system', content: currentSystemPrompt }
            ];

            // Keyframe context (mid-term visual memory)
            if (this.enhancer?.vlmExtractor) {
                const keyframes = await this.enhancer.vlmExtractor.getKeyframesForMainAI(2);
                if (keyframes.length > 0) {
                    const now = Date.now();
                    const kfContent = [{ type: 'text', text: this._t('sys.kfLabel') }];
                    for (let i = 0; i < keyframes.length; i++) {
                        const kf = keyframes[i];
                        const kfTime = new Date(kf.timestamp);
                        const kfTimeStr = `${kfTime.getHours()}:${String(kfTime.getMinutes()).padStart(2, '0')}`;
                        const ageSec = Math.round((now - kf.timestamp) / 1000);
                        const ageStr = ageSec < 60 ? `${ageSec}s` : `${Math.round(ageSec / 60)}min`;
                        const shortTitle = this._shortenTitle(kf.title, 25);
                        kfContent.push(
                            { type: 'text', text: this._t('sys.kfEntry').replace('{0}', i + 1).replace('{1}', kfTimeStr).replace('{2}', shortTitle).replace('{3}', ageStr) },
                            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + kf.base64 } }
                        );
                    }
                    messages.push({ role: 'user', content: kfContent });
                    messages.push({ role: 'assistant', content: this._t('sys.kfAck') });
                }
            }

            let response;
            const hasScreenshots = screenshots.length > 0;

            if (hasScreenshots) {
                const now = new Date();
                const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
                const userContent = [
                    { type: 'text', text: `[${timeStr}] ${textPrompt}${this._t('sys.screenshotAttached')}` }
                ];
                for (const shot of screenshots) {
                    userContent.push({
                        type: 'image_url',
                        image_url: { url: 'data:image/jpeg;base64,' + shot.base64 }
                    });
                }

                messages.push({ role: 'user', content: userContent });
                this._logRequestText(messages);
                response = await this.aiClient.callAPI(messages);
            } else {
                // No new screenshots — use idle prompt with timestamp
                const now = new Date();
                const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
                const idlePrompt = this.promptBuilder.getIdlePrompt();
                messages.push({ role: 'user', content: `[${timeStr}] ${idlePrompt}` });
                this._logRequestText(messages);
                response = await this.aiClient.callAPI(messages);
            }

            if (response) {
                // Store response in recent pool for anti-repetition analysis
                const entry = { response, timestamp: Date.now(), analysis: null };
                this.recentPool.push(entry);
                this._analyzeResponse(entry).catch(e =>
                    console.warn('[DesktopPetSystem] Analysis failed:', e.message));

                // Double-buffer: overwrite pending with latest
                this.pendingMessage = response;
                this._processQueue();
            }

            // Clear focus tracker after each AI request
            this.focusTracker = {};

        } catch (error) {
            console.error('[DesktopPetSystem] Request failed:', error);
        } finally {
            this.isRequesting = false;
        }
    }
}

window.DesktopPetSystem = DesktopPetSystem;
