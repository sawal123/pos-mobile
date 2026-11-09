<script setup>
import { computed } from 'vue'
import { APP_VERSION } from '@/constants/appInfo'
import { useThemeStore } from '@/stores/themeStore'

const props = defineProps({
  size: {
    type: String,
    default: 'md', // 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  },
  variant: {
    type: String,
    default: 'auto', // 'auto' | 'blue' | 'white' | 'brand' | 'light'
  },
  withWordmark: {
    type: Boolean,
    default: false,
  },
  showVersion: {
    type: Boolean,
    default: false,
  },
})

const themeStore = useThemeStore()

const resolvedTone = computed(() => {
  if (props.variant === 'white' || props.variant === 'light') {
    return 'white'
  }
  if (props.variant === 'blue' || props.variant === 'brand') {
    return 'blue'
  }
  return themeStore.isDark ? 'white' : 'blue'
})

const isWhiteLogo = computed(() => resolvedTone.value === 'white')
const strokeColor = computed(() => (isWhiteLogo.value ? '#FFFFFF' : '#4945D6'))
const sparkColor = computed(() => (isWhiteLogo.value ? '#FF9E2C' : '#FF7A00'))

const iconSizeClass = computed(() => {
  switch (props.size) {
    case 'xs':
      return 'h-7 w-7'
    case 'sm':
      return 'h-9 w-9'
    case 'lg':
      return 'h-14 w-14'
    case 'xl':
      return 'h-18 w-18'
    default:
      return 'h-11 w-11'
  }
})

const wordmarkSizeClass = computed(() => {
  switch (props.size) {
    case 'xs':
      return 'text-sm'
    case 'sm':
      return 'text-base'
    case 'lg':
      return 'text-2xl'
    case 'xl':
      return 'text-3xl'
    default:
      return 'text-lg'
  }
})
</script>

<template>
  <div
    class="inline-flex items-center gap-2.5 select-none"
    data-testid="nexapos-logo"
    :data-logo-tone="resolvedTone"
  >
    <svg
      :class="iconSizeClass"
      class="shrink-0 transition-colors duration-200"
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect
        x="20"
        y="20"
        width="472"
        height="472"
        rx="112"
        :fill="strokeColor"
        :fill-opacity="isWhiteLogo ? '0.12' : '0.10'"
        :stroke="strokeColor"
        :stroke-opacity="isWhiteLogo ? '0.26' : '0.24'"
        stroke-width="12"
      />

      <line
        x1="341"
        y1="245"
        x2="341"
        y2="343"
        :stroke="strokeColor"
        stroke-opacity="0.92"
        stroke-width="58"
        stroke-linecap="round"
      />
      <line
        x1="171"
        y1="169"
        x2="171"
        y2="343"
        :stroke="strokeColor"
        stroke-width="58"
        stroke-linecap="round"
      />
      <line
        x1="171"
        y1="169"
        x2="341"
        y2="343"
        :stroke="strokeColor"
        stroke-width="58"
        stroke-linecap="round"
      />

      <circle cx="341" cy="169" r="34" :fill="sparkColor" />
      <circle cx="341" cy="169" r="13" fill="#FFFFFF" />
    </svg>

    <div v-if="withWordmark" class="flex items-center gap-2 leading-none">
      <span
        :class="[
          wordmarkSizeClass,
          isWhiteLogo ? 'text-white' : 'text-[#3632B8]',
        ]"
        class="font-extrabold tracking-tight transition-colors duration-200"
      >
        Net<span :class="isWhiteLogo ? 'text-white/95' : 'text-[#4945D6]'">Kasir</span>
      </span>

      <span
        v-if="showVersion"
        class="rounded-full px-2 py-0.5 font-mono text-[10px] font-bold tracking-wide transition-colors duration-200"
        :class="
          isWhiteLogo
            ? 'border border-white/25 bg-white/12 text-white'
            : 'border border-[#4945D6]/25 bg-[#4945D6]/10 text-[#4945D6]'
        "
      >
        v{{ APP_VERSION }}
      </span>
    </div>
  </div>
</template>
