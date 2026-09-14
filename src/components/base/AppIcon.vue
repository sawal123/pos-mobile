<script setup>
import { computed } from 'vue'

const props = defineProps({
  name: {
    type: String,
    required: true,
  },
})

const icons = {
  home: [
    'M3 10.5 12 3l9 7.5',
    'M5 9.5V21h14V9.5',
    'M9 21v-6h6v6',
  ],
  pos: [
    'M7 8h14l-2 8H8L6 4H3',
    'M9 20h.01',
    'M17 20h.01',
  ],
  transactions: [
    'M6 3h12v18l-3-2-3 2-3-2-3 2V3Z',
    'M9 8h6',
    'M9 12h6',
    'M9 16h4',
  ],
  cash: [
    'M4 7h16v10H4V7Z',
    'M8 7V5h8v2',
    'M8 17v2h8v-2',
    'M12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z',
  ],
  more: [
    'M5 12h.01',
    'M12 12h.01',
    'M19 12h.01',
  ],
  products: [
    'M4 7l8-4 8 4v10l-8 4-8-4V7Z',
    'M4 7l8 4 8-4',
    'M12 11v10',
  ],
  stock: [
    'M4 6h16v4H4V6Z',
    'M4 14h16v4H4v-4Z',
    'M8 10v4',
    'M16 10v4',
  ],
  customers: [
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    'M3 21a6 6 0 0 1 12 0',
    'M17 8a3 3 0 1 0 0-6',
    'M15 15a5 5 0 0 1 6 5',
  ],
  expenses: [
    'M12 3v18',
    'M17 7H9.5a2.5 2.5 0 0 0 0 5H14a2.5 2.5 0 0 1 0 5H6',
  ],
  shift: [
    'M12 6v6l4 2',
    'M21 12a9 9 0 1 1-2.64-6.36',
    'M21 3v6h-6',
  ],
  reports: [
    'M4 19V5',
    'M4 19h16',
    'M8 16v-5',
    'M12 16V8',
    'M16 16v-8',
  ],
  settings: [
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
    'M4 12h2',
    'M18 12h2',
    'M12 4v2',
    'M12 18v2',
    'M6.34 6.34l1.42 1.42',
    'M16.24 16.24l1.42 1.42',
    'M17.66 6.34l-1.42 1.42',
    'M7.76 16.24l-1.42 1.42',
  ],
  categories: [
    'M4 6h7v7H4V6Z',
    'M13 6h7v7h-7V6Z',
    'M4 15h7v3H4v-3Z',
    'M13 15h7v3h-7v-3Z',
  ],
}

const iconPaths = computed(() => icons[props.name] ?? icons.more)
</script>

<template>
  <svg
    aria-hidden="true"
    class="h-5 w-5 shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path v-for="path in iconPaths" :key="path" :d="path" />
  </svg>
</template>
