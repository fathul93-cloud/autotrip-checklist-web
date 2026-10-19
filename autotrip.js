// AutoTrip Checklist (web): fungsi browser yang dipanggil dari Dart (lib/web/js_web.dart).
// Tanpa server data dan tanpa library luar: penyimpanan IndexedDB terenkripsi (Web Crypto), kamera, rekam video,
// olah gambar lewat canvas, bagikan file, lokasi, dan pembaruan versi (service worker).
'use strict';
(function () {
  const at = {};
  window.autotrip = at;

  // Link surat (bagian # URL, tidak pernah dikirim ke server) diambil SEBELUM Flutter mulai, karena Flutter memakai
  // bagian # untuk rute. URL langsung dibersihkan agar data tidak tertinggal di riwayat/tab browser.
  let linkMasuk = null;
  try {
    const h = decodeURIComponent((location.hash || '').replace(/^#/, ''));
    if (h.indexOf('ATL1.') === 0) {
      linkMasuk = h;
      history.replaceState(null, '', location.pathname + location.search);
    }
  } catch (e) { /* abaikan */ }

  at.ambilLink = function () {
    const l = linkMasuk;
    linkMasuk = null;
    return l;
  };

  // -------------------------------------------------------------------------
  // Penyimpanan: IndexedDB "autotrip", store "kunci" (CryptoKey AES-GCM 256 yang TIDAK bisa diekspor) dan
  // "berkas" (path -> {iv, data}). Setiap berkas dienkripsi dengan kunci perangkat; path dipakai sebagai AAD.
  let db = null;
  let kunci = null;
  const enc = new TextEncoder();

  function req(r) {
    return new Promise((ok, gagal) => {
      r.onsuccess = () => ok(r.result);
      r.onerror = () => gagal(r.error);
    });
  }

  function tx(store, mode) {
    return db.transaction(store, mode).objectStore(store);
  }

  at.bukaPenyimpanan = async function () {
    if (!window.indexedDB || !window.crypto || !crypto.subtle) throw new Error('Browser tidak mendukung penyimpanan aman');
    if (db && kunci) return true;
    const r = indexedDB.open('autotrip', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('kunci')) d.createObjectStore('kunci');
      if (!d.objectStoreNames.contains('berkas')) d.createObjectStore('berkas');
    };
    db = await req(r);
    kunci = await req(tx('kunci', 'readonly').get('perangkat'));
    if (!kunci) {
      kunci = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await req(tx('kunci', 'readwrite').put(kunci, 'perangkat'));
    }
    return true;
  };

  // Semua berkas tersimpan (didekripsi): [{p: path, d: Uint8Array}]. Berkas yang tidak bisa dibuka dilewati.
  at.semuaBerkas = async function () {
    const store = tx('berkas', 'readonly');
    const kunciList = await req(store.getAllKeys());
    const nilai = await req(tx('berkas', 'readonly').getAll());
    const hasil = [];
    for (let i = 0; i < kunciList.length; i++) {
      const v = nilai[i];
      try {
        const polos = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: v.iv, additionalData: enc.encode(kunciList[i]) }, kunci, v.data);
        hasil.push({ p: kunciList[i], d: new Uint8Array(polos) });
      } catch (e) {
        console.warn('berkas tidak bisa dibuka', kunciList[i]);
      }
    }
    return hasil;
  };

  at.tulisBerkas = async function (path, data) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sandi = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: enc.encode(path) }, kunci, data);
    await req(tx('berkas', 'readwrite').put({ iv: iv, data: sandi }, path));
    return true;
  };

  at.hapusBerkas = async function (path) {
    await req(tx('berkas', 'readwrite').delete(path));
    return true;
  };

  at.infoPenyimpanan = async function () {
    const s = navigator.storage;
    let pakai = -1, kuota = -1, permanen = false;
    try {
      if (s && s.estimate) {
        const e = await s.estimate();
        pakai = e.usage || 0;
        kuota = e.quota || 0;
      }
      if (s && s.persisted) permanen = await s.persisted();
    } catch (e) { /* tidak didukung */ }
    return { pakai: pakai, kuota: kuota, permanen: permanen };
  };

  at.mintaPermanen = async function () {
    try {
      return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false;
    } catch (e) {
      return false;
    }
  };

  // -------------------------------------------------------------------------
  // Kamera (getUserMedia). Satu kamera aktif pada satu waktu; elemen <video> ditempel ke wadah platform view.
  let stream = null;
  let video = null;
  let wadah = null;
  // Sesi kamera: layar lama yang ditutup (dispose) tidak boleh mematikan kamera layar baru (v2.0.23).
  let sesi = 0;
  // Penghitung frame video yang benar-benar tampil; tidak bertambah = gambar membeku.
  let frameKe = 0;

  function putar() {
    if (video && stream && stream.active) video.play().catch(() => { /* dicoba lagi oleh pemeriksa beku */ });
  }

  function pasangVideo() {
    if (wadah && video && video.parentNode !== wadah) {
      wadah.appendChild(video);
      // Elemen media yang dipindah antar-wadah DOM dijeda browser: putar lagi.
      putar();
    }
  }

  function hitungFrame(v) {
    if (typeof v.requestVideoFrameCallback === 'function') {
      const langkah = () => {
        if (video !== v) return;
        frameKe++;
        v.requestVideoFrameCallback(langkah);
      };
      v.requestVideoFrameCallback(langkah);
    } else {
      let waktu = -1;
      const t = setInterval(() => {
        if (video !== v) return clearInterval(t);
        if (v.currentTime !== waktu) { waktu = v.currentTime; frameKe++; }
      }, 250);
    }
  }

  at.wadahKamera = function (div) {
    wadah = div;
    div.style.width = '100%';
    div.style.height = '100%';
    div.style.overflow = 'hidden';
    pasangVideo();
  };

  at.kameraBuka = async function (audio, lebarIdeal, tinggiIdeal) {
    at.kameraTutup();
    const ini = ++sesi;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Browser ini tidak mendukung kamera (buka lewat https di Safari/Chrome terbaru)');
    }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: !!audio,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: lebarIdeal }, height: { ideal: tinggiIdeal } },
    });
    if (ini !== sesi) {
      // Layar ditutup selama menunggu izin/kamera.
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
      throw new Error('Kamera ditutup');
    }
    video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.setAttribute('autoplay', '');
    video.muted = true;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'fill';
    video.style.pointerEvents = 'none';
    video.srcObject = stream;
    const v = video;
    // Browser bisa menjeda video (dipindah di DOM, tab di latar): selama kamera aktif, putar lagi.
    v.addEventListener('pause', () => { if (video === v) setTimeout(putar, 50); });
    frameKe = 0;
    hitungFrame(v);
    pasangVideo();
    await new Promise((ok, gagal) => {
      const t = setTimeout(() => gagal(new Error('Kamera tidak merespons')), 15000);
      video.onloadedmetadata = () => { clearTimeout(t); ok(); };
    });
    try { await video.play(); } catch (e) { /* autoplay muted biasanya boleh */ }
    return { lebar: video.videoWidth, tinggi: video.videoHeight, sesi: ini };
  };

  // Jumlah frame yang sudah tampil (untuk mendeteksi gambar membeku) dan memutar ulang video.
  at.kameraFrame = function () { return frameKe; };
  at.kameraSegarkan = function () { putar(); };

  // [s] = sesi dari kameraBuka; sesi lama (layar yang sudah diganti) tidak menutup kamera yang sedang dipakai.
  at.kameraTutup = function (s) {
    if (typeof s === 'number' && s !== sesi) return;
    sesi++;
    if (rekaman && rekaman.state !== 'inactive') {
      try { rekaman.stop(); } catch (e) { /* abaikan */ }
    }
    rekaman = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    if (video) {
      try { video.pause(); } catch (e) { /* abaikan */ }
      video.srcObject = null;
      video.removeAttribute('src');
      try { video.load(); } catch (e) { /* abaikan */ }
      if (video.parentNode) video.parentNode.removeChild(video);
    }
    video = null;
    // Pemindai QR dibuat ulang saat kamera dibuka lagi.
    detektor = undefined;
  };

  at.kameraBisaSenter = function () {
    try {
      const t = stream && stream.getVideoTracks()[0];
      const c = t && t.getCapabilities ? t.getCapabilities() : null;
      return !!(c && c.torch);
    } catch (e) {
      return false;
    }
  };

  at.kameraSenter = async function (nyala) {
    const t = stream && stream.getVideoTracks()[0];
    if (!t) return false;
    try {
      await t.applyConstraints({ advanced: [{ torch: !!nyala }] });
      return true;
    } catch (e) {
      return false;
    }
  };

  function keBlob(canvas, tipe, kualitas) {
    return new Promise((ok, gagal) => canvas.toBlob((b) => (b ? ok(b) : gagal(new Error('Gambar gagal dibuat'))), tipe, kualitas));
  }

  async function blobKeBytes(b) {
    return new Uint8Array(await b.arrayBuffer());
  }

  // Foto dari kamera, resolusi penuh, JPEG.
  at.kameraFoto = async function (kualitas) {
    if (!video || !video.videoWidth) throw new Error('Kamera belum siap');
    const c = document.createElement('canvas');
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    return blobKeBytes(await keBlob(c, 'image/jpeg', kualitas));
  };

  // QR: BarcodeDetector (Chrome Android) bila ada; selain itu piksel abu-abu tengah gambar untuk dibaca Dart (zxing2).
  let detektor;
  at.kameraQrAsli = async function () {
    if (detektor === undefined) {
      detektor = null;
      try {
        if ('BarcodeDetector' in window) {
          const f = await window.BarcodeDetector.getSupportedFormats();
          if (f.indexOf('qr_code') >= 0) detektor = new window.BarcodeDetector({ formats: ['qr_code'] });
        }
      } catch (e) {
        detektor = null;
      }
    }
    if (!detektor || !video || !video.videoWidth) return null;
    const hasil = await detektor.detect(video);
    return hasil.length ? hasil.map((h) => h.rawValue || '') : [];
  };

  function abuAbu(sumber, sw, sh, maks, potongTengah) {
    let sx = 0, sy = 0, w = sw, h = sh;
    if (potongTengah) {
      const s = Math.min(sw, sh) * 0.8;
      sx = (sw - s) / 2; sy = (sh - s) / 2; w = s; h = s;
    }
    const skala = Math.min(1, maks / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * skala));
    c.height = Math.max(1, Math.round(h * skala));
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(sumber, sx, sy, w, h, 0, 0, c.width, c.height);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    const y = new Uint8Array(c.width * c.height);
    for (let i = 0, j = 0; j < y.length; i += 4, j++) y[j] = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
    return { w: c.width, h: c.height, d: y };
  }

  at.kameraAbuAbu = function (maks) {
    if (!video || !video.videoWidth) return null;
    return abuAbu(video, video.videoWidth, video.videoHeight, maks, true);
  };

  at.gambarAbuAbu = async function (data, maks) {
    const bmp = await createImageBitmap(new Blob([data]));
    try {
      return abuAbu(bmp, bmp.width, bmp.height, maks, false);
    } finally {
      bmp.close();
    }
  };

  // -------------------------------------------------------------------------
  // Rekam video lewat canvas agar watermark ikut terekam. Bila canvas.captureStream tidak ada, video direkam tanpa
  // watermark (bertanda = false) dan data watermark disimpan sebagai metadata oleh Dart.
  let rekaman = null;
  let hasilRekam = null;

  function pilihMime() {
    const calon = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'];
    if (!window.MediaRecorder) return null;
    for (const m of calon) {
      try {
        if (MediaRecorder.isTypeSupported(m)) return m;
      } catch (e) { /* lanjut */ }
    }
    return '';
  }

  // Ukuran canvas rekaman (sisi pendek [sisiPendek]) untuk lembar watermark yang dibuat Dart.
  at.ukuranRekam = function (sisiPendek) {
    if (!video || !video.videoWidth) return null;
    const w0 = video.videoWidth, h0 = video.videoHeight;
    const s = Math.min(1, sisiPendek / Math.min(w0, h0));
    return { lebar: Math.round(w0 * s / 2) * 2, tinggi: Math.round(h0 * s / 2) * 2 };
  };

  at.rekamMulai = async function (overlayPng, maksDetik, bitrate, sisiPendek) {
    if (!stream || !video) throw new Error('Kamera belum siap');
    const mime = pilihMime();
    if (mime === null) throw new Error('Browser ini tidak bisa merekam video');
    const u = at.ukuranRekam(sisiPendek);
    let sumber = stream;
    let bertanda = false;
    let berhentiGambar = () => {};
    let thumbJanji = null;
    const canvas = document.createElement('canvas');
    canvas.width = u.lebar;
    canvas.height = u.tinggi;
    if (canvas.captureStream) {
      try {
        const g = canvas.getContext('2d');
        let lembar = null;
        if (overlayPng && overlayPng.length) lembar = await createImageBitmap(new Blob([overlayPng], { type: 'image/png' }));
        let jalan = true;
        let pertama = true;
        const gambar = () => {
          if (!jalan) return;
          g.drawImage(video, 0, 0, canvas.width, canvas.height);
          if (lembar) g.drawImage(lembar, 0, canvas.height - lembar.height);
          if (pertama) {
            pertama = false;
            thumbJanji = keBlob(canvas, 'image/jpeg', 0.8).then(blobKeBytes).catch(() => null);
          }
          requestAnimationFrame(gambar);
        };
        gambar();
        const cs = canvas.captureStream(25);
        stream.getAudioTracks().forEach((t) => cs.addTrack(t));
        sumber = cs;
        bertanda = !!lembar;
        berhentiGambar = () => {
          jalan = false;
          cs.getVideoTracks().forEach((t) => t.stop());
          if (lembar) lembar.close();
        };
      } catch (e) {
        console.warn('rekam lewat canvas gagal, rekam langsung', e);
        sumber = stream;
        bertanda = false;
      }
    }
    const opsi = { videoBitsPerSecond: bitrate, audioBitsPerSecond: 64000 };
    if (mime) opsi.mimeType = mime;
    const r = new MediaRecorder(sumber, opsi);
    const potong = [];
    const mulai = performance.now();
    hasilRekam = new Promise((ok, gagal) => {
      r.ondataavailable = (e) => { if (e.data && e.data.size) potong.push(e.data); };
      r.onerror = (e) => gagal(e.error || new Error('Rekam video gagal'));
      r.onstop = async () => {
        berhentiGambar();
        const durasi = Math.round(performance.now() - mulai);
        const tipe = (r.mimeType || mime || 'video/mp4').split(';')[0];
        const blob = new Blob(potong, { type: tipe });
        let thumb = thumbJanji ? await thumbJanji : null;
        if (!thumb) {
          try {
            const c = document.createElement('canvas');
            c.width = u.lebar; c.height = u.tinggi;
            c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
            thumb = await blobKeBytes(await keBlob(c, 'image/jpeg', 0.8));
          } catch (e) { thumb = null; }
        }
        ok({ data: await blobKeBytes(blob), mime: tipe, durasiMs: durasi, thumb: thumb, bertanda: bertanda, lebar: u.lebar, tinggi: u.tinggi });
      };
    });
    r.start(1000);
    rekaman = r;
    setTimeout(() => { if (rekaman === r && r.state === 'recording') r.stop(); }, maksDetik * 1000);
    return true;
  };

  at.rekamBerjalan = function () {
    return !!(rekaman && rekaman.state === 'recording');
  };

  at.rekamSelesai = async function () {
    const r = rekaman;
    if (r && r.state === 'recording') r.stop();
    rekaman = null;
    if (!hasilRekam) throw new Error('Tidak ada rekaman');
    const h = await hasilRekam;
    hasilRekam = null;
    return h;
  };

  // Info video dari galeri: durasi, ukuran, gambar kecil (bingkai awal).
  at.infoVideo = async function (data, mime) {
    const url = URL.createObjectURL(new Blob([data], { type: mime || 'video/mp4' }));
    const v = document.createElement('video');
    v.muted = true;
    v.setAttribute('playsinline', '');
    v.preload = 'auto';
    v.src = url;
    try {
      await new Promise((ok, gagal) => {
        const t = setTimeout(() => gagal(new Error('Video tidak bisa dibaca')), 10000);
        v.onloadeddata = () => { clearTimeout(t); ok(); };
        v.onerror = () => { clearTimeout(t); gagal(new Error('Video tidak bisa dibaca')); };
      });
      let thumb = null;
      try {
        await new Promise((ok) => {
          const t = setTimeout(ok, 3000);
          v.onseeked = () => { clearTimeout(t); ok(); };
          v.currentTime = Math.min(0.1, (v.duration || 1) / 2);
        });
        const s = Math.min(1, 480 / Math.min(v.videoWidth, v.videoHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(v.videoWidth * s); c.height = Math.round(v.videoHeight * s);
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        thumb = await blobKeBytes(await keBlob(c, 'image/jpeg', 0.8));
      } catch (e) { thumb = null; }
      const d = isFinite(v.duration) ? Math.round(v.duration * 1000) : -1;
      return { durasiMs: d, lebar: v.videoWidth, tinggi: v.videoHeight, thumb: thumb };
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  // -------------------------------------------------------------------------
  // Olah gambar (canvas, native browser; lebih cepat daripada dekode Dart).
  at.kompresGambar = async function (data, sisiMaks, kualitas) {
    const bmp = await createImageBitmap(new Blob([data]), { imageOrientation: 'from-image' });
    try {
      const s = Math.min(1, sisiMaks / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * s));
      c.height = Math.max(1, Math.round(bmp.height * s));
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return blobKeBytes(await keBlob(c, 'image/jpeg', kualitas));
    } finally {
      bmp.close();
    }
  };

  // Lembar watermark PNG ditempel di pojok kiri bawah (sama dengan tempelWatermark di Dart).
  at.tempelWatermark = async function (jpeg, png, kualitas) {
    const f = await createImageBitmap(new Blob([jpeg]));
    const l = await createImageBitmap(new Blob([png], { type: 'image/png' }));
    try {
      const c = document.createElement('canvas');
      c.width = f.width;
      c.height = f.height;
      const g = c.getContext('2d');
      g.drawImage(f, 0, 0);
      g.drawImage(l, 0, Math.max(0, f.height - l.height));
      return blobKeBytes(await keBlob(c, 'image/jpeg', kualitas));
    } finally {
      f.close();
      l.close();
    }
  };

  // -------------------------------------------------------------------------
  // Bagikan file (Web Share API) atau unduh.
  at.bisaBagikanFile = function (nama, mime) {
    try {
      return !!(navigator.canShare && navigator.canShare({ files: [new File([new Uint8Array(1)], nama, { type: mime })] }));
    } catch (e) {
      return false;
    }
  };

  // 'ok' | 'batal'. Harus dipanggil langsung dari ketukan (aktivasi pengguna).
  at.bagikanFile = async function (data, nama, mime, teks) {
    const f = new File([data], nama, { type: mime });
    const isi = { files: [f] };
    if (teks) isi.text = teks;
    try {
      await navigator.share(isi);
      return 'ok';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'batal';
      throw e;
    }
  };

  at.unduhFile = function (data, nama, mime) {
    const url = URL.createObjectURL(new Blob([data], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = nama;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
  };

  // URL blob untuk memutar video/menampilkan file (dilepas dengan lepasUrl).
  at.buatUrl = function (data, mime) {
    return URL.createObjectURL(new Blob([data], { type: mime }));
  };

  at.lepasUrl = function (url) {
    URL.revokeObjectURL(url);
  };

  // -------------------------------------------------------------------------
  // Lokasi (Geolocation API). Browser tidak memberi waktu GPS, jadi tidak ada cek jam.
  let pantau = null;
  let posisi = null;
  at.lokasiMulai = function () {
    if (!navigator.geolocation) return false;
    if (pantau !== null) return true;
    pantau = navigator.geolocation.watchPosition(
      (p) => { posisi = { lat: p.coords.latitude, lng: p.coords.longitude, akurasi: p.coords.accuracy, waktu: Date.now() }; },
      (e) => { if (e && e.code === 1) at.lokasiBerhenti(); },
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 });
    return true;
  };

  at.lokasiTerbaru = function () {
    if (!posisi) return null;
    return { lat: posisi.lat, lng: posisi.lng, akurasi: posisi.akurasi, umurMs: Date.now() - posisi.waktu };
  };

  at.lokasiBerhenti = function () {
    if (pantau !== null && navigator.geolocation) navigator.geolocation.clearWatch(pantau);
    pantau = null;
    return true;
  };

  // -------------------------------------------------------------------------
  // Info perangkat & versi.
  at.perangkat = function () {
    const ua = navigator.userAgent || '';
    const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const android = /Android/i.test(ua);
    const terpasang = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    return { ios: ios, android: android, terpasang: !!terpasang };
  };

  at.adaVersiBaru = function () {
    return !!window.__autotripVersiBaru;
  };

  at.muatUlang = function () {
    const w = window.__autotripSwMenunggu;
    if (w) {
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
      w.postMessage('lewati');
      setTimeout(() => location.reload(), 3000);
    } else {
      location.reload();
    }
  };
})();
