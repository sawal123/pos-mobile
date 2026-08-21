<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import { useProductStore } from '@/stores/productStore'

const productStore = useProductStore()
const route = useRoute()
const router = useRouter()

const { categories } = storeToRefs(productStore)

const form = reactive({
  name: '',
  category: '',
  price: 0,
  stock: 0,
  isActive: true,
})

const errors = ref({})
const formError = ref('')

const isEditMode = computed(() => Boolean(route.params.id))

function resetForm() {
  form.name = ''
  form.category = categories.value[0] ?? ''
  form.price = 0
  form.stock = 0
  form.isActive = true
  errors.value = {}
  formError.value = ''
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
  form.price = product.price
  form.stock = product.stock
  form.isActive = product.isActive
}

async function handleSubmit() {
  formError.value = ''

  const payload = {
    name: form.name,
    category: form.category,
    price: Number(form.price),
    stock: Number(form.stock),
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
        {{ isEditMode ? 'Edit Produk' : 'Tambah Produk' }}
      </h1>
      <p class="mt-2 text-sm text-ink-secondary">
        {{ isEditMode ? 'Perbarui data produk yang sudah ada.' : 'Tambahkan produk baru ke katalog POS.' }}
      </p>
    </section>

    <BaseCard>
      <form class="space-y-5" @submit.prevent="handleSubmit">
        <p v-if="formError" class="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">
          {{ formError }}
        </p>

        <div class="grid gap-4 md:grid-cols-2">
          <div class="space-y-2">
            <BaseInput
              :model-value="form.name"
              label="Product Name"
              placeholder="Masukkan nama produk"
              @update:model-value="form.name = $event"
            />
            <p v-if="errors.name" class="text-sm text-danger">{{ errors.name }}</p>
          </div>

          <label class="flex flex-col gap-2">
            <span class="text-sm font-medium text-ink-secondary">Category</span>
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

          <div class="space-y-2">
            <BaseInput
              :model-value="form.price"
              label="Price"
              type="number"
              placeholder="0"
              @update:model-value="form.price = $event"
            />
            <p v-if="errors.price" class="text-sm text-danger">{{ errors.price }}</p>
          </div>

          <div class="space-y-2">
            <BaseInput
              :model-value="form.stock"
              label="Stock"
              type="number"
              placeholder="0"
              @update:model-value="form.stock = $event"
            />
            <p v-if="errors.stock" class="text-sm text-danger">{{ errors.stock }}</p>
          </div>
        </div>

        <label class="flex items-center gap-3 text-sm text-ink-primary">
          <input v-model="form.isActive" type="checkbox" class="h-4 w-4 rounded border-zinc-300 text-primary focus:ring-primary" />
          <span>Status Active</span>
        </label>

        <div class="flex flex-wrap gap-3">
          <BaseButton type="submit">
            {{ isEditMode ? 'Simpan Perubahan' : 'Simpan Produk' }}
          </BaseButton>
          <BaseButton type="button" variant="secondary" @click="router.push({ name: 'products' })">
            Batal
          </BaseButton>
        </div>
      </form>
    </BaseCard>
  </div>
</template>
