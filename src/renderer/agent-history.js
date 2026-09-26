class AgentHistoryViewer {
    constructor() {
        this.summaryEl = document.getElementById('summary-text');
        this.messagesEl = document.getElementById('messages-area');
        this.recentCountEl = document.getElementById('recent-count');
        this.summaryLenEl = document.getElementById('summary-len');
        this.init();
    }

    async init() {
        document.getElementById('close-btn').onclick = () => window.close();
        document.getElementById('refresh-btn').onclick = () => this.loadData();
        document.getElementById('clear-btn').onclick = () => this.clearHistory();

        if (window.electronAPI?.onAgentHistoryUpdated) {
            window.electronAPI.onAgentHistoryUpdated(() => this.loadData());
        }

        await this.loadData();
    }

    async loadData() {
        try {
            const r = await window.electronAPI.getAgentHistorySnapshot();
            const data = r?.data || { summary: '', recent: [] };
            this.render(data);
        } catch (err) {
            console.warn('[AgentHistoryViewer] load failed:', err);
        }
    }

    render(data) {
        const summary = data.summary || '';
        const recent = Array.isArray(data.recent) ? data.recent : [];

        this.recentCountEl.textContent = recent.length;
        this.summaryLenEl.textContent = summary.length;

        if (summary) {
            this.summaryEl.textContent = summary;
            this.summaryEl.classList.remove('empty');
        } else {
            this.summaryEl.textContent = '暂无摘要';
            this.summaryEl.classList.add('empty');
        }

        this.messagesEl.innerHTML = '';
        if (recent.length === 0) {
            const hint = document.createElement('div');
            hint.className = 'empty-hint';
            hint.textContent = '暂无最近消息';
            this.messagesEl.appendChild(hint);
            return;
        }

        for (const msg of recent) {
            const item = document.createElement('div');
            item.className = 'msg-item ' + (msg.role || 'assistant');

            const roleEl = document.createElement('div');
            roleEl.className = 'msg-role';
            roleEl.textContent = msg.role === 'user' ? '👤 用户' : '🤖 AI';

            const contentEl = document.createElement('div');
            contentEl.className = 'msg-content';
            contentEl.textContent = msg.content || '(空)';

            item.appendChild(roleEl);
            item.appendChild(contentEl);
            this.messagesEl.appendChild(item);
        }
    }

    async clearHistory() {
        if (!confirm('确定要清空 Agent 对话历史吗？此操作不可撤销。')) return;
        try {
            await window.electronAPI.clearAgentHistory();
            // 等待数据同步
            setTimeout(() => this.loadData(), 300);
        } catch (err) {
            console.warn('[AgentHistoryViewer] clear failed:', err);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => new AgentHistoryViewer());