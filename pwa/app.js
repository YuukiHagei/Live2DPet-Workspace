/**
 * Live2DPet PWA — 环境检查与 Service Worker 注册
 */
(function () {
    'use strict';

    // ========== 环境检查 ==========

    function setStatus(id, ok, text) {
        const dot = document.getElementById('dot-' + id);
        const val = document.getElementById('val-' + id);
        if (!dot || !val) return;
        dot.classList.remove('ok', 'warn', 'err');
        if (ok === true) dot.classList.add('ok');
        else if (ok === false) dot.classList.add('err');
        else dot.classList.add('warn');
        val.textContent = text;
    }

    // 1. HTTPS
    const isHttps = location.protocol === 'https:' || location.hostname === 'localhost';
    setStatus('https', isHttps, isHttps ? '已启用' : '未启用（部分 PWA 功能受限）');

    // 2. Manifest
    const manifestLink = document.querySelector('link[rel="manifest"]');
    setStatus('manifest', !!manifestLink, manifestLink ? '已加载' : '缺失');

    // 3. Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then((reg) => {
                console.log('[PWA] SW registered:', reg.scope);
                setStatus('sw', true, '已注册');
            })
            .catch((err) => {
                console.error('[PWA] SW register failed:', err);
                setStatus('sw', false, '注册失败：' + err.message);
            });
    } else {
        setStatus('sw', false, '浏览器不支持');
    }

    // 4. 安装事件监听
    let deferredPrompt = null;
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        setStatus('pwa', true, '可安装（点击浏览器菜单添加）');
    });

    // iOS Safari 判断是否已添加到主屏幕
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isStandalone = window.navigator.standalone === true;
    if (isIos && !isStandalone) {
        setStatus('pwa', true, 'iOS: 分享 → 添加到主屏幕');
    } else if (isStandalone) {
        setStatus('pwa', true, '已作为 App 运行');
    } else {
        setTimeout(() => {
            const dot = document.getElementById('dot-pwa');
            if (!dot.classList.contains('ok')) {
                setStatus('pwa', true, '已就绪');
            }
        }, 1000);
    }

    console.log('[PWA] Live2DPet PWA loaded');
})();