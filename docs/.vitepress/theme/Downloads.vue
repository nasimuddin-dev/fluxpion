<script setup lang="ts">
import { computed } from 'vue';
import { withBase } from 'vitepress';
import { data as release } from '../../data/release.data';

/** Which platforms to show; all by default. */
const props = defineProps<{ only?: 'windows' | 'macos' | 'linux' }>();
const platforms = computed(() =>
  [
    { id: 'windows', name: 'Windows', req: 'Windows 10 or 11, 64-bit', items: release.windows, guide: '/installation/windows' },
    { id: 'macos', name: 'macOS', req: 'macOS 12 Monterey or later, Apple Silicon or Intel', items: release.macos, guide: '/installation/macos' },
    { id: 'linux', name: 'Linux', req: '64-bit (x86_64) distributions from 2020 or later', items: release.linux, guide: '/installation/linux' },
  ].filter((p) => !props.only || p.id === props.only),
);
</script>

<template>
  <div class="aps-downloads">
    <section v-for="p in platforms" :key="p.id" class="aps-platform" :aria-labelledby="`dl-${p.id}`">
      <h3 :id="`dl-${p.id}`">{{ p.name }}</h3>
      <p class="aps-req">{{ p.req }}</p>
      <ul>
        <li v-for="i in p.items" :key="i.file">
          <a :href="i.url" class="aps-dl">
            <span class="aps-dl-label">{{ i.label }}</span>
            <span class="aps-dl-file">{{ i.file }}</span>
          </a>
          <span class="aps-dl-note">{{ i.note }}</span>
        </li>
      </ul>
      <p class="aps-guide"><a :href="withBase(p.guide)">{{ p.name }} installation guide →</a></p>
    </section>
  </div>
</template>

<style scoped>
.aps-downloads { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); margin: 16px 0; }
.aps-platform { border: 1px solid var(--vp-c-divider); border-radius: 12px; padding: 16px 18px; background: var(--vp-c-bg-soft); }
.aps-platform h3 { margin: 0 0 4px; padding: 0; border: 0; }
.aps-req { margin: 0 0 12px; font-size: 14px; color: var(--vp-c-text-2); }
.aps-platform ul { list-style: none; padding: 0; margin: 0; }
.aps-platform li { margin: 0 0 12px; }
.aps-dl { display: block; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--vp-c-brand-2); text-decoration: none !important; }
.aps-dl:hover, .aps-dl:focus-visible { background: var(--vp-c-brand-soft); }
.aps-dl-label { display: block; font-weight: 600; }
.aps-dl-file { display: block; font-family: var(--vp-font-family-mono); font-size: 12px; color: var(--vp-c-text-2); overflow-wrap: anywhere; }
.aps-dl-note { display: block; font-size: 13px; color: var(--vp-c-text-2); margin-top: 4px; }
.aps-guide { margin: 4px 0 0; font-size: 14px; }
</style>
