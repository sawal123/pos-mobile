# AUTH-M05 — Cloud Session Lifecycle, Secure Storage & Business Selection

Status implementasi: siap direview melalui PR. Perubahan ini melanjutkan kontrak
AUTH-M03 (manual login/OTP) dan AUTH-M04 (native Google Sign-In), tanpa mengubah
model offline SQLite, workspace lokal, atau sync queue.

## 1. Tujuan dan batasan

AUTH-M05 membuat lifecycle sesi Cloud eksplisit dan fail-closed:

- manual login dan Google login melewati finalisasi sesi yang sama;
- token bearer hanya dimiliki secure token repository;
- cache Cloud setelah restart hanya untuk tampilan sampai diverifikasi ulang;
- 401 menginvalidasi sesi Cloud, sedangkan 403 mempertahankan sesi tetapi
  menurunkan capability menjadi tidak terverifikasi;
- pemilihan business/outlet tetap berbasis membership dari server;
- logout, account switching, dan callback async lama tidak boleh merusak sesi
  akun baru;
- kegagalan Cloud tidak menghapus data POS lokal, workspace registry, backup,
  atau sync queue.

Di luar scope: perubahan API server, migrasi database, deployment, dan task
AUTH-M06/M07/M08. Verifikasi live terhadap server production/staging tetap harus
dilakukan oleh environment/integration owner.

## 2. Model state sesi

`cloudSessionStore.sessionState` adalah state turunan dari fakta otoritatif
store, bukan state UI yang berdiri sendiri:

| State | Makna | Cloud mutation |
| --- | --- | --- |
| `unauthenticated` | Tidak ada user Cloud aktif | Diblokir |
| `authenticating` | Restore/login sedang dimiliki operasi aktif | Diblokir |
| `pending_email` | Registrasi menunggu verifikasi email OTP | Diblokir |
| `pending_two_factor` | Login menunggu challenge 2FA | Diblokir |
| `authenticated_unlinked` | User valid, business belum dipilih | Diblokir |
| `linked_unverified` | Business terpilih, tetapi capability/cache/workspace belum terverifikasi | Diblokir sampai `ensureVerifiedContext()` berhasil |
| `linked_ready` | Sesi, business, capability, dan workspace siap | Diizinkan sesuai role/entitlement |
| `session_invalid` | Token ditolak atau tidak dapat dicabut dengan aman | Diblokir; minta login ulang |

`isOperationalCloudAccess` dan `capabilityState` tetap menjadi guard lama untuk
sync. `sessionState` tidak menggantikan guard tersebut; ia menyatukan cara UI
dan operasi sesi membaca lifecycle yang sama.

## 3. Manual dan Google finalization

`login()` dan `loginWithGoogle()` sekarang:

1. membuat operation ownership record;
2. memvalidasi token dan identitas user dari hasil login;
3. menangani `TWO_FACTOR_REQUIRED` sebagai `pending_two_factor` tanpa token;
4. menyimpan token ke secure repository;
5. mengambil `/api/mobile/context`;
6. memvalidasi struktur user/business/outlet dan menerapkan role, entitlement,
   device context, serta workspace context;
7. menulis snapshot Cloud melalui persistence adapter dengan `throwOnError`;
8. hanya menyelesaikan login bila semua langkah masih dimiliki operation aktif.

Jika finalisasi gagal, state Cloud dibersihkan dan token tidak ditinggalkan.
Data POS lokal tetap dipertahankan.

## 4. Secure token ownership

`tokenRepository` menggunakan serialisasi operasi untuk `saveToken`, `getToken`,
dan `removeToken`. `removeTokenIfMatches(expectedToken)` menghapus token hanya
jika token yang tersimpan masih sama dengan token pemanggil.

Untuk alur logout/rollback yang harus membedakan keadaan, repository juga
menyediakan hasil atomic `removed`, `missing`, atau `ownership_mismatch` dari
`removeTokenIfMatchesDetailed()`. Token yang sudah tidak ada bukan ownership
account baru; logout tetap boleh menyelesaikan pembersihan session lokal.

Invariant penting:

- callback login lama tidak boleh menghapus token akun baru;
- 401 hanya boleh menghapus token yang ditolak, bukan token hasil account switch;
- kegagalan penghapusan token menghasilkan `TOKEN_REMOVAL_FAILED` dan state
  `session_invalid`, bukan klaim logout sukses;
- bearer token tidak disimpan di SQLite/cloud context.

## 5. Operation guards dan race protection

Store memiliki operation id monotonik untuk `restore`, `manual_login`,
`google_login`, `context_refresh`, dan `logout`. Setiap boundary async penting
memeriksa ownership sebelum mutasi state atau persistence.

Logout menggunakan mode replace sehingga membatalkan operasi sesi sebelumnya.
Hasil operasi lama dikembalikan sebagai `STALE_SESSION_OPERATION`. Rollback
stale menggunakan compare-and-remove token. Jika logout sedang aktif, rollback
stale ditunda dan logout menjadi pemilik finalisasi token/session, sehingga tidak
melakukan rollback terhadap akun yang sudah lebih baru.

## 6. Restart dan hydration

Saat bootstrap:

- device identifier dan workspace registry dipulihkan dari storage lokal;
- token dibaca dari secure repository;
- snapshot Cloud yang valid boleh dipulihkan untuk display;
- snapshot tersebut selalu berstatus `unverified`/`legacy` sampai context online
  diverifikasi;
- hydration tidak menjalankan sync atau network refresh secara diam-diam;
- `ensureVerifiedContext()` dipanggil sebelum operasi sync yang memerlukan
  capability Cloud.

Jika secure token hilang, snapshot Cloud di-quarantine/di-clear, tetapi
business lokal, device identifier, workspace registry, data SQLite, dan queue
tetap ada. Cache Cloud tidak pernah dianggap sebagai bukti authorization.

## 7. HTTP 401 vs 403

| Response | Tindakan |
| --- | --- |
| 401 / token invalid atau expired | Hapus token secara ownership-aware, clear Cloud context, tandai `session_invalid`, minta login ulang |
| 403 / entitlement, role, subscription, atau business access | Pertahankan user dan token, turunkan capability ke `unverified`/`revoked`, blokir Cloud mutation sampai context valid |
| network/5xx | Pertahankan session/cache untuk recovery, tetapi jangan mempertahankan capability `verified` |

Tidak ada kategori di atas yang menghapus POS lokal atau sync queue.

## 8. Business, outlet, entitlement, dan device

Business dan outlet hanya dapat dipilih dari context server yang berhasil
divalidasi. Payload malformed ditolak dengan `MALFORMED_CONTEXT`; tidak ada
grant berbasis arbitrary ID.

Pemilihan business menerapkan server entitlement dan role. Perbedaan dengan
workspace lokal membuat `pendingSwitch` yang memerlukan konfirmasi eksplisit;
tidak mengubah data lokal secara diam-diam. Outlet harus ada di business yang
dipilih dan berstatus `active`.

Device identifier tetap device-local dan stabil. Device authorization,
registered device, dan cashier capability tetap berasal dari context server;
cashier tidak membuat device baru dari client.

## 9. Workspace alignment

Aktivasi operational context tetap memakai atomic workspace switching yang sudah
ada: workspace lama disimpan, workspace target dimaterialisasi, tenant data dan
sync metadata tetap terisolasi, lalu context Cloud dipersist. Kegagalan
materialisasi/persistence memicu rollback dan tidak menghapus workspace lama.

## 10. Logout dan account switching

Logout melakukan best-effort server notification, compare-and-remove secure
token, clear Cloud context, dan mengembalikan mode business lokal ke `free`.
Workspace lokal, device identifier, backup, SQLite, serta queue tidak disentuh.

Account switch dimulai sebagai operasi baru. Login lama yang selesai belakangan
tidak boleh menimpa user/token/business/workspace milik akun baru.

## 11. Offline safety dan sync

Hydration dapat menyelesaikan startup tanpa network. `syncPullStore.pullNow()`
memverifikasi capability Cloud sebelum pull (kecuali pemanggil test/controlled
flow secara eksplisit memilih `refreshContext: false`). Pull/push yang gagal
karena auth atau network tidak menghapus data lokal atau queue; queue tetap
menunggu rekonsiliasi berikutnya.

## 12. Bukti pengujian

Test M05 berada di `src/__tests__/auth-m05-cloud-session-lifecycle.spec.js`
dan mencakup:

- malformed manual login dan malformed Cloud context fail-closed;
- pending email OTP dan pending 2FA;
- persistence failure setelah authentication;
- missing token saat restart;
- restored cache sebagai `linked_unverified`;
- HTTP 403 tanpa logout;
- stale login tidak menghapus token akun baru.

Suite regresi terkait AUTH-M03/M04, login/context, workspace, dan sync wajib
dijalankan bersama targeted M05. Full Vitest, build, lint, dan status baseline
dicatat pada PR execution result.

## 13. Handoff

AUTH-M05 menyerahkan ke AUTH-M06 untuk verifikasi lifecycle pada environment
native/live dan skenario operasional lanjutan. M05 tidak melakukan merge
otomatis, deployment, atau perubahan scope M06/M07/M08.
