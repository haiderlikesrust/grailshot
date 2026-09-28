"""Rebuild original vector branding and subset local OFL fonts.

Optional design tooling: python -m pip install fonttools brotli
The generated files are committed; deployment does not run this script.
"""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools import subset
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

root = Path(__file__).resolve().parents[1]
fonts = root / 'public/fonts'
brand = root / 'public/brand'
faces = [
    ('-F63fjptAgt5VM-kVkqdyU8n5ig.ttf', 'ibm-plex-mono', 400),
    ('-F6qfjptAgt5VM-kVkqdyU8n3twJ8lc.ttf', 'ibm-plex-mono', 500),
    ('-F6qfjptAgt5VM-kVkqdyU8n3vAO8lc.ttf', 'ibm-plex-mono', 600),
    ('V8mQoQDjQSkFtoMM3T6r8E7mF71Q-gOoraIAEj7oUUsj.ttf', 'space-grotesk', 400),
    ('V8mQoQDjQSkFtoMM3T6r8E7mF71Q-gOoraIAEj7aUUsj.ttf', 'space-grotesk', 500),
    ('V8mQoQDjQSkFtoMM3T6r8E7mF71Q-gOoraIAEj42Vksj.ttf', 'space-grotesk', 600),
    ('V8mQoQDjQSkFtoMM3T6r8E7mF71Q-gOoraIAEj4PVksj.ttf', 'space-grotesk', 700),
]
css = []
for source, family, weight in faces:
    font = TTFont(fonts / source)
    options = subset.Options()
    options.flavor = 'woff2'
    sub = subset.Subsetter(options=options)
    sub.populate(unicodes=list(range(0x20, 0x250)) + list(range(0x2000, 0x2070)) + [0x20ac] + list(range(0x2190, 0x2200)))
    sub.subset(font)
    font.flavor = 'woff2'
    name = f'{family}-{weight}-v1.woff2'
    font.save(fonts / name)
    display = 'Space Grotesk' if family == 'space-grotesk' else 'IBM Plex Mono'
    css.append(f"@font-face{{font-family:'{display}';font-style:normal;font-weight:{weight};font-display:swap;src:url('/fonts/{name}') format('woff2');unicode-range:U+0020-024F,U+2000-206F,U+20AC,U+2190-21FF;}}")
(fonts / 'fonts-v2.css').write_text('\n'.join(css), encoding='utf-8')

# Outlines keep the wordmark identical in every browser, without a font request.
font = TTFont(fonts / faces[-1][0])
glyphs, cmap = font.getGlyphSet(), font.getBestCmap()
pen = SVGPathPen(glyphs)
x = 0
for char in 'GRAILSHOT':
    glyph = glyphs[cmap[ord(char)]]
    glyph.draw(TransformPen(pen, (1, 0, .15, -1, x, 0)))
    x += glyph.width - 20
word = pen.getCommands()
mark = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="10" y="4" width="44" height="56" rx="9" fill="#ffe052"/><rect x="15" y="9" width="34" height="46" rx="5" fill="none" stroke="#24291d" stroke-width="2"/><circle cx="32" cy="32" r="13" fill="none" stroke="#24291d" stroke-width="3"/><path d="M32 14v9m0 18v9M14 32h9m18 0h9" stroke="#ffe052" stroke-width="7"/><path d="M32 15v7m0 20v7M15 32h7m20 0h7" stroke="#24291d" stroke-width="3" stroke-linecap="round"/><path d="M32 24c2 5 3 6 8 8-5 2-6 3-8 8-2-5-3-6-8-8 5-2 6-3 8-8Z" fill="#24291d"/></svg>'''
(brand / 'grailshot-mark-v5.svg').write_text(mark, encoding='utf-8')
(root / 'public/favicon.svg').write_text(mark, encoding='utf-8')

pack = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 510" fill="none">
<title>GRAILSHOT Electric Series sealed pack</title>
<defs>
<linearGradient id="foil" x1="37" y1="90" x2="324" y2="450" gradientUnits="userSpaceOnUse"><stop stop-color="#fff4a9"/><stop offset=".18" stop-color="#ffe052"/><stop offset=".65" stop-color="#f4c82e"/><stop offset=".9" stop-color="#ffea79"/><stop offset="1" stop-color="#c9910d"/></linearGradient>
<linearGradient id="ink" x1="90" y1="120" x2="250" y2="420" gradientUnits="userSpaceOnUse"><stop stop-color="#34372f"/><stop offset=".5" stop-color="#23271f"/><stop offset="1" stop-color="#191d17"/></linearGradient>
<linearGradient id="shine"><stop stop-color="#fff" stop-opacity=".3"/><stop offset=".2" stop-color="#fff" stop-opacity="0"/><stop offset=".8" stop-color="#000" stop-opacity=".04"/><stop offset="1" stop-color="#fff" stop-opacity=".23"/></linearGradient>
<pattern id="crimp" width="7" height="22" patternUnits="userSpaceOnUse"><path d="M1 0v22M3 0v22" stroke="#10140f" stroke-opacity=".7"/><path d="M5 0v22" stroke="#9b977e" stroke-opacity=".3"/></pattern>
<pattern id="dots" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#ffe052" opacity=".09"/></pattern>
</defs>
<path d="M28 14 333 14 322 53 325 455 337 493 24 493 36 455 39 53Z" fill="#1c211b" stroke="#898571" stroke-width="2"/>
<path d="M39 48h282v414H36Z" fill="url(#foil)"/>
<path d="M40 146 321 91v301L36 447Z" fill="url(#ink)"/>
<path d="M40 153 321 98v293L36 438Z" fill="url(#dots)"/>
<path d="m39 145 282-55v10L39 155Z" fill="#9d822a"/><path d="m36 437 285-55v11L36 448Z" fill="#9d822a"/>
<path d="M53 59h31m-31 0v29m253-29h-31m31 0v29" stroke="#30352b" stroke-width="2"/>
<g transform="translate(64 110) scale({231/x})" fill="#22231f"><path d="{word}"/></g>
<text x="181" y="132" fill="#30352b" font-family="Arial,sans-serif" font-weight="700" font-size="8" letter-spacing="4" text-anchor="middle">E L E C T R I C   S E R I E S</text>
<g transform="rotate(-8 180 265)">
<rect x="122" y="181" width="118" height="168" rx="15" fill="#ffe052"/>
<rect x="130" y="189" width="102" height="152" rx="10" stroke="#24291d" stroke-width="3"/>
<circle cx="181" cy="265" r="38" stroke="#24291d" stroke-width="7" stroke-dasharray="49 11" transform="rotate(-38 181 265)"/>
<path d="M181 213v17m0 70v17m-53-52h18m70 0h18" stroke="#24291d" stroke-width="7" stroke-linecap="round"/>
<path d="M181 243c4 13 9 18 22 22-13 4-18 9-22 22-4-13-9-18-22-22 13-4 18-9 22-22Z" fill="#24291d"/>
</g>
<path d="m269 155 3 12 12 3-12 3-3 12-3-12-12-3 12-3Zm-181 189 3 12 12 3-12 3-3 12-3-12-12-3 12-3Z" fill="#ffe052"/>
<path d="m66 213 16-3m-13 9 16-3m174 91 29-6m-26 13 29-6" stroke="#8e957a" stroke-width="2"/>
<text x="180" y="385" transform="rotate(-11 180 385)" fill="#ffe780" font-family="Arial,sans-serif" font-weight="700" font-size="12" letter-spacing="3" text-anchor="middle">HOLD. AIM. WIN.</text>
<text x="180" y="426" fill="#22231f" font-family="Arial,sans-serif" font-weight="700" font-size="9" letter-spacing="2" text-anchor="middle">YOUR NEXT GRAIL AWAITS</text>
<path d="M33 18h293v25H33Zm-3 450h301v38H30Z" fill="url(#crimp)"/>
<path d="M38 49h283M36 445h289" stroke="#10140f" stroke-opacity=".45"/>
<path d="M43 54h271v384H39Z" fill="url(#shine)"/>
<path d="M44 53 40 436M312 54l6 384" stroke="#fff" stroke-opacity=".2"/>
</svg>'''
(brand / 'grailshot-pack-v5.svg').write_text(pack, encoding='utf-8')
for p in [brand / 'grailshot-mark-v5.svg', brand / 'grailshot-pack-v5.svg', *fonts.glob('*-v1.woff2')]:
    print(p.name, p.stat().st_size)
