// Exportformaten voor veelgebruikte bestemmingen. Bij een andere verhouding dan de scène wordt
// bijgesneden rond de mockup (de ontwerpvlakken blijven in beeld).
export interface ExportPreset { id: string; label: string; width: number; height: number; hint: string }

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: 'presentation', label: 'Presentatie 16:9', width: 1920, height: 1080, hint: 'Keynote, PowerPoint, Google Slides' },
  { id: 'dribbble', label: 'Dribbble 4:3', width: 1600, height: 1200, hint: 'Dribbble-shot' },
  { id: 'instagram', label: 'Instagram staand 4:5', width: 1080, height: 1350, hint: 'Feedbericht' },
  { id: 'instagram-square', label: 'Instagram vierkant', width: 1080, height: 1080, hint: 'Feedbericht' },
  { id: 'story', label: 'Story 9:16', width: 1080, height: 1920, hint: 'Instagram en LinkedIn stories' },
  { id: 'linkedin', label: 'LinkedIn liggend', width: 1200, height: 627, hint: 'Bericht met link' },
  { id: 'behance', label: 'Behance-module', width: 1400, height: 0, hint: '1400 px breed, hoogte volgt de scène' },
];

export const findPreset = (id?: string | null) => EXPORT_PRESETS.find((p) => p.id === id) ?? null;
