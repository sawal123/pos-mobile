# PREM-M03 — Cloud Login & Tautkan Bisnis

Status: **selesai (Cloud Login + business linking, tanpa checkout/sync)**. Tidak ada
perubahan skema database, sync engine, atau format backup. Tidak ada integrasi
pembayaran. POS offline-first tetap berjalan tanpa Cloud Login.

Cloud Login adalah **fitur opsional** untuk menghubungkan instalasi POS lokal dengan
akun/business pada backend POS Dashboard. Login **bukan** syarat membuka aplikasi,
**bukan** pemicu Premium, dan **tidak** pernah menghapus/mengubah database lokal.

## Dasar yang sudah ada (dipakai ulang)

PREM-M03 dibangun di atas fondasi cloud P10 dan entitlement PREM-M01/M02 — tidak ada
implementasi auth/entitlement kedua:

| Komponen | Peran |
| --- | --- |
| `src/services/cloud/apiClient.js` | Fetch wrapper tunggal (Bearer, `VITE_API_BASE_URL`, tanpa retry/polling) |
| `src/services/cloud/authService.js` | `cloudLogin`, `fetchMe`, `fetchMobileContext`, `registerDevice`, `cloudLogout` |
| `src/services/cloud/tokenRepository.js` | Token hanya di secure storage (Keystore/Keychain; in-memory di web) |
| `src/services/cloud/deviceIdentifier.js` | `device_identifier` stabil per instalasi |
| `src/stores/cloudSessionStore.js` | Sesi cloud non-sensitif + linking (M03 menambah `linkedAt`, `isLinked`, `sessionInvalid`, `contextCheckedAt`) |
| `src/services/subscription/entitlementService.js` | Fail-closed entitlement dari `subscription` server |
| `src/stores/subscriptionStore.js` | Adapter entitlement UI (tidak diubah) |
| `src/views/settings/CloudLoginView.vue` | Halaman Cloud Login (route `cloud`) |
| `src/views/settings/SettingsView.vue` | Kartu Langganan PREM-M01 + blok "Akun Cloud" |

## Kontrak backend yang digunakan

Semua lewat `apiRequest` (`Accept: application/json`, `Content-Type: application/json`
bila ada body, `Authorization: Bearer <token>`). **Tidak ada** endpoint refresh token,
revoke-all, register, atau forgot-password di backend.

```http
POST   /api/auth/login      body { email, password }        → data.data = { token, user }
GET    /api/auth/me         Authorization: Bearer <token>
DELETE /api/auth/logout     Authorization: Bearer <token>
GET    /api/mobile/context?device_identifier=<uuid>         → data.data.businesses[]
POST   /api/mobile/devices  body { business_id, outlet_id, device_identifier, name, platform }
GET    /api/mobile/subscription/plans?business_id=<id>      (PREM-D01, dipakai PREM-M02)
```

Bentuk bisnis dari `/api/mobile/context` yang dibaca:

```
businesses: [{
  id, name, role|role_name, sync_capabilities, cloud_access,
  subscription: { plan, status, starts_at?, expires_at?, ... },
  outlets: [{ id, name, status }],
  device_context: null | { id, identifier, outlet_id, status }
}]
```

Error `apiClient`: non-2xx → `{ status, code: body.code ?? body.error ?? 'HTTP_<status>', message }`;
fetch gagal → `{ status: 0, code: 'NETWORK_ERROR' }`. **Tidak ada retry otomatis.**

## Alur login

`CloudLoginView` (route `cloud`, **tidak** di-guard business/PIN/shift sehingga POS
offline tetap bisa masuk menu lain):

```
login → (0 bisnis) done/zero-business
      → (1 bisnis) confirm-link → select-outlet → done
      → (>1 bisnis) select-business → confirm-link → select-outlet → done
```

- Form: Email + Password (masked, ada tombol **Tampilkan/Sembunyikan password**), plus
  penjelasan singkat bahwa Cloud Login hanya untuk menghubungkan POS dengan akun Cloud
  dan Dashboard — POS tetap dapat dipakai tanpa Cloud.
- State login: `idle`, `loading`, `success`, invalid credentials, offline, server error.
  Pesan dipetakan oleh `src/services/cloud/cloudLoginErrors.js` (murni, tanpa IO):
  - `NETWORK_ERROR`/status 0 → "Koneksi internet diperlukan untuk masuk ke Cloud."
  - 401/`INVALID_CREDENTIALS` → "Email atau password salah."
  - 403 `EMAIL_NOT_VERIFIED` / `TWO_FACTOR_REQUIRED` → arahan verifikasi/2FA via Dashboard.
  - 5xx / `MISSING_TOKEN` → "Server Cloud sedang bermasalah. Coba lagi nanti."
- Password tidak pernah di-log dan tidak pernah dipersist.

## Pemilihan & penautan bisnis

- **0 bisnis:** kartu state jelas ("Akun Anda belum memiliki Business…"). Tidak ada
  pembuatan business server otomatis.
- **1 bisnis:** langung menampilkan **kartu konfirmasi** (`#cloud-confirm-link`).
- **>1 bisnis:** picker "Pilih Bisnis Cloud" lalu kartu konfirmasi.
- Kartu konfirmasi menampilkan **Bisnis lokal** (`businessStore.name`), **Akun Cloud**
  (`user.email`), **Bisnis Cloud**, dan CTA **"Hubungkan Bisnis"**. Tidak ada auto-match
  hanya karena nama sama — link selalu merupakan aksi eksplisit user.
- `selectBusiness(id)` hanya menerima id yang ada pada daftar membership (`businesses`),
  sehingga **arbitrary business_id tidak dapat ditautkan**.

### Semantik linking

- **Linked** = `isAuthenticated && selectedBusiness !== null` (`cloudSessionStore.isLinked`).
- Menautkan mencatat `linkedAt` (ISO) dan ikut dipersist.
- **Local identity tetap milik lokal.** `id` bisnis lokal (tabel `business`, singleton
  `id=1`) tidak pernah diganti. `linkedBusiness.id` dari Cloud adalah **asosiasi/link**,
  bukan primary key lokal.
- Tidak ada reconciliation data pada M03 — hanya association.

## State local link (persistensi)

`cloud_context` (tabel `app_meta` via adapter) menyimpan data non-sensitif:

| Field | Keterangan |
| --- | --- |
| `user {id,name,email}` | identitas akun Cloud |
| `selectedBusiness {id,name,subscription}` | business tertaut + snapshot subscription (display) |
| `selectedOutlet {id,name}` | outlet terpilih |
| `linkedAt` | timestamp penautan (M03) |
| `contextCheckedAt` | kapan context server terakhir diperiksa (display; M03) |
| `cloudAccess`, `registeredDeviceId`, `hasResolvedZeroBusiness`, `role`, `syncCapabilities`, `deviceContext`, `capabilityState` | konteks non-sensitif |

**Token tidak pernah ada di sini.** Token hanya di `tokenRepository` (secure storage).

## Sesi & restart

`hydrateFromStorage(adapter)` dipanggil saat bootstrap (non-blocking — POS tetap buka
meski storage cloud gagal):

- Tanpa token → FREE/tanpa Cloud.
- Dengan token + `cloud_context` → restore user, link (`selectedBusiness`, `linkedAt`,
  `contextCheckedAt`) **tanpa network call**. `capabilityState` di-set `unverified`
  (atau `legacy`) — snapshot cache **bukan** otorisasi.
- Startup offline: POS berjalan normal; state link ditampilkan dengan penanda "status
  belum diperiksa ulang".

## Token invalid (401)

Saat `refreshContext` (atau context pasca-login) menerima **401**:

- hapus token, bersihkan sesi + link + `cloud_context` (via `handleInvalidToken`),
- set `sessionInvalid = true` dengan pesan "Sesi Cloud tidak valid. Silakan masuk kembali."
- **tidak** menyentuh data POS lokal,
- **tidak ada infinite retry** (apiClient tanpa retry; panggilan berikutnya berhenti di
  `NOT_AUTHENTICATED`).

## Membership dicabut

Jika token masih valid tetapi business tertaut hilang dari `/api/mobile/context`
(`refreshContext` sukses namun business tidak ada): `selectedBusiness = null`,
`capabilityState = 'revoked'`, kode `BUSINESS_ACCESS_REVOKED`. Token tetap; user
diarahkan memilih bisnis lain yang masih authorized. Data lokal tetap utuh.

## Putuskan Cloud (disconnect)

CTA **"Putuskan Cloud"** (CloudLoginView & Settings) memakai `BaseModal` konfirmasi:

1. `DELETE /api/auth/logout` (best-effort; kegagalan jaringan tidak menghalangi),
2. hapus token dari secure storage,
3. `clearCloudContext()` (link + cached entitlement dibuang),
4. `clearSession()` → kembali ke state local/Free-unlinked.

**Tidak** menghapus produk, transaksi, pelanggan, kas, shift, atau pengaturan lokal.
`device_identifier` sengaja dipertahankan.

## Integrasi PREM-M01 & PREM-M02

- Kartu Langganan PREM-M01 tetap satu-satunya penentu Free/Premium (fail-closed).
  Login **tidak** mengubah status Premium.
- Blok "Akun Cloud" menampilkan Status (Terhubung/Belum), Akun, Bisnis Cloud,
  Subscription (label server), dan Status diperiksa — beserta CTA **Kelola Langganan**
  (→ route `subscription`) dan **Putuskan Cloud**. `FREE + linked` tetap Free.
- PREM-M02: pemilihan paket tetap membaca katalog; **M03 tidak melakukan checkout**.

## Keamanan

- Password tidak dipersist & tidak di-log; token tidak di-log / tidak masuk URL /
  tidak masuk data transaksi/produk.
- Arbitrary `business_id` tidak dipercaya; pilihan bisnis selalu dari membership server.
- Entitlement selalu dari server (`subscription`), bukan dihitung dari string plan lokal.
- 401 → clear sesi Cloud; 403 → pesan sesuai kode (mis. `BUSINESS_ACCESS_DENIED`,
  `CLOUD_SUBSCRIPTION_REQUIRED` pada jalur sync).
- Response context malformed (mis. `businesses` bukan array) **fail closed**
  (`MALFORMED_CONTEXT`) — tidak memberikan akses dan tidak crash.
- Timeout/network error fail-safe: POS tetap lokal.

## Pengujian

- `src/__tests__/prem-m03-cloud-login.spec.js` (19 test): klasifikasi error login,
  offline login aman, konfirmasi link eksplisit (single/multi), penolakan arbitrary
  business_id, persist/restore link, 401 clear-sesi-only + tanpa loop, membership
  revoked, malformed context fail-closed, disconnect + keamanan data lokal, dan kartu
  Akun Cloud di Settings.
- `src/__tests__/cloud-login-context.spec.js` (P10) & `premium-settings-ui.spec.js`
  (PREM-M01) & `premium-plan-selection.spec.js` (PREM-M02) tetap hijau.
- `sync-cashier-capabilities.spec.js` diperbarui: satu business kini melewati langkah
  konfirmasi `#cloud-confirm-link-btn`.

## Batasan yang diketahui

- **Tidak ada endpoint refresh token** — token dipakai sampai server menolak; 401 →
  sesi dibersihkan dan user diminta login ulang.
- **Logout best-effort** — jika offline, sesi server mungkin masih hidup; klien tetap
  membersihkan state lokal.
- **Daftar `businesses` tidak dipersist** — setelah restart offline, bisnis yang belum
  tertaut hanya dapat dipilih saat online (state "belum ditautkan" ditampilkan).

## Di luar lingkup (task berikutnya)

Checkout Midtrans/QRIS dan polling pembayaran (PREM-M04), payment history, aktivasi
subscription client-side, cloud backup/restore, full data sync/reconciliation (PREM-M06),
registrasi device redesign, pembuatan business server, dan migrasi lokal destruktif.
