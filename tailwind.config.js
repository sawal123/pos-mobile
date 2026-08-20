/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#4945D6',
          light: '#5B55E7',
          lighter: '#6862EB',
        },
        accent: {
          DEFAULT: '#FF7A00',
        },
        surface: '#F7F7FC',
        card: '#FFFFFF',
        ink: {
          primary: '#18181B',
          secondary: '#71717A',
        },
        success: '#16A34A',
        warning: '#F59E0B',
        danger: '#DC2626',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        soft: '0 2px 10px rgba(0,0,0,0.03)',
        medium: '0 4px 15px rgba(0,0,0,0.05)',
        'bottom-sheet': '0 -4px 20px rgba(0,0,0,0.08)',
      },
    },
  },
  plugins: [],
}
