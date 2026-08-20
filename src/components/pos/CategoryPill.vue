<script setup>
const props = defineProps({
  label: {
    type: String,
    required: true,
  },
  active: {
    type: Boolean,
    default: false,
  },
})
</script>

<template>
  <button
    class="rounded-full border px-4 py-2.5 text-sm font-medium transition"
    :class="
      props.active
        ? 'border-primary bg-primary text-white shadow-[0_10px_22px_rgba(73,69,214,0.22)]'
        : 'border-zinc-200 bg-white text-ink-secondary hover:border-primary/40 hover:text-primary'
    "
  >
    {{ label }}
  </button>
</template>
