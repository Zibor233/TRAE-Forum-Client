/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 语义色板：全部走 CSS 变量，浅/深两套值在 src/index.css 中定义
        // rgb(var(--x) / <alpha-value>) 保证 text-ink/70、border-line/60 等透明度修饰可用
        ink: 'rgb(var(--ink) / <alpha-value>)',
        sub: 'rgb(var(--sub) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        paper: 'rgb(var(--paper) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-fill': 'rgb(var(--accent-fill) / <alpha-value>)',
        info: 'rgb(var(--info) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        soft: 'rgb(var(--soft) / <alpha-value>)',
        btn: 'rgb(var(--btn) / <alpha-value>)',
        // 带 alpha 的颜色直接引用成品色值，不再叠加透明度修饰
        unread: 'var(--unread)',
        'unread-soft': 'var(--unread-soft)',
        'unread-bar': 'var(--unread-bar)',
        'bubble-mine': 'var(--bubble-mine)',
        'bubble-other': 'var(--bubble-other)',
        'warn-soft': 'var(--warn-soft)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        'danger-soft': 'var(--danger-soft)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        'ok-soft': 'var(--ok-soft)',
        ok: 'rgb(var(--ok) / <alpha-value>)',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          'system-ui',
          'sans-serif',
        ],
        mono: ['"SFMono-Regular"', 'Consolas', '"Liberation Mono"', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,.04), 0 6px 20px rgba(16,24,40,.06)',
        float: '0 8px 30px rgba(16,24,40,.12)',
      },
    },
  },
  plugins: [],
}
