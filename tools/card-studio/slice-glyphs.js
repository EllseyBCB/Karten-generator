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

// Zeilen-Layout des Sheets (welche Zeichen in welcher Zeile, links → rechts).
// Die genaue horizontale Position wird NICHT angenommen, sondern pro Zeile
// automatisch erkannt (zweistellige Zahlen sind breiter und liegen nicht in
// gleichmäßigen Spalten). Nur die Reihenfolge und Anzahl je Zeile zählt.
//   Zeile 0: 1 2 3 4 5 6 7
//   Zeile 1: 8 9 10 11 12 13
//   Zeile 2: Z N
const ROWS_LAYOUT = [
  ['1', '2', '3', '4', '5', '6', '7'],
  ['8', '9', '10', '11', '12', '13'],
  ['Z', 'N'],
];
const ROWS = ROWS_LAYOUT.length;

// Ab welchem Alpha-Wert gilt ein Pixel als "zur Glyphe gehörig"
// (für das enge Zuschneiden). Kleiner = mehr Glow bleibt stehen.
const BBOX_ALPHA_THRESHOLD = 22;
// Rand (px), der um die erkannte Glyphe herum erhalten bleibt (Glow).
const PADDING = 8;
// Dichte-Schwelle: Eine Zeile zählt nur dann zur Zahl, wenn ihre Anzahl
// heller Pixel über diesem Anteil der dichtesten Zeile liegt. Die Zahl ist
// dicht, die Zier-Ornamente sind dünnes Filigran – dadurch werden Ornamente
// zuverlässig abgetrennt, unabhängig vom genauen Abstand.
const ROW_DENSITY_FRACTION = 0.1;
// Kleine vertikale Lücken innerhalb der Zahl überbrücken (in px).
const BAND_GAP = 4;
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
 * Zeilen werden nach ihrer Pixel-Dichte bewertet: nur ausreichend "dichte"
 * Zeilen zählen zur Zahl. Das dünne Zier-Filigran über/unter der Zahl fällt
 * dadurch heraus – unabhängig davon, wie nah es an der Zahl sitzt. Aus den
 * dichten Zeilen wird das größte zusammenhängende Band (die Zahl) gewählt.
 */
function tightBBox(rgba, width, height) {
  // Pro Zeile die Anzahl "heller" Pixel zählen + dichteste Zeile finden.
  const rowCount = new Array(height).fill(0);
  let maxRow = 0;
  for (let y = 0; y < height; y++) {
    let c = 0;
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] >= BBOX_ALPHA_THRESHOLD) c++;
    }
    rowCount[y] = c;
    if (c > maxRow) maxRow = c;
  }
  if (maxRow === 0) return null; // leere Kachel

  // Eine Zeile gehört zur Glyphe, wenn sie dicht genug ist. Bei KEEP_ORNAMENTS
  // reicht ein einzelnes helles Pixel (Ornamente bleiben dann erhalten).
  const rowThreshold = KEEP_ORNAMENTS ? 0 : maxRow * ROW_DENSITY_FRACTION;

  // Dichte Zeilen zu Bändern zusammenfassen (kleine Lücken überbrücken).
  const bands = [];
  let start = -1;
  let gap = 0;
  for (let y = 0; y < height; y++) {
    if (rowCount[y] > rowThreshold) {
      if (start < 0) start = y;
      gap = 0;
    } else if (start >= 0) {
      gap++;
      if (gap > BAND_GAP) {
        bands.push({ y0: start, y1: y - gap });
        start = -1;
        gap = 0;
      }
    }
  }
  if (start >= 0) bands.push({ y0: start, y1: height - 1 });
  if (bands.length === 0) return null;

  // Größtes Band (meiste helle Pixel) = die Zahl.
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
  const yTop = best.y0;
  const yBot = best.y1;

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

/**
 * Findet in einem Zeilen-Streifen das dominante vertikale Band der Zeichen
 * (die Zahlen), damit die Ornament-Zeilen die Spaltenerkennung nicht stören.
 */
function rowNumberBand(rgba, width, height) {
  const rowCount = new Array(height).fill(0);
  let maxRow = 0;
  for (let y = 0; y < height; y++) {
    let c = 0;
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] >= BBOX_ALPHA_THRESHOLD) c++;
    }
    rowCount[y] = c;
    if (c > maxRow) maxRow = c;
  }
  if (maxRow === 0) return null;
  const thr = maxRow * ROW_DENSITY_FRACTION;
  let best = null, bestSum = -1, start = -1, gap = 0;
  const close = (y1) => {
    let sum = 0;
    for (let y = start; y <= y1; y++) sum += rowCount[y];
    if (sum > bestSum) { bestSum = sum; best = [start, y1]; }
  };
  for (let y = 0; y < height; y++) {
    if (rowCount[y] > thr) { if (start < 0) start = y; gap = 0; }
    else if (start >= 0) { gap++; if (gap > BAND_GAP) { close(y - gap); start = -1; } }
  }
  if (start >= 0) close(height - 1);
  return best;
}

/**
 * Teilt einen Zeilen-Streifen anhand der Spalten-Dichte in genau `expected`
 * Zeichen auf. Es werden zunächst alle Inhalts-Läufe gesucht und dann die
 * kleinsten Zwischenräume zusammengeführt, bis genau `expected` Gruppen
 * übrig sind – so bleiben die größten Lücken (zwischen den Zahlen) als Trenner
 * stehen, während enge Lücken (z. B. zwischen den Ziffern von „10") verschmelzen.
 */
function splitColumns(rgba, width, band, expected) {
  const [y0, y1] = band;
  const colCount = new Array(width).fill(0);
  for (let x = 0; x < width; x++) {
    let c = 0;
    for (let y = y0; y <= y1; y++) {
      if (rgba[(y * width + x) * 4 + 3] >= BBOX_ALPHA_THRESHOLD) c++;
    }
    colCount[x] = c;
  }

  // Inhalts-Läufe (winzige Lücken überbrücken).
  const runs = [];
  let start = -1, gap = 0;
  for (let x = 0; x < width; x++) {
    if (colCount[x] > 0) { if (start < 0) start = x; gap = 0; }
    else if (start >= 0) { gap++; if (gap > 2) { runs.push([start, x - gap]); start = -1; } }
  }
  if (start >= 0) runs.push([start, width - 1]);
  if (runs.length === 0) return [];

  // Falls zu wenige Läufe erkannt werden: gleichmäßig aufteilen (Fallback).
  if (runs.length < expected) {
    const lo = runs[0][0], hi = runs[runs.length - 1][1];
    const step = (hi - lo + 1) / expected;
    return Array.from({ length: expected }, (_, i) => [
      Math.round(lo + i * step),
      Math.round(lo + (i + 1) * step) - 1,
    ]);
  }

  // Kleinste Zwischenräume zusammenführen, bis genau `expected` Gruppen bleiben.
  const groups = runs.map((r) => [r[0], r[1]]);
  while (groups.length > expected) {
    let mi = 0, mg = Infinity;
    for (let i = 0; i < groups.length - 1; i++) {
      const g = groups[i + 1][0] - groups[i][1];
      if (g < mg) { mg = g; mi = i; }
    }
    groups[mi] = [groups[mi][0], groups[mi + 1][1]];
    groups.splice(mi + 1, 1);
  }
  return groups;
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
  const cellH = Math.floor(meta.height / ROWS);
  const total = ROWS_LAYOUT.reduce((n, row) => n + row.length, 0);
  console.log(`   Sheet: ${meta.width}×${meta.height}px  →  ${ROWS} Zeilen, Spalten je Zeile automatisch erkannt`);

  const H_PAD = 10; // etwas horizontaler Rand um jedes erkannte Zeichen
  let done = 0;

  for (let r = 0; r < ROWS_LAYOUT.length; r++) {
    const names = ROWS_LAYOUT[r];
    const top = r * cellH;

    // Ganzen Zeilen-Streifen einlesen.
    const strip = await sharp(SHEET)
      .extract({ left: 0, top, width: meta.width, height: cellH })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const sRgba = toAlphaFromLuma(strip.data, strip.info.width, strip.info.height, strip.info.channels);

    const band = rowNumberBand(sRgba, strip.info.width, strip.info.height);
    if (!band) {
      console.warn(`   ⚠️  Zeile ${r + 1} wirkt leer – bitte Sheet prüfen.`);
      continue;
    }

    const groups = splitColumns(sRgba, strip.info.width, band, names.length);
    if (groups.length !== names.length) {
      console.warn(`   ⚠️  Zeile ${r + 1}: ${groups.length} Zeichen erkannt, erwartet ${names.length}.`);
    }

    for (let i = 0; i < names.length && i < groups.length; i++) {
      const name = names[i];
      const gx0 = Math.max(0, groups[i][0] - H_PAD);
      const gx1 = Math.min(meta.width - 1, groups[i][1] + H_PAD);
      const gw = gx1 - gx0 + 1;

      // Sub-Kachel dieses Zeichens ausschneiden und eng zuschneiden.
      const cell = await sharp(SHEET)
        .extract({ left: gx0, top, width: gw, height: cellH })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const rgba = toAlphaFromLuma(cell.data, cell.info.width, cell.info.height, cell.info.channels);
      const box = tightBBox(rgba, cell.info.width, cell.info.height);
      if (!box) {
        console.warn(`   ⚠️  Zeichen "${name}" wirkt leer.`);
        continue;
      }

      const cropped = Buffer.alloc(box.width * box.height * 4);
      for (let y = 0; y < box.height; y++) {
        const srcStart = ((box.top + y) * cell.info.width + box.left) * 4;
        rgba.copy(cropped, y * box.width * 4, srcStart, srcStart + box.width * 4);
      }
      await sharp(cropped, { raw: { width: box.width, height: box.height, channels: 4 } })
        .png()
        .toFile(path.join(GLYPHS_DIR, `${name}.png`));

      done++;
      process.stdout.write(`\r   schneide Zeichen … ${done}/${total}   `);
    }
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
