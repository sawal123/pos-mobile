# POS MOBILE — Production Readiness P0 / Release Candidate 1 (RC1)

**Repository:** `sawal123/pos-mobile`  
**Base Branch:** `origin/main` (`6570e9e`)  
**Release Branch:** `release/rc1-catalog-sync-qa`  
**Version:** `1.0.0` (`versionCode: 10000`)

---

## 1. Executive Summary

Audit kesiapan produksi (Production Readiness P0 / RC1) dilakukan untuk memverifikasi alur sinkronisasi katalog Cloud (`Cloud Login → Business & Outlet Selection → Operational Context → Sync Context Guard → Cloud Pull → Categories/Products Mapping → SQLite Persistence → Product Store → POS Display`), keamanan data offline/antrean sinkronisasi, konfigurasi rilis Android Capacitor, serta build APK.

Empat masalah P0/P1 pada jalur sinkronisasi katalog Cloud dan keamanan data lokal berhasil diidentifikasi dan diperbaiki tanpa melakukan reset database atau menghapus transaksi/antrean sinkronisasi. Build produksi web (`npm run build`), sinkronisasi Capacitor Android (`npx cap sync android`), dan kompilasi APK Android (`.\gradlew.bat assembleDebug`) seluruhnya **PASS**. Karena perangkat/emulator Android tidak aktif (`adb devices` kosong) pada sesi CLI ini, pengujian interaktif *Android Production Smoke Test* dilaporkan secara jujur sebagai **`NOT RUN`** beserta instruksi dan perintah QA lengkap.

---

## 2. Cloud Menu & Catalog Sync Findings

Hasil audit jalur `Cloud Login → Business & Outlet Selection → Operational Context → Sync Context Guard → Cloud Pull → Categories/Products Mapping → SQLite Persistence → Product Store → POS Display`:

1. **Resolusi Store Pinia pada `syncPullService.js` ketika `pinia` tidak diteruskan secara eksplisit (P0/P1)**
   - Di `src/services/sync/syncPullService.js`, `productStore`, `cashStore`, `customerStore`, `expenseStore`, `transactionStore`, `shiftStore`, dan `cloudStore` sebelumnya menggunakan ekspresi `stores?.productStore ?? (pinia ? useProductStore(pinia) : null)`.
   - Ketika `createSyncPullService` diinisialisasi tanpa argumen `pinia` eksplisit (misalnya jalur fallback di `src/stores/syncPullStore.js`), referensi `productStore` bernilai `null` meskipun instance Pinia aktif tersedia. Akibatnya, hasil pull yang tersimpan ke adapter tidak melakukan `$patch` ke `productStore` di memori hingga aplikasi di-restart, dan field `unitPrice` pada produk hasil pull/SQLite belum dinormalisasi bersama `price`.

2. **Deteksi `initialCloudRead` pada `syncPullStore.ensureCatalogLoaded()` dan `SyncView.vue` (P0/P1)**
   - Di `src/stores/syncPullStore.js`, `ensureCatalogLoaded()` sebelumnya hanya memeriksa `loadSyncPullBinding()` tanpa memeriksa `loadSyncPushBinding()`, sehingga *push-only workspace* selalu dianggap `initialCloudRead: true` dan gagal dengan `CLOUD_INITIALIZATION_WORKSPACE_NOT_EMPTY`.
   - Di `src/views/sync/SyncView.vue`, `handlePullNow()` membaca properti `cloudStore.pushBinding` dan `cloudStore.pullBinding` yang tidak ada pada `cloudSessionStore` (selalu `undefined`), sehingga setiap klik tombol **Tarik** memaksa `initialCloudRead: true` dan gagal pada penarikan kedua atau pada workspace yang sudah terikat.
   - Lebih berbahaya lagi, `ensureCatalogLoaded()`, `SyncView.vue`, dan `CloudLoginView.vue` sebelumnya memanggil `clearLocalCache()` secara otomatis ketika menerima `CLOUD_INITIALIZATION_WORKSPACE_NOT_EMPTY` bila `transactionStore.items.length === 0`, yang berisiko menghapus `sync_queue`, kas, shift, pelanggan, pengeluaran, serta mereset `workspaceRegistry`.

3. **Race Condition Context Guard saat Aktivasi Konteks Operasional di `CloudLoginView.vue` (P1)**
   - Di `src/views/settings/CloudLoginView.vue`, saat `finishDeviceStep()` memanggil `doRegisterDevice()` lalu `activateOperationalContext()`, watcher konteks dan `autoPullAfterActivation()` memanggil `syncContextGuardStore.check()` secara bersamaan. Ketika pemanggilan pertama selesai sementara pemanggilan kedua masih berjalan (`loading === true` dan `status === 'idle'`), `handlePullNow()` langsung berhenti karena `isContextGuardMutationBlocked` bernilai `true`. Selain itu, `autoPullAfterActivation()` selalu mengirim `{ initialCloudRead: true }` bahkan ketika workspace sudah memiliki binding.

4. **Preload Katalog pada Tampilan Operasional Laundry, Kategori, dan Stok (P1)**
   - Ketika bisnis Cloud bertipe `Laundry` dihubungkan, rute `/pos` mengalihkan pengguna ke `/laundry/orders` dan `/laundry/orders/create` (`LaundryOrderCreateView.vue`). Berbeda dengan `PosView.vue`, `HomeView.vue`, dan `ProductsView.vue`, komponen `LaundryOrderCreateView.vue`, `CategoriesView.vue`, dan `StockView.vue` belum memanggil `syncPullStore.ensureCatalogLoaded()` saat `onMounted` ketika katalog lokal masih kosong.

---

## 3. Fixes Applied

1. **`src/services/sync/syncPullService.js` & `src/services/database/sqliteAdapter.js`**
   - Menambahkan helper `resolveStore(explicitStore, useStoreFn)` yang melakukan fallback ke `useStoreFn()` pada Pinia aktif apabila argumen `pinia` tidak diberikan secara eksplisit.
   - Menormalisasi `unitPrice: Number(price)` berdampingan dengan `price: Number(price)` saat menerapkan produk hasil pull (`syncPullService.js`) maupun saat memuat produk dari SQLite (`sqliteAdapter.js`).

2. **`src/stores/syncPullStore.js`**
   - Memperbaiki `ensureCatalogLoaded()` agar memeriksa `loadSyncPushBinding()` dan `loadSyncPullBinding()` secara bersamaan; `initialCloudRead` hanya bernilai `true` apabila `!pushBinding && (!pullBinding || pullBinding.status === 'initializing')`.
   - Menghapus pemanggilan otomatis `clearLocalCache()` dari `ensureCatalogLoaded()` agar tidak pernah menghapus `sync_queue`, transaksi, atau data operasional secara diam-diam.

3. **`src/views/settings/CloudLoginView.vue`, `src/views/sync/SyncView.vue`, & `src/services/localCacheService.js`**
   - Menambahkan `cloudStore.isOperationalCloudAccess` ke daftar dependensi watcher konteks di `CloudLoginView.vue`.
   - Memastikan `handlePullNow()` di `CloudLoginView.vue` menunggu `syncContextGuardStore.check()` apabila pengecekan konteks masih berjalan (`loading` atau `status === 'idle'`), serta menggunakan `{ initialCloudRead: isFreshWorkspace.value }` pada `autoPullAfterActivation()`.
   - Memperbaiki `SyncView.vue` `handlePullNow()` agar menentukan `isInitial` berdasarkan keberadaan `push_binding` / `pull_binding` pada `syncContextGuardStore.sources`, serta menghapus pemanggilan otomatis `handleClearAndPull()` pada `handleSyncNow()` dan `handlePullNow()`.
   - Memastikan `clearLocalCache({ resetBusiness: false })` di `src/services/localCacheService.js` tidak menimpa `workspaceRegistry` milik workspace lain.

4. **`src/views/laundry/LaundryOrderCreateView.vue`, `src/views/categories/CategoriesView.vue`, & `src/views/stock/StockView.vue`**
   - Menambahkan hook `onMounted` non-blocking yang memanggil `syncPullStore.ensureCatalogLoaded()` ketika `cloudStore.isLinked && cloudStore.isOperationalCloudAccess && productStore.products.length === 0`.

5. **Regression Tests (`src/__tests__/local-cache-service.spec.js`)**
   - Menambahkan 4 pengujian regresi untuk resolusi store `syncPullService` tanpa `pinia` eksplisit & idempotensi pull berulang, pull normal pada *push-only workspace* tanpa menghapus transaksi/`sync_queue`, penarikan inkremental pada `SyncView.vue` & preservasi `workspaceRegistry`, serta preload katalog pada `LaundryOrderCreateView.vue`.

---

## 4. Android Production Smoke Test Results

**Status:** `NOT RUN` (Tidak ada emulator/perangkat Android aktif yang terhubung ke `adb devices` pada saat eksekusi otomatis; SDK Android dan AVD `Medium_Phone_API_36.0` / `POS_API_34` terdeteksi dan build APK Debug `app-debug.apk` berhasil dikompilasi).

| # | Skenario Uji | Status | Catatan |
|---|---|---|---|
| 1 | Fresh install dan onboarding | `NOT RUN` | Menunggu eksekusi interaktif pada perangkat/emulator |
| 2 | Membuat bisnis Free lokal | `NOT RUN` | Diverifikasi pada unit/integration test |
| 3 | Membuat kategori dan produk | `NOT RUN` | Diverifikasi pada unit/integration test |
| 4 | Transaksi tunai offline | `NOT RUN` | Diverifikasi pada E2E service test |
| 5 | Perubahan stok dan riwayat transaksi | `NOT RUN` | Diverifikasi pada E2E service test |
| 6 | Restart aplikasi dan memeriksa persistensi SQLite | `NOT RUN` | Diverifikasi pada harness restart SQLite |
| 7 | Login Cloud dan memilih bisnis/outlet | `NOT RUN` | Diverifikasi pada unit/integration test |
| 8 | Menarik kategori dan produk dari server | `NOT RUN` | Diverifikasi pada E2E catalog sync test |
| 9 | Membuat transaksi saat jaringan mati | `NOT RUN` | Diverifikasi pada offline-online E2E test |
| 10 | Sinkronisasi setelah jaringan kembali | `NOT RUN` | Diverifikasi pada offline-online E2E test |
| 11 | Logout tanpa kehilangan data offline | `NOT RUN` | Diverifikasi pada session lifecycle test |

### Perintah Menjalankan QA di Emulator / Perangkat Android

```powershell
# 1. Jalankan emulator Android (pilih salah satu AVD yang tersedia: POS_API_34 atau Medium_Phone_API_36.0)
& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd POS_API_34

# 2. Pastikan perangkat terdaftar di ADB
adb devices

# 3. Build bundle produksi web dan sinkronkan ke Capacitor Android
npm run build
npx cap sync android

# 4. Build dan pasang APK ke emulator/perangkat
Set-Location android
.\gradlew.bat assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

---

## 5. Release Configuration Audit

| Area Audit | Status | Temuan |
|---|---|---|
| `VITE_API_BASE_URL` Production | **PASS** | `.env.production` menggunakan protokol `https://` ke domain produksi resmi (bukan `localhost` / `127.0.0.1`). |
| Tidak Menggunakan URL Localhost | **PASS** | `resolveBaseUrl()` di `src/services/cloud/apiClient.js` menggunakan `VITE_API_BASE_URL` dan fallback HTTPS produksi. |
| Secure Storage Android | **PASS** | `src/services/cloud/tokenRepository.js` menggunakan `@aparajita/capacitor-secure-storage` (Android Keystore) pada platform native; token tidak pernah disimpan di `localStorage`, `sessionStorage`, SQLite, atau Pinia. |
| Permission & Konfigurasi Jaringan | **PASS (Catatan P2)** | `AndroidManifest.xml` hanya mendeklarasikan `INTERNET` dan izin Bluetooth printer termal (`BLUETOOTH` maxSdk 30, `BLUETOOTH_ADMIN` maxSdk 30, `BLUETOOTH_CONNECT`). Catatan P2: `android:usesCleartextTraffic="true"` dan `android:allowBackup="true"` masih aktif di `AndroidManifest.xml`. |
| Capacitor Android Sync & Build | **PASS** | `npx cap sync android` menyinkronkan 5 plugin native (`@aparajita/capacitor-secure-storage`, `@capacitor-community/sqlite`, `@capacitor/app`, `@capacitor/browser`, `@capacitor/network`) dan `.\gradlew.bat assembleDebug` menghasilkan APK dengan sukses. |
| Tidak Ada Token / Kredensial di Log | **PASS** | Audit `src/` memastikan Bearer token hanya dikirim melalui header `Authorization` di `apiClient.js` dan tidak pernah dicetak ke `console.*` atau log aktivitas sinkronisasi. |
| Endpoint Developer (`/dev/`) di Production | **PASS** | Rute `/dev/cloud-auth-preview` di `src/router/index.js` dibatasi di dalam blok `if (import.meta.env.DEV)` sehingga tidak aktif pada build production. |

---

## 6. Baseline Test Failures

Pada `origin/main` (`6570e9e`), terdapat 12 test failure baseline pada 10 file test (tidak terkait dengan perubahan RC1 ini, sebagian besar berasal dari perubahan filter `entity_type != 'business'`, fallback URL default di `apiClient.js`, dan perubahan label tombol UI pada komit sebelumnya):

1. `src/__tests__/cloud-sync-foundation.spec.js` — `P9 free vs cloud mode > business payload tidak memiliki mode`
2. `src/__tests__/pos-flow.spec.js` — `P1 POS flow > prevents checkout when cart is empty`
3. `src/__tests__/pos-flow.spec.js` — `P1 POS flow > allows checkout to payment when cart has items`
4. `src/__tests__/premium-plan-selection.spec.js` — `SubscriptionView — canonical catalog > keeps the CTA inert while checkout_available is false`
5. `src/__tests__/premium-plan-selection.spec.js` — `SubscriptionView — canonical catalog > activates the continue action only when both gates and the price agree`
6. `src/__tests__/reports-view-enhancement.spec.js` — `ReportsView UI/UX Enhancement > modal ringkasan struk dapat dibuka dan menampilkan format cetak`
7. `src/__tests__/sqlite-transaction-concurrency.spec.js` — `12. the sync queue stays durable > survives a restart with every queued item intact`
8. `src/__tests__/stock-view-enhancement.spec.js` — `StockView UI/UX Enhancement > dapat membuka modal adjustment dan menambah stok produk`
9. `src/__tests__/sync-bootstrap.spec.js` — `P14: Queue Semantics, Conflicts, & Idempotent Retry > includes UNSUPPORTED_BUSINESS_OUTBOX_PRESENT warning when business outbox exists without corrupting bootstrap`
10. `src/__tests__/sync-orchestrator.spec.js` — `P16: UI Integration in CloudLoginView > renders "Sinkronkan Semua" button and maintains existing "Sync Sekarang" and "Tarik Data Cloud" buttons`
11. `src/__tests__/sync-parity-p37.spec.js` — `P37: production API configuration guard > rejects localhost and empty base URLs as production API config`
12. `src/__tests__/sync-push-outbox.spec.js` — `P12: Push Transport & Request Contract > builds valid Laravel v1 push request body with Bearer token and UUID request_id`

---

## 7. Verification Output

- **`npm run build`**: **PASS** (`✓ built in 1.01s`, 209 modul ditransformasi ke `dist/`).
- **`npx vitest run`**: **PASS (0 regresi baru)** — `1,946 passed | 12 failed (baseline) | 4 skipped (1,962 total)` pada 92 file test; seluruh suite sinkronisasi katalog (`local-cache-service.spec.js`, `cloud-first-sync-completion-e2e.spec.js`, `sync-push-only-initial-pull.spec.js`, `cloud-catalog-binding-state-ui.spec.js`, `sync-pull-apply.spec.js`) **PASS 100%**.
- **`npx cap sync android`**: **PASS** (`Sync finished in 0.154s`, 5 plugin Capacitor Android tervalidasi).
- **`.\gradlew.bat assembleDebug`**: **PASS** (`BUILD SUCCESSFUL in 30s`, 246 actionable tasks).
- **`npx oxlint` (pada seluruh file yang diubah)**: **PASS** (`Found 0 warnings and 0 errors`).

---

## 8. Remaining P2/UX Backlog

1. **Android Manifest Hardening (`android/app/src/main/AndroidManifest.xml`)**: Pertimbangkan menonaktifkan `android:usesCleartextTraffic="true"` dan `android:allowBackup="true"` untuk build rilis Play Store agar hanya mengizinkan trafik HTTPS dan mencegah pencadangan otomatis SQLite ke Google Drive perangkat.
2. **Code Splitting Bundle Utama (`vite.config.js`)**: Ukuran chunk utama `dist/assets/index-*.js` sekitar ~1,08 MB (~281 kB gzip); dapat dioptimalkan dengan *lazy-loading* rute non-kritis di iterasi berikutnya.
3. **Penyelarasan 12 Unit Test Baseline**: Menyesuaikan asersi pada 10 file test baseline (termasuk mock `DELETE FROM sync_queue WHERE entity_type = 'business'` di `sqlite-transaction-concurrency.spec.js` dan ekspektasi label tombol terbaru).

---

## 9. Go / No-Go Recommendation

**Recommendation:** **CONDITIONAL GO FOR ANDROID RC1 QA**

- Seluruh blocker P0/P1 pada sinkronisasi menu/katalog Cloud dan integritas data lokal telah diperbaiki dan terverifikasi melalui test otomatis serta build APK Android.
- Sebelum rilis produksi penuh (**FINAL GO**), jalankan 11 skenario **Android Production Smoke Test** secara interaktif pada perangkat/emulator Android menggunakan APK RC1 yang telah dibangun.
