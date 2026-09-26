import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import Downloads from './Downloads.vue';
import './custom.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('Downloads', Downloads);
  },
} satisfies Theme;
