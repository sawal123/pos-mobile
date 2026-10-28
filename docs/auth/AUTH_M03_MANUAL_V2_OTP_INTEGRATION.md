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

`business_name` wajib di UI dan API client mengirim `Idempotency-Key`. Key dibuat dari sumber random kriptografis. Untuk retry yang sah, payload dicocokkan dengan HMAC-SHA-256 berbasis secret acak yang hanya hidup selama sesi aplikasi; cache hanya menyimpan digest dan key, bukan password atau payload. Cache memiliki TTL dan dibersihkan saat flow dibatalkan atau selesai. Password tidak disimpan ke storage, log, SQLite, atau module cache.

HTTP `202` dengan `state: pending_email` hanya membuka layar OTP. Tidak ada token, Cloud context, linking, entitlement, atau workspace mutation pada tahap ini. Respons generic/decoy tidak dianggap sebagai kepastian akun berhasil dibuat.

## OTP state machine

`CloudEmailOtpView` adalah komponen final terpisah dari modal preview. Komponen menyediakan input enam digit numerik, paste, `one-time-code` autofill hint, expiry countdown, resend cooldown, loading, error, kembali ke registrasi, dan kembali ke POS offline.

- Verify: `POST /api/v2/auth/otp/verify` dengan `registration_id` dan `code`.
- Resend: `POST /api/v2/auth/otp/resend` dengan `registration_id`.
- Waktu expiry/cooldown berasal dari server dan hanya ditampilkan menggunakan jam client.
- Restart setelah OTP expired tetap mempertahankan `registration_id`; layar menampilkan `OTP_EXPIRED` dan resend tetap mengikuti cooldown server.
- Verify sukses menghapus input OTP dari memory dan metadata pending, lalu kembali ke login manual dengan email terisi.
- Verify sukses tidak membuat token, tidak mengambil context, dan tidak mengubah workspace.

Metadata recovery minimum yang boleh disimpan adalah registration id, masked email, expiry, dan cooldown pada storage terisolasi browser. OTP dan password tidak disimpan.

## Error mapping

`OTP_INVALID`, `OTP_EXPIRED`, `OTP_MAX_ATTEMPTS`, `OTP_ALREADY_USED`, `OTP_REPLACED`, `OTP_RESEND_COOLDOWN`, `OTP_RATE_LIMITED`, `OTP_DELIVERY_FAILED`, `AUTH_PROVISIONING_PENDING`, `NETWORK_ERROR`, dan `IDEMPOTENCY_KEY_REUSED` dipetakan ke pesan Bahasa Indonesia yang aman. HTTP `429` mempertahankan `Retry-After`; raw exception tidak ditampilkan.

## Manual login v2

`POST /api/v2/auth/login` tetap memakai `tokenRepository` dan `cloudSessionStore` yang sudah ada. Token hanya disimpan setelah respons sukses memuat token dan user yang valid. Setelah itu flow `GET /api/mobile/context`, pemilihan business/outlet, konfirmasi linking, device, entitlement, workspace guard, dan recovery tetap memakai implementasi existing.

HTTP `202` dengan top-level `code: TWO_FACTOR_REQUIRED` dan metadata challenge yang valid dikembalikan sebagai state `two_factor_required`. Challenge malformed fail-closed. Token tidak disimpan, Cloud context tidak dipanggil, Cloud access tidak diaktifkan, dan tidak ada fallback ke login legacy. Penyelesaian interaktif dilimpahkan ke AUTH-M08.

## Offline-first guarantees

Pending OTP bukan authenticated session. 2FA pending bukan authenticated session. Cloud authenticated bukan Cloud entitled, dan Cloud entitled bukan workspace aligned. Failed login, timeout, atau OTP pending tidak menghapus local business, PIN, shift, produk, kategori, pelanggan, transaksi, stok, kas, riwayat, workspace registry, maupun pending sync queue. POS offline tetap dapat dipakai.

## Tests

Targeted AUTH-M03 coverage berada di `src/__tests__/auth-m03-manual-v2-otp.spec.js` dan mencakup endpoint v2, keyed idempotency digest, pending registration, no-token invariant, OTP verify, 2FA fail-closed, OTP six-digit input, dan business name wajib: 6 test PASS. Gabungan lima test file auth/API/UI yang dijalankan terakhir: 60 test PASS. Full Vitest PR branch terakhir: 1.848 PASS, 4 skipped, 12 failure. Pembanding `origin/main` pada dependency dan `VITE_API_BASE_URL` yang sama juga: 1.842 PASS, 4 skipped, 12 failure; tidak ada failure tambahan dari AUTH-M03. Dua test registrasi lama telah diperbarui ke kontrak v2.

Known limitation: full interactive 2FA belum termasuk AUTH-M03. Google native sign-in tetap AUTH-M04, session consolidation tetap AUTH-M05, password reset tetap AUTH-M07, dan full 2FA completion tetap AUTH-M08.
