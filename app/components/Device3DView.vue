<template>
  <div ref="root" class="d3" :style="{ aspectRatio: `${width} / ${height}` }" role="img" :aria-label="label">
    <img v-if="backgroundUrl" :src="backgroundUrl" alt="" class="bg" draggable="false" @load="onBackground" />
    <div v-else class="bg plain" />
    <canvas ref="canvas" class="layer" />
    <p v-if="error" class="err">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
// Live weergave van een 3D-device met Three.js in de browser: dezelfde stage als de server, zodat wat je hier ziet
// overeenkomt met de definitieve render. Het ontwerp staat als textuur op het scherm (benadering van de passing;
// de exacte plaatsing doet de server).
import * as THREE from 'three';
import { DeviceStage } from '~~/shared/device3d/stage';
import { findDeviceModel, statusBarFraction, type Device3DSpec } from '~~/shared/device3d/spec';
import { DEFAULT_TRANSFORM } from '~~/shared/types';
import type { DesignTransform } from '~~/shared/geometry';
import type { ScreenCtx } from '~~/shared/mail';
import { barStyle, drawStatusBar, screenLayout, topColor } from '~~/shared/statusbar';
import { loadDeviceModel } from '~/composables/useDeviceModel';

const props = withDefaults(defineProps<{
  modelUrl: string;
  spec: Device3DSpec;
  /** Verhouding en resolutie van de scène. */
  width: number;
  height: number;
  backgroundUrl?: string | null;
  designUrl?: string | null;
  /** Passing van het ontwerp op het scherm (zoals bij de mockup); zonder: breedte, bovenaan uitgelijnd. */
  transform?: DesignTransform | null;
  label?: string;
}>(), { backgroundUrl: null, designUrl: null, transform: null, label: 'Live weergave van het 3D-device' });

const root = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const error = ref('');
let renderer: THREE.WebGLRenderer | null = null;
let stage: DeviceStage | null = null;
let texture: THREE.Texture | null = null;
let raf = 0;
let ro: ResizeObserver | null = null;
// Pas tekenen als het model geladen is (laden kan even duren; tot dan staat alleen de achtergrond er).
let ready = false;

const loadModel = loadDeviceModel;

function schedule() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(draw);
}

function draw() {
  if (!renderer || !stage || !ready || !canvas.value || !root.value) return;
  const r = root.value.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
  if (canvas.value.width !== w || canvas.value.height !== h) renderer.setSize(w, h, false);
  stage.setSize(w, h);
  try {
    stage.update(props.spec);
    stage.renderDevice();
    error.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const FONT = '"Schibsted Grotesk Variable", ui-sans-serif, system-ui, sans-serif';
let fontsReady: Promise<unknown> | null = null;
let designImage: HTMLImageElement | null = null;
let screenCanvas: HTMLCanvasElement | null = null;

/**
 * Schermbeeld: het ontwerp met dezelfde passing als de mockup en, als die aan staat, de status- of menubalk erboven;
 * dezelfde indeling en tekencode als de server, zodat de live weergave gelijk is aan de exacte render.
 */
function applyTexture() {
  if (!stage) return;
  const model = findDeviceModel(props.spec.model);
  if (!model || (!designImage && !props.spec.statusBar?.show)) { stage.setScreen('dark'); return; }
  const long = 2048;
  const [pw, ph] = model.screenMM;
  const W = pw >= ph ? long : Math.round((long * pw) / ph), H = pw >= ph ? Math.round((long * ph) / pw) : long;
  screenCanvas ??= document.createElement('canvas');
  const c = screenCanvas;
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#050506';
  ctx.fillRect(0, 0, W, H);
  const fraction = statusBarFraction(props.spec);
  const t = props.transform ?? { ...DEFAULT_TRANSFORM, fit: 'width' as const, anchor: 'top' as const };
  const dims = designImage ? { width: designImage.naturalWidth, height: designImage.naturalHeight } : { width: 1, height: 1 };
  const { barH, matrix } = screenLayout({ width: W, height: H }, fraction, dims, t);
  if (designImage) {
    ctx.save();
    ctx.beginPath(); ctx.rect(0, barH, W, H - barH); ctx.clip();
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(matrix[0], matrix[3], matrix[1], matrix[4], matrix[2], matrix[5]);
    ctx.drawImage(designImage, 0, 0, dims.width, dims.height);
    ctx.restore();
  }
  if (fraction > 0) {
    const rows = Math.max(1, Math.round(H * 0.006) + 1);
    const top = topColor(ctx.getImageData(0, barH, W, rows).data, W, rows) ?? [5, 5, 6];
    drawStatusBar(ctx as unknown as ScreenCtx, 0, 0, W, barH, model.statusBar.kind, props.spec.statusBar, barStyle(top, model.statusBar.kind, props.spec.statusBar.tone), FONT);
  }
  texture?.dispose();
  texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  stage.setScreen('design', texture);
}

async function loadTexture(url: string | null) {
  designImage = null;
  fontsReady ??= Promise.all([500, 600, 700].map((w) => document.fonts?.load(`${w} 16px "Schibsted Grotesk Variable"`).catch(() => null)));
  await fontsReady;
  if (url) {
    designImage = await new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }
  applyTexture();
  schedule();
}

function onBackground(e: Event) {
  stage?.setEnvironment(e.target as HTMLImageElement, props.backgroundUrl ?? '');
  schedule();
}

onMounted(async () => {
  if (!canvas.value) return;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas.value, antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    stage = new DeviceStage(renderer);
    stage.setDevice(await loadModel(props.modelUrl));
    ready = true;
    stage.setEnvironment(null, 'none');
    const bg = root.value?.querySelector('img.bg') as HTMLImageElement | null;
    if (bg?.complete && bg.naturalWidth) stage.setEnvironment(bg, props.backgroundUrl ?? '');
    await loadTexture(props.designUrl);
    ro = new ResizeObserver(schedule);
    if (root.value) ro.observe(root.value);
  } catch (e) {
    error.value = /WebGL/i.test(String(e)) ? 'Deze browser kan geen 3D tonen (WebGL staat uit).' : `3D-weergave mislukt: ${(e as Error).message}`;
  }
});
onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  ro?.disconnect();
  texture?.dispose();
  stage?.dispose();
  renderer?.dispose();
  renderer = null; stage = null;
});

// Statusbalk of model anders: het schermbeeld opnieuw opbouwen; de rest alleen opnieuw tekenen.
watch(() => [props.spec.statusBar, props.spec.model], () => { applyTexture(); schedule(); }, { deep: true });
watch(() => props.spec, schedule, { deep: true });
watch(() => props.designUrl, (u) => { void loadTexture(u); });
watch(() => props.transform, () => { applyTexture(); schedule(); }, { deep: true });
watch(() => props.modelUrl, async (u) => {
  if (!stage) return;
  ready = false;
  stage.setDevice(await loadModel(u));
  ready = true;
  applyTexture();
  schedule();
});
</script>

<style scoped>
.d3 { position: relative; width: 100%; overflow: hidden; background: var(--color-paper); }
.bg, .layer { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.bg { object-fit: fill; user-select: none; }
.bg.plain { background: linear-gradient(180deg, #ece8e2 0%, #ded8cf 56%, #cfc4b6 56%, #bfb2a2 100%); }
.err { position: absolute; left: 0.75rem; bottom: 0.5rem; font-size: var(--text-xs); color: var(--color-danger); }
</style>
