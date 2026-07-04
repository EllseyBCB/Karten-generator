# Karten-Exporter (PNG-Vorlagen)

Ein bewusst einfacher Exporter – **kein Karten-Designer**. Das komplette
Kartendesign kommt aus deinen fertigen PNG-Vorlagen; das Tool legt nur
Zahlen/Buchstaben und optional ein Symbol exakt positioniert darüber.

## Benutzung

1. `index.html` im Browser öffnen (Doppelklick genügt, kein Server nötig).
2. **Vorlagen laden**: die fertigen Hintergrund-PNGs auswählen:
   - `feuer_template.png`
   - `eis_template.png`
   - `schatten_template.png`
   - `licht_template.png`
   - `zauberer_template.png`
   - `narr_template.png`
3. Optional **Symbole laden**: freigestellte PNGs mit transparentem
   Hintergrund. Dateinamen wie `feuer_symbol.png` werden automatisch der
   passenden Vorlage zugeordnet.
4. Vorlage, Wert (1–13, Z, N), Symbol und Schriftfarbe wählen.
5. Exportieren:
   - **Einzelne Karte** → eine PNG-Datei, z. B. `feuer_7.png`
   - **Komplettes Deck** → `deck_1024x1536.zip` mit 60 Karten:
     4 Farben × 1–13, dazu `zauberer_1..4` (Z) und `narr_1..4` (N)

## Garantien

- Jeder Export ist exakt **1024 × 1536 px** (Vorlagen werden bei Bedarf
  passend skaliert).
- Zahl/Buchstabe steht **oben links**, unten rechts identisch um 180°
  gedreht – auf allen Karten an exakt denselben Koordinaten
  (Konstante `LAYOUT` am Anfang des Skripts in `index.html`).
- Schrift: **Cinzel Bold** (eingebettet, SIL Open Font License) – der
  Export sieht auf jedem Rechner identisch aus, auch offline.
- Es wird nichts hinzuerfunden: keine Rahmen, keine Verläufe, keine
  Emojis – nur Vorlage + Beschriftung.

## Positionen anpassen

Am Anfang des `<script>`-Blocks in `index.html`:

```js
const LAYOUT = {
  cornerX:    130,   // horizontale Mitte der Eck-Beschriftung
  valueY:     150,   // vertikale Mitte von Zahl/Buchstabe
  valueSize:  170,   // Schriftgröße in px
  symbolY:    330,   // vertikale Mitte des Symbols
  symbolSize: 130,   // Symbolbreite in px
};
```

## Dateien

- `index.html` – das komplette Tool (Schrift eingebettet)
- `jszip.min.js` – ZIP-Bibliothek für den Deck-Export (MIT/GPLv3)
