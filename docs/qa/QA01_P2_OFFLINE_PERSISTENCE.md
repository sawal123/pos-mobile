# QA Report: QA-01 / P2 — Offline Transaction & SQLite Persistence

**Repository**: https://github.com/sawal123/pos-mobile  
**Branch**: `qa/qa01-p2-offline-persistence`  
**Base Commit**: `7d7492b` (Merge pull request #42 from sawal123/qa/qa01-p0-production-connectivity)  
**Date**: 2026-09-24  
**Author**: Senior Software Engineer & QA Automation Engineer  

---

## 1. Environment Pengujian

| Komponen | Spesifikasi Aktual |
|---|---|
| Sistem Operasi | Windows 11 Pro (win32 10.0.26100) |
| Runtime | Node.js v22.18.0 / npm 10.9.3 |
| Test Runner | Vitest 4.1.11 (`vitest` ^4.1.10) |
| UI & State Framework | Vue 3.5.40 (`vue` ^3.5.40), Pinia 4.0.2 (`pinia` ^4.0.2), Vue Router 5.2.0 |
| Bundler | Vite 8.2.2 (`vite` ^8.1.5) |
| Mobile Engine | Capacitor 8.5.0 (`@capacitor/core` ^8.5.0, `@capacitor-community/sqlite` ^8.1.1, `@capacitor/android` ^8.5.0) |
| Database Adapter | Memory Adapter (`createMemoryAdapter`) & SQLite Adapter (`createSQLiteAdapter`) |
| Perangkat Fisik / Android Emulator | **TIDAK TERHUBUNG** (`adb devices` kosong). Sesuai klausul QA-01 P2, pengujian native Android dilaporkan sebagai **NOT TESTED**. |

---

## 2. Audit Arsitektur Offline & Persistence

### 2.1 Inisialisasi & Resolusi Adapter
- **Browser Development (`!Capacitor.isNativePlatform()`)**: `resolvePersistenceAdapter()` mengembalikan `createMemoryAdapter()`. Data disimpan dalam memori JavaScript selama siklus hidup sesi browser/test runner.
- **Android / iOS Device (`Capacitor.isNativePlatform()`)**: `resolvePersistenceAdapter()` mewajibkan plugin `@capacitor-community/sqlite`. Jika tidak tersedia, melempar `NativePersistenceError` (`NATIVE_PERSISTENCE_UNAVAILABLE`). Kegagalan inisialisasi native menghentikan bootloader aplikasi (`renderNativePersistenceFatal`) untuk melindungi integritas transaksi lokal.

### 2.2 Perbedaan Memory Adapter vs Native SQLite
| Karakteristik | Memory Adapter | Native SQLite (`CapacitorSQLite`) |
|---|---|---|
| Engine | JavaScript In-Memory Map/Array | Native Android/iOS SQLite C-Engine via Capacitor Plugin |
| Storage Backing | RAM (Transient) | Local App Sandboxed SQLite DB (`pos_mobile.db`) |
| Transaksi ACID | Simulatid / In-memory commit | Native SQLite `BEGIN TRANSACTION` / `COMMIT` / `ROLLBACK` |
| Migrasi Schema | In-memory version pointer | Native `PRAGMA user_version`, `addUpgradeStatement` (v1 -> v4) |
| Batasan QA | Memvalidasi integritas logika store, watcher, dan hydration Pinia. **TIDAK BISA** diklaim sebagai bukti persistensi fisik SQLite pada storage flash internal perangkat Android. |

### 2.3 Persistensi Pinia (`persistenceService.js`)
Stores yang dipersistensikan secara reaktif melalui Vue `watch()`:
- `businessStore` (name, type, owner, phone, outlet, mode) -> tabel `business`
- `taxStore` (enabled, rate) -> tabel `app_state` (`tax_settings`)
- `productStore` (products, categories, stockMovements) -> tabel `products`, `categories`, `app_state` (`stock_movements_state`)
- `customerStore` (customers) -> tabel `customers`
- `expenseStore` (expenses) -> tabel `expenses`
- `transactionStore` (items) -> tabel `transactions` (JSON payload)
- `cashierStore` (activeCashier) -> tabel `app_state` (`cashier_state`)
- `cashStore` (entries) -> tabel `app_state` (`cash_state`)
- `shiftStore` (isOpen, openingBalance, openedAt, id, shiftNumber, status, closingBalance, closedAt, notes) -> tabel `app_state` (`shift_state`)
- `printerStore` (selectedPrinter, paperWidth) -> tabel `app_state` (`printer_state`)

---

## 3. Matriks Hasil Pengujian (Test Results)

| No | Modul / Skenario Pengujian | Target & Expected Result | Adapter | Status |
|:---:|---|---|:---:|:---:|
| **3.1** | **Mode Free Offline** | Seluruh alur (setup bisnis, PIN kasir, CRUD produk/kategori, transaksi, pembayaran, kas, shift, pengeluaran, riwayat) berjalan 100% tanpa internet, tanpa login Cloud, dan tanpa bearer token. | Memory | **PASS** |
| **3.2** | **Transaksi & Snapshot Harga** | Mengubah harga master produk setelah transaksi selesai tidak mempengaruhi harga pada transaksi yang tersimpan. | Memory | **PASS** |
| **3.3** | **Snapshot HPP & Gross Profit** | Nilai HPP (`hppSnapshot` / `costSnapshot`) terkunci saat checkout; gross profit dihitung presisi berdasarkan snapshot `(price - hpp) * qty`. | Memory | **PASS** |
| **3.4** | **Pajak Dinamis (Tax Enabled/Disabled)** | Perhitungan subtotal, tax, dan total konsisten; atribut `taxEnabled` dan `taxRate` tersimpan akurat pada payload transaksi. | Memory | **PASS** |
| **3.5** | **Uang Diterima & Kembalian** | Pembayaran tunai memvalidasi `cashReceived >= total` dan mencatat `changeAmount` dengan benar. | Memory | **PASS** |
| **3.6** | **Stok Negatif: Penjualan Melebihi Stok** | Penjualan 5 unit dari stok awal 2 menghasilkan stok -3 dengan tepat satu `stockMovement` bertipe `sale`. | Memory | **PASS** |
| **3.7** | **Stok Negatif: Penyesuaian Manual** | `adjustStock()` dari stok 0 menjadi -4 berhasil dicatat dengan `stockBefore: 0`, `stockAfter: -4`, dan `quantityChange: -4`. | Memory | **PASS** |
| **3.8** | **Validasi Kuantitas & Keaktifan Produk** | Kuantitas tidak valid (0, negatif, bukan angka), produk non-aktif, dan produk tidak ditemukan tetap ditolak oleh `canFulfillSale()`. | Memory | **PASS** |
| **3.9** | **Pengecualian Layanan Laundry** | Layanan laundry (`kind: 'service'`) tidak memakai dan tidak mengurangi stok (`adjustStock` ditolak, penjualan tidak mencatat movement). | Memory | **PASS** |
| **3.10** | **Batas Stok Minimum** | `lowStockProducts` mendeteksi produk dengan `stock <= minStock`, termasuk produk bersaldo stok negatif. | Memory | **PASS** |
| **3.11** | **Transaksi Riil (`localOperationService`)** | `commitRetailSale()` mengeksekusi operasi transaksi, pengurangan stok, dan ledger kas secara durabel serta bebas duplikasi setelah restart. | Memory | **PASS** |
| **3.12** | **Persistensi Shift Terbuka** | Restart saat shift masih buka memulihkan `isOpen: true`, `id`, `shiftNumber`, `status: 'open'`, `openingBalance`, `openedAt`, `notes` tanpa membuat saldo awal duplikat. | Memory | **PASS** |
| **3.13** | **Persistensi Shift Ditutup** | Restart setelah shift ditutup memulihkan `isOpen: false`, `id`, `shiftNumber`, `status: 'closed'`, `closingBalance`, `closedAt`, `notes` secara utuh. | Memory | **PASS** |
| **3.14** | **Bisnis: Cafe / UMKM** | Transaksi makanan & minuman, multi-item, variasi kuantitas, pajak, dan kembalian tunai terverifikasi. | Memory | **PASS** |
| **3.15** | **Bisnis: Laundry (Kiloan Desimal & Pelunasan)** | Kuantitas desimal 2.5 kg × Rp 10.000 terhitung Rp 25.000; order belum bayar (`unpaid`) tidak menambah kas; status pengerjaan advance `Masuk` -> `Diproses` -> `Siap Diambil` -> `Selesai`; pelunasan via `settleLaundryOrderPayment()` mencatat kas secara idempoten. | Memory | **PASS** |
| **3.16** | **Bisnis: Grosir / Toko Kelontong** | Katalog produk dengan SKU, multi-item checkout, dan mutasi stok sembako beroperasi akurat. | Memory | **PASS** |
| **3.17** | **Kas & Shift (Pencegahan Duplikasi Kas)** | Transaksi tunai sama tidak membuat entri kas ganda (`referenceId: sale-${id}`). Transaksi non-tunai (QRIS) dilewati tanpa menambah saldo fisik. | Memory | **PASS** |
| **3.18** | **SQLite Row Deserializer** | `deserializeTransactionRows()` mampu mengekstrak payload JSON transaksi valid dan mengabaikan baris korup secara aman tanpa crash. | SQLite Unit Mock | **PASS** |
| **3.19** | **Backup & Restore (Termasuk Stok Negatif)** | Ekspor dan validasi payload v2 mengizinkan stok negatif (-3), menolak NaN/Infinity; restore memulihkan produk, transaksi, dan stock movement utuh tanpa duplikasi. | Memory | **PASS** |
| **3.20** | **Isolasi Sinkronisasi Mode Free** | Tidak ada panggilan jaringan ke backend Laravel produksi; outbox tetap terlindungi. | Memory | **PASS** |
| **3.21** | **Native SQLite pada Perangkat Android** | Pengujian database SQLite fisik pada perangkat Android / emulator. | Native Android | **NOT TESTED** |

---

## 4. Temuan dan Perbaikan Bug (Findings & Bug Fixes)

### 4.1 Perbaikan Stok Negatif untuk Kebutuhan POS Offline
- **Lokasi**:
  - `src/stores/productStore.js`
  - `src/stores/cartStore.js`
- **Masalah**:
  1. `productStore.canFulfillSale()` sebelumnya menolak penjualan apabila `quantity > product.stock`.
  2. `productStore.adjustStock()` sebelumnya memiliki guard `if (stockAfter < 0) return { success: false, error: 'Stok tidak boleh kurang dari 0.' }`.
  3. `cartStore.js` sebelumnya membatasi penambahan dan pengubahan kuantitas produk ke keranjang (`nextQty > product.stock`).
- **Perbaikan**:
  1. Menghapus batasan `quantity > product.stock` pada `canFulfillSale()` dan menggantinya dengan validasi kuantitas (`!Number.isFinite(quantity) || quantity <= 0`), pengecekan keaktifan produk, serta keberadaan produk.
  2. Menghapus guard `stockAfter < 0` pada `adjustStock()`, sehingga stok dapat bergerak ke nilai negatif (misal: 2 menjadi -3 saat menjual 5 unit, atau 0 menjadi -4 saat penyesuaian manual).
  3. Menghapus pembatasan stok di `cartStore.js` agar kasir dapat memasukkan kuantitas melebihi stok yang tercatat secara offline.
- **Hasil Verifikasi**:
  - Penjualan 5 unit dari stok awal 2 menghasilkan stok -3 dengan 1 stock movement.
  - Penyesuaian manual dari stok 0 menjadi -4 berhasil.
  - Seluruh pengujian regresi pada `qa-offline-persistence.spec.js` dan `offline-business-core.spec.js` lulus.

### 4.2 Shift Metadata Terpotong Saat Rehidrasi / Restart
- **Lokasi**: `src/services/database/persistenceService.js`
- **Masalah**: Fungsi `read()` pada konteks persistensi shift sebelumnya hanya membaca `{ isOpen, openingBalance, openedAt }`. Properti `id`, `shiftNumber`, `status`, `closingBalance`, `closedAt`, dan `notes` ter-reset ke `null` setelah aplikasi ditutup dan dibuka kembali.
- **Perbaikan**: Memperbarui `read()` pada konteks shift agar menyertakan seluruh properti shift:
  ```javascript
  read() {
    return {
      isOpen: shiftStore.isOpen,
      openingBalance: shiftStore.openingBalance,
      openedAt: shiftStore.openedAt,
      id: shiftStore.id,
      shiftNumber: shiftStore.shiftNumber,
      status: shiftStore.status,
      closingBalance: shiftStore.closingBalance,
      closedAt: shiftStore.closedAt,
      notes: shiftStore.notes,
    }
  }
  ```
- **Hasil Verifikasi**: Regression test memastikan restart ketika shift masih terbuka dan setelah shift ditutup mempertahankan seluruh metadata shift tanpa membuat duplikasi saldo awal.

### 4.3 Validasi Stok Negatif pada Backup Service
- **Lokasi**: `src/services/backupService.js`
- **Masalah**: Fungsi `validateProductsData()` dan `validateStockMovementsData()` sebelumnya memvalidasi `isFiniteNumber(product.stock, { min: 0 })`, `stockBefore: { min: 0 }`, dan `stockAfter: { min: 0 }`. Validasi ini menolak file backup jika terdapat produk atau pergerakan dengan nilai stok negatif.
- **Perbaikan**: Memperbarui validasi agar `product.stock`, `stockBefore`, dan `stockAfter` menggunakan `isFiniteNumber(val)` (tanpa batasan minimum 0). Dengan demikian, nilai negatif (seperti -3) diizinkan, tetapi nilai tidak valid (`NaN`, `Infinity`, `-Infinity`, string, tipe data non-numerik) tetap ditolak secara ketat.
- **Hasil Verifikasi**: Regression test membuktikan stok awal 2, penjualan 5 unit, dan stok akhir -3 dapat di-backup dan di-restore dengan produk, transaksi, dan stock movement utuh tanpa duplikasi.

---

## 5. Analisis Ketidaksesuaian Arsitektur & Blocker Sinkronisasi (P3 Blocker)

> [!WARNING]
> **BLOCKER P3: Ketidaksesuaian Penanganan Stok Negatif antara POS Mobile dan Backend Laravel**
>
> - **Kebutuhan POS Mobile Offline (Client)**: Mengizinkan transaksi penjualan dan penyesuaian stok bergerak ke nilai negatif agar operasional kasir di lapangan tidak terhenti ketika terjadi keterlambatan pencatatan barang masuk atau selisih stok fisik.
> - **Kondisi Backend Laravel (Server)**:
>   1. Backend Laravel menolak `stock_after` negatif melalui validasi request **HTTP 422 Unprocessable Entity**.
>   2. Jika validasi input tersebut dilewati tetapi kalkulasi mutasi pada database server menghasilkan stok negatif, service backend mengembalikan status **HTTP 409 Conflict** dengan kode kesalahan **`STOCK_RECONCILIATION_REQUIRED`**.
> - **Dampak pada Sinkronisasi (P3)**: Ketika transaksi offline dengan stok negatif di-push dari POS Mobile ke Laravel via `syncPushService`, server akan menolak mutasi stok tersebut (HTTP 422 atau HTTP 409 `STOCK_RECONCILIATION_REQUIRED`), menyebabkan outbox gagal terkirim dan sinkronisasi tertahan.
> - **Rekomendasi Tindak Lanjut untuk P3**:
>   1. Backend Laravel perlu diperbarui agar mendukung stok negatif atau menyediakan alur rekonsiliasi otomatis untuk mutasi stok yang berasal dari offline checkout kasir.
>   2. Mekanisme resolution conflict di sisi klien perlu disiapkan untuk menangani penolakan stok dari server tanpa membatalkan transaksi penjualan yang sah di kasir.
>   *Catatan: Sesuai batasan lingkup PR #43, tidak ada perubahan kode yang dilakukan pada Laravel backend atau sinkronisasi produksi.*

---

## 6. Status Android Native

- **Status**: **NOT TESTED**
- **Keterangan**: Tidak ada perangkat fisik atau emulator Android yang terhubung (`adb devices` kosong). Pengujian unit test berbasis memory adapter dan mock SQLite SQLiteConnection membuktikan kebenaran logika JavaScript/Pinia, namun tidak diklaim sebagai bukti persistensi SQLite pada runtime native Android. Pengujian native akan dilakukan terpisah pada pipeline Android / emulator.
