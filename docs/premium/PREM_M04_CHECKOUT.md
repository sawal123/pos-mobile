# PREM-M04 — Checkout, Status Pembayaran & Aktivasi Premium

Status: **selesai (checkout + payment lifecycle + aktivasi authoritative; tanpa backup/sync)**.
Mobile **tidak pernah** mengaktifkan Premium sendiri. Satu-satunya sumber aktivasi adalah
backend setelah pembayaran Midtrans terverifikasi. Tidak ada perubahan skema database,
sync engine, atau format backup.

## Kontrak backend (diaudit dari `pos_dashboard`)

Semua endpoint `auth:sanctum` + ability token `mobile` (`tokenCan('mobile')`).

| Method | Path | Request | Response | Error |
| --- | --- | --- | --- | --- |
| POST | `/api/mobile/subscription/checkout` (throttle `subscription-checkout`, 10/menit/aktor) | `business_id`(int), `plan`(=`cloud`), `billing_period`(`monthly`\|`yearly`), `idempotency_key`(nullable ≤120). **`amount`/`currency`/`price_minor` = `prohibited`** | 201 `data:{ payment_id, status, provider, snap_token, redirect_url }` | 403 `MOBILE_TOKEN_REQUIRED` / `BUSINESS_ACCESS_DENIED` / `SUBSCRIPTION_PURCHASE_FORBIDDEN`; 409 `CHECKOUT_UNAVAILABLE`; 422 |
| GET | `/api/mobile/subscription/payments/{payment}` | – | `data:{ id, plan, billing_period, currency, amount, status, paid_at, subscription:{plan,status,starts_at,expires_at}\|null }` | 403 `MOBILE_TOKEN_REQUIRED`; 404 `PAYMENT_NOT_FOUND` |
| GET | `/api/mobile/subscription/payments?business_id=` | – | `data:[ ...present() ]` (20 terbaru) | 403 |
| GET | `/api/mobile/subscription/plans?business_id=` | – | `data:{ business_id, plans:[…], checkout_available }` | 403 |

Status pembayaran internal: `pending`, `paid`, `failed`, `expired`, `cancelled`, `refunded`.
Terminal = `paid|failed|expired|cancelled|refunded`. `pending` dibuat dengan `expires_at = now()+30m`.
Aktivasi hanya melalui webhook `POST /webhooks/midtrans`; entitlement authoritative dibaca dari
`/api/mobile/context` (`subscription`).

## Alur checkout

1. `SubscriptionView` (PREM-M02) — CTA **Lanjutkan** aktif hanya bila `checkout_available`,
   opsi `purchasable`, dan harga valid. Bila eligible dan bisnis tertaut → route
   `premium-checkout`; bila belum Cloud login/linked → arahkan ke Cloud Login (M03).
2. `PremiumCheckoutView` — ringkasan **Premium Cloud / Bulanan|Tahunan / harga IDR dari server /
   bisnis Cloud tertaut**, copy "Pilih metode pembayaran pada halaman pembayaran." CTA
   **Lanjut ke Pembayaran** membuat checkout, lalu membuka `redirect_url` dan pindah ke
   `premium-payment-status`.
3. `PremiumPaymentStatusView` — status dari backend, polling terbatas, resume pembayaran
   bila masih `pending` + punya `redirect_url`, dan success state bila Premium aktif.

## Server-authoritative price

- Harga hanya dari `GET subscription/plans` (`price_minor` + `currency`), ditampilkan apa adanya.
- Client **tidak pernah** mengirim `amount`/`currency`/`price_minor` (backend menolaknya
  sebagai `prohibited`). `subscriptionCheckoutService` hanya mengirim
  `business_id`, `plan`, `billing_period`, `idempotency_key`.
- User tidak dapat memanipulasi harga dari mobile.

## Idempotency

- Key dibuat klien (`createIdempotencyKey()`, `crypto.randomUUID()` → ≤120 char) dan
  dipertahankan **stabil per attempt**; retry attempt yang sama memakai key yang sama.
- Attempt baru (setelah status terminal/cancelled atau reset) memakai key baru.
- CTA dinonaktifkan selama `creating`; store juga menolak double-tap secara sinkron.
- Backend juga mengembalikan payment pending yang sama untuk key yang sama.

## Midtrans handoff

- Backend memberi `redirect_url` (Midtrans Snap). Mobile hanya membuka URL itu melalui
  `checkoutLauncher.openCheckoutUrl()`.
- **Native (Android/Capacitor)** memakai `Browser.open()` dari `@capacitor/browser`
  (dependency nyata, diimpor statis). **Web** memakai `window.open(url,'_blank')`.
- `MIDTRANS_SERVER_KEY` tidak ada di mobile; tidak ada pemanggilan API Midtrans privileged.
- Metode pembayaran (QRIS/transfer/e-wallet/kartu) dikelola Midtrans; mobile hanya copy generik.

### Validasi URL (fail closed)

Sebelum dibuka, URL backend divalidasi:

| Kondisi | Hasil |
| --- | --- |
| Kosong / bukan string | `CHECKOUT_URL_MISSING` |
| Tidak bisa di-parse sebagai URL absolut | `CHECKOUT_URL_MALFORMED` |
| Protokol bukan http/https (mis. `javascript:`, `data:`) | `CHECKOUT_URL_PROTOCOL` |
| `http://` non-loopback, atau `http://` apa pun di production | `CHECKOUT_URL_INSECURE` |
| `https://` | diterima |
| `http://` loopback **hanya** di env development/test eksplisit | diterima (dev/test) |

Production hanya menerima HTTPS. Pengecualian loopback hanya aktif bila `DEV`/`VITEST`/
`MODE=development|test` — tidak pernah longgar di build production.

### Kegagalan handoff

Jika `Browser.open()` gagal atau URL invalid: store menampilkan error + retry, **tidak**
mengubah status/phase pembayaran, **tidak** membuat checkout baru, dan pending payment
tetap recoverable.

### Kembali dari pembayaran

Menutup browser / app resume **bukan** bukti pembayaran sukses. Saat view status kembali ke
foreground (`visibilitychange`) status di-refresh dari backend; hanya backend yang dapat
mengubah status.

## Status & polling

- Label backend: PENDING "Menunggu pembayaran", PAID "Pembayaran berhasil", FAILED
  "Pembayaran gagal", EXPIRED "Waktu pembayaran habis", CANCELLED "Pembayaran dibatalkan",
  REFUNDED "Pembayaran dikembalikan".
- Polling dibatasi (`interval` 5s, maksimum ~60 percobaan) dan berhenti saat: status terminal,
  view unmount, offline, atau app background (melalui `runtimeSignalService`). Tidak ada
  polling agresif / infinite. Tersedia tombol **Perbarui Status** manual.
- Kembali dari halaman pembayaran **tidak** dianggap sukses; status selalu diambil backend.

## Paid → refresh context (aktivasi authoritative)

```
payment paid
  → GET /api/mobile/context (bounded refreshContext, maks 5x)
  → subscription server
  → subscriptionStore (PREM-M01 fail-closed)
  → UI Premium aktif
```

Selama context belum menunjukkan cloud access: state "Aktivasi sedang diproses…". Premium
tidak pernah di-set lokal; `expires_at`/`starts_at` diambil dari server.

## App restart & offline

- Pending payment dipersist via adapter (`app_meta`, key `premium_pending_payment`):
  `paymentId`, `businessId`, `plan`, `billingPeriod`, `currency`, `amount`, `status`,
  `redirectUrl`, `idempotencyKey`, timestamp — **tanpa** token/snap token/provider payload.
- Bootstrap (`main.js`) me-restore pending secara non-blocking dan **tidak** menganggap paid
  serta **tidak** membuat checkout baru.
- Saat online: status di-refresh. Saat offline: status cached ditampilkan sebagai
  "Status belum diperiksa ulang"; POS lokal tetap berjalan.
- `SubscriptionView` menampilkan banner "Ada pembayaran Premium yang menunggu" → ke
  `premium-payment-status` (recovery §13).

## 401 / 403

- 401 dari checkout/payment memakai perilaku PREM-M03 (`cloudSessionStore.invalidateCloudSession()`):
  sesi Cloud dibersihkan + `sessionInvalid`, **data POS lokal tidak disentuh**, user diminta
  login kembali. Tidak ada retry loop.
- 403 `BUSINESS_ACCESS_DENIED` / `SUBSCRIPTION_PURCHASE_FORBIDDEN` → checkout fail closed
  dengan pesan sesuai. Membership linked dicabut → M03 relink flow (checkout diblokir).

## CHECKOUT_UNAVAILABLE / Midtrans unconfigured

- `409 CHECKOUT_UNAVAILABLE` (pricing/Midtrans belum siap) dan `checkout_available=false`
  → UI "Pembayaran Premium belum tersedia." Tidak ada fallback harga hard-coded, tidak ada
  bypass backend.

## Local data safety

Checkout/payment tidak pernah: menghapus produk/transaksi/pelanggan, mengubah stok/kas,
reset onboarding, mengganti business lokal, memicu cloud restore/full sync. Ada regression
test untuk kondisi checkout sukses maupun gagal.

## Keamanan

- Tidak ada `MIDTRANS_SERVER_KEY` di mobile; tidak ada harga authoritative hard-coded.
- Tidak ada aktivasi Premium client-side; `plan`/`period` dari server catalog; `amount` tidak
  dikirim/dipercaya; status pembayaran & entitlement dari backend.
- Token tidak di-log; payload sensitif pembayaran (`snap_token`, `provider_payload`) tidak
  di-log dan tidak dipersist; response malformed fail closed.
- `business_id` selalu dari linked authorized business.

## Arsitektur

```
subscriptionCheckoutService (kontrak API, fail-closed)
        ↓
premiumCheckoutStore (state machine, idempotency, polling, activation)
        ↓
PremiumCheckoutView / PremiumPaymentStatusView
```

Reuse: `tokenRepository`, `cloudSessionStore` (M03), `subscriptionPlanStore` (M02),
`subscriptionStore` + `entitlementService` (M01), `runtimeSignalService`, adapter persistence.
Tidak ada store entitlement/auth kedua.

## Batasan yang diketahui

- Handoff native memakai `@capacitor/browser`; pada build Android butuh `npx cap sync`
  agar plugin terdaftar (di luar lingkup PR kode ini).
- Tidak ada endpoint refresh token → 401 = login ulang (M03).
- Endpoint payment show/index tidak mengembalikan `redirect_url`; resume pembayaran
  mengandalkan `redirect_url` yang dipersist saat checkout.
- Polling bukan pengganti webhook; bila webhook terlambat, UI menampilkan "Aktivasi sedang
  diproses".

## Di luar lingkup (task berikutnya)

Cloud backup/restore, full sync/reconciliation, device redesign, auto-renewal, aktivasi
client-side, Platform Admin, arbitrary plan, promo/coupon, invoice/accounting.
