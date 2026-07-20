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

## 🛠 Eigene Szenen komplett selbst machen (ohne Claude, ohne Choicer-Voicer-Mod)

Öffne den **Szenen-Editor**: `https://DEINNAME.github.io/synchronstudio/editor.html`

**Workflow:**
1. **Clip vorbereiten** (in AE/Premiere): Szene schneiden (15–60 s), Tonspur durch Vocal Remover (vocalremover.org / UVR5), Stimmen raus, Musik+SFX auf ca. -8 dB, Export MP4 (H.264+AAC), unter 25 MB
2. **Editor:** MP4 laden → Rollen anlegen (Name/Pan/Effekt) → Video abspielen und mit den Tasten **S** (Line startet) und **E** (Line endet) die Dialoge timen — Leertaste = Play/Pause, 🐢-Button für 0,5× beim Feintuning
3. Pro Line: Original-Text, deutsche Übersetzung und Rolle eintragen
4. **JSON erzeugen** → kopieren
5. **Repo:** MP4 nach `scenes/` hochladen, `scenes.json` im Browser editieren (Stift-Symbol) und den Block als neuen Listeneintrag einfügen (Komma zwischen Einträgen!), Commit, 3–4 Min warten, Strg+Shift+R
6. **Optional — Original-Stimmen** (für 🗣-Anhören + unbesetzte Rollen): Die einzelnen Sprach-Schnipsel als MP3 nach `scenes/DEINE_ID/lines/01.mp3` … hochladen und pro Line `"orig": "scenes/DEINE_ID/lines/01.mp3"` ergänzen. Die Schnipsel schneidest du einfach aus der Original-Tonspur (die MIT Stimmen) — in Audacity oder AE pro Line exportieren.

**Faustregeln für gutes Lip-Timing:** Start lieber 0,1 s zu früh als zu spät · Ende = wo die nächste Line beginnt · Grunzer/Geräusche als eigene Lines anlegen · Test im Spiel machen und Zeiten im JSON nachjustieren.

## 🏆 Match-System (ab v3.0)

Host stellt in der Lobby ein: **Rundenzahl** (1–10) und **🎲 Rollen jede Runde neu würfeln**. Alle sehen die Einstellungen, nur der Host kann sie ändern. Ablauf pro Runde: Einsprechen → synchronisierte Premiere → **Pflicht-Bewertung** (jeder bewertet jeden Sprecher) → Host drückt "Nächste Runde". Die Sterne werden über alle Runden summiert; nach der letzten Runde kommt das **animierte Finale** mit Balken-Leaderboard und 👑-Sieger, danach bringt der Host alle gemeinsam zurück in die Lobby — niemand muss je den Raum verlassen.
