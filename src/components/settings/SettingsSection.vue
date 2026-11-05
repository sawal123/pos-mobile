<script setup>
import AppIcon from '@/components/base/AppIcon.vue'

defineProps({
  sectionId: { type: String, required: true },
  title: { type: String, required: true },
  summary: { type: String, default: '' },
  icon: { type: String, default: 'settings' },
  open: { type: Boolean, default: false },
})

defineEmits(['toggle'])
</script>

<template>
  <section>
    <h3>
      <button
        :id="`settings-${sectionId}-heading`"
        type="button"
        :data-testid="`settings-section-${sectionId}`"
        :aria-expanded="open"
        :aria-controls="`settings-${sectionId}-panel`"
        class="flex min-h-20 w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-surface/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50 md:px-5"
        @click="$emit('toggle')"
      >
        <span
          class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface text-ink-secondary"
        >
          <AppIcon :name="icon" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold text-ink-primary">{{ title }}</span>
          <span class="mt-1 block truncate text-xs font-normal text-ink-secondary">{{
            summary
          }}</span>
        </span>
        <AppIcon
          name="chevron-right"
          class="size-4 text-ink-secondary transition-transform duration-200 motion-reduce:transition-none"
          :class="{ 'rotate-90': open }"
        />
      </button>
    </h3>
    <div
      v-show="open"
      :id="`settings-${sectionId}-panel`"
      role="region"
      :aria-labelledby="`settings-${sectionId}-heading`"
      class="border-t border-zinc-100 px-4 py-5 dark:border-slate-700/45 md:px-5"
    >
      <slot />
    </div>
  </section>
</template>
