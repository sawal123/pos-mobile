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
import CategoriesView from '../views/categories/CategoriesView.vue'
import CustomerFormView from '../views/customers/CustomerFormView.vue'
import CustomersView from '../views/customers/CustomersView.vue'
import ExpenseFormView from '../views/expenses/ExpenseFormView.vue'
import ExpensesView from '../views/expenses/ExpensesView.vue'
import CashView from '../views/cash/CashView.vue'
import HomeView from '../views/home/HomeView.vue'
import ProductFormView from '../views/products/ProductFormView.vue'
import ProductsView from '../views/products/ProductsView.vue'
import ReportsView from '../views/reports/ReportsView.vue'
import CloseShiftView from '../views/shift/CloseShiftView.vue'
import OpenShiftView from '../views/shift/OpenShiftView.vue'
import ShiftView from '../views/shift/ShiftView.vue'
import SettingsView from '../views/settings/SettingsView.vue'
import StockView from '../views/stock/StockView.vue'
import CloudLoginView from '../views/settings/CloudLoginView.vue'
import ReceiptView from '../views/transactions/ReceiptView.vue'
import TransactionDetailView from '../views/transactions/TransactionDetailView.vue'
import TransactionsView from '../views/transactions/TransactionsView.vue'
import LaundryOrdersView from '../views/laundry/LaundryOrdersView.vue'
import LaundryOrderCreateView from '../views/laundry/LaundryOrderCreateView.vue'
import LaundryOrderDetailView from '../views/laundry/LaundryOrderDetailView.vue'

export function resolveStartupRoute({ businessStore, cashierStore, shiftStore }) {
  if (!businessStore.isSetup) {
    return { name: 'splash' }
  }

  if (!cashierStore.activeCashier.pinConfigured) {
    return { name: 'pin-setup' }
  }

  if (!shiftStore.isOpen) {
    return { name: 'open-shift' }
  }

  return { name: 'home' }
}

const routes = [
  {
    path: '/',
    name: 'root',
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
        path: 'home',
        name: 'home',
        component: HomeView,
      },
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
        path: 'products',
        name: 'products',
        component: ProductsView,
      },
      {
        path: 'stock',
        name: 'stock',
        component: StockView,
      },
      {
        path: 'products/create',
        name: 'product-create',
        component: ProductFormView,
      },
      {
        path: 'products/:id/edit',
        name: 'product-edit',
        component: ProductFormView,
      },
      {
        path: 'categories',
        name: 'categories',
        component: CategoriesView,
      },
      {
        path: 'customers',
        name: 'customers',
        component: CustomersView,
      },
      {
        path: 'customers/create',
        name: 'customer-create',
        component: CustomerFormView,
      },
      {
        path: 'customers/:id/edit',
        name: 'customer-edit',
        component: CustomerFormView,
      },
      {
        path: 'expenses',
        name: 'expenses',
        component: ExpensesView,
      },
      {
        path: 'expenses/create',
        name: 'expense-create',
        component: ExpenseFormView,
      },
      {
        path: 'expenses/:id/edit',
        name: 'expense-edit',
        component: ExpenseFormView,
      },
      {
        path: 'cash',
        name: 'cash',
        component: CashView,
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
        path: 'transactions/:id/receipt',
        name: 'transaction-receipt',
        component: ReceiptView,
      },
      {
        path: 'reports',
        name: 'reports',
        component: ReportsView,
      },
      {
        path: 'settings',
        name: 'settings',
        component: SettingsView,
      },
      {
        path: 'cloud',
        name: 'cloud',
        component: CloudLoginView,
      },
      {
        path: 'laundry/orders',
        name: 'laundry-orders',
        component: LaundryOrdersView,
      },
      {
        path: 'laundry/orders/create',
        name: 'laundry-order-create',
        component: LaundryOrderCreateView,
      },
      {
        path: 'laundry/orders/:id',
        name: 'laundry-order-detail',
        component: LaundryOrderDetailView,
      },
    ],
  },
]

const businessRequiredRoutes = new Set([
  'pin-setup',
  'home',
  'open-shift',
  'shift',
  'close-shift',
  'pos',
  'laundry-orders',
  'laundry-order-create',
  'laundry-order-detail',
  'products',
  'stock',
  'product-create',
  'product-edit',
  'categories',
  'customers',
  'customer-create',
  'customer-edit',
  'expenses',
  'expense-create',
  'expense-edit',
  'cash',
  'payment',
  'payment-success',
  'transactions',
  'transaction-detail',
  'transaction-receipt',
  'reports',
  'settings',
])

const pinRequiredRoutes = new Set([
  'open-shift',
  'home',
  'shift',
  'close-shift',
  'pos',
  'laundry-orders',
  'laundry-order-create',
  'laundry-order-detail',
  'products',
  'stock',
  'product-create',
  'product-edit',
  'categories',
  'customers',
  'customer-create',
  'customer-edit',
  'expenses',
  'expense-create',
  'expense-edit',
  'cash',
  'payment',
  'payment-success',
  'transactions',
  'transaction-detail',
  'transaction-receipt',
  'reports',
  'settings',
])

const shiftRequiredRoutes = new Set([
  'home',
  'shift',
  'close-shift',
  'pos',
  'laundry-orders',
  'laundry-order-create',
  'laundry-order-detail',
  'cash',
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

    if (to.name === 'root') {
      return resolveStartupRoute({ businessStore, cashierStore, shiftStore })
    }

    if (!businessStore.isSetup && businessRequiredRoutes.has(to.name)) {
      return { name: 'business-setup' }
    }

    if (!cashierStore.activeCashier.pinConfigured && pinRequiredRoutes.has(to.name)) {
      return { name: 'pin-setup' }
    }

    if (!shiftStore.isOpen && shiftRequiredRoutes.has(to.name)) {
      return { name: 'open-shift' }
    }

    if (to.name === 'pos' && businessStore.normalizedType === 'Laundry') {
      return { name: 'laundry-orders' }
    }

    if (
      ['laundry-orders', 'laundry-order-create', 'laundry-order-detail'].includes(to.name)
      && businessStore.normalizedType !== 'Laundry'
    ) {
      return { name: 'pos' }
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
