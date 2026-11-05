# Kontrak Barcode Produk POS Mobile

Tanggal: 5 November 2026.

## Representasi lokal

- `sku` dan `barcode` adalah field terpisah. Nilai barcode adalah string maksimal 255 karakter, ditrim di tepi tanpa menghilangkan nol di depan atau mengubah kapitalisasi.
- Barcode kosong disimpan sebagai `''`. Produk lama tidak dibuatkan kode saat hydration/restore.
- Produk grosir baru yang dapat dijual memperoleh `NXP-<UUID>` ketika disimpan tanpa barcode oleh pengelola yang diizinkan. Produk lama mendapatkan kode melalui aksi **Buat Kode & QR**.
- QR berisi barcode sebagai teks biasa. Gambar QR/label tidak menjadi bagian record produk atau backup.
- Tidak ada aksi clear barcode khusus pada UI versi pertama: mengosongkan input grosir saat edit menghasilkan kode internal baru ketika disimpan. UI menjelaskan bahwa label lama perlu diganti.

## Push

Mapper tetap menghasilkan SKU sinkronisasi sesuai kontrak sebelumnya. Barcode nonempty dikirim pada `changes.products[].barcode` tanpa menggunakan SKU sebagai penggantinya.

Jika bisnis terpilih pada konteks **verified** menyatakan `catalog_capabilities.product_barcode_v1 === true`, mapper juga mengirim `barcode_action: "set"`. Tanpa penanda itu, gunakan kontrak legacy dengan field barcode nonempty saja, yang sudah diterima `SyncPushRequest` dashboard saat diperiksa.

Barcode kosong/tidak tersedia tidak dikirim dan tidak diartikan sebagai clear. Nilai barcode non-string, terlalu panjang, atau mengandung karakter kontrol memblokir item outbox dengan `INVALID_PRODUCT_BARCODE`. Payload inflight lama tidak ditulis ulang.

**Dependensi backend:** penghilangan field pada mobile saja belum melindungi server lama. Pada backend legacy, missing/null barcode masih dapat dipetakan menjadi null. Perlindungan preserve terhadap payload legacy, action clear yang eksplisit, dan penanda kemampuan perlu dirilis melalui [plan dashboard](../../../pos_dashboard/docs/plans/PLAN_SCAN_QR_BARCODE_GROSIR_DASHBOARD.md). Mobile tidak mengklaim backend tersebut sudah diperbarui.

## Pull

- Barcode nonempty disimpan terpisah dari SKU.
- Field barcode yang tidak tersedia pada respons lama mempertahankan kode lokal.
- `barcode: null` yang secara eksplisit dikirim server dinormalisasi menjadi `''`.
- Barcode tidak valid menggagalkan snapshot sebelum mutasi/kemajuan cursor.
- Benturan kode dari data lama/import tidak diganti diam-diam; resolver menolak hasil scan ambigu.
- Perubahan melalui pull memakai jalur penerapan yang sudah ada sehingga tidak menghasilkan echo outbox.

## Izin dan persistensi

Mutasi kode produk Cloud hanya diizinkan pada konteks terverifikasi dengan mode push `full`. Kasir tetap dapat memindai kode untuk penjualan, tetapi mode `cashier_safe` tidak memperoleh hak membuat/mengubah barcode atau SKU. Mode lokal tidak memerlukan Premium.

Barcode mengikuti penyimpanan produk, jurnal/antrean yang sudah ada, migrasi SQLite 6 → 7, dan backup/restore. Aksi generate memakai `updateProduct` agar tracker dan persistence berjalan. Pratinjau QR menunggu flush dan mencocokkan kode pada adapter sebelum memperlihatkan gambar ketika adapter runtime tersedia.

## Batas validasi

Tes otomatis membuktikan pemetaan push/pull dan alur lokal. Tes tersebut belum membuktikan integrasi backend live atau kamera Android fisik. Daftar QA berada di [QA Scan/QR Grosir](../qa/QA_SCAN_QR_BARCODE_GROSIR.md).
