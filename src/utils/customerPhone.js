/** Compare stored Indonesian phone numbers without losing the user's input. */
export function normalizeCustomerPhone(value) {
  const phone = String(value ?? '').trim()
  if (!/^\+?[\d\s().-]+$/.test(phone)) return ''
  let digits = phone.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`
  return digits
}
