// Bouwt uit de configuratie één consistente prompt. Het model maakt alleen de scène;
// het doeloppervlak wordt een egaal chroma-groen vlak (of leeg) zodat het originele ontwerp er later
// pixel-exact op geplaatst kan worden.
import {
  ANGLES, AVOID, ENVIRONMENTS, FINISHES, FRAMING, LIGHTING, NEGATIVE_SPACE, POSITIONS,
  REFERENCE_ASPECTS, SHADOWS, STYLES, SYMMETRY, findObject, type Option,
} from '../../../shared/catalog';
import type { SceneConfig } from '../../../shared/types';
import { isValidSize, orientationOf, ratioLabel, sizeMode } from '../../../shared/design-size';
import { BACKDROP_KEY, BACKDROP_SHADOWS, GROUNDS, PROPS, SCENE_TYPES } from '../../../shared/scene-style';
import { colorsFor, palettePrompt, sceneBackdrop, scenePalette } from '../../../shared/palette';
import { cameraPromptFor, deviceSpecFor, findDeviceModel } from '../../../shared/device3d/spec';

const pick = (list: Option[], id?: string) => list.find((o) => o.id === id)?.prompt;

/** Fotografische stijl bij een scènetype, als de gebruiker zelf geen stijl kiest. */
const TYPE_STYLE: Record<string, string> = {
  studio: 'minimal studio photography', interior: 'editorial interior photography', minimal: 'minimal studio photography',
  editorial: 'editorial photography', product: 'photorealistic product photography', abstract: 'a high-end advertising campaign image',
};


export function describeTemperature(kelvin?: number): string | null {
  if (!kelvin) return null;
  if (kelvin <= 3300) return `warm light with a color temperature around ${kelvin}K`;
  if (kelvin <= 4800) return `slightly warm neutral light around ${kelvin}K`;
  if (kelvin <= 6000) return `neutral daylight around ${kelvin}K`;
  return `cool light around ${kelvin}K`;
}

export const CHROMA_HEX = '#00FF00';

export function buildPrompt(cfg: SceneConfig, opts: { hasReferences: boolean }): string {
  const found = findObject(cfg.objectType);
  if (!found) throw new Error(`Onbekend objecttype: ${cfg.objectType}`);
  const { object } = found;
  const lines: string[] = [];

  const flat = cfg.backdrop && (cfg.backdrop.mode === 'solid' || cfg.backdrop.mode === 'gradient') ? cfg.backdrop : null;
  // Echt 3D-device: de AI maakt alleen de omgeving, met een lege plek en dezelfde camera; het device komt uit
  // het 3D-model. Met een effen achtergrond is er geen AI nodig.
  const device = deviceSpecFor(cfg);
  const deviceModel = device ? findDeviceModel(device.model) : null;
  if (device && deviceModel && flat) {
    return `Geen AI-beeld nodig: de studio rendert het 3D-model (${deviceModel.label}) op een ${flat.mode === 'gradient' ? 'verloop' : 'effen achtergrond'} in exact de gekozen kleuren.`;
  }
  const style = pick(STYLES, cfg.style) ?? (cfg.sceneType ? TYPE_STYLE[cfg.sceneType] : undefined) ?? 'photorealistic product photography';
  const count = cfg.objectCount && cfg.objectCount > 1 ? `${cfg.objectCount} copies of ` : '';
  // Afmetingen van het ontwerp: bepalen de stand (en bij drukwerk en borden de exacte verhouding) van het oppervlak.
  const size = isValidSize(cfg.designSize) ? cfg.designSize : null;
  const mode = size ? sizeMode(cfg.objectType) : 'none';
  const orient = size ? orientationOf(size) : null;
  const formatWord = orient === 'portrait' ? 'in a vertical (portrait) format, taller than it is wide' : orient === 'landscape' ? 'in a horizontal (landscape) format, wider than it is tall' : 'in a square format';
  const subjectBits = [
    `${count}${object.noun}`,
    cfg.brandModel ? `resembling a ${cfg.brandModel} but without any visible brand logos` : '',
    cfg.material ? `made of ${cfg.material}` : '',
    cfg.color ? `in ${cfg.color}` : '',
    pick(FINISHES, cfg.finish) ? `with a ${pick(FINISHES, cfg.finish)}` : '',
    mode === 'surface' ? formatWord : '',
    mode === 'orientation' ? `held in ${orient === 'landscape' ? 'landscape' : 'portrait'} orientation` : '',
    cfg.orientation ? `oriented ${cfg.orientation}` : '',
  ].filter(Boolean);
  // Een platte achtergrond vervangt de ruimte; omgeving, scènetype en ondergrond tellen dan niet mee.
  const environment = flat ? '' : cfg.environmentCustom?.trim() || pick(ENVIRONMENTS, cfg.environment);
  if (deviceModel) {
    lines.push(`A ${style} of an empty set${environment ? `, ${environment}` : ''}, prepared for a product photo.`);
    lines.push(
      `Leave ${deviceModel.promptSpot} (${deviceModel.sizeText}), fully in view and unobstructed.` +
        ' The product itself is not in the image: there is no laptop, computer, monitor, tablet, phone, screen or other electronic device anywhere.' +
        ' It will be added afterwards, photographed with exactly the camera described below, so keep that camera position, height and lens.',
    );
  } else {
    lines.push(`A ${style} of ${subjectBits.join(', ')}${environment ? `, ${environment}` : ''}.`);
  }

  if (flat) {
    // Het model maakt een egaal magenta sleutelscherm; de studio zet daarna de gekozen kleur of het verloop er
    // exact voor in de plaats. Zo hoeft het model geen HEX-kleur te raken en blijft het object onaangetast.
    const shadow = BACKDROP_SHADOWS.find((x) => x.id === (flat.shadow ?? 'soft'))!.prompt;
    lines.push(
      `Background: a seamless, perfectly uniform chroma-key magenta (${BACKDROP_KEY}) studio sweep that fills the entire frame behind and under the product, with no horizon line, no floor edge, no room, no furniture, no texture and no props.` +
        ` The product is centered with generous space around it, fully visible and not cropped, with ${shadow} on the magenta backdrop.` +
        ' Light the product with neutral white light: no magenta reflections, magenta rim light or pink color cast on the product, and the product itself contains no magenta or pink.',
    );
  } else {
    if (cfg.sceneType && !cfg.environmentCustom?.trim()) {
      const t = SCENE_TYPES.find((x) => x.id === cfg.sceneType);
      if (t) lines.push(t.prompt);
    }
    const palette = scenePalette(cfg);
    const exact = sceneBackdrop(cfg);
    // Exact en recht van boven: alles rond het product is achtergrond, dus er is geen aparte ondergrond.
    const topDown = !!exact && cfg.angle === 'top';
    const ground = topDown ? undefined : GROUNDS.find((g) => g.id === cfg.ground);
    // Materiaal en kleur van de ondergrond samen: het materiaal geeft de textuur, het palet de kleur.
    const standsOn = deviceModel ? 'The surface where the product will stand is' : 'The product stands on';
    if (ground) lines.push(colorsFor(palette, 'ground').length ? `${standsOn} a surface with the material and texture of ${ground.prompt}, in the ground color given in the palette below.` : `${standsOn} ${ground.prompt}.`);
    const props = PROPS.find((x) => x.id === cfg.props);
    if (props) lines.push(props.prompt);
    // Exacte achtergrond: net als bij de platte achtergrond maakt het model een egaal magenta sleutelscherm, en zet
    // de studio de kleur er daarna pixel voor pixel in. Alleen de achtergrond; de rest van de scène maakt het model.
    if (topDown) {
      lines.push(
        `Background: seen from directly above, everything around the product, including the surface it lies on, is a flat, perfectly uniform chroma-key magenta (${BACKDROP_KEY}) surface, evenly lit from edge to edge, with no texture, pattern or gradient.` +
          ' The props and the product keep their own colors: the magenta does not reflect or cast a pink tint onto them, and nothing else in the scene is magenta or pink.',
      );
    } else if (exact) {
      lines.push(
        `Background: the wall or backdrop behind the product is a flat, perfectly uniform chroma-key magenta (${BACKDROP_KEY}) surface, evenly lit from edge to edge, with no texture, pattern, gradient, window, artwork or object on it.` +
          ' Frame the shot so that this background is clearly visible behind the surface the product stands on.' +
          ' The surface the product stands on, the props and the product keep their own colors: the magenta appears only on the background and does not reflect or cast a pink tint onto the floor, the props or the product, and nothing else in the scene is magenta or pink.',
      );
    }
    const colors = palettePrompt(palette, { propsNone: cfg.props === 'none', exactBackground: !!exact, noGround: topDown });
    if (colors) lines.push(colors);
  }

  const composition = [
    device ? cameraPromptFor(device) : pick(ANGLES, cfg.angle),
    pick(FRAMING, cfg.framing),
    pick(POSITIONS, cfg.objectPosition),
    pick(NEGATIVE_SPACE, cfg.negativeSpace),
    pick(SYMMETRY, cfg.symmetry),
  ].filter(Boolean);
  if (composition.length) lines.push(`Composition: ${composition.join(', ')}.`);
  if (cfg.compositionCustom?.trim()) lines.push(`Composition notes: ${cfg.compositionCustom.trim()}`);

  const light = [pick(LIGHTING, cfg.lighting), describeTemperature(cfg.colorTemperature), pick(SHADOWS, cfg.shadows)].filter(Boolean);
  if (light.length) lines.push(`Lighting: ${light.join(', ')}.`);
  lines.push('Realistic materials, accurate reflections and physically plausible shadows. No illustration, no 3D-render look.');

  if (cfg.series && cfg.series.total > 1) {
    lines.push(
      `This photograph is image ${cfg.series.index} of a coherent brand photo series of ${cfg.series.total} images shot on the same day by the same photographer.` +
        ' Keep the location, set dressing, surface materials, color palette, light direction, color temperature and lens character identical across the series; only the product changes.',
    );
  }
  if (cfg.instructions?.trim()) {
    lines.push(`Art direction from the user (may be written in Dutch; follow it closely): ${cfg.instructions.trim()}`);
  }

  if (deviceModel) {
    // Geen doeloppervlak: dat komt uit het 3D-model.
  } else if (size && mode === 'surface') {
    lines.push(
      `Proportions: ${object.surface} has a width-to-height ratio of exactly ${size.width}:${size.height} (${ratioLabel(size, '.')}), ${formatWord}, because a design of ${size.width} × ${size.height} pixels will be placed on it without stretching or cropping.` +
        ' Give the object itself these proportions, show this surface completely within the frame, and do not let anything overlap it.',
    );
  } else if (size && mode === 'orientation' && orient !== 'square') {
    lines.push(`The screen is in ${orient} orientation, because the content shown on it is ${orient}.`);
  }

  // Het belangrijkste deel: het doeloppervlak (niet bij een 3D-device: dat brengt zijn eigen scherm mee).
  if (deviceModel) {
    // niets
  } else if (cfg.surfaceMethod === 'chroma') {
    lines.push(
      `Target surface: ${object.surface} must be completely filled, edge to edge, with a flat, uniform, saturated chroma-key green (${CHROMA_HEX}) with sharp, clean edges.` +
        ' Nothing may appear on this green area: no text, no logo, no interface, no pattern, no artwork and no reflections of objects.' +
        ' The green may follow the scene lighting and the physical shape of the surface, but must remain clearly saturated green.' +
        ' Do not use green anywhere else in the image (no plants, no green objects, no green tint).' +
        ' If there are several green surfaces and they overlap or touch, keep a thin, clearly visible edge between them (a bezel, frame, corner or shadow), so each surface stays recognisable as a separate shape.',
    );
    if (object.promptExtra) lines.push(object.promptExtra);
    if (object.mail) {
      lines.push('This image presents an e-mail on screen for a brand: a calm, credible and premium workplace photo with professional soft lighting, subtle realistic reflections on the glass and natural soft shadows. Keep the scene uncluttered and the screen large enough in the frame that text on it would be legible.');
    }
    if (object.surfaceKind === 'screen') {
      lines.push('Each screen is switched on and shows only this solid green, as if displaying a full-screen green image; keep the bezels and device body clearly visible around it and show the full screen without cropping it.');
    }
    if (object.surfaceKind === 'fabric') {
      lines.push('The green area is a printed rectangular panel on the fabric that follows the folds and texture of the garment.');
    }
  } else {
    lines.push(
      `Target surface: ${object.surface} is completely blank and plain, in the object's own base color, clearly visible and unobstructed, with no text, logo, pattern, label or artwork on it.`,
    );
  }

  const avoid = (cfg.avoid ?? []).map((id) => pick(AVOID, id)).filter(Boolean) as string[];
  if (cfg.props === 'none' || flat) avoid.push('decorative props');
  if (cfg.avoidCustom?.trim()) avoid.push(cfg.avoidCustom.trim());
  avoid.push(deviceModel ? 'any electronic device or screen' : 'text, logos or graphics on the target surface', 'watermarks');
  lines.push(`Do not include: ${[...new Set(avoid)].join('; ')}.`);

  if (opts.hasReferences) {
    const aspects = (cfg.referenceAspects ?? []).map((id) => pick(REFERENCE_ASPECTS, id)).filter(Boolean);
    lines.push(
      `The attached image(s) are style references for the art direction only${aspects.length ? `; follow them for the ${aspects.join(', ')}` : ''}.` +
        ' Create a new, original photograph in that visual language: do not recreate the reference scene, its objects, its layout or its subject one to one.' +
        ' Do not copy any text, logo, artwork, product, packaging, interface or design from the references.' +
        ' The product and the target surface are defined by this prompt, not by the references; nothing from the references may appear on the target surface.',
    );
  }
  return lines.join('\n');
}
