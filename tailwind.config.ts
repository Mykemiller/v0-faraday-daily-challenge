import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        forest: '#1C3424',
        forestMid: '#244228',
        forestLight: '#325638',
        gold: '#C4922A',
        goldLight: '#DAB050',
        warmWhite: '#F8F5F0',
        warmCream: '#EEE6DA',
        nearBlack: '#141210',
        textInverse: '#F8F5F0',
        sage: '#8CA68A',
        amber: '#B8710A',
        warmGray: '#B2A898',
      },
      fontFamily: {
        serif: ['Georgia', 'serif'],
        mono: ['JetBrains Mono', 'monospace'],
        sans: ['Inter', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 20px rgba(196, 146, 42, 0.3)',
        'glow-lg': '0 0 30px rgba(196, 146, 42, 0.4)',
      },
      spacing: {
        'double-rule': '12px',
      },
    },
  },
  plugins: [],
}
export default config
