// AI相場リサーチ - Service Worker
// アプリシェルのみキャッシュ。API応答はキャッシュしない（常に新鮮なデータを取得）

const CACHE_NAME = 'rs-cache-v8';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // APIリクエストはキャッシュしない
  if (url.pathname.startsWith('/api/')) {
    return;
  }
  // 外部API (Anthropic, OpenAI) もキャッシュしない
  if (url.origin !== self.location.origin) {
    return;
  }

  // アプリシェルは cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        // 成功時のみキャッシュ更新
        if (res && res.status === 200 && event.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      }).catch(() => caches.match('/'));
    })
  );
});
