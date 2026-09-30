/**
 * Service Worker — 简单缓存优先策略
 */
const CACHE_NAME = 'live2dpet-pwa-v3';
const ASSETS = [
    './',
    './index.html',
    './app.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(ASSETS).catch((err) => {
                console.warn('[SW] Some assets failed to cache:', err);
            }))
            .then(() => self.skipWaiting())
    );
});

// 让页面主动触发 SW 更新
self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (url.origin !== location.origin) return;

    // 只对 HTML/JS/CSS/JSON 用网络优先
    const isAppCode = /\.(html|js|css|json)$/.test(url.pathname) || url.pathname.endsWith('/');

    if (isAppCode) {
        // 网络优先：联网时始终拿最新的，离线时用缓存
        event.respondWith(
            fetch(event.request).then((response) => {
                if (response.ok && event.request.method === 'GET') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                }
                return response;
            }).catch(() => {
                return caches.match(event.request).then((cached) => {
                    if (cached) return cached;
                    if (event.request.mode === 'navigate') return caches.match('./index.html');
                });
            })
        );
    } else {
        // 其他资源（图片、图标）：缓存优先
        event.respondWith(
            caches.match(event.request).then((cached) => {
                return cached || fetch(event.request).then((response) => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    }
                    return response;
                });
            })
        );
    }
});