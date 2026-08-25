import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef7ff',
          100: '#d9edff',
          500: '#0e7490',
          600: '#0c5f77',
          700: '#0a4f63',
          900: '#083344',
        },
      },
    },
  },
  plugins: [],
};

export default config;
