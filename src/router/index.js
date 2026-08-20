import { createRouter, createWebHistory } from 'vue-router'
import { useBusinessStore } from '../stores/businessStore'
import { useCartStore } from '../stores/cartStore'
import { useCashierStore } from '../stores/cashierStore'
import { useShiftStore } from '../stores/shiftStore'
import { useTransactionStore } from '../stores/transactionStore'
import AppLayout from '../layouts/AppLayout.vue'
import BusinessSetupView from '../views/onboarding/BusinessSetupView.vue'
import PinSetupView from '../views/onboarding/PinSetupView.vue'
import SplashView from '../views/onboarding/SplashView.vue'
import WelcomeView from '../views/onboarding/WelcomeView.vue'
import PaymentSuccessView from '../views/payment/PaymentSuccessView.vue'
import PaymentView from '../views/payment/PaymentView.vue'
import PosView from '../views/pos/PosView.vue'
import CloseShiftView from '../views/shift/CloseShiftView.vue'
import OpenShiftView from '../views/shift/OpenShiftView.vue'
import ShiftView from '../views/shift/ShiftView.vue'
import SettingsView from '../views/settings/SettingsView.vue'
import TransactionDetailView from '../views/transactions/TransactionDetailView.vue'
import TransactionsView from '../views/transactions/TransactionsView.vue'

const routes = [
  {
    path: '/',
    redirect: '/splash',
  },
  {
    path: '/splash',
    name: 'splash',
    component: SplashView,
  },
  {
    path: '/welcome',
    name: 'welcome',
    component: WelcomeView,
  },
  {
    path: '/setup/business',
    name: 'business-setup',
    component: BusinessSetupView,
  },
  {
    path: '/setup/pin',
    name: 'pin-setup',
    component: PinSetupView,
  },
  {
    path: '/',
    component: AppLayout,
    children: [
      {
        path: 'shift/open',
        name: 'open-shift',
        component: OpenShiftView,
      },
      {
        path: 'shift',
        name: 'shift',
        component: ShiftView,
      },
      {
        path: 'shift/close',
        name: 'close-shift',
        component: CloseShiftView,
      },
      {
        path: 'pos',
        name: 'pos',
        component: PosView,
      },
      {
        path: 'payment',
        name: 'payment',
        component: PaymentView,
      },
      {
        path: 'payment/success',
        name: 'payment-success',
        component: PaymentSuccessView,
      },
      {
        path: 'transactions',
        name: 'transactions',
        component: TransactionsView,
      },
      {
        path: 'transactions/:id',
        name: 'transaction-detail',
        component: TransactionDetailView,
      },
      {
        path: 'settings',
        name: 'settings',
        component: SettingsView,
      },
    ],
  },
]

const businessRequiredRoutes = new Set([
  'pin-setup',
  'open-shift',
  'shift',
  'close-shift',
  'pos',
  'payment',
  'payment-success',
  'transactions',
  'transaction-detail',
  'settings',
])

const pinRequiredRoutes = new Set([
  'open-shift',
  'shift',
  'close-shift',
  'pos',
  'payment',
  'payment-success',
  'transactions',
  'transaction-detail',
  'settings',
])

const shiftRequiredRoutes = new Set([
  'shift',
  'close-shift',
  'pos',
  'payment',
  'payment-success',
])

export function createAppRouter() {
  const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes,
  })

  router.beforeEach((to) => {
    const businessStore = useBusinessStore()
    const cashierStore = useCashierStore()
    const shiftStore = useShiftStore()
    const cartStore = useCartStore()
    const transactionStore = useTransactionStore()

    if (!businessStore.isSetup && businessRequiredRoutes.has(to.name)) {
      return { name: 'business-setup' }
    }

    if (!cashierStore.activeCashier.pinConfigured && pinRequiredRoutes.has(to.name)) {
      return { name: 'pin-setup' }
    }

    if (!shiftStore.isOpen && shiftRequiredRoutes.has(to.name)) {
      return { name: 'open-shift' }
    }

    if (to.name === 'payment' && !cartStore.items.length) {
      return { name: 'pos' }
    }

    if (to.name === 'payment-success' && !transactionStore.lastTransaction) {
      return { name: 'pos' }
    }

    return true
  })

  return router
}

const router = createAppRouter()

export default router
