<template>
  <figure class="group grid gap-2">
    <Checker class="relative aspect-[4/3] overflow-hidden rounded-sm">
      <img :src="asset.previewUrl" :alt="asset.originalName" class="h-full w-full object-contain p-2" loading="lazy" />
      <span v-if="asset.source === 'url'" class="absolute left-2 top-2 rounded-sm bg-ink/80 px-1.5 py-0.5 text-[11px] text-paper">{{ viewportLabel }}<template v-if="asset.meta.autoRefresh && asset.meta.autoRefresh !== 'off'"> · live</template></span>
    </Checker>
    <figcaption class="grid gap-0.5">
      <span class="truncate text-sm font-medium" :title="asset.originalName">{{ asset.originalName }}</span>
      <span class="truncate text-xs text-graphite">{{ typeLabel }}, {{ asset.width }} × {{ asset.height }} px<template v-if="asset.projectName">, {{ asset.projectName }}</template></span>
    </figcaption>
    <div v-if="$slots.default" class="flex items-center gap-1"><slot /></div>
  </figure>
</template>

<script setup lang="ts">
import type { AssetView } from '~/utils/types';
const props = defineProps<{ asset: AssetView }>();
const TYPES: Record<string, string> = { 'image/png': 'PNG', 'image/jpeg': 'JPG', 'image/webp': 'WebP', 'image/svg+xml': 'SVG', 'application/pdf': 'PDF' };
const typeLabel = computed(() => (props.asset.source === 'url' ? 'Website' : TYPES[props.asset.mime] ?? props.asset.mime));
const viewportLabel = computed(() => ({ desktop: 'Desktop', laptop: 'Laptop', tablet: 'Tablet', smartphone: 'Smartphone' })[String(props.asset.meta.viewport)] ?? 'Website');
</script>
