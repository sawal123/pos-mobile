# Pembaruan Android NexaPos 1.0.1

Tanggal: 6 November 2026.

Versi aplikasi, npm, dan Android disamakan menjadi `1.0.1`, dengan
`versionCode 10001`. Kode ini lebih tinggi dari APK lokal `0.0.1` (kode `1`)
dan rilis `1.0.0` terdokumentasi (kode `10000`). Identitas aplikasi tetap
`com.posoffline.app`. Skema database dan migrasi tidak diubah oleh pembaruan ini.

## APK dan pemasangan

- Release: `android/app/build/outputs/apk/release/app-release.apk`.
- Debug: `android/app/build/outputs/apk/debug/app-debug.apk`.

Salin APK yang sesuai dengan aplikasi lama ke HP, buka APK, lalu pilih
**Update/Perbarui**. Gunakan release untuk aplikasi release lama dan debug
untuk aplikasi debug lama yang ditandatangani kunci debug komputer ini.
Jangan uninstall atau hapus data aplikasi.

Untuk perangkat yang tersambung melalui ADB, gunakan salah satu perintah:

```powershell
adb install -r android/app/build/outputs/apk/release/app-release.apk
# Jika aplikasi lama adalah debug:
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Jika muncul konflik tanda tangan, gunakan APK dengan sertifikat yang cocok
dengan aplikasi terpasang. Mengganti nomor versi saja tidak bisa mengatasi
sertifikat berbeda. Aturan pembaruan dijelaskan di
[dokumentasi Android](https://developer.android.com/google/play/app-updates).
Pembaruan berikutnya harus memakai kode versi lebih tinggi dari `10001` dan
kunci penandatanganan yang sama.

## Verifikasi

- Build web, sinkronisasi Capacitor, `assembleRelease`, dan `assembleDebug`: lulus.
- Kedua APK: tanda tangan valid, zip alignment valid, paket dan versi sesuai.
- Sertifikat release sama dengan APK release lokal sebelumnya dan identitas
  rilis 1.0.0 terdokumentasi:
  `e9facbc0013af5a513b3c56dee32a9a6b235ba17493b483348bc53b2354f04e0`.
- Sertifikat debug sama dengan APK debug lokal sebelumnya:
  `d8a097f7a2e11401a704980ef28b56541558404ad1ab806d8077e3212ee7e807`.
- Tes konfigurasi rilis, migrasi, dan persistensi: 98 lulus; satu tes startup
  gagal karena mock `piniaFactory` mengembalikan string `pinia-plugin`,
  sementara bootstrap memerlukan instance Pinia untuk inisialisasi tema.
  File tes dan kode bootstrap tersebut tidak diubah dalam pembaruan ini.
  Pengulangan dengan satu tes itu dikecualikan: 98 lulus, 1 dilewati.
- Pemasangan di HP dan pemeriksaan data sesudah upgrade belum diuji karena
  tidak ada perangkat ADB terhubung. Setelah update, periksa produk,
  transaksi, stok, pengaturan, lalu tutup dan buka kembali aplikasi.

SHA-256 APK release:
`5661513AB896EE57617247174D3A36B2D9D0FC4B6832BD5C982D24A866B33DFF`.

SHA-256 APK debug:
`AE991155147F3F16EC477D5CF783054FF7AAC1AFD6C0E90767CC42116C2618F5`.
