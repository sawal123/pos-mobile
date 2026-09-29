# PREM-M01 — Pengaturan Free/Premium (UI)

Status: **selesai (UI only)**. Tidak ada sistem pembayaran, API Laravel baru, atau
perubahan skema database / sync engine pada task ini.

## Ruang lingkup

Redesign halaman Pengaturan agar membedakan pengguna Free dan Premium: kartu
langganan, menu terstruktur, pembatasan visual fitur cloud-only, dan navigasi ke
halaman langganan placeholder untuk PREM-M02.

## Sumber data entitlement

Entitlement **tidak** dibaca dari token login, keberadaan akun Cloud, localStorage,
atau flag apa pun yang bisa dimanipulasi. Sumbernya hanya objek `subscription`
milik business pada respons otoritatif `GET /api/mobile/context`.

Field yang benar-benar dipakai (tidak ada data yang dikarang):

| Field         | Sumber                          | Catatan                                              |
| ------------- | ------------------------------- | ---------------------------------------------------- |
| `plan`        | `subscription.plan`             | `free`, `pro`, dst.                                  |
| `status`      | `subscription.status`           | `active`, `expired`, `pending`, dst.                 |
| tanggal akhir | `subscription.*_at` (bila ada)  | beberapa penamaan umum diterima; opsional            |
| `cloud_access`| business `cloud_access`         | status akses cloud, **bukan** status langganan       |

- `src/services/subscription/entitlementService.js` — pemetaan murni dari
  `subscription` mentah menjadi status UI.
- `src/stores/subscriptionStore.js` — adapter UI yang membaca business yang
  **sedang terpilih** dari `cloudSessionStore` sehingga pergantian business tidak
  pernah menampilkan entitlement business sebelumnya.
- `cloudSessionStore` menyimpan snapshot `subscription` pada `selectedBusiness`
  dan ikut dipersist sebagai snapshot non-sensitif. Snapshot ini hanya untuk
  "data terakhir yang diketahui", bukan otorisasi.

### Aturan fail-closed (ketat)

**Premium aktif** hanya bila **semua** terpenuhi:

1. `plan` termasuk paket berbayar yang dikenal (`pro`, `premium`, `business`,
   `enterprise`, `starter`, `growth`, `plus`, `team`, `cloud`);
2. `status` persis `active`;
3. tanggal kedaluwarsa — bila API memberikannya — valid dan belum lewat;
4. konteks cloud **terverifikasi** pada sesi ini (`capabilityState === 'verified'`).

Selain itu hasilnya bukan Premium:

| Kondisi                                                       | Status       |
| ------------------------------------------------------------- | ------------ |
| `plan` kosong / `free` / tidak ada langganan                  | `free`       |
| status/plan/ tanggal tidak dikenal, atau konteks belum terverifikasi | `unverified` |
| status/ tanggal sudah kedaluwarsa                             | `expired`    |
| pembayaran belum selesai (`pending`, `past_due`, ...)         | `pending`    |
| refresh konteks gagal tanpa data apa pun                      | `error`      |
| sedang memuat konteks                                         | `loading`    |

`unverified` = **data terakhir yang diketahui**: paket terakhir tetap ditampilkan
tetapi tanpa klaim Premium aktif, dan fitur cloud tetap terkunci. Bila refresh
konteks gagal, snapshot lama tidak pernah menjadi hak Premium baru.

## Route

| Name           | Path            | Keterangan                                        |
| -------------- | --------------- | ------------------------------------------------- |
| `settings`     | `/settings`     | Halaman Pengaturan (redesign)                     |
| `subscription` | `/subscription` | Placeholder "Langganan Premium" (diisi pada PREM-M02) |

Keduanya memerlukan business setup + PIN kasir, mengikuti guard router yang ada.

## Akses cloud vs sinkronisasi terakhir

Kartu Premium menampilkan dua sinyal yang **terpisah** dan tidak diturunkan dari
langganan:

- **Akses cloud** — dari `cloud_access` / sesi cloud (`Aktif` / `Tidak aktif`).
- **Status diperiksa** — waktu pemeriksaan status sync terakhir
  (`Belum ada riwayat` bila belum pernah). UI tidak pernah menampilkan
  "Sinkronisasi aktif" hanya karena pengguna berlangganan.

## Pembatasan fitur

- Fitur lokal (Kelola Pelanggan, Kelola Pengeluaran, Backup Data, Restore Backup,
  serta kartu Pajak & Printer yang sudah ada) tetap dapat diakses pengguna Free.
- Fitur cloud-only (`Sinkronisasi`) menampilkan ikon gembok + label
  "Memerlukan Premium" untuk semua status selain Premium aktif. Menekannya membuka
  modal penjelasan dengan CTA "Lihat Paket Premium".
- Pengguna Premium membuka `Sinkronisasi` melalui halaman Cloud yang sudah ada.

## Handoff ke PREM-M02

`/subscription` saat ini hanya placeholder. Pemilihan paket, checkout, dan
integrasi pembayaran adalah lingkup PREM-M02 dan belum diimplementasikan di sini.

## Pengujian

`src/__tests__/premium-settings-ui.spec.js` mencakup: status tidak dikenal, status
kosong, plan tidak dikenal, tanggal kedaluwarsa lewat/tidak valid, subscription
kedaluwarsa, kegagalan refresh, konteks belum terverifikasi, isolasi entitlement
antar business, akses cloud terpisah dari sinkronisasi, badge & CTA Free, detail
Premium, kontrak plan `cloud` aktif/kedaluwarsa/pending/belum terverifikasi,
penguncian fitur cloud-only, dan backup lokal tetap dapat diakses.
