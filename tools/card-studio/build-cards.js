#!/usr/bin/env node
/**
 * Zaubertisch – Card Studio
 * -------------------------------------------------------------
 * Baut aus wenigen PNG-Basisgrafiken ein komplettes Wizard-Kartendeck.
 *
 * - Keine KI-Generierung: es werden ausschließlich vorhandene PNGs
 *   zusammengesetzt und Text als Vektor-Overlay ergänzt.
 * - Alle Karten exakt 750 x 1125 px.
 * - Fantasy-Stil, dunkler Hintergrund (aus dem Template), goldene Schrift.
 *
 * Aufruf:  node build-cards.js   (oder: npm start)
 */

'use strict';

const fs = require('fs');
const path = require('path');

let sharp;
try {
  sharp = require('sharp');
} catch (err) {
  console.error('\n❌ Das Paket "sharp" ist nicht installiert.');
  console.error('   Bitte zuerst im Ordner tools/card-studio ausführen:\n');
  console.error('     npm install\n');
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 *  Grund-Konfiguration
 * ------------------------------------------------------------------ */

const WIDTH = 750;
const HEIGHT = 1125;

const INPUT_DIR = path.join(__dirname, 'input');
const OUTPUT_DIR = path.join(__dirname, 'output');

// Farben pro Suit (nur für die Textfarbe der Eckziffern nutzbar,
// die goldene Grundschrift bleibt aber einheitlich für Lesbarkeit).
const COLORS = ['blue', 'red', 'yellow', 'green'];

// Goldene Schrift mit dunklem Rand für klare Lesbarkeit (auch auf dem iPhone).
const GOLD = '#f4cf5b';
const GOLD_DARK = '#b8862b';
const STROKE = '#241606';

// Serifen-Schrift für den Fantasy-Look. Fallbacks, falls eine Schrift
// auf dem System fehlt.
const FONT_FAMILY =
  "'Cinzel', 'Trajan Pro', 'Times New Roman', Georgia, 'DejaVu Serif', serif";

/* ------------------------------------------------------------------ *
 *  Layout (fixe Positionen – auf jeder Karte identisch)
 * ------------------------------------------------------------------ */

const LAYOUT = {
  // Große Glyphe oben links
  bigGlyph: { x: 62, baseline: 190, size: 205 },
  // Kleine Glyphe unten rechts (um 180° gedreht, wie bei Spielkarten)
  smallGlyph: { cx: 648, cy: 955, size: 112 },
  // Kleines Symbol oben links (unter der großen Zahl)
  smallSymTopLeft: { x: 66, y: 210, box: 92 },
  // Kleines Symbol unten rechts (über der kleinen Zahl)
  smallSymBottomRight: { x: WIDTH - 66 - 92, y: HEIGHT - 210 - 92, box: 92 },
  // Großes Symbol / Figur mittig
  centerSymbol: { box: 380 },
  centerFigure: { boxW: 480, boxH: 640, top: 275 },
  // Label unten (ZAUBERER / NARR)
  label: { baseline: 1052, size: 74 },
};

/* ------------------------------------------------------------------ *
 *  Benötigte Input-Dateien
 * ------------------------------------------------------------------ */

function requiredInputs() {
  const files = ['card_template.png'];
  for (const c of COLORS) {
    files.push(`symbol_${c}.png`);
    files.push(`wizard_${c}.png`);
    files.push(`jester_${c}.png`);
  }
  return files;
}

/* ------------------------------------------------------------------ *
 *  Helfer
 * ------------------------------------------------------------------ */

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Lädt ein PNG und skaliert es proportinal so, dass es vollständig
 * in eine box (boxW x boxH) passt ("fit: inside").
 * Gibt Buffer + tatsächliche Zielgröße zurück.
 */
async function fitImage(file, boxW, boxH) {
  const buffer = await sharp(path.join(INPUT_DIR, file))
    .resize(boxW, boxH, { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();
  const meta = await sharp(buffer).metadata();
  return { buffer, width: meta.width, height: meta.height };
}

/** Platziert ein Bild zentriert in einer Box (x, y, boxW, boxH). */
function centerInBox(img, x, y, boxW, boxH) {
  return {
    input: img.buffer,
    left: Math.round(x + (boxW - img.width) / 2),
    top: Math.round(y + (boxH - img.height) / 2),
  };
}

/**
 * Erzeugt das Text-Overlay (SVG in Kartengröße) mit:
 *  - großer Glyphe oben links
 *  - kleiner, um 180° gedrehter Glyphe unten rechts
 *  - optionalem Label unten (ZAUBERER / NARR)
 */
function textOverlaySVG(bigGlyph, smallGlyph, label) {
  const bg = LAYOUT.bigGlyph;
  const sg = LAYOUT.smallGlyph;
  const lb = LAYOUT.label;

  const labelSvg = label
    ? `<text x="${WIDTH / 2}" y="${lb.baseline}" text-anchor="middle"
             font-family="${FONT_FAMILY}" font-size="${lb.size}"
             font-weight="700" letter-spacing="6"
             fill="url(#gold)" stroke="${STROKE}" stroke-width="4"
             paint-order="stroke">${esc(label)}</text>`
    : '';

  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}"
     xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0"   stop-color="${GOLD}"/>
      <stop offset="0.55" stop-color="${GOLD}"/>
      <stop offset="1"   stop-color="${GOLD_DARK}"/>
    </linearGradient>
  </defs>

  <!-- Große Glyphe oben links -->
  <text x="${bg.x}" y="${bg.baseline}" text-anchor="start"
        font-family="${FONT_FAMILY}" font-size="${bg.size}"
        font-weight="700"
        fill="url(#gold)" stroke="${STROKE}" stroke-width="7"
        paint-order="stroke">${esc(bigGlyph)}</text>

  <!-- Kleine Glyphe unten rechts, um 180° gedreht -->
  <g transform="rotate(180 ${sg.cx} ${sg.cy})">
    <text x="${sg.cx}" y="${sg.cy}" text-anchor="middle"
          dominant-baseline="middle"
          font-family="${FONT_FAMILY}" font-size="${sg.size}"
          font-weight="700"
          fill="url(#gold)" stroke="${STROKE}" stroke-width="5"
          paint-order="stroke">${esc(smallGlyph)}</text>
  </g>

  ${labelSvg}
</svg>`);
}

/* ------------------------------------------------------------------ *
 *  Karten-Erzeugung
 * ------------------------------------------------------------------ */

async function buildBaseTemplate() {
  // Template einmal auf exakte Kartengröße bringen (deckt Abweichungen ab).
  return sharp(path.join(INPUT_DIR, 'card_template.png'))
    .resize(WIDTH, HEIGHT, { fit: 'fill' })
    .png()
    .toBuffer();
}

/** Zahlenkarte (z. B. blue_7). */
async function buildNumberCard(baseTemplate, color, number, outFile) {
  const L = LAYOUT;

  const centerSym = await fitImage(
    `symbol_${color}.png`,
    L.centerSymbol.box,
    L.centerSymbol.box
  );
  const smallSymTL = await fitImage(
    `symbol_${color}.png`,
    L.smallSymTopLeft.box,
    L.smallSymTopLeft.box
  );
  const smallSymBR = await fitImage(
    `symbol_${color}.png`,
    L.smallSymBottomRight.box,
    L.smallSymBottomRight.box
  );

  const centerX = (WIDTH - L.centerSymbol.box) / 2;
  const centerY = (HEIGHT - L.centerSymbol.box) / 2;

  const overlay = textOverlaySVG(String(number), String(number), null);

  await sharp(baseTemplate)
    .composite([
      centerInBox(centerSym, centerX, centerY, L.centerSymbol.box, L.centerSymbol.box),
      centerInBox(
        smallSymTL,
        L.smallSymTopLeft.x,
        L.smallSymTopLeft.y,
        L.smallSymTopLeft.box,
        L.smallSymTopLeft.box
      ),
      centerInBox(
        smallSymBR,
        L.smallSymBottomRight.x,
        L.smallSymBottomRight.y,
        L.smallSymBottomRight.box,
        L.smallSymBottomRight.box
      ),
      { input: overlay, left: 0, top: 0 },
    ])
    .png()
    .toFile(path.join(OUTPUT_DIR, outFile));
}

/** Sonderkarte: Zauberer (Z) oder Narr (N). */
async function buildSpecialCard(baseTemplate, kind, color, outFile) {
  const L = LAYOUT;
  const isWizard = kind === 'wizard';
  const glyph = isWizard ? 'Z' : 'N';
  const label = isWizard ? 'ZAUBERER' : 'NARR';
  const figureFile = `${isWizard ? 'wizard' : 'jester'}_${color}.png`;

  const figure = await fitImage(figureFile, L.centerFigure.boxW, L.centerFigure.boxH);
  const figX = (WIDTH - L.centerFigure.boxW) / 2;

  const overlay = textOverlaySVG(glyph, glyph, label);

  await sharp(baseTemplate)
    .composite([
      centerInBox(figure, figX, L.centerFigure.top, L.centerFigure.boxW, L.centerFigure.boxH),
      { input: overlay, left: 0, top: 0 },
    ])
    .png()
    .toFile(path.join(OUTPUT_DIR, outFile));
}

/* ------------------------------------------------------------------ *
 *  Vorbereitung / Prüfungen
 * ------------------------------------------------------------------ */

function checkInputs() {
  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`\n❌ Der Ordner "input/" fehlt: ${INPUT_DIR}`);
    console.error('   Bitte lege den Ordner an und lege die Basisgrafiken hinein.\n');
    process.exit(1);
  }

  const missing = requiredInputs().filter(
    (f) => !fs.existsSync(path.join(INPUT_DIR, f))
  );

  if (missing.length > 0) {
    console.error('\n❌ Es fehlen benötigte Input-Dateien in tools/card-studio/input/:\n');
    for (const f of missing) console.error(`   • ${f}`);
    console.error(
      '\n   Bitte alle oben genannten PNG-Dateien im input-Ordner bereitstellen und erneut starten.\n'
    );
    process.exit(1);
  }
}

function prepareOutput() {
  // output/ automatisch erstellen, falls es fehlt.
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  // Alte Output-PNGs löschen.
  for (const f of fs.readdirSync(OUTPUT_DIR)) {
    if (f.toLowerCase().endsWith('.png')) {
      fs.unlinkSync(path.join(OUTPUT_DIR, f));
    }
  }
}

/* ------------------------------------------------------------------ *
 *  Hauptlauf
 * ------------------------------------------------------------------ */

async function main() {
  console.log('🎴  Zaubertisch – Card Studio');
  console.log('─────────────────────────────');

  checkInputs();
  prepareOutput();

  const baseTemplate = await buildBaseTemplate();
  let count = 0;

  // Zahlenkarten 1–13 pro Farbe
  for (const color of COLORS) {
    for (let n = 1; n <= 13; n++) {
      const out = `${color}_${n}.png`;
      await buildNumberCard(baseTemplate, color, n, out);
      count++;
      process.stdout.write(`\r   erzeuge Zahlenkarten … ${count}/52   `);
    }
  }
  process.stdout.write('\n');

  // Zauberer
  for (const color of COLORS) {
    await buildSpecialCard(baseTemplate, 'wizard', color, `wizard_${color}.png`);
    count++;
  }
  // Narren
  for (const color of COLORS) {
    await buildSpecialCard(baseTemplate, 'jester', color, `jester_${color}.png`);
    count++;
  }
  console.log(`   erzeuge Sonderkarten … 8/8`);

  console.log('─────────────────────────────');
  console.log(`✅  Deck erfolgreich erstellt: ${count} Karten`);
  console.log(`    Ausgabe-Ordner: ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error('\n❌ Fehler beim Erstellen des Decks:');
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
