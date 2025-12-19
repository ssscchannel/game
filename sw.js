/* * 晟自然輔助系統 - Service Worker (V14-P1 Enhanced)
 * 功能：離線快取策略 + 動態資源快取 (Dynamic Caching)
 * 說明：除了核心檔案，也會自動快取讀取過的圖片 (如器材資料夾)
 */

const CACHE_NAME = 'cheng-game-v14-p1-cache-v2'; // 版本號升級為 v2
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './data.json',
    './manifest.json',
    './logo.jpg',
    './page.jpg',
    './icon-192.png',
    './icon-512.png'
];

// 1. 安裝：快取核心檔案
self.addEventListener('install', (event) => {
    console.log('[SW] Installing Service Worker...');
    // 強制立即接管控制權，不用等下次重整
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Caching core assets');
                return cache.addAll(ASSETS_TO_CACHE);
            })
    );
});

// 2. 啟動：清除舊快取
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating Service Worker...');
    event.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) {
                    console.log('[SW] Removing old cache', key);
                    return caches.delete(key);
                }
            }));
        })
    );
    // 讓 Service Worker 立即控制所有頁面
    return self.clients.claim();
});

// 3. 攔截請求：核心策略 (Stale-While-Revalidate or Cache-First with Dynamic Update)
self.addEventListener('fetch', (event) => {
    // 只處理 http/https 請求 (忽略 chrome-extension 等)
    if (!event.request.url.startsWith('http')) return;

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            // A. 如果快取有資料，直接回傳 (速度最快)
            if (cachedResponse) {
                return cachedResponse;
            }

            // B. 如果快取沒有，去網路下載
            return fetch(event.request).then((networkResponse) => {
                // 檢查下載是否成功
                if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                    return networkResponse;
                }

                // C. 【關鍵修改】將下載到的新資源 (例如器材圖片) 放入快取
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseToCache);
                });

                return networkResponse;
            });
        })
    );
});