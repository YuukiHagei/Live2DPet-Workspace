class ObservationViewer {
    constructor() {
        this.contactsListEl = document.getElementById('contacts-list');
        this.obsListEl = document.getElementById('observations-list');
        this.contactCountEl = document.getElementById('contact-count');
        this.obsCountEl = document.getElementById('obs-count');
        this.init();
    }

    async init() {
        document.getElementById('close-btn').onclick = () => window.close();
        document.getElementById('refresh-btn').onclick = () => this.loadData();
        document.getElementById('clear-btn').onclick = () => this.clearData();

        if (window.electronAPI?.onObservationUpdated) {
            window.electronAPI.onObservationUpdated(() => this.loadData());
        }

        await this.loadData();
    }

    async loadData() {
        try {
            const r = await window.electronAPI.getObservationSnapshot();
            const data = r?.data || { observations: [], contacts: {} };
            this.render(data);
        } catch (err) {
            console.warn('[ObservationViewer] load failed:', err);
        }
    }

    render(data) {
        const contacts = data.contacts || {};
        const observations = Array.isArray(data.observations) ? data.observations : [];

        this.contactCountEl.textContent = Object.keys(contacts).length;
        this.obsCountEl.textContent = observations.length;

        // 渲染联系人（按次数降序）
        const sorted = Object.entries(contacts)
            .sort((a, b) => b[1].count - a[1].count);

        this.contactsListEl.innerHTML = '';
        if (sorted.length === 0) {
            const hint = document.createElement('div');
            hint.className = 'empty-hint';
            hint.textContent = '暂无数据';
            this.contactsListEl.appendChild(hint);
        } else {
            sorted.forEach(([name, c], idx) => {
                const item = document.createElement('div');
                item.className = 'contact-item';

                const rank = document.createElement('div');
                rank.className = 'rank' + (idx < 3 ? ` top${idx + 1}` : '');
                rank.textContent = idx + 1;

                const nameEl = document.createElement('div');
                nameEl.className = 'name';
                nameEl.textContent = name;
                nameEl.title = name;

                const countEl = document.createElement('span');
                countEl.className = 'count';
                countEl.textContent = c.count + ' 次';

                const lastEl = document.createElement('span');
                lastEl.className = 'last-seen';
                lastEl.textContent = this.formatLastSeen(c.lastSeen);

                item.appendChild(rank);
                item.appendChild(nameEl);
                item.appendChild(countEl);
                // 话题标签
                if (Array.isArray(c.topics) && c.topics.length > 0) {
                    const topicsEl = document.createElement('div');
                    topicsEl.className = 'topics';
                    for (const t of c.topics) {
                        const tag = document.createElement('span');
                        tag.className = 'topic-tag';
                        tag.textContent = t;
                        topicsEl.appendChild(tag);
                    }
                    item.appendChild(topicsEl);
                }
                item.appendChild(lastEl);
                this.contactsListEl.appendChild(item);
            });
        }

        // 渲染观察记录（最新的在上面）
        const recent = observations.slice().reverse().slice(0, 30);

        this.obsListEl.innerHTML = '';
        if (recent.length === 0) {
            const hint = document.createElement('div');
            hint.className = 'empty-hint';
            hint.textContent = '暂无数据';
            this.obsListEl.appendChild(hint);
        } else {
            for (const o of recent) {
                const item = document.createElement('div');
                item.className = 'obs-item' + (o.contact ? ' matched' : '');

                const timeEl = document.createElement('span');
                timeEl.className = 'time';
                timeEl.textContent = this.formatTime(o.time);

                const titleEl = document.createElement('span');
                titleEl.className = 'title';
                titleEl.textContent = o.title || '(无标题)';
                titleEl.title = o.title || '';

                item.appendChild(timeEl);
                item.appendChild(titleEl);

                if (o.contact) {
                    const tag = document.createElement('span');
                    tag.className = 'contact-tag';
                    tag.textContent = o.contact;
                    tag.title = o.contact;
                    item.appendChild(tag);
                }

                this.obsListEl.appendChild(item);
            }
        }
    }

    formatLastSeen(ts) {
        if (!ts) return '';
        const mins = Math.round((Date.now() - ts) / 60000);
        if (mins < 1) return '刚刚';
        if (mins < 60) return `${mins} 分钟前`;
        const hrs = Math.round(mins / 60);
        if (hrs < 24) return `${hrs} 小时前`;
        const days = Math.round(hrs / 24);
        if (days < 7) return `${days} 天前`;
        return '更早';
    }

    formatTime(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        const now = new Date();
        const isToday = d.toDateString() === now.toDateString();
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        if (isToday) return `${hh}:${mm}`;
        return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
    }

    async clearData() {
        if (!confirm('确定清空所有观察数据吗？\n\n这会清空：\n- 所有聊天窗口的观察记录\n- 所有联系人统计\n\n此操作不可撤销。')) {
            return;
        }
        try {
            await window.electronAPI.clearObservationData();
            setTimeout(() => this.loadData(), 300);
        } catch (e) {
            console.warn('[ObservationViewer] clear failed:', e);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => new ObservationViewer());