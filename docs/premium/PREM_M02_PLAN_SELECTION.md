# PREM-M02 — Halaman Manfaat & Pemilihan Paket Premium (UI)

Status: **selesai (UI + adapter, tanpa pembayaran)**. Tidak ada endpoint Laravel baru,
tidak ada perubahan sync engine / offline journal / database / stock movement /
backup format, dan tidak ada integrasi payment gateway.

## Audit dependensi

| Item                                | Hasil                                                      |
| ----------------------------------- | ---------------------------------------------------------- |
| PREM-M01 (PR #47) di `main`         | **Merged** (`c7c68aa`), entitlement fail-closed tersedia     |
| `SubscriptionView.vue`              | Placeholder PREM-M01 → diganti halaman Premium               |
| `subscriptionStore` / `entitlementService` | Dipakai apa adanya (tidak diubah)                      |
| `cloudSessionStore`                 | Sumber `subscription` otoritatif (`GET /api/mobile/context`) |
| Route `subscription` (`/subscription`) | Dipertahankan, guard business + PIN kasir tidak berubah   |
| Endpoint Laravel yang ada           | `/api/auth/*`, `/api/mobile/context`, `/api/mobile/devices`, `/api/sync/*` |
| Katalog paket / checkout            | **Tidak ada di backend** (DASH-12B billing masih *undecided*) |

Konsekuensinya halaman ini tidak menampilkan satu pun harga tetap: katalog dibaca dari
respons API, dan bila API belum menyediakannya aplikasi menampilkan empty/unavailable
state yang jelas.

## Manfaat Premium (hanya yang didukung backend)

`src/services/subscription/premiumBenefits.js` — setiap manfaat membawa kapabilitas
backend yang benar-benar ada:

| Manfaat             | Status          | Didukung oleh                                        |
| ------------------- | --------------- | ---------------------------------------------------- |
| Sinkronisasi cloud  | Tersedia        | `/api/sync/push`, `/api/sync/pull`, registrasi device |
| Dashboard web       | Tersedia        | Dashboard bisnis/outlet/device/produk                 |
| Monitoring bisnis   | Tersedia        | Report/export + monitoring laundry di dashboard       |
| Backup cloud        | Belum tersedia  | **Belum diimplementasikan backend**                   |

Backup cloud sengaja ditandai "Belum tersedia" agar tidak menjanjikan kemampuan yang
tidak ada; pengguna diarahkan ke Backup Data lokal yang sudah berjalan.

## Akses yang tidak dikunci Premium

Kasir (POS) offline, Backup Data, Restore Backup, serta data lokal tetap tersedia untuk
pengguna Free. Entitlement tetap **fail-closed** mengikuti PREM-M01:

- Premium aktif hanya dari `subscription` pada konteks cloud yang **terverifikasi**;
- konteks cached/`unverified` hanya menampilkan "Paket terakhir", bukan hak Premium;
- halaman ini tidak pernah menaikkan entitlement berdasarkan data lokal atau pilihan paket.

## Adapter katalog (terisolasi)

`src/services/subscription/planCatalogService.js` adalah satu-satunya modul yang tahu
kontrak katalog. Aturan penting:

- Path endpoint **tidak diasumsikan**. Path dibaca dari `VITE_SUBSCRIPTION_PLANS_PATH`;
  bila kosong, adapter mengembalikan `unavailable` **tanpa melakukan request apa pun**.
- Harga hanya dari API. Harga yang tidak bisa diparse (mis. `"Rp 49.000"`) → `price: null`,
  `purchasable: false`, dan UI menampilkan "Harga belum tersedia".
- `404/405/501` → `unavailable` (route belum ada), bukan error aplikasi.
- Read-only: tidak ada retry background, tidak ada polling, tidak menulis storage.

Store `src/stores/subscriptionPlanStore.js` memegang lifecycle
`idle → loading → ready | empty | unavailable | error`, retry, pilihan periode/paket,
dan gate CTA. Store tidak memberikan akses apa pun.

### State UI

| State         | Pemicu                                             | UI                                        |
| ------------- | -------------------------------------------------- | ----------------------------------------- |
| `loading`     | request katalog berjalan                           | skeleton                                  |
| `ready`       | ada paket valid                                    | toggle periode + kartu paket              |
| `empty`       | `plans: []`                                        | "Belum ada paket" + Muat Ulang            |
| `unavailable` | path belum dikonfigurasi / belum login / `404`     | "Paket belum tersedia" + hint + Muat Ulang |
| `error`       | network / 5xx                                      | pesan error + Coba Lagi                    |

### Aturan pemilihan & CTA

- Toggle Bulanan/Tahunan hanya tampil bila katalog memuat **kedua** periode.
- Paket tanpa harga terkonfirmasi tidak dapat dipilih.
- Paket yang sedang aktif ditandai "Paket Anda saat ini" dan tidak bisa dibeli lagi
  (mencegah pembelian ganda tanpa konfirmasi).
- CTA "Lanjutkan" aktif hanya bila kontrak mengiklankan `checkout_available: true`
  **dan** ada paket valid yang dipilih. Selama checkout belum tersedia, CTA nonaktif
  dan berlabel "Checkout belum tersedia"; aplikasi tidak pernah memproses pembayaran.

## Kontrak yang dibutuhkan — handoff ke PREM-D01

Agar UI katalog/checkout berfungsi, backend perlu menyediakan:

```http
GET /api/mobile/subscription/plans
Authorization: Bearer <mobile token>
Accept: application/json
```

```json
{
  "data": {
    "checkout_available": true,
    "plans": [
      {
        "code": "cloud",
        "name": "Cloud",
        "price": 49000,
        "currency": "IDR",
        "period": "monthly",
        "features": ["Sinkronisasi cloud", "Dashboard web"],
        "terms": "Perpanjangan otomatis belum tersedia."
      },
      {
        "code": "cloud",
        "name": "Cloud",
        "price": 490000,
        "currency": "IDR",
        "period": "yearly",
        "features": ["Sinkronisasi cloud", "Dashboard web"]
      }
    ]
  }
}
```

Ketentuan kontrak:

1. `code` harus memakai kosakata yang sama dengan `subscription.plan` pada
   `GET /api/mobile/context` (`free`, `cloud`, …) agar "Paket Anda saat ini" dapat
   ditentukan dari entitlement, bukan dari flag klien.
2. `price` adalah bilangan Rupiah utuh. Mobile **tidak** mengonversi atau menghitung harga
   dan tidak menebak bila field tidak ada.
3. `period` menentukan toggle Bulanan/Tahunan; hanya tampil bila kedua periode ada.
4. `checkout_available` (atau `checkout.available`) adalah satu-satunya sumber izin CTA.
   Selama `false`, aplikasi hanya menampilkan status "belum tersedia".
5. `features` / `terms` bersifat opsional dan ditampilkan apa adanya.
6. Error yang diharapkan: `404` (route belum ada), `401` (sesi tidak valid),
   `403` (bisnis tidak punya akses cloud) — semuanya harus tetap mempertahankan akses POS offline.

Alias yang sudah dinormalisasi adapter: `code|plan|key|slug|id`, `name|title|label`,
`price|amount|price_idr|amount_idr`, `period|interval|billing_period`,
`features|benefits|feature_list`, `terms|term|notes|note`, dan periode
`monthly|month|bulanan`, `yearly|annual|annually|year|tahunan`. Envelope yang diterima:
array langsung, `plans`, `catalog`, `items`, atau dibungkus `data`.

Belum termasuk handoff ini (butuh kontrak terpisah sebelum diintegrasikan): endpoint
checkout/pembayaran (mis. Midtrans) dan endpoint upgrade/renewal.

## Konfigurasi

| Variabel                        | Fungsi                                            |
| ------------------------------- | ------------------------------------------------- |
| `VITE_SUBSCRIPTION_PLANS_PATH`  | Path katalog paket; kosong = katalog dinonaktifkan |

## Pengujian

`src/__tests__/premium-plan-selection.spec.js` (55 test) mencakup: normalisasi periode/harga/
fitur, tidak ada harga karangan, tidak ada request saat path kosong, `404` → unavailable,
`empty`, error + retry, loading, pemilihan paket/periode, gate CTA (tanpa checkout, tanpa
harga, paket aktif), seluruh state UI, kejujuran daftar manfaat, jaminan akses lokal, dan
fail-closed entitlement PREM-M01.

`src/__tests__/premium-settings-ui.spec.js` diperbarui: blok test placeholder PREM-M02 lama
diganti dengan verifikasi halaman baru.
