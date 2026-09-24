# QA-01 / P0 — Production Connectivity Audit

- **Date:** 2026-09-24
- **Branch:** `qa/qa01-p0-production-connectivity`
- **Base Commit Tested:** `e3c1bb46cf443719f2534bbd41ece32048ae9822` (Merge pull request #41)
- **Target Backend Production:** `https://pos.eradig.my.id`
- **Environment:** Node `v22.18.0`, Vitest `4.1.11`, Vite `8.2.2`, Windows
- **Audit Mode:** READ-ONLY (No data mutation, no test transactions, no device registration on production)

---

## 1. Konfigurasi Environment & URL Audit

| Item | Pemeriksaan | Status | Catatan |
|---|---|---|---|
| Target Base URL | `VITE_API_BASE_URL=https://pos.eradig.my.id` | PASS | Sesuai spesifikasi produksi |
| URL Sanitization | Penanganan trailing slash (`/`) & `/api` suffix | PASS | `resolveBaseUrl()` & `buildApiUrl()` mencegah duplikasi slash atau `/api/api/` |
| Localhost Fallback | Tidak ada fallback diam-diam ke localhost | PASS | Base URL digunakan murni tanpa fallback; `syncPullService` memvalidasi production config |
| Repository Credential Check | `.env` / credentials tidak ter-commit ke git | PASS | Hanya `.env.example` yang ter-track di git |
| `.gitignore` Safety | Pengecualian file environment lokal | PASS (Warning) | `.gitignore` mengecualikan `*.local`; disarankan menambahkan eksplisit `.env` |

---

## 2. Hasil Pemeriksaan HTTPS & Server Production

| Parameter | Hasil Pengujian | Status |
|---|---|---|
| Domain Resolution | Resolved ke `185.124.137.137`, `88.223.91.33` (IPv4) & `2a02:4780:...` (IPv6) | PASS |
| TLS Handshake | Valid SSL certificate (Hostinger CDN / hcdn) | PASS |
| HTTP → HTTPS Redirect | `http://pos.eradig.my.id/api/auth/me` mengembalikan `301 Moved Permanently` ke `https://...` | PASS |
| Content Security Policy | Header `Content-Security-Policy: upgrade-insecure-requests` aktif | PASS |
| Web Server & Runtime | Server: `hcdn`, Runtime: `PHP/8.4.19` | PASS |

---

## 3. Hasil Audit Endpoint Production (READ-ONLY)

Sesuai aturan keamanan audit P0, tidak ada request `POST` atau `DELETE` yang dikirim ke production dan tidak ada autentikasi akun nyata sebelum akun QA dialokasikan.

| Endpoint | Method | Pengujian Dilakukan | Status HTTP | Respons Body / Header | Status |
|---|---|---|---|---|---|
| `/api/auth/login` | POST | OPTIONS (CORS preflight), GET | 204 No Content (OPTIONS)<br>405 Method Not Allowed (GET) | `Allow: POST`<br>`Access-Control-Allow-Origin: *` | PASS |
| `/api/auth/me` | GET | GET unauthenticated | 401 Unauthorized | `{"message":"Unauthenticated."}` | PASS |
| `/api/auth/logout` | DELETE | OPTIONS (CORS preflight), GET | 204 No Content (OPTIONS)<br>405 Method Not Allowed (GET) | `Allow: DELETE`<br>`Access-Control-Allow-Origin: *` | PASS |
| `/api/mobile/context` | GET | GET unauthenticated | 401 Unauthorized | `{"message":"Unauthenticated."}` | PASS |
| `/api/mobile/devices` | POST | OPTIONS (CORS preflight), GET | 204 No Content (OPTIONS)<br>405 Method Not Allowed (GET) | `Allow: POST`<br>`Access-Control-Allow-Origin: *` | PASS |
| `/api/sync/push` | POST | OPTIONS (CORS preflight), GET | 204 No Content (OPTIONS)<br>405 Method Not Allowed (GET) | `Allow: POST`<br>`Access-Control-Allow-Origin: *` | PASS |
| `/api/sync/pull` | GET | GET unauthenticated | 401 Unauthorized | `{"message":"Unauthenticated."}` | PASS |

*Seluruh 7 rute terverifikasi aktif pada router Laravel backend dan endpoint privat terlindungi autentikasi token Bearer.*

---

## 4. Hasil Pemeriksaan CORS

Preflight `OPTIONS` diuji dengan origin yang relevan untuk ekosistem POS Mobile:

| Origin yang Diuji | Konteks | Status HTTP | Header Respons | Status |
|---|---|---|---|---|
| `http://localhost:5173` | Vite Local Dev Server | 204 No Content | `Access-Control-Allow-Origin: *`<br>`Access-Control-Allow-Methods: ...`<br>`Access-Control-Allow-Headers: ...` | PASS |
| `http://localhost` | Capacitor Android Webview Origin | 204 No Content | `Access-Control-Allow-Origin: *`<br>`Access-Control-Allow-Methods: ...`<br>`Access-Control-Allow-Headers: ...` | PASS |
| `capacitor://localhost` | Capacitor iOS Webview Origin | 204 No Content | `Access-Control-Allow-Origin: *`<br>`Access-Control-Allow-Methods: ...`<br>`Access-Control-Allow-Headers: ...` | PASS |

---

## 5. Kesesuaian API Client (`src/services/cloud/apiClient.js`)

| Syarat Kontrak | Implementasi | Status |
|---|---|---|
| `Accept: application/json` | Selalu dikirim di setiap request HTTP | PASS |
| `Content-Type: application/json` | Dikirim otomatis saat body request tersedia | PASS |
| `Authorization: Bearer <token>` | Disertakan di header saat opsi `token` diberikan | PASS |
| Token Security | Token Bearer tidak pernah di-log atau dimunculkan pada error object | PASS |
| HTTP Status Error Handling | Error 401, 403, 422, 429, 500 ditangani dengan format `{ ok: false, status, error: { status, code, message, data } }` | PASS |
| Network Error Handling | Network error ditangkap via try/catch, mengembalikan `{ ok: false, status: 0, error: { status: 0, code: 'NETWORK_ERROR', message } }` tanpa crash | PASS |
| URL Path Guard | `buildApiUrl()` menormalisasi trailing slash dan mencegah `/api/api/` | PASS |
| Idempotent & Non-Mutating | API client tidak melakukan auto-retry, network polling, atau request otomatis yang memutasi data saat audit | PASS |

---

## 6. Hasil Automated Test

| Suite | Perintah | Hasil | Status |
|---|---|---|---|
| Unit Test Suite | `npm run test:unit -- --run` | 44 test files passed, 1161 tests passed, 3 skipped, 0 failed | PASS |
| Client Build | `npm run build` | Sukses (`dist/` ter-generate tanpa error) | PASS |
| Git Formatting & Diff | `git diff --check` | Bersih tanpa whitespace/conflict errors | PASS |
| Browser Smoke Test | Manual visual run | Belum dijalankan (fase audit P0 read-only) | NOT TESTED |
| Android Device Test | Manual hardware run | Belum dijalankan (fase audit P0 read-only) | NOT TESTED |

---

## 7. Temuan & Tingkat Prioritas

| ID | Prioritas | Temuan | Dampak | Rekomendasi |
|---|---|---|---|---|
| **REC-01** | **P1 (High)** | Response HTTP 405 dari backend production mengembalikan exception stack trace detail JSON (`Illuminate\Routing\Exceptions\MethodNotAllowedHttpException` lengkap dengan file path server). | Indikasi variabel lingkungan `APP_DEBUG=true` aktif di server produksi `pos.eradig.my.id`, berisiko membocorkan struktur internal direktori server. | Nonaktifkan `APP_DEBUG=false` pada environment backend Laravel production. |
| **REC-02** | **P2 (Medium)** | File `.gitignore` saat ini menggunakan aturan `*.local`, namun belum secara eksplisit mencantumkan `.env`. | Pengembang berpotensi membuat file `.env` (tanpa ekstensi `.local`) yang dapat terbaca sebagai file untracked oleh git. | Tambahkan `.env` secara eksplisit pada `.gitignore`. |
| **REC-03** | **P3 (Low)** | URL konfigurasi `VITE_API_BASE_URL` berpotensi menimbulkan `/api/api/` jika diakhiri dengan `/api`. | Routing client gagal menuju endpoint backend. | **Terselesaikan:** Telah ditambahkan sanitasi defensif `resolveBaseUrl()` di `apiClient.js` beserta regression tests. |

---

## 8. Blocker Sebelum QA-01 / P1 (Login & Device Registration)

1. **Akun QA Khusus:** Dibutuhkan akun testing khusus (email + password) di server produksi `https://pos.eradig.my.id` dengan peran kasir/outlet yang valid agar pengujian login dan device registration dapat dilakukan tanpa menyentuh akun operasional riil.
2. **Review `APP_DEBUG`:** Disarankan menonaktifkan `APP_DEBUG` di environment backend produksi sebelum pengujian transaksi dan token exchange intensif.
