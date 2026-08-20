import { createRouter, createWebHistory } from 'vue-router'
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

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
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
  ],
})

export default router
