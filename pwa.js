// Service worker sendiri (sw.js, dibuat tools/web_rilis.py): semua berkas aplikasi disimpan untuk dipakai offline.
// Versi baru diunduh di latar; Dart menampilkan "Versi baru tersedia" (autotrip.adaVersiBaru) dan memuat ulang
// lewat autotrip.muatUlang().
'use strict';
(function () {
  window.addEventListener('flutter-first-frame', function () {
    var e = document.getElementById('memuat');
    if (e) e.remove();
  });
  if (!('serviceWorker' in navigator)) return;
  function tandai(w) {
    window.__autotripSwMenunggu = w;
    window.__autotripVersiBaru = true;
  }
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      if (!reg) return;
      if (reg.waiting && navigator.serviceWorker.controller) tandai(reg.waiting);
      reg.addEventListener('updatefound', function () {
        var w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', function () {
          if (w.state === 'installed' && navigator.serviceWorker.controller) tandai(w);
        });
      });
      // Cek versi baru saat aplikasi dibuka lagi dan setiap jam.
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') reg.update().catch(function () {});
      });
      setInterval(function () { reg.update().catch(function () {}); }, 60 * 60 * 1000);
    }).catch(function (e) { console.warn('service worker gagal', e); });
  });
})();
