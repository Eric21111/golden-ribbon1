// Test helper: text width from the app's real Inter font files, so layout tests can check that a label fits where it sits.
// A minimal TrueType reader (head, hhea, hmtx, cmap formats 4 and 12). No kerning or shaping, so a width is approximate
// (a few percent); callers keep a safety margin. Not a test itself.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const FONTS = {
  Inter_400Regular: '400Regular',
  Inter_500Medium: '500Medium',
  Inter_600SemiBold: '600SemiBold',
  Inter_700Bold: '700Bold',
};
const cache = new Map();

function load(family) {
  if (cache.has(family)) return cache.get(family);
  const dir = FONTS[family];
  if (!dir) throw new Error(`unknown font family ${family}`);
  const buf = readFileSync(path.resolve('node_modules/@expo-google-fonts/inter', dir, `${family}.ttf`));
  const tables = {};
  for (let i = 0; i < buf.readUInt16BE(4); i++) {
    const o = 12 + i * 16;
    tables[buf.toString('ascii', o, o + 4)] = buf.readUInt32BE(o + 8);
  }
  const unitsPerEm = buf.readUInt16BE(tables.head + 18);
  const hMetrics = buf.readUInt16BE(tables.hhea + 34);
  let fmt4 = null;
  let fmt12 = null;
  for (let i = 0; i < buf.readUInt16BE(tables.cmap + 2); i++) {
    const platform = buf.readUInt16BE(tables.cmap + 4 + i * 8);
    const sub = tables.cmap + buf.readUInt32BE(tables.cmap + 4 + i * 8 + 4);
    const format = buf.readUInt16BE(sub);
    if (format === 12 && fmt12 === null) fmt12 = sub;
    if (format === 4 && fmt4 === null && (platform === 3 || platform === 0)) fmt4 = sub;
  }
  const glyphFor = (cp) => {
    if (fmt12 !== null) {
      for (let g = 0; g < buf.readUInt32BE(fmt12 + 12); g++) {
        const o = fmt12 + 16 + g * 12;
        const start = buf.readUInt32BE(o);
        if (cp >= start && cp <= buf.readUInt32BE(o + 4)) return buf.readUInt32BE(o + 8) + (cp - start);
      }
      return 0;
    }
    const segX2 = buf.readUInt16BE(fmt4 + 6);
    const endO = fmt4 + 14;
    const startO = endO + segX2 + 2;
    const deltaO = startO + segX2;
    const rangeO = deltaO + segX2;
    for (let i = 0; i < segX2 / 2; i++) {
      const start = buf.readUInt16BE(startO + i * 2);
      if (cp < start || cp > buf.readUInt16BE(endO + i * 2)) continue;
      const delta = buf.readInt16BE(deltaO + i * 2);
      const range = buf.readUInt16BE(rangeO + i * 2);
      if (range === 0) return (cp + delta) & 0xffff;
      const glyph = buf.readUInt16BE(rangeO + i * 2 + range + (cp - start) * 2);
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  };
  const advance = (glyph) => buf.readUInt16BE(tables.hmtx + Math.min(glyph, hMetrics - 1) * 4);
  const font = { unitsPerEm, glyphFor, advance };
  cache.set(family, font);
  return font;
}

/** Width in dp of `text` set in `family` at `size`. */
export function textWidth(text, family, size) {
  const font = load(family);
  let total = 0;
  for (const ch of text) total += font.advance(font.glyphFor(ch.codePointAt(0)));
  return (total / font.unitsPerEm) * size;
}
