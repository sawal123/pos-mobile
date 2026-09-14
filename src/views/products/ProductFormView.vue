<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
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
  <div class="space-y-6">
    <section>
      <p class="text-sm font-medium uppercase tracking-[0.18em] text-primary">Product Management</p>
      <h1 class="mt-2 text-3xl font-semibold text-ink-primary">
        {{ pageTitle }}
      </h1>
      <p class="mt-2 text-sm text-ink-secondary">
        {{ isLaundry ? 'Kelola layanan laundry dengan quantity kg atau pcs.' : 'Kelola produk, HPP, harga jual, dan stok.' }}
      </p>
    </section>

    <BaseCard>
      <form class="space-y-5" @submit.prevent="handleSubmit">
        <p v-if="formError" class="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">
          {{ formError }}
        </p>

        <div class="grid gap-4 md:grid-cols-2">
          <div class="space-y-3 md:col-span-2">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div class="aspect-[4/3] w-full overflow-hidden rounded-3xl bg-surface sm:w-44">
                <img
                  v-if="form.imageData"
                  :src="form.imageData"
                  :alt="form.name || 'Preview gambar'"
                  class="h-full w-full object-cover"
                  data-testid="product-image-preview"
                />
                <div v-else class="flex h-full w-full items-center justify-center text-sm text-ink-secondary">
                  Preview gambar
                </div>
              </div>

              <div class="space-y-2">
                <p class="text-sm font-medium text-ink-primary">Gambar {{ isLaundry ? 'Layanan' : 'Produk' }}</p>
                <p class="text-sm text-ink-secondary">Pilih dari galeri. Gambar otomatis diperkecil sebelum disimpan offline.</p>
                <div class="flex flex-wrap gap-2">
                  <label class="inline-flex h-11 cursor-pointer items-center justify-center rounded-2xl bg-white px-4 text-sm font-medium text-ink-primary ring-1 ring-zinc-200 transition hover:bg-zinc-50">
                    <span>{{ form.imageData ? 'Ganti Gambar' : 'Pilih Gambar' }}</span>
                    <input class="hidden" type="file" accept="image/*" data-testid="product-image-input" @change="handleImageChange" />
                  </label>
                  <BaseButton v-if="form.imageData" type="button" variant="ghost" @click="removeImage">
                    Hapus Gambar
                  </BaseButton>
                </div>
                <p v-if="imageError" class="text-sm text-danger">{{ imageError }}</p>
              </div>
            </div>
          </div>

          <div class="space-y-2">
            <BaseInput
              :model-value="form.name"
              :label="isLaundry ? 'Nama Layanan' : 'Nama Produk'"
              :placeholder="isLaundry ? 'Contoh: Cuci Kering' : 'Masukkan nama produk'"
              @update:model-value="form.name = $event"
            />
            <p v-if="errors.name" class="text-sm text-danger">{{ errors.name }}</p>
          </div>

          <label class="flex flex-col gap-2">
            <span class="text-sm font-medium text-ink-secondary">Kategori</span>
            <select
              v-model="form.category"
              class="h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm text-ink-primary outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
            >
              <option disabled value="">Pilih kategori</option>
              <option v-for="category in categories" :key="category" :value="category">
                {{ category }}
              </option>
            </select>
            <p v-if="errors.category" class="text-sm text-danger">{{ errors.category }}</p>
          </label>

          <div v-if="!isLaundry" class="space-y-2">
            <BaseInput
              :model-value="form.sku"
              label="SKU / Barcode"
              placeholder="Opsional"
              @update:model-value="form.sku = $event"
            />
          </div>

          <div class="space-y-2">
            <BaseInput
              :model-value="form.cost"
              :label="isLaundry ? 'Estimasi HPP / Unit' : 'HPP'"
              type="number"
              placeholder="0"
              @update:model-value="form.cost = $event"
            />
            <p v-if="errors.cost" class="text-sm text-danger">{{ errors.cost }}</p>
          </div>

          <div class="space-y-2">
            <BaseInput
              :model-value="form.price"
              :label="isLaundry ? 'Harga per Unit' : 'Harga Jual'"
              type="number"
              placeholder="0"
              @update:model-value="form.price = $event"
            />
            <p v-if="errors.price" class="text-sm text-danger">{{ errors.price }}</p>
          </div>

          <template v-if="isLaundry">
            <label class="flex flex-col gap-2">
              <span class="text-sm font-medium text-ink-secondary">Pricing Unit</span>
              <select
                v-model="form.pricingUnit"
                class="h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm text-ink-primary outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
              >
                <option value="kg">kg</option>
                <option value="pcs">pcs</option>
              </select>
              <p v-if="errors.pricingUnit" class="text-sm text-danger">{{ errors.pricingUnit }}</p>
            </label>

            <div class="space-y-2">
              <BaseInput
                :model-value="form.minQuantity"
                label="Minimum Quantity"
                type="number"
                placeholder="Opsional"
                @update:model-value="form.minQuantity = $event"
              />
              <p v-if="errors.minQuantity" class="text-sm text-danger">{{ errors.minQuantity }}</p>
            </div>

            <div class="space-y-2 md:col-span-2">
              <BaseInput
                :model-value="form.estimatedDuration"
                label="Estimasi Pengerjaan"
                placeholder="Contoh: 2 hari"
                @update:model-value="form.estimatedDuration = $event"
              />
            </div>
          </template>

          <template v-else>
            <div class="space-y-2">
              <BaseInput
                :model-value="form.stock"
                label="Stok"
                type="number"
                placeholder="0"
                :disabled="isEditMode"
                :hint="isEditMode ? 'Stok tidak dapat diubah dari Edit Produk. Gunakan tombol Adjust Stok.' : ''"
                @update:model-value="form.stock = $event"
              />
              <p v-if="errors.stock" class="text-sm text-danger">{{ errors.stock }}</p>
            </div>

            <div class="space-y-2">
              <BaseInput
                :model-value="form.unit"
                label="Satuan"
                placeholder="pcs, botol, pack"
                @update:model-value="form.unit = $event"
              />
              <p v-if="errors.unit" class="text-sm text-danger">{{ errors.unit }}</p>
            </div>

            <div class="space-y-2">
              <BaseInput
                :model-value="form.minStock"
                label="Stok Minimum"
                type="number"
                placeholder="0"
                @update:model-value="form.minStock = $event"
              />
              <p v-if="errors.minStock" class="text-sm text-danger">{{ errors.minStock }}</p>
            </div>
          </template>
        </div>

        <label class="flex items-center gap-3 text-sm text-ink-primary">
          <input v-model="form.isActive" type="checkbox" class="h-4 w-4 rounded border-zinc-300 text-primary focus:ring-primary" />
          <span>Status Active</span>
        </label>

        <div class="flex flex-wrap gap-3">
          <BaseButton type="submit">
            {{ isEditMode ? 'Simpan Perubahan' : isLaundry ? 'Simpan Layanan' : 'Simpan Produk' }}
          </BaseButton>
          <BaseButton type="button" variant="secondary" @click="router.push({ name: 'products' })">
            Batal
          </BaseButton>
        </div>
      </form>
    </BaseCard>
  </div>
</template>
