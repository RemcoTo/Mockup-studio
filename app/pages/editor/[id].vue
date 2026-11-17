<template>
  <div v-if="data" class="editor grid h-dvh grid-rows-[auto_1fr] overflow-hidden bg-surround">
    <!-- Bovenbalk -->
    <header class="flex h-14 items-center gap-2 border-b border-rule bg-surround px-3 sm:px-4">
      <NuxtLink :to="`/projects/${data.mockup.projectId}?tab=mockups`" class="btn btn-quiet btn-sm" title="Terug naar het project"><Icon name="back" :size="15" /><span class="hidden sm:inline">{{ data.project?.name }}</span></NuxtLink>
      <span class="hidden truncate text-sm text-graphite md:inline">{{ data.scene.title }}</span>
      <div class="mx-auto segmented shrink-0" aria-label="Weergave">
        <button :aria-pressed="view === 'result'" @click="view = 'result'">Resultaat</button>
        <button :aria-pressed="view === 'scene'" @click="view = 'scene'">Scène</button>
        <button :aria-pressed="view === 'original'" :disabled="!activeAsset" @click="view = 'original'">Origineel</button>
      </div>
      <div class="flex items-center gap-0.5">
        <button class="btn btn-quiet btn-sm hidden sm:inline-flex" :disabled="!canUndo" title="Ongedaan maken (Ctrl+Z)" aria-label="Ongedaan maken" @click="undo"><Icon name="undo" :size="15" /></button>
        <button class="btn btn-quiet btn-sm hidden sm:inline-flex" :disabled="!canRedo" title="Opnieuw (Ctrl+Shift+Z)" aria-label="Opnieuw" @click="redo"><Icon name="redo" :size="15" /></button>
        <span class="mx-1 hidden h-5 w-px bg-rule sm:block" />
        <button class="btn btn-quiet btn-sm hidden sm:inline-flex" title="Uitzoomen" @click="zoomBy(1 / 1.25)"><Icon name="zoomout" :size="15" /></button>
        <button class="btn btn-quiet btn-sm hidden w-14 sm:inline-flex" title="Passend maken" @click="zoom = 'fit'">{{ Math.round(scale * 100) }}%</button>
        <button class="btn btn-quiet btn-sm hidden sm:inline-flex" title="Inzoomen" @click="zoomBy(1.25)"><Icon name="zoomin" :size="15" /></button>
        <button class="btn btn-quiet btn-sm hidden md:inline-flex" title="Inzoomen op het vlak" :disabled="!activePlacement" @click="zoomToSurface"><Icon name="corners" :size="15" /></button>
        <button class="btn btn-sm hidden md:inline-flex" :class="compare ? 'btn-secondary' : 'btn-quiet'" title="Vergelijk scène en resultaat" :aria-pressed="compare" @click="compare = !compare; view = 'result'">Vergelijken</button>
        <span class="ml-2 hidden w-24 text-right text-xs text-graphite lg:inline" aria-live="polite">{{ saveState }}</span>
        <button class="btn btn-primary btn-sm ml-2" :disabled="!placements.length" aria-label="Exporteren" @click="exportOpen = true"><Icon name="download" :size="15" /><span class="hidden sm:inline">Exporteren</span></button>
      </div>
    </header>

    <div class="grid min-h-0 lg:grid-cols-[1fr_340px]">
      <!-- Werkvlak -->
      <div ref="stageEl" class="stage relative min-h-[50vh] overflow-auto" :data-bg="stageBg" @wheel.ctrl.prevent="onWheel">
        <div class="flex min-h-full min-w-full items-center justify-center p-10">
          <div v-if="view === 'original' && activeAsset" class="crop-marks" style="--crop: rgba(255,255,255,.7)">
            <Checker><img :src="activeAsset.previewUrl" :alt="activeAsset.originalName" class="max-h-[75vh] max-w-full object-contain" /></Checker>
          </div>
          <div v-else class="crop-marks" :style="{ width: `${sceneW * scale}px`, height: `${sceneH * scale}px`, '--crop': stageBg === 'light' ? '#3a3b3e' : 'rgba(255,255,255,.75)' }">
            <div class="scene-space" :style="{ width: `${sceneW}px`, height: `${sceneH}px`, transform: `scale(${scale})` }">
              <img :src="data.scene.fileUrl" :alt="data.scene.title" class="absolute inset-0 h-full w-full select-none" draggable="false" />
              <template v-if="view === 'result'">
                <!-- Snelle weergave van een 3D-scherm met statusbalk: de strook boven het ontwerp donker tot de exacte render er is. -->
                <svg v-if="barStrip" class="pointer-events-none absolute inset-0 h-full w-full" :viewBox="`0 0 ${sceneW} ${sceneH}`" aria-hidden="true"><polygon :points="barStrip" fill="#0b0c0e" /></svg>
                <div v-for="(p, i) in placements" v-show="!p.hidden" :key="p.surfaceId" class="absolute inset-0" :style="layerStyle(p)">
                  <div v-for="(c, ci) in layout(p).cells" :key="ci" class="plane" :style="{ width: `${c.w}px`, height: `${c.h}px`, transform: c.transform, background: planeBackground(p) }">
                    <img v-if="p.layout && screenUrls[p.surfaceId]" :src="screenUrls[p.surfaceId]" alt="" class="design" :style="{ width: `${layout(p).surface.width}px`, height: `${layout(p).surface.height}px`, transform: `translate(${-c.x0}px, ${-c.y0}px)` }" draggable="false" />
                    <img v-else-if="!p.layout && assetOf(p)" :src="assetOf(p)!.previewUrl" alt="" class="design" :style="designStyle(p, c.x0, c.y0)" draggable="false" />
                    <div v-if="p.blend.gloss > 0" class="gloss" :style="{ width: `${layout(p).surface.width}px`, height: `${layout(p).surface.height}px`, transform: `translate(${-c.x0}px, ${-c.y0}px)`, background: glossCss(p.blend.gloss) }" />
                  </div>
                  <img v-if="surfaceOf(p)?.shadingUrl && p.blend.shading > 0" :src="surfaceOf(p)!.shadingUrl!" alt="" class="shading" :style="{ opacity: p.blend.shading, clipPath: clipOf(layout(p).outline) }" draggable="false" />
                  <span class="sr-only">Vlak {{ i + 1 }}</span>
                </div>
                <img v-if="exact.url && exact.key === exactKey" :src="exact.url" alt="Voorbeeld" class="absolute inset-0 h-full w-full" draggable="false" />
                <img v-if="compare" :src="data.scene.fileUrl" alt="" class="absolute inset-0 h-full w-full select-none" :style="{ clipPath: `inset(0 ${100 - split}% 0 0)` }" draggable="false" />
              </template>
            </div>

            <!-- Live 3D-weergave tijdens het aanpassen van het device; daarna neemt de exacte render het over. -->
            <ClientOnly>
              <div v-if="live3d && spec3d && data.scene.device3d && view === 'result'" class="absolute inset-0 z-10" data-live3d>
                <Device3DView :model-url="data.scene.device3d.modelUrl" :background-url="data.scene.device3d.backgroundUrl" :spec="spec3d" :width="sceneW" :height="sceneH"
                  :design-url="liveDesign?.previewUrl ?? null" :transform="placements[0]?.transform ?? null" />
              </div>
            </ClientOnly>

            <!-- Hoekpunten en vlakken -->
            <svg v-if="view === 'result'" class="absolute inset-0 h-full w-full" :viewBox="`0 0 ${sceneW} ${sceneH}`" ref="svgEl" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp">
              <g v-for="(p, i) in placements" :key="p.surfaceId">
                <polygon :points="pointsOf(layout(p).outline)" class="quad" :class="{ active: i === active && (cornerMode || meshMode || placements.length > 1) }" @pointerdown="onPlaneDown($event, i)" />
              </g>
              <!-- Bij meerdere vlakken: een nummer op elk vlak, gelijk aan de knoppen in het paneel. Klikken kiest het vlak. -->
              <g v-if="placements.length > 1 && !cornerMode && !meshMode">
                <g v-for="(p, i) in placements" :key="`n${p.surfaceId}`" class="badge" :class="{ on: i === active }" :transform="`translate(${badgeAt(layout(p).outline).join(' ')}) scale(${1 / scale})`" @pointerdown.stop="active = i">
                  <circle r="11" /><text text-anchor="middle" dy="4">{{ i + 1 }}</text>
                </g>
              </g>
              <g v-if="meshMode && activePlacement">
                <polyline v-for="(line, li) in meshLines" :key="`l${li}`" :points="pointsOf(line)" class="meshline" />
                <g v-for="(c, k) in editMesh.points" :key="`m${k}`" class="reg reg-sm" :transform="`translate(${c[0]} ${c[1]}) scale(${1 / scale})`" @pointerdown.stop="onMeshDown($event, k)">
                  <circle r="12" class="hit" /><circle r="5" class="ring" />
                </g>
              </g>
              <g v-if="cornerMode && activePlacement">
                <g v-for="(c, k) in quadOf(activePlacement)" :key="k" class="reg" :transform="`translate(${c[0]} ${c[1]}) scale(${1 / scale})`" @pointerdown.stop="onCornerDown($event, k)">
                  <circle r="16" class="hit" />
                  <circle r="7.5" class="ring" />
                  <path d="M0 -13V13M-13 0H13" class="cross" />
                </g>
              </g>
            </svg>
            <div v-if="compare && view === 'result'" class="divider" :style="{ left: `${split}%` }" @pointerdown="onSplitDown" role="slider" aria-label="Vergelijken" :aria-valuenow="Math.round(split)" tabindex="0" @keydown.left.prevent="split = Math.max(0, split - 5)" @keydown.right.prevent="split = Math.min(100, split + 5)">
              <span class="divider-grip" />
            </div>
          </div>
        </div>
        <p v-if="cornerMode || meshMode" class="hint">{{ cornerMode ? 'Sleep de vier hoeken naar de hoeken van het oppervlak.' : 'Sleep de punten om het ontwerp langs plooien of rondingen te leggen.' }} <button class="underline underline-offset-2" @click="cornerMode = false; meshMode = false">Klaar</button></p>
        <p class="pointer-events-none absolute bottom-3 left-4 flex items-center gap-1.5 text-xs" :class="stageBg === 'light' ? 'text-graphite' : 'text-white/80'"><span v-if="exact.loading" class="spinner" />{{ renderNote }}</p>
        <div class="absolute bottom-3 right-4 segmented bg-white/80" aria-label="Achtergrond werkvlak">
          <button :aria-pressed="stageBg === 'light'" @click="stageBg = 'light'">Licht</button>
          <button :aria-pressed="stageBg === 'grey'" @click="stageBg = 'grey'">Grijs</button>
          <button :aria-pressed="stageBg === 'dark'" @click="stageBg = 'dark'">Donker</button>
        </div>
      </div>

      <!-- Inspector -->
      <aside class="inspector min-h-0 overflow-y-auto border-l border-rule bg-paper">
        <p v-if="readonly" class="notice m-4">Je bekijkt deze mockup als kijker. Je kunt exporteren, maar niets wijzigen.</p>
        <fieldset :disabled="readonly" class="contents">
        <InspectorSection v-if="spec3d && model3d" id="device3d" title="3D-device" :meta="model3d.label">
          <div class="grid gap-4">
            <div class="grid gap-2">
              <div class="flex items-center justify-between"><span class="text-sm">Camerastandpunt</span>
                <button class="link3d text-xs" @click="set3d(resetDeviceSpec(spec3d), true)">Standaardwaarden</button>
              </div>
              <div class="flex flex-wrap gap-1.5" role="group" aria-label="Camerastandpunt">
                <button v-for="c in CAMERA_PRESETS" :key="c.id" class="chip" :aria-pressed="matchingPreset(spec3d) === c.id" @click="set3d(applyCameraPreset(spec3d, c.id), true)">{{ c.label }}</button>
              </div>
            </div>

            <details class="group3d" open>
              <summary>Positie</summary>
              <div class="grid gap-3.5 pt-3">
                <div class="grid gap-3.5">
                  <NumField label="Horizontaal in beeld" :model-value="Math.round(spec3d.frame.x * 1000) / 10" :min="-50" :max="50" :step="0.1" unit="%" @update:model-value="(v) => set3d({ frame: { ...spec3d!.frame, x: v / 100 } })" @commit="commit3d" />
                  <NumField label="Verticaal in beeld" :model-value="Math.round(spec3d.frame.y * 1000) / 10" :min="-50" :max="50" :step="0.1" unit="%" @update:model-value="(v) => set3d({ frame: { ...spec3d!.frame, y: v / 100 } })" @commit="commit3d" />
                </div>
                <div class="grid gap-1.5"><span class="text-sm">Uitlijnen in beeld</span>
                  <div class="flex flex-wrap gap-1.5">
                    <div class="segmented" role="group" aria-label="Horizontaal uitlijnen">
                      <button v-for="a in (['left', 'center', 'right'] as const)" :key="a" @click="align3d('x', a)">{{ ALIGN_LABEL[a] }}</button>
                    </div>
                    <div class="segmented" role="group" aria-label="Verticaal uitlijnen">
                      <button v-for="a in (['top', 'middle', 'bottom'] as const)" :key="a" @click="align3d('y', a)">{{ ALIGN_LABEL[a] }}</button>
                    </div>
                  </div>
                </div>
                <NumField label="X: naar links of rechts" :model-value="cm(spec3d.offset.x)" :min="-60" :max="60" :step="0.1" unit="cm" @update:model-value="(v) => setOffset('x', v)" @commit="commit3d" />
                <NumField label="Y: zweven boven de ondergrond" :model-value="cm(spec3d.offset.y)" :min="0" :max="40" :step="0.1" unit="cm" @update:model-value="(v) => setOffset('y', v)" @commit="commit3d" />
                <NumField label="Z: naar voren of achteren" :model-value="cm(spec3d.offset.z)" :min="-60" :max="60" :step="0.1" unit="cm" @update:model-value="(v) => setOffset('z', v)" @commit="commit3d" />
              </div>
            </details>

            <details class="group3d" open>
              <summary>Rotatie</summary>
              <div class="grid gap-3.5 pt-3">
                <NumField label="Kanteling (X)" :model-value="spec3d.tilt" :min="-30" :max="30" :step="0.5" unit="°" @update:model-value="(v) => set3d({ tilt: v })" @commit="commit3d" />
                <NumField label="Draaiing (Y)" :model-value="spec3d.yaw" :min="-180" :max="180" :step="0.5" unit="°" @update:model-value="(v) => set3d({ yaw: v })" @commit="commit3d" />
                <NumField label="Rolhoek (Z)" :model-value="spec3d.roll" :min="-45" :max="45" :step="0.5" unit="°" @update:model-value="(v) => set3d({ roll: v })" @commit="commit3d" />
              </div>
            </details>

            <details class="group3d" open>
              <summary>Schaal</summary>
              <div class="grid gap-3.5 pt-3">
                <NumField label="Zoom" :model-value="Math.round(spec3d.camera.size * 100)" :min="15" :max="160" unit="%" @update:model-value="(v) => set3d({ camera: { ...spec3d!.camera, size: v / 100 } })" @commit="commit3d" />
                <div class="grid gap-3.5">
                  <NumField label="Breedte in beeld" :model-value="measure3d ? Math.round((measure3d.right - measure3d.left) * 1000) / 10 : null" :min="5" :max="100" :step="0.1" unit="%" :disabled="!measure3d" @update:model-value="(v) => sizeTo('width', v)" @commit="commit3d" />
                  <NumField label="Hoogte in beeld" :model-value="measure3d ? Math.round((measure3d.bottom - measure3d.top) * 1000) / 10 : null" :min="5" :max="100" :step="0.1" unit="%" :disabled="!measure3d" @update:model-value="(v) => sizeTo('height', v)" @commit="commit3d" />
                </div>
                <NumField label="Afstand tot de camera" :model-value="measure3d ? Math.round(measure3d.dist * 1000) / 10 : null" :min="10" :max="800" :step="0.1" unit="cm" :disabled="!measure3d" @update:model-value="distanceTo" @commit="commit3d" />
                <span class="text-xs text-graphite">Breedte en hoogte schalen het device altijd als geheel: de verhoudingen van device en scherm blijven kloppen.</span>
              </div>
            </details>

            <details class="group3d" open>
              <summary>Camera</summary>
              <div class="grid gap-3.5 pt-3">
                <NumField label="Camerahoogte" :model-value="spec3d.camera.elevation" :min="0" :max="90" :step="0.5" unit="°" @update:model-value="(v) => set3d({ camera: { ...spec3d!.camera, elevation: v } })" @commit="commit3d" />
                <NumField label="Beeldhoek" :model-value="spec3d.camera.fov" :min="12" :max="60" :step="0.5" unit="°" @update:model-value="(v) => set3d({ camera: { ...spec3d!.camera, fov: v } })" @commit="commit3d" />
                <NumField label="Brandpuntsafstand" :model-value="Math.round(focalFromFov(spec3d.camera.fov))" :min="22" :max="113" unit="mm" @update:model-value="(v) => set3d({ camera: { ...spec3d!.camera, fov: Math.round(fovFromFocal(v) * 10) / 10 } })" @commit="commit3d" />
                <span class="text-xs text-graphite">Perspectief: een korte brandpuntsafstand (groothoek) geeft sterk perspectief, een lange (tele) een vlak beeld. De grootte in beeld blijft gelijk.</span>
              </div>
            </details>

            <details class="group3d" open>
              <summary>Device</summary>
              <div class="grid gap-3.5 pt-3">
                <NumField v-if="model3d.lid" label="Openingshoek" :model-value="spec3d.lidAngle" :min="model3d.lid.min" :max="model3d.lid.max" unit="°" @update:model-value="(v) => set3d({ lidAngle: v })" @commit="commit3d" />
                <div class="grid gap-2"><span class="text-sm">Afwerking</span>
                  <div class="flex flex-wrap gap-1.5" role="group" aria-label="Afwerking">
                    <button v-for="f in model3d.finishes" :key="f.id" class="chip finish" :aria-pressed="spec3d.finish === f.id" @click="set3d({ finish: f.id }, true)"><span class="dot" :style="{ background: f.body }" />{{ f.label }}</button>
                  </div>
                </div>
                <div v-if="model3d.poses.length > 1" class="grid gap-2"><span class="text-sm">Houding</span>
                  <div class="segmented self-start"><button v-for="p in model3d.poses" :key="p" :aria-pressed="spec3d.pose === p" @click="set3d({ pose: p }, true)">{{ POSE_LABEL[p] }}</button></div>
                </div>
              </div>
            </details>

            <details class="group3d" open data-statusbar>
              <summary>{{ model3d.statusBar.kind === 'desktop' ? 'Menubalk' : 'Statusbalk' }}</summary>
              <div class="grid gap-3 pt-3">
                <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="check" :checked="spec3d.statusBar.show" @change="setBar({ show: ($event.target as HTMLInputElement).checked }, true)" />{{ model3d.statusBar.kind === 'desktop' ? 'Menubalk tonen' : 'Statusbalk tonen' }}</label>
                <template v-if="spec3d.statusBar.show">
                  <div class="grid gap-3" :class="model3d.statusBar.kind === 'phone' ? '' : 'grid-cols-2'">
                    <label class="grid gap-1 text-sm">Tijd<input class="input" :value="spec3d.statusBar.time" maxlength="12" @change="setBar({ time: ($event.target as HTMLInputElement).value }, true)" /></label>
                    <label v-if="model3d.statusBar.kind !== 'phone'" class="grid gap-1 text-sm">Datum<input class="input" :value="spec3d.statusBar.date" maxlength="24" @change="setBar({ date: ($event.target as HTMLInputElement).value }, true)" /></label>
                  </div>
                  <div class="grid gap-1.5"><span class="text-sm">Tekst en iconen</span>
                    <div class="segmented self-start" role="group" aria-label="Tekst en iconen">
                      <button v-for="t in (['auto', 'dark', 'light'] as const)" :key="t" :aria-pressed="spec3d.statusBar.tone === t" @click="setBar({ tone: t }, true)">{{ TONE_LABEL[t] }}</button>
                    </div>
                  </div>
                  <span class="text-xs text-graphite">De balk staat boven je ontwerp, niet eroverheen: het ontwerp past in de ruimte eronder.</span>
                </template>
              </div>
            </details>

            <details class="group3d">
              <summary>Licht, schaduw en reflecties</summary>
              <div class="grid gap-3.5 pt-3">
                <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="check" :checked="spec3d.light.auto" @change="set3d({ light: { ...spec3d!.light, auto: ($event.target as HTMLInputElement).checked } }, true)" />Licht uit de achtergrond afleiden</label>
                <template v-if="!spec3d.light.auto">
                  <NumField label="Richting van het licht" :model-value="spec3d.light.azimuth" :min="-180" :max="180" unit="°" @update:model-value="(v) => set3d({ light: { ...spec3d!.light, azimuth: v } })" @commit="commit3d" />
                  <NumField label="Hoogte van het licht" :model-value="spec3d.light.elevation" :min="5" :max="85" unit="°" @update:model-value="(v) => set3d({ light: { ...spec3d!.light, elevation: v } })" @commit="commit3d" />
                  <NumField label="Warmte" :model-value="Math.round(spec3d.light.warmth * 100)" :min="-100" :max="100" @update:model-value="(v) => set3d({ light: { ...spec3d!.light, warmth: v / 100 } })" @commit="commit3d" />
                </template>
                <NumField label="Sterkte van het licht" :model-value="Math.round(spec3d.light.intensity * 100)" :min="0" :max="200" unit="%" @update:model-value="(v) => set3d({ light: { ...spec3d!.light, intensity: v / 100 } })" @commit="commit3d" />
                <NumField label="Schaduw" :model-value="Math.round(spec3d.shadow * 100)" :min="0" :max="100" unit="%" @update:model-value="(v) => set3d({ shadow: v / 100 })" @commit="commit3d" />
                <NumField label="Reflecties van de omgeving" :model-value="Math.round(spec3d.reflections * 100)" :min="0" :max="100" unit="%" @update:model-value="(v) => set3d({ reflections: v / 100 })" @commit="commit3d" />
              </div>
            </details>
            <p class="flex items-center gap-1.5 text-xs text-graphite" aria-live="polite"><span v-if="busy3d" class="spinner" />{{ busy3d ? 'Exacte render wordt gemaakt…' : note3d || 'Alles wordt bij deze mockup bewaard. Vorm en maten komen uit het 3D-model; je ontwerp staat exact op het scherm.' }}</p>
          </div>
        </InspectorSection>
        <div v-if="!placements.length && data.scene.device3d" class="grid gap-3 p-5">
          <p class="text-sm">Vanuit dit standpunt is het scherm niet te zien. Draai het device of kies een ander camerastandpunt.</p>
        </div>
        <div v-else-if="!placements.length" class="grid gap-3 p-5">
          <p class="text-sm">Deze scène heeft nog geen ontwerpvlak.</p>
          <NuxtLink :to="`/library/${data.scene.id}?back=/editor/${data.mockup.id}`" class="btn btn-primary btn-sm justify-self-start">Hoeken aanwijzen</NuxtLink>
        </div>

        <template v-if="activePlacement">
          <div v-if="placements.length > 1" class="grid gap-2 border-b border-rule px-5 py-4">
            <span class="text-xs text-graphite">Vlak in deze scène</span>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="(p, i) in placements" :key="p.surfaceId" class="surface-chip" :aria-pressed="i === active" @click="active = i">
                <span class="num">{{ i + 1 }}</span>{{ surfaceOf(p)?.label ?? `Vlak ${i + 1}` }}<Icon v-if="p.hidden" name="eye-off" :size="13" class="text-graphite" />
              </button>
            </div>
          </div>

          <p v-if="(surfaceOf(activePlacement)?.quality ?? 1) < 0.85" class="notice m-4 text-sm">Dit vlak is deels afgedekt of niet met zekerheid gevonden. Controleer de hoeken onder Perspectief.</p>

          <InspectorSection v-if="activePlacement.layout" id="mail" title="E-mail" :meta="activePlacement.layout.template === 'mail-desktop' ? 'Laptop' : 'Telefoon'">
            <div class="grid gap-2">
              <span class="text-xs text-graphite">Handtekening</span>
              <div class="grid grid-cols-4 gap-2">
                <button v-for="a in data.assets" :key="a.id" class="pick" :aria-pressed="mailSignature === a.id" :title="a.originalName" :aria-label="`Handtekening: ${a.originalName}`" @click="setMail({ slots: [{ assetId: a.id }] }, true)">
                  <Checker class="aspect-square overflow-hidden rounded-sm"><img :src="a.previewUrl" alt="" class="h-full w-full object-contain p-0.5" /></Checker>
                </button>
                <NuxtLink :to="`/projects/${data.mockup.projectId}`" class="pick grid aspect-square place-items-center rounded-sm border border-dashed border-rule text-graphite hover:text-ink" title="Ontwerp toevoegen in het project"><Icon name="plus" :size="18" /></NuxtLink>
              </div>
            </div>
            <div v-if="mailSignature" class="grid gap-2">
              <div class="flex items-baseline justify-between">
                <label class="text-sm" for="sig-width">Breedte in de e-mail</label>
                <span class="tabular text-xs text-graphite">{{ signatureWidth }} px</span>
              </div>
              <input id="sig-width" type="range" :min="SIGNATURE_WIDTH_MIN" :max="700" step="1" :value="signatureWidth" @input="setMail({ signatureWidth: Number(($event.target as HTMLInputElement).value) })" @change="commit" />
              <div class="flex flex-wrap items-center justify-between gap-2">
                <p class="text-xs text-graphite">{{ activePlacement.layout.signatureWidth ? 'Eigen breedte.' : 'Ware grootte, afgeleid van het bestand.' }} Pixels zoals in een mailprogramma; de verhouding blijft altijd gelijk.</p>
                <button v-if="activePlacement.layout.signatureWidth" class="btn btn-quiet btn-sm" @click="setMail({ signatureWidth: undefined }, true)">Ware grootte</button>
              </div>
            </div>
            <div class="grid gap-2 border-t border-rule pt-3">
              <div class="flex items-center justify-between gap-3">
                <span class="text-sm font-medium">Bericht</span>
                <div class="segmented">
                  <button :aria-pressed="(activePlacement.layout.theme ?? 'light') === 'light'" @click="setMail({ theme: 'light' }, true)">Licht</button>
                  <button :aria-pressed="activePlacement.layout.theme === 'dark'" @click="setMail({ theme: 'dark' }, true)">Donker</button>
                </div>
              </div>
              <p v-if="activePlacement.layout.theme === 'dark'" class="text-xs text-graphite">Zo zie je of de handtekening ook in de donkere modus van een mailprogramma leesbaar blijft.</p>
              <div class="grid grid-cols-2 gap-2">
                <label v-for="f in MAIL_FIELDS" :key="f.key" class="field" :class="f.wide ? 'col-span-2' : ''"><span>{{ f.label }}</span>
                  <textarea v-if="f.key === 'body'" class="input min-h-40 py-1.5 text-sm" :maxlength="f.max" :placeholder="DEFAULT_MAIL.body" :value="mailValue('body')" @input="setMailField('body', ($event.target as HTMLTextAreaElement).value)" @change="commit" />
                  <input v-else class="input h-8 text-sm" :maxlength="f.max" :placeholder="DEFAULT_MAIL[f.key]" :value="mailValue(f.key)" @input="setMailField(f.key, ($event.target as HTMLInputElement).value)" @change="commit" />
                </label>
              </div>
              <span class="text-xs text-graphite">Profielfoto van de afzender</span>
              <div class="flex flex-wrap gap-1.5">
                <button class="avatar-pick" :aria-pressed="!activePlacement.layout.avatar?.assetId" title="Initialen van de naam" aria-label="Profielfoto: initialen van de naam" @click="setMail({ avatar: null }, true)"><span>{{ initialsOf(mailValue('fromName') || DEFAULT_MAIL.fromName) }}</span></button>
                <button v-for="a in data.assets" :key="`av${a.id}`" class="avatar-pick" :aria-pressed="activePlacement.layout.avatar?.assetId === a.id" :title="`Profielfoto: ${a.originalName}`" :aria-label="`Profielfoto: ${a.originalName}`" @click="setMail({ avatar: { assetId: a.id } }, true)"><img :src="a.previewUrl" alt="" /></button>
              </div>
              <p class="text-xs text-graphite">{{ mailScreens > 1 ? 'Het bericht en de handtekening gelden voor alle schermen in deze scène. ' : '' }}Laat een veld leeg voor de voorbeeldtekst.</p>
            </div>
            <button class="btn btn-quiet btn-sm justify-self-start" title="Toont alleen het ontwerp, zonder mailprogramma eromheen" @click="setInterface(false)">Zonder e-mail tonen</button>
          </InspectorSection>

          <InspectorSection v-else id="design" title="Ontwerp" :meta="activeAsset?.originalName ?? 'Geen'">
            <div class="grid grid-cols-4 gap-2">
              <button class="pick" :aria-pressed="!activePlacement.assetId" title="Geen ontwerp op dit vlak" @click="setField('assetId', null, true)">
                <span class="grid aspect-square place-items-center rounded-sm border border-dashed border-rule text-graphite"><Icon name="none" :size="18" /></span>
              </button>
              <button v-for="a in data.assets" :key="a.id" class="pick" :aria-pressed="activePlacement.assetId === a.id" :title="a.originalName" @click="setField('assetId', a.id, true)">
                <Checker class="aspect-square overflow-hidden rounded-sm"><img :src="a.previewUrl" alt="" class="h-full w-full object-contain p-0.5" /></Checker>
              </button>
              <NuxtLink :to="`/projects/${data.mockup.projectId}`" class="pick grid aspect-square place-items-center rounded-sm border border-dashed border-rule text-graphite hover:text-ink" title="Ontwerp toevoegen in het project"><Icon name="plus" :size="18" /></NuxtLink>
            </div>
            <button v-if="surfaceOf(activePlacement)?.kind === 'screen'" class="btn btn-secondary btn-sm justify-self-start" title="Het ontwerp als handtekening onder een e-mail, in een mailprogramma" @click="setInterface(true)">Als e-mailhandtekening tonen</button>
          </InspectorSection>

          <InspectorSection v-if="!activePlacement.layout" id="placement" title="Plaatsing">
            <div class="segmented">
              <button v-for="f in fits" :key="f.id" :aria-pressed="activePlacement.transform.fit === f.id" :title="f.hint" @click="setTransform({ fit: f.id }, true)">{{ f.label }}</button>
            </div>
            <Slider label="Schaal" :model-value="activePlacement.transform.scale * 100" :min="10" :max="400" :step="1" unit="%" @update:model-value="(v) => setTransform({ scale: v / 100 })" @commit="commit" />
            <Slider label="Rotatie" :model-value="activePlacement.transform.rotation" :min="-180" :max="180" :step="0.5" unit="°" @update:model-value="(v) => setTransform({ rotation: v })" @commit="commit" />
            <Slider label="Horizontaal" :model-value="activePlacement.transform.offsetX * 100" :min="-100" :max="100" :step="0.5" unit="%" @update:model-value="(v) => setTransform({ offsetX: v / 100 })" @commit="commit" />
            <Slider label="Verticaal" :model-value="activePlacement.transform.offsetY * 100" :min="verticalMin" :max="100" :step="0.5" unit="%" @update:model-value="(v) => setTransform({ offsetY: v / 100 })" @commit="commit" />
            <p class="text-xs text-graphite">Sleep het ontwerp in het werkvlak om het te verschuiven, pijltjestoetsen voor kleine stappen.</p>
          </InspectorSection>

          <InspectorSection id="perspective" title="Perspectief" :meta="activePlacement.quad ? 'Aangepast' : ''" :open="false">
            <div class="flex flex-wrap gap-1.5">
              <button class="btn btn-sm" :class="cornerMode ? 'btn-primary' : 'btn-secondary'" @click="cornerMode = !cornerMode; meshMode = false"><Icon name="corners" :size="14" />{{ cornerMode ? 'Hoeken klaar' : 'Hoeken aanpassen' }}</button>
              <button class="btn btn-secondary btn-sm" title="Draait het ontwerp een kwartslag op het vlak" @click="rotateSurface"><Icon name="rotate" :size="14" />90°</button>
              <button class="btn btn-quiet btn-sm" :disabled="!activePlacement.quad" @click="setField('quad', null, true)">Terugzetten</button>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <button class="btn btn-sm" :class="meshMode ? 'btn-primary' : 'btn-secondary'" @click="toggleMesh">{{ meshMode ? 'Vervormen klaar' : 'Vrij vervormen' }}</button>
              <button v-if="activePlacement.mesh" class="btn btn-quiet btn-sm" @click="clearMesh">Vervorming wissen</button>
            </div>
            <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="check" :checked="!!currentCylinder" @change="toggleCylinder(($event.target as HTMLInputElement).checked)" />Gebogen oppervlak (mok, fles, blik)</label>
            <template v-if="currentCylinder">
              <Slider label="Ronding" :model-value="currentCylinder.wrap" :min="0" :max="200" unit="°" @update:model-value="(v) => setCylinder({ wrap: v })" @commit="commit" />
              <Slider label="Doorbuiging van de randen" :model-value="currentCylinder.bulge * 100" :min="-30" :max="30" :step="0.5" unit="%" @update:model-value="(v) => setCylinder({ bulge: v / 100 })" @commit="commit" />
            </template>
          </InspectorSection>

          <InspectorSection id="light" title="Licht en materiaal" :open="false">
            <Slider label="Schaduw en licht van de scène" :model-value="activePlacement.blend.shading * 100" :min="0" :max="100" unit="%" @update:model-value="(v) => setBlend({ shading: v / 100 })" @commit="commit" />
            <Slider v-if="surfaceOf(activePlacement)?.detection !== 'manual'" label="Reflecties en glimlicht" :model-value="(activePlacement.blend.reflections ?? 1) * 100" :min="0" :max="100" unit="%" @update:model-value="(v) => setBlend({ reflections: v / 100 })" @commit="commit" />
            <Slider v-if="surfaceOf(activePlacement)?.kind === 'fabric' || activePlacement.blend.displacement > 0" label="Stofstructuur" :model-value="activePlacement.blend.displacement" :min="0" :max="16" :step="0.5" unit="px" @update:model-value="(v) => setBlend({ displacement: v })" @commit="commit" />
            <Slider label="Extra glans" :model-value="activePlacement.blend.gloss * 100" :min="0" :max="60" unit="%" @update:model-value="(v) => setBlend({ gloss: v / 100 })" @commit="commit" />
            <Slider label="Dekking" :model-value="activePlacement.blend.opacity * 100" :min="0" :max="100" unit="%" @update:model-value="(v) => setBlend({ opacity: v / 100 })" @commit="commit" />
            <p v-if="surfaceOf(activePlacement)?.detection !== 'manual'" class="text-xs text-graphite">Reflecties komen uit de scène zelf: glimlicht en spiegelingen op het oppervlak liggen over je ontwerp, zoals op een echte foto.</p>
          </InspectorSection>

          <InspectorSection id="surface" title="Vlak" :open="false">
            <div class="flex items-center justify-between gap-3 text-sm">
              <span>Vulkleur</span>
              <span class="flex items-center gap-2">
                <label v-if="surfaceOf(activePlacement)?.detection === 'manual'" class="flex items-center gap-1.5 text-xs"><input type="checkbox" class="check" :checked="activePlacement.background === 'transparent'" @change="setField('background', ($event.target as HTMLInputElement).checked ? 'transparent' : '#ffffff', true)" />Geen</label>
                <label v-else-if="surfaceOf(activePlacement)?.kind !== 'screen'" class="flex items-center gap-1.5 text-xs" title="Het vlak loopt op in het object eromheen; alleen de print is zichtbaar"><input type="checkbox" class="check" :checked="activePlacement.background === 'auto'" @change="setField('background', ($event.target as HTMLInputElement).checked ? 'auto' : surfaceOf(activePlacement)?.fillColor ?? '#ffffff', true)" />Naadloos</label>
                <input type="color" class="color" :value="/^#/.test(activePlacement.background) ? activePlacement.background : surfaceOf(activePlacement)?.fillColor ?? '#ffffff'" :disabled="!/^#/.test(activePlacement.background)" aria-label="Vulkleur" @input="setField('background', ($event.target as HTMLInputElement).value)" @change="commit" />
              </span>
            </div>
            <label v-if="surfaceOf(activePlacement)?.maskUrl" class="flex items-center gap-2 text-sm"><input type="checkbox" class="check" :checked="activePlacement.useMask" @change="setField('useMask', ($event.target as HTMLInputElement).checked, true)" />Voorwerpen vóór het vlak zichtbaar houden</label>
            <div class="flex flex-wrap gap-1.5">
              <button class="btn btn-secondary btn-sm" @click="setField('hidden', !activePlacement.hidden, true)"><Icon :name="activePlacement.hidden ? 'eye' : 'eye-off'" :size="14" />{{ activePlacement.hidden ? 'Ontwerp tonen' : 'Ontwerp verbergen' }}</button>
              <button class="btn btn-quiet btn-sm" @click="resetPlacement"><Icon name="reset" :size="14" />Alles terugzetten</button>
            </div>
          </InspectorSection>
        </template>

        <InspectorSection id="scene" title="Scène" :meta="data.scene.title" :open="false">
          <div class="flex flex-wrap gap-1.5">
            <button class="btn btn-secondary btn-sm" @click="openPicker('swap')">Andere scène</button>
            <button class="btn btn-secondary btn-sm" @click="openPicker('copy')">Ook op een andere scène</button>
          </div>
          <p class="text-xs text-graphite">{{ data.scene.license }}</p>
        </InspectorSection>
        </fieldset>
      </aside>
    </div>

    <!-- Exporteren -->
    <Transition name="slide">
      <div v-if="exportOpen" class="fixed inset-0 z-40 flex justify-end bg-ink/30" @click.self="exportOpen = false">
        <div class="drawer grid content-start gap-5 overflow-y-auto bg-paper p-6" role="dialog" aria-modal="true" aria-labelledby="export-title">
          <div class="flex items-center justify-between">
            <h2 id="export-title" class="text-lg">Exporteren</h2>
            <button class="btn btn-quiet" aria-label="Sluiten" @click="exportOpen = false"><Icon name="close" /></button>
          </div>
          <div class="grid gap-2">
            <span class="text-sm text-graphite">Bestandstype</span>
            <div class="segmented self-start">
              <button :aria-pressed="exp.format === 'png'" @click="exp.format = 'png'">PNG</button>
              <button :aria-pressed="exp.format === 'jpg'" @click="exp.format = 'jpg'">JPG</button>
              <button :aria-pressed="exp.format === 'tiff'" title="CMYK, 300 dpi, voor drukwerk" @click="exp.format = 'tiff'; exp.preset = ''">TIFF voor druk<span v-if="!has('tiff')" class="plan-tag">Studio</span></button>
            </div>
            <p v-if="exp.format === 'tiff'" class="text-xs text-graphite">CMYK, 300 dpi, zonder verlies gecomprimeerd. Vraag je drukker welk kleurprofiel hij gebruikt.</p>
          </div>
          <Slider v-if="exp.format === 'jpg'" label="Kwaliteit" v-model="exp.quality" :min="60" :max="100" />
          <label v-if="exp.format !== 'tiff'" class="field"><span>Bestemming</span>
            <select v-model="exp.preset" class="input">
              <option value="">Eigen formaat</option>
              <option v-for="pr in EXPORT_PRESETS" :key="pr.id" :value="pr.id">{{ pr.label }}, {{ pr.width }}{{ pr.height ? ` × ${pr.height}` : ' breed' }}</option>
            </select>
          </label>
          <p v-if="upscaleWarning" class="text-xs text-danger">{{ upscaleWarning }}</p>
          <label v-if="!exp.preset" class="field"><span>Formaat</span>
            <select v-model.number="exp.width" class="input">
              <option :value="sceneW">Volledig, {{ sceneW }} × {{ sceneH }} px</option>
              <option :value="Math.round(sceneW / 2)">Half, {{ Math.round(sceneW / 2) }} × {{ Math.round(sceneH / 2) }} px</option>
              <option :value="Math.min(sceneW, 1600)">Web, {{ Math.min(sceneW, 1600) }} px breed</option>
            </select>
          </label>
          <button class="btn btn-primary" :disabled="exporting" @click="doExport"><span v-if="exporting" class="spinner spinner-light" /><Icon v-else name="download" :size="15" />{{ exporting ? 'Bezig met exporteren…' : 'Downloaden' }}</button>
          <p class="text-xs leading-relaxed text-graphite">In elke export staat welk origineel is gebruikt, met een vingerafdruk, en dat het zonder AI-bewerking is geplaatst.</p>
          <div v-if="scrollable" class="grid gap-2 border-t border-rule pt-5">
            <span class="text-sm font-medium">Scrollvideo<span v-if="!has('video')" class="plan-tag">Studio</span></span>
            <p class="text-xs text-graphite">De website scrolt rustig door het scherm, van boven naar onder. MP4, 30 beelden per seconde.</p>
            <div class="flex flex-wrap items-center gap-2">
              <select v-model.number="videoWidth" class="input h-8 w-auto" aria-label="Videoformaat"><option :value="1280">1280 px breed</option><option :value="1920">1920 px breed</option></select>
              <button class="btn btn-secondary btn-sm" :disabled="!!video" @click="makeVideo"><span v-if="video" class="spinner" /><Icon v-else name="image" :size="14" />{{ video ? `Video maken… ${video.elapsed} s` : 'Video maken' }}</button>
            </div>
          </div>
          <div v-if="data.exports.length" class="grid gap-1 border-t border-rule pt-5">
            <span class="text-sm font-medium">Eerdere exports</span>
            <ul class="rule-list text-sm">
              <li v-for="e in data.exports.slice(0, 6)" :key="e.id" class="flex items-center justify-between gap-2 py-2">
                <span class="text-xs text-graphite"><span class="uppercase text-ink">{{ e.format }}</span> {{ e.width }} × {{ e.height }}, {{ timeAgo(e.createdAt) }}</span>
                <a :href="e.downloadUrl" class="btn btn-quiet btn-sm">Downloaden</a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Scène kiezen -->
    <Transition name="fade">
      <div v-if="picker" class="fixed inset-0 z-40 grid place-items-center bg-ink/40 p-4" @click.self="picker = null">
        <div class="max-h-[88vh] w-full max-w-6xl overflow-y-auto rounded-lg bg-surround p-6" role="dialog" aria-modal="true">
          <div class="mb-5 flex items-center justify-between">
            <h2 class="text-lg">{{ picker === 'swap' ? 'Andere scène kiezen' : 'Hetzelfde ontwerp op een andere mockup' }}</h2>
            <button class="btn btn-quiet" aria-label="Sluiten" @click="picker = null"><Icon name="close" /></button>
          </div>
          <ScenePicker :include-project="data.mockup.projectId" :preview-asset-id="activePlacement?.assetId ?? data.mockup.placements.find((p) => p.assetId)?.assetId ?? null" require-surfaces dense :selected-id="data.scene.id" pick-label="Kiezen" @pick="onPick" />
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { api } from '~/composables/useApi';
import { useSession } from '~/composables/useSession';
import { useToast } from '~/composables/useToast';
import { CAMERA_PRESETS, applyCameraPreset, findDeviceModel, focalFromFov, fovFromFocal, matchingPreset, resetDeviceSpec, type Device3DSpec, type StatusBarSpec } from '~~/shared/device3d/spec';
import { measureDevice, type DeviceMeasure } from '~~/shared/device3d/stage';
import { loadDeviceModel } from '~/composables/useDeviceModel';
import { timeAgo, type AssetView, type SurfaceView, type SceneView, type MockupView, type ExportView } from '~/utils/types';
import { findObject, smartFit } from '~~/shared/catalog';
import { cssMatrix3d, designToSurfaceMatrix, homography, invert3, applyH, rectQuad, rotateQuad, surfaceDimensions, type DesignTransform, type Point, type Quad } from '~~/shared/geometry';
import { controlMesh, meshCells, meshFromQuad, meshPoint, meshSurfaceDims, remapMesh, resolveGeometry, rotateMesh, type CylinderParams, type Mesh } from '~~/shared/warp';
import { EXPORT_PRESETS, findPreset } from '~~/shared/export-presets';
import { glossCss } from '~~/shared/gloss';
import { DEFAULT_MAIL, SIGNATURE_WIDTH_MIN, naturalSignatureWidth, newMailLayout, screenCanvasSize, type MailFields, type ScreenLayout } from '~~/shared/mail';
import { renderScreenPreview } from '~/composables/useScreenPreview';
import { DEFAULT_BLEND, DEFAULT_TRANSFORM, type BlendSettings, type Placement } from '~~/shared/types';

definePageMeta({ layout: 'bare' });
const { can, has } = useSession();
const readonly = computed(() => !can('member'));
const route = useRoute();
const toast = useToast();

interface EditorData { mockup: MockupView; scene: SceneView; project: { id: string; name: string } | null; assets: AssetView[]; exports: ExportView[] }
const data = ref<EditorData | null>(null);
const placements = ref<Placement[]>([]);
const active = ref(0);
const view = ref<'result' | 'scene' | 'original'>('result');
const cornerMode = ref(false);
const stageBg = ref<'light' | 'grey' | 'dark'>('grey');
const zoom = ref<'fit' | number>('fit');
const stageEl = ref<HTMLElement | null>(null);
const svgEl = ref<SVGSVGElement | null>(null);
const stageSize = reactive({ w: 800, h: 600 });

const sceneW = computed(() => data.value?.scene.width ?? 1);
const sceneH = computed(() => data.value?.scene.height ?? 1);
const fitScale = computed(() => Math.max(0.05, Math.min((stageSize.w - 80) / sceneW.value, (stageSize.h - 80) / sceneH.value, 1)));
const scale = computed(() => (zoom.value === 'fit' ? fitScale.value : zoom.value));
function zoomBy(f: number) { zoom.value = Math.max(0.05, Math.min(4, scale.value * f)); }
function onWheel(e: WheelEvent) { zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1); }

const activePlacement = computed(() => placements.value[active.value] ?? null);
const activeAsset = computed(() => {
  const p = activePlacement.value;
  if (!p) return null;
  const id = p.layout ? p.layout.slots.find((s) => s.assetId)?.assetId : p.assetId;
  return id ? assetById(id) : null;
});
const assetById = (id: string) => data.value?.assets.find((a) => a.id === id) ?? null;
const surfaceOf = (p: Placement): SurfaceView | undefined => data.value?.scene.surfaces.find((s) => s.id === p.surfaceId);
const assetOf = (p: Placement) => (p.assetId ? data.value?.assets.find((a) => a.id === p.assetId) ?? null : null);
const quadOf = (p: Placement): Quad => p.quad ?? surfaceOf(p)!.quad;
const pointsOf = (q: Point[]) => q.map((c) => c.join(',')).join(' ');
const clipOf = (q: Point[]) => `polygon(${q.map(([x, y]) => `${x}px ${y}px`).join(',')})`;
const centroid = (q: Point[]): Point => [q.reduce((a, p) => a + p[0], 0) / q.length, q.reduce((a, p) => a + p[1], 0) / q.length];
/** Plek voor het vlaknummer: net binnen de hoek linksboven, zodat het ontwerp zelf vrij blijft. */
function badgeAt(q: Point[]): Point {
  const c = centroid(q);
  const tl = q.reduce((b, p) => (p[0] + p[1] < b[0] + b[1] ? p : b), q[0]!);
  const d = Math.hypot(c[0] - tl[0], c[1] - tl[1]) || 1;
  const inset = Math.min(d * 0.5, 26 / scale.value);
  return [tl[0] + ((c[0] - tl[0]) / d) * inset, tl[1] + ((c[1] - tl[1]) / d) * inset];
}

// Live weergave met CSS; dezelfde geometrie als de server-render.
function layerStyle(p: Placement) {
  const s = surfaceOf(p);
  const st: Record<string, string> = { opacity: String(p.blend.opacity) };
  if (p.useMask && s?.maskUrl) Object.assign(st, { maskImage: `url(${s.maskUrl})`, maskSize: '100% 100%', maskMode: 'luminance', WebkitMaskImage: `url(${s.maskUrl})`, WebkitMaskSize: '100% 100%' });
  return st;
}
interface Layout { surface: { width: number; height: number }; cells: { x0: number; y0: number; w: number; h: number; transform: string }[]; outline: Point[]; mesh: Mesh | null }
/** Geometrie van een plaatsing in de live weergave; dezelfde berekening als de export. */
function layout(p: Placement): Layout {
  const s = surfaceOf(p)!;
  const g = resolveGeometry(s, p);
  const img = { width: sceneW.value, height: sceneH.value, aspect: g.aspect };
  if (!g.mesh) {
    const d = surfaceDimensions(g.quad, img);
    return { surface: d, cells: [{ x0: 0, y0: 0, w: d.width, h: d.height, transform: cssMatrix3d(d.width, d.height, g.quad) }], outline: g.quad, mesh: null };
  }
  const surface = meshSurfaceDims(g.mesh, img, g.cylinder);
  // Cellen een fractie groter maken voorkomt haarlijntjes tussen cellen in de browser.
  const cells = meshCells(g.mesh, surface).map((c) => {
    const x0 = c.rect[0][0], y0 = c.rect[0][1], w = c.rect[1][0] - x0, h = c.rect[2][1] - y0;
    return { x0, y0, w: w + 0.6, h: h + 0.6, transform: cssMatrix3d(w, h, c.quad) };
  });
  const m = g.mesh;
  const outline: Point[] = [
    ...Array.from({ length: m.cols + 1 }, (_, c) => meshPoint(m, c, 0)),
    ...Array.from({ length: m.rows }, (_, r) => meshPoint(m, m.cols, r + 1)),
    ...Array.from({ length: m.cols }, (_, c) => meshPoint(m, m.cols - 1 - c, m.rows)),
    ...Array.from({ length: m.rows - 1 }, (_, r) => meshPoint(m, 0, m.rows - 1 - r)),
  ];
  return { surface, cells, outline, mesh: m };
}
function designStyle(p: Placement, x0 = 0, y0 = 0) {
  const a = assetOf(p)!;
  const A = designToSurfaceMatrix({ width: a.width, height: a.height }, layout(p).surface, p.transform);
  return { width: `${a.width}px`, height: `${a.height}px`, transform: `matrix(${A[0]},${A[3]},${A[1]},${A[4]},${A[2] - x0},${A[5] - y0})` };
}

// E-mailhandtekening: één bericht voor alle schermen in de scène; laptop en telefoon tonen het elk op hun eigen manier.
const landscapeOf = (p: Placement) => { const d = layout(p).surface; return d.width > d.height; };
const mailScreens = computed(() => placements.value.filter((p) => p.layout).length);
const mailSignature = computed(() => activePlacement.value?.layout?.slots[0]?.assetId ?? null);
const signatureWidth = computed(() => {
  const l = activePlacement.value?.layout;
  if (l?.signatureWidth) return l.signatureWidth;
  const a = mailSignature.value ? assetById(mailSignature.value) : null;
  return a ? naturalSignatureWidth(a.width) : 480;
});
const MAIL_FIELDS: { key: keyof MailFields; label: string; max: number; wide?: boolean }[] = [
  { key: 'fromName', label: 'Afzender', max: 80 },
  { key: 'fromEmail', label: 'E-mailadres', max: 120 },
  { key: 'to', label: 'Aan', max: 80 },
  { key: 'date', label: 'Datum en tijd', max: 40 },
  { key: 'subject', label: 'Onderwerp', max: 160, wide: true },
  { key: 'body', label: 'Tekst boven de handtekening', max: 2000, wide: true },
];
/** Wijzigt het bericht op alle mailschermen; de handtekening is ook het ontwerp van de plaatsing (zonder e-mail, andere scène). */
function setMail(part: Partial<Omit<ScreenLayout, 'template'>>, doCommit = false) {
  placements.value = placements.value.map((p) => {
    if (!p.layout) return p;
    const l: ScreenLayout = { ...p.layout, ...part };
    return { ...p, layout: l, assetId: l.slots[0]?.assetId ?? null };
  });
  if (doCommit) commit();
}
const mailValue = (key: keyof MailFields) => activePlacement.value?.layout?.mail?.[key] ?? '';
function setMailField(key: keyof MailFields, value: string) { setMail({ mail: { ...activePlacement.value!.layout!.mail, [key]: value } }); }
function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase() || '?';
}
function setInterface(on: boolean) {
  const p = activePlacement.value!;
  if (on) {
    // Hetzelfde bericht als op de andere schermen, als die er al zijn.
    const brand = placements.value.find((x) => x.layout)?.layout;
    placements.value[active.value] = { ...p, layout: newMailLayout(landscapeOf(p), brand?.slots[0]?.assetId ?? p.assetId, brand ?? undefined), transform: { ...DEFAULT_TRANSFORM, fit: 'fill', anchor: 'top', scale: 1 } };
    placements.value[active.value]!.assetId = placements.value[active.value]!.layout!.slots[0]!.assetId;
  } else {
    const obj = findObject(data.value!.scene.objectType)?.object;
    const a = p.assetId ? assetById(p.assetId) : null;
    const fit = smartFit(obj?.defaultFit ?? 'cover', a, layout(p).surface);
    placements.value[active.value] = { ...p, layout: null, transform: { ...DEFAULT_TRANSFORM, fit, anchor: 'top' } };
  }
  commit();
}
/** Canvasmaat van een scherm, in dezelfde verhouding als de server (lagere resolutie voor de live weergave). */
function screenSize(p: Placement) {
  const surf = layout(p).surface;
  return screenCanvasSize(surf, p.layout?.template === 'mail-desktop', surf.width * 1.4);
}
const screenUrls = reactive<Record<string, string>>({});
let screenSeq = 0;
watch(() => placements.value.map((p) => (p.layout ? JSON.stringify([p.surfaceId, p.layout, p.quad, p.mesh]) : '')).join('|') + (data.value?.assets.length ?? 0), async () => {
  const seq = ++screenSeq;
  await new Promise((r) => setTimeout(r, 60));
  if (seq !== screenSeq || !data.value) return;
  for (const p of placements.value) {
    if (!p.layout || !surfaceOf(p)) continue;
    const size = screenSize(p);
    const url = await renderScreenPreview(p.layout, size.width, size.height, (id) => assetById(id));
    if (seq !== screenSeq) { if (url) URL.revokeObjectURL(url); return; }
    const old = screenUrls[p.surfaceId];
    if (url) screenUrls[p.surfaceId] = url;
    if (old) setTimeout(() => URL.revokeObjectURL(old), 1000);
  }
});

// Geschiedenis voor ongedaan maken.
const history = ref<string[]>([]);
const cursor = ref(-1);
const stateKey = computed(() => JSON.stringify(placements.value));
const canUndo = computed(() => cursor.value > 0);
const canRedo = computed(() => cursor.value < history.value.length - 1);
function commit() {
  const s = stateKey.value;
  if (history.value[cursor.value] === s) return;
  history.value = history.value.slice(0, cursor.value + 1);
  history.value.push(s);
  if (history.value.length > 100) history.value.shift();
  cursor.value = history.value.length - 1;
  scheduleSave();
}
function restore(i: number) { cursor.value = i; placements.value = JSON.parse(history.value[i]!); scheduleSave(); }
const undo = () => canUndo.value && restore(cursor.value - 1);
const redo = () => canRedo.value && restore(cursor.value + 1);
function onKey(e: KeyboardEvent) {
  if ((e.target as HTMLElement).closest('input, textarea, select')) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  else if (e.key === 'Escape') { cornerMode.value = false; meshMode.value = false; compare.value = false; exportOpen.value = false; picker.value = null; }
  else if (!mod && nudge(e)) e.preventDefault();
}

function setField<K extends keyof Placement>(key: K, value: Placement[K], doCommit = false) {
  placements.value[active.value] = { ...placements.value[active.value]!, [key]: value };
  if (doCommit) commit();
}
function setTransform(t: Partial<DesignTransform>, doCommit = false) { setField('transform', { ...activePlacement.value!.transform, ...t }, doCommit); }
function setBlend(b: Partial<BlendSettings>) { setField('blend', { ...activePlacement.value!.blend, ...b }); }
const fits = [
  { id: 'cover', label: 'Vullen', hint: 'Bedekt het hele vlak, randen kunnen wegvallen' },
  { id: 'contain', label: 'Passend', hint: 'Het hele ontwerp zichtbaar' },
  { id: 'width', label: 'Breedte', hint: 'Op breedte, bovenaan beginnen (websites)' },
  { id: 'fill', label: 'Uitrekken', hint: 'Exact op het vlak, verhouding kan veranderen' },
] as const;
const verticalMin = computed(() => {
  const p = activePlacement.value;
  const a = p ? assetOf(p) : null;
  if (!p || !a || p.layout || p.transform.fit !== 'width') return -100;
  // Lange websitescreenshots: ver genoeg kunnen scrollen om de hele pagina te tonen.
  const d = layout(p).surface;
  const h = (a.height * d.width) / a.width * p.transform.scale;
  return Math.min(-100, -Math.ceil((h / d.height) * 100));
});
function rotateSurface() {
  const p = activePlacement.value!;
  const m = layout(p).mesh;
  placements.value[active.value] = { ...p, quad: rotateQuad(quadOf(p), 1), mesh: m ? rotateMesh(m) : null };
  commit();
}
/** Achtergrond van het vlak in de directe weergave; 'naadloos' benaderen met de kleur rondom het vlak. */
function planeBackground(p: Placement) {
  if (p.background === 'transparent') return 'transparent';
  if (p.background === 'auto') return surfaceOf(p)?.fillColor ?? 'transparent';
  return p.background;
}
function resetPlacement() {
  const p = activePlacement.value!;
  const s = surfaceOf(p)!;
  const obj = findObject(data.value!.scene.objectType)?.object;
  const a = assetOf(p);
  const fit = p.layout ? 'fill' : smartFit(obj?.defaultFit ?? 'cover', a ?? null, surfaceDimensions(s.quad, { width: data.value!.scene.width, height: data.value!.scene.height, aspect: s.aspect }));
  placements.value[active.value] = {
    ...p, transform: { ...DEFAULT_TRANSFORM, fit, anchor: 'top', scale: p.layout ? 1 : obj?.defaultScale ?? DEFAULT_TRANSFORM.scale }, quad: null, mesh: null, cylinder: null, blend: { ...DEFAULT_BLEND[s.kind] }, hidden: false, useMask: s.detection !== 'manual',
    background: s.detection === 'manual' ? 'transparent' : s.kind === 'screen' ? obj?.defaultBackground ?? '#ffffff' : obj?.defaultBackground === 'auto' ? 'auto' : s.fillColor ?? '#ffffff',
  };
  commit();
}

// Slepen: hoeken en ontwerp.
let drag: { type: 'corner'; k: number } | { type: 'mesh'; k: number } | { type: 'split' } | { type: 'plane'; start: [number, number]; base: DesignTransform } | null = null;
function toScene(e: PointerEvent): [number, number] {
  const svg = svgEl.value!;
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const r = pt.matrixTransform(svg.getScreenCTM()!.inverse());
  return [r.x, r.y];
}
function onCornerDown(e: PointerEvent, k: number) {
  drag = { type: 'corner', k };
  svgEl.value?.setPointerCapture(e.pointerId);
}
function onPlaneDown(e: PointerEvent, i: number) {
  active.value = i;
  if (cornerMode.value || readonly.value) return;
  drag = { type: 'plane', start: toScene(e), base: { ...placements.value[i]!.transform } };
  svgEl.value?.setPointerCapture(e.pointerId);
}
function onPointerMove(e: PointerEvent) {
  if (!drag) return;
  const pos = toScene(e);
  if (drag.type === 'split') return;
  if (drag.type === 'mesh') {
    const m = editMesh.value;
    const points = m.points.map((c) => [...c] as Point);
    points[drag.k] = [Math.round(pos[0] * 10) / 10, Math.round(pos[1] * 10) / 10];
    setField('mesh', { ...m, points });
    return;
  }
  if (drag.type === 'corner') {
    const before = quadOf(activePlacement.value!);
    const q = before.map((c) => [...c]) as Quad;
    q[drag.k] = [Math.round(pos[0] * 10) / 10, Math.round(pos[1] * 10) / 10];
    const p0 = activePlacement.value!;
    placements.value[active.value] = { ...p0, quad: q, mesh: p0.mesh ? remapMesh(p0.mesh, before, q) : p0.mesh };
  } else {
    // Verschuiving in scène-pixels omrekenen naar het vlak, zodat slepen het perspectief volgt.
    const q = quadOf(activePlacement.value!);
    const d = layout(activePlacement.value!).surface;
    const inv = invert3(homography(rectQuad(d.width, d.height), q));
    const a = applyH(inv, drag.start[0], drag.start[1]);
    const b = applyH(inv, pos[0], pos[1]);
    setTransform({ offsetX: drag.base.offsetX + (b[0] - a[0]) / d.width, offsetY: drag.base.offsetY + (b[1] - a[1]) / d.height });
  }
}
function onPointerUp() {
  if (drag && drag.type !== 'split') commit();
  drag = null;
}

// Vrij vervormen: een raster van 4 × 3 cellen over het vlak, of het bestaande raster.
const meshMode = ref(false);
const editMesh = computed<Mesh>(() => {
  const p = activePlacement.value!;
  if (p.mesh) return p.mesh;
  const m = layout(p).mesh;
  return m && (m.cols > 1 || m.rows > 1) ? controlMesh(m, 4, 3) : meshFromQuad(quadOf(p), 4, 3);
});
const meshLines = computed(() => {
  const m = editMesh.value;
  const rows = Array.from({ length: m.rows + 1 }, (_, r) => Array.from({ length: m.cols + 1 }, (_, c) => meshPoint(m, c, r)));
  const cols = Array.from({ length: m.cols + 1 }, (_, c) => Array.from({ length: m.rows + 1 }, (_, r) => meshPoint(m, c, r)));
  return [...rows, ...cols];
});
function toggleMesh() { meshMode.value = !meshMode.value; if (meshMode.value) cornerMode.value = false; }
function onMeshDown(e: PointerEvent, k: number) { drag = { type: 'mesh', k }; svgEl.value?.setPointerCapture(e.pointerId); }
function clearMesh() { setField('mesh', null, true); meshMode.value = false; }

// Gebogen oppervlak
const currentCylinder = computed<CylinderParams | null>(() => {
  const p = activePlacement.value;
  return p ? p.cylinder ?? surfaceOf(p)?.cylinder ?? null : null;
});
function setCylinder(part: Partial<CylinderParams>) {
  const base = currentCylinder.value ?? { wrap: 110, bulge: 0.05 };
  placements.value[active.value] = { ...activePlacement.value!, cylinder: { ...base, ...part }, mesh: null };
}
function toggleCylinder(on: boolean) {
  if (on) setCylinder({});
  else placements.value[active.value] = { ...activePlacement.value!, cylinder: { wrap: 0, bulge: 0 }, mesh: null };
  commit();
}

// Vergelijken met een schuifbalk tussen scène en resultaat
const compare = ref(false);
const split = ref(50);
function onSplitDown(e: PointerEvent) {
  const el = (e.currentTarget as HTMLElement).parentElement!;
  const move = (ev: PointerEvent) => { const r = el.getBoundingClientRect(); split.value = Math.max(0, Math.min(100, ((ev.clientX - r.left) / r.width) * 100)); };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  move(e);
}

// Inzoomen op het actieve vlak
async function zoomToSurface() {
  const q = layout(activePlacement.value!).outline;
  const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
  zoom.value = Math.max(0.05, Math.min(4, Math.min((stageSize.w - 80) / bw, (stageSize.h - 80) / bh) * 0.85));
  await nextTick();
  const svg = svgEl.value, stage = stageEl.value;
  if (!svg || !stage) return;
  const r = svg.getBoundingClientRect(), sr = stage.getBoundingClientRect();
  const cx = r.left + ((Math.min(...xs) + bw / 2) / sceneW.value) * r.width;
  const cy = r.top + ((Math.min(...ys) + bh / 2) / sceneH.value) * r.height;
  stage.scrollBy({ left: cx - (sr.left + sr.width / 2), top: cy - (sr.top + sr.height / 2), behavior: 'smooth' });
}

// Pijltjestoetsen: verschuiven; plus en min: schalen. Shift voor grotere stappen.
let keyCommit: ReturnType<typeof setTimeout> | undefined;
function nudge(e: KeyboardEvent): boolean {
  if (!activePlacement.value || readonly.value || view.value !== 'result') return false;
  const step = e.shiftKey ? 0.025 : 0.0025;
  const t = activePlacement.value.transform;
  const map: Record<string, Partial<DesignTransform>> = {
    ArrowLeft: { offsetX: t.offsetX - step }, ArrowRight: { offsetX: t.offsetX + step },
    ArrowUp: { offsetY: t.offsetY - step }, ArrowDown: { offsetY: t.offsetY + step },
    '+': { scale: t.scale * (e.shiftKey ? 1.1 : 1.02) }, '=': { scale: t.scale * 1.02 }, '-': { scale: t.scale / (e.shiftKey ? 1.1 : 1.02) },
  };
  const change = map[e.key];
  if (!change) return false;
  setTransform(change);
  clearTimeout(keyCommit);
  keyCommit = setTimeout(commit, 400);
  return true;
}

const upscaleWarning = computed(() => {
  const pr = findPreset(exp.preset);
  if (!pr || !pr.height || !data.value) return '';
  const aspect = pr.width / pr.height;
  const cw = Math.min(sceneW.value, sceneH.value * aspect);
  return cw < pr.width * 0.98 ? `De scène is kleiner dan dit formaat; de export wordt ${Math.round((pr.width / cw) * 100 - 100)}% opgeschaald. Genereer de scène op hoge resolutie voor de scherpste uitvoer.` : '';
});

// Exacte weergave via de server, zodra er even niets verandert.
const exact = reactive<{ url: string | null; key: string; loading: boolean }>({ url: null, key: '', loading: false });
let renderTimer: ReturnType<typeof setTimeout> | undefined;
let renderSeq = 0;
// Ook een nieuwe render van de scène (3D-device) vraagt een nieuwe exacte weergave.
const exactKey = computed(() => `${data.value?.scene.file ?? ''}|${stateKey.value}`);
watch([exactKey, scale], () => {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderExact, 450);
});
async function renderExact() {
  if (!data.value || drag || !placements.value.length) return;
  const key = exactKey.value;
  const seq = ++renderSeq;
  exact.loading = true;
  try {
    const width = Math.round(Math.min(sceneW.value, Math.max(320, sceneW.value * scale.value * (window.devicePixelRatio || 1))));
    const blob = await $fetch<Blob>(`/api/mockups/${data.value.mockup.id}/render`, { method: 'POST', body: { placements: placements.value, width: Math.min(2400, width) }, responseType: 'blob' });
    if (seq !== renderSeq) return;
    if (exact.url) URL.revokeObjectURL(exact.url);
    exact.url = URL.createObjectURL(blob);
    exact.key = key;
  } catch { /* de live weergave blijft zichtbaar */ }
  finally { if (seq === renderSeq) exact.loading = false; }
}
const renderNote = computed(() => (view.value !== 'result' ? '' : live3d.value ? 'Live 3D-weergave' : exact.key === exactKey.value && exact.url ? 'Exacte weergave' : 'Snelle weergave'));

// 3D-device: live aanpassen in de browser, daarna rendert de server de exacte versie van de scène.
const model3d = computed(() => (data.value?.scene.device3d ? findDeviceModel(data.value.scene.device3d.spec.model) : null));
const spec3d = ref<Device3DSpec | null>(null);
const live3d = ref(false);
const busy3d = ref(false);
const note3d = ref('');
const POSE_LABEL: Record<string, string> = { flat: 'Plat', upright: 'Rechtop', standing: 'Staand' };
/** Strook van de statusbalk in de scène (tussen de bovenrand van het scherm en die van het ontwerpvlak). */
const barStrip = computed(() => {
  const d = data.value?.scene.device3d, sf = data.value?.scene.surfaces[0];
  if (!d?.screen || !sf || !d.spec.statusBar?.show) return '';
  return [d.screen.quad[0], d.screen.quad[1], sf.quad[1], sf.quad[0]].map((p) => p.join(',')).join(' ');
});
const ALIGN_LABEL = { left: 'Links', center: 'Midden', right: 'Rechts', top: 'Boven', middle: 'Midden', bottom: 'Onder' } as const;
const TONE_LABEL = { auto: 'Automatisch', dark: 'Donker', light: 'Licht' } as const;
const cm = (m: number) => Math.round(m * 1000) / 10;
function setOffset(axis: 'x' | 'y' | 'z', valueCm: number) {
  if (!spec3d.value) return;
  set3d({ offset: { ...spec3d.value.offset, [axis]: valueCm / 100 } });
}
function setBar(part: Partial<StatusBarSpec>, commitNow = false) {
  if (!spec3d.value) return;
  set3d({ statusBar: { ...spec3d.value.statusBar, ...part } }, commitNow);
}

// Meten waar het device in beeld staat (zelfde berekening als het renderen): breedte en hoogte in beeld, de afstand
// tot de camera en uitlijnen. Het model wordt één keer geladen.
const measure3d = ref<DeviceMeasure | null>(null);
let measureModel: { url: string; obj: Promise<import('three').Object3D> } | null = null;
async function measureSpec(spec: Device3DSpec): Promise<DeviceMeasure | null> {
  const url = data.value?.scene.device3d?.modelUrl;
  if (!url || !import.meta.client) return null;
  if (measureModel?.url !== url) measureModel = { url, obj: loadDeviceModel(url) };
  try { return measureDevice(await measureModel.obj, spec, sceneW.value / sceneH.value); } catch { return null; }
}
let measureTimer: ReturnType<typeof setTimeout> | undefined;
watch(spec3d, (s) => {
  clearTimeout(measureTimer);
  if (!s) { measure3d.value = null; return; }
  measureTimer = setTimeout(async () => { measure3d.value = await measureSpec(s); }, 60);
}, { deep: true, immediate: true });
const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Breedte of hoogte in beeld: het device als geheel schalen (via de zoom) tot die maat. */
async function sizeTo(dim: 'width' | 'height', pct: number) {
  let s = spec3d.value;
  if (!s) return;
  for (let i = 0; i < 3; i++) {
    const m = await measureSpec(s);
    if (!m) return;
    const cur = dim === 'width' ? m.right - m.left : m.bottom - m.top;
    if (cur <= 0) return;
    s = { ...s, camera: { ...s.camera, size: clampN(s.camera.size * (pct / 100) / cur, 0.15, 1.6) } };
  }
  set3d({ camera: s.camera });
}
/** Afstand tot de camera: dezelfde beeldhoek, de camera dichterbij of verder weg (het device wordt groter of kleiner). */
async function distanceTo(valueCm: number) {
  const s = spec3d.value;
  const m = s ? await measureSpec(s) : null;
  if (!s || !m) return;
  set3d({ camera: { ...s.camera, size: clampN((s.camera.size * m.dist) / (valueCm / 100), 0.15, 1.6) } });
}
/** Uitlijnen: de randen van het device op 6% van de beeldrand, of precies in het midden. */
async function align3d(axis: 'x' | 'y', where: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') {
  let s = spec3d.value;
  if (!s) return;
  const margin = 0.06;
  for (let i = 0; i < 4; i++) {
    const m = await measureSpec(s);
    if (!m) return;
    const shift = axis === 'x'
      ? (where === 'left' ? margin - m.left : where === 'right' ? 1 - margin - m.right : 0.5 - (m.left + m.right) / 2)
      : (where === 'top' ? margin - m.top : where === 'bottom' ? 1 - margin - m.bottom : 0.5 - (m.top + m.bottom) / 2);
    if (Math.abs(shift) < 0.0005) break;
    s = { ...s, frame: { ...s.frame, [axis]: clampN(s.frame[axis] + shift, -0.5, 0.5) } };
  }
  set3d({ frame: s.frame }, true);
}
watch(() => data.value?.scene.device3d?.spec, (s) => { if (s && !live3d.value) spec3d.value = JSON.parse(JSON.stringify(s)); }, { immediate: true });
/** Ontwerp op het scherm in de live weergave: dat van het (eerste) vlak. */
const liveDesign = computed(() => { const p = placements.value[0]; return p && !p.hidden ? assetOf(p) : null; });
let timer3d: ReturnType<typeof setTimeout> | undefined;
let seq3d = 0;
function set3d(part: Partial<Device3DSpec>, commitNow = false) {
  if (!spec3d.value || readonly.value) return;
  spec3d.value = { ...spec3d.value, ...part };
  live3d.value = true;
  if (commitNow) commit3d();
}
function commit3d() {
  clearTimeout(timer3d);
  timer3d = setTimeout(save3d, 450);
}
function preload(url: string | null) {
  return new Promise<void>((resolve) => { if (!url) return resolve(); const i = new Image(); i.onload = () => resolve(); i.onerror = () => resolve(); i.src = url; });
}
async function save3d() {
  if (!spec3d.value || !data.value) return;
  const seq = ++seq3d;
  busy3d.value = true;
  try {
    const r = await api<{ mockup: MockupView; scene: SceneView; forked: boolean }>(`/api/mockups/${data.value.mockup.id}/device3d`, { method: 'PUT', body: { spec: spec3d.value }, timeout: 180_000 });
    if (seq !== seq3d) return;
    await preload(r.scene.fileUrl);
    if (seq !== seq3d) return;
    data.value.scene = r.scene;
    data.value.mockup = { ...data.value.mockup, sceneId: r.mockup.sceneId, previewFile: r.mockup.previewFile, previewUrl: r.mockup.previewUrl };
    if (r.forked) note3d.value = 'Deze mockup heeft nu een eigen versie van de scène; andere mockups en de bibliotheek blijven zoals ze waren.';
    live3d.value = false;
  } catch (e) {
    if (seq === seq3d) toast.error((e as Error).message);
  } finally {
    if (seq === seq3d) busy3d.value = false;
  }
}

// Opslaan.
const saveState = ref('Opgeslagen');
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSave() {
  if (readonly.value) return;
  saveState.value = 'Niet opgeslagen';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 1200);
}
async function save() {
  if (!data.value) return;
  saveState.value = 'Opslaan…';
  try {
    await api(`/api/mockups/${data.value.mockup.id}`, { method: 'PATCH', body: { placements: placements.value } });
    saveState.value = 'Opgeslagen';
  } catch (e) {
    saveState.value = 'Opslaan mislukt';
    toast.error((e as Error).message);
  }
}

// Export.
const exp = reactive({ format: 'png' as 'png' | 'jpg' | 'tiff', quality: 92, width: 0, preset: '' });
const exportOpen = ref(false);
const exporting = ref(false);
async function doExport() {
  exporting.value = true;
  try {
    clearTimeout(saveTimer);
    await save();
    const e = await api<ExportView>(`/api/mockups/${data.value!.mockup.id}/export`, { method: 'POST', body: { format: exp.format, quality: exp.quality, width: exp.preset ? undefined : exp.width, preset: exp.preset || null }, timeout: 180_000 });
    data.value!.exports.unshift(e);
    const a = document.createElement('a');
    a.href = e.downloadUrl;
    a.click();
    toast.info(`Export klaar: ${e.format.toUpperCase()}, ${e.width} × ${e.height} px.`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    exporting.value = false;
  }
}

// Scrollvideo: alleen als een ontwerp langer is dan het scherm waar het op staat.
const scrollable = computed(() => data.value?.mockup.placements.some((p) => {
  if (p.hidden || p.layout) return false;
  const a = assetOf(p);
  if (!a) return false;
  const surf = layout(p).surface;
  return (a.height * (surf.width / a.width) * p.transform.scale) / surf.height > 1.05;
}) ?? false);
const videoWidth = ref(1280);
const video = ref<{ elapsed: number } | null>(null);
async function makeVideo() {
  const id = data.value!.mockup.id;
  try {
    clearTimeout(saveTimer);
    await save();
    const r = await api<{ jobId: string; duration: number }>(`/api/mockups/${id}/video`, { method: 'POST', body: { width: videoWidth.value } });
    const started = Date.now();
    video.value = { elapsed: 0 };
    for (;;) {
      await new Promise((res) => setTimeout(res, 1500));
      video.value = { elapsed: Math.round((Date.now() - started) / 1000) };
      const st = await api<{ status: string; error: string | null; export: ExportView | null }>(`/api/mockups/${id}/video/${r.jobId}`);
      if (st.status === 'failed') throw new Error(st.error ?? 'Het maken van de video is mislukt.');
      if (st.status === 'done' && st.export) {
        data.value!.exports.unshift(st.export);
        const a = document.createElement('a');
        a.href = st.export.downloadUrl;
        a.click();
        toast.info(`Video klaar: ${Math.round(r.duration)} seconden.`);
        break;
      }
    }
  } catch (e) { toast.error((e as Error).message); } finally { video.value = null; }
}

// Andere scène.
const picker = ref<'swap' | 'copy' | null>(null);
function openPicker(m: 'swap' | 'copy') { picker.value = m; }
async function onPick(scene: SceneView) {
  const mode = picker.value;
  picker.value = null;
  try {
    clearTimeout(saveTimer);
    await save();
    if (mode === 'swap') {
      await api(`/api/mockups/${data.value!.mockup.id}`, { method: 'PATCH', body: { sceneId: scene.id } });
      await load();
      toast.info('Scène gewisseld.');
    } else {
      const m = await api<MockupView>('/api/mockups', { method: 'POST', body: { projectId: data.value!.mockup.projectId, sceneId: scene.id, assetId: null, fromMockupId: data.value!.mockup.id } });
      await navigateTo(`/editor/${m.id}`);
    }
  } catch (e) {
    toast.error((e as Error).message);
  }
}

async function load() {
  data.value = await api<EditorData>(`/api/mockups/${route.params.id}`);
  placements.value = JSON.parse(JSON.stringify(data.value.mockup.placements));
  active.value = Math.min(active.value, Math.max(0, placements.value.length - 1));
  history.value = [stateKey.value];
  cursor.value = 0;
  exp.width = data.value.scene.width;
  saveState.value = 'Opgeslagen';
}

let ro: ResizeObserver | undefined;
onMounted(async () => {
  try { await load(); } catch (e) { toast.error((e as Error).message); return; }
  await nextTick();
  ro = new ResizeObserver(([entry]) => { stageSize.w = entry!.contentRect.width; stageSize.h = entry!.contentRect.height; });
  if (stageEl.value) ro.observe(stageEl.value);
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  ro?.disconnect();
  window.removeEventListener('keydown', onKey);
  if (saveState.value === 'Niet opgeslagen') save();
  if (exact.url) URL.revokeObjectURL(exact.url);
});
watch(() => route.params.id, async () => { exact.url = null; await load(); });
</script>

<style scoped>
.stage { background: var(--color-stage); }
.stage[data-bg='light'] { background: #dededc; }
.stage[data-bg='dark'] { background: #2b2c2f; }
.scene-space { position: relative; transform-origin: 0 0; }
.plane { position: absolute; left: 0; top: 0; transform-origin: 0 0; overflow: hidden; }
.design { position: absolute; left: 0; top: 0; max-width: none; transform-origin: 0 0; user-select: none; }
.gloss { position: absolute; left: 0; top: 0; pointer-events: none; }
.meshline { fill: none; stroke: var(--color-cyan); stroke-width: 1; vector-effect: non-scaling-stroke; opacity: 0.7; pointer-events: none; }
.reg-sm .ring { fill: var(--color-white); }
.divider { position: absolute; top: 0; bottom: 0; width: 0; border-left: 2px solid var(--color-white); box-shadow: 0 0 0 1px rgb(0 0 0 / 0.15); cursor: ew-resize; touch-action: none; }
.divider-grip { position: absolute; top: 50%; left: -12px; width: 22px; height: 38px; margin-top: -19px; border-radius: 6px; background: var(--color-white); box-shadow: 0 1px 4px rgb(0 0 0 / 0.25); }
.shading { position: absolute; inset: 0; width: 100%; height: 100%; mix-blend-mode: overlay; pointer-events: none; }
.quad { fill: transparent; stroke: transparent; cursor: move; vector-effect: non-scaling-stroke; }
.quad:hover { stroke: rgb(255 255 255 / 0.55); stroke-width: 1; }
.quad.active { stroke: var(--color-cyan); stroke-width: 1.25; stroke-dasharray: 5 4; }
.reg { cursor: grab; }
.reg:active { cursor: grabbing; }
.reg .hit { fill: transparent; }
.reg .ring { fill: rgb(255 255 255 / 0.25); stroke: var(--color-cyan); stroke-width: 1.5; }
.reg .cross { stroke: var(--color-cyan); stroke-width: 1.5; }
.inspector { scrollbar-width: thin; }
.badge { cursor: pointer; }
.badge circle { fill: rgb(255 255 255 / 0.92); stroke: var(--color-ink); stroke-width: 1.25; }
.badge text { font-size: 12px; font-weight: 600; fill: var(--color-ink); pointer-events: none; }
.badge.on circle { fill: var(--color-ink); }
.badge.on text { fill: var(--color-white); }
.hint { position: absolute; top: 0.85rem; left: 50%; transform: translateX(-50%); z-index: 5; padding: 0.45rem 0.85rem; border-radius: 999px; background: rgb(28 29 32 / 0.88); color: white; font-size: var(--text-xs); white-space: nowrap; }
.surface-chip { display: inline-flex; align-items: center; gap: 0.45rem; height: 2rem; padding: 0 0.7rem 0 0.35rem; border: 1px solid var(--color-rule); border-radius: 999px; background: var(--color-white); font-size: var(--text-sm); }
.surface-chip .num { display: inline-grid; place-items: center; width: 1.35rem; height: 1.35rem; border-radius: 50%; border: 1px solid var(--color-ink); font-size: 11px; font-weight: 600; }
.chip.finish { display: inline-flex; align-items: center; gap: 0.45rem; }
.chip .dot { width: 0.8rem; height: 0.8rem; border-radius: 50%; box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.18); }
/* Groepen in het 3D-paneel: inklapbaar, zodat het paneel overzichtelijk blijft. */
.group3d { border-top: 1px solid var(--color-rule); padding-top: 0.75rem; }
.group3d > summary { cursor: pointer; list-style: none; display: flex; align-items: center; justify-content: space-between; font-size: var(--text-sm); font-weight: 560; }
.group3d > summary::-webkit-details-marker { display: none; }
.group3d > summary::after { content: ''; width: 6px; height: 6px; margin-right: 4px; border-right: 1.5px solid var(--color-graphite); border-bottom: 1.5px solid var(--color-graphite); transform: rotate(-45deg); transition: transform 120ms; }
.group3d[open] > summary::after { transform: rotate(45deg); }
.link3d { color: var(--color-graphite); text-decoration: underline; text-underline-offset: 2px; }
.link3d:hover { color: var(--color-ink); }
.surface-chip[aria-pressed='true'] { border-color: var(--color-ink); box-shadow: inset 0 0 0 1px var(--color-ink); }
.surface-chip[aria-pressed='true'] .num { background: var(--color-ink); color: var(--color-white); }
.drawer { width: min(400px, 100vw); height: 100%; box-shadow: -12px 0 40px rgb(0 0 0 / 0.12); }
.slide-enter-active, .slide-leave-active { transition: opacity 180ms var(--ease-studio); }
.slide-enter-active .drawer, .slide-leave-active .drawer { transition: transform 220ms var(--ease-studio); }
.slide-enter-from, .slide-leave-to { opacity: 0; }
.slide-enter-from .drawer, .slide-leave-to .drawer { transform: translateX(24px); }
.panel { display: grid; gap: 0.8rem; padding: 1.15rem 1.25rem; border-bottom: 1px solid var(--color-rule); }
.panel-title { font-size: var(--text-sm); font-weight: 600; }
.pick { border-radius: var(--radius-sm); }
.avatar-pick { width: 2rem; height: 2rem; overflow: hidden; border-radius: 50%; border: 1px solid var(--color-rule); background: var(--color-paper); display: grid; place-items: center; font-size: 12px; font-weight: 600; color: var(--color-graphite); }
.avatar-pick img { width: 100%; height: 100%; object-fit: cover; }
.avatar-pick[aria-pressed='true'] { outline: 2px solid var(--color-cyan); outline-offset: 2px; }
.pick[aria-pressed='true'] > :first-child { outline: 2px solid var(--color-cyan); outline-offset: 2px; }
.color { width: 2rem; height: 2rem; border: 1px solid var(--color-rule); border-radius: var(--radius-sm); padding: 2px; background: white; }
.fade-enter-active, .fade-leave-active { transition: opacity 160ms; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
