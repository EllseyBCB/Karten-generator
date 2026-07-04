#!/usr/bin/env node
/**
 * Zaubertisch – Card Studio · KI-Grafikgenerator
 * -------------------------------------------------------------
 * Erzeugt aus einem THEMA per OpenAI Bild-API (gpt-image-1) die
 * Basisgrafiken für das Deck und legt sie in input/ ab:
 *
 *   - card_template.png            (Kartenrahmen, dunkel/gold)
 *   - symbol_{blau,rot,gelb,grün}  (4 Symbole)
 *   - wizard_{...}                 (4 Zauberer-Figuren)
 *   - jester_{...}                 (4 Narren-Figuren)
 *
 * Danach baut "npm start" wie gewohnt das Deck. Rahmen-Layout und
 * Kartengröße (750×1125) bleiben dabei immer identisch. Die goldenen
 * Zahlen aus deinem Glyph-Sheet werden NICHT verändert.
 *
 * Voraussetzung:  Umgebungsvariable OPENAI_API_KEY
 * Aufruf:         node generate-art.js "Drachen und Eis"
 *                 npm run generate -- "Drachen und Eis"
 *                 node generate-art.js "Thema" --dry-run   (nur Prompts zeigen)
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

// Kartenmaß (identisch zum Generator) – das Template wird darauf gebracht.
const CARD_WIDTH = 750;
const CARD_HEIGHT = 1125;

// Farben mit deutschem Wort für die Prompts.
const COLORS = [
  { key: 'blue', word: 'blau' },
  { key: 'red', word: 'rot' },
  { key: 'yellow', word: 'gelb' },
  { key: 'green', word: 'grün' },
];

// Bildqualität (low | medium | high) – per Umgebungsvariable übersteuerbar.
const QUALITY = process.env.CARD_QUALITY || 'medium';
// Gleichzeitig laufende Anfragen (klein halten wegen Rate-Limits).
const CONCURRENCY = 2;

/* ------------------------------------------------------------------ *
 *  Prompt-Bausteine
 * ------------------------------------------------------------------ */

// Gemeinsamer Stil, damit alle Grafiken zusammenpassen.
function styleSuffix(theme) {
  return (
    `Thema: ${theme}. Hochwertige Fantasy-Illustration, dunkle Farbpalette, ` +
    `goldene Akzente, kohärenter einheitlicher Stil. ` +
    `Absolut kein Text, keine Buchstaben, keine Zahlen, keine Rahmenlinien um das Motiv.`
  );
}

function buildAssets(theme) {
  const s = styleSuffix(theme);
  const assets = [];

  // 1) Kartenrahmen / Template (deckend, senkrechtes Kartenformat).
  assets.push({
    file: 'card_template.png',
    kind: 'template',
    size: '1024x1536',
    transparent: false,
    prompt:
      `Ein senkrechtes Spielkarten-Hintergrundbild, formatfüllend. Dunkle, ` +
      `stimmungsvolle Atmosphäre passend zum Thema mit sanfter Vignette. ` +
      `WICHTIG: KEIN Zierrahmen, KEINE Rahmenleiste, KEINE Ornamente oder ` +
      `Verzierungen an den Rändern und besonders NICHT in den vier Ecken – ` +
      `die Ecken und der äußere Rand bleiben ruhig, dunkel und frei, damit dort ` +
      `später Zahlen platziert werden können. Die Mitte bleibt ebenfalls ruhig, ` +
      `damit ein Symbol oder eine Figur daraufgesetzt werden kann. ${s}`,
  });

  // 2) Symbole (transparent, je Farbe).
  for (const c of COLORS) {
    assets.push({
      file: `symbol_${c.key}.png`,
      kind: 'symbol',
      size: '1024x1024',
      transparent: true,
      prompt:
        `Ein einzelnes, klar erkennbares Emblem/Icon zum Thema in ${c.word}en Tönen, ` +
        `zentriert, formatfüllend aber freigestellt. Transparenter Hintergrund. ${s}`,
    });
  }

  // 3) Zauberer-Figuren (transparent, je Farbe).
  for (const c of COLORS) {
    assets.push({
      file: `wizard_${c.key}.png`,
      kind: 'wizard',
      size: '1024x1536',
      transparent: true,
      prompt:
        `Eine Zauberer-Figur zum Thema, in ${c.word}er Robe/Gewandung, als Ganzkörper, ` +
        `zentriert, freigestellt. Transparenter Hintergrund. ${s}`,
    });
  }

  // 4) Narren-Figuren (transparent, je Farbe).
  for (const c of COLORS) {
    assets.push({
      file: `jester_${c.key}.png`,
      kind: 'jester',
      size: '1024x1536',
      transparent: true,
      prompt:
        `Eine Narren-/Gaukler-Figur zum Thema, in ${c.word}em Kostüm mit Schellenkappe, ` +
        `als Ganzkörper, zentriert, freigestellt. Transparenter Hintergrund. ${s}`,
    });
  }

  return assets;
}

/* ------------------------------------------------------------------ *
 *  OpenAI Bild-API
 * ------------------------------------------------------------------ */

async function generateImage(apiKey, prompt, size, transparent) {
  const body = {
    model: 'gpt-image-1',
    prompt,
    size,
    n: 1,
    quality: QUALITY,
    output_format: 'png',
  };
  if (transparent) body.background = 'transparent';

  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        // Bei Rate-Limit / Serverfehler erneut versuchen.
        if ((res.status === 429 || res.status >= 500) && attempt < 3) {
          await sleep(attempt * 2000);
          continue;
        }
        throw new Error(`OpenAI API ${res.status}: ${text.slice(0, 400)}`);
      }

      const json = await res.json();
      const b64 = json && json.data && json.data[0] && json.data[0].b64_json;
      if (!b64) throw new Error('Unerwartete API-Antwort (kein b64_json).');
      return Buffer.from(b64, 'base64');
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await sleep(attempt * 2000);
    }
  }
  throw lastErr;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Speichert einen Bild-Buffer; Template wird auf Kartengröße gebracht. */
async function saveAsset(asset, buffer) {
  const outPath = path.join(INPUT_DIR, asset.file);
  if (asset.kind === 'template') {
    await sharp(buffer).resize(CARD_WIDTH, CARD_HEIGHT, { fit: 'fill' }).png().toFile(outPath);
  } else {
    await sharp(buffer).png().toFile(outPath);
  }
}

/* ------------------------------------------------------------------ *
 *  Ablauf
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = { dryRun: false };
  const rest = [];
  for (const a of args) {
    if (a === '--dry-run' || a === '-n') flags.dryRun = true;
    else rest.push(a);
  }
  flags.theme = rest.join(' ').trim();
  return flags;
}

async function runPool(items, worker, concurrency) {
  let index = 0;
  const results = new Array(items.length);
  async function next() {
    const i = index++;
    if (i >= items.length) return;
    results[i] = await worker(items[i], i);
    await next();
  }
  const starters = [];
  for (let k = 0; k < Math.min(concurrency, items.length); k++) starters.push(next());
  await Promise.all(starters);
  return results;
}

async function main() {
  console.log('🎨  Zaubertisch – KI-Grafikgenerator');
  console.log('─────────────────────────────');

  const { theme, dryRun } = parseArgs(process.argv);

  if (!theme) {
    console.error('\n❌ Kein Thema angegeben.\n');
    console.error('   Beispiel:  node generate-art.js "Drachen und Eis"');
    console.error('              npm run generate -- "Drachen und Eis"\n');
    process.exit(1);
  }

  const assets = buildAssets(theme);
  console.log(`   Thema:      ${theme}`);
  console.log(`   Qualität:   ${QUALITY}`);
  console.log(`   Grafiken:   ${assets.length} (1 Template, 4 Symbole, 4 Zauberer, 4 Narren)`);

  if (dryRun) {
    console.log('\n   --dry-run: es wird NICHTS erzeugt, nur die Prompts:\n');
    for (const a of assets) {
      console.log(`   ▸ ${a.file}  [${a.size}${a.transparent ? ', transparent' : ''}]`);
      console.log(`     ${a.prompt}\n`);
    }
    console.log('─────────────────────────────');
    console.log('   (Ohne --dry-run werden die Bilder generiert und in input/ gespeichert.)');
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('\n❌ Umgebungsvariable OPENAI_API_KEY ist nicht gesetzt.\n');
    console.error('   Setze sie z. B. so (macOS/Linux):');
    console.error('     export OPENAI_API_KEY="sk-..."');
    console.error('   und starte den Befehl erneut.\n');
    process.exit(1);
  }

  if (typeof fetch !== 'function') {
    console.error('\n❌ Dein Node.js kennt "fetch" nicht. Für die KI-Generierung wird');
    console.error('   Node.js 18 oder neuer benötigt (node -v zum Prüfen).\n');
    process.exit(1);
  }

  if (!fs.existsSync(INPUT_DIR)) fs.mkdirSync(INPUT_DIR, { recursive: true });

  console.log('\n   Generiere Grafiken (das kann einige Minuten dauern) …\n');

  let done = 0;
  const failures = [];
  await runPool(
    assets,
    async (asset) => {
      try {
        const buffer = await generateImage(apiKey, asset.prompt, asset.size, asset.transparent);
        await saveAsset(asset, buffer);
        done++;
        console.log(`   ✓ ${asset.file}   (${done}/${assets.length})`);
      } catch (err) {
        failures.push({ file: asset.file, message: err && err.message ? err.message : String(err) });
        console.log(`   ✗ ${asset.file}   FEHLER`);
      }
    },
    CONCURRENCY
  );

  console.log('─────────────────────────────');
  if (failures.length > 0) {
    console.error(`⚠️  ${failures.length} Grafik(en) fehlgeschlagen:`);
    for (const f of failures) console.error(`   • ${f.file}: ${f.message}`);
    console.error('\n   Bitte erneut ausführen (bereits erzeugte Dateien bleiben erhalten).');
    process.exit(1);
  }

  console.log(`✅  Alle ${assets.length} Grafiken erzeugt in: ${INPUT_DIR}`);
  console.log('    Nächster Schritt:  npm start   (baut das 60-Karten-Deck)');
}

main().catch((err) => {
  console.error('\n❌ Fehler bei der Grafikgenerierung:');
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
