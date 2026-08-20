import { defineStore } from 'pinia'

import { products } from '@/data/products'

export const useProductStore = defineStore('product', {
  state: () => ({
    products,
    categories: ['Semua', 'Minuman', 'Makanan', 'Snack', 'Dessert', 'Lainnya'],
    selectedCategory: 'Semua',
    searchQuery: '',
  }),
  getters: {
    filteredProducts() {
      let list = this.products

      if (this.selectedCategory !== 'Semua') {
        list = list.filter((product) => product.category === this.selectedCategory)
      }

      if (this.searchQuery) {
        const query = this.searchQuery.toLowerCase()
        list = list.filter((product) => product.name.toLowerCase().includes(query))
      }

      return list
    },
  },
  actions: {
    selectCategory(category) {
      this.selectedCategory = category
    },
    setSearchQuery(query) {
      this.searchQuery = query
    },
  },
})
