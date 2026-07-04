#!/usr/bin/env node
/**
 * Zaubertisch – Card Studio · Glyph-Slicer
 * -------------------------------------------------------------
 * Zerschneidet ein einzelnes Glyphen-Sheet (goldene Zahlen 1–13
 * sowie Z und N auf schwarzem Hintergrund) in 15 transparente
 * Einzel-PNGs, die vom Karten-Generator verwendet werden.
 *
 * Erwartete Eingabe:  input/glyph_sheet.png
 * Ergebnis:           input/glyphs/1.png … 13.png, Z.png, N.png
 *
 * Der schwarze Hintergrund wird transparent gemacht (Alpha aus der
 * Helligkeit), sodass der Glow der Glyphen erhalten bleibt und sie
 * sauber auf den dunklen Kartenhintergrund passen.
 *
 * Aufruf:  node slice-glyphs.js   (oder: npm run glyphs)
 */

'use strict';

const fs = require('fs');
const path = require('path');

let sharp;
try {
  sharp = require('sharp');
} catch (err) {
  console.error('\n❌ Das Paket "sharp" ist nicht installiert. Bitte zuerst: npm install\n');
  process.exit(1);
}

const INPUT_DIR = path.join(__dirname, 'input');
const GLYPHS_DIR = path.join(INPUT_DIR, 'glyphs');
const SHEET = path.join(INPUT_DIR, 'glyph_sheet.png');

// Rasterlayout des Sheets: 7 Spalten × 3 Zeilen.
const COLS = 7;
const ROWS = 3;

// Zuordnung: welche Glyphe sitzt in welcher (Zeile, Spalte)?
//   Zeile 0: 1 2 3 4 5 6 7
//   Zeile 1: 8 9 10 11 12 13
//   Zeile 2:     Z  N
const GLYPH_MAP = [
  { name: '1', r: 0, c: 0 },
  { name: '2', r: 0, c: 1 },
  { name: '3', r: 0, c: 2 },
  { name: '4', r: 0, c: 3 },
  { name: '5', r: 0, c: 4 },
  { name: '6', r: 0, c: 5 },
  { name: '7', r: 0, c: 6 },
  { name: '8', r: 1, c: 0 },
  { name: '9', r: 1, c: 1 },
  { name: '10', r: 1, c: 2 },
  { name: '11', r: 1, c: 3 },
  { name: '12', r: 1, c: 4 },
  { name: '13', r: 1, c: 5 },
  { name: 'Z', r: 2, c: 2 },
  { name: 'N', r: 2, c: 3 },
];

// Ab welchem Alpha-Wert gilt ein Pixel als "zur Glyphe gehörig"
// (für das enge Zuschneiden). Kleiner = mehr Glow bleibt stehen.
const BBOX_ALPHA_THRESHOLD = 22;
// Rand (px), der um die erkannte Glyphe herum erhalten bleibt (Glow).
const PADDING = 8;
// Zeilen, die weniger als diesen Anteil vertikal auseinanderliegen,
// gelten als zusammengehörig (überbrückt kleine Lücken innerhalb einer
// Zahl). Größere Lücken trennen Zahl von Zier-Ornamenten.
const BAND_GAP_FRACTION = 0.04;
// Auf true setzen, wenn Zier-Ornamente über/unter der Zahl NICHT entfernt,
// sondern mitgeschnitten werden sollen (nimmt die komplette Zelle).
const KEEP_ORNAMENTS = false;

/** Wandelt eine RGB(A)-Kachel in RGBA um, Alpha = Helligkeit (max r,g,b). */
function toAlphaFromLuma(rgb, width, height, channels) {
  const out = Buffer.alloc(width * height * 4);
  for (let p = 0, s = 0, d = 0; p < width * height; p++, s += channels, d += 4) {
    const r = rgb[s];
    const g = rgb[s + 1];
    const b = rgb[s + 2];
    let a = Math.max(r, g, b);
    if (a < 8) a = 0; // Rauschen im Schwarz entfernen
    out[d] = r;
    out[d + 1] = g;
    out[d + 2] = b;
    out[d + 3] = a;
  }
  return out;
}

/**
 * Ermittelt die enge Bounding-Box der eigentlichen Glyphe.
 *
 * Statt einfach alle hellen Pixel der Kachel zu umschließen, wird das
 * größte zusammenhängende vertikale "Band" heller Zeilen gewählt. So
 * werden kleine, vom Zeichen abgesetzte Zier-Ornamente über/unter der
 * Zahl automatisch ignoriert (sofern KEEP_ORNAMENTS = false).
 */
function tightBBox(rgba, width, height) {
  // Pro Zeile die Anzahl "heller" Pixel zählen.
  const rowCount = new Array(height).fill(0);
  for (let y = 0; y < height; y++) {
    let c = 0;
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] >= BBOX_ALPHA_THRESHOLD) c++;
    }
    rowCount[y] = c;
  }

  // Zeilen-Bänder bilden; kleine Lücken innerhalb einer Zahl überbrücken.
  const maxGap = Math.max(2, Math.round(height * BAND_GAP_FRACTION));
  const bands = [];
  let start = -1;
  let gap = 0;
  for (let y = 0; y < height; y++) {
    if (rowCount[y] > 0) {
      if (start < 0) start = y;
      gap = 0;
    } else if (start >= 0) {
      gap++;
      if (gap > maxGap) {
        bands.push({ y0: start, y1: y - gap });
        start = -1;
        gap = 0;
      }
    }
  }
  if (start >= 0) bands.push({ y0: start, y1: height - 1 });
  if (bands.length === 0) return null; // leere Kachel

  // Vertikalen Bereich wählen: größtes Band (meiste hellen Pixel) …
  let yTop, yBot;
  if (KEEP_ORNAMENTS) {
    yTop = bands[0].y0;
    yBot = bands[bands.length - 1].y1;
  } else {
    let best = null;
    let bestSum = -1;
    for (const b of bands) {
      let sum = 0;
      for (let y = b.y0; y <= b.y1; y++) sum += rowCount[y];
      if (sum > bestSum) {
        bestSum = sum;
        best = b;
      }
    }
    yTop = best.y0;
    yBot = best.y1;
  }

  // … und darin die horizontale Ausdehnung eng bestimmen.
  let minX = width, maxX = -1;
  for (let y = yTop; y <= yBot; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] >= BBOX_ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }
  if (maxX < 0) return null;

  const left = Math.max(0, minX - PADDING);
  const top = Math.max(0, yTop - PADDING);
  const right = Math.min(width - 1, maxX + PADDING);
  const bottom = Math.min(height - 1, yBot + PADDING);
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

async function main() {
  console.log('✂️   Zaubertisch – Glyph-Slicer');
  console.log('─────────────────────────────');

  if (!fs.existsSync(SHEET)) {
    console.error(`\n❌ Datei fehlt: input/glyph_sheet.png`);
    console.error('   Bitte lege dein Glyphen-Sheet (goldene Zahlen 1–13 + Z + N');
    console.error('   auf schwarzem Hintergrund) als input/glyph_sheet.png ab.\n');
    process.exit(1);
  }

  fs.mkdirSync(GLYPHS_DIR, { recursive: true });

  const meta = await sharp(SHEET).metadata();
  const cellW = Math.floor(meta.width / COLS);
  const cellH = Math.floor(meta.height / ROWS);
  console.log(`   Sheet: ${meta.width}×${meta.height}px  →  Raster ${COLS}×${ROWS} (Zelle ${cellW}×${cellH})`);

  let done = 0;
  for (const g of GLYPH_MAP) {
    const left = g.c * cellW;
    const top = g.r * cellH;

    // Kachel ausschneiden und als RGB einlesen.
    const { data, info } = await sharp(SHEET)
      .extract({ left, top, width: cellW, height: cellH })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const rgba = toAlphaFromLuma(data, info.width, info.height, info.channels);
    const box = tightBBox(rgba, info.width, info.height);

    if (!box) {
      console.warn(`   ⚠️  Glyphe "${g.name}" wirkt leer – bitte Rasterlayout prüfen.`);
      continue;
    }

    // Enges, transparentes PNG speichern.
    const cropped = Buffer.alloc(box.width * box.height * 4);
    for (let y = 0; y < box.height; y++) {
      const srcStart = ((box.top + y) * info.width + box.left) * 4;
      rgba.copy(
        cropped,
        y * box.width * 4,
        srcStart,
        srcStart + box.width * 4
      );
    }

    await sharp(cropped, { raw: { width: box.width, height: box.height, channels: 4 } })
      .png()
      .toFile(path.join(GLYPHS_DIR, `${g.name}.png`));

    done++;
    process.stdout.write(`\r   schneide Glyphen … ${done}/${GLYPH_MAP.length}   `);
  }
  process.stdout.write('\n');

  console.log('─────────────────────────────');
  console.log(`✅  ${done} Glyphen erzeugt in: ${GLYPHS_DIR}`);
  console.log('    Jetzt "npm start" ausführen, um das Deck zu bauen.');
}

main().catch((err) => {
  console.error('\n❌ Fehler beim Zerschneiden:');
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
