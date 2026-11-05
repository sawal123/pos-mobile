# QA Scan QR/Barcode dan QR Produk Grosir

Tanggal: 5 November 2026.

## Status

Implementasi mobile tersedia. Kamera Android fisik dan sinkronisasi dengan backend live **belum dinyatakan lulus**. `adb devices` tidak menemukan perangkat terhubung pada sesi implementasi.

## Implementasi

- Android menggunakan `@capacitor-mlkit/barcode-scanning` 8.x, melalui `startScan`/`stopScan` dan model ML Kit yang dibundel. Tidak memakai `scan()` atau instalasi modul Google Barcode Scanner saat runtime.
- Browser menggunakan ZXing yang dibundel dalam aset aplikasi. Kamera dipilih saat tombol scan diketuk; frame tidak diunggah.
- Format yang diminta kepada decoder: QR Code, EAN-13, EAN-8, UPC-A, UPC-E, dan Code 128. Keberhasilan membaca format fisik tetap memerlukan QA perangkat.
- QR dibuat secara lokal dengan `qrcode`; label PNG berisi nama produk dan teks kode. Browser mengunduh label, Android membuka menu **Simpan / Bagikan PNG** melalui file cache dan Share.
- Kode/label dibatasi untuk produk grosir yang dapat dijual. Barcode disimpan terpisah dari SKU, termasuk dalam migrasi, snapshot, backup, dan sync.

## Bukti otomatis

| Pengujian | Cakupan |
| --- | --- |
| `retail-product-codes.spec.js` | Kode stabil, nol di depan, duplicate lintas SKU/barcode, role, persistence/outbox/backup, push/pull, keranjang, varian, form, dan tipe bisnis. |
| `product-scanner-session.spec.js` | Satu hasil per sesi, stop sebelum callback, izin tertunda/ditolak, callback lama, pembersihan stream, dan pergantian sesi. |
| `product-code-sqlite-migration.spec.js` | Migrasi pada SQLite nyata: produk lama, SKU tidak berubah, penyimpanan barcode sebagai teks. |
| `product-qr-roundtrip.spec.js` | Kode QR dari encoder dibaca decoder yang dibundel, termasuk kode bernol di depan. Tidak menggunakan kamera. |
| `product-qr-modal.spec.js` | Generate eksplisit, kode stabil, ekspor, pembatasan role, serta tidak menampilkan QR ketika kode belum terkonfirmasi tersimpan. |
| `sqlite-persistence.spec.js` | Barcode ikut save/load native adapter melalui fake SQL yang mengikuti daftar kolom. Pengujian ini bukan perangkat SQLite Android fisik. |

Build web dan Android telah berhasil. Hasil regresi dan batas verifikasi dicatat pada bagian hasil di bawah.

## Cara mencoba

1. Pilih bisnis **Grosir / Toko Kelontong**.
2. Buka Produk → tambah/edit barang → isi barcode kemasan atau kosongkan untuk kode internal → simpan.
3. Ketuk **QR** pada produk atau **QR Produk Tersimpan** pada halaman edit. Produk lama tanpa kode membutuhkan aksi **Buat Kode & QR**.
4. Simpan label PNG. Tampilkan label pada perangkat lain atau cetak.
5. Buka POS → **Scan** → izinkan kamera → bidik QR/barcode. Produk tanpa varian masuk ke keranjang; produk bervarian memerlukan konfirmasi varian.
6. Buka scan kembali untuk menambah kuantitas produk yang sama. Stok tidak berkurang sampai alur transaksi berjalan.

## Checklist perangkat fisik

Isi perangkat, versi Android, versi aplikasi, versi WebView/browser, tanggal, dan hasil aktual. Jangan mengganti status di bawah hanya berdasarkan tes mock.

- [ ] Instalasi baru, mode pesawat: QR dan keenam format yang ditargetkan dapat dibaca tanpa unduhan model.
- [ ] Kamera belakang dapat dibuka, termasuk pencahayaan rendah dan barcode kecil.
- [ ] Izin pertama, izin ditolak, izin dicabut, kamera tidak tersedia/sedang dipakai.
- [ ] Satu bidikan tidak menambah item berkali-kali; sesi baru menambah kuantitas yang sesuai.
- [ ] Produk bervarian: konfirmasi, batal, dan scan ulang.
- [ ] Stok habis, inactive, bukan barang jual, kode tidak dikenal, dan kode ambigu tidak menambah keranjang.
- [ ] Tutup, tombol Back Android, rotasi, background/foreground, navigasi, serta pergantian bisnis menghentikan kamera.
- [ ] Callback dari sesi sebelumnya tidak menambah item pada bisnis/halaman baru.
- [ ] Simpan/bagikan PNG Android dan unduh browser; file yang disimpan terbaca kembali.
- [ ] Kode tetap sama setelah edit nama/harga, tutup-buka aplikasi, backup/restore, dan relink yang sah.
- [ ] Browser desktop/mobile yang didukung: layout sempit, tema terang/gelap, fokus keyboard, serta penolakan izin kamera.

## Checklist backend live

- [ ] Dashboard telah menerapkan perlindungan missing/null dari klien legacy sesuai kontrak pasangan.
- [ ] Barcode dashboard → mobile pull → scan menemukan produk yang sama.
- [ ] Barcode mobile pengelola → push → QR dashboard menghasilkan kode yang sama.
- [ ] Update harga/nama, retry, konflik versi, dan dua perangkat tidak menghapus/mengganti barcode diam-diam.
- [ ] Cashier-safe menolak mutasi katalog, tetapi scan produk yang sudah ada tetap dapat dipakai.

Lihat [kontrak mobile](../sync/PRODUCT_BARCODE_V1.md) dan [plan dashboard](../../../pos_dashboard/docs/plans/PLAN_SCAN_QR_BARCODE_GROSIR_DASHBOARD.md).

## Referensi implementasi

- [Capawesome: ML Kit Barcode Scanning](https://capawesome.io/docs/sdks/capacitor/mlkit/barcode-scanning/) — kompatibilitas Capacitor 8, API kamera, dan overlay native.
- [ZXing browser](https://github.com/zxing-js/browser) — decoder kamera browser dan kontrol penghentian.
- [node-qrcode](https://github.com/soldair/node-qrcode) — encoder QR lokal.
- [Capacitor Filesystem](https://capacitorjs.com/docs/apis/filesystem) dan [Share](https://capacitorjs.com/docs/apis/share) — ekspor PNG Android.

## Hasil verifikasi akhir

| Pemeriksaan | Hasil |
| --- | --- |
| Build web `npm run build` | PASS. Peringatan ukuran chunk/dynamic import tetap ada. |
| `npx cap sync android` | PASS; scanner, filesystem, dan share masuk konfigurasi Android. |
| Build Android `assembleDebug` | PASS dengan JDK 21. APK debug tersedia pada `android/app/build/outputs/apk/debug/app-debug.apk`. |
| Model scanner di APK | Diperiksa sebagai arsip: model `.tflite` ada pada `assets/mlkit_barcode_models/`. Ini membuktikan bundling, bukan hasil QA kamera fisik. |
| ESLint pada file implementasi dan tes terkait | PASS. |
| Tes fokus fitur, migrasi, kontrak sync, dan restore safety | 150/150 PASS pada 10 file. |
| Regresi penuh | 2.033 tes: 2.015 PASS, 14 FAIL, 4 SKIP. |
| Perbandingan baseline | Ke-14 tes yang gagal juga gagal pada checkout HEAD awal yang terpisah, dengan dependency/environment yang sama. Tidak ditemukan kegagalan baru. |
| Pratinjau browser melalui Computer Use | Tidak tersedia: browser access host tidak tersedia pada sesi ini. |
| Android fisik / backend live | PENDING; belum ada perangkat terhubung dan tidak melakukan transaksi ke backend live. |

Kegagalan baseline yang tersisa berada pada pengujian business outbox, backup transaksi, selector checkout/struk/stok, teks langganan/sync, bootstrap mock Pinia, queue restart mock SQLite, dan guard URL API. Kegagalan tersebut tidak disembunyikan atau dinyatakan lulus. Perbaikan di luar fitur ini belum dilakukan.

Perintah regresi penuh: `npx vitest run --maxWorkers=4`. Hasil perbandingan pada sesi ini disimpan sementara sebagai `pos-retail-vitest-final.json` dan `pos-barcode-baseline-results.json` pada folder Temp pengguna.

Build Android memerlukan JDK 21. Pada sesi ini digunakan distribusi Temurin portable dalam cache toolchain lokal, dengan checksum SHA-256 diverifikasi; konfigurasi Java sistem tidak diubah.
