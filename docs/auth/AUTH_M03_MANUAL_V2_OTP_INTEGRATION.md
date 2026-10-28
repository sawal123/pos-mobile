# AUTH-M03 — Manual Cloud Auth v2 dan Email OTP

## Status

AUTH-M03 mengintegrasikan UI autentikasi AUTH-M02 ke route Cloud nyata tanpa mengubah lifecycle Cloud Session, workspace, transaksi, atau antrean sync.

Route `/cloud` dan `/setup/cloud` memakai `CloudAuthCard`. Route `/dev/cloud-auth-preview` tetap UI-only dan tidak memanggil backend.

## Manual registration v2

`POST /api/v2/auth/register` mengirim:

```json
{
  "name": "Budi Santoso",
  "email": "budi@example.com",
  "password": "StrongPassword123!",
  "password_confirmation": "StrongPassword123!",
  "business_name": "Toko Berkah"
}
```

`business_name` wajib di UI dan API client mengirim `Idempotency-Key`. Key dibuat dari sumber random kriptografis bila tersedia. Key disimpan hanya di memory, dipakai kembali hanya untuk payload yang sama persis, dan tidak dipakai untuk payload berbeda. Password tidak disimpan ke storage, log, atau SQLite.

HTTP `202` dengan `state: pending_email` hanya membuka layar OTP. Tidak ada token, Cloud context, linking, entitlement, atau workspace mutation pada tahap ini. Respons generic/decoy tidak dianggap sebagai kepastian akun berhasil dibuat.

## OTP state machine

`CloudEmailOtpView` adalah komponen final terpisah dari modal preview. Komponen menyediakan input enam digit numerik, paste, `one-time-code` autofill hint, expiry countdown, resend cooldown, loading, error, kembali ke registrasi, dan kembali ke POS offline.

- Verify: `POST /api/v2/auth/otp/verify` dengan `registration_id` dan `code`.
- Resend: `POST /api/v2/auth/otp/resend` dengan `registration_id`.
- Waktu expiry/cooldown berasal dari server dan hanya ditampilkan menggunakan jam client.
- Verify sukses menghapus input OTP dari memory dan metadata pending, lalu kembali ke login manual dengan email terisi.
- Verify sukses tidak membuat token, tidak mengambil context, dan tidak mengubah workspace.

Metadata recovery minimum yang boleh disimpan adalah registration id, masked email, expiry, dan cooldown pada storage terisolasi browser. OTP dan password tidak disimpan.

## Error mapping

`OTP_INVALID`, `OTP_EXPIRED`, `OTP_MAX_ATTEMPTS`, `OTP_ALREADY_USED`, `OTP_REPLACED`, `OTP_RESEND_COOLDOWN`, `OTP_RATE_LIMITED`, `OTP_DELIVERY_FAILED`, `AUTH_PROVISIONING_PENDING`, `NETWORK_ERROR`, dan `IDEMPOTENCY_KEY_REUSED` dipetakan ke pesan Bahasa Indonesia yang aman. HTTP `429` mempertahankan `Retry-After`; raw exception tidak ditampilkan.

## Manual login v2

`POST /api/v2/auth/login` tetap memakai `tokenRepository` dan `cloudSessionStore` yang sudah ada. Token hanya disimpan setelah respons sukses memuat token dan user yang valid. Setelah itu flow `GET /api/mobile/context`, pemilihan business/outlet, konfirmasi linking, device, entitlement, workspace guard, dan recovery tetap memakai implementasi existing.

HTTP `202` dengan `TWO_FACTOR_REQUIRED` dikembalikan sebagai state `two_factor_required`. Token tidak disimpan, Cloud context tidak dipanggil, Cloud access tidak diaktifkan, dan tidak ada fallback ke login legacy. Penyelesaian interaktif dilimpahkan ke AUTH-M08.

## Offline-first guarantees

Pending OTP bukan authenticated session. 2FA pending bukan authenticated session. Cloud authenticated bukan Cloud entitled, dan Cloud entitled bukan workspace aligned. Failed login, timeout, atau OTP pending tidak menghapus local business, PIN, shift, produk, kategori, pelanggan, transaksi, stok, kas, riwayat, workspace registry, maupun pending sync queue. POS offline tetap dapat dipakai.

## Tests

Targeted AUTH-M03 coverage berada di `src/__tests__/auth-m03-manual-v2-otp.spec.js` dan mencakup endpoint v2, idempotency key, pending registration, no-token invariant, 2FA fail-closed, OTP six-digit input, dan business name wajib: 5 test PASS. Gabungan test AUTH-M03, AUTH-M02 UI-only, API client, dan onboarding yang dijalankan terakhir: 44 test PASS. Full Vitest terakhir: 1.845 PASS, 4 skipped, 14 failure existing (2 test registrasi lama masih mengharapkan endpoint v1/token langsung; 12 failure lain berada di area existing di luar AUTH-M03).

Known limitation: full interactive 2FA belum termasuk AUTH-M03. Google native sign-in tetap AUTH-M04, session consolidation tetap AUTH-M05, password reset tetap AUTH-M07, dan full 2FA completion tetap AUTH-M08.
