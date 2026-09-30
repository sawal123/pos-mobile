# PREM-M02 — Halaman Manfaat & Pemilihan Paket Premium (UI)

Status: **selesai (UI + adapter selaras kontrak backend, tanpa pembayaran)**. Tidak ada
perubahan sync engine / offline journal / database / stock movement / backup format, tidak
ada integrasi payment gateway, dan entitlement PREM-M01 tidak diubah.

## Audit dependensi

| Item                                        | Hasil                                                          |
| ------------------------------------------- | -------------------------------------------------------------- |
| PREM-M01 (PR #47) di `main`                 | **Merged** (`c7c68aa`), entitlement fail-closed tersedia        |
| PREM-D01 / PREM-D02A (kontrak katalog backend) | **Authoritative** — `GET /api/mobile/subscription/plans`     |
| `SubscriptionView.vue`                      | Halaman Premium (bukan lagi placeholder)                        |
| `subscriptionStore` / `entitlementService`  | Dipakai apa adanya (tidak diubah)                               |
| `cloudSessionStore`                         | Sumber `subscription` + business aktif (`GET /api/mobile/context`) |
| Route `subscription` (`/subscription`)      | Dipertahankan, guard business + PIN kasir tidak berubah         |
| Harga resmi                                 | **Belum ada (BLOCKER)** → `plans: []`, `checkout_available: false` |

## Manfaat Premium (hanya yang didukung backend)

`src/services/subscription/premiumBenefits.js` — setiap manfaat membawa kapabilitas
backend yang benar-benar ada:

| Manfaat             | Status          | Didukung oleh                                        |
| ------------------- | --------------- | ---------------------------------------------------- |
| Sinkronisasi cloud  | Tersedia        | `/api/sync/push`, `/api/sync/pull`, registrasi device |
| Dashboard web       | Tersedia        | Dashboard bisnis/outlet/device/produk                 |
| Monitoring bisnis   | Tersedia        | Report/export + monitoring laundry di dashboard       |
| Backup cloud        | Belum tersedia  | **Belum diimplementasikan backend**                   |

Backup cloud/restore sengaja ditandai "Belum tersedia" (dan di-gate `deny` di backend
PREM-D02A) agar tidak menjanjikan kemampuan yang tidak ada; pengguna diarahkan ke Backup
Data lokal yang sudah berjalan. Daftar `benefits` yang dikirim backend per paket
ditampilkan apa adanya — backend tetap sumber kebenaran.

## Akses yang tidak dikunci Premium

Kasir (POS) offline, Backup Data, Restore Backup, serta data lokal tetap tersedia untuk
pengguna Free. Entitlement tetap **fail-closed** mengikuti PREM-M01:

- Premium aktif hanya dari `subscription` pada konteks cloud yang **terverifikasi**;
- konteks cached/`unverified` hanya menampilkan "Paket terakhir", bukan hak Premium;
- halaman ini tidak pernah menaikkan entitlement berdasarkan data lokal atau pilihan paket.

## Adapter katalog (terisolasi)

`src/services/subscription/planCatalogService.js` adalah satu-satunya modul yang tahu
kontrak katalog. Aturan penting:

- **Endpoint kontrak backend** `/api/mobile/subscription/plans` dipakai secara default dan
  bisa di-override lewat `VITE_SUBSCRIPTION_PLANS_PATH` (staging/test).
- **`business_id` wajib** dan selalu diambil dari business aktif pada konteks cloud
  (`cloudSessionStore.selectedBusiness`), tidak pernah di-hardcode dan tidak pernah tenant
  lain. Tanpa business aktif, adapter **tidak melakukan request** (`reason: no_business`).
- **Harga hanya dari `price_minor`.** Tidak ada angka mockup, tidak ada konversi, tidak ada
  harga produksi yang dibuat sendiri. `price_minor` yang tidak valid/absen → periode itu
  dibuang, paket tidak bisa dipilih, UI menampilkan "Harga belum tersedia".
- Untuk `IDR`, nilai `price_minor` ditampilkan persis seperti yang dikirim backend
  (`Rp <nilai>`); mata uang lain ditampilkan dengan kode ISO-nya tanpa konversi.
- `404/405/501` → `unavailable` (katalog belum ter-deploy), bukan error aplikasi.
- Read-only: tidak ada retry background, tidak ada polling, tidak menulis storage.

Store `src/stores/subscriptionPlanStore.js` memegang lifecycle
`idle → loading → ready | empty | unavailable | error`, retry, pilihan periode/paket,
dan gate CTA. Store tidak memberikan akses apa pun.

### State UI

| State         | Pemicu                                          | UI                                          |
| ------------- | ----------------------------------------------- | ------------------------------------------- |
| `loading`     | request katalog berjalan                        | skeleton                                    |
| `ready`       | ada paket berharga                              | toggle periode + kartu paket                |
| `empty`       | `plans: []` (kondisi sekarang: harga belum ada) | "Belum ada paket" + Muat Ulang              |
| `unavailable` | belum login / belum pilih bisnis / `404`        | "Paket belum tersedia" + hint + Muat Ulang  |
| `error`       | network / 5xx                                   | pesan error + Coba Lagi                     |

### Aturan pemilihan & CTA

- Satu paket `cloud` membawa **semua** billing period-nya, jadi Bulanan/Tahunan berasal
  dari `billing_periods` pada satu entri — backend tidak perlu mengirim dua paket dengan
  `code` yang sama.
- Toggle hanya tampil bila katalog benar-benar memuat kedua periode; kalau hanya satu,
  paket ditampilkan tanpa toggle.
- Periode yang tidak dikenali produk (`weekly`, …) diabaikan, tidak pernah dirender.
- Paket dengan `available: false` tidak ditawarkan; paket tanpa harga tidak dapat dipilih.
- Paket yang sedang aktif ditandai "Paket Anda saat ini" dan tidak bisa dibeli lagi
  (mencegah pembelian ganda tanpa konfirmasi).
- CTA "Lanjutkan" aktif **hanya** bila kelima syarat terpenuhi: paket valid, billing
  period valid, harga valid, `purchasable === true` (dari backend), dan
  `checkout_available === true`. Selama checkout belum tersedia, CTA nonaktif berlabel
  "Checkout belum tersedia"; aplikasi tidak pernah memproses pembayaran.

## Kontrak backend (authoritative, PREM-D01/PREM-D02A)

```http
GET /api/mobile/subscription/plans?business_id={activeBusinessId}
Authorization: Bearer <mobile token>
Accept: application/json
```

```json
{
  "data": {
    "business_id": 1,
    "plans": [
      {
        "code": "cloud",
        "name": "Cloud",
        "billing_periods": [
          { "period": "monthly", "currency": "IDR", "price_minor": "<integer resmi>" },
          { "period": "yearly", "currency": "IDR", "price_minor": "<integer resmi>" }
        ],
        "benefits": ["Sinkronisasi cloud", "Dashboard web"],
        "available": true,
        "purchasable": false
      }
    ],
    "checkout_available": false
  }
}
```

`<integer resmi>` = angka dari konfigurasi backend. **Pricing belum dikonfigurasi**, jadi
saat ini respons sebenarnya adalah `"plans": []`; dokumen ini dan aplikasi tidak memuat
harga apa pun, termasuk angka dari mockup.

Ketentuan kontrak:

1. `code` memakai kosakata yang sama dengan `subscription.plan` pada
   `GET /api/mobile/context` (`free`, `cloud`, …) agar "Paket Anda saat ini" ditentukan dari
   entitlement, bukan dari flag klien.
2. `billing_periods[].period` hanya `monthly`/`yearly`; `currency` mis. `IDR`;
   `price_minor` integer yang ditampilkan apa adanya.
3. `benefits` opsional, ditampilkan apa adanya.
4. `available: false` berarti paket tidak ditawarkan sekarang.
5. `purchasable` adalah gate backend untuk pembelian; hari ini selalu `false` karena
   checkout belum ada.
6. `checkout_available` adalah satu-satunya sumber izin CTA; hari ini selalu `false`.
7. `business_id` wajib ada di query dan harus bisnis yang boleh diakses token tersebut.
8. Error yang diharapkan: `404` (route belum ada), `401` (sesi tidak valid), `403`
   (business bukan milik user), `422` (`business_id` tidak ada) — semuanya tetap
   mempertahankan akses POS offline.

### Alias legacy

Adapter masih menerima bentuk lama **hanya sebagai fallback**, dan bentuk kanonik selalu
menang bila keduanya ada: `code|plan|key|slug|id`, `name|title|label`,
`benefits|features|feature_list`, `terms|term|notes|note`, `price_minor|price|amount|price_idr`,
`period|interval|billing_period`, serta entri flat dengan `period` + `price` (satu periode).
Envelope yang diterima: array langsung, `plans`, `catalog`, `items`, atau dibungkus `data`.

## Konfigurasi

| Variabel                        | Fungsi                                                              |
| ------------------------------- | ------------------------------------------------------------------- |
| `VITE_SUBSCRIPTION_PLANS_PATH`  | Override path katalog (default: `/api/mobile/subscription/plans`)   |

## Handoff

Sudah selesai di backend: kontrak katalog PREM-D01 + policy/entitlement PREM-D02A.

Masih menunggu (bukan lingkup PREM-M02):

- **Harga resmi monthly/yearly (BLOCKER)** — sampai ada, `plans: []` dan checkout mati.
- **PREM-D02B**: checkout Midtrans, webhook + signature, idempotency, aktivasi
  (`starts_at`/`expires_at` wajib), renewal manual, payment history. Aktivasi tidak boleh
  berasal dari callback client mobile.
- Integrasi checkout di aplikasi mobile (setelah kontrak pembayaran diverifikasi).

## Pengujian

`src/__tests__/premium-plan-selection.spec.js` (61 test) mencakup: endpoint default +
override, `business_id` selalu ikut di query (dan tidak ada request tanpa business aktif),
payload kanonik (satu paket `cloud` + `billing_periods` monthly/yearly), `price_minor` +
format IDR, monthly-only, yearly-only, toggle monthly+yearly, periode tidak didukung
diabaikan, harga hilang fail-closed, `plans: []`, `checkout_available: false`,
`purchasable: false`, gate ganda pada CTA, proteksi paket aktif, alias legacy tidak
mengalahkan kontrak kanonik, tidak ada angka mockup di adapter, seluruh state UI, kejujuran
daftar manfaat, jaminan akses lokal, dan fail-closed entitlement PREM-M01.

`src/__tests__/premium-settings-ui.spec.js` (36 test, PREM-M01) tetap hijau tanpa
perubahan.
