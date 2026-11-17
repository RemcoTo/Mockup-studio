<template>
  <div class="palette-wrap">
  <div class="palette" :class="{ 'has-preview': !flat }">
    <div class="grid content-start gap-3">
      <ol v-if="model.colors.length" class="rows" aria-label="Kleuren">
        <li v-for="(c, i) in model.colors" :key="i" class="row" :class="{ conflict: isConflict(c.hex), idle: inactive(c.role) }" :data-role="c.role">
          <ColorField :model-value="c.hex" :label="`Kleur ${i + 1}`" @update:model-value="(v) => v && setColor(i, { hex: v })" />
          <select class="input role" :value="c.role" :aria-label="`Toepassing van kleur ${i + 1}`" @change="setColor(i, { role: ($event.target as HTMLSelectElement).value as ColorRole })">
            <option v-for="r in COLOR_ROLES" :key="r.id" :value="r.id">{{ r.label }}</option>
          </select>
          <span class="note" :class="{ warn: isConflict(c.hex) }">{{ noteFor(c) }}</span>
          <button type="button" class="remove" :aria-label="`Kleur ${i + 1} verwijderen`" title="Verwijderen" @click="remove(i)"><Icon name="trash" :size="15" /></button>
        </li>
      </ol>
      <p v-else class="text-sm text-graphite">Nog geen kleuren. Het model kiest dan zelf een rustig, passend palet.</p>
      <div class="flex flex-wrap items-center gap-3">
        <button type="button" class="btn btn-secondary btn-sm" :disabled="model.colors.length >= PALETTE_MAX" @click="add"><Icon name="plus" :size="14" />Kleur toevoegen</button>
        <span v-if="model.colors.length >= PALETTE_MAX" class="text-xs text-graphite">Maximaal {{ PALETTE_MAX }} kleuren.</span>
      </div>

      <div v-if="!flat && hasBackground" class="field" data-background-mode><span>Achtergrond in de scène</span>
        <div class="segmented self-start" role="group" aria-label="Achtergrond in de scène">
          <button v-for="m in BACKGROUND_MODES" :key="m.id" type="button" :aria-pressed="mode === m.id" @click="setMode(m.id)">{{ m.label }}</button>
        </div>
        <p class="max-w-2xl text-xs text-graphite">{{ BACKGROUND_MODES.find((m) => m.id === mode)!.hint }}</p>
      </div>

      <div v-if="gradient.length" class="gradient-box" data-gradient>
        <div class="flex items-center justify-between gap-3">
          <span class="text-sm font-medium">Gradient</span>
          <button v-if="gradient.length >= 2" type="button" class="btn btn-quiet btn-sm" @click="reverseGradient"><Icon name="rotate" :size="14" />Volgorde omdraaien</button>
        </div>
        <span class="gradient-bar" :style="{ background: gradientCss(gradient, direction) }" aria-hidden="true" />
        <div class="field"><span>Richting</span>
          <div class="flex flex-wrap gap-2" role="group" aria-label="Richting van de gradient">
            <button v-for="d in BACKDROP_DIRECTIONS" :key="d.id" type="button" class="chip" :aria-pressed="direction === d.id" @click="setDirection(d.id)">{{ d.label }}</button>
          </div>
        </div>
        <p class="text-xs text-graphite">De gradient loopt in de volgorde van de lijst. Hij vormt de achtergrond van de scène.</p>
      </div>

      <p v-if="keyHex" class="notice notice-error max-w-2xl text-sm" role="alert">{{ keyHex }} lijkt op het magenta scherm waarmee de studio de achtergrond exact maakt, en zou dan mee vervangen kunnen worden. Kies een andere tint, of zet de achtergrond op Door de AI.</p>
      <p v-if="problem" class="notice notice-error max-w-2xl text-sm" role="alert">{{ problem }}</p>
    </div>

    <div v-if="!flat" class="scene-preview" role="img" :aria-label="previewLabel">
      <span class="wall" :class="{ lit: mode === 'ai' }" :style="{ background: wallCss }" />
      <span class="floor" :style="{ background: floorCss }" />
      <span v-if="light" class="glow" :style="{ background: `radial-gradient(circle at 85% 12%, ${light}, transparent 62%)` }" />
      <span v-for="(a, i) in colorsFor(model, 'accent').slice(0, 3)" :key="`a${i}`" class="accent" :style="{ background: a, left: `${8 + i * 6}%` }" />
      <template v-if="showProps">
        <span class="prop sphere" :style="{ background: propColor(0) }" />
        <span class="prop plinth" :style="{ background: propColor(1) }" />
      </template>
      <span class="product"><span class="design" /></span>
    </div>
  </div>
  </div>
</template>

<script setup lang="ts">
// Meerdere merkkleuren, elk met een eigen toepassing in de scène. Gebruikt in Nieuwe mockup en Brand Shoot.
import { BACKDROP_DIRECTIONS, keyConflict, type BackdropDirection } from '~~/shared/scene-style';
import { BACKGROUND_MODES, COLOR_ROLES, PALETTE_MAX, backgroundMode, colorsFor, nextRole, paletteProblem, type BackgroundMode, type ColorRole, type PaletteColor, type ScenePalette } from '~~/shared/palette';

const model = defineModel<ScenePalette>({ required: true });
const props = withDefaults(defineProps<{
  /** Platte achtergrond: alleen Achtergrond en Gradient tellen; de studio zet ze exact. */
  flat?: boolean;
  /** Props staat op Geen: objectkleuren hebben dan niets om op te landen. */
  propsNone?: boolean;
  /** Kleur die op het groene ontwerpvlak lijkt (wordt gemarkeerd). */
  conflict?: string | null;
}>(), { flat: false, propsNone: false, conflict: null });

const roleDef = (id: ColorRole) => COLOR_ROLES.find((r) => r.id === id)!;
const gradient = computed(() => colorsFor(model.value, 'gradient'));
const direction = computed<BackdropDirection>(() => model.value.gradient?.direction ?? 'vertical');
const problem = computed(() => paletteProblem(model.value));
const hasBackground = computed(() => colorsFor(model.value, 'background').length > 0 || gradient.value.length > 0);
const mode = computed<BackgroundMode>(() => backgroundMode(model.value));
/** Bij een exacte achtergrond: een scènekleur die op het magenta sleutelscherm lijkt. */
const keyHex = computed(() => (props.flat ? null : keyConflict({ palette: model.value, backdrop: null })));
const light = computed(() => colorsFor(model.value, 'light')[0]);
const showProps = computed(() => !props.propsNone && colorsFor(model.value, 'props').length > 0);

const isConflict = (hex: string) => (!!props.conflict && props.conflict === hex) || (!!keyHex.value && keyHex.value === hex);
const inactive = (role: ColorRole) => (props.flat && !roleDef(role).flat) || (role === 'props' && props.propsNone && !props.flat);
function noteFor(c: PaletteColor): string {
  if (props.conflict && props.conflict === c.hex) return 'Lijkt op het groene ontwerpvlak';
  if (keyHex.value === c.hex && c.role !== 'background' && c.role !== 'gradient') return 'Lijkt op het magenta scherm voor de exacte achtergrond';
  if (props.flat && !roleDef(c.role).flat) return 'Telt niet bij een platte achtergrond';
  if (c.role === 'props' && props.propsNone) return 'Props staat op Geen; kies Minimaal of Passend bij het merk';
  if (c.role === 'background' && props.flat && colorsFor(model.value, 'background')[0] !== c.hex) return 'Een platte achtergrond gebruikt de eerste achtergrondkleur';
  return roleDef(c.role).hint;
}

function commit(next: ScenePalette) { model.value = next; }
function setColor(i: number, part: Partial<PaletteColor>) {
  commit({ ...model.value, colors: model.value.colors.map((c, j) => (j === i ? { ...c, ...part } : c)) });
}
function remove(i: number) { commit({ ...model.value, colors: model.value.colors.filter((_, j) => j !== i) }); }
/** Rustige standaardtint per toepassing; je past hem daarna aan. */
const STARTER: Record<ColorRole, string> = { background: '#e8e1d5', ground: '#c9bba6', gradient: '#d9cfc2', props: '#b9a48a', accent: '#c46a3b', light: '#f2b56b' };
function add() {
  if (model.value.colors.length >= PALETTE_MAX) return;
  const role = nextRole(model.value);
  commit({ ...model.value, colors: [...model.value.colors, { hex: STARTER[role], role }] });
}
function setMode(m: BackgroundMode) { commit({ ...model.value, background: m }); }
function setDirection(d: BackdropDirection) { commit({ ...model.value, gradient: { direction: d } }); }
/** Draait alleen de gradientkleuren om; de andere kleuren houden hun plek. */
function reverseGradient() {
  const idx = model.value.colors.map((c, i) => (c.role === 'gradient' ? i : -1)).filter((i) => i >= 0);
  const hexes = idx.map((i) => model.value.colors[i]!.hex).reverse();
  const colors = [...model.value.colors];
  idx.forEach((i, k) => { colors[i] = { ...colors[i]!, hex: hexes[k]! }; });
  commit({ ...model.value, colors });
}

function gradientCss(stops: string[], dir: BackdropDirection) {
  const list = stops.length === 1 ? [stops[0], stops[0]] : stops;
  if (dir === 'radial') return `radial-gradient(circle at 50% 50%, ${list.join(', ')})`;
  return `linear-gradient(${{ vertical: '180deg', horizontal: '90deg', diagonal: '135deg' }[dir]}, ${list.join(', ')})`;
}
const wallCss = computed(() => {
  if (gradient.value.length >= 2) return gradientCss(gradient.value, direction.value);
  const bg = colorsFor(model.value, 'background');
  if (bg.length > 1) return `linear-gradient(90deg, ${bg.map((c, i) => `${c} ${(i / bg.length) * 100}% ${((i + 1) / bg.length) * 100}%`).join(', ')})`;
  return bg[0] ?? '#e9e6e1';
});
const floorCss = computed(() => {
  const g = colorsFor(model.value, 'ground');
  const base = g.length > 1 ? `linear-gradient(90deg, ${g.map((c, i) => `${c} ${(i / g.length) * 100}% ${((i + 1) / g.length) * 100}%`).join(', ')})` : g[0] ?? '#d8d3cb';
  return `linear-gradient(180deg, rgb(255 255 255 / 0.12), rgb(0 0 0 / 0.14)), ${base}`;
});
const propColor = (i: number) => { const p = colorsFor(model.value, 'props'); return p[i % p.length]!; };
const previewLabel = computed(() => {
  const parts = COLOR_ROLES.map((r) => ({ r, c: colorsFor(model.value, r.id) })).filter((x) => x.c.length).map((x) => `${x.r.label} ${x.c.join(', ')}`);
  return parts.length ? `Voorbeeld van de kleurverdeling: ${parts.join('; ')}` : 'Voorbeeld van de kleurverdeling: nog geen kleuren';
});
</script>

<style scoped>
.palette-wrap { container-type: inline-size; max-width: 64rem; }
.palette { display: grid; gap: 1.25rem; }
/* Voorbeeld naast de kleuren als er ruimte is, anders eronder. */
@container (min-width: 46rem) { .palette.has-preview { grid-template-columns: minmax(0, 1fr) 14rem; } }
.rows { display: grid; gap: 0.5rem; container-type: inline-size; }
.row { display: grid; grid-template-columns: auto minmax(8rem, 1fr) auto; align-items: center; gap: 0.35rem 0.75rem; padding: 0.4rem 0.4rem 0.45rem 0.5rem; border: 1px solid var(--color-rule); border-radius: var(--radius-md); background: var(--color-white); transition: border-color 120ms; }
.row .note { grid-column: 1 / -1; grid-row: 2; padding-left: 0.1rem; }
@container (min-width: 40rem) {
  .row { grid-template-columns: auto 10.5rem minmax(0, 1fr) auto; }
  .row .note { grid-column: 3; grid-row: 1; padding-left: 0; }
}
.row.conflict { border-color: var(--color-danger); box-shadow: inset 0 0 0 1px var(--color-danger); }
.row.idle .note, .row.idle :deep(.swatch) { opacity: 0.55; }
.role { height: 2.25rem; min-width: 0; width: 100%; }
.note { font-size: var(--text-xs); color: var(--color-graphite); line-height: 1.35; }
.note.warn { color: var(--color-danger); }
.remove { grid-column: -2; grid-row: 1; display: grid; place-items: center; width: 2rem; height: 2rem; border-radius: var(--radius-sm); color: var(--color-graphite); transition: color 120ms, background 120ms; }
.remove:hover { color: var(--color-danger); background: var(--color-danger-soft); }
.gradient-box { display: grid; gap: 0.75rem; max-width: 40rem; padding: 0.9rem 1rem 1rem; border: 1px solid var(--color-rule); border-radius: var(--radius-md); background: var(--color-paper); }
.gradient-bar { display: block; height: 2.5rem; border-radius: var(--radius-sm); box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.08); }
.scene-preview { position: relative; align-self: start; width: 100%; max-width: 20rem; aspect-ratio: 4 / 3; border-radius: var(--radius-md); overflow: hidden; box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.08); }
.scene-preview > span { position: absolute; display: block; }
.wall { inset: 0 0 36% 0; }
.wall.lit::after { content: ''; position: absolute; inset: 0; background: radial-gradient(120% 90% at 30% 10%, rgb(255 255 255 / 0.22), transparent 55%), linear-gradient(180deg, transparent 55%, rgb(0 0 0 / 0.14)); }
.floor { inset: 64% 0 0 0; }
.accent { top: 10%; width: 3%; height: 34%; border-radius: 1px; }
.prop.sphere { left: 9%; top: 59%; width: 13%; aspect-ratio: 1; border-radius: 50%; box-shadow: inset -4px -5px 10px rgb(0 0 0 / 0.22); }
.prop.plinth { right: 8%; top: 54%; width: 15%; height: 22%; border-radius: 2px; box-shadow: inset -6px 0 10px rgb(0 0 0 / 0.18); }
.product { left: 50%; top: 22%; width: 38%; height: 50%; transform: translateX(-50%); border-radius: 6px; background: linear-gradient(160deg, #3a3b3e, #1d1e20); box-shadow: 0 10px 18px -8px rgb(0 0 0 / 0.45); }
.design { position: absolute; inset: 7%; border-radius: 2px; background: repeating-linear-gradient(180deg, #f6f4f0 0 18%, #e4e0d9 18% 22%); }
.glow { inset: 0; opacity: 0.55; mix-blend-mode: screen; pointer-events: none; }
</style>
