/**
 * UserProfileViewer — 显示用户画像
 */
class UserProfileViewer {
    constructor() {
        this.el = {
            closeBtn: document.getElementById('close-btn'),
            content: document.getElementById('content')
        };
        this.init();
    }

    async init() {
        this.el.closeBtn.onclick = () => window.close();

        if (window.electronAPI?.onUserProfileUpdated) {
            window.electronAPI.onUserProfileUpdated(() => this.render());
        }
        // 每 5 秒刷新一次（简单可靠）
        setInterval(() => this.render(), 5000);

        await this.render();
    }

    async render() {
        try {
            const r = await window.electronAPI.agentLoadUserProfile();
            const data = r.success ? (r.data || {}) : {};
            this._renderProfile(data);
        } catch (e) {
            this.el.content.innerHTML = `<div class="empty">加载失败：${this._esc(e.message)}</div>`;
        }
    }

    _renderProfile(d) {
        const hasAny = d.name || d.occupation
            || (d.goals?.length) || (d.preferences?.length) || (d.background?.length);

        if (!hasAny) {
            this.el.content.innerHTML = `
                <div class="empty">
                    <span class="emoji">📭</span>
                    还没有画像数据<br><br>
                    和宠物聊几句，AI 会自动提取关于你的信息。
                </div>
            `;
            return;
        }

        const parts = [];

        if (d.name) {
            parts.push(`
                <div class="card">
                    <div class="card-title">名字</div>
                    <div class="card-value">${this._esc(d.name)}</div>
                </div>
            `);
        }
        if (d.occupation) {
            parts.push(`
                <div class="card">
                    <div class="card-title">身份</div>
                    <div class="card-value">${this._esc(d.occupation)}</div>
                </div>
            `);
        }
        if (d.goals?.length) {
            parts.push(`
                <div class="card">
                    <div class="card-title">目标</div>
                    <div class="tag-list">
                        ${d.goals.map(g => `<span class="tag">${this._esc(g)}</span>`).join('')}
                    </div>
                </div>
            `);
        }
        if (d.preferences?.length) {
            parts.push(`
                <div class="card">
                    <div class="card-title">偏好</div>
                    <div class="tag-list">
                        ${d.preferences.map(p => `<span class="tag">${this._esc(p)}</span>`).join('')}
                    </div>
                </div>
            `);
        }
        if (d.background?.length) {
            parts.push(`
                <div class="card">
                    <div class="card-title">背景</div>
                    <div class="tag-list">
                        ${d.background.map(b => `<span class="tag">${this._esc(b)}</span>`).join('')}
                    </div>
                </div>
            `);
        }

        if (d.updatedAt) {
            const t = new Date(d.updatedAt);
            parts.push(`
                <div class="card">
                    <div class="card-title">更新时间</div>
                    <div class="card-value" style="font-size:12px;color:#888;">
                        ${t.toLocaleString('zh-CN')}
                    </div>
                </div>
            `);
        }

        parts.push(`
            <div class="card">
                <div class="card-title">操作</div>
                <div class="actions">
                    <button class="btn btn-secondary" id="btn-refresh">刷新</button>
                    <button class="btn btn-danger" id="btn-clear">清空画像</button>
                </div>
            </div>
        `);

        this.el.content.innerHTML = parts.join('');
        document.getElementById('btn-refresh')?.addEventListener('click', () => this.render());
        document.getElementById('btn-clear')?.addEventListener('click', async () => {
            if (!confirm('确定清空用户画像吗？AI 将忘记关于你的一切。')) return;
            try {
                await window.electronAPI.agentClearUserProfile();
                // 通知所有窗口画像已清空
                for (const w of [window]) {
                    // 广播清理信号
                }
                await this.render();
            } catch (e) {
                alert('清空失败：' + e.message);
            }
        });
    }

    _esc(s) {
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
}

document.addEventListener('DOMContentLoaded', () => new UserProfileViewer());