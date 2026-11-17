from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import glob, sys
lora = [f for f in glob.glob('/usr/share/fonts/**/*Lora*', recursive=True) if 'Italic' not in f][0]
inter = [f for f in glob.glob('/usr/share/fonts/**/Inter-Regular.otf', recursive=True)][0]
def text_path(fontfile, text, size, x, y, tracking=0):
    f = TTFont(fontfile); gs = f.getGlyphSet(); cmap = f.getBestCmap(); upm = f['head'].unitsPerEm
    s = size/upm; pen = SVGPathPen(gs); cx = x
    for ch in text:
        g = cmap.get(ord(ch));
        if g is None: continue
        tp = TransformPen(pen, (s,0,0,-s,cx,y)); gs[g].draw(tp); cx += gs[g].width*s + tracking
    return pen.getCommands(), cx
mark = '<path d="M20 4a16 16 0 1 0 16 16V36H20" fill="none" stroke="#1d1c1a" stroke-width="3.2"/>'
# logo
d, end = text_path(lora, 'Atelier Noord', 30, 50, 31)
w = int(end + 4)
open('fixtures/atelier-noord-logo.svg','w').write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} 40" width="{w*4}" height="160">{mark}<path d="{d}" fill="#1d1c1a"/></svg>\n')
# visitekaartje 85x55 mm -> 850x550
d1,_ = text_path(lora, 'Atelier Noord', 40, 136, 116)
d2,_ = text_path(inter, 'Femke de Vries', 26, 70, 400)
d3,_ = text_path(inter, 'Architect', 22, 70, 436)
d4,_ = text_path(inter, 'femke@ateliernoord.nl', 20, 520, 400)
d5,_ = text_path(inter, '+31 50 123 45 67', 20, 520, 436)
card = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 850 550" width="1700" height="1100">
<rect width="850" height="550" fill="#e9e5de"/>
<g transform="translate(70 76) scale(1.15)">{mark}</g>
<path d="{d1}" fill="#1d1c1a"/>
<rect x="70" y="330" width="710" height="1.5" fill="#b9a68d"/>
<path d="{d2}" fill="#1d1c1a"/><path d="{d3}" fill="#6b665e"/>
<path d="{d4}" fill="#1d1c1a"/><path d="{d5}" fill="#1d1c1a"/>
</svg>
'''
open('fixtures/atelier-noord-visitekaartje.svg','w').write(card)
print('ok', w)
