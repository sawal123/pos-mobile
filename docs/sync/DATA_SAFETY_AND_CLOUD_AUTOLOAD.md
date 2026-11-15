# Keamanan Data Lokal & Pemuatan Cloud Otomatis

Status: implemented (mobile)
Terkait: `INT02_MOBILE_CASHIER_INTEGRATION.md`, backend `PAIR01_DEVICE_PAIRING_CODE.md`

## Laporan: "data sebelumnya ada, setelah sync hilang"

Hasil penelusuran menemukan **dua penyebab berbeda**, dan keduanya sudah ditangani.

### 1. Jalur destruktif tanpa konfirmasi (penyebab data benar-benar terhapus)

`clearLocalCache()` menghapus **semua** data tenant di perangkat:

```
produk, kategori, pergerakan stok, pelanggan, pengeluaran,
transaksi, kas, shift, antrean sync, sync binding, pull state,
server versions, identity map, konflik
```

Tombol **"Bersihkan"** di layar Sinkronisasi memanggilnya **langsung tanpa
konfirmasi**, lalu baru menarik data Cloud. Bila penarikan gagal (offline,
prasyarat belum lengkap, tarikan lain sedang berjalan), data pengguna sudah
terlanjur hilang dan binding sync ikut terhapus — layar lalu menampilkan
"This device has not initialized Cloud data".

Perbaikan:

- Tombol berganti nama menjadi **"Muat ulang dari Cloud"** dan **wajib
  konfirmasi** lewat modal yang menyebutkan data apa saja yang dihapus.
- Sebelum menghapus, `captureLocalSafetyBackup()` menyimpan snapshot
  (produk, pelanggan, transaksi, kas, shift, antrean, binding).
- Bila pemuatan Cloud gagal, `restoreLocalSafetyBackup()` mengembalikan seluruh
  data + binding dan UI menyatakan **"Data lokal Anda dikembalikan"**.
- Alur yang sama dipakai tombol **Hapus Cache** di Pengaturan.

### 2. Data "hilang" karena berpindah ruang kerja (data masih ada)

Saat berpindah bisnis Cloud, aplikasi menyimpan data ruang kerja lama sebagai
snapshot (`saveWorkspaceSnapshot`) dan menampilkan ruang kerja baru. Data tidak
terhapus, tetapi **tidak sedang aktif** — sehingga seluruh angka menjadi 0.

Perbaikan: kartu "Ringkasan Data Lokal Perangkat" kini menampilkan
**Ruang kerja aktif** dan, bila ada, daftar ruang kerja lain yang masih
menyimpan data beserta jumlah produk/transaksi/pelanggannya
(`workspace-footprint`). Jika daftar itu muncul, data tidak perlu dicari di
Cloud — simpan ID ruang kerja tersebut sebelum melakukan perubahan apa pun.

## Pemuatan data Cloud otomatis setelah login email

- Setelah login + aktivasi bisnis (owner maupun kasir), aplikasi langsung
  menjalankan **initial pull** bila perangkat belum punya binding, tanpa perlu
  menekan "Tarik".
- Hasil pull **langsung di-flush ke SQLite** oleh `syncPullStore.pullNow()`
  (bukan menunggu flush berikutnya), jadi data tetap ada walau aplikasi ditutup.
- Bila push (`Sync`) dijalankan pada perangkat yang belum pernah memuat data
  Cloud (`SYNC_BUSINESS_NOT_BOUND`), aplikasi otomatis menjalankan initial pull
  dan melaporkan hasilnya — pengguna tidak lagi disuruh menekan tombol.
- Tarikan yang berjalan bersamaan tidak lagi tampil sebagai error:
  `INITIAL_PULL_ALREADY_IN_PROGRESS` → banner info "Data Cloud sedang dimuat".

## Paket Free

- Tombol **Tarik** dan **Muat ulang dari Cloud** tidak dirender untuk akun tanpa
  akses Cloud (`cloud_access !== true`).
- Muncul catatan: *"Paket Free: data hanya tersimpan di perangkat ini. Tarik
  data Cloud tidak tersedia."*
- `Muat Data Cloud` di Pengaturan Cloud juga hanya tampil pada sesi yang lolos
  `canSync` (Cloud aktif + perangkat terdaftar).

## Pesan error

Pesan teknis berbahasa Inggris yang sebelumnya muncul mentah kini dipetakan ke
bahasa Indonesia yang bisa ditindaklanjuti:

| Kode | Pesan |
|------|-------|
| `INITIAL_PULL_ALREADY_IN_PROGRESS` | Data Cloud sedang dimuat. Tunggu sampai selesai. |
| `SYNC_BUSINESS_NOT_BOUND` | Perangkat belum pernah memuat data Cloud — tombol "Muat Data Cloud" disediakan. |
| `CLOUD_INITIALIZATION_WORKSPACE_NOT_EMPTY` | Data lokal masih ada; data Cloud tidak dimuat agar tidak menimpa. |
| `CLOUD_INITIALIZATION_SAFETY_CHECK_FAILED` | Pemeriksaan keamanan ruang kerja gagal; selesaikan pemulihan. |

## Kode terkait

- `src/services/localSafetyBackup.js` — snapshot & restore data lokal.
- `src/services/sync/syncPullService.js` — pesan prasyarat/initial pull.
- `src/stores/syncPullStore.js` — flush SQLite setelah pull sukses.
- `src/views/sync/SyncView.vue` — konfirmasi destruktif, auto initial pull,
  gating paket Free, diagnostik ruang kerja.
- `src/views/settings/SettingsView.vue` — proteksi tombol Hapus Cache.

## Tes

- `src/__tests__/local-safety-backup.spec.js` — 6 tes snapshot/restore.
- `src/__tests__/sync-data-protection.spec.js` — 7 tes konfirmasi destruktif,
  restore saat gagal, gating Free, auto-load, pesan ramah.
