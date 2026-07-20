# 🎙️ Synchronstudio — dein privates Dubbing-Game

Online-Synchro-Spiel für dich + deine Freunde. Kein Server, keine Installation, kein Terminal. Einmal auf GitHub Pages hochladen → danach ist es einfach nur ein Link.

## Einmaliges Setup (ca. 5 Minuten, nur klicken)

1. Auf **github.com** einloggen (Account ist gratis)
2. Neues Repository erstellen: Name z. B. `synchronstudio`, **Public**, → "Create repository"
3. Auf der Repo-Seite: **"uploading an existing file"** anklicken → **alle Dateien und Ordner aus diesem ZIP** per Drag & Drop reinziehen → "Commit changes"
4. Oben **Settings → Pages** → bei "Branch": `main` und `/ (root)` auswählen → **Save**
5. Nach ~1 Minute läuft dein Spiel unter: `https://DEINNAME.github.io/synchronstudio/`

Fertig. Dieser Link ist ab jetzt dein Spiel — er läuft immer, kostet nichts, und du musst nie wieder was starten.

## So läuft eine Runde (super simpel)

1. Alle öffnen den Link
2. **Host** (du): Name eingeben → **"Raum erstellen"** → 4-stelligen Code an die Jungs schicken
3. Freunde: Name + Code → **"Beitreten"**
4. Host wählt die Szene (z. B. Dexter) → **der Raum ist automatisch auf die Rollenanzahl begrenzt** (Dexter = max. 3 Leute, wer zu viel ist, kommt nicht mehr rein)
5. Jeder klickt seinen Charakter an, macht optional den 🎤 Mikro-Check und drückt **"Bin bereit"**
6. Host drückt 🔴 → Countdown → Video läuft bei allen synchron, der **Teleprompter** zeigt dir live deine Lines ("🎙 DU BIST DRAN!")
7. **Premiere**: Endergebnis läuft automatisch für alle — Video + alle Stimmen mit Panning, Effekten und Kompressor
8. **"⬇ Ergebnis als Video speichern"** → die Szene läuft einmal durch und wird als fertige `.webm`-Datei (Bild + kompletter Mix) runtergeladen. Für TikTok/Insta in CapCut/After Effects zu MP4 exportieren.

**Wichtig: Kopfhörer aufsetzen!** Sonst nimmt dein Mikro den Video-Ton mit auf.

## 🔪 Mitgelieferte Szene: Dexter — Cargo Scene

Aus deinem Choicer-Voicer-Pack konvertiert:
- 3 Rollen: **Dexter** (Pan links), **Doakes** (Pan rechts), **Random Dude** (Security am Ende)
- Alle 21 Dialog-Zeilen mit Original-Timings als Teleprompter + Untertitel in der Premiere
- Bei den Kampfgeräuschen sind Dexter UND Doakes gleichzeitig dran 😄
- Video wurde von OGV zu MP4 konvertiert (Chrome kann kein OGV mehr), mit dem originalen Backing-Track (Musik/SFX ohne Stimmen) als Tonspur

## Eigene Szenen einbauen

**Video vorbereiten:** Stimmen per Vocal Remover raus (vocalremover.org / UVR5), Musik + SFX drinlassen, Hintergrund ca. -8 bis -12 dB leiser, Export MP4 (H.264+AAC), **unter 25 MB** (sonst meckert der GitHub-Web-Upload).

**Variante A — fest ins Spiel:** MP4 in `scenes/` legen + Eintrag in `scenes.json`:

```json
{
  "id": "meine_szene",
  "title": "Akaza vs. Rengoku",
  "videoUrl": "scenes/akaza.mp4",
  "roles": [
    { "id": 1, "name": "Rengoku", "pan": -0.6, "effect": "none", "gain": 1.0 },
    { "id": 2, "name": "Akaza", "pan": 0.6, "effect": "hall", "gain": 1.0 }
  ],
  "lines": [
    { "t": 3.5, "end": 7.2, "chars": [1], "who": "Rengoku", "text": "Deine Line hier" }
  ]
}
```
(`lines` ist optional — ohne gibt's einfach keinen Teleprompter. Choicer-Voicer-Packs: `dub_timestamps` + `caption` aus den .ini-Dateien übernehmen, oder schick mir das Pack, ich konvertier's.)

**Variante B — spontan im Spiel:** Host wählt ein MP4 vom PC, stellt Rollen/Pan/Effekt im Browser ein → Video wird automatisch P2P an alle übertragen.

## Effekte pro Rolle

| Wert | Klingt wie |
|---|---|
| `none` | Normale Stimme |
| `vintage_1990` | 90er-Kassette / alte TV-Synchro |
| `radio` | Funkgerät / Walkie-Talkie |
| `telefon` | Telefonhörer |
| `hall` | Großer Raum / Erzähler |

`pan`: -1.0 (links) bis 1.0 (rechts) · `gain`: Lautstärke (z. B. 0.8)

## Bekannte Grenzen

- Der öffentliche PeerJS-Vermittlungsserver ist selten mal kurz down → einfach nochmal versuchen
- Ihr hört euch während der Aufnahme nicht gegenseitig → Discord nebenbei offen lassen
- Am besten am PC mit Chrome/Firefox/Edge spielen; iPhone/Safari zickt bei Aufnahmen
