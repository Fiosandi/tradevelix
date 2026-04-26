/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#1a1a2e',
        secondary: '#16213e',
        accent: '#0f3460',
        success: '#00C853',
        danger: '#FF1744',
        warning: '#FFD600',
        info: '#2196F3',
        whale: '#7C4DFF',
        retail: '#FF9100',
      }
    },
  },
  plugins: [],
}
