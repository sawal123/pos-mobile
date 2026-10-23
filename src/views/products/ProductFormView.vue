<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'

import AppIcon from '@/components/base/AppIcon.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import { useBusinessStore } from '@/stores/businessStore'
import { useProductStore } from '@/stores/productStore'

const businessStore = useBusinessStore()
const productStore = useProductStore()
const route = useRoute()
const router = useRouter()

const { categories } = storeToRefs(productStore)

const form = reactive({
  name: '',
  category: '',
  sku: '',
  cost: 0,
  price: 0,
  stock: 0,
  unit: 'pcs',
  minStock: 0,
  pricingUnit: 'kg',
  minQuantity: '',
  estimatedDuration: '',
  imageData: '',
  isActive: true,
})

const errors = ref({})
const formError = ref('')
const imageError = ref('')

const isEditMode = computed(() => Boolean(route.params.id))
const isLaundry = computed(() => businessStore.normalizedType === 'Laundry')
const itemKind = computed(() => (isLaundry.value ? 'service' : 'product'))
const pageTitle = computed(() => {
  if (isLaundry.value) return isEditMode.value ? 'Edit Layanan' : 'Tambah Layanan'
  return isEditMode.value ? 'Edit Produk' : 'Tambah Produk'
})

function resetForm() {
  form.name = ''
  form.category = categories.value[0] ?? ''
  form.sku = ''
  form.cost = 0
  form.price = 0
  form.stock = 0
  form.unit = isLaundry.value ? 'kg' : 'pcs'
  form.minStock = 0
  form.pricingUnit = 'kg'
  form.minQuantity = ''
  form.estimatedDuration = ''
  form.imageData = ''
  form.isActive = true
  errors.value = {}
  formError.value = ''
  imageError.value = ''
}

function loadProduct() {
  resetForm()

  if (!isEditMode.value) {
    return
  }

  const product = productStore.getProductById(route.params.id)

  if (!product) {
    router.replace({ name: 'products' })
    return
  }

  form.name = product.name
  form.category = product.category
  form.sku = product.sku ?? ''
  form.cost = product.cost ?? 0
  form.price = product.price
  form.stock = product.stock
  form.unit = product.unit ?? 'pcs'
  form.minStock = product.minStock ?? 0
  form.pricingUnit = product.pricingUnit ?? 'kg'
  form.minQuantity = product.minQuantity || ''
  form.estimatedDuration = product.estimatedDuration ?? ''
  form.imageData = product.imageData ?? ''
  form.isActive = product.isActive
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('Gagal membaca gambar.'))
    reader.readAsDataURL(file)
  })
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Gambar tidak dapat diproses.'))
    image.src = dataUrl
  })
}

async function resizeImageFile(file, maxDimension = 800) {
  const dataUrl = await readFileAsDataUrl(file)
  const image = await loadImage(dataUrl)
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height))
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')

  if (!context) {
    return dataUrl
  }

  context.drawImage(image, 0, 0, width, height)

  return canvas.toDataURL('image/webp', 0.78)
}

async function handleImageChange(event) {
  imageError.value = ''
  const input = event.target
  const [file] = input.files ?? []

  if (!file) {
    return
  }

  if (!file.type.startsWith('image/')) {
    imageError.value = 'File harus berupa gambar.'
    input.value = ''
    return
  }

  try {
    form.imageData = await resizeImageFile(file)
  } catch {
    imageError.value = 'Gambar tidak dapat diproses.'
  } finally {
    input.value = ''
  }
}

function removeImage() {
  form.imageData = ''
  imageError.value = ''
}

async function handleSubmit() {
  formError.value = ''

  const payload = {
    kind: itemKind.value,
    name: form.name,
    category: form.category,
    sku: form.sku,
    cost: form.cost,
    price: form.price,
    stock: form.stock,
    unit: form.unit,
    minStock: form.minStock,
    pricingUnit: form.pricingUnit,
    minQuantity: form.minQuantity,
    estimatedDuration: form.estimatedDuration,
    imageData: form.imageData,
    isActive: form.isActive,
  }

  const result = isEditMode.value
    ? productStore.updateProduct(route.params.id, payload)
    : productStore.createProduct(payload)

  if (!result.success) {
    errors.value = result.errors ?? {}
    formError.value = result.errors?.form ?? ''
    return
  }

  errors.value = {}
  await router.push({ name: 'products' })
}

watch(
  () => [route.params.id, categories.value.length],
  () => {
    loadProduct()
  },
  { immediate: true },
)
</script>

<template>
  <div class="space-y-4 pb-32">
    <!-- Header Minimalist -->
    <header class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-3 min-w-0">
        <button
          type="button"
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-zinc-200/80 bg-white text-ink-primary shadow-xs transition hover:bg-zinc-50 active:scale-95"
          aria-label="Kembali"
          @click="router.push({ name: 'products' })"
        >
          <AppIcon name="chevron-left" class="h-5 w-5" />
        </button>

        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-[11px] font-bold uppercase tracking-widest text-primary">
              {{ isLaundry ? 'Katalog Layanan' : 'Katalog & Menu' }}
            </span>
            <span class="inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
          </div>
          <h1 class="truncate text-xl font-black tracking-tight text-ink-primary sm:text-2xl">
            {{ pageTitle }}
          </h1>
        </div>
      </div>

      <button
        type="button"
        class="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-secondary shadow-xs transition hover:bg-zinc-50 active:scale-95"
        @click="router.push({ name: 'products' })"
      >
        Batal
      </button>
    </header>

    <!-- Error Alert Banner -->
    <div
      v-if="formError"
      class="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-700 shadow-xs"
    >
      <svg class="h-4 w-4 shrink-0 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <p class="font-medium">{{ formError }}</p>
    </div>

    <form class="space-y-4" @submit.prevent="handleSubmit">
      <!-- 1. Photo Card (Compact & Minimalist) -->
      <section class="rounded-3xl border border-zinc-200/80 bg-white p-4 shadow-soft">
        <div class="flex items-center gap-4">
          <!-- Thumbnail Container -->
          <div
            class="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-zinc-200/80 bg-surface sm:h-22 sm:w-22"
          >
            <img
              v-if="form.imageData"
              :src="form.imageData"
              :alt="form.name || 'Preview gambar'"
              class="h-full w-full object-cover"
              data-testid="product-image-preview"
            />
            <div v-else class="flex flex-col items-center justify-center text-zinc-400">
              <svg class="h-6 w-6 stroke-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span class="mt-1 text-[10px] font-medium">Foto</span>
            </div>
          </div>

          <!-- Upload Actions & Details -->
          <div class="min-w-0 flex-1 space-y-1.5">
            <div>
              <p class="text-sm font-bold text-ink-primary">Foto {{ isLaundry ? 'Layanan' : 'Produk' }}</p>
              <p class="text-[11px] text-ink-secondary">Format JPG, PNG (otomatis diperkecil)</p>
            </div>

            <div class="flex flex-wrap items-center gap-2 pt-0.5">
              <label class="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-zinc-200/90 bg-white px-3 text-xs font-semibold text-ink-primary shadow-2xs transition hover:bg-zinc-50 active:scale-95">
                <svg class="h-3.5 w-3.5 text-ink-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <span>{{ form.imageData ? 'Ganti Foto' : 'Pilih Foto' }}</span>
                <input class="hidden" type="file" accept="image/*" data-testid="product-image-input" @change="handleImageChange" />
              </label>

              <button
                v-if="form.imageData"
                type="button"
                class="inline-flex h-8 items-center gap-1 rounded-xl px-2.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 active:scale-95"
                @click="removeImage"
              >
                <AppIcon name="trash" class="h-3.5 w-3.5" />
                <span>Hapus<span class="sr-only"> Gambar</span></span>
              </button>
            </div>
            <p v-if="imageError" class="text-xs text-red-600">{{ imageError }}</p>
          </div>
        </div>
      </section>

      <!-- 2. Informasi Utama (Nama, Kategori, SKU) -->
      <section class="rounded-3xl border border-zinc-200/80 bg-white p-4 shadow-soft space-y-3.5">
        <h2 class="text-xs font-bold uppercase tracking-wider text-ink-secondary">Informasi Dasar</h2>

        <!-- Nama Produk -->
        <div class="space-y-1">
          <BaseInput
            :model-value="form.name"
            :label="isLaundry ? 'Nama Layanan' : 'Nama Produk'"
            :placeholder="isLaundry ? 'Contoh: Cuci Kering' : 'Contoh: Kopi Susu Aren'"
            @update:model-value="form.name = $event"
          />
          <p v-if="errors.name" class="text-xs text-red-600">{{ errors.name }}</p>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <!-- Kategori Dropdown -->
          <label class="flex flex-col gap-1.5">
            <span class="text-xs font-semibold text-ink-secondary">Kategori</span>
            <div class="relative">
              <select
                v-model="form.category"
                class="h-11 w-full appearance-none rounded-2xl border border-zinc-200/90 bg-white pl-3.5 pr-8 text-sm font-medium text-ink-primary outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
              >
                <option disabled value="">Pilih kategori</option>
                <option v-for="category in categories" :key="category" :value="category">
                  {{ category }}
                </option>
              </select>
              <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-ink-secondary">
                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
            <p v-if="errors.category" class="text-xs text-red-600">{{ errors.category }}</p>
          </label>

          <!-- SKU / Barcode (Retail/FnB) -->
          <div v-if="!isLaundry" class="space-y-1">
            <BaseInput
              :model-value="form.sku"
              label="SKU / Barcode"
              placeholder="Kode unik (opsional)"
              @update:model-value="form.sku = $event"
            />
          </div>
        </div>
      </section>

      <!-- 3. Finansial (Harga Jual & HPP) -->
      <section class="rounded-3xl border border-zinc-200/80 bg-white p-4 shadow-soft space-y-3.5">
        <h2 class="text-xs font-bold uppercase tracking-wider text-ink-secondary">Harga & Biaya</h2>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <!-- Harga Jual -->
          <div class="space-y-1">
            <BaseInput
              :model-value="form.price"
              :label="isLaundry ? 'Harga per Unit (Rp)' : 'Harga Jual (Rp)'"
              type="number"
              placeholder="0"
              @update:model-value="form.price = $event"
            />
            <p v-if="errors.price" class="text-xs text-red-600">{{ errors.price }}</p>
          </div>

          <!-- HPP Modal -->
          <div class="space-y-1">
            <BaseInput
              :model-value="form.cost"
              :label="isLaundry ? 'Estimasi HPP / Unit (Rp)' : 'HPP Modal (Rp)'"
              type="number"
              placeholder="0"
              @update:model-value="form.cost = $event"
            />
            <p v-if="errors.cost" class="text-xs text-red-600">{{ errors.cost }}</p>
          </div>
        </div>
      </section>

      <!-- 4. Inventaris & Stok (Produk Ritel/FnB) -->
      <section v-if="!isLaundry" class="rounded-3xl border border-zinc-200/80 bg-white p-4 shadow-soft space-y-3.5">
        <h2 class="text-xs font-bold uppercase tracking-wider text-ink-secondary">Inventaris & Stok</h2>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <!-- Stok Awal -->
          <div class="space-y-1">
            <BaseInput
              :model-value="form.stock"
              label="Stok"
              type="number"
              placeholder="0"
              :disabled="isEditMode"
              :hint="isEditMode ? 'Gunakan menu Stok untuk sesuaikan' : ''"
              @update:model-value="form.stock = $event"
            />
            <p v-if="errors.stock" class="text-xs text-red-600">{{ errors.stock }}</p>
          </div>

          <!-- Satuan -->
          <div class="space-y-1">
            <BaseInput
              :model-value="form.unit"
              label="Satuan"
              placeholder="pcs, cup, botol"
              @update:model-value="form.unit = $event"
            />
            <p v-if="errors.unit" class="text-xs text-red-600">{{ errors.unit }}</p>
          </div>

          <!-- Stok Minimum -->
          <div class="space-y-1">
            <BaseInput
              :model-value="form.minStock"
              label="Stok Minimum"
              type="number"
              placeholder="0"
              @update:model-value="form.minStock = $event"
            />
            <p v-if="errors.minStock" class="text-xs text-red-600">{{ errors.minStock }}</p>
          </div>
        </div>
      </section>

      <!-- 4b. Spesifikasi Layanan Laundry -->
      <section v-else class="rounded-3xl border border-zinc-200/80 bg-white p-4 shadow-soft space-y-3.5">
        <h2 class="text-xs font-bold uppercase tracking-wider text-ink-secondary">Spesifikasi Layanan</h2>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <!-- Pricing Unit -->
          <label class="flex flex-col gap-1.5">
            <span class="text-xs font-semibold text-ink-secondary">Pricing Unit</span>
            <select
              v-model="form.pricingUnit"
              class="h-11 w-full rounded-2xl border border-zinc-200/90 bg-white px-3.5 text-sm font-medium text-ink-primary outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
            >
              <option value="kg">kg (Kilogram)</option>
              <option value="pcs">pcs (Satuan)</option>
            </select>
            <p v-if="errors.pricingUnit" class="text-xs text-red-600">{{ errors.pricingUnit }}</p>
          </label>

          <!-- Min Quantity -->
          <div class="space-y-1">
            <BaseInput
              :model-value="form.minQuantity"
              label="Minimum Order"
              type="number"
              placeholder="Opsional (contoh: 3)"
              @update:model-value="form.minQuantity = $event"
            />
            <p v-if="errors.minQuantity" class="text-xs text-red-600">{{ errors.minQuantity }}</p>
          </div>

          <!-- Estimasi Durasi -->
          <div class="space-y-1 sm:col-span-2">
            <BaseInput
              :model-value="form.estimatedDuration"
              label="Estimasi Pengerjaan"
              placeholder="Contoh: 2 hari / 12 jam"
              @update:model-value="form.estimatedDuration = $event"
            />
          </div>
        </div>
      </section>

      <!-- 5. Tampilan Kasir (Interactive Switch) -->
      <section class="rounded-3xl border border-zinc-200/80 bg-white p-4 shadow-soft">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="text-sm font-bold text-ink-primary">Tampilkan di Kasir POS</p>
            <p class="text-xs text-ink-secondary">
              {{ form.isActive ? 'Menu aktif dan langsung muncul di daftar kasir' : 'Menu dinonaktifkan dari kasir POS' }}
            </p>
          </div>

          <!-- Modern iOS-style toggle switch -->
          <button
            type="button"
            role="switch"
            :aria-checked="form.isActive"
            class="relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none"
            :class="form.isActive ? 'bg-primary' : 'bg-zinc-200'"
            @click="form.isActive = !form.isActive"
          >
            <span
              class="pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out flex items-center justify-center text-[10px]"
              :class="form.isActive ? 'translate-x-5 text-primary' : 'translate-x-0 text-zinc-400'"
            >
              <svg v-if="form.isActive" class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
              </svg>
            </span>
          </button>
        </div>
      </section>

      <!-- Submit Actions -->
      <div class="grid grid-cols-2 gap-2.5 pt-2">
        <BaseButton
          type="button"
          variant="secondary"
          class="h-11 text-sm font-semibold"
          @click="router.push({ name: 'products' })"
        >
          Batal
        </BaseButton>

        <BaseButton
          type="submit"
          class="h-11 text-sm font-bold shadow-soft"
        >
          Simpan
        </BaseButton>
      </div>
    </form>
  </div>
</template>
