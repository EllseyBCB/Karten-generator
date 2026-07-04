# Zaubertisch – Card Studio

Lokales Tool, das aus wenigen PNG-Basisgrafiken automatisch ein komplettes
Wizard-Kartendeck für das Spiel **Zaubertisch** erzeugt.

- **Keine KI-Generierung** – es werden ausschließlich deine vorhandenen PNGs
  zusammengesetzt. Die goldenen Zahlen und Buchstaben stammen aus deinem
  eigenen Glyphen-Sheet (siehe unten); nur die Beschriftung
  „ZAUBERER"/„NARR" wird als scharfes Vektor-Overlay ergänzt.
- Alle Karten haben exakt **750 × 1125 px**.
- Fantasy-Stil, dunkler Hintergrund (aus deinem Template), goldene Schrift –
  klar lesbar, auch auf dem iPhone.
- Auf jeder Karte sind die Positionen der Elemente identisch.

---

## 1. Installation

Voraussetzung: **Node.js 16+** (`node -v` zum Prüfen).

Im Ordner des Tools die Abhängigkeiten installieren:

```bash
cd tools/card-studio
npm install
```

Damit wird [`sharp`](https://sharp.pixelplumbing.com/) installiert (die
Bildbibliothek, die alles zusammensetzt).

---

## 2. Benötigte Input-Dateien

Alle folgenden PNG-Dateien müssen im Ordner **`input/`** liegen:

| Datei | Bedeutung |
| --- | --- |
| `card_template.png` | Karten-Hintergrund / Rahmen (dunkler Fantasy-Stil) |
| `symbol_blue.png` | Symbol für die blaue Zahlenreihe |
| `symbol_red.png` | Symbol für die rote Zahlenreihe |
| `symbol_yellow.png` | Symbol für die gelbe Zahlenreihe |
| `symbol_green.png` | Symbol für die grüne Zahlenreihe |
| `wizard_blue.png` | Zauberer-Figur (blau) |
| `wizard_red.png` | Zauberer-Figur (rot) |
| `wizard_yellow.png` | Zauberer-Figur (gelb) |
| `wizard_green.png` | Zauberer-Figur (grün) |
| `jester_blue.png` | Narren-Figur (blau) |
| `jester_red.png` | Narren-Figur (rot) |
| `jester_yellow.png` | Narren-Figur (gelb) |
| `jester_green.png` | Narren-Figur (grün) |

**Empfehlungen:**

- `card_template.png` möglichst im Seitenverhältnis **750 × 1125** liefern
  (wird sonst automatisch auf diese Größe gebracht).
- Symbole und Figuren am besten mit **transparentem Hintergrund** (PNG mit
  Alpha), damit das Template durchscheint. Die Grafiken werden proportional
  sauber in ihre Platzhalter-Boxen skaliert.

Fehlt beim Start eine Datei, bricht das Tool mit einer verständlichen
Fehlermeldung ab und listet die fehlenden Dateien auf.

---

## 2b. Goldene Zahlen (Glyphen-Sheet)

Damit die Karten deine **goldenen Zahlen 1–13 sowie Z und N** verwenden,
gibt es einen kleinen Zwischenschritt:

1. Lege dein Glyphen-Sheet als **`input/glyph_sheet.png`** ab
   (goldene Zeichen auf schwarzem Hintergrund, Rasteranordnung:
   Zeile 1 = `1 2 3 4 5 6 7`, Zeile 2 = `8 9 10 11 12 13`,
   Zeile 3 = `Z N`).
2. Führe einmalig aus:

   ```bash
   npm run glyphs
   ```

   Das Skript zerschneidet das Sheet automatisch in 15 transparente
   Einzel-Glyphen unter `input/glyphs/` (`1.png` … `13.png`, `Z.png`,
   `N.png`). Der schwarze Hintergrund wird dabei transparent, der Glow
   bleibt erhalten, und kleine Zier-Ornamente über/unter den Zahlen
   werden automatisch weggeschnitten.

3. Danach das Deck bauen (`npm start`). Sind die Glyphen vorhanden,
   nutzt der Generator automatisch die goldenen Grafiken.

> **Ohne Glyphen-Sheet** funktioniert das Tool trotzdem: Dann werden die
> Zahlen/Buchstaben als goldener Vektor-Text gerendert (Fallback).

**Feineinstellung (nur falls nötig)** – oben in `slice-glyphs.js`:
- `KEEP_ORNAMENTS = true` behält die Zier-Ornamente über/unter den Zahlen.
- `BAND_GAP_FRACTION` steuert, wie großzügig zusammenhängende Bereiche
  erkannt werden (kleiner = trennt Ornamente schärfer von der Zahl).
- Passt das Raster deines Sheets nicht (7×3), lassen sich `COLS`, `ROWS`
  und `GLYPH_MAP` anpassen.

---

## 3. Starten

```bash
cd tools/card-studio
npm start
```

oder direkt:

```bash
node build-cards.js
```

Beim Start passiert automatisch:

1. Prüfung, ob alle Input-Dateien vorhanden sind.
2. Anlegen des Ordners `output/`, falls er fehlt.
3. Löschen alter `*.png`-Dateien in `output/`.
4. Erzeugen des kompletten Decks.

Am Ende erscheint:

```
✅  Deck erfolgreich erstellt: 60 Karten
```

---

## 4. Wo liegen die Output-Dateien?

Alle fertigen Karten landen im Ordner **`output/`**:

```
output/blue_1.png  …  output/blue_13.png
output/red_1.png   …  output/red_13.png
output/yellow_1.png … output/yellow_13.png
output/green_1.png  … output/green_13.png
output/wizard_blue.png   output/wizard_red.png
output/wizard_yellow.png output/wizard_green.png
output/jester_blue.png   output/jester_red.png
output/jester_yellow.png output/jester_green.png
```

Das sind **60 Karten** (4 × 13 Zahlenkarten + 4 Zauberer + 4 Narren),
jeweils **750 × 1125 px**.

---

## 5. Kartenaufbau

**Zahlenkarten:**
- große Zahl oben links
- kleine (um 180° gedrehte) Zahl unten rechts
- großes Symbol mittig
- kleines Symbol oben links, unter der großen Zahl
- kleines Symbol unten rechts, über der kleinen Zahl

**Zauberer / Narr:**
- großes **Z** bzw. **N** oben links
- kleines, um 180° gedrehtes **Z** bzw. **N** unten rechts
- Figur mittig
- Beschriftung unten: **ZAUBERER** bzw. **NARR**

---

## 6. Anpassen

Positionen, Größen und Farben lassen sich zentral in `build-cards.js`
oben im Objekt `LAYOUT` ändern:
- `bigGlyphImg` / `smallGlyphImg` – Zielhöhe und Position der goldenen
  Glyphen oben links bzw. unten rechts (Bild-Modus).
- `bigGlyph` / `smallGlyph` – dieselben Angaben für den Vektor-Fallback.
- `centerSymbol`, `centerFigure`, `smallSymTopLeft`,
  `smallSymBottomRight`, `label` – Symbole, Figuren und Beschriftung.

Farben/Schrift der Beschriftung: `GOLD`, `GOLD_DARK`, `STROKE`,
`FONT_FAMILY`. Danach einfach `npm start` erneut ausführen.

> Für den bestmöglichen Fantasy-Look kann eine Schrift wie *Cinzel* auf dem
> System installiert werden. Ist sie nicht vorhanden, wird automatisch eine
> Serifen-Schrift als Fallback verwendet.
