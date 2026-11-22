<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseModal from '@/components/base/BaseModal.vue'
import { useCloudSessionStore } from '@/stores/cloudSessionStore'
import { useSubscriptionStore } from '@/stores/subscriptionStore'

defineProps({
  open: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['close'])

const router = useRouter()
const cloudStore = useCloudSessionStore()
const subscriptionStore = useSubscriptionStore()

const isCashier = computed(
  () => cloudStore.role === 'cashier' || cloudStore.isCashierContext === true,
)

const hasCloudAccess = computed(
  () =>
    subscriptionStore.isPremium === true ||
    subscriptionStore.hasCloudAccess === true ||
    cloudStore.isOperationalCloudAccess === true,
)

function handleUpgrade() {
  emit('close')
  if (isCashier.value) return
  router.push({ name: cloudStore.isLinked ? 'my-subscription' : 'subscription' })
}
</script>

<template>
  <BaseModal
    :open="open"
    :title="hasCloudAccess ? 'Hitung HPP & Persediaan Bahan' : 'Fitur Khusus Paket Cloud'"
    @close="emit('close')"
  >
    <!-- Locked State: Must Upgrade to Cloud -->
    <div v-if="!hasCloudAccess" class="space-y-4" data-testid="hpp-cloud-lock-modal">
      <div
        class="flex items-start gap-3.5 rounded-2xl border border-amber-200/90 bg-amber-50/80 p-4 dark:border-amber-500/30 dark:bg-amber-950/35"
      >
        <span
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300"
        >
          <AppIcon name="lock" class="h-5 w-5" />
        </span>
        <div class="min-w-0 space-y-1">
          <div class="flex flex-wrap items-center gap-1.5">
            <p class="text-sm font-bold text-ink-primary">Hitung HPP & Persediaan Bahan Terkunci</p>
            <span
              class="inline-flex items-center gap-1 rounded-full bg-amber-200/70 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-amber-800 dark:bg-amber-500/25 dark:text-amber-200"
            >
              Cloud
            </span>
          </div>
          <p class="text-xs leading-relaxed text-ink-secondary" data-testid="hpp-lock-message">
            Untuk menggunakan kalkulasi HPP otomatis dan manajemen resep persediaan bahan baku, Anda harus upgrade ke Paket Cloud terlebih dahulu. Atur takaran bahan baku di Dashboard Web Cloud untuk menghitung HPP riil dan memotong stok bahan secara otomatis saat pesanan kasir selesai.
          </p>
        </div>
      </div>

      <div class="space-y-2 rounded-2xl border border-zinc-200/80 bg-surface/60 p-3.5 text-xs dark:border-slate-700/60">
        <div class="flex items-start gap-2.5">
          <AppIcon name="calculator" class="mt-0.5 h-4 w-4 text-primary" />
          <div>
            <p class="font-bold text-ink-primary">Kalkulasi HPP Otomatis dari Resep</p>
            <p class="text-ink-secondary">
              HPP modal per porsi menu dihitung akurat berdasarkan takaran bahan baku (misal: kopi, gula, susu, cup).
            </p>
          </div>
        </div>
        <div class="flex items-start gap-2.5">
          <AppIcon name="stock" class="mt-0.5 h-4 w-4 text-emerald-600" />
          <div>
            <p class="font-bold text-ink-primary">Pengurangan Stok Bahan Otomatis</p>
            <p class="text-ink-secondary">
              Setiap menu terjual di kasir POS akan memotong stok persediaan bahan baku secara real-time.
            </p>
          </div>
        </div>
        <div class="flex items-start gap-2.5">
          <AppIcon name="reports" class="mt-0.5 h-4 w-4 text-indigo-600" />
          <div>
            <p class="font-bold text-ink-primary">Analisis Laba Kotor (Gross Profit)</p>
            <p class="text-ink-secondary">
              Pantau laporan margin laba rugi riil per menu melalui Web Dashboard di laptop/PC.
            </p>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-2 pt-1 sm:flex-row-reverse">
        <BaseButton
          v-if="!isCashier"
          block
          data-testid="hpp-lock-upgrade-btn"
          @click="handleUpgrade"
        >
          <AppIcon name="cloud" class="h-4 w-4" />
          <span>Upgrade ke Paket Cloud</span>
        </BaseButton>
        <BaseButton variant="secondary" block @click="emit('close')"> Tutup </BaseButton>
      </div>
    </div>

    <!-- Active Cloud State: Read-only Synced Summary + Dashboard Notice -->
    <div v-else class="space-y-4" data-testid="hpp-cloud-active-modal">
      <div
        class="flex items-start gap-3 rounded-2xl border border-indigo-200/80 bg-indigo-50/70 p-3.5 text-xs dark:border-indigo-500/30 dark:bg-indigo-950/35"
      >
        <span
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary"
        >
          <AppIcon name="cloud" class="h-4 w-4" />
        </span>
        <div class="space-y-1">
          <p class="font-bold text-ink-primary">Dikelola melalui Dashboard Cloud</p>
          <p class="leading-relaxed text-ink-secondary">
            Pengaturan komposisi resep bahan baku dan kalkulasi HPP otomatis dikelola melalui Dashboard Web Cloud di laptop/PC, lalu otomatis tersinkron ke perangkat POS Mobile ini.
          </p>
        </div>
      </div>

      <div class="space-y-2 rounded-2xl border border-zinc-200/80 bg-surface/60 p-3.5 text-xs dark:border-slate-700/60">
        <div class="flex items-start gap-2.5">
          <AppIcon name="check" class="mt-0.5 h-4 w-4 text-emerald-600" />
          <div>
            <p class="font-bold text-ink-primary">Fitur Cloud Aktif</p>
            <p class="text-ink-secondary">
              Perangkat POS ini telah terhubung dengan Paket Cloud. Stok persediaan bahan baku akan otomatis terpotong saat transaksi menu kasir selesai.
            </p>
          </div>
        </div>
      </div>

      <BaseButton variant="secondary" block @click="emit('close')"> Tutup </BaseButton>
    </div>
  </BaseModal>
</template>
