// tailwind.config.js

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx}', './index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        accent: '#FAD40B',
      },
      fontFamily: {
        mono: [
          "'JetBrains Mono'",
          "'Fira Code'",
          "'SF Mono'",
          'Menlo',
          'monospace',
        ],
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
