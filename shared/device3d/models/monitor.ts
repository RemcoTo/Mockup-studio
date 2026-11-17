// Monitor van 27 inch (5K, 16:9) op echte maten (meter), eigen ontwerp (geen kopie van een merk, geen logo).
// Dun paneel: glazen voorkant van rand tot rand met smalle zwarte randen, gepolijste facetrand, aluminium achterkant
// met zachte afronding en een ronde bevestigingsplaat; voet en hals uit aluminium met gepolijste randen en een
// kabeldoorvoer. Scherm naar +Z, voet op y=0. Het scherm ('Screen') houdt de maat uit spec.ts.
import * as THREE from 'three';
import { arcProfile, flatRounded, machinedSlab, materials, merge, part, sweep, withAO } from './parts';

export function buildMonitor(): THREE.Group {
  const mat = materials();
  const root = new THREE.Group();
  root.name = 'Monitor';
  const screenW = 0.5967, screenH = 0.3356, bezel = 0.0068;
  const W = screenW + bezel * 2, H = screenH + bezel * 2, T = 0.0115, r = 0.0062;
  const lift = 0.105; // onderkant van het paneel boven het bureau
  const tilt = THREE.MathUtils.degToRad(-6); // licht naar achteren

  // Paneel: liggend opgebouwd (voorkant +y, bovenkant -z) en daarna rechtop gezet.
  const panel = new THREE.Group();
  panel.name = 'Panel';
  const flat = new THREE.Group();
  panel.add(flat);
  const rbk = 0.0032, c = 0.0004;
  flat.add(part(sweep(W, H, r, [
    ...arcProfile(-rbk, -T / 2 + rbk, rbk, -90, 0, 8, 0.85, 1),
    { o: 0, y: T / 2 - c, nh: 1, nv: 0 },
  ], 16), mat.aluminium, 'PanelShell'));
  flat.add(part(sweep(W, H, r, [{ o: 0, y: T / 2 - c, nh: 0.7071, nv: 0.7071 }, { o: -c, y: T / 2, nh: 0.7071, nv: 0.7071 }], 16), mat.chamfer, 'PanelChamfer'));
  const back = withAO(flatRounded(W - 2 * rbk, H - 2 * rbk, r - rbk + 0.0001, 16));
  back.rotateX(Math.PI / 2);
  back.translate(0, -T / 2, 0);
  flat.add(part(back, mat.aluminium, 'PanelBack'));
  const glass = withAO(flatRounded(W - 2 * c, H - 2 * c, r - c, 16));
  glass.rotateX(-Math.PI / 2);
  glass.translate(0, T / 2 + 0.00003, 0);
  flat.add(part(glass, mat.bezel, 'Bezel'));
  const screen = part(flatRounded(screenW, screenH, 0.0008, 6), mat.screen, 'Screen');
  screen.castShadow = false;
  screen.userData = { screenMM: [screenW * 1000, screenH * 1000] };
  screen.rotation.x = -Math.PI / 2;
  screen.position.set(0, T / 2 + 0.0001, 0);
  flat.add(screen);
  const camRing = withAO(new THREE.RingGeometry(0.0007, 0.0013, 32));
  const cam = withAO(new THREE.CircleGeometry(0.0007, 32));
  for (const g of [camRing, cam]) { g.rotateX(-Math.PI / 2); g.translate(0, T / 2 + 0.00008, -H / 2 + bezel / 2); }
  flat.add(part(camRing, mat.lensRing, 'CameraRing'), part(cam, mat.lens, 'Camera'));
  // Ronde bevestigingsplaat achterop, waar de hals vastzit.
  const mountR = 0.052, mountT = 0.006, mountZ = H / 2 - H * 0.42; // 42% van de hoogte vanaf de onderkant
  const me = 0.004;
  const mountProf: THREE.Vector2[] = [new THREE.Vector2(0, mountT)];
  for (let i = 0; i <= 8; i++) { const a = (Math.PI / 2) * (1 - i / 8); mountProf.push(new THREE.Vector2(mountR - me + me * Math.cos(a), mountT - me + me * Math.sin(a))); }
  mountProf.push(new THREE.Vector2(mountR, 0));
  // Volgorde van buiten naar binnen: dan wijzen de vlakken naar buiten.
  const mount = new THREE.LatheGeometry(mountProf.reverse(), 64);
  mount.rotateX(Math.PI); // naar de achterkant (-y)
  mount.translate(0, -T / 2, mountZ);
  flat.add(part(withAO(mount, 0.95), mat.aluminium, 'Mount'));
  // Poorten onderaan achter (donkere openingen).
  const ports: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const g = withAO(flatRounded(0.0089, 0.0031, 0.0015, 6), 0.6);
    g.rotateX(Math.PI / 2);
    g.translate(-0.045 + i * 0.018, -T / 2 - 0.00002, H / 2 - 0.04);
    ports.push(g);
  }
  flat.add(part(merge(ports), mat.port, 'Ports'));
  flat.rotation.x = Math.PI / 2;
  panel.position.set(0, lift + H / 2, 0.012);
  panel.rotation.x = tilt;
  root.add(panel);

  // Voet: gefreesde aluminium plaat met afgeronde hoeken.
  const footD = 0.185, footZ = -0.07;
  const foot = machinedSlab({ w: 0.205, d: footD, h: 0.0062, r: 0.03, rb: 0.0018, c: 0.0005, aoBottom: 0.5 });
  for (const g of [foot.body, foot.chamfer]) g.translate(0, 0, footZ);
  root.add(part(foot.body, mat.aluminium, 'Foot'), part(foot.chamfer, mat.chamfer, 'FootChamfer'));

  // Hals: schuine gefreesde plaat van de achterkant van de voet naar de bevestigingsplaat.
  const neckW = 0.088, neckT = 0.009;
  root.updateMatrixWorld(true);
  const mountWorld = new THREE.Vector3(0, -T / 2 - mountT, mountZ).applyMatrix4(flat.matrixWorld);
  const from = new THREE.Vector3(0, 0.0055, footZ - footD / 2 + 0.028);
  const to = new THREE.Vector3(0, mountWorld.y, mountWorld.z - neckT / 2 + 0.001);
  const len = from.distanceTo(to);
  const neck = machinedSlab({ w: neckW, d: neckT, h: len, r: 0.0035, rb: 0.0012, c: 0.0004, seg: 10, aoBottom: 0.45 });
  // Kabeldoorvoer: ovale opening onderin de hals (achterkant).
  const hole = withAO(flatRounded(0.03, 0.017, 0.0085, 10), 0.5);
  hole.rotateY(Math.PI);
  hole.translate(0, 0.035, -neckT / 2 - 0.00003);
  for (const g of [neck.body, neck.chamfer, hole]) {
    g.translate(from.x, from.y, from.z);
  }
  const neckGroup = new THREE.Group();
  neckGroup.name = 'Neck';
  neckGroup.add(part(neck.body, mat.aluminium, 'NeckBody'), part(neck.chamfer, mat.chamfer, 'NeckChamfer'), part(hole, mat.port, 'CableHole'));
  // Om het beginpunt kantelen zodat de hals naar de bevestigingsplaat loopt.
  const pivot = new THREE.Group();
  pivot.position.copy(from);
  neckGroup.position.set(-from.x, -from.y, -from.z);
  pivot.add(neckGroup);
  pivot.rotation.x = Math.atan2(to.z - from.z, to.y - from.y);
  root.add(pivot);
  root.userData = { device: 'monitor-27' };
  return root;
}
