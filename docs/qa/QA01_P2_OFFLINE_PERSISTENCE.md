# QA Report: QA-01 / P2 — Offline Transaction & SQLite Persistence

**Repository**: https://github.com/sawal123/pos-mobile  
**Branch**: `qa/qa01-p2-offline-persistence`  
**Base Commit**: `7d7492b` (Merge pull request #42 from sawal123/qa/qa01-p0-production-connectivity)  
**Date**: 2026-09-24  
**Author**: Senior Software Engineer & QA Automation Engineer  

---

## 1. Environment Pengujian

| Komponen | Spesifikasi |
|---|---|
| Sistem Operasi | Windows 11 Pro (win32 10.0.26100) |
| Runtime | Node.js v22.18.0 / npm 10.9.3 |
| Test Runner | Vitest 4.1.11 |
| Framework | Vue 3, Pinia 2, Vite 6 |
| Mobile Engine | Capacitor 7 (@capacitor/core, @capacitor-community/sqlite) |
| Database Adapter | Memory Adapter (`createMemoryAdapter`) & SQLite Adapter (`createSQLiteAdapter`) |
| Perangkat Fisik / Android Emulator | **TIDAK TERHUBUNG** (`adb devices` kosong). Sesuai klausul QA-01 P2, pengujian native Android dilaporkan sebagai **NOT TESTED**. |

---

## 2. Audit Arsitektur Offline & Persistence

### 2.1 Inisialisasi & Resolusi Adapter
- **Browser Development (`!Capacitor.isNativePlatform()`)**: `resolvePersistenceAdapter()` mengembalikan `createMemoryAdapter()`. Data disimpan dalam memori JavaScript selama siklus hidup sesi browser/test runner.
- **Android / iOS Device (`Capacitor.isNativePlatform()`)**: `resolvePersistenceAdapter()` mewajibkan plugin `@capacitor-community/sqlite`. Jika tidak tersedia, melempar `NativePersistenceError` (`NATIVE_PERSISTENCE_UNAVAILABLE`). Kegagalan inisialisasi native akan menghentikan bootloader aplikasi (`renderNativePersistenceFatal`) untuk melindungi integritas transaksi lokal.

### 2.2 Perbedaan Memory Adapter vs Native SQLite
| Karakteristik | Memory Adapter | Native SQLite (`CapacitorSQLite`) |
|---|---|---|
| Engine | JavaScript In-Memory Map/Array | Native Android/iOS SQLite C-Engine via Capacitor Plugin |
| Storage Backing | RAM (Transient) | Local App Sandboxed SQLite DB (`pos_mobile.db`) |
| Transaksi ACID | Simulatid / No-op rollback | Native SQLite `BEGIN TRANSACTION` / `COMMIT` / `ROLLBACK` |
| Migrasi Schema | In-memory version pointer | Native `PRAGMA user_version`, `addUpgradeStatement` |
| Batasan QA | Membuktikan logika store, watcher, dan hydration Pinia. **TIDAK BISA** diklaim sebagai bukti persistensi fisik SQLite pada storage flash internal perangkat Android. |

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
| **3.6** | **Stok & Inventory (Pengurangan Penjualan)** | Checkout penjualan mengurangi stok produk dan mencatat `stockMovements` bertipe `sale`. | Memory | **PASS** |
| **3.7** | **Stok & Inventory (Penyesuaian Manual)** | `adjustStock()` dapat menambah (+qty), mengurangi (-qty), dan menyetel stok nol dengan audit trail `stockMovements`. | Memory | **PASS** |
| **3.8** | **Stok & Inventory (Batas Stok Minimum)** | `lowStockProducts` mendeteksi produk dengan `stock <= minStock`. | Memory | **PASS** |
| **3.9** | **Stok & Inventory (Stok Negatif)** | Nilai stok negatif (-4) didukung penuh oleh project, tersimpan di database, dan termuat kembali tanpa error. | Memory | **PASS** |
| **3.10** | **Stok & Inventory (Pencegahan Double-Deduct)** | Restart aplikasi dan proses rehidrasi TIDAK mengurangi stok ulang ataupun menduplikasi `stockMovements`. | Memory | **PASS** |
| **3.11** | **Bisnis: Cafe / UMKM** | Transaksi makanan & minuman, multi-item, variasi kuantitas, pajak, dan kembalian tunai terverifikasi. | Memory | **PASS** |
| **3.12** | **Bisnis: Laundry (Kiloan Desimal & Pelunasan)** | Kuatitas desimal 2.5 kg × Rp 10.000 terhitung Rp 25.000; order belum bayar (`unpaid`) tidak menambah kas; status pengerjaan advance `Masuk` -> `Diproses` -> `Siap Diambil` -> `Selesai`; pelunasan via `settleLaundryOrderPayment()` mencatat kas secara idempoten. | Memory | **PASS** |
| **3.13** | **Bisnis: Grosir / Toko Kelontong** | Katalog produk dengan SKU, multi-item checkout, dan mutasi stok sembako beroperasi akurat. | Memory | **PASS** |
| **3.14** | **Kas & Shift (Siklus Shift)** | Buka shift (`openShift`), rekam saldo awal, tutup shift (`closeShift`), serta verifikasi saldo akhir. | Memory | **PASS** |
| **3.15** | **Kas & Shift (Pencegahan Duplikasi Kas)** | Transaksi tunai sama tidak membuat entri kas ganda (`referenceId: sale-${id}`). Transaksi non-tunai (QRIS) dilewati tanpa menambah saldo fisik. | Memory | **PASS** |
| **3.16** | **Persistensi & Restart Recovery** | Seluruh data (bisnis, PIN, produk, stok, transaksi, kas, shift, pengeluaran) utuh setelah restart instance Pinia. | Memory | **PASS** |
| **3.17** | **SQLite Row Deserializer** | `deserializeTransactionRows()` mampu mengekstrak payload JSON transaksi valid dan mengabaikan baris korup secara aman tanpa crash. | SQLite Unit Mock | **PASS** |
| **3.18** | **Backup & Restore** | Ekspor payload v2, validasi schema (`taxRate` numerik dan null, kuantitas desimal, HPP), pencegahan restore saat shift buka, dan pemulihan data berhasil. | Memory | **PASS** |
| **3.19** | **Isolasi Sinkronisasi Mode Free** | Tidak ada panggilan jaringan ke backend Laravel produksi; outbox tetap terlindungi. | Memory | **PASS** |
| **3.20** | **Native SQLite pada Perangkat Android** | Pengujian database SQLite fisik pada perangkat Android / emulator. | Native Android | **NOT TESTED** |

---

## 4. Temuan dan Perbaikan Bug (Findings & Bug Fixes)

### Bug: Shift Metadata Terpotong Saat Rehidrasi / Restart
- **Lokasi**: [persistenceService.js](file:///d:/PROJECT%20WEB/POS%20OFFLINE/pos-mobile/src/services/database/persistenceService.js#L180-L194)
- **Gejala**: Ketika shift dibuka atau ditutup, `shiftStore` menyimpan atribut `id`, `shiftNumber`, `status` (`open`/`closed`), `closingBalance`, `closedAt`, dan `notes`. Namun, fungsi `read()` di persistence context shift sebelumnya hanya membaca `{ isOpen, openingBalance, openedAt }`. Akibatnya, saat aplikasi ditutup dan dibuka kembali, proses hidrasi me-reset `shiftStore.id` dan `shiftStore.status` kembali ke `null`.
- **Perbaikan**: Memperbarui `read()` pada konteks shift agar menyertakan seluruh properti:
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
- **Hasil Verifikasi**: Regression test pada [qa-offline-persistence.spec.js](file:///d:/PROJECT%20WEB/POS%20OFFLINE/pos-mobile/src/__tests__/qa-offline-persistence.spec.js) memastikan `shiftId` dan `status` tetap konsisten setelah aplikasi di-restart.

---

## 5. Status Verifikasi Native Device & Blocker

1. **Android Physical Device / Emulator**:
   - Status: **NOT TESTED** (Tidak ada hardware/emulator yang terdeteksi via adb).
   - Pengujian persistence native SQLite harus dilakukan pada pipeline CI/CD Android atau perangkat fisik sebelum rilis APK produksi.
2. **Blocker Sinkronisasi Online (P3+)**:
   - Skema outbox `sync_queue` dan mutasi transaksi lokal sudah siap.
   - Tidak ada blocker arsitektur offline untuk melanjutkan ke tahap pengujian sinkronisasi push/pull bertahap.
