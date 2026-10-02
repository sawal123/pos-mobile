# PREM-M05 - Langganan Saya & Masa Aktif

Status: selesai sebagai UI lifecycle langganan Cloud + manual renewal. Mobile tidak
membuat source-of-truth subscription/entitlement baru dan tidak menghitung masa aktif baru.

## Authoritative Sources

Subscription dan entitlement tetap berasal dari `GET /api/mobile/context` melalui
`cloudSessionStore` dan `subscriptionStore`.

Kontrak context aktual yang dipakai:

- `businesses[].id`, `name`, `cloud_access`
- `businesses[].subscription.plan`
- `businesses[].subscription.status`
- `businesses[].subscription.starts_at`
- `businesses[].subscription.expires_at`
- `contextCheckedAt` dari refresh context sukses di mobile store

Katalog harga tetap dari `GET /api/mobile/subscription/plans?business_id={linkedBusinessId}`.
Checkout baru tetap memakai PREM-M04 `POST /api/mobile/subscription/checkout`.

Payment contract aktual dari PREM-M04:

- `GET /api/mobile/subscription/payments?business_id={linkedBusinessId}` untuk 20 terbaru
- `GET /api/mobile/subscription/payments/{id}` untuk status payment detail
- field payment: `id`, `plan`, `billing_period`, `currency`, `amount`, `status`, `paid_at`,
  `subscription`

Tidak ada renewal endpoint, cancel endpoint, invoice endpoint, auto-renewal field,
payment method field, atau subscription id di mobile.

## Subscription States

`Langganan Saya` membaca `subscriptionStore`:

- Free: Cloud-linked tetapi tidak ada subscription berbayar aktif.
- Aktif: context verified berisi `plan=cloud`, `status=active`.
- Akan berakhir: badge presentational jika `expires_at` masih future dan <= 7 hari.
- Kedaluwarsa: context authoritative menunjukkan expired/tidak memiliki entitlement Cloud.
- Cached/unverified: data terakhir ditampilkan dengan penanda belum diperiksa ulang.
- Session invalid dan revoked membership mengikuti perilaku PREM-M03.

`starts_at` dan `expires_at` ditampilkan dari server timestamp mentah. Mobile tidak menyimpan
expiry hasil kalkulasi sebagai state authoritative.

## Payment States

Payment status sengaja dipisah dari subscription status:

- `pending`: panel Pembayaran Menunggu, CTA lanjut pembayaran memakai persisted redirect URL
  PREM-M04 bila masih ada.
- `paid` + context belum Premium: "Aktivasi Premium sedang diproses", CTA refresh.
- `failed`, `expired`, `cancelled`, `refunded`: tampil sebagai status payment terminal dan tidak
  dianggap sebagai subscription expired/revoked.

Malformed payment history fail closed. Item malformed tidak disintesis.

## Date Presentation

`src/services/subscription/subscriptionPresentation.js` adalah helper murni untuk:

- format tanggal Indonesia
- sisa masa aktif
- null `expires_at` sebagai "Tanpa batas waktu"
- invalid date sebagai "Tanggal tidak valid"
- exact/same-day expiry sebagai "Hari ini"
- expired date sebagai "Sudah berakhir"
- expiring-soon threshold constant `EXPIRING_SOON_THRESHOLD_DAYS = 7`

Helper ini hanya presentation. Entitlement tetap dari backend context.

## Manual Renewal

CTA `Perpanjang Langganan` membuka plan selection PREM-M02/PREM-M04 dengan renewal mode.
User boleh memperpanjang subscription aktif. Mobile membuat checkout baru memakai katalog harga
terbaru dari server dan tidak menghitung extension date. Backend menentukan masa aktif baru, lalu
mobile refresh context dan menampilkan `expires_at` server.

## Payment History

Section `Riwayat Pembayaran` mengambil list dari backend untuk linked business saat ini saja.
`business_id` selalu berasal dari `cloudSessionStore.selectedBusiness.id`, bukan route/query/input
user. History dibersihkan saat relink/business berubah agar data tenant lama tidak tampil.

## Refresh & Offline

`Perbarui Status` melakukan refresh bounded:

1. context authoritative via `cloudSessionStore.refreshContext()`
2. pending/current payment via `premiumCheckoutStore.refreshStatus()`
3. payment history via backend list endpoint

Duplicate concurrent refresh ditolak. Saat offline atau network gagal, cached display tetap dibuka
dengan penanda "Status belum diperiksa ulang"; offline tidak membuat checkout, tidak logout, tidak
unlink, dan tidak mengubah data POS lokal.

## 401 / 403

401 memakai perilaku M03: token dan Cloud session dibersihkan, `sessionInvalid` ditampilkan, data
POS lokal tidak disentuh. 403 pada history fail closed dengan pesan akses ditolak.

## Security & Local Data Safety

Proteksi yang dipertahankan:

- entitlement, subscription, payment status, expiry, dan harga checkout dari backend
- no client-side activation
- no client-side renewal arithmetic
- no token/payment-sensitive logging
- no arbitrary business id
- local products, stock, transactions, customers, cash, expenses, shifts, local identity, dan
  onboarding tidak disentuh

## Known Limitations

- Resume pembayaran hanya bisa membuka URL yang masih ada dari state pending PREM-M04; endpoint
  payment show/list tidak menyediakan `redirect_url`.
- Tidak ada auto-renewal, recurring billing, cancel, refund request, invoice, coupon, Cloud backup,
  Cloud restore, atau full Cloud sync dalam M05.
