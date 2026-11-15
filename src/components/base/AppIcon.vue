<script setup>
import { computed } from 'vue'

const props = defineProps({
  name: {
    type: String,
    required: true,
  },
})

const icons = {
  scan: ['M4 8V4h4', 'M16 4h4v4', 'M20 16v4h-4', 'M8 20H4v-4', 'M7 9v6', 'M10 8v8', 'M13 9v6', 'M16 8v8'],
  qr: ['M3 3h6v6H3Z', 'M15 3h6v6h-6Z', 'M3 15h6v6H3Z', 'M15 15h2v2h-2Z', 'M19 15h2v6h-6v-2'],
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
  variants: [
    'M4 21v-7',
    'M4 10V3',
    'M12 21v-9',
    'M12 8V3',
    'M20 21v-5',
    'M20 12V3',
    'M2 14h4',
    'M10 8h4',
    'M18 16h4',
  ],
  promo: [
    'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z',
    'M7 7h.01',
  ],
  crown: [
    'M4 8l4 4 4-7 4 7 4-4-2 11H6L4 8Z',
    'M6 20h12',
  ],
  cloud: [
    'M7 18a4 4 0 0 1 0-8 5.5 5.5 0 0 1 10.6 1.6A3.5 3.5 0 0 1 17 18H7Z',
  ],
  sync: [
    'M20 11a8 8 0 0 0-14.1-5',
    'M4 5v5h5',
    'M4 13a8 8 0 0 0 14.1 5',
    'M20 19v-5h-5',
  ],
  upload: [
    'M12 16V4',
    'm7 9 5-5 5 5',
    'M5 20h14',
  ],
  download: [
    'M12 4v12',
    'm7 11 5 5 5-5',
    'M5 20h14',
  ],
  excel: [
    'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z',
    'M14 2v6h6',
    'M8 13h8',
    'M8 17h8',
    'M12 11v8',
  ],
  pdf: [
    'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z',
    'M14 2v6h6',
    'M9 13h6',
    'M9 17h4',
  ],
  refresh: [
    'M20 11a8 8 0 0 0-14.1-5',
    'M4 5v5h5',
    'M4 13a8 8 0 0 0 14.1 5',
    'M20 19v-5h-5',
  ],
  shield: [
    'M12 3 19 6v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z',
    'm9 12 2 2 4-4',
  ],
  trash: [
    'M4 7h16',
    'M9 7V4h6v3',
    'M6 7l1 13h10l1-13',
    'M10 11v5',
    'M14 11v5',
  ],
  backup: [
    'M12 4v10',
    'M8 10l4 4 4-4',
    'M4 19h16',
  ],
  restore: [
    'M12 20V10',
    'M8 14l4-4 4 4',
    'M4 5h16',
  ],
  lock: [
    'M6 11h12v9H6v-9Z',
    'M9 11V8a3 3 0 0 1 6 0v3',
  ],
  'chevron-left': [
    'M15 5l-7 7 7 7',
  ],
  'chevron-right': [
    'M9 5l7 7-7 7',
  ],
  store: [
    'M4 9h16v11H4V9Z',
    'M4 9l1.5-5h13L20 9',
    'M9 20v-6h6v6',
  ],
  sun: [
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
    'M12 2v2',
    'M12 20v2',
    'M4.93 4.93l1.41 1.41',
    'M17.66 17.66l1.41 1.41',
    'M2 12h2',
    'M20 12h2',
    'M6.34 17.66l-1.41 1.41',
    'M19.07 4.93l-1.41 1.41',
  ],
  moon: [
    'M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79Z',
  ],
  package: [
    'M21 8.5 12 3 3 8.5v7L12 21l9-5.5v-7Z',
    'M3 8.5 12 14l9-5.5',
    'M12 14v7',
  ],
  edit: [
    'M12 20h9',
    'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z',
  ],
  delete: [
    'M4 7h16',
    'M9 7V4h6v3',
    'M6 7l1 13h10l1-13',
    'M10 11v5',
    'M14 11v5',
  ],
  'arrow-left': [
    'M19 12H5',
    'm12 19-7-7 7-7',
  ],
  'chevron-down': [
    'M5 9l7 7 7-7',
  ],
  check: [
    'm4 12 5 5L20 6',
  ],
  x: [
    'M6 6l12 12',
    'M18 6 6 18',
  ],
  eye: [
    'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z',
    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  ],
  'eye-off': [
    'M3 3l18 18',
    'M10.6 6.2A9.7 9.7 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-2.8 3.3',
    'M6.6 8.1A16.6 16.6 0 0 0 2 12s3.5 6 10 6a9.8 9.8 0 0 0 3.9-.8',
    'M9.9 9.9a3 3 0 0 0 4.2 4.2',
  ],
  info: [
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
    'M12 11v5',
    'M12 8h.01',
  ],
  'alert-triangle': [
    'M10.3 4.3 2.6 17.5A1.9 1.9 0 0 0 4.3 20.5h15.4a1.9 1.9 0 0 0 1.7-3L13.7 4.3a1.9 1.9 0 0 0-3.4 0Z',
    'M12 9v4',
    'M12 17h.01',
  ],
  mail: [
    'M3 6h18v12H3V6Z',
    'm3 7 9 6 9-6',
  ],
  user: [
    'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    'M4 21a8 8 0 0 1 16 0',
  ],
  printer: [
    'M7 9V3h10v6',
    'M5 9h14v7h-3v5H8v-5H5V9Z',
    'M8 13h8',
  ],
  wifi: [
    'M2 8.8a16 16 0 0 1 20 0',
    'M5 12.5a11 11 0 0 1 14 0',
    'M8.5 16.2a6 6 0 0 1 7 0',
    'M12 20h.01',
  ],
  battery: [
    'M3 8h15v8H3V8Z',
    'M21 11v2',
    'M6 11v2',
  ],
  smartphone: [
    'M7 2h10v20H7V2Z',
    'M11 18h2',
  ],
  monitor: [
    'M3 4h18v12H3V4Z',
    'M8 20h8',
    'M12 16v4',
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
