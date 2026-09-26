class PetChatBubble {
    constructor() {
        this.messagesElement = document.getElementById('messages');
        this.inputElement = document.getElementById('user-input');
        this.sendButton = document.getElementById('send-btn');
        this.closeButton = document.getElementById('close-btn');
        this.modeToggleBtn = document.getElementById('mode-toggle');
        this.agentModeType = 'chat';   // 'chat' | 'agent' | 'plan'
        this.clearMemoryBtn = document.getElementById('clear-memory-btn');
        this.autoCloseTimer = null;
        this.isChatMode = false;
        this.history = this.loadHistory();   // 从 localStorage 恢复
        this.init();
    }

    loadHistory() {
        try {
            const raw = localStorage.getItem('live2dpet_chat_history');
            if (!raw) return [];
            const arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr : [];
        } catch { return []; }
    }

    saveHistory() {
        try {
            localStorage.setItem('live2dpet_chat_history', JSON.stringify(this.history));
        } catch (e) {
            console.warn('[Chat] saveHistory failed:', e);
        }
    }

    async init() {
        const frame = document.querySelector('.chat-frame');
        if (frame) frame.style.display = 'none';
        await this.loadBubbleFrame();
        this.setupEventListeners();

        // ★ 检查 URL 参数，决定进入哪个模式
        const params = new URLSearchParams(window.location.search);
        if (params.get('mode') === 'chat') {
            console.log('[Chat] Detected chat mode from URL');
            this.enterChatMode();
                // 恢复 Agent 模式状态
                if (window.electronAPI?.getAgentMode) {
                    window.electronAPI.getAgentMode().then(r => {
                        this.agentModeType = r.mode || 'chat';
                        this.updateModeUI();
                    });
                }
        }
    }

    async loadBubbleFrame() {
        try {
            if (window.electronAPI && window.electronAPI.loadConfig) {
                const config = await window.electronAPI.loadConfig();
                if (config.bubble && config.bubble.frameImagePath) {
                    const frameBg = document.querySelector('.frame-bg');
                    if (frameBg) frameBg.src = config.bubble.frameImagePath;
                }
            }
        } catch (e) {
            console.warn('[Chat] Failed to load bubble config:', e);
        }
    }

    setupEventListeners() {
        if (window.electronAPI && window.electronAPI.onChatBubbleMessage) {
            window.electronAPI.onChatBubbleMessage(data => {
                this.handleIncomingMessage(data.message, data.autoCloseTime, data.proactive);
            });
        }

        if (window.electronAPI && window.electronAPI.onExitChatMode) {
            window.electronAPI.onExitChatMode(() => {
                this.isChatMode = false;
                // 不清空 this.history，下次打开能恢复
            });
        }

        if (this.sendButton) {
            this.sendButton.addEventListener('click', () => this.sendUserMessage());
        }

        if (this.closeButton) {
            this.closeButton.addEventListener('click', () => this.fadeOut());
        }
        
        if (this.modeToggleBtn) {
            this.modeToggleBtn.addEventListener('click', () => this.toggleAgentMode());
        }

        if (this.clearMemoryBtn) {
            this.clearMemoryBtn.addEventListener('click', () => this.clearMemory());
        }

        if (window.electronAPI && window.electronAPI.onClearChatMemory) {
            window.electronAPI.onClearChatMemory(() => {
                this.history = [];
                this.saveHistory();
                this.messagesElement.innerHTML = '';
                console.log('[Chat] 清空完成');
            });
        }

        if (window.electronAPI && window.electronAPI.onAgentModeChange) {
            window.electronAPI.onAgentModeChange((mode) => {
                if (typeof mode === 'boolean') mode = mode ? 'agent' : 'chat';
                this.agentModeType = mode;
                this.updateModeUI();
            });
        }

        if (window.electronAPI && window.electronAPI.onPlanApprovalRequest) {
            window.electronAPI.onPlanApprovalRequest(({ reqId, planText }) => {
                this.appendPlanCard(reqId, planText);
            });
        }

        if (window.electronAPI && window.electronAPI.onChatStatus) {
            window.electronAPI.onChatStatus(data => {
                this.appendStatus(data.icon, data.text);
            });
        }

        if (window.electronAPI && window.electronAPI.onConfirmationRequest) {
            window.electronAPI.onConfirmationRequest(data => {
                this.appendConfirmation(data.reqId, data.tool, data.args);
            });
        }

        if (this.inputElement) {
            this.inputElement.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.sendUserMessage();
                }
            });
        }

        // 全局 ESC 关闭
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                this.fadeOut();
            }
        });

        // 滚轮滚动消息区
        document.addEventListener('wheel', (e) => {
            if (this.messagesElement) {
                this.messagesElement.scrollTop += e.deltaY;
            }
        }, { passive: false });
    }

    enterChatMode() {
        this.isChatMode = true;
        // ★ 重新读，可能被 AI 主动说话更新过
        this.history = this.loadHistory();
        const frame = document.querySelector('.chat-frame');
        frame.style.display = 'flex';
        frame.classList.remove('fade-out');
        frame.classList.add('chat-mode');

        if (this.autoCloseTimer) {
            clearTimeout(this.autoCloseTimer);
            this.autoCloseTimer = null;
        }

        // 从 history 恢复（不清空历史）
        this.renderHistory();

        this.inputElement.disabled = false;
        this.sendButton.disabled = false;
        setTimeout(() => this.inputElement?.focus(), 200);
    }

    renderHistory() {
        this.messagesElement.innerHTML = '';
        for (const msg of this.history) {
            this.appendMessage(msg.role, msg.text, false, msg.proactive === true);
        }
        this.scrollToBottom();
    }

    handleIncomingMessage(message, autoCloseTime = 8000, proactive = false) {
        this.history = this.loadHistory();

        if (this.isChatMode) {
            // 对话模式：追加到列表（主动消息用不同样式）
            this.appendMessage('assistant', message, true, proactive);
            this.inputElement.disabled = false;
            this.sendButton.disabled = false;
            this.inputElement.focus();
            this.scrollToBottom();
        } else {
            // 小气泡模式：显示一条
            this.messagesElement.innerHTML = '';
            this.appendMessage('assistant', message, true, false);
            const frame = document.querySelector('.chat-frame');
            frame.style.display = 'flex';
            frame.classList.remove('fade-out');
            frame.classList.remove('chat-mode');
            if (this.autoCloseTimer) clearTimeout(this.autoCloseTimer);
            if (autoCloseTime > 0) {
                this.autoCloseTimer = setTimeout(() => this.fadeOut(), autoCloseTime);
            }
            this.scrollToBottom();
        }
    }

    appendMessage(role, text, saveToHistory, proactive = false) {
        const el = document.createElement('div');
        el.className = 'message ' + role + (proactive ? ' proactive' : '');
        el.textContent = text;
        this.messagesElement.appendChild(el);
        if (saveToHistory) {
            this.history.push({ role, text, proactive });
            if (this.history.length > 50) {
                this.history = this.history.slice(-50);
            }
            this.saveHistory();
        }
    }

    appendStatus(icon, text) {
        // 只在对话模式下显示状态，小气泡模式忽略
        if (!this.isChatMode) return;
        const el = document.createElement('div');
        el.className = 'message status';
        const t = (text || '');
        if (t.startsWith('✅') || t.startsWith('完成') || t.startsWith('成功')) el.classList.add('success');
        if (t.startsWith('❌') || t.startsWith('失败') || t.startsWith('错误')) el.classList.add('error');
        el.textContent = `${icon} ${t}`;
        this.messagesElement.appendChild(el);
        this.scrollToBottom();
    }

    appendConfirmation(reqId, tool, args) {
        if (!this.isChatMode) return;
        const card = document.createElement('div');
        card.className = 'confirm-card';
        card.dataset.reqId = reqId;

        const title = document.createElement('div');
        title.className = 'confirm-title';
        title.textContent = `⚠️ Agent 想执行：${tool}`;
        card.appendChild(title);

        const argsEl = document.createElement('div');
        argsEl.className = 'confirm-args';
        argsEl.textContent = args || '(无参数)';
        card.appendChild(argsEl);

        const btnRow = document.createElement('div');
        btnRow.className = 'confirm-btns';

        const allowBtn = document.createElement('button');
        allowBtn.className = 'btn-allow';
        allowBtn.textContent = '允许';
        allowBtn.onclick = () => {
            card.classList.add('resolved');
            const r = document.createElement('div');
            r.className = 'confirm-result';
            r.textContent = '✅ 已允许';
            card.appendChild(r);
            window.electronAPI.respondConfirmation(reqId, true);
        };

        const denyBtn = document.createElement('button');
        denyBtn.className = 'btn-deny';
        denyBtn.textContent = '拒绝';
        denyBtn.onclick = () => {
            card.classList.add('resolved');
            const r = document.createElement('div');
            r.className = 'confirm-result';
            r.textContent = '❌ 已拒绝';
            card.appendChild(r);
            window.electronAPI.respondConfirmation(reqId, false);
        };

        btnRow.appendChild(allowBtn);
        btnRow.appendChild(denyBtn);
        card.appendChild(btnRow);

        this.messagesElement.appendChild(card);
        this.scrollToBottom();
    }

    scrollToBottom() {
        if (this.messagesElement) {
            this.messagesElement.scrollTop = this.messagesElement.scrollHeight;
        }
    }

    async sendUserMessage() {
        const text = this.inputElement.value.trim();
        if (!text) return;

        // 立即显示并记入历史
        this.appendMessage('user', text, true);
        this.scrollToBottom();

        this.inputElement.value = '';
        this.inputElement.disabled = true;
        this.sendButton.disabled = true;

        if (this.autoCloseTimer) {
            clearTimeout(this.autoCloseTimer);
            this.autoCloseTimer = null;
        }

        try {
            await window.electronAPI.sendUserMessage(text);
        } catch (e) {
            console.warn('[Chat] Send failed:', e);
            this.inputElement.disabled = false;
            this.sendButton.disabled = false;
            this.appendMessage('assistant', '发送失败，请重试', true);
            this.scrollToBottom();
        }
    }

    async clearMemory() {
        if (!confirm('确定清空对话记忆吗？\n\n这会清空：\n- 对话栏显示的所有历史\n- AI 对你的长期记忆（名字、身份、偏好等）\n- 最近对话上下文\n\n（不会清空"观察数据"，如需清空请在观察窗口操作）\n\n此操作不可撤销。')) {
            return;
        }
        try {
            await window.electronAPI.clearChatMemory();
        } catch (e) {
            console.warn('[Chat] clear failed:', e);
        }
    }
    
    toggleAgentMode() {
        const order = ['chat', 'agent', 'plan'];
        const idx = order.indexOf(this.agentModeType);
        this.agentModeType = order[(idx + 1) % 3];
        window.electronAPI.setAgentMode(this.agentModeType);
        this.updateModeUI();
    }

    updateModeUI() {
        if (!this.modeToggleBtn) return;
        const icons = { chat: '💬', agent: '🤖', plan: '📋' };
        const titles = { chat: '普通对话', agent: 'Agent 模式', plan: '规划模式（先列计划）' };
        const placeholders = {
            chat: '说点什么...',
            agent: 'Agent 模式：描述你的任务...',
            plan: '规划模式：描述你的任务，AI 先列计划'
        };
        this.modeToggleBtn.textContent = icons[this.agentModeType] || '💬';
        this.modeToggleBtn.title = titles[this.agentModeType] || '普通对话';
        this.modeToggleBtn.classList.toggle('active', this.agentModeType !== 'chat');
        this.inputElement.placeholder = placeholders[this.agentModeType] || '说点什么...';
    }

    appendPlanCard(reqId, planText) {
        if (!this.isChatMode) return;
        const card = document.createElement('div');
        card.className = 'plan-card';
        card.dataset.reqId = reqId;

        const title = document.createElement('div');
        title.className = 'plan-title';
        title.textContent = '📋 执行计划';
        card.appendChild(title);

        const content = document.createElement('div');
        content.className = 'plan-content';
        content.textContent = planText;
        card.appendChild(content);

        const btnRow = document.createElement('div');
        btnRow.className = 'plan-btns';

        const approveBtn = document.createElement('button');
        approveBtn.className = 'btn-approve';
        approveBtn.textContent = '批准';
        approveBtn.onclick = () => {
            card.classList.add('resolved');
            const r = document.createElement('div');
            r.className = 'plan-result';
            r.textContent = '✅ 已批准，开始执行';
            card.appendChild(r);
            window.electronAPI.respondPlanApproval(reqId, true);
        };

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn-cancel';
        cancelBtn.textContent = '取消';
        cancelBtn.onclick = () => {
            card.classList.add('resolved');
            const r = document.createElement('div');
            r.className = 'plan-result';
            r.textContent = '❌ 已取消';
            card.appendChild(r);
            window.electronAPI.respondPlanApproval(reqId, false);
        };

        btnRow.appendChild(approveBtn);
        btnRow.appendChild(cancelBtn);
        card.appendChild(btnRow);

        this.messagesElement.appendChild(card);
        this.scrollToBottom();
    }
    fadeOut() {
        // 关闭时把 isChatMode 复位，但保留 history
        this.isChatMode = false;
        const frame = document.querySelector('.chat-frame');
        frame.classList.add('fade-out');
        setTimeout(() => {
            if (window.electronAPI && window.electronAPI.closeChatBubble) {
                window.electronAPI.closeChatBubble();
            }
        }, 300);
    }
}

document.addEventListener('DOMContentLoaded', () => new PetChatBubble());