export function formatCurrency(value = 0, currency = 'IDR', locale = 'id-ID') {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatDateTime(value, locale = 'id-ID') {
  if (!value) return '-'

  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function formatNumber(value = 0, locale = 'id-ID') {
  return new Intl.NumberFormat(locale).format(value)
}
