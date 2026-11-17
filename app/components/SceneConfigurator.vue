<template>
  <div class="grid gap-9">
    <!-- Presets: een complete look in één klik; alles blijft daarna verfijnbaar. -->
    <section class="grid gap-4">
      <h3 class="text-base">Look</h3>
      <div class="presets" role="group" aria-label="Presets">
        <button v-for="p in SCENE_PRESETS" :key="p.id" type="button" class="preset" :aria-pressed="presetMatches(p, model)" @click="applyPreset(p)">
          <span class="preset-swatch" :style="{ background: p.config.backdrop?.mode === 'solid' ? p.swatch[0] : `linear-gradient(160deg, ${p.swatch[0]}, ${p.swatch[1]})` }" aria-hidden="true" />
          <span class="grid gap-0.5 text-left">
            <span class="text-sm font-medium">{{ p.label }}</span>
            <span class="text-xs text-graphite">{{ p.hint }}</span>
          </span>
        </button>
      </div>
    </section>

    <!-- Object -->
    <section class="grid gap-4">
      <h3 class="text-base">Wat staat er in beeld?</h3>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <button v-for="c in CATEGORIES" :key="c.id" type="button" class="tile" :aria-pressed="model.category === c.id" @click="setCategory(c.id)">
          <CategoryGlyph :id="c.id" class="mb-1 text-graphite" />
          <span class="font-medium">{{ c.label }}</span>
          <small>{{ c.description }}</small>
        </button>
      </div>
      <div class="flex flex-wrap gap-2">
        <button v-for="o in objects" :key="o.id" type="button" class="chip" :aria-pressed="model.objectType === o.id" @click="model.objectType = o.id">{{ o.label }}</button>
      </div>
      <details v-if="!device3d" class="more">
        <summary>Object verfijnen</summary>
        <div class="grid gap-4 pt-4 sm:grid-cols-2 xl:grid-cols-4">
          <label class="field"><span>Merk of model</span><input v-model="model.brandModel" class="input" maxlength="80" placeholder="Bijvoorbeeld: MacBook Pro" /></label>
          <label class="field"><span>Materiaal</span>
            <input v-model="model.material" class="input" maxlength="80" :list="`materials-${uid}`" placeholder="Bijvoorbeeld: aluminium" />
            <datalist :id="`materials-${uid}`"><option v-for="m in materialOptions" :key="m" :value="m" /></datalist>
          </label>
          <label class="field"><span>Kleur</span><input v-model="model.color" class="input" maxlength="60" placeholder="Bijvoorbeeld: zwart" /></label>
          <label class="field"><span>Afwerking</span>
            <select v-model="model.finish" class="input"><option value="">Geen voorkeur</option><option v-for="f in FINISHES" :key="f.id" :value="f.id">{{ f.label }}</option></select>
          </label>
          <label class="field"><span>Aantal objecten</span>
            <select v-model.number="model.objectCount" class="input"><option :value="undefined">1</option><option v-for="n in [2, 3, 4]" :key="n" :value="n">{{ n }}</option></select>
          </label>
          <label class="field"><span>Oriëntatie van het object</span>
            <select v-model="model.orientation" class="input"><option value="">Geen voorkeur</option><option value="upright">Rechtop</option><option value="lying flat">Liggend</option><option value="tilted">Schuin</option></select>
          </label>
          <label class="field"><span>Uitsnede</span>
            <select v-model="model.framing" class="input"><option value="">Geen voorkeur</option><option v-for="f in FRAMING" :key="f.id" :value="f.id">{{ f.label }}</option></select>
          </label>
          <label class="field"><span>Positie in beeld</span>
            <select v-model="model.objectPosition" class="input"><option value="">Geen voorkeur</option><option v-for="p in POSITIONS" :key="p.id" :value="p.id">{{ p.label }}</option></select>
          </label>
        </div>
      </details>
    </section>

    <!-- Echt 3D-device of door de AI gemaakt -->
    <section v-if="deviceModel" class="grid gap-4" data-section="device3d">
      <h3 class="text-base">Device</h3>
      <div class="grid max-w-3xl gap-2 sm:grid-cols-2">
        <button type="button" class="tile" :aria-pressed="!!device3d" @click="set3d(true)">
          <span class="font-medium">Echt 3D-model</span>
          <small>{{ deviceModel.label }} op echte maten. De AI maakt alleen de omgeving; je ontwerp staat exact en onvervormd op het scherm.</small>
        </button>
        <button type="button" class="tile" :aria-pressed="!device3d" @click="set3d(false)">
          <span class="font-medium">Door de AI</span>
          <small>De AI maakt het device mee in de foto. Soms natuurlijker in de scène, maar vorm en verhoudingen kloppen niet altijd.</small>
        </button>
      </div>
      <div v-if="device3d" class="grid max-w-4xl gap-5 lg:grid-cols-[1fr_17rem]">
        <div class="grid content-start gap-4">
          <div class="field"><span>Camerastandpunt</span>
            <div class="flex flex-wrap gap-2" role="group" aria-label="Camerastandpunt">
              <button v-for="c in CAMERA_PRESETS" :key="c.id" type="button" class="chip" :aria-pressed="matchingPreset(device3d) === c.id" @click="setDevice(applyCameraPreset(device3d, c.id))">{{ c.label }}</button>
            </div>
          </div>
          <div class="field"><span>Afwerking</span>
            <div class="flex flex-wrap gap-2" role="group" aria-label="Afwerking">
              <button v-for="f in deviceModel.finishes" :key="f.id" type="button" class="chip finish" :aria-pressed="device3d.finish === f.id" @click="setDevice({ ...device3d, finish: f.id })"><span class="dot" :style="{ background: f.body }" />{{ f.label }}</button>
            </div>
          </div>
          <div v-if="deviceModel.poses.length > 1" class="field"><span>Houding</span>
            <div class="segmented self-start"><button v-for="p in deviceModel.poses" :key="p" type="button" :aria-pressed="device3d.pose === p" @click="setDevice({ ...device3d, pose: p })">{{ POSE_LABEL[p] }}</button></div>
          </div>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="check" :checked="!!device3d.statusBar?.show" @change="setDevice({ ...device3d, statusBar: { ...(device3d.statusBar ?? defaultStatusBar()), show: ($event.target as HTMLInputElement).checked } })" />{{ deviceModel.statusBar.kind === 'desktop' ? 'Menubalk op het scherm' : 'Statusbalk op het scherm' }} ({{ device3d.statusBar?.time ?? '9:41' }})</label>
          <p class="max-w-xl text-xs text-graphite">{{ flat ? 'Op een platte achtergrond is geen AI nodig: de studio rendert het device direct, zonder kosten.' : 'De AI fotografeert de omgeving vanuit hetzelfde standpunt, met een lege plek voor het device.' }} Positie, rotatie, schaal, camera, statusbalk en licht stel je daarna in de editor precies in, met live voorbeeld.</p>
        </div>
        <ClientOnly>
          <Device3DView :model-url="`/models/devices/${deviceModel.file}`" :spec="device3d" :width="previewSize.width" :height="previewSize.height" :design-url="designAsset?.previewUrl ?? null" class="device-preview" />
        </ClientOnly>
      </div>
    </section>

    <!-- Afmetingen van het ontwerp: bepalen stand en verhouding van het oppervlak -->
    <section class="grid gap-4">
      <h3 class="text-base">Afmetingen van je ontwerp</h3>
      <template v-if="mode !== 'none'">
        <p class="max-w-2xl text-sm text-graphite">{{ mode === 'surface' ? 'Het model maakt het oppervlak in precies deze verhouding, staand of liggend. Je ontwerp past er daarna op zonder uitrekken, bijsnijden of vervormen.' : 'Bepaalt of het scherm staand of liggend in beeld komt.' }}</p>
        <div class="flex flex-wrap items-end gap-x-5 gap-y-4">
          <div class="flex items-end gap-2">
            <label class="field w-32"><span>Breedte</span>
              <span class="unit"><input class="input" type="number" inputmode="numeric" :min="DESIGN_SIZE_MIN" :max="DESIGN_SIZE_MAX" step="1" :value="sizeW ?? ''" aria-label="Breedte in pixels" @input="setSize('w', ($event.target as HTMLInputElement).value)" /><span>px</span></span>
            </label>
            <button type="button" class="btn btn-quiet btn-sm mb-0.5" title="Staand en liggend wisselen" aria-label="Breedte en hoogte wisselen" :disabled="!sizeW || !sizeH" @click="swapSize"><Icon name="rotate" :size="15" /></button>
            <label class="field w-32"><span>Hoogte</span>
              <span class="unit"><input class="input" type="number" inputmode="numeric" :min="DESIGN_SIZE_MIN" :max="DESIGN_SIZE_MAX" step="1" :value="sizeH ?? ''" aria-label="Hoogte in pixels" @input="setSize('h', ($event.target as HTMLInputElement).value)" /><span>px</span></span>
            </label>
          </div>
          <div v-if="validSize" class="size-preview" aria-hidden="true">
            <span class="size-box" :style="previewBox" />
          </div>
          <div v-if="validSize" class="grid gap-0.5 text-sm" data-size-summary aria-live="polite">
            <span class="font-medium">{{ orientationText }}</span>
            <span class="text-graphite">Verhouding {{ ratioLabel(validSize) }}</span>
          </div>
        </div>
        <p v-if="sizeError" class="text-xs text-danger">{{ sizeError }}</p>
        <div class="flex flex-wrap gap-2">
          <button v-if="designAsset && !matchesAsset" type="button" class="btn btn-secondary btn-sm" @click="fromAsset">Overnemen van {{ designAsset.originalName }}, {{ designAsset.width }} × {{ designAsset.height }} px</button>
          <button v-if="model.designSize" type="button" class="btn btn-quiet btn-sm" @click="clearSize">Geen afmetingen gebruiken</button>
        </div>
      </template>
      <p v-else class="max-w-2xl text-sm text-graphite">{{ sizeNote(model.objectType) }}</p>
    </section>

    <!-- Presentatie: een ruimte of een platte achtergrond -->
    <section class="grid gap-5">
      <h3 class="text-base">Presentatie</h3>
      <div class="segmented self-start" aria-label="Presentatie">
        <button type="button" :aria-pressed="!flat" @click="setFlat(false)">Scène</button>
        <button type="button" :aria-pressed="flat" @click="setFlat(true)">Platte achtergrond</button>
      </div>

      <template v-if="!flat">
        <div class="grid gap-2">
          <span class="text-sm text-graphite">Scènetype</span>
          <div class="grid max-w-4xl grid-cols-2 gap-2 sm:grid-cols-3">
            <button v-for="t in SCENE_TYPES" :key="t.id" type="button" class="tile" :aria-pressed="model.sceneType === t.id" @click="toggle('sceneType', t.id)">
              <span class="font-medium">{{ t.label }}</span>
              <small>{{ t.hint }}</small>
            </button>
          </div>
        </div>
        <div class="grid gap-2">
          <span class="text-sm text-graphite">Ondergrond</span>
          <div class="flex flex-wrap gap-2">
            <button v-for="g in GROUNDS" :key="g.id" type="button" class="chip" :aria-pressed="model.ground === g.id" @click="toggle('ground', g.id)">{{ g.label }}</button>
          </div>
        </div>
        <div class="field"><span>Props</span>
          <div class="segmented self-start">
            <button v-for="p in PROPS" :key="p.id" type="button" :title="p.hint" :aria-pressed="model.props === p.id" @click="toggle('props', p.id)">{{ p.label }}</button>
          </div>
        </div>
        <details class="more">
          <summary>Omgeving verfijnen</summary>
          <div class="grid gap-3 pt-4">
            <div class="flex flex-wrap gap-2">
              <button v-for="e in ENVIRONMENTS" :key="e.id" type="button" class="chip" :aria-pressed="model.environment === e.id && !model.environmentCustom" @click="toggle('environment', e.id); model.environmentCustom = ''">{{ e.label }}</button>
            </div>
            <input v-model="model.environmentCustom" class="input max-w-2xl" maxlength="400" placeholder="Of beschrijf de omgeving zelf, bijvoorbeeld: een betonnen vensterbank in een loft" />
          </div>
        </details>
      </template>

      <div v-else-if="model.backdrop" class="grid max-w-4xl gap-5 lg:grid-cols-[1fr_15rem]">
        <div class="grid content-start gap-4">
          <div class="field" data-backdrop-source><span>Kleur</span>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span class="stops" aria-hidden="true"><span v-for="(c, i) in backdropColors" :key="i" class="stop" :style="{ background: c }" /></span>
              <span class="text-sm">{{ backdropSource }}</span>
              <button v-if="!backdropFromPalette" type="button" class="btn btn-quiet btn-sm" @click="backdropToPalette">Naar je kleuren</button>
            </div>
          </div>
          <div class="flex flex-wrap gap-x-8 gap-y-3">
            <div class="field"><span>Textuur</span>
              <div class="segmented self-start"><button v-for="t in BACKDROP_TEXTURES" :key="t.id" type="button" :aria-pressed="(model.backdrop.texture ?? 'none') === t.id" @click="setBackdrop({ texture: t.id })">{{ t.label }}</button></div>
            </div>
            <div class="field"><span>Schaduw</span>
              <div class="segmented self-start"><button v-for="t in BACKDROP_SHADOWS" :key="t.id" type="button" :aria-pressed="(model.backdrop.shadow ?? 'soft') === t.id" @click="setBackdrop({ shadow: t.id })">{{ t.label }}</button></div>
            </div>
          </div>
          <p class="max-w-xl text-xs text-graphite">Het model zet het object voor een magenta sleutelscherm; de studio vervangt dat daarna door precies deze kleuren. De schaduw van het object blijft, het object en je ontwerp worden niet aangeraakt. Een object dat zelf magenta of roze is, past daarom minder goed bij deze stijl.</p>
        </div>
        <div class="backdrop-preview" :style="backdropCss" aria-label="Voorbeeld van de achtergrond" role="img">
          <span class="tex" :class="`tex-${model.backdrop.texture ?? 'none'}`" />
          <span class="object" />
          <span class="shadow" :class="model.backdrop.shadow ?? 'soft'" />
        </div>
      </div>
    </section>

    <!-- Kleuren: meerdere merkkleuren, elk met een eigen plek in de scène -->
    <section class="grid gap-4" data-section="colors">
      <h3 class="text-base">Kleuren</h3>
      <p class="max-w-2xl text-sm text-graphite">{{ flat
        ? 'Bij een platte achtergrond zet de studio de achtergrond exact in je kleur voor Achtergrond of Gradient. Ondergrond, objecten, accenten en verlichting gelden voor een scène.'
        : 'Je merkkleuren in de omgeving. Kies per kleur waar hij terugkomt; je ontwerp op het vlak blijft precies zoals je het aanlevert.' }}</p>
      <PaletteEditor v-model="palette" :flat="flat" :props-none="model.props === 'none'" :conflict="conflictHex" />
      <div v-if="colorWarning" class="notice notice-error flex max-w-2xl flex-wrap items-center gap-x-4 gap-y-2 text-sm" role="alert">
        <span class="min-w-0 flex-1">{{ colorWarning }}</span>
        <button type="button" class="btn btn-secondary btn-sm" @click="model.surfaceMethod = 'blank'">Leeg vlak gebruiken</button>
      </div>
    </section>

    <!-- Camera en compositie -->
    <section class="grid gap-4">
      <h3 class="text-base">{{ device3d ? 'Compositie' : 'Camerastandpunt en compositie' }}</h3>
      <div v-if="!device3d" class="flex flex-wrap gap-2">
        <button v-for="a in ANGLES" :key="a.id" type="button" class="chip" :aria-pressed="model.angle === a.id" @click="toggle('angle', a.id)">{{ a.label }}</button>
      </div>
      <details class="more">
        <summary>Compositie verfijnen</summary>
        <div class="grid gap-4 pt-4 sm:grid-cols-2">
          <div class="field"><span>Negatieve ruimte</span>
            <div class="segmented self-start"><button v-for="n in NEGATIVE_SPACE" :key="n.id" type="button" :aria-pressed="model.negativeSpace === n.id" @click="toggle('negativeSpace', n.id)">{{ n.label }}</button></div>
          </div>
          <div class="field"><span>Opbouw</span>
            <div class="segmented self-start"><button v-for="n in SYMMETRY" :key="n.id" type="button" :aria-pressed="model.symmetry === n.id" @click="toggle('symmetry', n.id)">{{ n.label }}</button></div>
          </div>
          <label class="field sm:col-span-2"><span>Eigen compositie</span><input v-model="model.compositionCustom" class="input" maxlength="400" placeholder="Bijvoorbeeld: laptop in de rechter derde, horizon laag" /></label>
        </div>
      </details>
    </section>

    <!-- Licht -->
    <section class="grid gap-4">
      <h3 class="text-base">Belichting en sfeer</h3>
      <div class="flex flex-wrap gap-2">
        <button v-for="l in LIGHTING" :key="l.id" type="button" class="chip" :aria-pressed="model.lighting === l.id" @click="toggle('lighting', l.id)">{{ l.label }}</button>
      </div>
      <div class="grid max-w-2xl gap-4 sm:grid-cols-2">
        <div class="field">
          <span class="flex items-center justify-between">
            <label class="flex items-center gap-2"><input v-model="useTemperature" type="checkbox" class="check" />Kleurtemperatuur</label>
            <span v-if="useTemperature" class="text-graphite">{{ model.colorTemperature }} K, {{ temperatureWord }}</span>
          </span>
          <input v-model.number="model.colorTemperature" type="range" min="2700" max="7500" step="100" class="range temp" :disabled="!useTemperature" aria-label="Kleurtemperatuur" />
        </div>
        <div class="field"><span>Schaduwen</span>
          <div class="segmented self-start"><button v-for="s in SHADOWS" :key="s.id" type="button" :aria-pressed="model.shadows === s.id" @click="toggle('shadows', s.id)">{{ s.label }}</button></div>
        </div>
      </div>
    </section>

    <!-- Stijl -->
    <section class="grid gap-4">
      <h3 class="text-base">Fotografische stijl</h3>
      <div class="flex flex-wrap gap-2">
        <button v-for="s in STYLES" :key="s.id" type="button" class="chip" :aria-pressed="model.style === s.id" @click="toggle('style', s.id)">{{ s.label }}</button>
      </div>
    </section>

    <!-- Formaat -->
    <section class="grid gap-4">
      <h3 class="text-base">Formaat en uitsnede</h3>
      <div class="flex flex-wrap gap-2">
        <button v-for="a in ASPECTS" :key="a.id" type="button" class="tile aspect-tile" :aria-pressed="model.aspect === a.id" @click="model.aspect = a.id">
          <span class="ratio" :style="ratioStyle(a.ratio)" />
          <span class="text-xs">{{ a.label }}</span>
        </button>
      </div>
      <div class="flex flex-wrap gap-x-8 gap-y-3">
        <div class="field"><span>Resolutie</span>
          <div class="segmented self-start"><button v-for="r in RESOLUTIONS" :key="r.id" type="button" :aria-pressed="model.resolution === r.id" @click="model.resolution = r.id">{{ r.label }}</button></div>
        </div>
        <div class="field"><span>Kwaliteit</span>
          <div class="segmented self-start">
            <button type="button" :aria-pressed="model.quality === 'low'" @click="model.quality = 'low'">Snel concept</button>
            <button type="button" :aria-pressed="model.quality === 'medium'" @click="model.quality = 'medium'">Normaal</button>
            <button type="button" :aria-pressed="model.quality === 'high'" @click="model.quality = 'high'">Hoog</button>
          </div>
        </div>
      </div>
    </section>

    <!-- Instructies -->
    <section class="grid gap-4">
      <h3 class="text-base">Extra instructies</h3>
      <textarea v-model="model.instructions" class="input max-w-3xl" maxlength="2000" rows="5" placeholder="Een zilveren laptop op een donkerbruin houten bureau, gefotografeerd vanuit een lage hoek. Links valt warm zonlicht naar binnen. Veel negatieve ruimte rechts van de laptop." />
      <div class="grid gap-3">
        <h4 class="text-sm font-medium">Vermijd</h4>
        <div class="flex flex-wrap gap-2">
          <button v-for="a in AVOID" :key="a.id" type="button" class="chip" :aria-pressed="(model.avoid ?? []).includes(a.id)" @click="toggleAvoid(a.id)">{{ a.label }}</button>
        </div>
        <input v-model="model.avoidCustom" class="input max-w-2xl" maxlength="400" placeholder="Nog iets uitsluiten, bijvoorbeeld: geen koffiekopjes" />
      </div>
    </section>

    <!-- Referenties -->
    <section class="grid gap-4">
      <h3 class="text-base">Referentiebeelden</h3>
      <p class="max-w-2xl text-sm text-graphite">Optioneel. Een referentie stuurt de sfeer van de scène; de inhoud van je ontwerp komt er nooit uit. {{ supportsReferences ? '' : 'De huidige provider gebruikt geen referentiebeelden.' }}</p>
      <div v-if="references.length" class="flex flex-wrap gap-3">
        <button v-for="r in references" :key="r.id" type="button" class="ref" :aria-pressed="(model.referenceAssetIds ?? []).includes(r.id)" @click="toggleRef(r.id)">
          <img :src="r.previewUrl" :alt="r.originalName" class="h-20 w-28 rounded-sm object-cover" />
        </button>
      </div>
      <DesignImport v-if="projectId" :project-id="projectId" kind="reference" @added="(a) => { emit('references-added', a); a.forEach((x) => toggleRef(x.id)); }" />
      <div v-if="(model.referenceAssetIds ?? []).length" class="grid gap-2">
        <h4 class="text-sm font-medium">Gebruik de referentie voor</h4>
        <div class="flex flex-wrap gap-2">
          <button v-for="a in REFERENCE_ASPECTS" :key="a.id" type="button" class="chip" :aria-pressed="(model.referenceAspects ?? []).includes(a.id)" @click="toggleAspect(a.id)">{{ a.label }}</button>
        </div>
      </div>
    </section>

    <!-- Plaatsing -->
    <section v-if="!device3d" class="grid gap-3">
      <h3 class="text-base">Hoe wordt het ontwerpvlak gevonden?</h3>
      <div class="grid max-w-3xl gap-2 sm:grid-cols-2">
        <button type="button" class="tile" :aria-pressed="model.surfaceMethod === 'chroma'" @click="model.surfaceMethod = 'chroma'">
          <span class="font-medium">Automatisch</span>
          <small>Het model maakt het vlak egaal groen. De studio vindt de hoeken, licht en voorwerpen ervoor, en plaatst je ontwerp er exact in.</small>
        </button>
        <button type="button" class="tile" :aria-pressed="model.surfaceMethod === 'blank'" @click="model.surfaceMethod = 'blank'">
          <span class="font-medium">Leeg vlak, zelf aanwijzen</span>
          <small>Het model laat het vlak blanco. Natuurlijker licht op het object, maar je wijst de hoeken zelf aan.</small>
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import type { AssetView } from '~/utils/types';
import {
  ANGLES, ASPECTS, AVOID, CATEGORIES, ENVIRONMENTS, FINISHES, FRAMING, LIGHTING, NEGATIVE_SPACE, POSITIONS,
  REFERENCE_ASPECTS, RESOLUTIONS, SHADOWS, STYLES, SYMMETRY, MATERIALS, findObject,
} from '~~/shared/catalog';
import {
  BACKDROP_DIRECTIONS, BACKDROP_SHADOWS, BACKDROP_TEXTURES, GROUNDS, PROPS, SCENE_PRESETS, SCENE_TYPES,
  chromaConflict, presetMatches, type Backdrop, type ScenePreset,
} from '~~/shared/scene-style';
import { backdropStops, colorsFor, emptyPalette, normalizeSceneColors, type ScenePalette } from '~~/shared/palette';
import { recallPalette, rememberPalette } from '~/composables/usePaletteMemory';
import { CAMERA_PRESETS, applyCameraPreset, defaultDeviceSpec, deviceModelFor, matchingPreset, type Device3DSpec, defaultStatusBar } from '~~/shared/device3d/spec';
import { DESIGN_SIZE_MAX, DESIGN_SIZE_MIN, isValidSize, orientationOf, ratioLabel, sizeMode, sizeNote, type DesignSize } from '~~/shared/design-size';
import type { SceneConfig } from '~~/shared/types';

const model = defineModel<SceneConfig>({ required: true });
// Meerdere wijzigingen in dezelfde tik (bijvoorbeeld het 3D-model en de onthouden kleuren bij het openen) bouwen op
// elkaar voort: de prop wordt pas bij de volgende render bijgewerkt, dus zonder dit zou de laatste de eerste wissen.
let pending: SceneConfig | null = null;
const current = () => pending ?? model.value;
function write(next: SceneConfig) {
  if (!pending) nextTick(() => { pending = null; });
  pending = next;
  model.value = next;
}
const props = defineProps<{ projectId?: string | null; references: AssetView[]; supportsReferences: boolean; designAsset?: AssetView | null }>();
const emit = defineEmits<{ 'references-added': [assets: AssetView[]] }>();
const uid = useId();

const objects = computed(() => CATEGORIES.find((c) => c.id === model.value.category)?.objects ?? []);

// Echt 3D-device: standaard aan voor objecten met een 3D-model; de keuze voor de AI blijft staan bij wisselen.
const deviceModel = computed(() => deviceModelFor(model.value.objectType));
const device3d = computed(() => (deviceModel.value && model.value.device3d ? model.value.device3d : null));
const prefer3d = ref(true);
const POSE_LABEL: Record<string, string> = { flat: 'Plat', upright: 'Rechtop', standing: 'Staand' };
function setDevice(spec: Device3DSpec | null) { write({ ...current(), device3d: spec }); }
function set3d(on: boolean) {
  prefer3d.value = on;
  setDevice(on && deviceModel.value ? defaultDeviceSpec(deviceModel.value.id, matchingPreset(model.value.device3d ?? defaultDeviceSpec(deviceModel.value.id)) ?? 'perspective') : null);
}
// device3d: undefined = nog niet gekozen (dan het 3D-model), null = bewust door de AI, anders de instellingen.
// Ook als de pagina de configuratie vervangt (hergebruik, project wisselen) blijft dat kloppen.
watch(() => [model.value.objectType, model.value.device3d] as const, ([, d3]) => {
  const m = deviceModel.value;
  if (!m) { if (d3) setDevice(null); return; }
  if (d3 === null) return;
  if (d3 && d3.model === m.id) return;
  if (d3 || prefer3d.value) setDevice(defaultDeviceSpec(m.id, d3 ? matchingPreset(d3) ?? 'perspective' : 'perspective'));
}, { immediate: true });
const previewSize = computed(() => {
  const [a, b] = (model.value.aspect ?? '3:2').split(':').map(Number);
  return { width: 900, height: Math.round((900 * (b || 2)) / (a || 3)) };
});
const materialOptions = computed(() => findObject(model.value.objectType)?.object.materials ?? MATERIALS);
function setCategory(id: string) {
  model.value.category = id;
  model.value.objectType = CATEGORIES.find((c) => c.id === id)!.objects[0]!.id;
}
type Key = 'environment' | 'angle' | 'lighting' | 'style' | 'negativeSpace' | 'symmetry' | 'shadows' | 'sceneType' | 'ground';
function toggle(key: Key | 'props', id: string) { (model.value as unknown as Record<string, unknown>)[key] = model.value[key] === id ? undefined : id; }

// Afmetingen van het ontwerp. Zonder eigen invoer nemen ze die van het gekozen ontwerp over.
const mode = computed(() => sizeMode(model.value.objectType));
const draft = reactive<{ w: number | null; h: number | null }>({ w: model.value.designSize?.width ?? null, h: model.value.designSize?.height ?? null });
const touched = ref(!!model.value.designSize);
const sizeW = computed(() => draft.w);
const sizeH = computed(() => draft.h);
const validSize = computed<DesignSize | null>(() => (isValidSize({ width: draft.w ?? 0, height: draft.h ?? 0 }) ? { width: draft.w!, height: draft.h! } : null));
const sizeError = computed(() => {
  if (draft.w === null && draft.h === null) return '';
  if (!draft.w || !draft.h) return 'Vul zowel de breedte als de hoogte in.';
  return validSize.value ? '' : `Gebruik hele pixels tussen ${DESIGN_SIZE_MIN} en ${DESIGN_SIZE_MAX.toLocaleString('nl-NL')}.`;
});
const orientationText = computed(() => {
  const o = validSize.value ? orientationOf(validSize.value) : null;
  return o === 'portrait' ? 'Staand' : o === 'landscape' ? 'Liggend' : 'Vierkant';
});
const previewBox = computed(() => {
  const s = validSize.value!;
  const max = 44, r = s.width / s.height;
  return { width: `${r >= 1 ? max : Math.max(6, max * r)}px`, height: `${r >= 1 ? Math.max(6, max / r) : max}px` };
});
const matchesAsset = computed(() => !!props.designAsset && draft.w === props.designAsset.width && draft.h === props.designAsset.height);
function commitSize() { write({ ...current(), designSize: validSize.value ?? undefined }); }
function setSize(which: 'w' | 'h', raw: string) {
  const v = raw.trim() === '' ? null : Math.round(Number(raw));
  draft[which] = v !== null && Number.isFinite(v) ? v : null;
  touched.value = true;
  commitSize();
}
function swapSize() { [draft.w, draft.h] = [draft.h, draft.w]; touched.value = true; commitSize(); }
function fromAsset() {
  const a = props.designAsset;
  if (!a) return;
  draft.w = Math.max(DESIGN_SIZE_MIN, Math.min(DESIGN_SIZE_MAX, Math.round(a.width)));
  draft.h = Math.max(DESIGN_SIZE_MIN, Math.min(DESIGN_SIZE_MAX, Math.round(a.height)));
  commitSize();
}
function clearSize() { draft.w = null; draft.h = null; touched.value = true; commitSize(); }
// Een ander ontwerp gekozen en nog niets zelf ingevuld: de maten van dat ontwerp gebruiken.
watch(() => props.designAsset?.id, () => { if (!touched.value) fromAsset(); }, { immediate: true });
// Een hergebruikte configuratie brengt eigen afmetingen mee.
watch(() => model.value.designSize, (s) => {
  if (s && (s.width !== draft.w || s.height !== draft.h)) { draft.w = s.width; draft.h = s.height; touched.value = true; }
});

// Kleuren. Het palet is de enige plek waar kleuren worden ingesteld; de platte achtergrond volgt het palet.
// Een configuratie van vóór het palet (één merkkleur, eigen achtergrondkleuren) wordt hier eenmalig omgezet.
watch(() => model.value, (m) => {
  const legacy = m as SceneConfig & { brandColor?: string; brandColorUse?: string[] };
  if (!m.palette || legacy.brandColor !== undefined || legacy.brandColorUse !== undefined) write(normalizeSceneColors({ ...current(), ...m }));
}, { immediate: true });
const palette = computed<ScenePalette>({
  get: () => model.value.palette ?? emptyPalette(),
  set: (p) => {
    write(normalizeSceneColors({ ...current(), palette: p }));
    rememberPalette(props.projectId, p);
  },
});
/** Merkkleuren per project onthouden in deze browser; alleen invullen als deze configuratie zelf geen kleuren heeft. */
function restorePalette() {
  if (model.value.palette?.colors.length || !props.projectId) return;
  const p = recallPalette(props.projectId);
  if (p?.colors.length) write(normalizeSceneColors({ ...current(), palette: p }));
}
onMounted(restorePalette);
watch(() => props.projectId, restorePalette);
const conflictHex = computed(() => chromaConflict(model.value));
/** Een groene kleur botst met het groene vlak dat de studio zoekt; zeg dat vóór het genereren. */
const colorWarning = computed(() => conflictHex.value
  ? `${conflictHex.value} lijkt te veel op het groene vlak waarmee de studio het ontwerpvlak automatisch vindt. Kies een andere tint, of laat het model het vlak leeg en wijs de hoeken zelf aan.`
  : '');

// Presets en presentatie.
function applyPreset(p: ScenePreset) {
  // Een platte preset neemt je kleuren voor Achtergrond of Gradient over als je die hebt; anders de kleuren van de preset.
  write(normalizeSceneColors({ ...current(), ...JSON.parse(JSON.stringify(p.config)) }));
}
const flat = computed(() => !!model.value.backdrop);
const lastBackdrop = ref<Backdrop | null>(null);
function setFlat(on: boolean) {
  if (on === flat.value) return;
  if (on) write(normalizeSceneColors({ ...current(), backdrop: lastBackdrop.value ?? { mode: 'solid', color: '#e8e2d9', texture: 'none', shadow: 'soft' } }));
  else { lastBackdrop.value = model.value.backdrop ?? null; write({ ...current(), backdrop: null }); }
}
function setBackdrop(part: Partial<Backdrop>) { write({ ...current(), backdrop: { ...current().backdrop!, ...part } }); }
const backdropColors = computed(() => (model.value.backdrop ? backdropStops(model.value.backdrop) : []));
/** Komt de achtergrond uit het palet, of (nog) van de look of de standaardkleur? */
const backdropFromPalette = computed(() => colorsFor(palette.value, 'gradient').length >= 2 || colorsFor(palette.value, 'background').length > 0);
const backdropSource = computed(() => {
  const b = model.value.backdrop;
  if (!b) return '';
  if (backdropFromPalette.value) {
    if (b.mode === 'gradient') return `Gradient uit je kleuren, ${BACKDROP_DIRECTIONS.find((d) => d.id === (b.direction ?? 'vertical'))!.label.toLowerCase()}`;
    return `${b.color}, je kleur voor de achtergrond`;
  }
  return `${backdropColors.value.join(' naar ')}. Zet hem in je kleuren om hem aan te passen.`;
});
/** De huidige achtergrond als kleuren in het palet, zodat je hem daar kunt aanpassen. */
function backdropToPalette() {
  const b = model.value.backdrop;
  if (!b) return;
  const stops = backdropStops(b);
  const rest = palette.value.colors.filter((c) => c.role !== 'background' && c.role !== 'gradient');
  palette.value = b.mode === 'gradient' && stops.length >= 2
    ? { colors: [...stops.map((hex) => ({ hex, role: 'gradient' as const })), ...rest], gradient: { direction: b.direction ?? 'vertical' } }
    : { ...palette.value, colors: [{ hex: b.color, role: 'background' as const }, ...rest] };
}
const backdropCss = computed(() => {
  const b = model.value.backdrop;
  if (!b) return {};
  const stops = backdropStops(b);
  if (b.mode !== 'gradient' || stops.length < 2) return { background: b.color };
  const dir: Record<string, string> = { vertical: '180deg', horizontal: '90deg', diagonal: '135deg' };
  return { background: b.direction === 'radial' ? `radial-gradient(circle at 50% 50%, ${stops.join(', ')})` : `linear-gradient(${dir[b.direction ?? 'vertical']}, ${stops.join(', ')})` };
});
function toggleIn(key: 'avoid' | 'referenceAssetIds' | 'referenceAspects', id: string) {
  const list = new Set(model.value[key] ?? []);
  list.has(id) ? list.delete(id) : list.add(id);
  model.value[key] = [...list];
}
const toggleAvoid = (id: string) => toggleIn('avoid', id);
const toggleRef = (id: string) => toggleIn('referenceAssetIds', id);
const toggleAspect = (id: string) => toggleIn('referenceAspects', id);

const useTemperature = computed({
  get: () => !!model.value.colorTemperature,
  set: (v: boolean) => (model.value.colorTemperature = v ? 4500 : undefined),
});
const temperatureWord = computed(() => {
  const k = model.value.colorTemperature ?? 0;
  return k <= 3300 ? 'warm' : k <= 4800 ? 'licht warm' : k <= 6000 ? 'neutraal daglicht' : 'koel';
});
function ratioStyle(r: number) {
  const max = 30;
  return { width: `${r >= 1 ? max : max * r}px`, height: `${r >= 1 ? max / r : max}px` };
}
</script>

<style scoped>
.more summary { cursor: pointer; font-size: var(--text-sm); color: var(--color-graphite); list-style: none; display: inline-flex; gap: 0.4rem; align-items: center; }
.more summary::before { content: ''; width: 6px; height: 6px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(-45deg); transition: transform 120ms; }
.more[open] summary::before { transform: rotate(45deg); }
.more summary:hover { color: var(--color-ink); }
.unit { position: relative; display: block; }
.unit .input { padding-right: 2.1rem; font-variant-numeric: tabular-nums; }
.unit > span { position: absolute; right: 0.7rem; top: 50%; transform: translateY(-50%); font-size: var(--text-xs); color: var(--color-graphite); pointer-events: none; }
.unit input::-webkit-outer-spin-button, .unit input::-webkit-inner-spin-button { appearance: none; margin: 0; }
.unit input[type='number'] { -moz-appearance: textfield; }
.size-preview { display: grid; place-items: center; width: 3.5rem; height: 3.5rem; border-radius: var(--radius-sm); background: var(--color-paper); }
.size-box { display: block; border: 1.5px solid var(--color-cyan); border-radius: 2px; background: var(--color-cyan-soft); transition: width 160ms var(--ease-studio), height 160ms var(--ease-studio); }
.aspect-tile { width: 6.5rem; justify-items: center; gap: 0.5rem; padding: 0.8rem 0.4rem 0.6rem; }
.ratio { display: block; border: 1.5px solid var(--color-ink); border-radius: 2px; }
.aspect-tile[aria-pressed='true'] .ratio { border-color: var(--color-cyan); background: var(--color-cyan-soft); }
.ref { border-radius: var(--radius-sm); outline: 2px solid transparent; outline-offset: 2px; }
.ref[aria-pressed='true'] { outline-color: var(--color-cyan); }
.temp { accent-color: var(--color-cyan); background: linear-gradient(90deg, #f3b46b, #fff3e3, #cfe3ff); border-radius: 999px; height: 6px; appearance: none; }
.temp:disabled { opacity: 0.4; }
.presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(12.5rem, 1fr)); gap: 0.5rem; max-width: 64rem; }
.preset { display: flex; align-items: center; gap: 0.75rem; padding: 0.6rem 0.75rem 0.6rem 0.6rem; border: 1px solid var(--color-rule); border-radius: var(--radius-md); background: var(--color-white); transition: border-color 120ms; }
.preset:hover { border-color: var(--color-rule-strong); }
.preset[aria-pressed='true'] { border-color: var(--color-cyan); box-shadow: inset 0 0 0 1px var(--color-cyan); }
.preset-swatch { flex: none; width: 2.5rem; height: 2.5rem; border-radius: var(--radius-sm); box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.08); }
.stops { display: inline-flex; }
.stop { width: 1.75rem; height: 1.75rem; border-radius: var(--radius-sm); box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.12); }
.stop + .stop { margin-left: -0.45rem; box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.12), -2px 0 0 var(--color-white); }
.backdrop-preview { position: relative; aspect-ratio: 4 / 3; border-radius: var(--radius-md); overflow: hidden; box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.08); }
.backdrop-preview .object { position: absolute; left: 50%; top: 50%; width: 34%; height: 46%; transform: translate(-50%, -56%); border-radius: 6px; background: linear-gradient(160deg, #3a3b3e, #1d1e20); box-shadow: inset 0 0 0 3px #2a2b2e; }
.backdrop-preview .object::after { content: ''; position: absolute; inset: 7%; border-radius: 2px; background: #f4f2ee; }
.backdrop-preview .shadow { position: absolute; left: 50%; top: 73%; width: 40%; height: 7%; transform: translateX(-50%); border-radius: 50%; background: rgb(0 0 0 / 0.28); filter: blur(7px); }
.backdrop-preview .shadow.hard { filter: blur(1.5px); background: rgb(0 0 0 / 0.32); transform: translateX(-38%) skewX(-30deg); }
.backdrop-preview .shadow.none { display: none; }
.tex { position: absolute; inset: 0; pointer-events: none; }
.tex-grain { opacity: 0.18; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E"); mix-blend-mode: multiply; }
.tex-paper { opacity: 0.22; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.035 .06' numOctaves='3'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)'/%3E%3C/svg%3E"); mix-blend-mode: soft-light; }
.tex-none { display: none; }
.temp::-webkit-slider-thumb { appearance: none; width: 16px; height: 16px; border-radius: 50%; background: var(--color-white); border: 1.5px solid var(--color-ink); }
.temp::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: var(--color-white); border: 1.5px solid var(--color-ink); }
.device-preview { border-radius: var(--radius-md); box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.08); align-self: start; }
.chip.finish { display: inline-flex; align-items: center; gap: 0.45rem; }
.chip .dot { width: 0.8rem; height: 0.8rem; border-radius: 50%; box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.18); }
</style>
