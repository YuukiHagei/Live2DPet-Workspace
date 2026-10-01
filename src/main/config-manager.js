/**
 * ConfigManager — Configuration persistence, migration, and defaults.
 * Extracted from main.js lines 21-178.
 */
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { encrypt, decrypt } = require('./crypto-utils');

const CURRENT_CONFIG_VERSION = 1;
const ENCRYPTED_FIELDS = ['apiKey', 'translation.apiKey', 'enhance.search.customApiKey', 'cloud.appPassword', 'cloud.githubToken'];

function getDefaultModelConfig() {
    return {
        type: 'none',
        folderPath: null,
        modelJsonFile: null,
        copyToUserData: true,
        userDataModelPath: null,
        staticImagePath: null,
        bottomAlignOffset: 0.5,
        gifExpressions: {},
        paramMapping: {
            angleX: null, angleY: null, angleZ: null,
            bodyAngleX: null, eyeBallX: null, eyeBallY: null
        },
        hasExpressions: false,
        expressions: [],
        expressionDurations: {},
        defaultExpressionDuration: 5000,
        canvasYRatio: 0.60
    };
}

function getDefaultConfig() {
    return {
        configVersion: CURRENT_CONFIG_VERSION,
        apiKey: '',
        baseURL: 'https://openrouter.ai/api/v1',
        modelName: 'x-ai/grok-4.1-fast',
        interval: 10,
        chatGap: 5,
        emotionFrequency: 30,
        enabledEmotions: [],
        maxTokensMultiplier: 1.0,
        model: getDefaultModelConfig(),
        bubble: { frameImagePath: null },
        appIcon: null,
        startup: {
            enabled: true,
            messages: [
                '欢迎回来，{name}',
                '{name}，今天也要加油哦',
                '又见面了，{name}'
            ]
        },
        proactiveEnabled: true,
        agent: {
            toolPolicies: {
                read_file: 'allow',
                list_dir: 'allow',
                list_dir_tree: 'allow',
                search_files: 'allow',
                grep_text: 'allow',
                write_file: 'ask',
                open_url: 'ask'
            }
        },
        brief: {
            enabled: true,
            morningEnabled: true,
            morningTime: '07:30',
            eveningEnabled: true,
            eveningTime: '22:00',
            city: ''
        },
        report: {
            enabled: true,
            weeklyEnabled: true,
            weeklyTime: '21:00',
            monthlyEnabled: true,
            monthlyTime: '21:00'
        },
        timerDefaultNotify: '到时间了',
        mcp: {
            servers: [
                {
                    id: 'builtin',
                    name: '内置工具',
                    command: 'node',
                    args: ['{mcpServer}/mcp-server.js'],
                    enabled: true
                }
            ]
        },
        enhance: {
            enabled: false,
            memory: { enabled: true, retentionDays: 30 },
            search: { enabled: false, provider: 'custom', customUrl: '', customApiKey: '', maxFrequencyMs: 30000, minFocusSeconds: 10 },
            knowledge: { enabled: false, minIntervalMs: 60000, maxIntervalMs: 3600000 },
            vlm: { enabled: false, baseIntervalMs: 15000, maxIntervalMs: 60000, minFocusSeconds: 10 },
            knowledgeAcq: { enabled: false, minFocusSeconds: 60, termCooldownMs: 3600000, maxTermsPerTopic: 15, maxSearchesPerRequest: 2, retentionDays: 30 }
        },
        cloud: {
            enabled: false,
            provider: 'github-gist',         // 'nutstore' | 'github-gist'
            autoPush: true,
            // 坚果云字段
            webdavUrl: 'https://dav.jianguoyun.com/dav/',
            username: '',
            appPassword: '',
            remotePath: '/Live2DPet',
            // GitHub Gist 字段
            gistId: '',
            githubToken: '',
            syncCharacters: true,
            // 状态
            lastSyncAt: 0,
            lastSyncPerFile: {}
        },
        timerBubble: { x: null, y: null },
    };
}

function migrateConfig(config) {
    if (config.configVersion >= CURRENT_CONFIG_VERSION) return config;
    if (!config.configVersion) {
        config.configVersion = CURRENT_CONFIG_VERSION;
        if (!config.model) config.model = getDefaultModelConfig();
        if (!config.bubble) config.bubble = { frameImagePath: null };
        if (config.appIcon === undefined) config.appIcon = null;
        if (!config.startup) {
            config.startup = {
                enabled: true,
                messages: ['欢迎回来，{name}', '{name}，今天也要加油哦', '又见面了，{name}']
            };
        } else if (!Array.isArray(config.startup.messages)) {
            // 从旧的 messageTemplate 迁移
            config.startup.messages = config.startup.messageTemplate
                ? [config.startup.messageTemplate]
                : ['欢迎回来，{name}'];
            delete config.startup.messageTemplate;
        }
        if (config.proactiveEnabled === undefined) config.proactiveEnabled = true;
        if (!config.agent) config.agent = { toolPolicies: {} };
        if (!config.agent.toolPolicies) config.agent.toolPolicies = {};
        if (!config.mcp) {
            config.mcp = {
                servers: [{
                    id: 'builtin',
                    name: '内置工具',
                    command: 'node',
                    args: ['{basePath}/mcp-server.js'],
                    enabled: true
                }]
            };
        } 
        if (!config.brief) config.brief = { enabled: true, morningEnabled: true, morningTime: '07:30', eveningEnabled: true, eveningTime: '22:00', city: '' };
        if (!config.report) config.report = { enabled: true, weeklyEnabled: true, weeklyTime: '21:00', monthlyEnabled: true, monthlyTime: '21:00' };
        else if (!Array.isArray(config.mcp.servers)) {
            config.mcp.servers = [];
        }
        if (Array.isArray(config.enabledEmotions) && config.enabledEmotions.length > 0) {
            config.enabledEmotions = [];
        }
    }
    return config;
}

function createConfigManager(app, options = {}) {
    const _encrypt = options.encrypt || encrypt;
    const _decrypt = options.decrypt || decrypt;
    const basePath = options.basePath || path.join(__dirname, '..', '..');

    // Async fs operations (injectable for testing)
    const _readFile = options.readFile || ((p) => fsp.readFile(p, 'utf-8'));
    const _writeFile = options.writeFile || ((p, d) => fsp.writeFile(p, d, 'utf-8'));
    const _exists = options.exists || ((p) => fsp.access(p).then(() => true).catch(() => false));

    function decryptFields(config) {
        if (config.apiKey) config.apiKey = _decrypt(config.apiKey);
        if (config.translation?.apiKey) config.translation.apiKey = _decrypt(config.translation.apiKey);
        if (config.enhance?.search?.customApiKey) config.enhance.search.customApiKey = _decrypt(config.enhance.search.customApiKey);
        if (config.cloud?.appPassword) config.cloud.appPassword = _decrypt(config.cloud.appPassword);  // ← 新增
        if (config.cloud?.githubToken) config.cloud.githubToken = _decrypt(config.cloud.githubToken);
    }

    function encryptFields(config) {
        if (config.apiKey) config.apiKey = _encrypt(config.apiKey);
        if (config.translation?.apiKey) config.translation.apiKey = _encrypt(config.translation.apiKey);
        if (config.enhance?.search?.customApiKey) config.enhance.search.customApiKey = _encrypt(config.enhance.search.customApiKey);
        if (config.cloud?.appPassword) config.cloud.appPassword = _encrypt(config.cloud.appPassword);  // ← 新增
        if (config.cloud?.githubToken) config.cloud.githubToken = _encrypt(config.cloud.githubToken);
    }

    const bundledConfigPath = path.join(basePath, 'config.json');
    const userConfigPath = path.join(app.getPath('userData'), 'config.json');

    async function loadConfigFile() {
        try {
            let raw = {};
            if (await _exists(userConfigPath)) {
                raw = JSON.parse(await _readFile(userConfigPath));
            } else if (app.isPackaged && await _exists(bundledConfigPath)) {
                raw = JSON.parse(await _readFile(bundledConfigPath));
            }
            const defaults = getDefaultConfig();
            const merged = {
                ...defaults,
                ...raw,
                model: { ...defaults.model, ...(raw.model || {}), paramMapping: { ...defaults.model.paramMapping, ...((raw.model || {}).paramMapping || {}) } },
                bubble: { ...defaults.bubble, ...(raw.bubble || {}) },
                tts: { ...(defaults.tts || {}), ...(raw.tts || {}) },
                startup: {
                    ...defaults.startup,
                    ...(raw.startup || {}),
                    messages: Array.isArray(raw.startup?.messages) && raw.startup.messages.length > 0
                        ? raw.startup.messages
                        : (raw.startup?.messageTemplate
                            ? [raw.startup.messageTemplate]
                            : defaults.startup.messages)
                },
                agent: {
                    ...defaults.agent,
                    ...(raw.agent || {}),
                    toolPolicies: {
                        ...defaults.agent.toolPolicies,
                        ...((raw.agent || {}).toolPolicies || {})
                    }
                },
                mcp: {
                    ...defaults.mcp,
                    ...(raw.mcp || {}),
                    servers: Array.isArray(raw.mcp?.servers) ? raw.mcp.servers : defaults.mcp.servers
                },
                brief: { ...defaults.brief, ...(raw.brief || {}) },
                report: { ...defaults.report, ...(raw.report || {}) },
                enhance: {
                    ...defaults.enhance,
                    ...(raw.enhance || {}),
                    memory: { ...defaults.enhance.memory, ...((raw.enhance || {}).memory || {}) },
                    search: { ...defaults.enhance.search, ...((raw.enhance || {}).search || {}) },
                    knowledge: { ...defaults.enhance.knowledge, ...((raw.enhance || {}).knowledge || {}) },
                    vlm: { ...defaults.enhance.vlm, ...((raw.enhance || {}).vlm || {}) },
                    knowledgeAcq: { ...defaults.enhance.knowledgeAcq, ...((raw.enhance || {}).knowledgeAcq || {}) }
                }
            };
            if (process.env.LIVE2DPET_API_KEY) merged.apiKey = process.env.LIVE2DPET_API_KEY;
            if (process.env.LIVE2DPET_BASE_URL) merged.baseURL = process.env.LIVE2DPET_BASE_URL;
            if (process.env.LIVE2DPET_MODEL) merged.modelName = process.env.LIVE2DPET_MODEL;
            decryptFields(merged);
            return migrateConfig(merged);
        } catch (e) { console.warn('Failed to load config:', e.message); }
        return getDefaultConfig();
    }

    async function saveConfigFile(data) {
        try {
            const existing = await loadConfigFile();
            const merged = { ...existing, ...data };
            if (data.model) {
                merged.model = { ...existing.model, ...data.model };
                if (data.model.paramMapping) {
                    merged.model.paramMapping = { ...existing.model.paramMapping, ...data.model.paramMapping };
                }
            }
            if (data.bubble) merged.bubble = { ...existing.bubble, ...data.bubble };
            if (data.tts) merged.tts = { ...(existing.tts || {}), ...data.tts };
            if (data.startup) {
                merged.startup = { ...(existing.startup || {}), ...data.startup };
                // messages 数组直接覆盖，不做合并
                if (Array.isArray(data.startup.messages)) {
                    merged.startup.messages = data.startup.messages;
                }
            }
            if (data.agent) {
                merged.agent = { ...(existing.agent || {}), ...data.agent };
                if (data.agent.toolPolicies) {
                    merged.agent.toolPolicies = {
                        ...(existing.agent?.toolPolicies || {}),
                        ...data.agent.toolPolicies
                    };
                }
            }
            if (data.mcp) {
                merged.mcp = { ...(existing.mcp || {}), ...data.mcp };
                if (Array.isArray(data.mcp.servers)) {
                    merged.mcp.servers = data.mcp.servers;
                }
            }
            if (data.brief) merged.brief = { ...(existing.brief || {}), ...data.brief };
            if (data.report) merged.report = { ...(existing.report || {}), ...data.report };
            if (data.translation) merged.translation = { ...(existing.translation || {}), ...data.translation };
            if (data.cloud) {
                merged.cloud = { ...(existing.cloud || {}), ...data.cloud };
                // lastSyncPerFile 做深合并，避免某次只更新一个文件时丢其他的
                if (data.cloud.lastSyncPerFile) {
                    merged.cloud.lastSyncPerFile = {
                        ...(existing.cloud?.lastSyncPerFile || {}),
                        ...data.cloud.lastSyncPerFile
                    };
                }
            }
            if (data.enhance) {
                merged.enhance = { ...(existing.enhance || {}), ...data.enhance };
                if (data.enhance.memory) merged.enhance.memory = { ...(existing.enhance?.memory || {}), ...data.enhance.memory };
                if (data.enhance.search) merged.enhance.search = { ...(existing.enhance?.search || {}), ...data.enhance.search };
                if (data.enhance.knowledge) merged.enhance.knowledge = { ...(existing.enhance?.knowledge || {}), ...data.enhance.knowledge };
                if (data.enhance.vlm) merged.enhance.vlm = { ...(existing.enhance?.vlm || {}), ...data.enhance.vlm };
                if (data.enhance.knowledgeAcq) merged.enhance.knowledgeAcq = { ...(existing.enhance?.knowledgeAcq || {}), ...data.enhance.knowledgeAcq };
            }
            const toWrite = JSON.parse(JSON.stringify(merged));
            encryptFields(toWrite);
            await _writeFile(userConfigPath, JSON.stringify(toWrite, null, 2));
            return true;
        } catch (e) { console.error('Failed to save config:', e.message); return false; }
    }

    return { loadConfigFile, saveConfigFile, userConfigPath, bundledConfigPath };
}

module.exports = {
    createConfigManager,
    getDefaultConfig,
    getDefaultModelConfig,
    migrateConfig,
    CURRENT_CONFIG_VERSION
};
