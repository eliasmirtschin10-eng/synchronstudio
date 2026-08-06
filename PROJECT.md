# Synchronstudio — Projekt-Übergabe

Privates Online-Synchronisations-Spiel für Freunde. Freunde treten einem Raum bei, wählen eine Filmszene, bekommen Rollen und sprechen live per Mikro ein. Am Ende wird alles zu einem Video gemischt und kann angeschaut/gespeichert werden.

**Live:** https://synchron-studio.github.io/synchronstudio/
**Repo:** https://github.com/synchron-studio/synchronstudio
**Editor:** https://synchron-studio.github.io/synchronstudio/editor.html

## Architektur

- Statisch auf GitHub Pages — kein Server/Backend
- PeerJS/WebRTC für die Verbindung zwischen Spielern (Host = Autorität, Gäste verbinden sich zu ihm)
- TURN-Relay: ExpressTurn (seit v8.3, vorher Metered), Zugangsdaten in `client.js` in der `MY_TURN`-Konstante
- Web Audio API für Effekte, Panning, Aufnahme, Mixing
- Vanilla JS, kein Framework

## Wichtige Dateien

- `index.html` — komplettes UI/CSS, alle Screens
- `client.js` — gesamte Spiellogik
- `editor.html` — Szenen-Editor (Video hochladen, Lines timen mit S/E-Tasten, ZIP-Mod-Pack-Import)
- `scenes.json` — Liste aller spielbaren Szenen mit Rollen/Timing/Text
- `scenes/` — Videos, Avatare, Voicelines pro Szene
- `ANLEITUNG.md` — Für-Dummies-Anleitung zum Editor

## Design (NICHT verändern ohne Absprache)

Seit v7.1 komplett umgestylt: **"echtes Studio-Equipment"**-Ästhetik statt generischem Web-Look.

- **Signature-Element: Gaffer-Tape** — alle `<h2>`-Überschriften sitzen auf schief geklebtem Klebeband mit ausgefransten Kanten
- **Schriften:** Anton (Display/Überschriften), Barlow (Fließtext), Space Mono (Zahlen/Labels/Timecodes)
- **Farben:** Flightcase-Anthrazit, Röhren-Bernstein (`--amber: #f0a830`), ON-AIR-Rot (`--hot: #e63946`), LED-Grün (`--vu: #5fe3a1`) — bewusst KEIN Regenbogen-Farbverlauf
- **Karten** = Flightcase-Panels mit Nieten in den Ecken, Metallkante, Bürstungs-Textur
- **Buttons** = echte Hardware-Taster (erhaben, rasten beim Klick spürbar ein)
- **Filmkorn + Vignette** über allem (dezent, per SVG-Turbulence)
- Soll aussehen wie "nie im Leben hat das eine KI gemacht" — auf KEINEN Fall zurück zu Standard-Web-Ästhetik

## Features (alles funktioniert)

- Mikro-Setup mit Rauschunterdrückung/Echo/AGC/Noise-Gate, Live-Pegelmeter
- Spielmodi: Freies Spiel, Runden-Modus, Battle-Royale-Elimination, Duell-Modus (2 Personen sprechen dieselbe Rolle, Gruppe stimmt ab — Host muss aktiv "abspielen" klicken, kein Auto-Play)
- Blind-Modus (keine Übersetzung/Original, nur improvisieren)
- Rollen-Effekte: Telefon, Funkgerät, Hall, Unterwasser, Monster, Titan, Roboter, Helium, Vintage, Chorus, Echo, Megafon — alle synthetisiert, keine Audiodateien
- Aufnahme mit Noise-Gate, Live-Wellenform (Original lila + eigene Stimme blau überlagert)
- Premiere-Wiedergabe mit Kinosaal-Modus (alles dimmt weg außer dem Video, Projektor-Glow)
- Bewertungs-Show (Sterne), Podium-Finale als 3D-Körper mit Blackout + Trommelwirbel + Scheinwerfer-Reveal
- Emoji-Reaktionen, Konfetti
- Kritzel-Board — geteiltes Zeichen-Panel (rechts bei breiten Screens, 14 Farben, Radiergummi, nur in Lobby/Warteraum)
- Fun-Fact-Ticker — linkes Panel, rotierende Sprüche
- Beat-Booth — Rhythmus-Minigame (F=links/J=rechts), Notenkarte aus echter Beat-Analyse (librosa), läuft nur lokal, bricht ab wenn Host startet
- Warte-Arena-Minigames: TicTacToe, Klick-Battle, Reaktions-Duell, Tipp-Renner, Schnick-Schnack-Schnuck, Würfel-Duell
- Profilbilder: Emoji + Charakterbilder aus den Szenen + Accessoires (Katzenohren, Kopfhörer, Krone etc. als SVG-Overlay)
- Szenen-Selbst-Check (Host-Knopf, prüft alle Datei-Referenzen, max. 8 parallel)
- Toast-Meldung + Ton wenn jemand den Raum verlässt

## Neue Szenen einbauen (Standardablauf)

Elias schickt ein RAR/ZIP im "Mod-Pack"-Format (Choicer-Voicer-Style): Video + `_backing_track.mp3` (Ton OHNE Stimmen!) + pro Line eine `.mp3`/`.png` mit `.ini`/`.txt` (Format: `caption="..."`, `dub_timestamps=[t]`, `dub_characters=["Name"]`, manchmal `image="..."`).

1. Entpacken, Metadaten aller Lines chronologisch nach Timestamp auslesen (`.ini` UND `.txt` möglich, manche Packs mischen beide!)
2. Video: `ffmpeg` mit `-map 0:v:0 -map 1:a:0` — Video-Spur + `_backing_track.mp3` zusammenführen (NIE die Original-Tonspur mit Stimmen!), max. 1280px breit, CRF 27-28, `preset fast`. Bei langen Szenen ggf. 854px, CRF 30, `veryfast` — Zieldatei muss unter ~15 MB bleiben UND die volle Original-Länge haben (Dauer immer mit `ffprobe` gegen Original vergleichen!)
3. Avatare: `ffmpeg -vf scale=160:-1` pro Charakter
4. Voicelines: jede einzeln zu Mono-MP3 64kbit, durchnummeriert `01.mp3, 02.mp3, ...` in `scenes/<id>/lines/`
5. Deutsche Übersetzung selbst schreiben — nicht wörtlich, sondern natürlich/idiomatisch
6. `scenes.json`-Eintrag bauen: `id`, `title`, `videoUrl`, `avatars`, `roles` (mit `pan`/`effect`/`gain`), `lines` (`t`, `end`, `chars`, `who`, `text`, `de`, `orig`)
7. Vollständigkeit prüfen (jede referenzierte Datei existiert) BEVOR ausgeliefert wird
8. Neue Charaktere zur `AVATAR_CHARS`-Liste in `client.js` hinzufügen
9. Patch Notes + `APP_VERSION` hochzählen

## Bekannte Fallstricke

- **`scenes.json` NIE aus dem Gedächtnis neu bauen** — immer zuerst die LIVE-Version von GitHub holen (`https://raw.githubusercontent.com/synchron-studio/synchronstudio/main/scenes.json`) und darauf aufbauen, sonst gehen Szenen verloren, die zwischenzeitlich manuell hinzugefügt wurden
- Manche Packs haben `voiceTrack` (eine durchgehende Datei, per `t`/`end` gesliced) statt einzelner `orig`-Dateien. Bei `voiceTrack`-Szenen unbedingt `voiceTrackBuf = null; voiceTrackTried = false;` bei JEDEM Szenenwechsel zurücksetzen — an allen Stellen im Code, wo `scene = ...` zugewiesen wird (gab schon 2x den Bug, dass die vorherige Szene weiterspielt)
- Deutsche Anführungszeichen („…") brechen JS-Strings — immer normale `"`/`'` benutzen oder escapen
- Copyright: Übersetzungen/Zitate aus Filmen sind okay (privates Spiel, funktionale Nutzung als Spieltext)

## Testen

Bei Code-Änderungen (nicht bei reinen Szenen-Uploads): echte Funktionstests mit jsdom + Mocks (AudioContext, Peer, MediaRecorder) — keine bloße Syntaxprüfung. Achtung: Helper-Funktionen für Tests via `window.eval()` müssen INNERHALB des String-Blocks liegen, der zusammen mit `client.js` evaluiert wird — nicht danach in der äußeren Node-Umgebung, sonst falscher Scope.

## Nutzer

Elias — casual, direkt, oft Umgangssprache. Nicht besonders technisch: einfach erklären, nicht mit Git/Jargon überfordern. Schickt oft Screenshots vom Live-Stand als Bug-Reports — genau hinschauen, was wirklich zu sehen ist. Mag eigene Vorschläge ("ideen?"), aber bei konkreten Bugs erst wirklich verstehen, nicht raten.
