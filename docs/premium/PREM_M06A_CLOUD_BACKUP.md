# PREM-M06A — Cloud Backup Mobile Integration

**Jenis:** Implementasi fitur mobile
**Branch:** `feat/prem-m06a-cloud-backup`
**Base:** `main` (mobile) — setelah PREM-M01…M05 merged
**Backend dependency:** `sawal123/pos_dashboard` PR #68 / PREM-D03 "private cloud backup API" (merged, commit `e9293c7`)
**Ruang lingkup:** upload, list, detail (metadata) backup Cloud
**DI LUAR RUANG LINGKUP:** **RESTORE** (PREM-M06B), download, sync engine, P38 journal

> M06A **tidak** melakukan restore. Tidak ada tombol Restore destruktif, tidak ada
> download payload, tidak ada mutasi data POS lokal dari jalur Cloud Backup.

---

## 1. Kontrak backend PREM-D03 (authoritative, hasil audit langsung)

Sumber: `routes/api.php`, `app/Http/Controllers/Api/CloudBackupController.php`,
`app/Http/Requests/Api/StoreCloudBackupRequest.php`,
`app/Services/Backup/{CloudBackupService,CloudBackupContextResolver,CloudBackupRetention}.php`,
`app/Models/CloudBackup.php`, migration `cloud_backups`, `config/premium.php`.

Semua route di grup `auth:sanctum`. Otorisasi server-side, tidak mempercayai client:
token ability `mobile` → membership (`belongsToBusiness`) → role permission
(`CLOUD_BACKUP`, download butuh `CLOUD_RESTORE`) → entitlement Cloud aktif
(`PremiumPolicy::allows`) → device (upload wajib device aktif).

| Method | URI | Capability | Catatan |
| --- | --- | --- | --- |
| `POST` | `/api/mobile/backups` | `cloud_backup` | `201` dibuat, `200` duplikat idempotent |
| `GET`  | `/api/mobile/backups?business_id=&limit=` | `cloud_backup` | daftar READY terbaru dahulu, `limit` maks 10 (default 10) |
| `GET`  | `/api/mobile/backups/{uuid}?business_id=` | `cloud_backup` | metadata; lintas-business → `404` |
| `GET`  | `/api/mobile/backups/{uuid}/download?business_id=` | `cloud_restore` | **tidak dipakai M06A** |

### Request `POST` (persis field yang dikirim mobile)

```
business_id        (required, integer)
device_identifier  (required, string, max:100)
schema_version     (required, integer, min:1)
app_version        (nullable, string, max:50)
checksum_sha256    (required, regex /^[a-f0-9]{64}$/i)
size_bytes         (required, integer, min:1)
payload            (required, string — bytes persis)
idempotency_key    (nullable, string, max:191)
```

`app_version` sengaja **tidak dikirim** (nullable): project belum punya sumber versi
aplikasi yang reliable, jadi tidak ada angka yang dikarang.

### Response envelope (metadata)

```
{ "data": { id, uuid, created_at, schema_version, app_version,
            size_bytes, checksum_sha256, status,
            device: { id, identifier, name, platform },
            duplicate?  // hanya pada POST }
}
```

- `GET` list: `{ "data": [ {…metadata…} ] }` (array, terbaru dahulu — **bukan**
  `{ data: { backups, next_cursor } }`).
- `storage_path` / `storage_disk` / payload **tidak pernah** dikembalikan.
- `created_at` = waktu **server** (ISO-8601).

### Error codes aktual

| HTTP | code | Arti |
| --- | --- | --- |
| 401 | — | token tidak valid/absen |
| 403 | `MOBILE_TOKEN_REQUIRED` | token bukan ability `mobile` |
| 403 | `BUSINESS_ACCESS_DENIED` | bukan anggota business |
| 403 | `MOBILE_ROLE_NOT_SUPPORTED` | role ditolak |
| 403 | `CLOUD_SUBSCRIPTION_REQUIRED` | Free/expired/inactive |
| 403 | `DEVICE_NOT_FOUND` | device tidak ada / wajib device tapi tidak ada |
| 403 | `DEVICE_INACTIVE` | device nonaktif |
| 422 | `BACKUP_TOO_LARGE` (+ `max_bytes`) | payload/size > 25 MB |
| 422 | `BACKUP_SIZE_MISMATCH` | `size_bytes` ≠ `strlen(payload)` |
| 422 | `BACKUP_CHECKSUM_MISMATCH` | sha256 ≠ checksum server |
| 500 | `BACKUP_STORAGE_FAILED` | gagal simpan (fail closed, orphan dibersihkan) |
| 404 | `BACKUP_NOT_FOUND` | tidak ada / lintas-business (disamarkan) |
| 404 | `BACKUP_FILE_MISSING` | objek privat hilang (download) |

### Semantik kunci

- **UUID:** `uuid` (v4) adalah identifier publik; `id` numerik internal.
- **Idempotency:** unik pada `(business_id, device_id, idempotency_key)`. Retry
  dengan key sama mengembalikan **snapshot yang sama**, `200`, `duplicate: true`
  (tidak ada file/row kedua).
- **Size:** server menghitung ulang `strlen(payload)`; `size_bytes` client hanya
  diverifikasi, bukan dipercaya.
- **Checksum:** server menghitung `sha256(payload)` dan menyimpan nilai terverifikasi.
- **Immutability:** snapshot `ready` tidak bisa di-update (model throw).
- **Retention:** 10 backup `ready` terbaru per business, dijalankan setelah backup
  baru tersimpan; kelebihan dihapus (row + file).
- **Storage:** disk privat `cloud_backups` (`config('premium.backup.disk')`).
- **Business authorization:** `business_id` selalu diverifikasi terhadap membership.
- **Device:** upload butuh device aktif milik business; list/detail tidak wajib device.

---

## 2. Reuse serializer backup lokal (authoritative)

Satu-satunya serialisasi snapshot POS adalah `createBackupPayload(stores)` di
`src/services/backupService.js` (`schema: 'pos-mobile-backup'`, `version: 2`).

```
existing local backup serializer (createBackupPayload)
        |
        +---- local file backup (downloadBackupFile — unchanged)
        |
        +---- Cloud transport (CloudBackupPanel → premiumCloudBackupStore)
```

Tidak ada skema Cloud kedua. `schema_version` yang dikirim = `snapshot.version`
(`BACKUP_VERSION = 2`). Backup lokal tetap gratis dan tidak diubah.

---

## 3. Exact payload bytes (anti-drift)

`src/services/cloud/cloudBackupPayload.js`:

1. `serializeCloudBackupPayload(snapshot)` → `JSON.stringify` **sekali**.
2. `getUtf8ByteLength(payload)` → ukuran byte UTF-8 eksak.
3. `computeSha256Hex(payload)` → SHA-256 hex 64 char huruf kecil.

Panjang byte, checksum, dan `payload` yang dikirim berasal dari **string yang sama**.
String **tidak** diserialisasi ulang / pretty-print / normalisasi whitespace /
ubah newline setelah checksum dihitung.

---

## 4. UTF-8 byte size

`payload.length` (UTF-16 code units) **tidak pernah** dipakai. Helper memakai
`TextEncoder` (dengan fallback encoder manual) sehingga benar untuk ASCII, Bahasa
Indonesia, emoji, dan nama produk/pelanggan non-ASCII. Contoh: `"café 😀"` → 10 byte
(meski `.length === 7`).

---

## 5. SHA-256

Web Crypto (`globalThis.crypto.subtle.digest('SHA-256', TextEncoder().encode(payload))`),
kompatibel dengan browser, Capacitor WebView, dan runtime test. Output hex 64 char
lowercase. Tidak menambah library crypto. Diuji dengan known vector `"abc"`.

---

## 6. Batas 25 MB (preflight klien)

`MAX_CLOUD_BACKUP_BYTES = 25 * 1024 * 1024`, konsisten dengan
`config('premium.backup.max_bytes')`. Jika payload > batas: **tidak** ada POST,
UI menampilkan *"Ukuran backup melebihi batas Cloud 25 MB."* Ini **hanya** preflight
UX — **server tetap authoritative** dan memvalidasi ulang (`BACKUP_TOO_LARGE`).

---

## 7. Service

`src/services/cloud/cloudBackupService.js`: `createCloudBackup`, `listCloudBackups`,
`getCloudBackup`. Reuse `apiClient` + `tokenRepository` + `cloudSessionStore`
(tidak ada auth layer baru). Normalisasi response fail-closed; checksum/size response
yang berbeda dari attempt → gagal. Tidak ada download/restore.

---

## 8. Idempotency & retry

- Satu attempt = satu `idempotency_key` (`crypto.randomUUID` via
  `createIdempotencyKey('backup')`), **stabil** selama retry attempt yang sama.
- Attempt baru → key baru. Double-tap (guard **sinkron**) → hanya **satu** POST.
- Attempt gagal setelah payload dibuat → retry reuse **payload, checksum, size, key**
  yang sama; snapshot **tidak** dibangun ulang dari state POS live (state bisa berubah).
- "Buat Backup Baru" → snapshot baru + key baru.

---

## 9. Cloud Backup UI

`SettingsView.vue` memisahkan jelas **Backup Lokal (Gratis)** dan **Backup Cloud
(Premium)** melalui `CloudBackupPanel.vue`:

- Backup Lokal: tombol "Buat Backup Lokal" (perilaku lama, tidak diubah).
- Backup Cloud: tombol "Backup Sekarang", status, daftar backup (tanggal server,
  perangkat, ukuran, schema vN), tombol "Perbarui", salinan retensi.
- Wording jujur: **"Tersimpan secara privat di Cloud."** Tanpa klaim enkripsi.
- State UI: `idle, preparing, hashing, uploading, success, network-error,
  entitlement-denied, device-error, payload-too-large, server-error` (+ `session-error`
  untuk 401). Tidak ada progress persentase palsu. Tidak ada tombol Restore.

---

## 10. Entitlement / 401 / device / offline

- Gate UX: session valid + business tertaut + `capabilityState === 'verified'` +
  `cloud_access` + Premium. Free/expired → Cloud terkunci, **Backup Lokal tetap ada**.
  Server tetap authoritative.
- `CLOUD_SUBSCRIPTION_REQUIRED`: stop, `refreshContext()`, tampilkan Premium required,
  attempt dipertahankan, data lokal utuh. **Tidak** logout.
- 401: `invalidateCloudSession()` (perilaku M03) — sesi Cloud saja yang invalid;
  POS lokal, produk, transaksi tidak dihapus.
- `DEVICE_NOT_FOUND` / `DEVICE_INACTIVE`: fail closed, pesan *"Perangkat Cloud perlu
  diaktifkan kembali."*, tidak mengubah device identity, tidak auto-register.
- Offline: tidak POST, pesan *"Koneksi internet diperlukan untuk Backup Cloud."*;
  entitlement tidak berubah; list cache boleh tampil dengan penanda stale.

---

## 11. Daftar backup, retention, relink, disconnect

- List `GET /api/mobile/backups?business_id=LINKED&limit=10`; urutan server
  (terbaru dahulu) dipertahankan; `created_at` server yang ditampilkan.
- Refresh dijaga dari concurrency; gagal jaringan → **cache dipertahankan** + pesan
  *"Daftar backup belum diperbarui."*; list malformed → fail closed (cache tidak diganti).
- Retensi 10 adalah milik backend; mobile **tidak** menghapus backup sendiri. Copy:
  *"Cloud menyimpan hingga 10 backup terbaru."*
- Relink business: list + attempt business lama dibuang (tidak ada kebocoran tenant);
  attempt in-flight business lama tidak pernah dikirim ke business baru
  (`BUSINESS_SCOPE_CHANGED`).
- Putuskan Cloud: hanya state Cloud Backup yang dibersihkan; data POS lokal aman.

---

## 12. Negative stock & keamanan data lokal

- Serializer tidak memakai `min:0`: `product.stock = -3` dan movement
  `stockBefore=2, stockAfter=-3, quantityChange=-5` lolos serialize → byte-size →
  SHA-256 → upload tanpa ditolak client. Backend juga menerimanya verbatim.
- Upload (sukses/gagal) tidak mengubah state POS lokal, tidak menyentuh sync queue,
  in-flight envelope, maupun P38 journal.

---

## 13. Batasan & risiko yang diketahui

1. **Restore belum diimplementasikan** (M06B). Tidak ada tombol Restore aktif.
2. **Retry attempt tidak dipersist** ke storage. Payload backup bisa memuat data
   sensitif, jadi tidak ditulis plaintext ke localStorage. Retry hanya berlaku dalam
   satu sesi aplikasi. (Dicatat sebagai limitasi; tidak menambah storage crypto baru.)
3. Preflight 25 MB **bukan** batas keamanan; server tetap memvalidasi.
4. `app_version` tidak dikirim (nullable) karena belum ada sumber versi yang reliable.
5. `main.js` memiliki pelanggaran `prettier --check` **pra-eksisting** yang tidak
   terkait M06A (tidak diformat ulang sesuai scope).

---

## 14. Verifikasi

- Unit test: `src/__tests__/prem-m06a-cloud-backup.spec.js` (51 kasus: snapshot,
  UTF-8, SHA-256, upload, idempotency, double-tap, entitlement, 401, device, offline,
  list, relink, safety, UI).
- Regression penuh: `npx vitest run` — seluruh suite hijau (PREM-M01…M05, local backup,
  offline persistence, sync/P38).
- Build: `npm run build`.
- Lint file tersentuh: oxlint + eslint bersih; prettier bersih (kecuali `main.js`
  pra-eksisting).
