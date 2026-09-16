<script setup>
import { computed, ref } from 'vue'

import { useCustomerStore } from '@/stores/customerStore'

const props = defineProps({
  modelValue: {
    type: String,
    default: '',
  },
  label: {
    type: String,
    default: '',
  },
  placeholder: {
    type: String,
    default: '',
  },
  type: {
    type: String,
    default: 'text',
  },
  testid: {
    type: String,
    default: 'customer-autocomplete',
  },
  limit: {
    type: Number,
    default: 5,
  },
})

const emit = defineEmits(['update:modelValue', 'select'])

const customerStore = useCustomerStore()
const wrapperRef = ref(null)
const isOpen = ref(false)

const suggestions = computed(() => {
  if (!isOpen.value) {
    return []
  }

  return customerStore.searchCustomers(props.modelValue, props.limit)
})

function onInput(event) {
  const value = event.target.value
  emit('update:modelValue', value)
  isOpen.value = `${value}`.trim().length > 0
}

function onFocusOut(event) {
  const nextFocused = event?.relatedTarget

  if (nextFocused && wrapperRef.value?.contains(nextFocused)) {
    return
  }

  isOpen.value = false
}

function selectCustomer(customer) {
  isOpen.value = false
  emit('select', customer)
}
</script>

<template>
  <div ref="wrapperRef" class="relative" :data-testid="testid" @focusout="onFocusOut">
    <label class="flex w-full flex-col gap-2">
      <span v-if="label" class="text-sm font-medium text-ink-secondary">
        {{ label }}
      </span>

      <input
        :type="type"
        :placeholder="placeholder"
        :value="modelValue"
        autocomplete="off"
        class="h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm text-ink-primary outline-none transition placeholder:text-zinc-400 focus:border-primary focus:ring-4 focus:ring-primary/10"
        @input="onInput"
      />
    </label>

    <ul
      v-if="suggestions.length > 0"
      role="listbox"
      :data-testid="`${testid}-suggestions`"
      class="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-2xl border border-zinc-200 bg-white py-1 shadow-xl"
    >
      <li v-for="customer in suggestions" :key="customer.id">
        <button
          type="button"
          role="option"
          :data-testid="`${testid}-option-${customer.id}`"
          class="flex min-h-12 w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left transition hover:bg-zinc-50 active:bg-primary/10"
          @mousedown.prevent
          @click="selectCustomer(customer)"
        >
          <span class="text-sm font-semibold text-ink-primary">{{ customer.name }}</span>
          <span v-if="customer.phone" class="text-xs text-ink-secondary">{{ customer.phone }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>
