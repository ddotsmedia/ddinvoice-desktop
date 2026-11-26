/** Neutral surfaces, navy text, cobalt primary, compact density (14px body). */
module.exports = {
  content: [
    './src/renderer/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: '#1b2a4a', muted: '#4a5873' },
        cobalt: { DEFAULT: '#1f4fd8', hover: '#1a43b8', soft: '#e7edfc' },
        surface: { DEFAULT: '#ffffff', muted: '#f5f6f8', line: '#dfe3ea' },
      },
      fontFamily: {
        sans: ['Inter', '"Noto Sans Arabic"', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        body: ['14px', '20px'],
      },
    },
  },
  plugins: [],
};
