// Dibuat tools/web_rilis.py. Versi = hash isi semua berkas; berubah setiap rilis.
'use strict';
const VERSI = '44f5af2620d43e41';
const CACHE = 'autotrip-' + VERSI;
const BERKAS = [
"./",
"assets/AssetManifest.bin",
"assets/AssetManifest.bin.json",
"assets/FontManifest.json",
"assets/assets/diagram/belakang.png",
"assets/assets/diagram/depan.png",
"assets/assets/diagram/kanan.png",
"assets/assets/diagram/kiri.png",
"assets/fonts/MaterialIcons-Regular.otf",
"assets/fonts/fallback/Roboto-Regular.ttf",
"assets/packages/flutter_local_notifications_web/web/notifications_service_worker.js",
"assets/packages/material_ui/shaders/ink_sparkle.frag",
"assets/packages/phosphor_flutter/lib/fonts/Phosphor-Fill.ttf",
"assets/packages/phosphor_flutter/lib/fonts/Phosphor.ttf",
"assets/shaders/ink_sparkle.frag",
"assets/shaders/stretch_effect.frag",
"autotrip.js",
"canvaskit/canvaskit.js",
"canvaskit/canvaskit.wasm",
"favicon.png",
"flutter.js",
"flutter_bootstrap.js",
"fonts/Roboto-Bold.ttf",
"fonts/Roboto-Medium.ttf",
"icons/Icon-192.png",
"icons/Icon-512.png",
"icons/Icon-maskable-192.png",
"icons/Icon-maskable-512.png",
"icons/apple-touch-icon.png",
"main.dart.js",
"manifest.json",
"pwa.js"
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BERKAS.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((k) => Promise.all(k.filter((n) => n.startsWith('autotrip-') && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

// Versi baru menunggu sampai karyawan menekan "Muat ulang" (data yang sedang diisi tidak terputus).
self.addEventListener('message', (e) => {
  if (e.data === 'lewati') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const url = new URL(r.url);
  if (url.origin !== self.location.origin) return;
  // Logo usaha selalu dari jaringan (diperiksa dengan hash di aplikasi; offline: logo tersimpan di aplikasi).
  if (url.pathname.includes('/logo/')) return;
  if (r.mode === 'navigate') {
    // Halaman selalu dari cache (offline); bagian # (link surat) tetap di browser.
    e.respondWith(caches.match('./', { cacheName: CACHE }).then((m) => m || fetch(r)));
    return;
  }
  e.respondWith(
    caches.match(r, { cacheName: CACHE, ignoreSearch: true }).then((m) => {
      if (m) return m;
      return fetch(r).then((res) => {
        if (res.ok && res.type === 'basic') {
          const salin = res.clone();
          caches.open(CACHE).then((c) => c.put(r, salin));
        }
        return res;
      });
    }),
  );
});
