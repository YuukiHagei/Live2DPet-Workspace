// mcp-server.js —— 官方 SDK 版本
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const os = require('os');
const { execSync } = require('child_process');

// 1. 创建 MCP Server 实例
const server = new McpServer({
    name: 'live2d-pet-server',
    version: '1.0.0'
});

// 2. 注册工具（用 Zod schema 定义参数）
server.registerTool(
    'get_system_info',
    {
        description: '获取系统信息：操作系统、CPU 核数、内存使用情况。',
        inputSchema: {} // 无参数
    },
    async () => ({
        content: [{
            type: 'text',
            text: JSON.stringify({
                platform: os.platform(),
                arch: os.arch(),
                cpus: os.cpus().length,
                totalMemory: Math.round(os.totalmem() / 1024 / 1024 / 1024) + ' GB',
                freeMemory: Math.round(os.freemem() / 1024 / 1024 / 1024) + ' GB',
                uptime: Math.round(os.uptime() / 3600) + ' 小时'
            })
        }]
    })
);

server.registerTool(
    'get_current_time',
    {
        description: '获取当前的日期和时间。',
        inputSchema: {}
    },
    async () => ({
        content: [{
            type: 'text',
            text: JSON.stringify({
                iso: new Date().toISOString(),
                local: new Date().toLocaleString('zh-CN'),
                timestamp: Date.now()
            })
        }]
    })
);

server.registerTool(
    'list_processes',
    {
        description: '列出当前系统上正在运行的进程（简化版，只返回前 20 个）。',
        inputSchema: {
            filter: z.string().optional().describe('可选的过滤关键词，比如 "node"')
        }
    },
    async ({ filter }) => {
        try {
            const out = execSync('tasklist /FO CSV /NH', {
                encoding: 'utf8',
                maxBuffer: 2 * 1024 * 1024
            });
            const lines = out.split('\n').filter(Boolean);
            const rows = lines
                .map(l => l.split('","').map(s => s.replace(/^"|"$/g, '')))
                .filter(cells => cells.length >= 2 && cells[0])
                .filter(cells => !filter || cells[0].toLowerCase().includes(filter.toLowerCase()))
                .slice(0, 20)
                .map(cells => `${cells[0]}  PID=${cells[1]}`);

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ count: rows.length, processes: rows })
                }]
            };
        } catch (err) {
            // 使用 isError: true 让模型知道调用失败
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ error: '无法列出进程：' + err.message })
                }],
                isError: true
            };
        }
    }
);

// 3. 连接 stdio 传输层
const transport = new StdioServerTransport();
server.connect(transport).then(() => {
    console.error('[MCP Server] ready (official SDK)');
});