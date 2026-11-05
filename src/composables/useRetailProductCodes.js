import { computed } from 'vue'
import { useBusinessStore } from '@/stores/businessStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { canManageProductCodes } from '@/services/products/productCodeService'

export function useRetailProductCodes() {
  const business = useBusinessStore()
  const cloud = useCloudSessionStore()
  const isRetail = computed(() => business.normalizedType === 'Grosir / Toko Kelontong')
  const canManageCodes = computed(() => canManageProductCodes(cloud))
  const scanContext = computed(() =>
    JSON.stringify([
      business.name,
      business.normalizedType,
      business.mode,
      business.outlet,
      cloud.user?.id,
      cloud.selectedBusiness?.id,
      cloud.selectedOutlet?.id,
      cloud.sessionInvalid,
      cloud.role,
    ]),
  )
  return { isRetail, canManageCodes, scanContext }
}
