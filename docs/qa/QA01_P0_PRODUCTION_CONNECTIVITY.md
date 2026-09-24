# QA-01 / P0 — Production Connectivity Audit

- **Date:** 2026-09-24
- **Branch:** `qa/qa01-p0-production-connectivity`
- **Base Commit Tested:** `e3c1bb46cf443719f2534bbd41ece32048ae9822` (Merge pull request #41)
- **Target Backend Production:** `https://pos.eradig.my.id`
- **Environment:** Node `v22.18.0`, Vitest `4.1.11`, Vite `8.2.2`, Windows
- **Audit Mode:** READ-ONLY (No data mutation, no test transactions, no device registration on production)

---

## 1. Konfigurasi Environment & Audit URL Target

### A. Perbedaan Konfigurasi URL Secara Kode vs Production Build Riil

| Dimensi | Penjelasan & Mekanisme | Status |
|---|---|---|
| **Konfigurasi Secara Kode** | Modul `src/services/cloud/apiClient.js` membaca `import.meta.env.VITE_API_BASE_URL` secara dinamis. Fungsi `resolveBaseUrl()` dan `buildApiUrl()` menjamin bahwa jika base URL memiliki trailing slash (`/`) atau akhiran redundant (`/api`), URL akan dibersihkan secara defensif sebelum digabungkan dengan path endpoint, sehingga **tidak akan pernah menghasilkan duplikasi slash ganda (`//`) atau `/api/api/`**. | PASS |
| **Production Build Riil** | Bundler Vite membekukan (inlines) variabel lingkungan `import.meta.env.*` ke dalam file JavaScript statis pada waktu build (`vite build`).<br>• Jika build dijalankan **tanpa** variabel lingkungan, bundle `dist/` akan menggunakan fallback string kosong `""`, yang pada web browser biasa menghasilkan relative path, namun pada **Capacitor native (Android/iOS) akan gagal** karena request akan mengarah ke `http://localhost/api/...`.<br>• Verifikasi build riil dilakukan dengan menyuplai `VITE_API_BASE_URL=https://pos.eradig.my.id npm run build`. String URL target terverifikasi ter-inline langsung di dalam artefak chunk `dist/assets/index-*.js`. | PASS (Terverifikasi) |

### B. Audit Keamanan Repository & `.gitignore`

- **Status `.gitignore`:** Diperbarui secara eksplisit untuk mengabaikan seluruh file environment lokal:
  ```gitignore
  *.local
  .env
  .env.*
  !.env.example
  ```
- **Verifikasi Git:** Pengujian `git check-ignore` membuktikan `.env`, `.env.local`, `.env.production` terabaikan secara andal, sementara template `.env.example` tetap ter-track di git.
- **Repository Safety:** Tidak ada credential, token, password, atau file `.env` lokal yang ter-stage atau ter-commit ke git repository.

---

## 2. Hasil Pemeriksaan HTTPS & Server Production

| Parameter | Hasil Pengujian | Status |
|---|---|---|
| Domain Resolution | Resolved ke IP `185.124.137.137`, `88.223.91.33` (IPv4) & `2a02:4780:...` (IPv6) | PASS |
| TLS Handshake | Valid SSL certificate (Hostinger CDN / hcdn) | PASS |
| HTTP → HTTPS Redirect | `http://pos.eradig.my.id/api/auth/me` mengembalikan `301 Moved Permanently` ke `https://...` | PASS |
| Content Security Policy | Header `Content-Security-Policy: upgrade-insecure-requests` aktif | PASS |
| Web Server & Runtime | Server: `hcdn`, Runtime: `PHP/8.4.19` | PASS |

---

## 3. Hasil Audit Endpoint Production (READ-ONLY)

Sesuai batasan scope P0, tidak ada request `POST` atau `DELETE` yang dikirim ke production dan tidak ada autentikasi akun nyata sebelum akun QA dialokasikan.

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

## 6. Dokumentasi Revisi & Regression Testing

### A. Pencegahan Double Submit pada Onboarding (`BusinessSetupView.vue`)
- **Masalah:** Komponen menggunakan `<form @submit.prevent="saveBusinessProfile">`, sementara tombol submit sebelumnya memiliki atribut `type="submit"` sekaligus `@click="saveBusinessProfile"`. Pada browser biasa, satu klik tombol memicu event `click` dan event `submit` form secara berurutan, menyebabkan `saveBusinessProfile()` (dan `router.push('/setup/pin')`) dieksekusi 2 kali.
- **Perbaikan:**
  1. Tombol onboarding diubah menjadi `type="button"` sehingga klik hanya memicu handler `@click` tanpa menduplikasi event submit form HTML.
  2. Fungsi `saveBusinessProfile()` diberikan state guard `isSubmitting = true` yang fail-closed jika dipanggil ulang.
  3. Penekanan tombol Enter pada keyboard mobile/desktop tetap diakomodasi oleh `@submit.prevent` pada elemen form.
- **Pengujian:** Ditambahkan regression test pada `src/__tests__/business-setup-ui.spec.js` yang memverifikasi bahwa pengiriman form berulang (kombinasi klik dan form submit) hanya memicu `router.push('/setup/pin')` tepat 1 kali (`toHaveBeenCalledTimes(1)`).

### B. Dokumentasi Kebutuhan dan Pengujian Serialisasi `taxRate` pada `backupService.js`
- **Konteks & Kebutuhan:** PR #41 (`feat/dynamic-pos-tax-settings`) memodifikasi store transaksi (`src/stores/transactionStore.js`) dengan menyimpan properti `taxRate: payload.taxRate ?? null`. Pada transaksi tanpa pajak, `taxRate` bernilai `null`. Namun fungsi serialisasi backup sebelumnya (`normalizeTransactionForBackup` di `backupService.js`) hanya menyertakan `taxRate` jika `isValidTaxRate(transaction.taxRate)` bernilai `true` (hanya angka positif), sehingga nilai `taxRate: null` dibuang dari file backup JSON. Akibatnya, saat restore dilakukan, transaksi kehilangan properti `taxRate`, menyebabkan snapshot verification `expect(snapshotCore(context)).toBe(before)` pada regression test backup core gagal.
- **Perbaikan:** `normalizeTransactionForBackup` diperbarui agar menyertakan `taxRate: null` jika nilainya didefinisikan sebagai `null`, dan `normalizeTransactionForRestore` memastikan properti `taxRate` dikembalikan secara simetris.
- **Pengujian:** Ditambahkan suite pengujian regresi khusus pada `src/__tests__/local-backup.spec.js`:
  1. `preserves null taxRate on non-taxed transaction after round-trip backup and restore`
  2. `preserves explicit numeric taxRate on taxed transaction after round-trip backup and restore`
  Hasil: 65/65 pengujian pada `local-backup.spec.js` passed.

---

## 7. Hasil Automated Test

| Suite | Perintah | Hasil | Status |
|---|---|---|---|
| Unit Test Suite | `npm run test:unit -- --run` | 44 test files passed, 1163 tests passed, 3 skipped, 0 failed | PASS |
| Client Build | `npm run build` | Sukses (`dist/` ter-generate tanpa error) | PASS |
| Git Formatting & Diff | `git diff --check` | Bersih tanpa whitespace/conflict errors | PASS |
| Browser Smoke Test | Manual visual run | Belum dijalankan (fase audit P0 read-only) | NOT TESTED |
| Android Device Test | Manual hardware run | Belum dijalankan (fase audit P0 read-only) | NOT TESTED |

---

## 8. Temuan & Tingkat Prioritas

| ID | Prioritas | Temuan | Dampak | Rekomendasi |
|---|---|---|---|---|
| **REC-01** | **P1 (High)** | Response HTTP 405 dari backend production mengembalikan exception stack trace detail JSON (`Illuminate\Routing\Exceptions\MethodNotAllowedHttpException` lengkap dengan file path server). | Indikasi variabel lingkungan `APP_DEBUG=true` aktif di server produksi `pos.eradig.my.id`, berisiko membocorkan struktur internal direktori server. | Nonaktifkan `APP_DEBUG=false` pada environment backend Laravel production. |
| **REC-02** | **P2 (Medium)** | File `.gitignore` sebelumnya hanya mengecualikan `*.local`. | Pengembang berpotensi membuat file `.env` tanpa akhiran `.local` yang ter-stage ke git. | **Terselesaikan:** Telah ditambahkan `.env` dan `.env.*` (dengan exception `!.env.example`) pada `.gitignore`. |
| **REC-03** | **P3 (Low)** | URL konfigurasi `VITE_API_BASE_URL` berpotensi menimbulkan `/api/api/` jika diakhiri dengan `/api`. | Routing client gagal menuju endpoint backend. | **Terselesaikan:** Telah ditambahkan sanitasi defensif `resolveBaseUrl()` di `apiClient.js` beserta regression tests. |

---

## 9. Blocker Sebelum QA-01 / P1 (Login & Device Registration)

1. **Akun QA Khusus:** Dibutuhkan akun testing khusus (email + password) di server produksi `https://pos.eradig.my.id` dengan peran kasir/outlet yang valid agar pengujian login dan device registration dapat dilakukan tanpa menyentuh akun operasional riil.
2. **Review `APP_DEBUG`:** Disarankan menonaktifkan `APP_DEBUG` di environment backend produksi sebelum pengujian transaksi dan token exchange intensif.
