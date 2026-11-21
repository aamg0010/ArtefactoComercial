import type { Config } from 'tailwindcss';

// Identidad try! company, alineada con trygestión (tailwind.config.js de trygestión, 21/11/2026)
// y con el logo: violeta #434AEA y lima #B5FF7B.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  // Clases construidas dinámicamente (prioridad A/B/C).
  safelist: ['badge-a', 'badge-b', 'badge-c'],
  theme: {
    extend: {
      colors: {
        try: {
          50: '#eef0ff', 100: '#e0e4ff', 200: '#c7cdff', 300: '#a5abff', 400: '#8183ff',
          500: '#5858f4', // color principal de trygestión
          600: '#4f3fe8', 700: '#4431cc', 800: '#382ba5', 900: '#312982', 950: '#1e184c',
          logo: '#434aea', // violeta exacto del logo
        },
        lima: { 100: '#effee0', 200: '#dcffbd', 300: '#c8ff9b', 400: '#b5ff7b', 500: '#9be85c', 700: '#4d7a1f', 800: '#3b5e17' },
        light: { bg: '#f8f9fa', card: '#ffffff', text: '#1f2937', muted: '#6b7280', border: '#e5e7eb' },
      },
      fontFamily: {
        sans: ['var(--font-display)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
      },
      boxShadow: { card: '0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)' },
    },
  },
  plugins: [],
};
export default config;
