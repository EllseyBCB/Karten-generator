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
const GLYPHS_DIR = path.join(INPUT_DIR, 'glyphs');

// Wird in main() gesetzt: true, wenn goldene Glyph-Bilder vorhanden sind.
let GLYPH_MODE = false;

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
  // Glyphe (Zahl bzw. Z/N) in JEDER der vier Ecken.
  // Oben aufrecht, unten um 180° gedreht – wie bei Spielkarten, damit die
  // Zahl aus jeder Blickrichtung lesbar ist.
  corner: {
    height: 126,   // Zielhöhe der Eck-Glyphe (Bild-Modus)
    svgSize: 120,  // Schriftgröße im SVG-Fallback
    marginX: 48,   // Abstand vom linken/rechten Kartenrand
    marginY: 44,   // Abstand vom oberen/unteren Kartenrand
    pipBox: 60,    // kleines Suit-Symbol direkt an der Zahl
    pipGap: 12,    // Abstand Zahl ↔ Symbol
    withPip: true, // Zahlenkarten: kleines Symbol an jeder Ecke
  },
  // Großes Symbol / Figur mittig
  centerSymbol: { box: 360 },
  centerFigure: { boxW: 480, boxH: 620, top: 300 },
  // Label unten (ZAUBERER / NARR)
  label: { baseline: 1050, size: 66 },
};

// Die vier Ecken: Ausrichtung + Drehung.
// Für ein Online-Kartenspiel stehen ALLE Ecken aufrecht (rot: 0), damit die
// Zahl aus normaler Blickrichtung überall lesbar ist. Wer klassische
// Spielkarten möchte (untere Ecken um 180° gedreht), setzt bei BL/BR rot: 180.
const CORNERS = [
  { id: 'TL', rot: 0, xAlign: 'left', yAlign: 'top' },
  { id: 'TR', rot: 0, xAlign: 'right', yAlign: 'top' },
  { id: 'BL', rot: 0, xAlign: 'left', yAlign: 'bottom' },
  { id: 'BR', rot: 0, xAlign: 'right', yAlign: 'bottom' },
];

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
 * Erzeugt das Text-Overlay (SVG in Kartengröße) mit der Glyphe in ALLEN
 * vier Ecken (oben aufrecht, unten um 180° gedreht) und optionalem Label.
 * Wird nur als Fallback genutzt, wenn keine Glyph-Bilder vorhanden sind.
 */
function textOverlaySVG(glyph, label) {
  const C = LAYOUT.corner;
  const lb = LAYOUT.label;
  const g = esc(glyph);

  const cornerText = (corner) => {
    const x = corner.xAlign === 'left' ? C.marginX : WIDTH - C.marginX;
    const y =
      corner.yAlign === 'top'
        ? C.marginY + C.svgSize / 2
        : HEIGHT - C.marginY - C.svgSize / 2;
    // Nach 180°-Drehung kehrt sich die Textausrichtung um – deshalb unten
    // die jeweils gegenteilige Verankerung wählen.
    let anchor;
    if (corner.rot === 0) anchor = corner.xAlign === 'left' ? 'start' : 'end';
    else anchor = corner.xAlign === 'left' ? 'end' : 'start';
    return `<g transform="rotate(${corner.rot} ${x} ${y})">
      <text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle"
            font-family="${FONT_FAMILY}" font-size="${C.svgSize}"
            font-weight="700" fill="url(#gold)" stroke="${STROKE}"
            stroke-width="6" paint-order="stroke">${g}</text>
    </g>`;
  };

  const labelSvg = label
    ? `<text x="${WIDTH / 2}" y="${lb.baseline}" text-anchor="middle"
             font-family="${FONT_FAMILY}" font-size="${lb.size}"
             font-weight="700" letter-spacing="5"
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
  ${CORNERS.map(cornerText).join('\n  ')}
  ${labelSvg}
</svg>`);
}

/** Nur das Label unten (ZAUBERER / NARR) als transparentes SVG-Overlay. */
function labelOverlaySVG(label) {
  const lb = LAYOUT.label;
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}"
     xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${GOLD}"/>
      <stop offset="0.55" stop-color="${GOLD}"/>
      <stop offset="1" stop-color="${GOLD_DARK}"/>
    </linearGradient>
  </defs>
  <text x="${WIDTH / 2}" y="${lb.baseline}" text-anchor="middle"
        font-family="${FONT_FAMILY}" font-size="${lb.size}"
        font-weight="700" letter-spacing="6"
        fill="url(#gold)" stroke="${STROKE}" stroke-width="4"
        paint-order="stroke">${esc(label)}</text>
</svg>`);
}

/* ------------------------------------------------------------------ *
 *  Goldene Glyph-Grafiken (input/glyphs/*.png)
 * ------------------------------------------------------------------ */

function glyphPath(name) {
  return path.join(GLYPHS_DIR, `${name}.png`);
}

// Alle für das Deck benötigten Glyphen (Zahlen 1–13 sowie Z und N).
function requiredGlyphs() {
  const names = ['Z', 'N'];
  for (let n = 1; n <= 13; n++) names.push(String(n));
  return names;
}

// Glyph-Modus aktiv, wenn alle Glyph-Bilder vorhanden sind.
function glyphsAvailable() {
  return requiredGlyphs().every((n) => fs.existsSync(glyphPath(n)));
}

/** Composite-Op für die goldene Glyphe (Bild) in einer bestimmten Ecke. */
async function cornerGlyphImageOp(name, corner) {
  const C = LAYOUT.corner;
  let pipeline = sharp(glyphPath(name)).resize({ height: C.height, fit: 'inside' });
  if (corner.rot) pipeline = pipeline.rotate(180);
  const buffer = await pipeline.png().toBuffer();
  const meta = await sharp(buffer).metadata();
  const left =
    corner.xAlign === 'left' ? C.marginX : WIDTH - C.marginX - meta.width;
  const top =
    corner.yAlign === 'top' ? C.marginY : HEIGHT - C.marginY - meta.height;
  return { input: buffer, left, top };
}

/** Composite-Op für das kleine Suit-Symbol an der Glyphe einer Ecke. */
async function cornerPipOp(color, corner) {
  const C = LAYOUT.corner;
  let pipeline = sharp(path.join(INPUT_DIR, `symbol_${color}.png`)).resize(
    C.pipBox,
    C.pipBox,
    { fit: 'inside' }
  );
  if (corner.rot) pipeline = pipeline.rotate(180);
  const buffer = await pipeline.png().toBuffer();
  const meta = await sharp(buffer).metadata();
  const left =
    corner.xAlign === 'left' ? C.marginX : WIDTH - C.marginX - meta.width;
  // Oben: Symbol unter der Zahl. Unten: Symbol über der (gedrehten) Zahl.
  const top =
    corner.yAlign === 'top'
      ? C.marginY + C.height + C.pipGap
      : HEIGHT - C.marginY - C.height - C.pipGap - meta.height;
  return { input: buffer, left, top };
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

/** Fügt die Glyphe (Zahl bzw. Z/N) in alle vier Ecken ein. */
async function addCornerGlyphs(composites, glyph, color, withPip) {
  if (GLYPH_MODE) {
    for (const corner of CORNERS) {
      // Pip zuerst (liegt unter der Zahl), dann die Zahl darüber.
      if (withPip && LAYOUT.corner.withPip) {
        composites.push(await cornerPipOp(color, corner));
      }
      composites.push(await cornerGlyphImageOp(glyph, corner));
    }
  } else {
    // SVG-Fallback: Zahlen in allen Ecken in einem Overlay.
    if (withPip && LAYOUT.corner.withPip) {
      for (const corner of CORNERS) composites.push(await cornerPipOp(color, corner));
    }
  }
}

/** Zahlenkarte (z. B. blue_7). */
async function buildNumberCard(baseTemplate, color, number, outFile) {
  const L = LAYOUT;

  const centerSym = await fitImage(
    `symbol_${color}.png`,
    L.centerSymbol.box,
    L.centerSymbol.box
  );
  const centerX = (WIDTH - L.centerSymbol.box) / 2;
  const centerY = (HEIGHT - L.centerSymbol.box) / 2;

  const composites = [
    centerInBox(centerSym, centerX, centerY, L.centerSymbol.box, L.centerSymbol.box),
  ];

  await addCornerGlyphs(composites, String(number), color, true);
  if (!GLYPH_MODE) {
    composites.push({ input: textOverlaySVG(String(number), null), left: 0, top: 0 });
  }

  await sharp(baseTemplate)
    .composite(composites)
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

  const composites = [
    centerInBox(figure, figX, L.centerFigure.top, L.centerFigure.boxW, L.centerFigure.boxH),
  ];

  // Bei Sonderkarten Z/N in allen Ecken, aber ohne kleines Symbol.
  await addCornerGlyphs(composites, glyph, color, false);
  if (GLYPH_MODE) {
    composites.push({ input: labelOverlaySVG(label), left: 0, top: 0 });
  } else {
    composites.push({ input: textOverlaySVG(glyph, label), left: 0, top: 0 });
  }

  await sharp(baseTemplate)
    .composite(composites)
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

  GLYPH_MODE = glyphsAvailable();
  if (GLYPH_MODE) {
    console.log('   Schrift: goldene Glyph-Grafiken aus input/glyphs/');
  } else {
    console.log('   Schrift: SVG-Text (Fallback)');
    console.log('   Tipp: für die goldenen Zahlen "npm run glyphs" ausführen.');
  }

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
