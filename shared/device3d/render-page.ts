// Instappunt voor de server: wordt gebundeld en in headless Chromium geladen (zie server/lib/device3d/render.ts).
// Rendert een device met schaduw als transparante laag, plus het schermmasker en de schermhoeken.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Quad } from '../geometry';
import type { Device3DSpec } from './spec';
import { DeviceStage, type LightEstimate } from './stage';

export interface RenderArgs {
  /** GLB als base64. */
  glb: string;
  modelKey: string;
  /** Verkleinde achtergrond (data-URL) voor reflecties en lichtschatting, of null. */
  env: string | null;
  width: number;
  height: number;
  spec: Device3DSpec;
  supersample?: number;
}
export interface RenderResult {
  layer: string;
  mask: string;
  quad: Quad;
  facing: boolean;
  light: LightEstimate;
  supersample: number;
}

const models = new Map<string, THREE.Object3D>();
let renderer: THREE.WebGLRenderer | null = null;

async function loadModel(key: string, b64: string): Promise<THREE.Object3D> {
  const hit = models.get(key);
  if (hit) return hit.clone(true);
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const gltf = await new GLTFLoader().parseAsync(bin.buffer, '');
  models.set(key, gltf.scene);
  return gltf.scene.clone(true);
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

function downscale(src: HTMLCanvasElement, w: number, h: number): string {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return c.toDataURL('image/png');
}

async function render(args: RenderArgs): Promise<RenderResult> {
  if (!renderer) {
    const canvas = document.createElement('canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, premultipliedAlpha: true });
  }
  const max = renderer.capabilities.maxTextureSize;
  const ss = Math.max(1, Math.min(args.supersample ?? 2, Math.floor(max / Math.max(args.width, args.height))));
  renderer.setPixelRatio(1);
  renderer.setSize(args.width * ss, args.height * ss, false);
  const stage = new DeviceStage(renderer);
  try {
    stage.setDevice(await loadModel(args.modelKey, args.glb));
    stage.setSize(args.width * ss, args.height * ss);
    stage.setEnvironment(args.env ? await loadImage(args.env) : null, args.env ? String(args.env.length) : 'none');
    stage.setScreen('chroma');
    stage.update(args.spec);
    stage.renderDevice();
    const layer = downscale(renderer.domElement, args.width, args.height);
    stage.renderMask();
    const mask = downscale(renderer.domElement, args.width, args.height);
    const quad = stage.screenQuad().map(([x, y]) => [x / ss, y / ss]) as Quad;
    return { layer, mask, quad, facing: stage.screenFacesCamera(), light: stage.light, supersample: ss };
  } finally {
    stage.dispose();
  }
}

(window as unknown as { __device3d: unknown }).__device3d = { render };
