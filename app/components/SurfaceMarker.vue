<template>
  <div class="relative inline-block max-w-full select-none">
    <img ref="img" :src="scene.fileUrl" :alt="scene.title" class="max-h-[75vh] w-auto rounded-sm" draggable="false" @load="ready = true" />
    <svg v-if="ready" ref="svg" class="absolute inset-0 h-full w-full" :viewBox="`0 0 ${scene.width} ${scene.height}`" @pointermove="move" @pointerup="up" @pointercancel="up">
      <g v-for="(s, i) in model" :key="s.id ?? i">
        <polygon :points="s.quad.map((p) => p.join(',')).join(' ')" class="area" :class="{ sel: i === selected }" @pointerdown="$emit('select', i)" />
        <line :x1="s.quad[0][0]" :y1="s.quad[0][1]" :x2="s.quad[1][0]" :y2="s.quad[1][1]" class="top" :class="{ sel: i === selected }" />
        <template v-if="i === selected">
          <g v-for="(c, k) in s.quad" :key="k" class="reg" :transform="`translate(${c[0]} ${c[1]}) scale(${unit})`" @pointerdown.stop="down($event, i, k)">
            <circle r="16" class="hit" /><circle r="7.5" class="ring" /><path d="M0 -13V13M-13 0H13" class="cross" />
          </g>
        </template>
      </g>
    </svg>
  </div>
</template>

<script setup lang="ts">
import type { SceneView } from '~/utils/types';
import type { Quad } from '~~/shared/geometry';
import type { SurfaceKind } from '~~/shared/types';

export interface EditableSurface { id?: string; label: string; kind: SurfaceKind; quad: Quad; detection: 'chroma' | '3d' | 'manual' }
const model = defineModel<EditableSurface[]>({ required: true });
const props = defineProps<{ scene: SceneView; selected: number }>();
defineEmits<{ select: [i: number] }>();
const img = ref<HTMLImageElement | null>(null);
const svg = ref<SVGSVGElement | null>(null);
const ready = ref(false);
// Hoekpunten houden op elk formaat dezelfde schermgrootte.
const unit = computed(() => (ready.value && img.value ? props.scene.width / Math.max(1, img.value.clientWidth) : 1));
let drag: { i: number; k: number } | null = null;
function pos(e: PointerEvent): [number, number] {
  const pt = svg.value!.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const r = pt.matrixTransform(svg.value!.getScreenCTM()!.inverse());
  return [Math.max(0, Math.min(props.scene.width, Math.round(r.x))), Math.max(0, Math.min(props.scene.height, Math.round(r.y)))];
}
function down(e: PointerEvent, i: number, k: number) { drag = { i, k }; svg.value?.setPointerCapture(e.pointerId); }
function move(e: PointerEvent) {
  if (!drag) return;
  const q = model.value[drag.i]!.quad.map((p) => [...p]) as Quad;
  q[drag.k] = pos(e);
  model.value[drag.i]!.quad = q;
}
function up() { drag = null; }
</script>

<style scoped>
.area { fill: rgb(10 127 179 / 0.08); stroke: rgb(255 255 255 / 0.8); stroke-width: 1; vector-effect: non-scaling-stroke; cursor: pointer; }
.area.sel { fill: rgb(10 127 179 / 0.16); stroke: var(--color-cyan); stroke-width: 1.5; }
.top { stroke: transparent; vector-effect: non-scaling-stroke; pointer-events: none; }
.top.sel { stroke: var(--color-cyan); stroke-width: 4; }
.reg { cursor: grab; }
.reg .hit { fill: transparent; }
.reg .ring { fill: rgb(255 255 255 / 0.3); stroke: var(--color-cyan); stroke-width: 1.5; }
.reg .cross { stroke: var(--color-cyan); stroke-width: 1.5; }
</style>
