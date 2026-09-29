# PREM-M01 — Pengaturan Free/Premium (UI)

Status: **selesai (UI only)**. Tidak ada sistem pembayaran, API Laravel baru, atau
perubahan skema database / sync engine pada task ini.

## Ruang lingkup

Redesign halaman Pengaturan agar membedakan pengguna Free dan Premium: kartu
langganan, menu terstruktur, pembatasan visual fitur cloud-only, dan navigasi ke
halaman langganan placeholder untuk PREM-M02.

## Sumber data entitlement

Entitlement **tidak** dibaca dari token login, keberadaan akun Cloud, localStorage,
atau flag apa pun yang bisa dimanipulasi. Sumbernya adalah objek `subscription`
milik business pada respons otoritatif `GET /api/mobile/context` (sudah dipetakan
oleh `mapBusinessEntry`).

- `src/services/subscription/entitlementService.js` — pemetaan murni dari
  `subscription` mentah menjadi status UI. Fail-closed: Premium hanya untuk paket
  non-`free` yang tidak kedaluwarsa dan tidak pending.
- `src/stores/subscriptionStore.js` — adapter UI yang membaca business yang
  **sedang terpilih** dari `cloudSessionStore` sehingga pergantian business tidak
  pernah menampilkan entitlement business sebelumnya.
- `cloudSessionStore` kini menyimpan `subscription` pada `selectedBusiness` dan
  ikut dipersist sebagai snapshot non-sensitif, sehingga status terakhir diketahui
  saat cold start sebelum refresh berikutnya. Ini murni data tampilan, bukan
  otorisasi.

Status yang dipisahkan: `loading`, `free`, `premium`, `expired`, `pending`,
`error`. `expired` / `pending` / `error` tidak pernah dirender sebagai Premium
aktif.

## Route

| Name           | Path            | Keterangan                                        |
| -------------- | --------------- | ------------------------------------------------- |
| `settings`     | `/settings`     | Halaman Pengaturan (redesign)                     |
| `subscription` | `/subscription` | Placeholder "Langganan Premium" (diisi pada PREM-M02) |

Keduanya memerlukan business setup + PIN kasir, mengikuti guard router yang ada.

## Pembatasan fitur

- Fitur lokal (Kelola Pelanggan, Kelola Pengeluaran, Backup Data, Restore Backup,
  serta kartu Pajak & Printer yang sudah ada) tetap dapat diakses pengguna Free.
- Fitur cloud-only (`Sinkronisasi`) menampilkan ikon gembok + label
  "Memerlukan Premium" untuk Free. Menekan item ini membuka modal penjelasan dengan
  CTA "Lihat Paket Premium".
- Pengguna Premium dapat membuka `Sinkronisasi` (diarahkan ke halaman Cloud yang
  sudah ada). Status sinkronisasi pada kartu hanya menampilkan "aktif" bila
  `cloudAccess` benar-benar aktif; jika tidak, ditampilkan "Belum terhubung".

## Handoff ke PREM-M02

`/subscription` saat ini hanya placeholder. Pemilihan paket, checkout, dan
integrasi pembayaran adalah lingkup PREM-M02 dan belum diimplementasikan di sini.

## Pengujian

`src/__tests__/premium-settings-ui.spec.js` mencakup: resolusi entitlement
(free/premium/expired/pending/error), badge & CTA Free, badge & detail Premium,
status tidak aktif tidak menjadi Premium, fitur cloud-only terkunci untuk Free,
backup lokal tetap dapat diakses, navigasi kartu langganan + modal fitur terkunci,
dan isolasi entitlement saat konteks business berubah.
