<template>
  <svg :width="size" :height="size" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="shrink-0">
    <path v-for="(d, i) in paths" :key="i" :d="d" />
  </svg>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{ name: string; size?: number }>(), { size: 16 });
const ICONS: Record<string, string[]> = {
  plus: ['M10 4v12', 'M4 10h12'],
  spark: ['M10 2.5l1.8 4.7 4.7 1.8-4.7 1.8L10 15.5l-1.8-4.7L3.5 9l4.7-1.8z'],
  home: ['M3.5 9 10 3.5 16.5 9', 'M5 8v8.5h10V8'],
  folder: ['M2.5 5.5h5l1.5 1.5h8.5v9h-15z'],
  upload: ['M10 13V3.5', 'M6.5 7 10 3.5 13.5 7', 'M3.5 13v3.5h13V13'],
  grid: ['M3.5 3.5h5.5v5.5H3.5z', 'M11 3.5h5.5v5.5H11z', 'M3.5 11h5.5v5.5H3.5z', 'M11 11h5.5v5.5H11z'],
  settings: ['M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'M10 2v2.2M10 15.8V18M2 10h2.2M15.8 10H18M4.3 4.3l1.6 1.6M14.1 14.1l1.6 1.6M4.3 15.7l1.6-1.6M14.1 5.9l1.6-1.6'],
  globe: ['M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z', 'M2.5 10h15', 'M10 2.5c2.2 2.4 2.2 12.6 0 15M10 2.5c-2.2 2.4-2.2 12.6 0 15'],
  star: ['M10 2.8l2.2 4.6 5 .6-3.7 3.5 1 5L10 14l-4.5 2.5 1-5L2.8 8l5-.6z'],
  trash: ['M4 5.5h12', 'M8 5.5V4h4v1.5', 'M5.5 5.5l.7 11h7.6l.7-11'],
  copy: ['M7 7h9.5v9.5H7z', 'M13 7V3.5H3.5V13H7'],
  pencil: ['M13.5 3.5l3 3L7 16H4v-3z'],
  download: ['M10 3.5V13', 'M6.5 9.5 10 13l3.5-3.5', 'M3.5 16.5h13'],
  undo: ['M7 5 3.5 8.5 7 12', 'M3.5 8.5H12a4.5 4.5 0 0 1 0 9h-2'],
  redo: ['M13 5l3.5 3.5L13 12', 'M16.5 8.5H8a4.5 4.5 0 0 0 0 9h2'],
  eye: ['M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z', 'M10 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z'],
  'eye-off': ['M3 3l14 14', 'M8.2 4.7A8 8 0 0 1 10 4.5c5 0 8 5.5 8 5.5a14 14 0 0 1-2.3 3', 'M5.4 6.3A13.5 13.5 0 0 0 2 10s3 5.5 8 5.5a7.6 7.6 0 0 0 3.6-.9'],
  rotate: ['M15.5 6.5A6.5 6.5 0 1 0 16.5 11', 'M15.5 2.5v4h-4'],
  reset: ['M4 10a6 6 0 1 0 2-4.5', 'M4 3v3h3'],
  close: ['M5 5l10 10M15 5 5 15'],
  menu: ['M3 6h14M3 10h14M3 14h14'],
  arrow: ['M4 10h12', 'M11 5l5 5-5 5'],
  back: ['M16 10H4', 'M9 5l-5 5 5 5'],
  zoomin: ['M8.5 3.5a5 5 0 1 0 0 10 5 5 0 0 0 0-10z', 'M12.5 12.5l4 4', 'M8.5 6.5v4M6.5 8.5h4'],
  zoomout: ['M8.5 3.5a5 5 0 1 0 0 10 5 5 0 0 0 0-10z', 'M12.5 12.5l4 4', 'M6.5 8.5h4'],
  corners: ['M3.5 7V3.5H7', 'M13 3.5h3.5V7', 'M16.5 13v3.5H13', 'M7 16.5H3.5V13'],
  image: ['M3 4h14v12H3z', 'M3 13l4-4 3.5 3.5L13 10l4 4', 'M13 7.2a.8.8 0 1 0 0 .1'],
  check: ['M4 10.5l3.5 3.5L16 5.5'],
  more: ['M5 9.2a.8.8 0 1 0 0 1.6a.8.8 0 1 0 0-1.6z', 'M10 9.2a.8.8 0 1 0 0 1.6a.8.8 0 1 0 0-1.6z', 'M15 9.2a.8.8 0 1 0 0 1.6a.8.8 0 1 0 0-1.6z'],
  chevron: ['M6 8l4 4 4-4'],
  filter: ['M3.5 5h13', 'M6 10h8', 'M8.5 15h3'],
  search: ['M8.5 3.5a5 5 0 1 0 0 10 5 5 0 0 0 0-10z', 'M12.5 12.5l4 4'],
  none: ['M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M5 15 15 5'],
};
const paths = computed(() => ICONS[props.name] ?? []);
</script>
