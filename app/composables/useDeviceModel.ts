// 3D-modellen van devices laden in de browser: één keer per sessie per bestand, daarna een kopie per gebruik
// (live weergave, meten voor uitlijnen en maat in beeld).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const cache = ((globalThis as unknown as { __d3cache?: Map<string, Promise<THREE.Object3D>> }).__d3cache ??= new Map());

export function loadDeviceModel(url: string): Promise<THREE.Object3D> {
  if (!cache.has(url)) cache.set(url, new GLTFLoader().loadAsync(url).then((g) => g.scene));
  return cache.get(url)!.then((o: THREE.Object3D) => o.clone(true));
}
