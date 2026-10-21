<script setup>
import { computed, ref } from 'vue'

import { isPaidTransaction, useTransactionStore } from '@/stores/transactionStore'
import { formatCurrency } from '@/utils/formatters'

const transactionStore = useTransactionStore()

const activePeriod = ref('7d') // '7d' | '30d'
const activePointIndex = ref(null)

const DAY_NAMES = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']

function formatShortDate(date) {
  const d = date.getDate()
  const m = date.getMonth() + 1
  return `${d}/${m}`
}

const chartData = computed(() => {
  const days = activePeriod.value === '7d' ? 7 : 30
  const result = []
  const today = new Date()
  today.setHours(23, 59, 59, 999)

  // Map of transactions by YYYY-MM-DD
  const salesByDate = new Map()
  const paidList = (transactionStore.items || []).filter(isPaidTransaction)

  for (const t of paidList) {
    const raw = t.paidAt || t.createdAt
    if (!raw) continue
    const dateObj = new Date(raw)
    const key = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`
    const cur = salesByDate.get(key) || 0
    salesByDate.set(key, cur + Number(t.total || 0))
  }

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const amount = salesByDate.get(key) || 0
    const dayName = DAY_NAMES[d.getDay()]
    const shortDate = formatShortDate(d)

    result.push({
      dateKey: key,
      label: days === 7 ? dayName : shortDate,
      fullDateLabel: `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'][d.getMonth()]}`,
      amount,
    })
  }

  return result
})

const totalPeriodRevenue = computed(() => {
  return chartData.value.reduce((sum, item) => sum + item.amount, 0)
})

const averageDailyRevenue = computed(() => {
  if (chartData.value.length === 0) return 0
  return Math.round(totalPeriodRevenue.value / chartData.value.length)
})

// SVG Coordinates
const SVG_WIDTH = 320
const SVG_HEIGHT = 120
const PADDING_TOP = 15
const PADDING_BOTTOM = 25
const PADDING_LEFT = 20
const PADDING_RIGHT = 20

const plotWidth = SVG_WIDTH - PADDING_LEFT - PADDING_RIGHT
const plotHeight = SVG_HEIGHT - PADDING_TOP - PADDING_BOTTOM

const maxAmount = computed(() => {
  const max = Math.max(...chartData.value.map((d) => d.amount), 0)
  return max > 0 ? max * 1.15 : 100000 // headroom
})

const points = computed(() => {
  const data = chartData.value
  const len = data.length
  if (len === 0) return []

  const stepX = len > 1 ? plotWidth / (len - 1) : plotWidth / 2

  return data.map((d, index) => {
    const x = PADDING_LEFT + index * stepX
    const normalizedY = d.amount / maxAmount.value
    const y = PADDING_TOP + plotHeight * (1 - Math.min(Math.max(normalizedY, 0), 1))
    return {
      x,
      y,
      ...d,
      index,
    }
  })
})

const linePath = computed(() => {
  const pts = points.value
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`

  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i]
    const p1 = pts[i + 1]
    const cx = (p0.x + p1.x) / 2
    d += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`
  }
  return d
})

const areaPath = computed(() => {
  const pts = points.value
  if (pts.length === 0) return ''
  const baseLine = PADDING_TOP + plotHeight
  const first = pts[0]
  const last = pts[pts.length - 1]

  return `${linePath.value} L ${last.x} ${baseLine} L ${first.x} ${baseLine} Z`
})

const selectedPoint = computed(() => {
  if (activePointIndex.value === null) {
    // Default to today (last point)
    return points.value[points.value.length - 1] || null
  }
  return points.value[activePointIndex.value] || null
})

const svgRef = ref(null)

function handlePointTap(index) {
  activePointIndex.value = index
}

function handleChartTouch(event) {
  if (!svgRef.value || points.value.length === 0) return
  const touch = event.touches ? event.touches[0] : event
  if (!touch) return
  const rect = svgRef.value.getBoundingClientRect()
  if (!rect.width) return
  const relativeX = ((touch.clientX - rect.left) / rect.width) * SVG_WIDTH

  let nearestIdx = 0
  let minDist = Infinity
  for (let i = 0; i < points.value.length; i++) {
    const dist = Math.abs(points.value[i].x - relativeX)
    if (dist < minDist) {
      minDist = dist
      nearestIdx = i
    }
  }
  activePointIndex.value = nearestIdx
}
</script>

<template>
  <div
    class="rounded-3xl border border-zinc-200/80 bg-white p-5 shadow-soft space-y-3.5"
    data-testid="home-sales-chart"
  >
    <!-- Header: Title & Period Switcher -->
    <div class="flex items-center justify-between gap-2">
      <div>
        <h3 class="text-base font-bold text-ink-primary">Grafik Penjualan</h3>
        <p class="text-xs text-ink-secondary">Tren pendapatan usaha</p>
      </div>

      <!-- Period Tabs -->
      <div class="flex items-center rounded-full bg-zinc-100 p-0.5 text-xs font-medium shrink-0">
        <button
          type="button"
          data-testid="chart-period-7d"
          class="rounded-full px-2.5 py-1 transition whitespace-nowrap"
          :class="
            activePeriod === '7d'
              ? 'bg-white text-primary shadow-xs font-semibold'
              : 'text-zinc-500 hover:text-ink-primary'
          "
          @click="activePeriod = '7d'; activePointIndex = null"
        >
          7 Hari
        </button>
        <button
          type="button"
          data-testid="chart-period-30d"
          class="rounded-full px-2.5 py-1 transition whitespace-nowrap"
          :class="
            activePeriod === '30d'
              ? 'bg-white text-primary shadow-xs font-semibold'
              : 'text-zinc-500 hover:text-ink-primary'
          "
          @click="activePeriod = '30d'; activePointIndex = null"
        >
          30 Hari
        </button>
      </div>
    </div>

    <!-- Active Tooltip / Value Highlight -->
    <div class="flex items-baseline justify-between border-t border-zinc-100 pt-3 gap-2">
      <div class="min-w-0">
        <p class="text-xs text-ink-secondary" data-testid="chart-selected-date">
          {{ selectedPoint ? selectedPoint.fullDateLabel : 'Hari Ini' }}
        </p>
        <p class="font-mono text-xl font-bold text-primary sm:text-2xl truncate" data-testid="chart-selected-amount">
          {{ selectedPoint ? formatCurrency(selectedPoint.amount) : 'Rp 0' }}
        </p>
      </div>

      <div class="text-right text-[11px] text-ink-secondary space-y-0.5 shrink-0">
        <p>Total: <span class="font-semibold text-ink-primary" data-testid="chart-total-amount">{{ formatCurrency(totalPeriodRevenue) }}</span></p>
        <p class="text-[10px] text-zinc-400">Rata-rata: {{ formatCurrency(averageDailyRevenue) }}/hari</p>
      </div>
    </div>

    <!-- Responsive SVG Chart -->
    <div class="relative w-full overflow-hidden select-none">
      <svg
        ref="svgRef"
        class="w-full h-36 cursor-pointer"
        viewBox="0 0 320 120"
        preserveAspectRatio="none"
        @touchstart.passive="handleChartTouch"
        @click="handleChartTouch"
      >
        <defs>
          <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#4945D6" stop-opacity="0.28" />
            <stop offset="100%" stop-color="#4945D6" stop-opacity="0.0" />
          </linearGradient>
        </defs>

        <!-- Subtle Horizontal Gridlines -->
        <line
          x1="10"
          :y1="PADDING_TOP"
          x2="310"
          :y2="PADDING_TOP"
          stroke="#f4f4f5"
          stroke-width="1"
          stroke-dasharray="3,3"
        />
        <line
          x1="10"
          :y1="PADDING_TOP + plotHeight / 2"
          x2="310"
          :y2="PADDING_TOP + plotHeight / 2"
          stroke="#f4f4f5"
          stroke-width="1"
          stroke-dasharray="3,3"
        />
        <line
          x1="10"
          :y1="PADDING_TOP + plotHeight"
          x2="310"
          :y2="PADDING_TOP + plotHeight"
          stroke="#e4e4e7"
          stroke-width="1"
        />

        <!-- Area Fill -->
        <path
          v-if="areaPath"
          :d="areaPath"
          fill="url(#salesGradient)"
        />

        <!-- Smooth Curve Line -->
        <path
          v-if="linePath"
          :d="linePath"
          fill="none"
          stroke="#4945D6"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />

        <!-- Interactive Data Circles -->
        <g v-for="(p, idx) in points" :key="p.dateKey">
          <!-- Active point vertical guide line -->
          <line
            v-if="selectedPoint && selectedPoint.index === idx"
            :x1="p.x"
            :y1="PADDING_TOP"
            :x2="p.x"
            :y2="PADDING_TOP + plotHeight"
            stroke="#4945D6"
            stroke-width="1"
            stroke-dasharray="2,2"
            opacity="0.6"
          />

          <!-- Invisible large touch target -->
          <circle
            :cx="p.x"
            :cy="p.y"
            r="16"
            fill="transparent"
            pointer-events="all"
            class="cursor-pointer"
            :data-testid="'chart-point-' + idx"
            @click.stop="handlePointTap(idx)"
          />

          <!-- Visible point circle -->
          <circle
            :cx="p.x"
            :cy="p.y"
            :r="selectedPoint && selectedPoint.index === idx ? 5 : 3"
            :fill="selectedPoint && selectedPoint.index === idx ? '#4945D6' : '#ffffff'"
            stroke="#4945D6"
            :stroke-width="selectedPoint && selectedPoint.index === idx ? 2.5 : 1.5"
            class="transition-all duration-150 pointer-events-none"
          />
        </g>
      </svg>

      <!-- X-Axis Labels -->
      <div
        class="flex justify-between px-2 pt-1 text-[10px] font-medium text-zinc-400 select-none"
      >
        <span
          v-for="(p, idx) in points.filter((_, i) => activePeriod === '7d' || i % 5 === 0 || i === points.length - 1)"
          :key="`lbl-${p.dateKey}-${idx}`"
          class="transition"
          :class="selectedPoint && selectedPoint.index === p.index ? 'font-bold text-primary' : ''"
        >
          {{ p.label }}
        </span>
      </div>
    </div>
  </div>
</template>
