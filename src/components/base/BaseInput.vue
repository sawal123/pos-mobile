<script setup>
defineProps({
  label: {
    type: String,
    default: '',
  },
  modelValue: {
    type: [String, Number],
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
  hint: {
    type: String,
    default: '',
  },
  disabled: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <label class="flex w-full flex-col gap-2">
    <span v-if="label" class="text-sm font-medium text-ink-secondary">
      {{ label }}
    </span>

    <input
      :type="type"
      :placeholder="placeholder"
      :value="modelValue"
      :disabled="disabled"
      class="h-12 rounded-2xl border border-zinc-200 bg-white px-4 text-sm text-ink-primary outline-none transition placeholder:text-zinc-400 focus:border-primary focus:ring-4 focus:ring-primary/10"
      @input="emit('update:modelValue', $event.target.value)"
    />

    <span v-if="hint" class="text-xs text-ink-secondary">
      {{ hint }}
    </span>
  </label>
</template>
