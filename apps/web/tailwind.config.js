/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          navy: '#102f43',
          deep: '#0c2535',
          mist: '#d8dee8',
          pale: '#edf3f7',
          gold: '#d9a234',
        },
      },
      boxShadow: {
        soft: '0 24px 70px rgba(16, 47, 67, 0.14)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
    },
  },
  plugins: [],
};
