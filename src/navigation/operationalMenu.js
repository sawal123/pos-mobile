export const BOTTOM_NAV_LIMIT = 5

export function getProductMenuLabel(businessType) {
  return businessType === 'Laundry' ? 'Layanan' : 'Produk'
}

export function getOperationalMenuItems(businessType) {
  const productLabel = getProductMenuLabel(businessType)
  const isLaundry = businessType === 'Laundry'

  return [
    {
      key: 'pos',
      icon: 'pos',
      title: isLaundry ? 'Order Laundry' : 'POS',
      subtitle: isLaundry ? 'Order & tracking laundry' : 'Transaksi penjualan',
      to: isLaundry ? '/laundry/orders' : '/pos',
    },
    {
      key: 'products',
      icon: 'products',
      title: productLabel,
      subtitle: productLabel === 'Layanan' ? 'Master layanan' : 'Master produk',
      to: '/products',
    },
    {
      key: 'stock',
      icon: 'stock',
      title: 'Stok',
      subtitle: 'Inventory & low stock',
      to: '/stock',
    },
    {
      key: 'cash',
      icon: 'cash',
      title: 'Kas',
      subtitle: 'Saldo dan mutasi',
      to: '/cash',
    },
    {
      key: 'transactions',
      icon: 'transactions',
      title: 'Transaksi',
      subtitle: 'Riwayat penjualan',
      to: '/transactions',
    },
    {
      key: 'customers',
      icon: 'customers',
      title: 'Pelanggan',
      subtitle: 'Data pelanggan',
      to: '/customers',
    },
    {
      key: 'expenses',
      icon: 'expenses',
      title: 'Pengeluaran',
      subtitle: 'Biaya operasional',
      to: '/expenses',
    },
    {
      key: 'shift',
      icon: 'shift',
      title: 'Shift',
      subtitle: 'Buka dan tutup shift',
      to: '/shift',
    },
    {
      key: 'reports',
      icon: 'reports',
      title: 'Laporan',
      subtitle: 'Ringkasan performa',
      to: '/reports',
    },
    {
      key: 'settings',
      icon: 'settings',
      title: 'Pengaturan',
      subtitle: 'Profil dan backup',
      to: '/settings',
    },
  ]
}

export function getBottomNavItems(businessType = 'Cafe / UMKM') {
  const isLaundry = businessType === 'Laundry'

  return [
    { key: 'home', icon: 'home', label: 'Home', to: '/home' },
    { key: 'pos', icon: 'pos', label: isLaundry ? 'Order' : 'POS', to: isLaundry ? '/laundry/orders' : '/pos' },
    { key: 'transactions', icon: 'transactions', label: 'Transaksi', to: '/transactions' },
    { key: 'cash', icon: 'cash', label: 'Kas', to: '/cash' },
    { key: 'more', icon: 'more', label: 'Lainnya', to: null },
  ]
}

export function getMoreMenuItems(businessType) {
  const productLabel = getProductMenuLabel(businessType)

  return [
    { key: 'products', icon: 'products', label: productLabel, to: '/products' },
    { key: 'stock', icon: 'stock', label: 'Stok', to: '/stock' },
    { key: 'customers', icon: 'customers', label: 'Pelanggan', to: '/customers' },
    { key: 'expenses', icon: 'expenses', label: 'Pengeluaran', to: '/expenses' },
    { key: 'shift', icon: 'shift', label: 'Shift', to: '/shift' },
    { key: 'reports', icon: 'reports', label: 'Laporan', to: '/reports' },
    { key: 'settings', icon: 'settings', label: 'Settings', to: '/settings' },
  ]
}
