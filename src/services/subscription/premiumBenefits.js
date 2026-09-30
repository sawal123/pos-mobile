/**
 * PREM-M02 — Premium benefit catalog.
 *
 * Each benefit carries the backend capability that actually backs it. Nothing is
 * promised that the backend cannot do today:
 *
 * | Benefit              | Backing capability                                        |
 * | -------------------- | --------------------------------------------------------- |
 * | Sinkronisasi cloud   | `/api/sync/push` + `/api/sync/pull` + device registration  |
 * | Dashboard web        | Dashboard (business, outlets, devices, products, shifts)   |
 * | Monitoring bisnis    | Dashboard reports/export + laundry monitoring              |
 * | Backup cloud         | **not implemented by the backend** — shown as unavailable  |
 *
 * Local features (offline POS, local backup/restore, customers, expenses) stay
 * available on the Free plan and are never presented as Premium benefits.
 */

export const BENEFIT_AVAILABILITY = Object.freeze({
  AVAILABLE: 'available',
  NOT_AVAILABLE: 'not_available',
})

export const BENEFIT_AVAILABILITY_LABELS = Object.freeze({
  available: 'Tersedia',
  not_available: 'Belum tersedia',
})

export const PREMIUM_BENEFITS = Object.freeze([
  {
    key: 'cloud_sync',
    icon: 'sync',
    title: 'Sinkronisasi cloud',
    description: 'Data produk, stok, transaksi kasir dan shift tersinkron antar perangkat.',
    availability: BENEFIT_AVAILABILITY.AVAILABLE,
    availabilityNote: 'Didukung perangkat cloud yang terdaftar pada bisnis Anda.',
  },
  {
    key: 'cloud_backup',
    icon: 'backup',
    title: 'Backup cloud',
    description: 'Pencadangan otomatis ke cloud, terpisah dari backup lokal di perangkat.',
    availability: BENEFIT_AVAILABILITY.NOT_AVAILABLE,
    availabilityNote: 'Belum tersedia. Untuk saat ini gunakan Backup Data lokal di Pengaturan.',
  },
  {
    key: 'web_dashboard',
    icon: 'reports',
    title: 'Dashboard web',
    description: 'Kelola bisnis, outlet, perangkat dan produk melalui browser di desktop.',
    availability: BENEFIT_AVAILABILITY.AVAILABLE,
    availabilityNote: 'Tersedia selama langganan cloud bisnis Anda aktif.',
  },
  {
    key: 'business_monitoring',
    icon: 'transactions',
    title: 'Monitoring bisnis',
    description: 'Pantau penjualan, stok, kas dan pesanan laundry dari dashboard.',
    availability: BENEFIT_AVAILABILITY.AVAILABLE,
    availabilityNote: 'Dashboard menampilkan data yang sudah tersinkron dari perangkat.',
  },
])

/** Local capabilities that never depend on the subscription. */
export const LOCAL_GUARANTEES = Object.freeze([
  'Kasir (POS) tetap berjalan offline tanpa Premium.',
  'Backup Data dan Restore Backup lokal tetap tersedia untuk pengguna Free.',
  'Data penjualan, stok dan shift tetap tersimpan di perangkat.',
])
