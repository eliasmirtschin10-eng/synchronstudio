# 🎙️ Synchronstudio — dein privates Dubbing-Game

Online-Multiplayer-Synchro-Spiel für dich + bis zu 3 Freunde. 100 % kostenlos, kein Server nötig.

## Warum kein Node.js-Server? (Wichtig!)

Gemini hat dir Node + Socket.io + Glitch vorgeschlagen. Problem: **Glitch hat sein kostenloses Hosting 2025 eingestellt**, und andere Gratis-Node-Hosts (Render etc.) schlafen ein und brauchen ewig zum Aufwachen. Deshalb ist das hier **komplett statisch** gebaut:

- **PeerJS (WebRTC)** verbindet euch direkt Peer-to-Peer — der kostenlose öffentliche PeerJS-Server macht nur die "Vermittlung"
- Hosting: **GitHub Pages** — gratis, für immer, schläft nie ein
- Videos gehen entweder ins Repo ODER du lädst sie direkt vom PC hoch und sie werden P2P an deine Freunde übertragen (kein Upload-Server nötig!)

## Schnellstart (lokal testen)

```
cd dub-studio
python3 -m http.server 8000
```
Dann `http://localhost:8000` öffnen. Zum Testen mit 2 "Spielern": zwei Browser-Tabs.

⚠️ Mikrofon geht im Browser nur über `localhost` oder `https://` — GitHub Pages ist automatisch https, also alles gut.

## Online stellen (GitHub Pages, 5 Minuten)

1. Auf github.com → neues Repository (z. B. `synchronstudio`), public
2. Alle Dateien aus diesem Ordner hochladen (geht per Drag & Drop im Browser: "uploading an existing file")
3. Repo → **Settings → Pages** → Source: `main` branch, `/ (root)` → Save
4. Nach ~1 Minute ist dein Spiel unter `https://DEINNAME.github.io/synchronstudio/` live
5. Link an die Jungs schicken, fertig

## So läuft eine Runde

1. **Host** (du): Name eingeben → "Raum erstellen" → 4-stelligen Code an Freunde schicken
2. Freunde: gleiche Seite öffnen → Code eingeben → beitreten
3. Host wählt Szene aus `scenes.json` **oder** lädt ein MP4 direkt vom PC (wird automatisch an alle übertragen, mit Fortschrittsbalken)
4. Jeder sucht sich eine Rolle aus, macht den **🎤 Mikro-Check** (du hörst dich direkt mit deinem Rollen-Effekt!) und drückt "Bin bereit"
5. Host drückt 🔴 → Countdown 3-2-1 → Video läuft bei allen synchron, jedes Mikro nimmt auf
6. **Premiere**: Video + alle Stimmen mit Panning, Effekten und Master-Kompressor. Mit dem "Lippen-Sync"-Regler kannst du den Ton in 10-ms-Schritten verschieben, falls er minimal versetzt ist.

## Eigene Szenen einbauen

**Video vorbereiten** (dein Workflow):
- Stimmen mit Vocal Remover raus (vocalremover.org oder UVR5), Musik + SFX drin lassen
- Hintergrundspur ca. **-8 bis -12 dB** leiser machen (Platz für eure Stimmen)
- Export als MP4 (H.264 + AAC), 15–45 Sekunden, möglichst **unter 30 MB** (720p reicht locker)

**Variante A — fest ins Spiel (empfohlen für eure Stammszenen):**
1. MP4 in den Ordner `scenes/` legen
2. Eintrag in `scenes.json` ergänzen:

```json
{
  "id": "meine_szene",
  "title": "Akaza vs. Rengoku",
  "videoUrl": "scenes/akaza.mp4",
  "roles": [
    { "id": 1, "name": "Rengoku", "pan": -0.6, "effect": "none", "gain": 1.0 },
    { "id": 2, "name": "Akaza", "pan": 0.6, "effect": "hall", "gain": 1.0 }
  ]
}
```

**Variante B — spontan im Spiel:** Als Host einfach MP4 auswählen, Rollen + Pan + Effekt direkt im Browser einstellen, "Video benutzen". Wird live an alle übertragen.

## Effekte (pro Rolle in scenes.json oder im Editor)

| Wert | Klingt wie |
|---|---|
| `none` | Normale, saubere Stimme |
| `vintage_1990` | 90er-Kassette / alte TV-Synchro (Bandpass + Tape-Sättigung) |
| `radio` | Funkgerät / Walkie-Talkie (eng + verzerrt) |
| `telefon` | Telefonhörer (300–3400 Hz) |
| `hall` | Großer Raum / Erzähler-Hall |

`pan`: -1.0 (ganz links) bis 1.0 (ganz rechts). `gain`: Lautstärke der Rolle (z. B. 0.8).

Zusätzlich läuft beim Abspielen ein **Kompressor** über alles — dadurch kleben eure Stimmen am Original-Sound statt drüberzuschweben.

## Tipps & bekannte Grenzen

- **Kopfhörer sind Pflicht** — sonst nimmt dein Mikro den Video-Ton mit auf (Echo Cancellation ist an, aber Kopfhörer sind sicherer)
- Der öffentliche PeerJS-Server ist mal kurz down → einfach nochmal versuchen. (In `client.js` kannst du `PEER_PREFIX` ändern, damit eure Raumcodes garantiert nur euch gehören.)
- Ihr hört euch **während** der Aufnahme nicht gegenseitig — dafür nebenbei Discord offen lassen, ist eh lustiger
- iPhone/Safari kann bei MediaRecorder zicken — am PC mit Chrome/Firefox/Edge läuft alles rund

## 🔪 Mitgelieferte Szene: Dexter — Cargo Scene

Aus deinem Choicer-Voicer-Pack konvertiert:
- `scenes/dexter_cargo.mp4` — Video (Theora/OGV → H.264, Chrome kann kein OGV mehr) mit dem originalen Backing-Track (Musik/SFX ohne Stimmen) als Tonspur
- 3 Rollen: **Dexter** (Pan links), **Doakes** (Pan rechts), **Random Dude** (Security-Typ am Ende)
- Alle 21 Dialog-Zeilen mit Original-Timings → **Teleprompter**: Während der Aufnahme siehst du die aktuelle Line + wer spricht. Wenn du dran bist, leuchtet die Zeile rot mit "🎙 DU BIST DRAN!" — plus Vorschau, was als Nächstes kommt. In der Premiere laufen die Lines als Untertitel mit.
- Bei "*angry fighting noises*" und "*weird snarling*" sind Dexter UND Doakes gleichzeitig dran 😄

Eigene Choicer-Voicer-Packs kannst du genauso konvertieren: `dub_timestamps` + `caption` aus den .ini-Dateien in das `lines`-Format von `scenes.json` übertragen (`t` = Start, `end` = Start der nächsten Line, `chars` = Rollen-IDs).
