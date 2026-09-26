/**
 * FlashcardReview — 独立复习窗口（支持复习/列表/编辑三视图）
 */
class FlashcardReview {
    constructor() {
        this.cards = [];            // 全部待复习
        this.queue = [];            // 当前复习队列
        this.index = 0;
        this.showingBack = false;
        this.ratedCount = 0;
        this.startTime = Date.now();

        // 视图状态
        this.viewMode = 'review';   // 'review' | 'list'
        this.editing = false;
        this.editingSource = null;  // 'review' | 'list'
        this.editingCard = null;
        this.isCreating = false;    // 是否在新建模式

        // 列表数据
        this.allCards = [];
        this.listSearch = '';
        this.listFilter = 'all';

        // DOM
        this.el = {
            closeBtn: document.getElementById('close-btn'),
            showListBtn: document.getElementById('btn-show-list'),
            progressArea: document.getElementById('progress-area'),
            cardArea: document.getElementById('card-area'),
            listPanel: document.getElementById('list-panel'),
            listSearch: document.getElementById('list-search'),
            listFilter: document.getElementById('list-filter'),
            listItems: document.getElementById('list-items'),
            newCardBtn: document.getElementById('btn-new-card'),
            card: document.getElementById('card'),
            cardSubject: document.getElementById('card-subject'),
            cardTags: document.getElementById('card-tags'),
            cardFront: document.getElementById('card-front'),
            cardBack: document.getElementById('card-back'),
            cardHint: document.getElementById('card-hint'),
            ratingArea: document.getElementById('rating-area'),
            progressLabel: document.getElementById('progress-label'),
            progressFill: document.getElementById('progress-fill'),
            progressStats: document.getElementById('progress-stats'),
            skipBtn: document.getElementById('btn-skip'),
            endBtn: document.getElementById('btn-end'),
            editBtn: document.getElementById('btn-edit'),
            ratingBtns: document.querySelectorAll('.rating-btn'),
            editPanel: document.getElementById('edit-panel'),
            editFront: document.getElementById('edit-front'),
            editBack: document.getElementById('edit-back'),
            editSubject: document.getElementById('edit-subject'),
            editTags: document.getElementById('edit-tags'),
            saveEditBtn: document.getElementById('btn-save-edit'),
            cancelEditBtn: document.getElementById('btn-cancel-edit')
        };

        this.init();
    }

    async init() {
        this.bindEvents();
        await this.loadCards();
    }

    bindEvents() {
        this.el.closeBtn.onclick = () => this.close();
        this.el.endBtn.onclick = () => {
            if (this.viewMode === 'list') this.showReviewView();
            else this.close();
        };
        this.el.showListBtn.onclick = () => this.showListView();
        this.el.skipBtn.onclick = () => this.skip();
        this.el.editBtn.onclick = () => this.enterEditMode(this.queue[this.index], 'review');
        this.el.card.onclick = () => this.flip();
        this.el.saveEditBtn.onclick = () => this.saveEdit();
        this.el.cancelEditBtn.onclick = () => this.cancelEdit();
        this.el.listSearch.oninput = (e) => {
            this.listSearch = e.target.value.trim().toLowerCase();
            this.renderListView();
        };
        this.el.listFilter.onchange = (e) => {
            this.listFilter = e.target.value;
            this.renderListView();
        };
        this.el.newCardBtn.onclick = () => this.enterCreateMode();

        this.el.ratingBtns.forEach(btn => {
            btn.onclick = () => this.rate(btn.dataset.rating);
        });

        document.addEventListener('keydown', (e) => {
            if (this.editing) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    this.cancelEdit();
                }
                return;
            }
            if (this.viewMode === 'list') {
                if (e.key === 'Escape') this.close();
                return;
            }
            if (e.key === 'Escape') {
                this.close();
            } else if (e.key === ' ' || e.key === 'Spacebar') {
                e.preventDefault();
                this.flip();
            } else if (['1', '2', '3', '4'].includes(e.key)) {
                const rating = ['again', 'hard', 'good', 'easy'][Number(e.key) - 1];
                this.rate(rating);
            }
        });
    }

    // ========== 复习视图 ==========

    async loadCards() {
        try {
            const r = await window.electronAPI.agentGetDueCards({ limit: 100 });
            if (!r.success) throw new Error(r.error);
            this.cards = r.cards || [];
            this.queue = [...this.cards];
            this.index = 0;

            if (this.cards.length === 0) {
                this.renderEmpty();
                return;
            }
            this.renderReviewView();
        } catch (err) {
            console.error('[Review] load failed:', err);
            this.renderError(err.message);
        }
    }

    renderEmpty() {
        this.el.progressArea.style.display = 'none';
        this.el.ratingArea.style.display = 'none';
        this.el.cardArea.style.display = '';
        this.el.cardArea.innerHTML = `
            <div class="empty-state">
                <div class="icon">🎉</div>
                <div class="title">今天没有要复习的卡片</div>
                <div class="subtitle">点右上角「📋 全部卡片」可以浏览/编辑所有卡片</div>
            </div>
        `;
        this.el.skipBtn.style.display = 'none';
        this.el.editBtn.style.display = 'none';
        this.el.endBtn.textContent = '关闭';
    }

    renderError(msg) {
        this.el.progressArea.style.display = 'none';
        this.el.ratingArea.style.display = 'none';
        this.el.cardArea.style.display = '';
        this.el.cardArea.innerHTML = `
            <div class="empty-state">
                <div class="icon">⚠️</div>
                <div class="title">加载失败</div>
                <div class="subtitle">${msg}</div>
            </div>
        `;
        this.el.skipBtn.style.display = 'none';
        this.el.editBtn.style.display = 'none';
        this.el.endBtn.textContent = '关闭';
    }

    renderReviewView() {
        if (this.index >= this.queue.length) {
            this.renderComplete();
            return;
        }

        const card = this.queue[this.index];
        this.el.cardArea.style.display = '';
        this.el.cardArea.innerHTML = this._cardHtml();
        // 重新获取 DOM（因为 innerHTML 重建了）
        this.el.card = document.getElementById('card');
        this.el.cardSubject = document.getElementById('card-subject');
        this.el.cardTags = document.getElementById('card-tags');
        this.el.cardFront = document.getElementById('card-front');
        this.el.cardBack = document.getElementById('card-back');
        this.el.cardHint = document.getElementById('card-hint');
        this.el.card.onclick = () => this.flip();

        this.el.progressArea.style.display = '';
        this.el.progressLabel.textContent = `${this.index + 1} / ${this.queue.length}`;
        this.el.progressStats.textContent = `已评 ${this.ratedCount} 张`;
        this.el.progressFill.style.width = `${(this.index / this.queue.length) * 100}%`;

        this.renderCardContent(card);

        this.el.ratingArea.style.display = '';
        this.el.skipBtn.style.display = '';
        this.el.editBtn.style.display = '';
    }

    _cardHtml() {
        return `
            <div class="card" id="card">
                <div class="card-subject" id="card-subject" style="display:none"></div>
                <div class="card-tags" id="card-tags"></div>
                <div class="card-front" id="card-front"></div>
                <div class="card-back" id="card-back" style="display:none"></div>
                <div class="card-hint" id="card-hint">点击卡片 或 按空格 显示答案</div>
            </div>
        `;
    }

    renderCardContent(card) {
        this.showingBack = false;
        this.el.cardFront.textContent = card.front;
        this.el.cardBack.textContent = card.back;
        this.el.cardBack.style.display = 'none';
        this.el.cardHint.textContent = '点击卡片 或 按空格 显示答案';
        this.el.cardHint.style.display = '';

        if (card.subject) {
            this.el.cardSubject.textContent = card.subject;
            this.el.cardSubject.style.display = '';
        } else {
            this.el.cardSubject.style.display = 'none';
        }
        this.el.cardTags.innerHTML = '';
        if (card.tags && card.tags.length > 0) {
            for (const t of card.tags) {
                const span = document.createElement('span');
                span.className = 'card-tag';
                span.textContent = t;
                this.el.cardTags.appendChild(span);
            }
        }
        this.setRatingEnabled(false);
    }

    renderComplete() {
        this.el.progressArea.style.display = 'none';
        this.el.ratingArea.style.display = 'none';
        this.el.cardArea.style.display = '';
        const elapsed = Math.round((Date.now() - this.startTime) / 1000);
        const min = Math.floor(elapsed / 60);
        const sec = elapsed % 60;
        const timeStr = min > 0 ? `${min} 分 ${sec} 秒` : `${sec} 秒`;

        this.el.cardArea.innerHTML = `
            <div class="empty-state">
                <div class="icon">✅</div>
                <div class="title">复习完成！</div>
                <div class="subtitle">本次复习 ${this.ratedCount} 张，耗时 ${timeStr}</div>
                <div class="subtitle" style="margin-top:8px;">点右上角「📋 全部卡片」可以浏览/编辑</div>
            </div>
        `;
        this.el.skipBtn.style.display = 'none';
        this.el.editBtn.style.display = 'none';
        this.el.endBtn.textContent = '关闭';
    }

    flip() {
        if (this.index >= this.queue.length) return;
        if (this.showingBack) return;
        this.showingBack = true;
        this.el.cardBack.style.display = '';
        this.el.cardHint.textContent = '按 1 / 2 / 3 / 4 或点击下方按钮评分';
        this.setRatingEnabled(true);
    }

    setRatingEnabled(enabled) {
        this.el.ratingBtns.forEach(btn => { btn.disabled = !enabled; });
    }

    skip() {
        if (this.index >= this.queue.length) return;
        const card = this.queue.splice(this.index, 1)[0];
        this.queue.push(card);
        if (this.queue.length === 1) this.index = 0;
        this.renderReviewView();
    }

    async rate(rating) {
        if (!this.showingBack) return;
        if (this.index >= this.queue.length) return;

        const card = this.queue[this.index];
        try {
            const r = await window.electronAPI.agentReviewFlashcard({
                idOrFront: card.id,
                rating
            });
            if (!r.success) {
                console.error('[Review] rate failed:', r.error);
                return;
            }
            this.ratedCount++;
            this.queue.splice(this.index, 1);
            this.renderReviewView();
        } catch (err) {
            console.error('[Review] rate exception:', err);
        }
    }

    // ========== 列表视图 ==========

    async showListView() {
        // 保存当前视图状态
        this._prevView = this.viewMode;
        this.viewMode = 'list';

        // 隐藏复习视图元素
        this.el.cardArea.style.display = 'none';
        this.el.progressArea.style.display = 'none';
        this.el.ratingArea.style.display = 'none';
        this.el.editPanel.style.display = 'none';
        this.el.skipBtn.style.display = 'none';
        this.el.editBtn.style.display = 'none';

        // 显示列表视图
        this.el.listPanel.style.display = 'flex';
        this.el.endBtn.textContent = '◀ 返回复习';

        // 加载所有卡片
        await this.loadAllCards();
    }

    showReviewView() {
        this.viewMode = 'review';
        this.el.listPanel.style.display = 'none';
        this.el.endBtn.textContent = '结束复习';
        this.renderReviewView();
    }

    async loadAllCards() {
        try {
            const r = await window.electronAPI.agentListFlashcards({ limit: 500 });
            if (!r.success) throw new Error(r.error);
            this.allCards = r.cards || [];
            this.renderListView();
        } catch (err) {
            console.error('[Review] loadAll failed:', err);
            this.el.listItems.innerHTML = `<div class="list-empty">加载失败：${err.message}</div>`;
        }
    }

    renderListView() {
        const now = Date.now();
        let list = this.allCards.slice();

        // 过滤
        if (this.listFilter === 'due') {
            list = list.filter(c => c.dueAt <= now);
        }
        // 搜索
        if (this.listSearch) {
            const q = this.listSearch;
            list = list.filter(c =>
                (c.front || '').toLowerCase().includes(q) ||
                (c.back || '').toLowerCase().includes(q)
            );
        }
        // 排序：到期优先，其次按创建时间倒序
        list.sort((a, b) => {
            const aDue = a.dueAt <= now ? 0 : 1;
            const bDue = b.dueAt <= now ? 0 : 1;
            if (aDue !== bDue) return aDue - bDue;
            return (b.createdAt || 0) - (a.createdAt || 0);
        });

        if (list.length === 0) {
            this.el.listItems.innerHTML = `<div class="list-empty">${this.allCards.length === 0 ? '还没有任何卡片' : '没有匹配的卡片'}</div>`;
            return;
        }

        this.el.listItems.innerHTML = '';
        for (const card of list) {
            const item = document.createElement('div');
            item.className = 'list-item';

            const main = document.createElement('div');
            main.className = 'li-main';

            const front = document.createElement('div');
            front.className = 'li-front';
            front.textContent = card.front;
            main.appendChild(front);

            const meta = document.createElement('div');
            meta.className = 'li-meta';

            if (card.subject) {
                const subj = document.createElement('span');
                subj.className = 'li-subject';
                subj.textContent = card.subject;
                meta.appendChild(subj);
            }
            if (card.tags && card.tags.length > 0) {
                for (const t of card.tags) {
                    const tag = document.createElement('span');
                    tag.className = 'li-tag';
                    tag.textContent = t;
                    meta.appendChild(tag);
                }
            }

            const due = document.createElement('span');
            due.className = 'li-due' + (card.dueAt <= now ? ' overdue' : '');
            if (card.dueAt <= now) {
                due.textContent = '🔴 到期';
            } else {
                due.textContent = '📅 ' + new Date(card.dueAt).toLocaleDateString('zh-CN');
            }
            meta.appendChild(due);

            main.appendChild(meta);
            item.appendChild(main);

            // 删除按钮
            const del = document.createElement('button');
            del.className = 'li-del';
            del.textContent = '×';
            del.title = '删除这张卡';
            del.onclick = (e) => {
                e.stopPropagation();
                this.deleteCardFromList(card);
            };
            item.appendChild(del);

            // 点击进入编辑
            item.onclick = () => this.enterEditMode(card, 'list');

            this.el.listItems.appendChild(item);
        }
    }

    // ========== 编辑视图 ==========

    enterEditMode(card, source) {
        if (!card) return;
        this.editing = true;
        this.isCreating = false;
        this.editingSource = source;
        this.editingCard = card;

        // 填充表单
        this.el.editFront.value = card.front;
        this.el.editBack.value = card.back;
        this.el.editSubject.value = card.subject || '';
        this.el.editTags.value = (card.tags || []).join(', ');

        // 隐藏所有视图，显示编辑面板
        this.el.cardArea.style.display = 'none';
        this.el.listPanel.style.display = 'none';
        this.el.progressArea.style.display = 'none';
        this.el.ratingArea.style.display = 'none';
        this.el.skipBtn.style.display = 'none';
        this.el.editBtn.style.display = 'none';

        // 编辑面板放进 cardArea 显示
        this.el.cardArea.style.display = 'flex';
        this.el.cardArea.innerHTML = '';
        this.el.cardArea.appendChild(this.el.editPanel);
        this.el.editPanel.style.display = 'flex';

        this.el.endBtn.textContent = '取消编辑';
        this.el.endBtn.onclick = () => this.cancelEdit();

        setTimeout(() => this.el.editFront.focus(), 50);
    }

    enterCreateMode() {
        this.editing = true;
        this.isCreating = true;
        this.editingSource = 'list';
        this.editingCard = null;

        // 清空表单
        this.el.editFront.value = '';
        this.el.editBack.value = '';
        this.el.editSubject.value = '';
        this.el.editTags.value = '';

        // 隐藏所有视图
        this.el.cardArea.style.display = 'none';
        this.el.listPanel.style.display = 'none';
        this.el.progressArea.style.display = 'none';
        this.el.ratingArea.style.display = 'none';
        this.el.skipBtn.style.display = 'none';
        this.el.editBtn.style.display = 'none';

        // 显示编辑面板
        this.el.cardArea.style.display = 'flex';
        this.el.cardArea.innerHTML = '';
        this.el.cardArea.appendChild(this.el.editPanel);
        this.el.editPanel.style.display = 'flex';

        this.el.endBtn.textContent = '取消';
        this.el.endBtn.onclick = () => this.cancelEdit();

        setTimeout(() => this.el.editFront.focus(), 50);
    }

    cancelEdit() {
        this.editing = false;
        this.isCreating = false;
        const source = this.editingSource;
        this.editingSource = null;
        this.editingCard = null;

        this.el.editPanel.style.display = 'none';
        // 把编辑面板移出 cardArea，避免下次渲染被清掉
        document.body.appendChild(this.el.editPanel);

        // 恢复 endBtn 默认行为
        this.el.endBtn.onclick = () => {
            if (this.viewMode === 'list') this.showReviewView();
            else this.close();
        };

        if (source === 'list') {
            this.showListView();
        } else {
            this.showReviewView();
        }
    }

    async saveEdit() {
        const front = this.el.editFront.value.trim();
        const back = this.el.editBack.value.trim();
        if (!front) { alert('正面不能为空'); return; }
        if (!back) { alert('背面不能为空'); return; }

        const subject = this.el.editSubject.value.trim();
        const tagsRaw = this.el.editTags.value;
        const tags = tagsRaw.split(',').map(s => s.trim()).filter(Boolean);

        const isCreating = this.isCreating;
        const card = this.editingCard;

        this.el.saveEditBtn.disabled = true;
        this.el.saveEditBtn.textContent = '保存中...';

        try {
            let r;
            if (isCreating) {
                // 新建
                r = await window.electronAPI.agentAddFlashcard({ front, back, subject, tags });
                if (!r.success) {
                    alert('创建失败：' + r.error);
                    return;
                }
                if (r.duplicate) {
                    this._showToast('已存在相同正面卡片');
                } else {
                    this._showToast('已创建');
                }
            } else {
                // 修改
                if (!card) return;
                r = await window.electronAPI.agentUpdateFlashcard({
                    idOrFront: card.id,
                    front, back, subject, tags
                });
                if (!r.success) {
                    alert('保存失败：' + r.error);
                    return;
                }
                // 同步更新队列里的对象
                const inQueue = this.queue.find(c => c.id === card.id);
                if (inQueue) Object.assign(inQueue, r.card);
                // 同步更新 allCards
                const inAll = this.allCards.find(c => c.id === card.id);
                if (inAll) Object.assign(inAll, r.card);
                this._showToast('已保存');
            }

            // 退出编辑
            this.editing = false;
            this.isCreating = false;
            const source = this.editingSource;
            this.editingSource = null;
            this.editingCard = null;
            this.el.editPanel.style.display = 'none';
            document.body.appendChild(this.el.editPanel);

            // 恢复 endBtn
            this.el.endBtn.onclick = () => {
                if (this.viewMode === 'list') this.showReviewView();
                else this.close();
            };

            if (source === 'list') {
                // 重新加载列表（新建后需要刷新）
                await this.loadAllCards();
                this.showListView();
            } else {
                this.showReviewView();
            }
        } catch (err) {
            alert('保存异常：' + err.message);
        } finally {
            this.el.saveEditBtn.disabled = false;
            this.el.saveEditBtn.textContent = '保存修改';
        }
    }

    async deleteCardFromList(card) {
        if (!confirm(`确定删除这张卡吗？\n\n${card.front.slice(0, 60)}`)) return;
        try {
            const r = await window.electronAPI.agentDeleteFlashcard({ idOrFront: card.id });
            if (!r.success) {
                alert('删除失败：' + r.error);
                return;
            }
            // 从列表里移除
            this.allCards = this.allCards.filter(c => c.id !== card.id);
            this.queue = this.queue.filter(c => c.id !== card.id);
            this.renderListView();
            this._showToast('已删除');
        } catch (err) {
            alert('删除异常：' + err.message);
        }
    }

    _showToast(msg) {
        const el = document.createElement('div');
        el.textContent = msg;
        el.style.cssText = `
            position: fixed; top: 60px; left: 50%; transform: translateX(-50%);
            background: rgba(0,0,0,0.75); color: #fff; padding: 6px 16px;
            border-radius: 16px; font-size: 12px; z-index: 9999;
            animation: fadeIn 0.2s ease;
        `;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 1500);
    }

    close() {
        window.close();
    }
}

document.addEventListener('DOMContentLoaded', () => new FlashcardReview());