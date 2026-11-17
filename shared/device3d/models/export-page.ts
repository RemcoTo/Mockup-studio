// Instappunt voor het buildscript: bouwt de devicemodellen in code en exporteert ze als GLB (base64).
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { buildPhone, buildTablet } from './handheld';
import { buildLaptop } from './laptop';
import { buildMonitor } from './monitor';

const BUILDERS: Record<string, () => THREE.Object3D> = {
  'laptop-14': buildLaptop,
  'phone-6': buildPhone,
  'tablet-11': buildTablet,
  'monitor-27': buildMonitor,
};

async function exportModels(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [id, build] of Object.entries(BUILDERS)) {
    const root = build();
    const buf = (await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true })) as ArrayBuffer;
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    out[id] = btoa(bin);
  }
  return out;
}

(window as unknown as { __exportModels: unknown }).__exportModels = exportModels;
