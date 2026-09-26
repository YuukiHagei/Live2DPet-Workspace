/**
 * MCP Manager — 管理多个 MCP Server 子进程
 */
const { spawn } = require('child_process');
const readline = require('readline');

/**
 * 单个 MCP Server 连接
 */
class McpServerConnection {
    constructor(config) {
        this.id = config.id;
        this.name = config.name || config.id;
        this.command = config.command || 'node';
        this.args = config.args || [];
        this.cwd = config.cwd || undefined;
        this.env = config.env || undefined;

        this.proc = null;
        this.msgId = 0;
        this.pending = new Map();
        this.tools = [];
        this.status = 'stopped';   // 'stopped' | 'starting' | 'running' | 'error'
        this.error = null;
    }

    async start() {
        if (this.proc) return;
        this.status = 'starting';
        this.error = null;

        // Windows 上 .cmd/.bat 需要用 cmd.exe /c 包一层
        let spawnCmd = this.command;
        let spawnArgs = this.args;
        if (process.platform === 'win32') {
            const scriptCmds = ['npx', 'npm', 'yarn', 'pnpm', 'pnpx', 'bun'];
            const lowerCmd = this.command.toLowerCase();
            if (scriptCmds.includes(lowerCmd)) {
                spawnCmd = this.command + '.cmd';
            }
            if (spawnCmd.endsWith('.cmd') || spawnCmd.endsWith('.bat')) {
                // 拼接命令行（参数含空格加引号）
                const argStr = this.args.map(a => {
                    const s = String(a);
                    return /[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
                }).join(' ');
                const fullCmd = spawnCmd + (argStr ? ' ' + argStr : '');
                spawnCmd = process.env.ComSpec || 'cmd.exe';
                spawnArgs = ['/d', '/s', '/c', fullCmd];
            }
        }

        try {
            this.proc = spawn(spawnCmd, spawnArgs, {
                stdio: ['pipe', 'pipe', 'pipe'],
                cwd: this.cwd,
                env: this.env ? { ...process.env, ...this.env } : process.env,
                windowsHide: true
            });
        } catch (err) {
            this.status = 'error';
            this.error = err.message;
            console.error(`[MCP:${this.id}] spawn failed:`, err.message);
            throw err;
        }

        // 等 spawn 成功或失败
        await new Promise((resolve, reject) => {
            let settled = false;
            const onError = (err) => {
                if (settled) return;
                settled = true;
                this.status = 'error';
                this.error = err.message;
                try { this.proc && this.proc.kill(); } catch {}
                this.proc = null;
                console.error(`[MCP:${this.id}] spawn error:`, err.message);
                reject(new Error(`启动失败：${err.message}`));
            };
            const onSpawn = () => {
                if (settled) return;
                settled = true;
                this.proc.removeListener('error', onError);
                resolve();
            };
            this.proc.once('error', onError);
            this.proc.once('spawn', onSpawn);
            setTimeout(() => {
                if (!settled) {
                    settled = true;
                    this.proc.removeListener('error', onError);
                    resolve();
                }
            }, 5000);
        });

        const rl = readline.createInterface({ input: this.proc.stdout });
        rl.on('line', (line) => {
            let msg;
            try { msg = JSON.parse(line); } catch { return; }
            const resolver = this.pending.get(msg.id);
            if (resolver) {
                this.pending.delete(msg.id);
                resolver(msg);
            }
        });

        this.proc.stderr.on('data', (d) => {
            console.log(`[MCP:${this.id}]`, d.toString().trim());
        });

        this.proc.on('exit', (code) => {
            console.error(`[MCP:${this.id}] exited with code`, code);
            this.proc = null;
            this.status = code === 0 ? 'stopped' : 'error';
            if (code !== 0) this.error = `进程退出，code=${code}`;
        });

        try {
            const result = await this._request('tools/list');
            this.tools = result?.result?.tools || [];
            this.status = 'running';
            console.log(`[MCP:${this.id}] started, ${this.tools.length} tools`);
        } catch (err) {
            this.status = 'error';
            this.error = err.message;
            try { this.proc && this.proc.kill(); } catch {}
            this.proc = null;
            throw err;
        }
    }

    stop() {
        if (this.proc) {
            try { this.proc.kill(); } catch {}
            this.proc = null;
        }
        this.status = 'stopped';
        this.tools = [];
    }

    _request(method, params = {}, timeoutMs = 15000) {
        return new Promise((resolve, reject) => {
            if (!this.proc) return reject(new Error('MCP server not running'));
            const id = ++this.msgId;
            this.pending.set(id, resolve);
            try {
                this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
            } catch (err) {
                this.pending.delete(id);
                return reject(err);
            }
            setTimeout(() => {
                if (this.pending.has(id)) {
                    this.pending.delete(id);
                    reject(new Error('请求超时：' + method));
                }
            }, timeoutMs);
        });
    }

    async listTools() {
        if (!this.proc) throw new Error('未运行');
        const resp = await this._request('tools/list');
        this.tools = resp?.result?.tools || [];
        return this.tools;
    }

    async callTool(name, args) {
        if (!this.proc) throw new Error('未运行');
        const resp = await this._request('tools/call', { name, arguments: args || {} });
        const content = resp?.result?.content || [];
        const textPart = content.find(c => c.type === 'text');
        return { result: textPart ? textPart.text : JSON.stringify(resp.result) };
    }
}

/**
 * MCP Manager
 */
class McpManager {
    constructor(basePath, mcpServerPath) {
        this.basePath = basePath;
        this.mcpServerPath = mcpServerPath || basePath;
        this.servers = new Map();     // id -> McpServerConnection
        this.toolMap = new Map();     // exposedName -> { serverId, originalName, tool }
    }

    /**
     * 根据配置启动所有 enabled server
     */
    async reload(serverConfigs, reservedNames = []) {
        const reserved = new Set(reservedNames);

        // 停所有旧的
        for (const conn of this.servers.values()) conn.stop();
        this.servers.clear();
        this.toolMap.clear();

        const replaceVars = (s) => String(s)
            .replace(/\{basePath\}/g, this.basePath)
            .replace(/\{mcpServer\}/g, this.mcpServerPath)
            .replace(/\{electron\}/g, process.execPath);

        // 启动新的（串行，避免太多进程同时启动）
        for (const sc of serverConfigs || []) {
            if (sc.enabled === false) continue;
            if (!sc.id || !sc.command) {
                console.warn('[MCP] Skip invalid server config:', sc);
                continue;
            }

            const command = replaceVars(sc.command);
            const args = (sc.args || []).map(replaceVars);
            const cwd = sc.cwd ? replaceVars(sc.cwd) : undefined;

            const env = { ...(sc.env || {}) };
            if (command === process.execPath && !env.ELECTRON_RUN_AS_NODE) {
                env.ELECTRON_RUN_AS_NODE = '1';
            }

            const conn = new McpServerConnection({
                id: sc.id,
                name: sc.name || sc.id,
                command,
                args,
                cwd,
                env: Object.keys(env).length ? env : undefined
            });

            this.servers.set(conn.id, conn);
            try {
                await conn.start();
            } catch (err) {
                console.warn(`[MCP] Server "${conn.id}" failed to start:`, err.message);
                // 不阻断其他 server
            }
        }

        // 构建工具映射（冲突加前缀）
        for (const conn of this.servers.values()) {
            if (conn.status !== 'running') continue;
            for (const tool of conn.tools) {
                let exposedName = tool.name;

                if (this.toolMap.has(exposedName) || reserved.has(exposedName)) {
                    exposedName = `${conn.id}__${tool.name}`;
                    let suffix = 2;
                    while (this.toolMap.has(exposedName) || reserved.has(exposedName)) {
                        exposedName = `${conn.id}__${tool.name}_${suffix++}`;
                    }
                }

                this.toolMap.set(exposedName, {
                    serverId: conn.id,
                    originalName: tool.name,
                    tool: { ...tool, exposedName }
                });
            }
        }

        console.log(`[MCP] Manager ready: ${this.servers.size} servers, ${this.toolMap.size} tools`);
        return this.getStatus();
    }

    /**
     * 列出所有工具（合并后）
     */
    listAllTools() {
        const result = [];
        for (const [exposedName, info] of this.toolMap.entries()) {
            result.push({
                name: exposedName,
                description: info.tool.description || '',
                parameters: info.tool.inputSchema || { type: 'object', properties: {} },
                serverId: info.serverId,
                originalName: info.originalName
            });
        }
        return result;
    }

    /**
     * 调用工具（按 exposedName 路由到对应 server）
     */
    async callTool(exposedName, args) {
        const info = this.toolMap.get(exposedName);
        if (!info) throw new Error(`未知工具：${exposedName}`);
        const conn = this.servers.get(info.serverId);
        if (!conn || conn.status !== 'running') {
            throw new Error(`Server "${info.serverId}" 未运行`);
        }
        return conn.callTool(info.originalName, args);
    }

    /**
     * 状态查询
     */
    getStatus() {
        const servers = [];
        for (const conn of this.servers.values()) {
            servers.push({
                id: conn.id,
                name: conn.name,
                command: conn.command,
                args: conn.args,
                status: conn.status,
                error: conn.error,
                toolCount: conn.tools.length,
                tools: conn.tools.map(t => {
                    // 找到暴露名
                    for (const [exp, info] of this.toolMap.entries()) {
                        if (info.serverId === conn.id && info.originalName === t.name) {
                            return { originalName: t.name, exposedName: exp };
                        }
                    }
                    return { originalName: t.name, exposedName: t.name };
                })
            });
        }
        return { servers, totalTools: this.toolMap.size };
    }

    /**
     * 测试一个 server 配置（临时启动，测试完关闭）
     */
    async testServer(config) {
        const replaceVars = (s) => String(s)
            .replace(/\{basePath\}/g, this.basePath)
            .replace(/\{mcpServer\}/g, this.mcpServerPath)
            .replace(/\{electron\}/g, process.execPath);

        const command = replaceVars(config.command || 'node');
        const args = (config.args || []).map(replaceVars);
        const cwd = config.cwd ? replaceVars(config.cwd) : undefined;

        const env = { ...(config.env || {}) };
        if (command === process.execPath && !env.ELECTRON_RUN_AS_NODE) {
            env.ELECTRON_RUN_AS_NODE = '1';
        }

        const conn = new McpServerConnection({
            id: config.id || 'test',
            name: config.name || 'test',
            command,
            args,
            cwd,
            env: Object.keys(env).length ? env : undefined
        });

        try {
            await conn.start();
            const tools = conn.tools.map(t => t.name);
            conn.stop();
            return { success: true, toolCount: tools.length, tools };
        } catch (err) {
            conn.stop();
            return { success: false, error: err.message };
        }
    }
}

module.exports = { McpManager, McpServerConnection };