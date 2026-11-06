<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import BaseBadge from '@/components/base/BaseBadge.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import PromoCreateModal from '@/components/promos/PromoCreateModal.vue'
import { usePromoStore } from '@/stores/promoStore'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { formatCurrency } from '@/utils/formatters'

const router = useRouter()
const promoStore = usePromoStore()
const cloudStore = useCloudSessionStore()

const isCashier = computed(
  () => cloudStore.role === 'cashier' || cloudStore.isCashierContext === true,
)

const searchQuery = ref('')
const filterStatus = ref('all') // 'all' | 'active' | 'inactive'
const showCreateModal = ref(false)
const toastMessage = ref('')

function showToast(msg) {
  toastMessage.value = msg
  setTimeout(() => {
    if (toastMessage.value === msg) {
      toastMessage.value = ''
    }
  }, 3000)
}

const allPromos = computed(() => promoStore.promos || [])

const activeCount = computed(() => allPromos.value.filter((p) => p.status === 'active').length)
const inactiveCount = computed(() => allPromos.value.filter((p) => p.status !== 'active').length)

const filteredPromos = computed(() => {
  let list = allPromos.value

  if (filterStatus.value === 'active') {
    list = list.filter((p) => p.status === 'active')
  } else if (filterStatus.value === 'inactive') {
    list = list.filter((p) => p.status !== 'active')
  }

  const query = searchQuery.value.trim().toLowerCase()
  if (query) {
    list = list.filter((p) => {
      const matchName = String(p.name || '').toLowerCase().includes(query)
      const matchCode = String(p.code || '').toLowerCase().includes(query)
      return matchName || matchCode
    })
  }

  return list
})

function handleToggleStatus(promo) {
  if (isCashier.value) return
  const promoId = promo.id || promo.syncId
  const newStatus = promoStore.togglePromoStatus(promoId)
  showToast(
    newStatus === 'active'
      ? `Promo "${promo.name}" diaktifkan.`
      : `Promo "${promo.name}" dinonaktifkan.`,
  )
}

function handleDeletePromo(promo) {
  if (isCashier.value) return
  const promoId = promo.id || promo.syncId
  promoStore.removePromo(promoId)
  showToast(`Promo "${promo.name}" telah dihapus.`)
}

function handlePromoCreated(newPromo) {
  if (isCashier.value) return
  showToast(`Promo "${newPromo.name}" berhasil dibuat!`)
}

function formatValidity(promo) {
  if (!promo.startsAt && !promo.endsAt) {
    return 'Tanpa batas waktu'
  }
  if (promo.startsAt && !promo.endsAt) {
    const start = new Date(promo.startsAt).toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
    return `Mulai ${start}`
  }
  if (!promo.startsAt && promo.endsAt) {
    const end = new Date(promo.endsAt).toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
    return `s/d ${end}`
  }
  const start = new Date(promo.startsAt).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
  })
  const end = new Date(promo.endsAt).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  return `${start} - ${end}`
}
</script>

<template>
  <div class="min-h-full space-y-4 pb-12">
    <!-- Top Header -->
    <div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <button
          type="button"
          class="flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200/80 bg-card text-ink-primary shadow-xs transition hover:border-primary/40 active:scale-95 cursor-pointer dark:border-slate-700/60 dark:bg-[#1B2133]"
          @click="router.push('/home')"
        >
          <svg
            class="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div>
          <h1 class="text-lg font-bold text-ink-primary">Promo & Diskon</h1>
          <p class="text-xs text-ink-secondary">Kelola voucher & diskon kasir</p>
        </div>
      </div>

      <BaseButton
        v-if="!isCashier"
        variant="primary"
        class="gap-1.5 shadow-sm"
        @click="showCreateModal = true"
      >
        <svg
          class="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <span>Buat Promo</span>
      </BaseButton>
    </div>

    <!-- Toast Notification -->
    <transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="transform -translate-y-2 opacity-0"
      enter-to-class="transform translate-y-0 opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="transform translate-y-0 opacity-100"
      leave-to-class="transform -translate-y-2 opacity-0"
    >
      <div
        v-if="toastMessage"
        class="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-800 shadow-sm dark:border-emerald-800/40 dark:bg-emerald-950/40 dark:text-emerald-300"
      >
        <svg
          class="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
        <span>{{ toastMessage }}</span>
      </div>
    </transition>

    <!-- Search & Filter Controls -->
    <div class="space-y-3">
      <!-- Search Input -->
      <div class="relative">
        <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-zinc-400">
          <svg
            class="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Cari nama atau kode promo..."
          class="h-11 w-full rounded-2xl border border-zinc-200 bg-card pl-10 pr-4 text-xs text-ink-primary outline-none transition placeholder:text-zinc-400 focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-slate-700/60 dark:bg-[#1B2133] dark:placeholder:text-slate-500"
        />
        <button
          v-if="searchQuery"
          type="button"
          class="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-400 hover:text-zinc-600"
          @click="searchQuery = ''"
        >
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <!-- Filter Tabs -->
      <div class="flex gap-1.5 overflow-x-auto pb-1 text-xs">
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-semibold transition cursor-pointer"
          :class="[
            filterStatus === 'all'
              ? 'bg-primary text-white shadow-xs dark:bg-indigo-600'
              : 'border border-zinc-200/80 bg-card text-ink-secondary hover:border-zinc-300 dark:border-slate-700/60 dark:bg-[#1B2133]',
          ]"
          @click="filterStatus = 'all'"
        >
          <span>Semua</span>
          <span
            class="rounded-full px-1.5 py-0.2 text-[10px]"
            :class="filterStatus === 'all' ? 'bg-white/20' : 'bg-surface text-ink-secondary'"
          >
            {{ allPromos.length }}
          </span>
        </button>

        <button
          type="button"
          class="flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-semibold transition cursor-pointer"
          :class="[
            filterStatus === 'active'
              ? 'bg-emerald-600 text-white shadow-xs'
              : 'border border-zinc-200/80 bg-card text-ink-secondary hover:border-zinc-300 dark:border-slate-700/60 dark:bg-[#1B2133]',
          ]"
          @click="filterStatus = 'active'"
        >
          <span>Aktif</span>
          <span
            class="rounded-full px-1.5 py-0.2 text-[10px]"
            :class="filterStatus === 'active' ? 'bg-white/20' : 'bg-surface text-ink-secondary'"
          >
            {{ activeCount }}
          </span>
        </button>

        <button
          type="button"
          class="flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-semibold transition cursor-pointer"
          :class="[
            filterStatus === 'inactive'
              ? 'bg-zinc-700 text-white shadow-xs dark:bg-slate-700'
              : 'border border-zinc-200/80 bg-card text-ink-secondary hover:border-zinc-300 dark:border-slate-700/60 dark:bg-[#1B2133]',
          ]"
          @click="filterStatus = 'inactive'"
        >
          <span>Nonaktif</span>
          <span
            class="rounded-full px-1.5 py-0.2 text-[10px]"
            :class="filterStatus === 'inactive' ? 'bg-white/20' : 'bg-surface text-ink-secondary'"
          >
            {{ inactiveCount }}
          </span>
        </button>
      </div>
    </div>

    <!-- Promos List -->
    <div v-if="filteredPromos.length > 0" class="space-y-3">
      <BaseCard
        v-for="promo in filteredPromos"
        :key="promo.id || promo.syncId"
        class="space-y-3 transition-all hover:border-primary/30"
      >
        <!-- Top Row: Discount Value & Status -->
        <div class="flex items-start justify-between gap-2 border-b border-zinc-100 pb-2.5 dark:border-slate-800">
          <div class="flex items-center gap-2">
            <!-- Discount Badge Pill -->
            <span
              class="inline-flex items-center rounded-xl px-2.5 py-1 text-xs font-extrabold tracking-wide"
              :class="[
                promo.discountType === 'percent'
                  ? 'bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300'
                  : 'bg-primary/12 text-primary dark:bg-indigo-400/20 dark:text-indigo-300',
              ]"
            >
              {{ promo.discountType === 'percent' ? `${promo.discountValue}% OFF` : `Diskon ${formatCurrency(promo.discountValue)}` }}
            </span>

            <span
              v-if="promo.code"
              class="inline-flex items-center gap-1 rounded-xl border border-dashed border-zinc-300 bg-surface px-2 py-0.8 font-mono text-xs font-bold text-ink-primary dark:border-slate-600 dark:bg-[#121624]"
            >
              <svg class="h-3 w-3 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              {{ promo.code }}
            </span>
          </div>

          <BaseBadge :variant="promo.status === 'active' ? 'success' : 'neutral'">
            {{ promo.status === 'active' ? 'Aktif' : 'Nonaktif' }}
          </BaseBadge>
        </div>

        <!-- Middle Row: Promo Details -->
        <div>
          <h3 class="text-sm font-bold text-ink-primary">{{ promo.name }}</h3>
          
          <div class="mt-1.5 flex flex-wrap items-center gap-y-1 gap-x-3 text-xs text-ink-secondary">
            <!-- Min Purchase -->
            <span class="flex items-center gap-1">
              <svg class="h-3.5 w-3.5 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
                <path d="M12 18V6" />
              </svg>
              {{ Number(promo.minPurchase) > 0 ? `Min. belanja ${formatCurrency(promo.minPurchase)}` : 'Tanpa min. belanja' }}
            </span>

            <!-- Max Discount if percent -->
            <span v-if="promo.discountType === 'percent' && promo.maxDiscount" class="flex items-center gap-1">
              <span class="text-zinc-400">•</span>
              Maks. {{ formatCurrency(promo.maxDiscount) }}
            </span>

            <!-- Scope -->
            <span class="flex items-center gap-1">
              <span class="text-zinc-400">•</span>
              {{ promo.scope === 'category' ? `Kategori khusus` : (promo.scope === 'customer' ? 'Khusus Pelanggan' : 'Semua produk') }}
            </span>

            <!-- Validity -->
            <span class="flex items-center gap-1">
              <span class="text-zinc-400">•</span>
              {{ formatValidity(promo) }}
            </span>
          </div>
        </div>

        <!-- Bottom Actions Row -->
        <div class="flex items-center justify-between border-t border-zinc-100 pt-2.5 dark:border-slate-800">
          <div class="text-[11px] text-ink-secondary">
            ID: <span class="font-mono text-[10px]">{{ String(promo.syncId || promo.id).slice(0, 16) }}...</span>
          </div>

          <div v-if="!isCashier" class="flex items-center gap-2">
            <!-- Toggle status button -->
            <button
              type="button"
              class="rounded-xl px-2.5 py-1.5 text-xs font-semibold transition cursor-pointer"
              :class="[
                promo.status === 'active'
                  ? 'border border-zinc-200 text-ink-secondary hover:bg-zinc-100 dark:border-slate-700 dark:hover:bg-slate-800'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs',
              ]"
              @click="handleToggleStatus(promo)"
            >
              {{ promo.status === 'active' ? 'Nonaktifkan' : 'Aktifkan' }}
            </button>

            <!-- Delete button -->
            <button
              type="button"
              class="rounded-xl p-1.5 text-zinc-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 cursor-pointer"
              title="Hapus Promo"
              @click="handleDeletePromo(promo)"
            >
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>
        </div>
      </BaseCard>
    </div>

    <!-- Empty State -->
    <div
      v-else
      class="flex flex-col items-center justify-center rounded-3xl border border-dashed border-zinc-200/90 bg-card px-4 py-12 text-center dark:border-slate-700/60 dark:bg-[#1B2133]"
    >
      <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary dark:bg-indigo-400/15 dark:text-indigo-400">
        <svg
          class="h-7 w-7"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" />
          <line x1="7" y1="7" x2="7.01" y2="7" />
        </svg>
      </div>

      <h3 class="mt-3.5 text-sm font-bold text-ink-primary">
        {{ searchQuery ? 'Promo Tidak Ditemukan' : 'Belum Ada Promo' }}
      </h3>
      <p class="mt-1 max-w-xs text-xs text-ink-secondary">
        {{
          searchQuery
            ? 'Tidak ada promo yang cocok dengan kata kunci pencarian.'
            : 'Buat promo diskon atau voucher belanja untuk menarik lebih banyak pelanggan.'
        }}
      </p>

      <div v-if="!isCashier" class="mt-4">
        <BaseButton
          variant="primary"
          class="gap-1.5"
          @click="showCreateModal = true"
        >
          <svg
            class="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>Buat Promo Baru</span>
        </BaseButton>
      </div>
    </div>

    <!-- Promo Create Modal -->
    <PromoCreateModal
      :open="showCreateModal"
      @close="showCreateModal = false"
      @saved="handlePromoCreated"
    />
  </div>
</template>

