# Rencana Scan QR/Barcode dan Generate QR Produk Grosir

Tanggal: 4 November 2026

Status per 5 November 2026: implementasi mobile, build web/Android, dan tes fokus fitur selesai. Regresi penuh masih memiliki 14 kegagalan baseline yang sudah dikonfirmasi pada kode awal. QA kamera Android fisik dan integrasi backend live masih menunggu perangkat/lingkungan uji.

Catatan implementasi: [kontrak barcode mobile](../sync/PRODUCT_BARCODE_V1.md) dan [QA scan/QR grosir](../qa/QA_SCAN_QR_BARCODE_GROSIR.md).

Rencana pasangan: [Dashboard dan kontrak sinkronisasi QR/Barcode](../../../pos_dashboard/docs/plans/PLAN_SCAN_QR_BARCODE_GROSIR_DASHBOARD.md).

## 1. Tujuan

Untuk bisnis bertipe **Grosir / Toko Kelontong**, kasir dapat memindai QR code atau barcode melalui kamera lalu memasukkan produk ke keranjang. Pengelola juga dapat membuat QR code untuk produk, termasuk barang yang tidak memiliki barcode kemasan.

Scanner dan generator QR harus bekerja menggunakan katalog lokal, termasuk saat offline, tanpa syarat Premium. Akses Cloud tetap mengikuti aturan langganan yang sudah berlaku.

## 2. Temuan pada kode saat ini

| Area | Kondisi saat ini | Dampak pada rencana |
| --- | --- | --- |
| Jenis bisnis | `businessTemplates.js` menormalkan `grosir`, `retail`, dan `toko kelontong` menjadi `Grosir / Toko Kelontong`. | Gunakan `businessStore.normalizedType` untuk mengaktifkan fitur. |
| POS | `PosView.vue` memiliki pencarian katalog dan `handleProductAdd()` yang menangani pilihan varian. | Hasil scan harus masuk melalui alur tambah produk yang sama. |
| Produk | `ProductFormView.vue` memiliki satu kolom `SKU / Barcode`. `productStore.js` masih menggunakan barcode sebagai fallback SKU. | Pisahkan barcode dari SKU agar kode kemasan dan SKU internal dapat berbeda. |
| Keranjang | `cartStore.addItem()` menambah kuantitas baris produk/varian yang sama. | Jangan membuat mekanisme keranjang terpisah untuk hasil scan. |
| Stok | Kartu produk menolak tambah saat stok habis; pembayaran memanggil `canFulfillSale()`. | Scanner harus mengikuti aturan yang sama dan tidak mengurangi stok sebelum transaksi. |
| Android | Aplikasi menggunakan Capacitor 8; manifest aplikasi belum mendeklarasikan izin kamera. | Siapkan izin kamera dan lifecycle scanner. |
| QR produk | Belum ditemukan generator QR atau komponen scanner kamera pada kode aplikasi. | Kedua fitur perlu ditambahkan. QRIS pembayaran adalah alur terpisah. |
| SQLite | `schema.js` saat diperiksa berada pada versi 6; produk sudah memiliki kolom SKU, belum barcode terpisah. | Tambahkan migrasi pada versi berikutnya yang tersedia. |
| Cloud | `contractMapper.js` mengirim `barcode: null` dan membentuk SKU sinkronisasi sendiri. Pull masih menggabungkan barcode sebagai fallback SKU. | QR tidak boleh hanya bergantung pada SKU yang dapat berubah setelah sinkronisasi. |

## 3. Ruang lingkup versi pertama

- Tombol **Scan** di dekat pencarian pada halaman POS, khusus tipe Grosir / Toko Kelontong.
- Scan melalui kamera untuk QR Code, EAN-13, EAN-8, UPC-A, UPC-E, dan Code 128; dukungan format wajib dibuktikan pada perangkat uji sebelum dinyatakan selesai.
- Satu pembacaan yang berhasil menghasilkan satu aksi tambah produk, kemudian scanner ditutup.
- Produk yang sama boleh dipindai lagi dengan membuka scanner kembali untuk menambah kuantitas.
- Input barcode manual dan tombol scan barcode pada form tambah/edit produk.
- Aksi **QR Produk** dari daftar produk dan halaman edit produk yang sudah tersimpan.
- Pratinjau QR, teks kode produk, dan unduh label PNG berisi nama produk serta kode.
- Penyimpanan lokal, backup/restore, dan penyesuaian pemetaan Cloud untuk barcode.

Di luar versi pertama: scanner terus-menerus, scanner USB/Bluetooth, banyak barcode untuk satu produk, barcode berbeda per kemasan/varian, konversi dus ke satuan, cetak label massal, dan cetak QR langsung melalui printer thermal. Pembuatan kode EAN/UPC pabrikan juga tidak termasuk; generator yang ditambahkan menghasilkan **QR produk**.

## 4. Rancangan alur pengguna

### A. Scan dari POS ke keranjang

1. Kasir membuka POS pada bisnis Grosir / Toko Kelontong dan mengetuk **Scan**.
2. Izin kamera diminta saat fitur dipakai, bukan saat aplikasi dibuka.
3. Kamera belakang ditampilkan dalam panel scanner dengan bingkai bidik, petunjuk singkat, dan tombol tutup.
4. Setelah satu kode terbaca, pembacaan dikunci dan kamera dihentikan.
5. Sistem mencari kecocokan kode di seluruh katalog bisnis aktif, tanpa terpengaruh filter kategori atau kata kunci pencarian.
6. Jika ditemukan satu produk aktif, dapat dijual, dan stoknya tersedia:
   - Tanpa varian: panggil alur tambah produk yang digunakan tombol tambah manual.
   - Dengan varian: buka pemilihan varian yang sudah ada; produk masuk setelah kasir mengonfirmasi. Membatalkan pilihan tidak menambah produk.
7. Tampilkan pesan singkat, misalnya **“Indomie Goreng ditambahkan ke keranjang”**. Jumlah item dan total belanja ikut diperbarui.
8. Kamera tidak boleh tetap aktif di belakang pemilihan varian atau halaman pembayaran.

### B. Menambahkan barcode pada produk

1. Pada form produk grosir, tampilkan **SKU** dan **Barcode / Kode Scan** sebagai dua kolom terpisah.
2. Pengguna dapat mengetik barcode atau mengetuk ikon kamera di kolom barcode.
3. Hasil scan pada form hanya mengisi kolom; tidak menambah keranjang dan tidak langsung menyimpan produk.
4. Penyimpanan memvalidasi kode agar tidak berbenturan dengan produk lain dalam bisnis yang sama.
5. Jika barcode dikosongkan, sistem menyiapkan kode internal unik saat penyimpanan produk berhasil. Kode tidak dibuat ulang ketika produk diedit.

### C. Generate QR produk

1. Pengguna membuka **QR Produk** dari aksi produk yang sudah tersimpan.
2. Jika produk memiliki barcode, QR dibentuk dari barcode tersebut.
3. Jika produk lama belum memiliki barcode, tampilkan aksi **Buat Kode & QR**. Simpan kode internal unik lebih dahulu melalui alur penyimpanan produk, lalu tampilkan QR.
4. Pratinjau menampilkan nama produk, nilai kode, QR dengan ruang putih yang cukup di sekelilingnya, serta tombol **Unduh PNG**.
5. Label yang diunduh dapat dipindai kembali dari POS dan harus menemukan produk yang sama.
6. Membuka ulang pratinjau atau mengganti nama/harga produk tidak mengubah kode. Mengganti barcode secara sengaja menampilkan penjelasan bahwa label QR lama perlu diganti.

Penempatan aksi mengikuti menu produk yang ada agar daftar produk tetap ringkas. Tidak menambah panel baru pada halaman Setting.

## 5. Aturan kode dan pencocokan produk

| Data | Keputusan |
| --- | --- |
| `sku` | Tetap dipertahankan sebagai SKU internal dan untuk kompatibilitas data lama. |
| `barcode` | Field string terpisah sebagai kode scan utama, berisi barcode kemasan atau kode internal hasil generate. |
| Kode internal | Gunakan prefix seperti `NXP-` dan UUID; cek benturan sebelum menyimpan. Tidak bergantung pada ID lokal yang dapat berubah. |
| Isi QR | Nilai `barcode` sebagai teks biasa. Tidak berisi harga, stok, data akun, atau URL. |
| Gambar QR | Dibentuk saat diperlukan; tidak disimpan sebagai base64 dalam record produk. |
| Data lama | Barcode yang belum tersedia dinormalisasi menjadi string kosong. Jangan membuat kode baru secara massal saat startup atau restore. |

Aturan resolver:

- Perlakukan hasil scan sebagai string; trim spasi di awal/akhir, pertahankan nol di depan, karakter internal, dan huruf besar/kecil.
- Batasi panjang input maksimal 255 karakter sesuai kontrak barcode dashboard, dan tolak kode kosong atau karakter kontrol yang tidak didukung.
- Cari kecocokan persis terhadap `barcode` dan SKU lama. Gabungkan hasil berdasarkan identitas produk agar satu produk tidak dihitung dua kali.
- Jika kode menunjuk beberapa produk, jangan memilih hasil pertama. Tampilkan **“Kode digunakan beberapa produk. Perbaiki kode produk terlebih dahulu.”**
- Validasi penyimpanan barcode terhadap barcode maupun SKU produk lain agar fallback data lama tidak menimbulkan hasil ambigu. Saat edit, kecualikan produk itu sendiri.
- Jika produk tidak aktif, bukan barang jual, berupa layanan, atau stok habis, jangan tambahkan ke keranjang dan tampilkan alasan yang sesuai.
- Jangan membuka tautan atau menjalankan isi QR. Kode yang tidak cocok hanya menghasilkan pesan tidak ditemukan.
- Scan tidak mengubah harga, membuat transaksi, atau mengurangi stok. Perhitungan promo, pajak, dan validasi pembayaran tetap memakai alur yang ada.

## 6. Kamera, offline, dan kondisi gagal

- Buat layanan scanner dengan antarmuka yang sama untuk mode **tambah keranjang** dan **isi barcode produk**.
- Pada tahap teknis awal, pilih implementasi kamera/decoder yang kompatibel dengan Capacitor 8 dan buktikan QR serta barcode pada Android fisik.
- Decoder dan generator harus dibundel bersama aplikasi. Uji pemasangan baru dalam mode pesawat agar tidak ada ketergantungan unduhan model saat pertama dipakai.
- Jangan bergantung hanya pada kemampuan barcode bawaan browser. Untuk web, sediakan decoder lokal yang telah diverifikasi dan tangani kebutuhan akses kamera pada konteks yang didukung.
- Izin ditolak: tampilkan alasan dan pilihan mencoba lagi; pencarian produk/input manual tetap tersedia.
- Kamera tidak tersedia, sedang dipakai, atau gagal dibuka: tampilkan pesan yang bisa ditindaklanjuti dan tombol tutup.
- Kode tidak ditemukan: tampilkan kode yang terbaca dan aksi **Scan Lagi**; tidak otomatis membuat produk baru.
- Cegah callback dari beberapa frame kamera menghasilkan penambahan berulang menggunakan pengunci satu hasil per sesi.
- Saat panel ditutup, route berubah, aplikasi masuk background, atau komponen dilepas: hentikan kamera, listener, dan proses decode. Kembali ke foreground tidak otomatis melanjutkan scan.
- Saat bisnis/akun aktif berubah: batalkan sesi dan abaikan callback lama agar produk dari konteks sebelumnya tidak masuk ke keranjang bisnis baru.
- Proses frame kamera hanya untuk decode lokal; tidak perlu mengunggah atau menyimpan gambar kamera.

## 7. Penyimpanan, backup, dan Cloud

### Penyimpanan lokal

- Tambahkan `barcode` pada normalisasi, validasi, create, update, dan hasil pembacaan produk.
- Tambahkan migrasi SQLite untuk kolom barcode dengan default string kosong; gunakan nomor versi berikutnya setelah memeriksa migrasi terbaru saat implementasi.
- Perbarui seluruh jalur SQL produk: insert, update/upsert, hydration, import, restore, dan penggantian snapshot. Menambah field di Pinia saja tidak cukup.
- Samakan perilaku adapter memory dengan SQLite.
- Simpan perubahan barcode melalui operasi lokal/jurnal dan antrean sinkronisasi yang berlaku. Jangan menulis langsung ke database dari komponen QR.

### Backup dan restore

- Sertakan barcode dalam backup lokal maupun Cloud dan dalam penerapan restore.
- Backup lama tanpa barcode tetap dapat dibaca; aturan pengisian barcode mengikuti normalisasi data lama.
- Putuskan kebutuhan kenaikan versi backup berdasarkan kontrak skema, bukan otomatis. Jika perlu, pertahankan kompatibilitas versi yang sudah didukung.
- QR tetap bisa digunakan setelah restore karena mengacu pada kode produk yang tersimpan, bukan ID sementara.
- Jika backup/pull membawa kode duplikat, jangan diam-diam menghapus atau mengganti kode. Resolver harus menolak hasil ambigu dan UI membantu pengguna memperbaikinya.

### Sinkronisasi Cloud

- Hasil pemeriksaan repositori dashboard: barcode sudah tersimpan terpisah dari SKU dan sudah tersedia pada pull. Perubahan backend difokuskan pada kompatibilitas push, validasi bersama, dan generator QR; detailnya ada pada rencana pasangan.
- Selaraskan usulan `barcode_action` (`set`/`clear`) dan `catalog_capabilities.product_barcode_v1` pada rencana dashboard. Payload null dari mobile lama harus mempertahankan barcode server; klien baru tidak menyimpulkan clear dari field kosong tanpa aksi pengguna.
- Verifikasi kontrak API yang berlaku untuk menerima dan mengembalikan field barcode sebelum mengubah mapper.
- Ubah pengiriman `barcode: null` menjadi barcode produk sesuai kontrak, sambil mempertahankan aturan pembentukan SKU sinkronisasi yang sudah ada.
- Pada pull, simpan barcode dan SKU secara terpisah. Bedakan field barcode yang tidak dikirim dengan permintaan pengosongan yang sah menurut kontrak.
- Uji kode tetap sama setelah push, pull, relink, serta digunakan pada perangkat lain dengan bisnis yang sama.
- Jika backend belum mendukung penyimpanan barcode, catat kebutuhan perubahan backend sebagai dependensi Cloud. Jangan mengklaim dukungan lintas perangkat selesai atau membiarkan pull menghapus kode lokal tanpa aturan yang jelas.
- Hak scan tidak memberi hak mengubah katalog: untuk akun dengan mode `cashier_safe`, gunakan barcode yang sudah ditarik dari pengelola. Generate/ubah kode produk tertaut hanya tersedia jika role/capability memang mengizinkan mutasi produk; jangan menambahkan mutasi produk melalui sync kasir.

## 8. Peta perubahan yang direncanakan

Nama file baru di bawah adalah usulan dan dapat disesuaikan dengan pola proyek.

| File/area | Perubahan |
| --- | --- |
| `src/views/pos/PosView.vue` | Kondisi tipe bisnis, tombol scan, integrasi hasil scan dengan tambah produk/varian. |
| `src/views/products/ProductFormView.vue` | Pisahkan SKU dan barcode, input lewat kamera, akses QR produk tersimpan. |
| `src/views/products/ProductsView.vue` | Aksi QR Produk yang ringkas pada produk grosir. |
| `src/components/scanner/ProductScannerSheet.vue` (baru) | Tampilan scanner, status izin, kegagalan, dan tutup. |
| `src/components/products/ProductQrModal.vue` (baru) | Pratinjau QR, kode, dan unduh label. |
| `src/services/scanner/productScannerService.js` (baru) | Abstraksi kamera/decoder, sesi, dan pembersihan resource. |
| `src/services/products/productCodeService.js` (baru) | Normalisasi kode, generate kode unik, pencocokan, dan pemeriksaan duplikat. |
| `src/services/products/productQrService.js` (baru) | Generate QR lokal dan ekspor label PNG. |
| `src/stores/productStore.js` | Field barcode, validasi, dan pencarian produk berdasarkan kode. |
| `src/services/database/` | Migrasi dan seluruh pemetaan/persistensi barcode. |
| `src/services/backupService.js` dan alur restore | Kompatibilitas kode dalam backup/restore. |
| `src/services/sync/contractMapper.js`, `syncPullService.js` | Pemetaan barcode terpisah dari SKU. |
| `android/app/src/main/AndroidManifest.xml` dan konfigurasi plugin | Izin kamera serta konfigurasi scanner yang dipilih. |
| `package.json`, lockfile | Dependency scanner/generator yang sudah lolos uji kompatibilitas; tanpa CDN runtime. |
| `src/__tests__/` dan `docs/qa/` | Tes perilaku dan catatan QA perangkat fisik. |

## 9. Urutan implementasi

1. **Validasi teknis kamera dan kontrak data.** Buktikan scan QR/barcode offline di Android Capacitor 8, tentukan dependency, cek ekspor PNG Android/web, dan konfirmasi kontrak barcode Cloud. Catat hasil sebelum integrasi UI lengkap.
2. **Fondasi kode produk.** Tambahkan barcode terpisah, migrasi, validasi duplikat, resolver, kompatibilitas backup, dan pemetaan sinkronisasi yang telah diverifikasi.
3. **Form produk dan generator QR.** Input/scan barcode, buat kode internal pada penyimpanan yang berhasil, aksi QR produk lama, pratinjau, dan unduh PNG.
4. **Scanner pada POS.** Tampilkan untuk grosir, hubungkan dengan resolver dan alur varian/keranjang yang sama, lalu tambahkan pesan hasil dan penanganan gagal.
5. **Lifecycle dan QA.** Uji izin, background, pergantian bisnis, callback ganda, restart aplikasi, restore, serta push/pull.
6. **Verifikasi akhir.** Jalankan build, lint pada file terkait, tes regresi yang relevan, dan dokumentasikan hasil pengujian Android fisik. Pisahkan kegagalan baseline dari regresi fitur baru.

## 10. Kriteria penerimaan

Item yang dicentang sudah memiliki cakupan tes otomatis. Checklist kamera/ekspor pada perangkat fisik dan backend live tetap terbuka sampai QA aktual dilakukan.

- [x] Tombol scan POS dan aksi QR produk muncul untuk tipe Grosir / Toko Kelontong, termasuk alias tipe yang dinormalisasi.
- [x] Tampilan dan alur Cafe / UMKM serta Laundry tetap mengikuti perilaku sebelumnya.
- [ ] Barcode kemasan dan QR hasil generate dapat memasukkan produk yang benar ke keranjang saat offline.
- [x] Satu sesi scan menambah tepat satu aksi; memindai ulang melalui sesi baru menambah kuantitas pada baris yang sesuai.
- [x] Produk bervarian tetap meminta pilihan varian dan pembatalan tidak menambah item.
- [x] Filter kategori/pencarian tidak membatasi pencocokan hasil scan.
- [x] Nol di depan kode dipertahankan; duplikat tidak menyebabkan produk yang salah ditambahkan.
- [x] Produk tidak aktif, bukan barang jual, stok habis, dan kode tidak dikenal mendapat pesan yang sesuai.
- [x] Produk baru tanpa barcode memperoleh kode internal stabil setelah berhasil disimpan; produk lama dapat dibuatkan kode melalui aksi yang jelas.
- [ ] QR dapat dilihat dan label PNG dapat disimpan serta dipindai ulang pada Android dan browser yang dinyatakan didukung.
- [ ] Kode tetap sama setelah edit nama/harga, restart, backup/restore, dan push/pull pada backend yang mendukung.
- [ ] Kamera berhenti setelah berhasil scan, batal, pindah halaman, masuk background, dan berganti bisnis.
- [x] Tidak ada penambahan item dari callback sesi lama setelah route/bisnis berubah.
- [ ] Kamera, decode, dan generate QR bekerja pada pemasangan baru tanpa internet.
- [x] Stok tidak berkurang saat scan; validasi dan pengurangan stok tetap terjadi pada alur transaksi yang berlaku.

## 11. Pengujian yang wajib disiapkan

**Unit/integrasi:** kecocokan persis barcode/SKU, nol di depan, benturan kode lintas field, produk tidak layak dijual, hasil satu kali per sesi, produk berulang, varian, kondisi tipe bisnis, migrasi SQLite dari versi sebelumnya, restart/persistensi, backup lama dan baru, restore, serta pemetaan push/pull barcode.

**QA perangkat:** QR cetak dan QR dari layar perangkat lain; barcode kemasan dengan beberapa format; izin pertama, izin ditolak, kamera tidak tersedia, cahaya rendah, pembatalan, tombol back Android, rotasi, background/foreground, pergantian bisnis, ekspor PNG, dan pemasangan baru dalam mode pesawat.

**Bukti selesai:** daftar perangkat/versi Android dan browser yang diuji, format kode yang lulus, hasil build/lint/tes, serta screenshot alur POS scan dan QR produk. Jika uji perangkat fisik belum dilakukan, status kamera belum boleh dinyatakan selesai.
