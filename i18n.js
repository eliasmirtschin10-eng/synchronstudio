/* Synchronstudio i18n — EN default, DE optional. Preference: localStorage ss-lang */
(function (global) {
  const I18N = {
    en: {
      "logo.tag": "private dubbing game",
      "music.title": "Lobby music on/off",
      "music.vol": "Music volume",
      "mic.settings": "Microphone settings",
      "vu.title": "Microphone level",
      "onair": "On Air",

      "mic.h2": "🎚 First: set up your mic",
      "mic.sub": "Without a good mic even the best dub sounds rough. Speak into it and watch the bars move.",
      "mic.device": "Microphone",
      "mic.ns": "Noise suppression",
      "mic.ec": "Echo cancellation",
      "mic.agc": "Auto volume",
      "mic.lowcut": "Hum filter (low cut)",
      "mic.gain": "Recording volume (Gain):",
      "mic.gate": "Noise gate — pauses + background noise (soft):",
      "mic.gate.lamp": "green = gate open (you are audible)",
      "mic.record": "🎤 Test record (3 sec.)",
      "mic.raw": "🎙 Raw mode (all filters off)",
      "mic.done": "✅ Sounds good, continue",
      "mic.status": "Click “Test record” to allow your microphone.",

      "avatar.h2": "🎭 Pick your profile picture",
      "avatar.sub": "An emoji or one of our scene characters — shows up everywhere in the game.",
      "avatar.acc": "✨ Accessory (optional)",
      "avatar.done": "Continue",

      "start.who": "Who’s speaking?",
      "start.name.ph": "Your name",
      "start.create.h2": "Create room",
      "start.create.sub": "You’re the host — pick the scene and start the session.",
      "start.create.btn": "Create room",
      "start.join.h2": "Join room",
      "start.join.btn": "Join",
      "start.fan": "Fan project for private fun with friends — we don’t earn anything from this. Clips belong to their rights holders; we remove scenes on request.",
      "start.editor": "🛠 Scene editor",

      "lobby.code.tag": "Room code",
      "lobby.code.toggle": "Hide / show room code",
      "lobby.code.copy": "Copy room code",
      "lobby.link": "🔗 Copy invite link",
      "lobby.link.sub": "Send the link only to friends — there’s no public lobby browser. Anyone with the code can join.",
      "lobby.react": "React:",

      "host.settings": "⚙ Match settings",
      "host.mode": "Choose game mode",
      "mode.free.title": "Free play",
      "mode.free.sub": "Pick scene & roles yourself",
      "mode.match.title": "Match",
      "mode.match.sub": "Several rounds — everything random",
      "mode.br.title": "Battle Royale",
      "mode.br.sub": "Worst player is out each round",
      "mode.duel.title": "Duel",
      "mode.duel.sub": "2 players, 1 role, head-to-head",
      "mode.free.opt": "Free play",
      "mode.match.opt": "Match with rounds",
      "mode.br.opt": "Battle Royale",
      "mode.duel.opt": "Duel",
      "host.rounds": "Rounds:",
      "host.rounds.hint": "In a match, scenes & roles are random every round 🎲",

      "duel.h2": "🥊 Set up duel",
      "duel.sub": "Two players record the same role separately — then the group hears both and votes who did it better.",
      "duel.load": "Load",
      "duel.role": "Duel role",
      "duel.a": "Duelist A",
      "duel.b": "Duelist B",
      "duel.start": "🥊 Start duel",

      "pack.mode": "Play from a local pack",
      "pack.mode.sub": "Everyone uploads the same ZIP",
      "pack.h2": "Local pack",
      "pack.hint": "Every player drops the same Choicer-Voicer ZIP. Only then can the host start — the files stay on your own device.",
      "pack.drop": "📦 Drop the ZIP here",

      "scene.h2": "Pick a scene",
      "scene.search.ph": "🔍 Search — title or role",
      "scene.load": "Load",
      "scene.filter": "Filter by role count",
      "scene.blind": "🕶 Blind mode — no translation, no original listen: everyone must improvise",
      "scene.local": "… or your own video from your PC (sent to everyone):",
      "scene.roles": "Roles for this video (name / pan / effect):",
      "scene.addrole": "+ Role",
      "scene.use": "Use video",
      "scene.check": "🔍 Check all scene files",

      "scard.reassure": "⏳ Not stuck — just taking a bit longer…",
      "scard.pickrole": "Pick a role",
      "scard.mictest": "🎤 Mic check (3 sec. with your effect)",
      "scard.roulette": "🎲 Role roulette",
      "scard.ready": "I’m ready",
      "scard.hint": "Put headphones on! Otherwise your mic will pick up the video sound.",
      "host.start": "🔴 Start session",
      "host.round": "▶ Start round (everyone ready?)",
      "host.hint": "Wait until everyone with a role is “ready” …",

      "booth.role": "Your role",
      "booth.line": "Voiceline",
      "booth.viz.orig": "■ Original on top",
      "booth.viz.you": "■ Your voice below",
      "booth.viz.dash": "dashed = original ends here",
      "booth.prev": "⬅ Previous",
      "booth.scene": "🎬 Watch scene",
      "booth.orig": "🗣 Hear original",
      "booth.rec": "⏺ Record",
      "booth.abort": "✕ Cancel",
      "booth.abort.title": "Keep failed attempt as outtake, don’t replace take",
      "booth.play": "▶ Listen",
      "booth.next": "✅ Good, next",
      "booth.skip": "⏭ Skip (keep original)",
      "booth.status": "Unlimited tries — record until it clicks.",
      "booth.settings": "🎚 Settings",
      "booth.gate": "🎚 Noise gate (pauses + background noise):",
      "booth.gate.hint": "Medium = keyboard/noise gone in pauses. Very high also ducks next to speech — too high can sound muffled.",
      "booth.speed": "Practice tempo:",
      "booth.video": "🔊 Video",
      "booth.timer": "⏱ 3-sec countdown before recording · Space = record / stop",
      "booth.wipe": "⬜ White bar countdown (Synchronstudios style) — instead of numbers",
      "booth.cue": "🗣 Hear original while recording",
      "booth.cue.hint": "Ear help only — not mixed into the take. Best with headphones.",
      "booth.cue.vol": "Cue volume:",
      "booth.fx.off": "Role effect off",
      "booth.fx.off.html": "<strong style=\"color:var(--amber)\">Role effect off</strong> — the scene effect (e.g. monster) no longer applies to you. Per line you can still pick one yourself.",
      "booth.fx.line": "🎚 Your effect for this line:",
      "booth.fx.amt": "Strength",
      "booth.fx.prev": "🔊 Preview",
      "booth.gain": "🔊 Your volume",
      "booth.gain.title": "Too loud (e.g. from effects)? Turn down. Too quiet? Turn up — for preview, premiere & save.",
      "booth.gain.warn": "⚠ clipping",
      "booth.pan": "🎧 Where does the voice come from? (Stereo)",
      "booth.pan.hint": "Default is center. Change only if you want left/right — applies to premiere & save.",
      "booth.studio": "Studio status",

      "duelvote.h2": "🥊 Who did it better?",
      "duelvote.sub": "Both versions played — time to vote!",
      "duelvote.back": "🏠 Back to lobby",

      "wait.h2": "🎙 Waiting for the premiere",
      "wait.duel": "🥊 Duel running — both duelists are recording independently.",
      "wait.status": "Wait until everyone has finished recording — then the premiere starts automatically.",
      "wait.force": "🎬 Start premiere anyway (skip missing tracks)",
      "wait.ttt": "🎮 Waiting arena: TicTacToe",
      "wait.ttt.info": "Two waiting players can play — who dares?",
      "wait.join": "🕹 Join",
      "wait.reset": "Restart",
      "wait.cb": "⚡ Waiting arena: Click battle",
      "wait.cb.info": "10 seconds, one button — who clicks fastest? All waiting players join in.",
      "wait.cb.start": "⚡ Start battle",
      "wait.cb.click": "🔥 CLICK ME",
      "wait.rx": "🚦 Waiting arena: Reaction duel",
      "wait.rx.sub": "Wait for GREEN, then click as fast as you can. Too early = disqualified 😄",
      "wait.rx.start": "🚦 Start round",
      "wait.rx.wait": "WAIT …",
      "wait.tp": "⌨️ Waiting arena: Type racer",
      "wait.tp.sub": "Type the sentence as fast as you can without typos.",
      "wait.tp.start": "⌨️ Start round",
      "wait.tp.ph": "Type here …",
      "wait.rps": "✊ Waiting arena: Rock-paper-scissors",
      "wait.dice": "🎲 Waiting arena: Dice duel",
      "wait.dice.roll": "🎲 Roll",

      "rec.role": "Your role",
      "rec.status": "Running … speak when your character is on!",

      "final.h2": "🏁 Finale — Who dubbed best?",
      "final.back": "🏠 Back to lobby (everyone)",

      "prem.h2": "🎬 Premiere",
      "prem.sub": "Your finished dub take — voices with panning, effects and compressor over the original sound.",
      "prem.live": "🎙 Live comment:",
      "prem.reassure": "⏳ Not stuck — just taking a bit longer…",
      "prem.orig": "Original voices (unfilled roles)",
      "prem.orig.hint": "On by default — if a speaker is missing, the original speaks. You can mute individual roles here.",
      "prem.start": "🎬 Start premiere for everyone",
      "prem.autobal": "🎚 Auto-balance voices",
      "prem.autobal.on": "🎚 Auto-balance ON",
      "prem.pause": "⏸ Pause for everyone",
      "prem.duel": "🥊 Play both versions (host only)",
      "prem.vol.master": "🔊 Master",
      "prem.vol.voice": "🎙 Voices",
      "prem.vol.music": "🎵 Music",
      "prem.sync": "Lip sync",
      "outtakes.hint": "Blooper reel ready",
      "outtakes.beep": "Static on",
      "outtakes.beep.title": "TV static between clips",
      "outtakes.watch": "🎬 Watch outtakes",
      "outtakes.save": "⬇ Save outtakes",
      "prem.replay": "▶ Play again",
      "prem.dl.audio": "⚡ Save audio only (instant)",
      "prem.dl.video": "⬇ Save full video (usually instant)",
      "prem.again": "New round (same scene)",
      "prem.back": "Other scene",

      "rate.h2": "⭐ Rating",
      "rate.jury": "1–5 stars per speaker",
      "rate.sub": "Tap the stars — you can’t rate yourself.",
      "rate.buddy": "Optional: give one speaker <b>SynchroBuddy</b> (only 1× per match) — extra points.",
      "rate.submit": "Submit rating",
      "rate.force": "Show results (without stragglers)",
      "rate.next": "▶ Next round",

      "fun.h2": "💡 Did you know…",
      "beat.h2": "🎵 Beat Booth",
      "beat.hint": "Hit the notes on beat — <b>F</b> left, <b>J</b> right. Hold notes: keep pressed!",
      "beat.score": "Score",
      "beat.combo": "Combo",
      "beat.start": "▶ Start",
      "beat.stop": "⏹ Song off",
      "beat.vol": "Volume",
      "draw.h2": "🎨 Doodle board",
      "draw.sub": "Draw together while you wait!",
      "draw.eraser": "Eraser",
      "draw.size": "Pen size",

      "ppv.title": "🎚 Teammates louder/quieter",
      "ppv.toggle": "🎚 Teammate volume",
      "ppv.toggle.title": "Expand/collapse teammate volume",
      "ppv.hint": "host only · 5–300% · applies to everyone",
      "cin.glow": "Glow on/off",
      "cin.master": "Master",
      "cin.voice": "Voices",
      "cin.music": "Music",
      "cin.vol": "Volume",

      "ot.h2": "🎬 Outtakes reel",
      "ot.sub": "Takes that didn’t make the premiere.",
      "ot.rec": "🔴 Recording outtakes …",
      "ot.skip": "⏭ Next",
      "ot.dl": "⬇ Save reel",
      "ot.close": "Done",
    },
    de: {
      "logo.tag": "privates Dubbing-Game",
      "music.title": "Lobby-Musik an/aus",
      "music.vol": "Musik-Lautstärke",
      "mic.settings": "Mikrofon-Einstellungen",
      "vu.title": "Mikrofon-Pegel",
      "onair": "On Air",

      "mic.h2": "🎚 Erst mal: Mikro einstellen",
      "mic.sub": "Ohne gutes Mikro klingt die beste Synchro kacke. Sprich rein und schau, ob die Bars ausschlagen.",
      "mic.device": "Mikrofon",
      "mic.ns": "Rauschunterdrückung",
      "mic.ec": "Echo-Unterdrückung",
      "mic.agc": "Auto-Lautstärke",
      "mic.lowcut": "Brumm-Filter (Tiefen-Cut)",
      "mic.gain": "Aufnahme-Lautstärke (Gain):",
      "mic.gate": "Noise Gate — Pausen + Nebengeräusche (weich):",
      "mic.gate.lamp": "grün = Gate offen (du bist hörbar)",
      "mic.record": "🎤 Test aufnehmen (3 Sek.)",
      "mic.raw": "🎙 Roh-Modus (alle Filter aus)",
      "mic.done": "✅ Klingt gut, weiter",
      "mic.status": "Klick auf „Test aufnehmen“, um dein Mikro freizugeben.",

      "avatar.h2": "🎭 Wähl dein Profilbild",
      "avatar.sub": "Ein Emoji oder einer unserer Szenen-Charaktere — taucht bei dir überall im Spiel auf.",
      "avatar.acc": "✨ Accessoire (optional)",
      "avatar.done": "Weiter",

      "start.who": "Wer spricht?",
      "start.name.ph": "Dein Name",
      "start.create.h2": "Raum erstellen",
      "start.create.sub": "Du bist der Host, wählst die Szene und startest die Session.",
      "start.create.btn": "Raum erstellen",
      "start.join.h2": "Raum beitreten",
      "start.join.btn": "Beitreten",
      "start.fan": "Fan-Projekt zum privaten Spaß mit Freunden — wir verdienen nichts damit. Die Clips gehören den jeweiligen Rechteinhabern; auf Wunsch entfernen wir Szenen.",
      "start.editor": "🛠 Szenen-Editor",

      "lobby.code.tag": "Raumcode",
      "lobby.code.toggle": "Raumcode verstecken / zeigen",
      "lobby.code.copy": "Raumcode kopieren",
      "lobby.link": "🔗 Einladungs-Link kopieren",
      "lobby.link.sub": "Link nur an Freunde schicken — es gibt keinen öffentlichen Lobby-Browser. Wer den Code hat, kann rein.",
      "lobby.react": "Reagieren:",

      "host.settings": "⚙ Match-Einstellungen",
      "host.mode": "Spielmodus wählen",
      "mode.free.title": "Freies Spiel",
      "mode.free.sub": "Szene & Rollen selbst aussuchen",
      "mode.match.title": "Match",
      "mode.match.sub": "Mehrere Runden — alles Zufall",
      "mode.br.title": "Battle Royale",
      "mode.br.sub": "Schlechtester fliegt jede Runde raus",
      "mode.duel.title": "Duell",
      "mode.duel.sub": "2 Spieler, 1 Rolle, direkter Vergleich",
      "mode.free.opt": "Freies Spiel",
      "mode.match.opt": "Match mit Runden",
      "mode.br.opt": "Battle Royale",
      "mode.duel.opt": "Duell",
      "host.rounds": "Runden:",
      "host.rounds.hint": "Im Match sind Szenen & Rollen jede Runde zufällig 🎲",

      "duel.h2": "🥊 Duell einrichten",
      "duel.sub": "Zwei Spieler sprechen dieselbe Rolle unabhängig voneinander ein — danach hört die Gruppe beide Versionen und stimmt ab, wer's besser gemacht hat.",
      "duel.load": "Laden",
      "duel.role": "Duell-Rolle",
      "duel.a": "Duellant A",
      "duel.b": "Duellant B",
      "duel.start": "🥊 Duell starten",

      "pack.mode": "Aus lokalem Pack spielen",
      "pack.mode.sub": "Alle laden dieselbe ZIP hoch",
      "pack.h2": "Lokales Pack",
      "pack.hint": "Jede Person zieht dieselbe Choicer-Voicer-ZIP hier rein. Erst dann kann der Host starten — die Dateien bleiben auf deinem Gerät.",
      "pack.drop": "📦 ZIP hier ablegen",

      "scene.h2": "Szene wählen",
      "scene.search.ph": "🔍 Suchen — Titel oder Rolle",
      "scene.load": "Laden",
      "scene.filter": "Nach Rollenanzahl filtern",
      "scene.blind": "🕶 Blind-Modus — keine Übersetzung, kein Original-Anhören: alle müssen improvisieren",
      "scene.local": "… oder eigenes Video direkt vom PC (wird an alle übertragen):",
      "scene.roles": "Rollen für dieses Video (Name / Pan / Effekt):",
      "scene.addrole": "+ Rolle",
      "scene.use": "Video benutzen",
      "scene.check": "🔍 Alle Szenen-Dateien prüfen",

      "scard.reassure": "⏳ Nicht hängen geblieben — dauert nur etwas länger…",
      "scard.pickrole": "Rolle aussuchen",
      "scard.mictest": "🎤 Mikro-Check (3 Sek. mit deinem Effekt)",
      "scard.roulette": "🎲 Rollen-Roulette",
      "scard.ready": "Bin bereit",
      "scard.hint": "Kopfhörer aufsetzen! Sonst nimmt dein Mikro den Video-Sound mit auf.",
      "host.start": "🔴 Session starten",
      "host.round": "▶ Runde starten (alle bereit?)",
      "host.hint": "Warte, bis alle mit Rolle „bereit“ sind …",

      "booth.role": "Deine Rolle",
      "booth.line": "Voiceline",
      "booth.viz.orig": "■ Original oben",
      "booth.viz.you": "■ Deine Stimme unten",
      "booth.viz.dash": "gestrichelt = hier ist das Original fertig",
      "booth.prev": "⬅ Vorherige",
      "booth.scene": "🎬 Szene ansehen",
      "booth.orig": "🗣 Original anhören",
      "booth.rec": "⏺ Aufnehmen",
      "booth.abort": "✕ Abbrechen",
      "booth.abort.title": "Fehlversuch als Outtake behalten, Take nicht ersetzen",
      "booth.play": "▶ Anhören",
      "booth.next": "✅ Passt, weiter",
      "booth.skip": "⏭ Skip (Original behalten)",
      "booth.status": "Unendlich Versuche — nimm auf, bis es sitzt.",
      "booth.settings": "🎚 Einstellungen",
      "booth.gate": "🎚 Noise Gate (Pausen + Nebengeräusche):",
      "booth.gate.hint": "Mittel = Tastatur/Rauschen in Pausen weg. Sehr hoch dämpft auch neben der Stimme — zu hoch kann dumpf klingen.",
      "booth.speed": "Übungs-Tempo:",
      "booth.video": "🔊 Video",
      "booth.timer": "⏱ 3-Sek.-Countdown vor der Aufnahme · Leertaste = Aufnehmen / Stoppen",
      "booth.wipe": "⬜ Weiße Balken-Countdown (wie Synchronstudios) — statt Zahlen",
      "booth.cue": "🗣 Original mithören beim Aufnehmen",
      "booth.cue.hint": "Nur als Hilfe im Ohr — landet nicht im Take. Am besten mit Kopfhörern.",
      "booth.cue.vol": "Cue-Lautstärke:",
      "booth.fx.off": "Rollen-Effekt aus",
      "booth.fx.off.html": "<strong style=\"color:var(--amber)\">Rollen-Effekt aus</strong> — der Effekt aus der Szene (z. B. Monster bei Kaigaku) gilt dann nicht mehr für dich. Pro Line kannst du trotzdem selbst einen wählen.",
      "booth.fx.line": "🎚 Dein Effekt für diese Line:",
      "booth.fx.amt": "Stärke",
      "booth.fx.prev": "🔊 Vorhören",
      "booth.gain": "🔊 Deine Lautstärke",
      "booth.gain.title": "Zu laut (z. B. durch Effekte)? Runterdrehen. Zu leise? Hochdrehen — gilt für Vorhören, Premiere & Speichern.",
      "booth.gain.warn": "⚠ übersteuert",
      "booth.pan": "🎧 Wo kommt die Stimme her? (Stereo)",
      "booth.pan.hint": "Standard ist Mitte. Nur ändern, wenn du links/rechts willst — gilt für Premiere & Speichern.",
      "booth.studio": "Studio-Status",

      "duelvote.h2": "🥊 Wer hat's besser gemacht?",
      "duelvote.sub": "Beide Versionen sind gelaufen — jetzt abstimmen!",
      "duelvote.back": "🏠 Zurück zur Lobby",

      "wait.h2": "🎙 Warten auf die Premiere",
      "wait.duel": "🥊 Duell läuft — die beiden Duellanten nehmen gerade unabhängig voneinander auf.",
      "wait.status": "Warte, bis alle fertig eingesprochen haben — dann startet die Premiere automatisch.",
      "wait.force": "🎬 Premiere trotzdem starten (fehlende Spuren weglassen)",
      "wait.ttt": "🎮 Warte-Arena: TicTacToe",
      "wait.ttt.info": "Zwei Wartende können zocken — wer traut sich?",
      "wait.join": "🕹 Mitspielen",
      "wait.reset": "Neustart",
      "wait.cb": "⚡ Warte-Arena: Klick-Battle",
      "wait.cb.info": "10 Sekunden, ein Button — wer klickt am schnellsten? Alle Wartenden spielen mit.",
      "wait.cb.start": "⚡ Battle starten",
      "wait.cb.click": "🔥 KLICK MICH",
      "wait.rx": "🚦 Warte-Arena: Reaktions-Duell",
      "wait.rx.sub": "Warte auf GRÜN, dann klick so schnell du kannst. Zu früh = disqualifiziert 😄",
      "wait.rx.start": "🚦 Runde starten",
      "wait.rx.wait": "WARTE …",
      "wait.tp": "⌨️ Warte-Arena: Tipp-Renner",
      "wait.tp.sub": "Tipp den Satz so schnell wie möglich fehlerfrei ab.",
      "wait.tp.start": "⌨️ Runde starten",
      "wait.tp.ph": "Hier tippen …",
      "wait.rps": "✊ Warte-Arena: Schnick-Schnack-Schnuck",
      "wait.dice": "🎲 Warte-Arena: Würfel-Duell",
      "wait.dice.roll": "🎲 Würfeln",

      "rec.role": "Deine Rolle",
      "rec.status": "Läuft … sprich, wenn dein Charakter dran ist!",

      "final.h2": "🏁 Finale — Wer synchronisiert am besten?",
      "final.back": "🏠 Zurück zur Lobby (alle)",

      "prem.h2": "🎬 Premiere",
      "prem.sub": "Euer fertiger Synchro-Take — Stimmen mit Panning, Effekten und Kompressor über dem Original-Sound.",
      "prem.live": "🎙 Live-Kommentar:",
      "prem.reassure": "⏳ Nicht hängen geblieben — dauert nur etwas länger…",
      "prem.orig": "Original-Stimmen (unbesetzte Rollen)",
      "prem.orig.hint": "Standard an — fehlt ein Sprecher, spricht das Original. Einzelne Rollen kannst du hier stumm schalten.",
      "prem.start": "🎬 Premiere für alle starten",
      "prem.autobal": "🎚 Stimmen auto-ausgleichen",
      "prem.autobal.on": "🎚 Auto-Ausgleich AN",
      "prem.pause": "⏸ Pause für alle",
      "prem.duel": "🥊 Beide Versionen abspielen (nur Host)",
      "prem.vol.master": "🔊 Gesamt",
      "prem.vol.voice": "🎙 Stimmen",
      "prem.vol.music": "🎵 Musik",
      "prem.sync": "Lippen-Sync",
      "outtakes.hint": "Blooper-Reel bereit",
      "outtakes.beep": "Rauschen an",
      "outtakes.beep.title": "TV-Rauschen zwischen den Clips",
      "outtakes.watch": "🎬 Outtakes anschauen",
      "outtakes.save": "⬇ Outtakes speichern",
      "prem.replay": "▶ Nochmal abspielen",
      "prem.dl.audio": "⚡ Nur Ton speichern (sofort)",
      "prem.dl.video": "⬇ Komplettes Video speichern (meist sofort)",
      "prem.again": "Neue Runde (gleiche Szene)",
      "prem.back": "Andere Szene",

      "rate.h2": "⭐ Bewertung",
      "rate.jury": "1–5 Sterne pro Sprecher",
      "rate.sub": "Tippe die Sterne — dich selbst kannst du nicht bewerten.",
      "rate.buddy": "Optional: einem Sprecher <b>SynchroBuddy</b> geben (nur 1× pro Match) — Extra-Punkte.",
      "rate.submit": "Bewertung abschicken",
      "rate.force": "Ergebnis anzeigen (ohne Nachzügler)",
      "rate.next": "▶ Nächste Runde",

      "fun.h2": "💡 Wusstest du…",
      "beat.h2": "🎵 Beat-Booth",
      "beat.hint": "Triff die Noten im Takt — <b>F</b> links, <b>J</b> rechts. Halte-Noten gedrückt lassen!",
      "beat.score": "Score",
      "beat.combo": "Combo",
      "beat.start": "▶ Start",
      "beat.stop": "⏹ Song aus",
      "beat.vol": "Lautstärke",
      "draw.h2": "🎨 Kritzel-Board",
      "draw.sub": "Malt zusammen, während ihr wartet!",
      "draw.eraser": "Radiergummi",
      "draw.size": "Stiftgröße",

      "ppv.title": "🎚 Mitspieler lauter/leiser",
      "ppv.toggle": "🎚 Mitspieler-Lautstärke",
      "ppv.toggle.title": "Mitspieler-Lautstärke ein-/ausklappen",
      "ppv.hint": "nur Host · 5–300 % · gilt für alle",
      "cin.glow": "Glow an/aus",
      "cin.master": "Gesamt",
      "cin.voice": "Stimmen",
      "cin.music": "Musik",
      "cin.vol": "Lautstärke",

      "ot.h2": "🎬 Outtakes-Reel",
      "ot.sub": "Takes, die's nicht in die Premiere geschafft haben.",
      "ot.rec": "🔴 Nimmt Outtakes auf …",
      "ot.skip": "⏭ Weiter",
      "ot.dl": "⬇ Reel speichern",
      "ot.close": "Fertig",
    },
  };

  function getLang() {
    try {
      const v = localStorage.getItem("ss-lang");
      if (v === "de" || v === "en") return v;
    } catch (_) {}
    return "en";
  }

  function t(key) {
    const lang = getLang();
    const pack = I18N[lang] || I18N.en;
    if (pack[key] != null) return pack[key];
    if (I18N.en[key] != null) return I18N.en[key];
    return key;
  }

  function tt(en, de) {
    return getLang() === "de" ? de : en;
  }

  function applyDomI18n() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (key) el.textContent = t(key);
    });
    document.querySelectorAll("[data-i18n-html]").forEach((el) => {
      const key = el.getAttribute("data-i18n-html");
      if (key) el.innerHTML = t(key);
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      if (key) el.setAttribute("placeholder", t(key));
    });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const key = el.getAttribute("data-i18n-title");
      if (key) el.setAttribute("title", t(key));
    });
    document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      const key = el.getAttribute("data-i18n-aria");
      if (key) el.setAttribute("aria-label", t(key));
    });
    syncLangSwitchUI();
  }

  function syncLangSwitchUI() {
    const lang = getLang();
    const en = document.getElementById("btn-lang-en");
    const de = document.getElementById("btn-lang-de");
    if (en) {
      en.classList.toggle("on", lang === "en");
      en.setAttribute("aria-pressed", lang === "en" ? "true" : "false");
    }
    if (de) {
      de.classList.toggle("on", lang === "de");
      de.setAttribute("aria-pressed", lang === "de" ? "true" : "false");
    }
  }

  function setLang(lang) {
    const next = lang === "de" ? "de" : "en";
    try { localStorage.setItem("ss-lang", next); } catch (_) {}
    document.documentElement.lang = next;
    applyDomI18n();
    try { document.dispatchEvent(new CustomEvent("ss-langchange", { detail: { lang: next } })); } catch (_) {}
  }

  function initLangUI() {
    const en = document.getElementById("btn-lang-en");
    const de = document.getElementById("btn-lang-de");
    if (en) en.addEventListener("click", () => setLang("en"));
    if (de) de.addEventListener("click", () => setLang("de"));
    document.documentElement.lang = getLang();
    applyDomI18n();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initLangUI);
  } else {
    initLangUI();
  }

  global.I18N = I18N;
  global.getLang = getLang;
  global.setLang = setLang;
  global.t = t;
  global.tt = tt;
  global.applyDomI18n = applyDomI18n;
})(typeof window !== "undefined" ? window : globalThis);
