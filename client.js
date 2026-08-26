/* ═══════════════════════════════════════════════════════════════
   SYNCHRONSTUDIO — privates Online-Dubbing-Game
   Statisch (GitHub Pages) + PeerJS (P2P). Host = Autorität.
   Modus A: Line-Booth (Szenen mit "lines"-Timings, Choicer-Voicer-Style)
   Modus B: Realtime (eigene Videos ohne Timings)
   ═══════════════════════════════════════════════════════════════ */

const APP_VERSION = "9.15.2";
/* i18n helpers — provided by i18n.js; tiny fallback if script missing */
if (typeof tt !== "function") {
  window.getLang = () => { try { return localStorage.getItem("ss-lang") === "de" ? "de" : "en"; } catch { return "en"; } };
  window.t = (k) => k;
  window.tt = (en, de) => (getLang() === "de" ? de : en);
  window.applyDomI18n = () => {};
  window.setLang = (l) => { try { localStorage.setItem("ss-lang", l === "de" ? "de" : "en"); } catch {} };
}

const PEER_PREFIX = "syncstudio-emvw-";
// Live: große MP4s liegen nicht auf Pages (Deploy-Limit), sondern kommen vom CDN.
// Lokal weiterhin relative Pfade (scenes/…). blob:/http(s): unverändert durchreichen.
// jsDelivr (GitHub) blockiert Dateien > ~20 MB mit 403.
// Früher gingen deshalb ALLE MP4s über GitHub Raw — Raw ist aber kein CDN
// (Rate-Limits/429, kaum Edge-Cache). Jetzt: jsDelivr für alles, nur die
// wenigen echten Übergrößen unten in OVERSIZE_MP4 bleiben auf Raw.
// Raw liefert application/octet-stream + nosniff → <video src> kann scheitern;
// deshalb laden wir MP4s per fetch als Blob (video/mp4) und zeigen echten Fortschritt.
// fetchVideoAsBlob() fällt bei jedem Fehler automatisch auf Raw zurück —
// schlimmstenfalls verhält sich alles exakt wie vorher.
const CDN_BASE = "https://cdn.jsdelivr.net/gh/synchron-studio/synchronstudio@main/";
const GH_RAW_BASE = "https://raw.githubusercontent.com/synchron-studio/synchronstudio/main/";
// Über dem jsDelivr-Limit (Stand v9.12.1). Beim Neu-Encodieren unter 20 MB hier rausnehmen.
const OVERSIZE_MP4 = new Set([
  "scenes/zenitsukaigaku.mp4",   // 23,3 MB
  "scenes/kawaimarin.mp4",       // 21,3 MB
  "scenes/akazafullfight.mp4",   // ~55 MB (~24 min FULL FIGHT)
]);
function useCdnAssets() {
  try { return /\.github\.io$/i.test(location.hostname); } catch { return false; }
}
function assetUrl(path) {
  if (!path) return path;
  if (/^(https?:|blob:|data:)/i.test(path)) return path;
  if (!useCdnAssets()) return path;
  const p = String(path).replace(/^\.\//, "").replace(/^\//, "");
  if (/\.mp4$/i.test(p) && OVERSIZE_MP4.has(p)) return GH_RAW_BASE + p;
  return CDN_BASE + p;
}
/** Gleiche Datei, aber garantiert über GitHub Raw — Notfallweg, wenn das CDN streikt. */
function rawUrlFor(url) {
  try {
    if (!url || !String(url).startsWith(CDN_BASE)) return null;
    return GH_RAW_BASE + String(url).slice(CDN_BASE.length);
  } catch { return null; }
}
// ── Bild-Notfallweg ────────────────────────────────────────────────
// Fehlende Avatare (z.B. scenes/meinpack/*) zeigten bisher das kaputte
// Bild-Symbol des Browsers. Statt jedes <img> einzeln abzusichern, hängt
// ein einziger Lauscher in der Capture-Phase am document — "error" steigt
// bei Bildern nicht auf, deshalb capture:true. Greift damit auch für
// Bilder, die später per innerHTML dazukommen.
function monogramFor(text) {
  const s = String(text || "").trim();
  if (!s) return "?";
  const parts = s.split(/[\s_-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : s.slice(0, 2);
  return letters.toUpperCase();
}
document.addEventListener("error", ev => {
  const el = ev.target;
  if (!el || el.tagName !== "IMG" || el.dataset.monoDone) return;
  el.dataset.monoDone = "1";
  const span = document.createElement("span");
  span.className = "img-mono";
  // Reihenfolge: ausdrücklich mitgegebener Name → alt-Text → Dateiname ohne Präfix
  let label = el.dataset.mono || el.alt || "";
  if (!label) {
    const m = String(el.getAttribute("src") || "").match(/([^/]+)\.(png|jpg|jpeg|webp|gif)$/i);
    if (m) label = m[1].replace(/^[a-z0-9]+_/i, "").replace(/[_-]+/g, " ");
  }
  span.textContent = monogramFor(label);
  span.title = label || "";
  // Größe/Form der Kachel vom Original übernehmen, damit das Layout nicht springt
  try {
    const cs = getComputedStyle(el);
    if (cs.borderRadius && cs.borderRadius !== "0px") span.style.borderRadius = cs.borderRadius;
  } catch {}
  try { el.replaceWith(span); } catch { try { el.style.visibility = "hidden"; } catch {} }
}, true);

function sceneVideoSrc() {
  return videoBlobUrl || assetUrl(scene && scene.videoUrl);
}
// ╔══════════════════════════════════════════════════════════════════╗
// ║  VERMITTLUNG (PeerJS) + TURN-RELAY                                 ║
// ║  Wenn „Raum erstellen“ schon scheitert → Broker/Netz blockiert.   ║
// ║  Wenn Join hängt → oft NAT; dann helfen die TURN-Relays unten.    ║
// ║  Metered-Trial-Account entfernt (Credentials tot → ICE-Verzögerung).║
// ║  Primär: ExpressTurn Free (1 TB/Mo). Backup: Open Relay (TURNS/443).║
// ╚══════════════════════════════════════════════════════════════════╝
const EXPRESS_USER = "000000002101101430";
const EXPRESS_CRED = "/NtVFzNcrMKmrE1oqCWjY8Kd7RQ=";
// Open Relay Static-Auth — öffentlich dokumentiert (openrelayproject.org / Metered Docs)
const OPENRELAY_STATIC_SECRET = "openrelayprojectsecret";
const MY_TURN = [
  // ExpressTurn Free zuerst (UDP+TCP 3478; großzügiges Free-Kontingent)
  { urls: "turn:free.expressturn.com:3478?transport=tcp", username: EXPRESS_USER, credential: EXPRESS_CRED },
  { urls: "turn:free.expressturn.com:3478?transport=udp", username: EXPRESS_USER, credential: EXPRESS_CRED },
  { urls: "stun:stun.expressturn.com:3478" },
];
// Open Relay: zeitlich begrenzte Creds aus öffentlichem Static-Secret (TURNS:443 für strenge Firewalls)
let openRelayTurn = [];
async function refreshOpenRelayTurn() {
  try {
    if (!globalThis.crypto || !crypto.subtle) { openRelayTurn = []; return; }
    const ttlSec = 12 * 3600;
    const username = `${Math.floor(Date.now() / 1000) + ttlSec}:synchronstudio`;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(OPENRELAY_STATIC_SECRET),
      { name: "HMAC", hash: "SHA-1" },
      false,
      ["sign"]
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(username));
    const credential = btoa(String.fromCharCode(...new Uint8Array(mac)));
    openRelayTurn = [
      { urls: "turns:staticauth.openrelay.metered.ca:443?transport=tcp", username, credential },
      { urls: "turn:staticauth.openrelay.metered.ca:443", username, credential },
      { urls: "turn:staticauth.openrelay.metered.ca:80?transport=tcp", username, credential },
      { urls: "turn:staticauth.openrelay.metered.ca:80", username, credential },
    ];
  } catch (_) {
    openRelayTurn = [];
  }
}
refreshOpenRelayTurn();
try { setInterval(refreshOpenRelayTurn, 6 * 3600 * 1000); } catch (_) {}
// PeerJS-Cloud: 0 und 1 — falls ein Netz einen Host blockiert, den anderen versuchen
const PEER_BROKERS = [
  { host: "0.peerjs.com", port: 443, path: "/", secure: true, label: "Cloud-0" },
  { host: "1.peerjs.com", port: 443, path: "/", secure: true, label: "Cloud-1" },
];
let activeBrokerIdx = 0;
const JOIN_MAX_TRIES = 4; // 2 Broker × (normal + Relay)
const ROOM_SEARCH_MS = 9000; // „suche Raum“ — danach klarer Fehler / nächster Broker (nicht ewig hängen)
const ICE_WAIT_MS = 16000;   // Datenkanal/ICE nach gefundenem Host
function BROKER_TIP() {
  return tt(
    "Your network is blocking the game connection. Phone hotspot works for you — then it’s the normal Wi‑Fi/router/firewall (e.g. Avast), not the browser. Fix: use hotspot to play, or allow synchron-studio.github.io + WebRTC in Avast/firewall.",
    "Dein Netz blockiert die Spiel-Verbindung. Hotspot vom Handy geht bei dir — dann liegt’s am normalen WLAN/Router/Firewall (z. B. Avast), nicht am Browser. Lösung: zum Spielen Hotspot nutzen, oder Avast/Firewall für synchron-studio.github.io + WebRTC erlauben."
  );
}
function SERVER_BUSY_TIP() {
  return tt(
    "Game server is full or briefly down. Wait 30 seconds, Ctrl+F5, try again. Turning VPN off often helps.",
    "Spiel-Server gerade voll oder kurz weg. 30 Sekunden warten, Strg+F5, dann nochmal. VPN aus hilft oft."
  );
}
function NETZ_TIP() {
  return tt(
    "Tip: try another network (phone hotspot), loosen Avast/firewall — switching browsers alone often isn’t enough.",
    "Tipp: Anderes Netz (Handy-Hotspot), Avast/Firewall lockern — Browser wechseln allein reicht oft nicht."
  );
}
function makePeerConfig(forceRelay, brokerIdx) {
  const b = PEER_BROKERS[Math.max(0, brokerIdx | 0) % PEER_BROKERS.length] || PEER_BROKERS[0];
  return {
    host: b.host,
    port: b.port,
    path: b.path,
    secure: !!b.secure,
    config: {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        ...MY_TURN,
        ...openRelayTurn
      ],
      iceCandidatePoolSize: 8,
      ...(forceRelay ? { iceTransportPolicy: "relay" } : {})
    }
  };
}
// WebRTC-DataChannels vertragen grosse Nachrichten schlecht: alles ueber ~64 KB wird
// fragmentiert und kann bei schwaecheren Verbindungen zu Stau oder Abbruch fuehren.
// 16 KB ist der Wert, den auch Browser-Implementierungen empfehlen.
const CHUNK_SIZE = 16 * 1024;
// Rueckstau-Grenze: frueher 4 MB. So viel Puffer heisst, dass Steuer-Nachrichten
// (Zustand, "again", Premiere-Start) MINUTEN hinter den Videodaten in der Schlange stehen
// -- genau das fuehlt sich als "laggy" an. 256 KB haelt die Leitung reaktionsfaehig.
const BUFFER_LIMIT = 256 * 1024;

// ── State ────────────────────────────────────────────────────
let peer = null, isHost = false, myName = "", myId = "";
// isHost = Raum-Besitzer (PeerJS-Peer-ID = Raumcode, Netz-Zentrale). Bleibt beim
// „Host geben“ erhalten — sonst fliegen alle raus. logicalHostKey = wer die Host-UI
// darf (Start/Kicken/Einstellungen); kann jemand anders sein als isHost.
let logicalHostKey = null;
let hostConn = null;
const conns = new Map();
let players = [];                 // [{id,name,role,ready,done,total}]
function iAmLogicalHost() { return !!(logicalHostKey && logicalHostKey === myKey); }
function applyLogicalHostLabels() {
  players.forEach(p => {
    if (!p) return;
    const base = stripHostTag(p.name);
    p.name = (logicalHostKey && p.key === logicalHostKey) ? withHostTag(base) : base;
  });
}

// ── Wiedererkennung über Verbindungsabbrüche hinweg ──────────
// Die Peer-Adresse (myId) ist nach einem Abbruch eine andere. Damit der Host trotzdem
// weiß, WER da wieder anklopft, hat jeder Spieler einen eigenen Schlüssel, der im
// Browser gespeichert bleibt. Nur so kann jemand seine Rolle und seine schon
// aufgenommenen Lines behalten.
let myKey = null;
try { myKey = localStorage.getItem("ss_key"); } catch {}
if (!myKey) {
  myKey = Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
  try { localStorage.setItem("ss_key", myKey); } catch {}
}
let raumCode = null;              // aktueller Raum, für den Wiederverbindungs-Versuch
let absichtlichWeg = false;       // per Knopf verlassen → nicht wieder reinversuchen
let wvVersuch = 0, wvTimer = null;
const GNADENFRIST_MS = 120000;    // Lobby: so lange hält der Host einen Platz frei
const GNADENFRIST_PLAY_MS = 300000; // Während Booth/Premiere länger — Verbindungen knacken dort öfter
const rueckkehrTimer = new Map(); // Host: Schlüssel → Timeout bis der Platz freigegeben wird
function gnadenfristMs() {
  const ph = typeof aktuellePhase === "function" ? aktuellePhase() : "";
  if (ph === "scr-booth" || ph === "scr-record" || ph === "scr-playback" || ph === "scr-wait" || ph === "scr-duel-vote" || ph === "scr-rate") {
    return GNADENFRIST_PLAY_MS;
  }
  return GNADENFRIST_MS;
}
let scene = null;
let localVideoBuf = null, videoBlobUrl = null;
let fetchedVideoBlobUrl = null;   // Blob-URL vom CDN-Download (nicht Host-Upload)
let sceneVideoLoadToken = 0;
let myLoadPct = 0;
let myVideoReady = false;
let pendingGoLines = false;
let pendingGoRealtime = false;
let micStream = null;
let audioCtx = null;
let mixItems = [];                // [{role, startAt, buffer}]
let playNodes = [];
let syncOffsetMs = 0;
// Premiere: Original-Stimmen unbesetzter Rollen (Host steuert)
let premOrigOn = true;
let premOrigUnfilled = [];        // [{id, name}]
let premOrigMuted = new Set();    // Rollen-IDs die stumm sind
let premPaused = false;
// Premiere: Host-Lautstärke pro Mitspieler-Rolle (0.05–3, Default 1) — für alle synchron
// Keys IMMER als String ("0","1",…), sonst Object/Map-Mismatch → Anzeige klebt bei 100 %.
let premPlayerGains = Object.create(null);   // roleIdStr -> number
let premAutoBalance = false;                 // Host: Stimmen automatisch angleichen
let premPlayerGainNodes = new Map();         // roleIdStr -> GainNode (live)
let premPlayerVolBound = false;
let premPlayerVolToggleBound = false;

const $ = (id) => document.getElementById(id);
let show = (id) => {
  const el = $(id); if (!el) return;
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  el.classList.add("active");
};
const status = (id, msg, isErr) => {
  const el = $(id); if (!el) return;
  el.textContent = msg; el.style.color = isErr ? "var(--hot)" : "";
};
function onlinePlayers() { return players.filter(p => !p.offline); }
function sendHost(msg) {
  if (isHost || !hostConn || !hostConn.open) return false;
  try { hostConn.send(msg); return true; } catch (e) { console.warn("sendHost:", e); return false; }
}
function clearSceneCaches() {
  try { origCache.clear(); } catch {}
  try { voiceTrackCache.clear(); } catch {}
  try { voiceTrackLoading.clear(); } catch {}
  try { refPeaksCache.clear(); } catch {}
}
// 5 Ziffern — leichter tippbar als 6, deutlich sicherer als 4 (nur Freunde mit Code, kein Lobby-Browser)
const randCode = () => String(Math.floor(10000 + Math.random() * 90000));
const isRoomCode = (c) => /^\d{5}$/.test(String(c || "").trim());
const esc = (s) => String(s).replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));



function watchVideoErrors(vid, statusId) {
  vid.addEventListener("error", () => {
    status(statusId, tt("❌ Video couldn’t load! If you just uploaded: GitHub Pages needs 2–5 min to deploy — wait a bit, then Ctrl+Shift+R.", "❌ Video konnte nicht geladen werden! Wenn du gerade erst hochgeladen hast: GitHub Pages braucht 2–5 Min zum Deployen — kurz warten, dann Strg+Shift+R."), true);
    SFX.err();
  });
  // Schwarze erste Frames: Vorschaubild ein Stück ins Video setzen
  vid.addEventListener("loadedmetadata", () => { if (vid.currentTime === 0 && vid.paused) try { vid.currentTime = 0.4; } catch {} });
}

function setBar(id, pct) {
  const el = $(id);
  if (!el) return;
  el.style.display = pct >= 100 ? "none" : "";
  el.querySelector("i").style.width = Math.min(100, Math.max(0, pct)) + "%";
}
// Wartet, bis das Video wirklich abspielbereit ist (canplaythrough), mit Timeout-Fallback
function waitCanPlay(v, timeoutMs = 20000) {
  return new Promise(res => {
    if (v.readyState >= 3) return res();
    const done = () => { clearTimeout(to); v.removeEventListener("canplaythrough", done); v.removeEventListener("canplay", done); res(); };
    const to = setTimeout(done, timeoutMs);
    v.addEventListener("canplaythrough", done);
    v.addEventListener("canplay", done);
    v.load();
  });
}

function revokeFetchedVideo() {
  if (!fetchedVideoBlobUrl) return;
  try { URL.revokeObjectURL(fetchedVideoBlobUrl); } catch {}
  if (videoBlobUrl === fetchedVideoBlobUrl) videoBlobUrl = null;
  fetchedVideoBlobUrl = null;
}

/** Szene-Video-Zustand leeren (CDN-Blob + Host-Upload), Lade-Flags zurück. */
function clearSceneVideoState() {
  sceneVideoLoadToken++;   // laufende Downloads abbrechen
  revokeFetchedVideo();
  if (videoBlobUrl) {
    try { if (String(videoBlobUrl).startsWith("blob:")) URL.revokeObjectURL(videoBlobUrl); } catch {}
  }
  videoBlobUrl = null;
  localVideoBuf = null;
  myLoadPct = 0;
  myVideoReady = false;
  pendingGoLines = false;
  pendingGoRealtime = false;
  players.forEach(p => { p.loadPct = 0; p.videoReady = false; });
  try { clearLoadReassure("lobby"); } catch {}
}

/** Lädt eine Video-URL als Blob (richtiger MIME-Typ) und meldet 0–100 % Fortschritt.
 *  Scheitert das CDN (403 bei Übergrößen, 5xx, Netzfehler), wird still auf
 *  GitHub Raw umgeschwenkt — das ist genau das Verhalten von vor v9.12.1. */
async function fetchVideoAsBlob(url, onProgress) {
  try {
    return await fetchVideoAsBlobFrom(url, onProgress);
  } catch (e) {
    const raw = rawUrlFor(url);
    if (!raw) throw e;
    console.warn("Video über CDN fehlgeschlagen (" + e.message + ") → Notfallweg GitHub Raw:", raw);
    try { if (onProgress) onProgress(0); } catch {}
    return await fetchVideoAsBlobFrom(raw, onProgress);
  }
}

async function fetchVideoAsBlobFrom(url, onProgress) {
  const res = await fetch(url, { mode: "cors", cache: "force-cache" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body || typeof res.body.getReader !== "function") {
    const buf = await res.arrayBuffer();
    if (onProgress) onProgress(100);
    return URL.createObjectURL(new Blob([buf], { type: "video/mp4" }));
  }
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (onProgress) {
      if (total > 0) onProgress(Math.min(99, Math.round(received / total * 100)));
      else onProgress(Math.min(95, Math.round(received / (1024 * 1024) * 4)));
    }
  }
  if (onProgress) onProgress(100);
  return URL.createObjectURL(new Blob(chunks, { type: "video/mp4" }));
}

function reportLoadProgress(pct, ready) {
  myLoadPct = Math.max(0, Math.min(100, pct | 0));
  myVideoReady = !!ready;
  const me = players.find(p => p.id === myId);
  if (me) { me.loadPct = myLoadPct; me.videoReady = myVideoReady; }
  renderPlayers();
  renderBoothPlayers();
  if (isHost) {
    broadcastState({ throttle: !ready });
    checkStartable();
  } else {
    sendHost({ t: "loadProg", pct: myLoadPct, ready: myVideoReady });
  }
}

function flushPendingStart() {
  if (pendingGoLines) { pendingGoLines = false; startBooth(); return; }
  if (pendingGoRealtime) { pendingGoRealtime = false; startRealtime(); }
}

function queueOrStartBooth() {
  if (myRole() == null || myVideoReady || !(scene && scene.videoUrl)) {
    startBooth();
    return;
  }
  pendingGoLines = true;
  status("lobby-status", tt("Host started — your video is still loading (", "Host hat gestartet — dein Video lädt noch (") + myLoadPct + tt("%). You’ll jump in automatically when it’s ready.", "%). Du springst automatisch rein, sobald es fertig ist."), true);
  try { showToast(tt("⏳ Video still loading — you’ll join automatically", "⏳ Video lädt noch — du kommst automatisch dazu"), "join"); } catch {}
}

function queueOrStartRealtime() {
  if (myRole() == null || myVideoReady || !(scene && scene.videoUrl)) {
    startRealtime();
    return;
  }
  pendingGoRealtime = true;
  status("lobby-status", tt("Host started — your video is still loading (", "Host hat gestartet — dein Video lädt noch (") + myLoadPct + tt("%). Jumping in automatically …", "%). Du springst automatisch rein …"), true);
  try { showToast(tt("⏳ Video still loading — you’ll join automatically", "⏳ Video lädt noch — du kommst automatisch dazu"), "join"); } catch {}
}

/** Langer Ladehinweis — erst nach ~10s, damit kurze Loads nicht blitzen. */
const LOAD_REASSURE_MS = 10000;
const loadReassureTimers = {};
function armLoadReassure(key) {
  clearLoadReassure(key);
  const el = $((key === "prem" ? "prem" : "lobby") + "-load-reassure");
  if (el) el.classList.remove("show");
  loadReassureTimers[key] = setTimeout(() => {
    const tip = $((key === "prem" ? "prem" : "lobby") + "-load-reassure");
    if (tip) tip.classList.add("show");
  }, LOAD_REASSURE_MS);
}
function clearLoadReassure(key) {
  if (loadReassureTimers[key]) {
    clearTimeout(loadReassureTimers[key]);
    delete loadReassureTimers[key];
  }
  const tip = $((key === "prem" ? "prem" : "lobby") + "-load-reassure");
  if (tip) tip.classList.remove("show");
}

/** Szene-Video laden: Remote per Blob-Download (Fortschritt + MIME-Fix), Blob-URLs direkt. */
function beginSceneVideoLoad(src) {
  const token = ++sceneVideoLoadToken;
  pendingGoLines = false;
  pendingGoRealtime = false;
  myLoadPct = 0;
  myVideoReady = false;
  revokeFetchedVideo();
  reportLoadProgress(0, false);
  clearLoadReassure("lobby");

  const preview = $("preview");
  if (!src) {
    myVideoReady = true;
    reportLoadProgress(100, true);
    setBar("download-bar", 100);
    return;
  }
  if (/^blob:/i.test(src)) {
    if (preview) preview.src = src;
    myVideoReady = true;
    myLoadPct = 100;
    reportLoadProgress(100, true);
    setBar("download-bar", 100);
    return;
  }

  setBar("download-bar", 0);
  armLoadReassure("lobby");
  status("lobby-status", tt("📥 Loading scene video … long scenes can take a bit.", "📥 Szene-Video wird geladen … bei langen Szenen kann das etwas dauern."));

  (async () => {
    try {
      const blobUrl = await fetchVideoAsBlob(src, (pct) => {
        if (token !== sceneVideoLoadToken) return;
        myLoadPct = pct;
        setBar("download-bar", pct);
        reportLoadProgress(pct, false);
        status("lobby-status", tt("📥 Video loading … ", "📥 Video lädt … ") + pct + "%" + (pct < 100 ? tt(" — please wait", " — bitte warten") : ""));
      });
      if (token !== sceneVideoLoadToken) {
        try { URL.revokeObjectURL(blobUrl); } catch {}
        return;
      }
      fetchedVideoBlobUrl = blobUrl;
      videoBlobUrl = blobUrl;
      if (preview) preview.src = blobUrl;
      myLoadPct = 100;
      myVideoReady = true;
      setBar("download-bar", 100);
      clearLoadReassure("lobby");
      reportLoadProgress(100, true);
      status("lobby-status", tt("✅ Video loaded — pick a role & “I’m ready”.", "✅ Video geladen — Rolle wählen & „Bin bereit“."));
      SFX.ok();
      flushPendingStart();
    } catch (e) {
      if (token !== sceneVideoLoadToken) return;
      console.warn("Video-Blob-Load fehlgeschlagen, Fallback auf Direkt-URL:", e);
      try {
        if (preview) preview.src = src;
        await waitCanPlay(preview, 90000);
        if (token !== sceneVideoLoadToken) return;
        myLoadPct = 100;
        myVideoReady = true;
        setBar("download-bar", 100);
        clearLoadReassure("lobby");
        reportLoadProgress(100, true);
        status("lobby-status", tt("✅ Video ready — pick a role & “I’m ready”.", "✅ Video bereit — Rolle wählen & „Bin bereit“."));
        flushPendingStart();
      } catch (e2) {
        console.warn("Video-Fallback auch fehlgeschlagen:", e2);
        myVideoReady = false;
        clearLoadReassure("lobby");
        reportLoadProgress(myLoadPct, false);
        status("lobby-status", tt("❌ Video couldn’t load. Check your connection — big scenes (~20 MB) need a bit of patience.", "❌ Video konnte nicht geladen werden. Verbindung prüfen — große Szenen (~20 MB) brauchen etwas Geduld."), true);
        SFX.err();
      }
    }
  })();
}

function getCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  // Bei Host-Pause nicht automatisch resume — sonst kämpft Pause gegen Klick/Visibility
  if (audioCtx.state === "suspended" && !premPaused) audioCtx.resume();
  return audioCtx;
}
// Handy (vor allem iOS) pausiert den Ton, sobald die App kurz im Hintergrund war.
// Beim Zurückkommen und bei der nächsten Berührung wieder anstoßen.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && audioCtx && audioCtx.state === "suspended" && !premPaused) {
    try { audioCtx.resume(); } catch {}
  }
});
["pointerdown", "touchstart", "click"].forEach(ev => {
  document.addEventListener(ev, () => {
    if (audioCtx && audioCtx.state === "suspended" && !premPaused) { try { audioCtx.resume(); } catch {} }
  }, { capture: true, passive: true });
});

// Datei speichern — am PC immer echter Download in den Downloads-Ordner.
// Teilen-Menü nur auf iPhone/iPad, weil dort der normale Download oft gar nicht geht.
async function saveBlob(blob, dateiname) {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios) {
    try {
      if (navigator.canShare) {
        const datei = new File([blob], dateiname, { type: blob.type || "application/octet-stream" });
        if (navigator.canShare({ files: [datei] })) {
          await navigator.share({ files: [datei], title: dateiname });
          return "share";
        }
      }
    } catch (e) {
      if (e && e.name === "AbortError") return "abort";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = dateiname;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return "download";
}

// ═════════════════════════════════════════════════════════════
// SFX — komplett synthetisch, keine Dateien
// ═════════════════════════════════════════════════════════════
const SFX = (() => {
  function tone(f, dur = 0.08, type = "square", vol = 0.1, when = 0, slide = 0) {
    try {
      const a = getCtx(), o = a.createOscillator(), g = a.createGain();
      const t = a.currentTime + when;
      o.type = type; o.frequency.setValueAtTime(f, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(a.destination);
      o.start(t); o.stop(t + dur + 0.05);
    } catch {}
  }
  // Echte Samples aus /sfx — überlappen erlaubt (jedes Mal neues Audio)
  const active = new Set();
  function sample(file, vol = 0.55) {
    try {
      const a = new Audio("sfx/" + file);
      a.volume = Math.max(0, Math.min(1, vol));
      active.add(a);
      a.addEventListener("ended", () => active.delete(a), { once: true });
      const p = a.play();
      if (p && p.catch) p.catch(() => { active.delete(a); });
      return a;
    } catch { return null; }
  }
  function fadeStop(a, ms = 800) {
    if (!a) return;
    const steps = 8, step = ms / steps, start = a.volume;
    let i = 0;
    const iv = setInterval(() => {
      i++;
      try { a.volume = Math.max(0, start * (1 - i / steps)); } catch {}
      if (i >= steps) { clearInterval(iv); try { a.pause(); } catch {} active.delete(a); }
    }, step);
  }
  return {
    click: () => { if (!sample("click.mp3", 0.42)) tone(950, 0.045, "square", 0.05); },
    ok:    () => { tone(660, 0.09, "triangle", 0.11); tone(990, 0.13, "triangle", 0.11, 0.09); },
    beep:  () => tone(440, 0.12, "sine", 0.14),
    go:    () => tone(880, 0.3, "sine", 0.16),
    rec:   () => tone(340, 0.14, "sine", 0.16, 0, 170),
    stop:  () => tone(170, 0.14, "sine", 0.14, 0, 340),
    done:  () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.13, "triangle", 0.1, i * 0.09)),
    err:   () => tone(150, 0.22, "sawtooth", 0.09),
    leave: () => { if (!sample("leave.mp3", 0.6)) [392, 294, 196].forEach((f, i) => tone(f, 0.16, "sine", 0.075, i * 0.1)); },
    back:  () => { sample("back.mp3", 0.5); },
    riser: () => sample("riser.mp3", 0.72),
    winner: () => sample("winner.mp3", 0.78),
    applause: (vol = 0.5) => sample("applause.mp3", vol),
    fadeStop,
    // Trefferton fürs Rhythmus-Spiel: kurz, weich, tonhöhenabhängig von der Wertung
    beathit: (kind) => {
      const f = kind === "perfect" ? 1046 : kind === "good" ? 784 : 587;
      const v = kind === "perfect" ? 0.045 : 0.032;
      tone(f, 0.055, "sine", v);
      if (kind === "perfect") tone(f * 1.5, 0.045, "sine", 0.022, 0.012);
    },
    drumroll: (durationSec = 6) => {
      try {
        const a = getCtx();
        const t0 = a.currentTime + 0.05;
        const noiseBuf = a.createBuffer(1, Math.max(1, a.sampleRate * 0.04), a.sampleRate);
        const nd = noiseBuf.getChannelData(0);
        for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        const hits = 40;
        for (let i = 0; i < hits; i++) {
          const p = i / hits;
          const t = t0 + durationSec * (1 - Math.pow(1 - p, 2.4));
          const src = a.createBufferSource(); src.buffer = noiseBuf;
          const filt = a.createBiquadFilter(); filt.type = "bandpass"; filt.frequency.value = 180 + p * 220; filt.Q.value = 1.1;
          const g = a.createGain();
          g.gain.setValueAtTime(0.035 + p * 0.09, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
          src.connect(filt); filt.connect(g); g.connect(a.destination);
          try { src.start(t); src.stop(t + 0.06); } catch {}
        }
        const crashLen = Math.max(1, a.sampleRate * 0.5);
        const crashBuf = a.createBuffer(1, crashLen, a.sampleRate);
        const cd = crashBuf.getChannelData(0);
        for (let i = 0; i < crashLen; i++) cd[i] = (Math.random() * 2 - 1) * (1 - i / crashLen);
        const crashSrc = a.createBufferSource(); crashSrc.buffer = crashBuf;
        const crashG = a.createGain();
        const tc = t0 + durationSec;
        crashG.gain.setValueAtTime(0.16, tc);
        crashG.gain.exponentialRampToValueAtTime(0.001, tc + 0.5);
        crashSrc.connect(crashG); crashG.connect(a.destination);
        try { crashSrc.start(tc); crashSrc.stop(tc + 0.55); } catch {}
      } catch {}
    },
  };
})();
document.addEventListener("click", e => { if (e.target.closest("button:not(:disabled)")) SFX.click(); });
window.addEventListener("DOMContentLoaded", () => {
  watchVideoErrors($("preview"), "lobby-status");
  watchVideoErrors($("booth-video"), "booth-status");
  watchVideoErrors($("play-video"), "play-status");
});
document.body.insertAdjacentHTML("beforeend",
  `<button id="patchnotes-btn" style="position:fixed;left:12px;bottom:10px;z-index:99;font-family:var(--font-mono);font-size:.62rem;color:#7a7a88;letter-spacing:.12em;background:linear-gradient(180deg,#1a1a20,#131318);border:1px solid var(--metal);border-radius:5px;padding:5px 11px;cursor:pointer">v${APP_VERSION} · 📋 Patch Notes</button>
   <div id="patchnotes-overlay" style="display:none;position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.7);align-items:center;justify-content:center;padding:20px">
     <div style="max-width:520px;width:100%;max-height:80vh;overflow-y:auto;background:#14141b;border:1px solid var(--line);border-radius:16px;padding:22px">
       <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
         <h2 style="margin:0">📋 Patch Notes</h2>
         <button id="patchnotes-close" class="ghost" style="padding:4px 12px">✕</button>
       </div>
       <div id="patchnotes-body" style="display:flex;flex-direction:column;gap:16px;font-size:.9rem;line-height:1.5"></div>
     </div>
   </div>`);

const PATCH_NOTES = [
  { v: "9.15.2", items: [
    "🎬 Neue Szene: Demon Slayer — Akaza vs Giyu & Tanjiro FULL FIGHT (~24 Min, 5 Rollen, 286 Zeilen)"
  ]},
  { v: "9.15.1", items: [
    "🎬 Zwei neue Szenen: Cause I like high school girls thats why (Nichijou) und Death Note — L, Misa und Lights Wortgefecht"
  ]},
  { v: "9.14.2", items: [
    "🗣 „Original anhören“ scheiterte bei einzelnen Lines: die Antwort des CDN wurde ungeprüft weitergereicht. Jetzt wird sie geprüft und notfalls direkt von GitHub geholt"
  ]},
  { v: "9.14.1", items: [
    "🎬 Premiere startete zu früh, wenn jemand mitten in der Aufnahme rausging: verglichen wurde nur die ANZAHL der Spuren, nicht WELCHE fehlen. Jetzt wartet sie, bis jede besetzte Rolle wirklich abgegeben hat",
    "🔌 Ein kurzer Verbindungsabriss wirft niemanden mehr sofort aus der Warteliste — 30 Sekunden Schonzeit, danach läuft es ohne die Person weiter",
    "➕ Mehrfachrollen sind jetzt zu erkennen: Hinweiszeile über der Rollenliste und eine Meldung beim Dazunehmen/Abgeben"
  ]},
  { v: "9.14.0", items: [
    "🎭 NEU: Mehrere Rollen pro Person — bei einer 4-Rollen-Szene zu dritt nimmt einfach jemand eine zweite Rolle dazu. Freie Rollen antippen, nochmal antippen gibt sie wieder ab",
    "👥 Auch Gäste dürfen dazunehmen, nicht nur der Host",
    "🎚 Die Premiere bekommt pro Rolle einen eigenen Lautstärkeregler — auch bei zwei Rollen derselben Person",
    "🎬 Premiere, Outtakes und Download zählen jetzt Rollen statt Spieler und warten damit auf das Richtige"
  ]},
  { v: "9.13.3", items: [
    "🛠 Pack-Laden brach sofort mit „updateStartButton is not defined“ ab — ein falscher Funktionsname von mir",
    "💬 Packs, die den Sprecher in die Bildunterschrift schreiben („[Isagi] „Text““), zeigen jetzt nur noch den Text",
    "⏱ Zwei Zeilen auf demselben Zeitstempel hatten kein Zeitfenster — jetzt mindestens 0,8 Sekunden"
  ]},
  { v: "9.13.2", items: [
    "🔤 In der Lobby stand roh „pack.mode“ statt eines lesbaren Textes — die Übersetzungen für das Pack-Feature fehlten komplett",
    "📦 Aus dem übersehbaren Häkchen ist ein richtiger Taster geworden, im gleichen Stil wie die Spielmodus-Karten"
  ]},
  { v: "9.13.1", items: [
    "🎬 Drei neue Szenen: KonoSuba — Jackpot! (Klau-Duell), Chainsaw Man — Reze & das Feuerwerk, Angry German Guy im Österreich-Urlaub",
    "📥 Das Pack-Feld ist jetzt eine Ablage zum Reinziehen — der Host legt zuerst ab, dann sind die anderen dran",
    "🔧 Die Pack-Karte war in der Lobby gar nicht aufgetaucht"
  ]},
  { v: "9.13.0", items: [
    "📦 NEU: Lokale Packs — ihr könnt jetzt jedes Choicer-Voicer-Pack direkt spielen, ohne dass es ins Spiel eingebaut sein muss. Jede Person lädt dieselbe ZIP, erst dann kann der Host starten",
    "🔍 Wer ein anderes oder kaputtes Pack geladen hat, wird namentlich angezeigt — kein halb gestartetes Spiel mehr",
    "🔇 Bei lokalen Packs läuft nur der Backing-Track, die Originalstimmen im dub_video werden stummgeschaltet",
    "🎭 Packs, die denselben Charakter mal groß und mal klein schreiben, ergeben nicht mehr doppelte Rollen"
  ]},
  { v: "9.12.2", items: [
    "🔪 Battle Royale konnte endlos weiterlaufen: bekamen in einer Runde weniger als zwei Sprecher Sterne (z.B. weil jemand die Verbindung verloren hatte), flog niemand raus und „Champion küren“ tauchte nie auf. Jetzt scheidet garantiert jemand aus — notfalls nach Gesamtpunkten",
    "🎭 Wer gerade offline ist, bekommt keine Rolle mehr zugeteilt. Vorher schnappten Abwesende den Anwesenden die Plätze weg, weil sie die meiste Bank-Zeit gesammelt hatten — im schlimmsten Fall startete die Runde ohne einen einzigen Sprecher",
    "🤝 SynchroBuddy: nach einem Verbindungsabbruch konnte man ein zweites Mal einen vergeben",
    "⚡ Szenenliste darf jetzt im Browser-Cache bleiben — spart bei jedem weiteren Besuch 57 KB"
  ]},
  { v: "9.12.1", items: [
    "🛠 Update-Bremse gelöst: die Seite hatte noch die Version 9.11.6 angefordert, dadurch blieb bei Stammspielern die alte, gecachte Fassung liegen — der Ladezeit-Umbau von 9.12.0 kam bei ihnen nie an",
    "🚀 Videos laufen jetzt über das CDN statt über GitHub Raw — schneller und ohne Drosselung bei vielen Spielern gleichzeitig (mit automatischem Notfallweg)",
    "🖼 Fehlende Charakterbilder zeigen kein kaputtes Bild-Symbol mehr, sondern eine Typenschild-Kachel mit den Initialen",
    "🎭 Das Charakterbild über der aktuellen Zeile lud an unserem CDN vorbei — jetzt auch von dort"
  ]},
  { v: "9.12.0", items: [
    "⚡ Ladezeit: Beim Start werden statt 868 KB nur noch 56 KB geladen (94 % weniger). Die Zeilen einer Szene kommen erst, wenn sie gebraucht werden — im Schnitt 4,7 KB pro Szene.",
    "⚡ Die Szenenliste wurde bei jedem Raum-Erstellen dreimal geladen — jetzt einmal",
    "🛡 Fällt automatisch auf die alte scenes.json zurück, falls der Index fehlt oder beschädigt ist"
  ]},
  { v: "9.11.6", items: [
    "🎬 Neue Szene: SpongeBob — Der hackfleischhassende Zerhacker (DE-Pack)",
    "🎬 Neue Szene: SpongeBob — Geisterpiraten (DE-Pack)"
  ]},
  { v: "9.11.5", items: [
    "🎬 Neue Szene: Jujutsu Kaisen — Gojo Death (Gojo, Yuji, Sukuna)",
    "🎬 Neue Szene: Naruto — Sasuke & Naruto Final Fight",
    "🎬 Neue Szene: Jujutsu Kaisen — Sukuna vs Jogo PT 3"
  ]},
  { v: "9.11.4", items: [
    "🎬 Neue Szene: Demon Slayer — Tanjiro Enters The Transparent World (Akaza, Giyu, Tanjiro)",
    "📦 Choicer-Voicer-Pack auf dem Desktop (dub_video.ogv + Vocals-Slices statt stummer WAVs)",
    "🛠 Editor-Export-Fix: ZIP-Export brach ab (falsche Multi-Thread-FFmpeg-Datei ohne SharedArrayBuffer auf GitHub Pages) — jetzt Single-Thread + klarere Fehlermeldung"
  ]},
  { v: "9.11.3", items: [
    "🛠 Neuer Szenen-Editor mit Timeline (aus CV Mod Maker) — Export als Synchronstudio-ZIP (scene.json, Video+Backing, Lines EN/DE)",
    "Link: editor.html?studio=1 — alter Editor unter editor.legacy.html"
  ]},
  { v: "9.11.2", items: [
    "🔊 Fix: Monster und Titan liefen über ihre Line hinaus — man hörte sie noch, während schon jemand anders sprach. Grund: die Längenbegrenzung rechnet in Quell-Sekunden, bei verlangsamter Wiedergabe dauert dieselbe Länge aber entsprechend länger. Bei Titan waren das 1,3 Sekunden Überlauf.",
    "🎈 Nebenbei: Helium wurde umgekehrt zu früh abgeschnitten — jetzt hat auch der die volle Fensterlänge",
    "⏱ Einstieg mitten in einer laufenden Premiere trifft bei diesen Effekten jetzt die richtige Stelle"
  ]},
  { v: "9.11.1", items: [
    "🛡 Fix: Eine unvollständig übertragene Kritzel-Nachricht konnte den Empfänger abstürzen lassen — jetzt abgefangen"
  ]},
  { v: "9.11.0", items: [
    "🔁 Fix: Nach einer Runde blieben einzelne Spieler hängen und man musste eine neue Lobby aufmachen. Ursache: der Rücksprung hing an EINER Nachricht — ging die verloren, korrigierte nichts mehr. Der Host schickt seine Phase jetzt laufend mit, Gäste holen sich selbst zurück.",
    "⚡ Weniger Verzögerung: Datenblöcke von 128 KB auf 16 KB (WebRTC verträgt große Blöcke schlecht) und Rückstau-Grenze von 4 MB auf 256 KB — Steuerbefehle standen vorher minutenlang hinter Videodaten in der Warteschlange",
    "📏 12 neue Stimmen-Effekte für Figuren, die nicht direkt vor der Kamera stehen: Ein paar Schritte entfernt, Weit weg (Rufweite), Außerhalb des Bildes, Hinter einer Tür, Aus dem Nebenzimmer, Von oben, Flüstern, Rufen, In einer Menschenmenge, Lautsprecher-Durchsage, Aus dem Fernseher, Erinnerung",
    "🔊 Die Entfernungs-Effekte arbeiten physikalisch: Luft schluckt Höhen mit der Distanz und der Raumanteil steigt — nicht einfach nur leiser"
  ]},
  { v: "9.10.96", items: [
    "🎬 Neue Szene: Spider-Man — Miles & the Prowler",
    "🎬 Neue Szene: Chainsaw Man — Yee Haw (Denji, Beam, Angel)",
    "🎬 Neue Szene: Tokyo Ghoul — Ken vs Jason (Count / Bucket) — andere Szene als Kaneki vs Jason"
  ]},
  { v: "9.10.95", items: [
    "🎬 Neue Szene: Demon Slayer — Tanjiro & Giyu vs Akaza (Infinity Castle, 20 Lines)",
    "📦 Choicer-Voicer-Pack liegt auf dem Desktop (dub_video.ogv + Vocals-Slices)"
  ]},
  { v: "9.10.94", items: [
    "🎤 Mikrofon: alte gespeicherte Geräte-ID blockiert Brave nicht mehr — Auswahl erscheint wieder",
    "🎬 Ghost Stories + Tokyo Ghoul sind jetzt auch online in der Szenenliste"
  ]},
  { v: "9.10.93", items: [
    "🎬 Neue Szene: Ghost Stories — I Hope to God You're Adopted (Satsuki, Keiichirou, Kaya)",
    "🎬 Neue Szene: Tokyo Ghoul — Kaneki vs Jason (Rize, Jason, Kaneki)",
    "📦 Desktop-Ordner ist jetzt auch ein Choicer-Voicer-Pack (dub_video.ogv + Lines)"
  ]},
  { v: "9.10.92", items: [
    "🎚 Premiere: Auto-Ausgleich-Knopf — alle Stimmen ungefähr gleich laut, Musik wird leiser geduckt damit nichts übertönt wird",
    "Host schaltet vor der Premiere an/aus; gilt für alle Zuhörer (wie die −/+ Mitspieler-Lautstärke)"
  ]},
  { v: "9.10.91", items: [
    "🔗 Invite links fill in the 5-digit room code again",
    "🍿 Premiere: guests unpause with the host; Replay plays for everyone",
    "🏠 Leaving a room resets match settings to normal defaults",
    "🌐 English: join/reconnect, lobby banner, minigames, booth, rating, duel, save messages no longer stay German"
  ]},
  { v: "9.10.90", items: [
    "📶 Scene picker no longer downloads videos for thumbnails — uses character pictures instead (saves a lot of internet)"
  ]},
  { v: "9.10.89", items: [
    "🍿 Fix: Premiere starts for everyone together (premGo retries + follow host if message was delayed)",
    "📦 Mix is sent before the big outtakes pack — less blocked start for guests",
    "🎨 Doodle board: strokes can’t “ghost-erase” from out-of-order updates; board resets per room"
  ]},
  { v: "9.10.88", items: [
    "🔧 Fix: after a round, guests can pick roles & Ready again (role sync race)",
    "📥 Fix: video “loaded” status resets properly for everyone when host picks a new scene",
    "🔌 Fix: rejoin / reconnect follows host back to lobby with scene + roles visible",
    "🎨 Fix: doodle board clears per room (no leftover strokes from other rooms)"
  ]},
  { v: "9.10.87", items: [
    "🌐 Scene picker: “roles” in English (not “Rollen”); titles + filter chips follow EN|DE",
    "🍌 GameBanana listing pack refreshed (GAMEBANANA.md)"
  ]},
  { v: "9.10.85", items: [
    "🌐 EN mode: scene line texts show English (no German captions); effect names + pan Center/Left/Right translated",
    "🎵 Lobby music fixed (CDN path + AudioContext resume)",
    "🛠 Scene editor hidden from public — only with special link",
    "🎬 Premiere status strings translated (preload / all ready / re-record panel / next line cue)"
  ]},
  { v: "9.10.84", items: [
    "🌐 Language switch: English / Deutsch (EN default) — preference saved",
    "🔢 Room codes unified to 5 digits everywhere (UI + messages)",
    "🧭 Big EN | DE control in the header (studio look)"
  ]},
  { v: "9.10.82", items: [
    "🔒 Room codes 5 digits — share only with friends",
    "🌐 Klarere Meldung wenn der Spiel-Server überlastet / kurz weg ist",
    "📝 Fan-Projekt-Hinweis auf der Startseite (kein Geldverdienen, privat mit Freunden)",
    "🍌 GameBanana-ready: Texte zum Paste in GAMEBANANA.md"
  ]},
  { v: "9.10.81", items: [
    "🎬 Neue Szene: Ghost Stories — Let's See Seven (Keiichirou, Satsuki)",
    "🎬 Neue Szene: Sag Wallah Trymacs (Kandidat, Trymacs)",
    "🎬 Neue Szene: Jujutsu Kaisen — Sukuna vs Mahoraga (Megumi, Haruta, Mahoraga, Sukuna)",
    "🎬 Neue Szene: Ted — Ted And Sam (Ted, Sam)",
    "🎬 Neue Szene: Jujutsu Kaisen — Sukuna vs Jogo PT 1 (Sukuna, Jogo, Geto)"
  ]},
  { v: "9.10.80", items: [
    "🎬 Neue Szene: Ghost Stories — You Lose Weight You'd Move Faster (Hajime, Satsuki, Music Teacher)",
    "🎬 Neue Szene: Death Note — I Am Kira (Naomi, Light) — kaputtes Pack normalisiert",
    "🎬 Neue Szene: Megamind — You're the Punk I've Heard About (Roxanne, Tighten, Metroman, Megamind, Minion)",
    "🎬 Neue Szene: High School DxD — Asia Is Staying at Issei's Home (Issei, Asia, Rias, Dad, Mom)"
  ]},
  { v: "9.10.79", items: [
    "🎬 Neue Szene: Ghost Stories — Gay Pajamas (Keiichirou, Satsuki)",
    "🎬 Neue Szene: Ghost Stories — I Have an Itch (Satsuki, Keiichirou)",
    "🎬 Neue Szene: SpongeBob — Girly Teengirl (Pearl, Girly Teengirl, Mr. Krabs, SpongeBob)",
    "🔄 Speed-Meme getauscht: Velocidad Necesito Esto → My Mom Is Kinda Homeless (gleiche Szene-ID)"
  ]},
  { v: "9.10.78", items: [
    "🎬 Your Name: Zeile 2 und 5 sind jetzt Mitsuha (statt Taki)"
  ]},
  { v: "9.10.77", items: [
    "🛠 Szenen-Editor wieder wie früher (ohne 5-Schritt-Chaos) — Springen-Knopf bleibt"
  ]},
  { v: "9.10.76", items: [
    "🎬 Neue Szene: Your Name — What Is Your Name (Taki, Mitsuha)"
  ]},
  { v: "9.10.75", items: [
    "🌐 Verbindung: abgelaufenen Metered-TURN entfernt (hat nur Zeit gekostet), ExpressTurn bleibt Haupt-Server, Open-Relay-Backup mit TURNS/443 für schwierige Netze"
  ]},
  { v: "9.10.74", items: [
    "🎬 Neue Szene: The Quintessential Quintuplets — Opening (Ichika, Nino, Miku, Yotsuba, Itsuki)"
  ]},
  { v: "9.10.73", items: [
    "🎬 Neue Szene: Bleach — Ichigo vs Byakuya Bankai (Ichigo, Byakuya, Orihime, Uryu)"
  ]},
  { v: "9.10.72", items: [
    "🛠 Szenen-Editor komplett überarbeitet: 5 klare Schritte, weniger Chaos, deutsche Hilfetexte",
    "Pack / Video / alte Szene wählen → Rollen → Text → Zeiten → Export — Erweitert-Kram eingeklappt",
    "Checkliste vor dem Speichern, Bestätigung vor Löschen, Teleprompter-Vorschau",
    "Link zum Editor jetzt auch auf dem Startbildschirm"
  ]},
  { v: "9.10.69", items: [
    "🎬 Neue Szene: Shrek — Muffin Man (Lebkuchenmann, Farquaad, Wache, Spiegel, Thelonius)",
    "🎬 Neue Szene: SpongeBob — Krusty Dog (SpongeBob, Krabs, Squidward + 3 Gäste)",
    "🎬 Neue Szene: SpongeBob — Sea Bear (Squidward, SpongeBob, Patrick, Sea Bear)",
    "🎬 Neue Szene: Classroom of the Elite — Bruder-Konfrontation (Ayanokoji, Manabu, Suzune)",
    "🎬 Neue Szene: Evangelion — Shinjis Geständnis (Shinji, Rei)",
    "🎬 Neue Szene: GTA V — Yee-Yee-Ass Haircut (Lamar, Franklin)"
  ]},
  { v: "9.10.70", items: [
    "📺 FIX: Outtakes-Rauschen — Bild und Ton gleich lang, Ende wird beim Speichern nicht mehr abgeschnitten",
    "🎬 FIX: Premiere/Original-Mix ohne TV-Rauschen zwischen den Lines (Rauschen nur noch in Outtakes)"
  ]},
  { v: "9.10.68", items: [
    "👑 FIX: Host geben — niemand fliegt mehr raus, gleicher Raumcode, alle bleiben in der Lobby",
    "🔌 Host-Rolle ist jetzt nur ein Recht (Start/Kicken), die Raum-Verbindung bleibt stabil"
  ]},
  { v: "9.10.67", items: [
    "👑 Host geben: alter Host bleibt Mitspieler in der Lobby (kein Rausflug mehr)",
    "👥 Nach Host-Wechsel: Spielerliste kommt beim Rejoin wieder zuverlässig (Namen/Avatare für alle)"
  ]},
  { v: "9.10.66", items: [
    "⬇ Fix: Outtakes-Datei wieder in normaler Geschwindigkeit (Speichern hat vorher im Zeitraffer mitgeschnitten)"
  ]},
  { v: "9.10.65", items: [
    "🎚 Premiere: Mitspieler-Lautstärke ist jetzt ein kleiner Knopf links unten (aufklappbar) — verdeckt keine Emojis mehr"
  ]},
  { v: "9.10.64", items: [
    "🌐 Beitreten: „suche Raum…“ hängt nicht mehr endlos — nach wenigen Sekunden klarer Hinweis + automatischer Versuch auf dem anderen Spiel-Server"
  ]},
  { v: "9.10.63", items: [
    "🎚 Fix: Premiere −/+ Mitspieler-Lautstärke reagiert wieder (Anzeige + Ton; Knöpfe lagen unter der Kinosaal-Leiste)",
    "📺 Outtakes-Übergang: graues TV-Rauschen statt grünem Bild (Zeichnung statt kaputter Datei)",
    "⬇ Outtakes speichern deutlich schneller (schneller Schnitt + Fortschritt „X/Y … %“)"
  ]},
  { v: "9.10.62", items: [
    "🎬 Neue Szene: Ghost Stories — Think Of A Big Black Man Chasing You (Hajime, Keiichirou, Leo)"
  ]},
  { v: "9.10.61", items: [
    "📺 Outtakes: Beep durch kurzes, leises TV-Rauschen ersetzt (Schalter „Rauschen an/aus“)",
    "🎚 Fix: Mitspieler −/+ in der Premiere ändert die Stimme wirklich (auch im Kinosaal; Kompressor blockiert nicht mehr)"
  ]},
  { v: "9.10.60", items: [
    "⬇ Video speichern bleibt nach Outtakes sofort — Mitschnitt vom Anschauen wird nicht mehr weggeschmissen",
    "🎚 Mitspieler-Lautstärke bis 300 % (Kompressor weniger „platt“, + fühlt sich wirklich lauter an)",
    "🎬 Outtakes-Beep leiser, bei vielen Clips nur noch jeden 2. Übergang, Schalter „Beep aus“"
  ]},
  { v: "9.10.59", items: [
    "🎬 Outtakes: TV-Beep-/Glitch-Übergang zwischen den Clips (Anschauen & Speichern) — füllt immer das Bildformat, Ton etwas leiser"
  ]},
  { v: "9.10.58", items: [
    "🎚 Premiere: Host kann Mitspieler einzeln lauter/leiser stellen (− / + unter dem Video) — gilt für alle Zuhörer und beim Speichern"
  ]},
  { v: "9.10.57", items: [
    "🎬 Outtakes: dezente Einblendung der gesprochenen Zeile + Link synchron-studio.github.io/synchronstudio/ (Anschauen & Speichern)"
  ]},
  { v: "9.10.56", items: [
    "🐛 Fix: Start-Knopf in der Lobby war weg (Host konnte keine Szene mehr starten)"
  ]},
  { v: "9.10.55", items: [
    "🌐 Klarer Hinweis: wenn Hotspot geht aber normales WLAN nicht → Netz/Firewall blockiert (nicht der Browser)"
  ]},
  { v: "9.10.54", items: [
    "🌐 Verbindung: zweiter Spiel-Server (Fallback), bessere Meldungen wenn Raum-Erstellen schon scheitert, doppelte TURN-Relays",
    "📦 Deploy-Fix: Kenny 3 + Kritzel-Board-Fix aus 9.10.53 endlich online (Pages-Upload war vorher fehlgeschlagen)"
  ]},
  { v: "9.10.53", items: [
    "🐹 Neues Profilbild: Kenny 3 (Hamster)",
    "🎨 Kritzel-Board: kein Flackern mehr in Opera (Board bleibt sichtbar beim Mitmalen)"
  ]},
  { v: "9.10.52", items: [
    "👑 Host weitergeben: in Lobby/Warteraum neben Mitspielern „Host geben“ — der andere übernimmt Start/Szenen/Kicken",
    "🌐 Verbindung robuster (Avast & co.): automatische Join-Retries, längere Timeouts, klarere Tipps, TURN-TCP bevorzugt"
  ]},
  { v: "9.10.51", items: [
    "😺 Neue Profilbilder: Kayleen, Kayleen 2, Kenny 1, Kenny 2"
  ]},
  { v: "9.10.50", items: [
    "🚪 Host kann Mitspieler kicken (mit Nachfrage) — Kick-Knopf neben jedem Namen in der Spielerliste"
  ]},
  { v: "9.10.49", items: [
    "🔊 „Deine Lautstärke“ geht jetzt bis 5 % runter (vorher nur bis 40 %) — hilft, wenn Effekte die Stimme lauter machen"
  ]},
  { v: "9.10.48", items: [
    "🎬 Outtakes: „Abbrechen“ mitten in der Line speichert den Fehlversuch als Blooper (alter Take bleibt)",
    "🎬 Mehrere Bloopers pro Line möglich — nicht nur der letzte Fehlversuch",
    "🎬 Outtakes-Video: roter „OUTTAKES“-Schriftzug oben links (auch beim Speichern)",
    "⏳ Langer Ladevorgang: nach ~10 Sek. Hinweis „Nicht hängen geblieben — dauert nur etwas länger…“"
  ]},
  { v: "9.10.47", items: [
    "🎥 Kinosaal + Glow wieder zuverlässig in Opera: Leiste nicht mehr „verschluckt“, Projektor-Schein als Fallback wenn Ambilight ausfällt"
  ]},
  { v: "9.10.46", items: [
    "🎬 Neue Szenen: Interstellar Stay, Girls Can't Love Girls, Towelie Remembers"
  ]},
  { v: "9.10.45", items: [
    "⭐ Bewertung neu gestylt: saubere Sterne + klarer Buddy-Chip (weniger klobig)"
  ]},
  { v: "9.10.44", items: [
    "🎛 Bewertung als Jury-Pult: Sterne wie Hardware-Schalter + LED, wenn bewertet"
  ]},
  { v: "9.10.43", items: [
    "🍔 Neue Szene: SpongeBob — Patrick: Open Sesame (2 Rollen)"
  ]},
  { v: "9.10.42", items: [
    "🎧 Stimmen-Richtung Standard jetzt Mitte — links/rechts nur noch, wenn du es in den Line-Einstellungen änderst"
  ]},
  { v: "9.10.41", items: [
    "🌈 Kinosaal: kleiner Glow-Knopf zum An/Aus; Hintergrund-Bubbles & Profilbilder fliegen nicht mehr übers Bild"
  ]},
  { v: "9.10.40", items: [
    "🎥 Kinosaal: Video etwas kleiner & wirklich mittig; dezente Lautstärke-Regler unten (Stimmen/Musik)"
  ]},
  { v: "9.10.39", items: [
    "🎥 Kinosaal: Video größer und immer mittig auf dem Bildschirm"
  ]},
  { v: "9.10.38", items: [
    "🌈 Kinosaal-Ambilight: Glow hinter dem Video nimmt die Farben vom Bild (wie RGB-Licht am Rand)"
  ]},
  { v: "9.10.37", items: [
    "📦 Premiere: echter Ladebalken mit Prozent pro Spieler (nicht nur 0/1)",
    "🎥 Kinosaal: wenn die Premiere läuft, wird alles dunkel — nur Video + Live-Kommentar bleiben"
  ]},
  { v: "9.10.36", items: [
    "🔧 Premiere-Reconnect: nach Reload nicht mehr ewig auf den Host warten; Bewertung wieder erreichbar",
    "🔇 Hintergrund-Schnitt der Premiere wieder still; Speichern nutzt keine veraltete Lautstärke mehr",
    "🔊 Vorhören mit eigenem Take wieder zuverlässig; „Vorherige“ während Aufnahme gesperrt",
    "🎚 Neu: „Rollen-Effekt aus“ in den Booth-Einstellungen (z. B. kein Monster bei Kaigaku)",
    "⏸ Pause für alle: kein Auto-Resume-Kampf mehr + gemeinsame Video-Zeit",
    "⚔️ Neue Szene: Jujutsu Kaisen — Yuta vs. Ryu Final Fight (4 Rollen)"
  ]},
  { v: "9.10.35", items: [
    "📜 Line-Text liegt jetzt als Gaffer-Streifen über dem Video",
    "🌊 Wellenform sitzt direkt über den Aufnahme-Knöpfen"
  ]},
  { v: "9.10.34", items: [
    "🎛 Booth: Aufnehmen/Anhören/Weiter jetzt direkt unter dem Video — Einstellungen darunter einklappbar"
  ]},
  { v: "9.10.33", items: [
    "⏱ Gespeicherte Videos zeigen wieder die Gesamtlänge in der Zeitleiste (WebM-Duration-Metadaten)",
    "🎬 Outtakes: Ton + Speichern (mit v9.10.32)"
  ]},
  { v: "9.10.32", items: [
    "🎬 Outtakes: Ton beim Anschauen wieder da + Speichern/Sofort-Speichern zuverlässig (Hintergrund-Schnitt)"
  ]},
  { v: "9.10.31", items: [
    "🔊 Line-Lautstärke kommt jetzt auch bei allen anderen in Premiere & Speichern an (nicht nur bei dir selbst)"
  ]},
  { v: "9.10.30", items: [
    "📥 Lange Szenen (z. B. Zenitsu): echter Ladebalken pro Spieler — Host sieht wer noch lädt",
    "🔒 Session startet erst, wenn bei allen Sprechern das Video fertig ist (kein Host-only-Start mehr)",
    "🎬 Große Videos zuverlässiger (als Blob geladen — GitHub-Raw-MIME-Fix)"
  ]},
  { v: "9.10.29", items: [
    "🎧 Pro Line: Stimme links / Mitte / rechts legen (Stereo) — gilt für Premiere & Speichern"
  ]},
  { v: "9.10.28", items: [
    "⬇ Outtakes sofort speichern — Reel wird im Hintergrund fertiggeschnitten"
  ]},
  { v: "9.10.27", items: [
    "🎬 Outtakes: keine Doppel-/Dreifach-Clips mehr (pro Line nur der letzte Blooper)"
  ]},
  { v: "9.10.26", items: [
    "🎬 Outtakes-Speichern: Bildspur gefixt (war nur Ton / wie MP3)"
  ]},
  { v: "9.10.25", items: [
    "🗣 Beim Aufnehmen optional Original mithören (Lautstärke regelbar) — Take bleibt nur deine Stimme"
  ]},
  { v: "9.10.24", items: [
    "🎬 Outtakes-Knopf deutlicher + Outtakes-Reel speichern/herunterladen"
  ]},
  { v: "9.10.23", items: [
    "💾 Premiere schneidet schon beim ersten Anschauen mit — kein automatischer Zweitdurchlauf mehr zum Speichern"
  ]},
  { v: "9.10.22", items: [
    "🎬 Große Videos (über 20 MB) laden wieder — jsDelivr-Limit umgangen (Marin/Zenitsu etc.)"
  ]},
  { v: "9.10.21", items: [
    "🎀 Neue Szene: My Dress-Up Darling — Kawaii Kaiwai Outro (4× Marin)"
  ]},
  { v: "9.10.20", items: [
    "🎬 Neue Szenen: Ghost Stories (Rabbit), Spider-Man NWH Organic Web, SpongeBob Menacingly"
  ]},
  { v: "9.10.19", items: [
    "🎚 Noise Gate weicher + Nebengeräusche raus (Stimme bleibt), Original-Stimmen in Premiere wählbar, Pause für alle"
  ]},
  { v: "9.10.18", items: [
    "🎛 Aufnahme-Welle wie Choicer: Original füllt die Breite, Lautstärke normalisiert (nicht mehr winzig/zu lang)"
  ]},
  { v: "9.10.17", items: [
    "⚡ Leichtere Performance: Visualizer/Mikro-Loop nur wenn nötig, Fortschritt gedrosselt, Offline-Countdown ohne Full-Redraw"
  ]},
  { v: "9.10.16", items: [
    "🔇 Lobby-Vorschauvideo stoppt beim Rundenstart (kein Geister-Ton mehr im Hintergrund)"
  ]},
  { v: "9.10.15", items: [
    "🐛 Viele Sync-Fixes: Offline blockiert Premiere/Mix/Bewertung nicht mehr",
    "🔌 Reload behält Rolle; eigene Videos + Wiederkommen stabiler",
    "🛡 Host-/Gast-Nachrichten getrennt; Duell-Einreichung nicht mehr fälschbar",
    "🏠 Spät dazukommen springt in die laufende Phase; Speichern/Caches robuster"
  ]},
  { v: "9.10.14", items: [
    "⬇ „Video speichern“ zuverlässiger sofort: Mitschnitt robuster, nach Lautstärke-Änderung im Hintergrund neu schneiden"
  ]},
  { v: "9.10.13", items: [
    "🏠 Neue Szene lädt alle aus der Premiere zurück in die Lobby (niemand bleibt dort hängen)"
  ]},
  { v: "9.10.12", items: [
    "🔌 Reconnect-Fix: kein doppelter Spieler mehr nach Rausflug — Platz/Rolle bleiben erhalten",
    "⏳ Längere Wartezeit bei Abbruch während Aufnahme/Premiere (weniger „rausgeworfen“)"
  ]},
  { v: "9.10.11", items: [
    "🎬 Outtakes: Host startet für alle — Takes von allen Spielern gemischt",
    "🔊 „Deine Lautstärke“ greift in der Premiere jetzt zuverlässig (auch für Gäste)"
  ]},
  { v: "9.10.10", items: [
    "⚔️ Hashiras Meet Muzan: Shock-Zeile korrigiert (jetzt Shinobu)"
  ]},
  { v: "9.10.9", items: [
    "⚔️ Neue Szene: Demon Slayer — Hashiras Meet Muzan (9 Rollen)"
  ]},
  { v: "9.10.8", items: [
    "📦 Live-Deploy neu: Videos kommen vom CDN — Higuruma Retrial & alle neuen Szenen wieder online"
  ]},
  { v: "9.10.7", items: [
    "📦 Seite stark verkleinert damit GitHub-Deploy wieder klappt — Higuruma Retrial inkl."
  ]},
  { v: "9.10.6", items: [
    "📦 Live-Deploy gefixt (Higuruma Retrial jetzt online), große Videos etwas verkleinert"
  ]},
  { v: "9.10.5", items: [
    "⚖️ Neue Szene: Jujutsu Kaisen — Higuruma Retrial (3 Rollen)"
  ]},
  { v: "9.10.4", items: [
    "🦸 Neue Szene: SpongeBob — International Justice League (5 Rollen)",
    "⬜ Weiße Balken laufen jetzt richtig bis zur Mitte zusammen"
  ]},
  { v: "9.10.3", items: [
    "⬜ Weiße Balken nur noch in der Aufnahme-Booth — Premiere wieder mit Zahlen-Countdown",
    "🎬 Outtakes als eigener großer Knopf bei der Premiere (sichtbar sobald du Takes neu aufgenommen hast)"
  ]},
  { v: "9.10.2", items: [
    "🔧 Live-Seite wieder korrekt aktualisiert (Besucherzähler greift jetzt)"
  ]},
  { v: "9.10.1", items: [
    "📊 GoatCounter: anonyme Besucherzahlen (wer die Seite öffnet) — Stats unter synchronstudio.goatcounter.com"
  ]},
  { v: "9.10", items: [
    "⬜ Weiße Balken jetzt klein über dem Video (nicht Fullscreen), max. 60% Deckraft",
    "🎭 Kinosaal/Vorhang nur noch beim Podest-Finale — Premiere startet sofort ohne Verzögerung",
    "🤝 SynchroBuddy wirklich nur 1× pro ganzem Match (nicht jede Bewertungsrunde neu)",
    "🎬 Yo Satoru neu gebaut (Rework 1.0.1): jetzt 5 Rollen (Gojo, Kenjaku, Mahito, Jogo, Choso), ~70 Lines, Timing/Audio gefixt"
  ]},
  { v: "9.9", items: [
    "🤝 SynchroBuddy: bei der Bewertung kannst du EINEM Sprecher einen Sticker geben, wenn die Szene richtig gesessen hat — bringt Extra-Punkte",
    "🎭 Premiere mit richtigem Kinosaal: Vorhang auf/zu, dunkler Saal",
    "👏 Applaus auf dem Podium je nach Abstand Platz 1 ↔ 2 (knapper Sieg = anders als klare Dominanz)",
    "⬜ Weiße Balken-Countdown (wie bei Synchronstudios) — an/aus neben dem 3-Sek.-Timer",
    "🎬 Outtakes-Reel: verworfene Takes landen in einer kleinen Blooper-Show nach der Premiere"
  ]},
  { v: "9.8", items: [
    "🏆 Podium-Finale richtig aufgepeppt: dunkle Bühne, Riser-Spannung, Gold/Silber/Bronze-Säulen, Scheinwerfer, Champion-Banner, Mega-Konfetti",
    "🎤 Neue Sounds: Riser (Spannungsaufbau), Gewinner-Fanfare, Publikum-Applaus — plus Klick, Zurück und „jemand hat den Raum verlassen“",
    "4️⃣5️⃣ Platz 4 und 5 erscheinen nach dem Top-3-Reveal unter den Säulen (nicht mehr nur als graue Liste)"
  ]},
  { v: "9.7", items: [
    "✨ Mehr Accessoires: Hasenohren, Sonnenbrille, Brille, Monokel, Partyhut, Mütze, Zauberhut, Blume, Schleife, Schnurrbart, Stern, Bandana",
    "👁 Raumcode in der Lobby lässt sich mit dem Augen-Knopf verwischen (z. B. für Streams) — nochmal tippen zeigt ihn wieder",
    "⏹ Beat-Booth: klarer „Song aus“-Knopf, damit du jederzeit abbrechen kannst"
  ]},
  { v: "9.6", items: [
    "🎭 Szenen-Filter nach Rollenanzahl: unter der Suche z. B. „2 Rollen“, „3 Rollen“, „7+“ — die Kacheln bleiben wie bisher",
    "⚙ Spielmodus nicht mehr als kleines Dropdown: jetzt vier große, klare Taster (Freies Spiel / Match / Battle Royale / Duell), damit man sofort sieht, was aktiv ist"
  ]},
  { v: "9.5", items: [
    "🫧 Neue Szene: „SpongeBob — Blasen-Nachrichten“ (3 Rollen)",
    "🌸 Neue Szene: „Rascal Does Not Dream — Fukashigi no Carte“ (6 Rollen, Opening-Song)",
    "🚗 Neue Szene: „Cars — We got ourselves a Noder“ (5 Rollen)",
    "💬 Neue Szene: „Jujutsu Kaisen — Was ist dein Typ, Itadori?“ (3 Rollen)",
    "⚡ Neue Szene: „Demon Slayer — Zenitsu vs. Kaigaku“ (7 Rollen, kompletter Kampf ~19 Min — stark komprimiert, damit es online lädt)"
  ]},
  { v: "9.4", items: [
    "💥 Neue Szene: „My Hero Academia — All Might vs. Nomu“ (8 Rollen)",
    "🏰 Neue Szene: „Attack on Titan — Ihr Verräter“ (6 Rollen)",
    "🔇 Neue Szene: „A Silent Voice — Mutter und Shouya“ (2 Rollen)",
    "⚖ Neue Szene: „Jujutsu Kaisen — Higurumas erstes Urteil“ (4 Rollen, lange Gerichtsszene)",
    "🪄 Neue Szene: „Harry Potter — Mein Junge“ (5 Rollen)",
    "⚡ Neue Szene: „Jujutsu Kaisen — Todos Black Flash“ (3 Rollen)"
  ]},
  { v: "9.3", items: [
    "🎲 Fix Rollen-Roulette: Bei vielen Rollen und wenigen Spielern kamen immer nur die obersten Rollen dran. Jetzt werden die Rollen wirklich zufällig gemischt",
    "⌨️ Leertaste in der Booth = Aufnehmen / Stoppen — Maus muss nicht mehr ran"
  ]},
  { v: "9.2.1", items: [
    "⬇ Fix: „Video speichern“ öffnet am PC nicht mehr das Windows-Freigeben-Menü, sondern lädt die Datei ganz normal in den Downloads-Ordner"
  ]},
  { v: "9.2", items: [
    "🎬 Neue Szene: „The Incredibles — Wo ist mein Superanzug?“ (2 Rollen: Frozone, Honey)",
    "👁 Neue Szene: „Jujutsu Kaisen — Tojis Auftritt“ (4 Rollen: Nanami, Maki, Dagon, Erzähler)",
    "🚗 Neue Szene: „Cyberpunk Edgerunners — Autoklau“ (6 Rollen: Maine, Kiwi, Rebecca, David, Lucy, Wachmann)",
    "⚡ Video speichern ohne zweites Durchschauen: Beim ersten Anschauen der Premiere wird das fertige Video schon mitgeschnitten. Danach ist „Speichern“ sofort fertig. Falls du die Lautstärke noch änderst, wird einmal im Hintergrund neu geschnitten — zuschauen musst du trotzdem nicht"
  ]},
  { v: "9.1", items: [
    "📱 Handy tauglicher: größere Knöpfe, sichere Ränder (nicht unter der Home-Leiste), kein versehentliches Zoomen beim Tippen, Textfelder zoomen auf dem iPhone nicht mehr rein",
    "🎬 Speichern als MP4, wenn der Browser das kann — direkt für TikTok, Insta und WhatsApp, ohne CapCut. Sonst weiterhin WebM mit Hinweis",
    "🔌 Wieder rein kommen: fliegst du kurz raus (WLAN-Zucken, App-Wechsel), bleibt dein Platz 2 Minuten frei. Du kommst automatisch zurück — mit Rolle und allem, was du schon aufgenommen hast",
    "🔌 Wer bewusst auf „Raum verlassen“ drückt, räumt den Platz sofort. Alle anderen sehen währenddessen „Verbindung weg“ mit Restzeit",
    "🎞 „testplace“ steht in der Szenen-Auswahl immer ganz hinten — nie wieder dazwischen"
  ]},
  { v: "9.0", items: [
    "🎬 Neue Szene: „Dragon Ball Z — Gokus erste Super-Saiyajin-Verwandlung“ (3 Rollen: Son Goku, Freezer, Son Gohan)",
    "🍔 Neue Szene: „SpongeBob — Ist Mayonnaise ein Instrument?“ (7 Rollen: Thaddäus, Patrick, Sandy, SpongeBob, Mr. Krabs, Plankton, Larry der Hummer)",
    "🖤 Schwarzbild-Fehler beim Speichern behoben: Bei manchen Rechnern kam nur Ton und ein schwarzes Video heraus. Das Bild wurde direkt vom Videoplayer abgegriffen, und je nach Grafikkarte kommen da schwarze Bilder an. Jetzt wird jedes Bild einzeln auf eine Zeichenfläche gemalt und DIESE aufgenommen",
    "🖤 Dazu eine Warnung: Wenn das Fenster beim Speichern in den Hintergrund rutscht, bremst der Browser die Aufnahme aus. Das wird jetzt erkannt und gesagt, statt dass du ein kaputtes Video bekommst",
    "🎙 „Studio-Qualität“ klingt endlich gut. Vorher hob der Effekt die Höhen an — und damit genau das Rauschen und Zischeln, das billige Mikrofone zu viel haben. Danach kam noch 55 % Extra-Pegel ohne Bremse obendrauf, das hat schlicht übersteuert",
    "🎙 Neu in der Kette: Höhen werden zurückgenommen statt angehoben, es gibt einen echten Zischlaut-Dämpfer, der nur eingreift wenn es nötig ist, eine sanfte zweistufige Verdichtung mit Limiter als Deckel und einen Ausgleich auf gleiche Lautheit statt auf die lauteste Spitze",
    "🎙 Die Rauschunterdrückung rechnete das Störgeräusch dreifach überhöht heraus — davon kam der dumpfe, gluckernde Klang. Jetzt sanfter und ruhiger, dafür sauber. Nebenbei läuft sie deutlich schneller",
    "📊 Der Visualizer beim Aufnehmen einer Line ist neu: Das Original liegt jetzt OBEN, deine Stimme UNTEN, auf einer gemeinsamen Zeitachse mit Sekunden-Markierungen. So siehst du sofort, ob du zu früh oder zu spät dran bist, statt zwei Wellen übereinander zu entwirren",
    "📊 Dazu eine gestrichelte Linie, wo das Original fertig ist, plus Hinweise „zu leise“ und „zu laut“ direkt im Bild"
  ]},
  { v: "8.9", items: [
    "🔗 Einladungs-Link: In der Lobby gibt's einen Knopf, der einen Link kopiert. Wer draufklickt, hat den Raumcode schon eingetragen — kein Vorlesen und Vertippen mehr",
    "🎞 Szenen-Auswahl komplett neu: statt einer langen Klappliste jetzt ein Raster mit echtem Bild aus jeder Szene und dem Namen clean darunter. Dazu eine Suche über Titel UND Rollennamen",
    "🎚 Neuer Studio-Visualizer beim Sprechen: LED-Ketten wie am Rack-Analyzer, mit nachfallenden Peak-Marken und Übersteuerungs-Lampe. Eingemessen, damit normales Sprechen in der Mitte liegt",
    "🖼 Kaputte Profilbilder raus: „Peter“ und „Lois“ zeigten nur ein leeres Kästchen. Wer eines davon ausgewählt hatte, bekommt automatisch die Auswahl zurückgesetzt",
    "⏱ Timing-Fehler korrigiert: Bei „Sae Vs Rin“ spielte „Original anhören“ ganze 2 Minuten statt eines Rufs, bei „Entertainment District“ war es an zwei Stellen praktisch stumm. Bei „Broly“ hatten zwei Lines gar keine Länge, bei „A Haunted House“ war die Reihenfolge vertauscht",
    "⏱ Aufnahmezeit richtet sich jetzt nach der echten Länge des Originals statt nach der Angabe in den Szenen-Daten — falsche Zeiten bremsen dich damit nicht mehr aus, und die „~X Sek.“-Anzeige stimmt",
    "🩹 Absturz behoben: Zuschauer (ohne Rolle) flogen bei Szenen ohne Line-Timings aus dem Spiel",
    "🩹 Hänger behoben: Ein Duell mit genau 2 Spielern blieb für immer im Abstimm-Screen stehen — jetzt stimmen die beiden selbst ab",
    "🩹 Hänger behoben: Verlor jemand mitten in der Aufnahme die Verbindung, wartete die Runde endlos auf seine Spur. Jetzt startet die Premiere mit dem Rest — und der Host hat zusätzlich einen Notausgang-Knopf"
  ]},
  { v: "8.8", items: [
    "🐛 Fix: „Original anhören“ spielte manchmal die Stimmen einer VORHERIGEN Szene ab — im Match-Modus bei jeder neuen Runde und bei Szenen, die der Host als eigenes Video überträgt",
    "🔧 Ursache endgültig behoben: die Stimmen-Spur wird jetzt pro Datei gemerkt statt in einer gemeinsamen Variable, die man bei jedem Szenenwechsel von Hand leeren musste (genau das wurde 3× vergessen)",
    "⚡ Nebeneffekt: schon geladene Szenen laden beim Zurückwechseln nicht neu, doppelte Klicks lösen nur einen Download aus, und ein fehlgeschlagener Download blockiert den Knopf nicht mehr dauerhaft"
  ]},
  { v: "8.7", items: [
    "🔊 Lautstärke-Regler pro Line: zu leise aufgenommen? Einfach bis auf 400 % hochdrehen — wirkt beim Anhören, in der Premiere und im fertigen Video",
    "⚠ Warnt automatisch, sobald das Hochdrehen in die Übersteuerung läuft (rechnet den echten Spitzenpegel deiner Aufnahme mit)"
  ]},
  { v: "8.6", items: [
    "🎙 Studio-Qualität grundlegend überarbeitet: statt simplem Abziehen läuft jetzt ein Wiener-Filter, der die Dämpfung aus dem zeitlichen Verlauf ableitet und glättet — dadurch verschwindet das metallische Gluckern (Restpegel-Schwankung von 0,25 statt vorher unruhig)",
    "🖱 Mausklicks und Tastenanschläge werden jetzt erkannt und gedämpft (rund 10 dB leiser) — kurze breitbandige Knackser, die eine reine Rauschunterdrückung gar nicht erfassen kann",
    "📈 Stimme bleibt besser erhalten: 78 % statt vorher 62 %",
    "🔊 Fix: Vorhören-Knopf ging nicht (Audio-Kontext war pausiert) und der Stärke-Regler ließ sich danach nicht mehr bedienen — jetzt spielt die Vorschau bei Regler-Änderung direkt mit der neuen Stärke weiter"
  ]},
  { v: "8.5", items: [
    "🎙 Studio-Qualität komplett neu gebaut: statt nur EQ läuft jetzt eine echte Rauschunterdrückung im Frequenzbereich — Grundrauschen, Lüfter- und Netzbrummen werden analysiert und herausgerechnet, gemessen rund 23 dB weniger Störgeräusch bei erhaltener Stimme",
    "🎚 Die Stärke-Regelung steuert dabei mit, wie beherzt aufgeräumt wird"
  ]},
  { v: "8.4", items: [
    "🎙 Neuer Effekt „Studio-Qualität“ — komplette Sende-Kette (Rumpel-Filter, Entmulmung, Präsenz-Anhebung, Zisch-Zähmung, Luft, Kompressor) für alle mit günstigem Mikrofon",
    "🎚 Effekt-Stärke frei regelbar von 0–100 %, wirkt bei JEDEM Effekt — z. B. Hall nur ganz dezent statt voll",
    "🔊 Vorhören-Knopf in der Booth: hört sich deinen Take (oder das Original) durch den eingestellten Effekt an, bevor du dich festlegst",
    "🖼 Editor: Profilbilder pro Rolle direkt hochladen, benennen und mit Vorschau sehen — werden automatisch auf 160px gebracht",
    "🎬 Neue Szene: Demon Slayer — Entertainment District Finale (6 Rollen, 116 Zeilen, 8:38)"
  ]},
  { v: "8.3", items: [
    "🌐 TURN-Server-Anbieter gewechselt: Metered (0,5 GB/Monat frei) → ExpressTurn (1 TB/Monat frei) — betrifft nur Verbindungen über restriktive Netzwerke, ändert am Spiel selbst nichts"
  ]},
  { v: "8.2", items: [
    "🎬 Drei neue Szenen: Dragon Ball Super — Broly Power Up (5 Rollen), Chainsaw Man — Reze & Denji im Café (3 Rollen), Jujutsu Kaisen — You Crying? (5 Rollen)",
    "🎭 13 neue Profilbilder"
  ]},
  { v: "8.1", items: [
    "🔥 Szene „Set Your Heart Ablaze“ war zwar hochgeladen, fehlte aber in der scenes.json — jetzt drin (37 Szenen)"
  ]},
  { v: "8.0", items: [
    "🎤 Fix: Der Mikrofon-Setup startete an einem Klick-Listener, der sich beim ERSTEN Klick irgendwo verbraucht hat — auch wenn dabei gar nichts passiert ist. Danach fragte der Browser nie wieder.",
    "🩺 Klare Fehlermeldungen statt Einheitstext: blockiert, kein Gerät gefunden, oder von Discord/OBS belegt — jeweils mit passender Anleitung"
  ]},
  { v: "7.9", items: [
    "🔥 Neue Szene: Demon Slayer — Set Your Heart Ablaze (Rengoku vs Akaza, 3 Rollen, 36 Zeilen)",
    "🎭 Zwei neue Profilbilder: Rengoku und Tanjiro"
  ]},
  { v: "7.8", items: [
    "🎬 Drei neue Szenen: Demon Slayer — Akaza, Douma & Gyokko im Infinity Castle (von Elias selbst gebaut!), Megamind — Presentation!, und Jujutsu Kaisen — Yo Satoru",
    "🎭 Acht neue Profilbilder: Douma, Gyokko, Akaza, Megamind, Hal, Gojo und Kenjaku"
  ]},
  { v: "7.7", items: [
    "⚡ Noten fallen jetzt fast 3x schneller (0,62 statt 1,7 Sekunden von oben bis zur Linie)",
    "🎯 Dafür deutlich weniger davon: 639 statt 961 — sie kleben nicht mehr aneinander, im Schnitt sind rund 2 gleichzeitig zu sehen",
    "🔀 Längste Serie auf einer Seite von 5 auf 3 runter, mit harter Grenze gegen monotone Blöcke",
    "🐛 Halte-Noten-Bug gefunden: sie verschwanden nach fest eingestellten 0,45 Sekunden — bei 0,9s Haltedauer also exakt auf halbem Weg. Jetzt bleiben sie bis zum Ende sichtbar."
  ]},
  { v: "7.6", items: [
    "🎵 Beat-Booth nochmal deutlich schneller: 961 statt 646 Noten (4,8 statt 3,2 pro Sekunde)",
    "🔀 Abwechslungsreichere Muster — 8 verschiedene Rhythmus-Figuren, die alle paar Takte wechseln und gespiegelt werden; längste Serie auf einer Seite jetzt 4 statt 5+",
    "🟢 Halte-Noten repariert: die Kugel bleibt jetzt sichtbar auf der Trefferlinie stehen statt zu verschwinden, mit grün leuchtendem Rand, Fortschrittsbalken und laufendem Funkenflug",
    "🔊 Trefferton statt Klick: kurz und weich, Tonhöhe richtet sich nach der Wertung"
  ]},
  { v: "7.5", items: [
    "🎵 Beat-Booth deutlich schneller: die Beat-Erkennung hatte nur jeden zweiten Schlag erwischt — jetzt 646 statt 355 Noten (3,2 statt 1,8 pro Sekunde)",
    "💥 Treffer knallen jetzt: Funken fliegen, die Spur blitzt auf, das Bild ruckelt kurz, ein Ring ploppt aus der Taste",
    "🌌 Neue Optik: Noten mit Leuchtschweif und Glanzlicht, Spuren mit Fluchtpunkt-Sog, Hintergrund pulsiert im Takt",
    "🏷️ Trefferanzeige springt größer und wuchtiger ins Bild"
  ]},
  { v: "7.4", items: [
    "🎵 Neues Rhythmus-Spiel „Beat-Booth“ im linken Panel — F für links, J für rechts, im Takt treffen",
    "🎯 Bewertung pro Note: Perfect / Good / OK / Miss, mit Combo-Bonus und Genauigkeit am Ende",
    "🟣 Halte-Noten: manche Noten müssen gedrückt gehalten werden",
    "🔇 Die Musik hört nur, wer selbst spielt — Lobby-Musik pausiert solange automatisch",
    "⏹ Bricht von selbst ab, sobald der Host startet oder es sonst weitergeht"
  ]},
  { v: "7.3", items: [
    "🎥 Kinosaal-Modus: Bei der Premiere fährt der ganze Saal runter — nur die Leinwand bleibt hell und bekommt einen Projektor-Schein",
    "🏆 Podium sind jetzt echte Körper statt flacher Rechtecke: gekippte Deckfläche, Bodenschatten, beleuchteter Siegersockel",
    "👋 Wenn jemand den Raum verlässt, sieht und hört man es jetzt — Einblendung mit Namen plus abfallender Ton",
    "🐛 Fix: Kritzel-Board flackerte beim Malen, weil der eigene laufende Strich bei jedem Neuaufbau kurz verschwand"
  ]},
  { v: "7.2", items: [
    "📊 Lebendiges VU-Meter im Kopfbereich — die LED-Kette folgt deinem Mikro in Echtzeit, mit nachlaufender Spitzenanzeige wie am echten Pult",
    "🎞️ Filmkorn und Vignette über allem — nimmt dem Bild das Sterile, alles wirkt analog statt frisch gerendert",
    "🎛️ Knöpfe sind jetzt echte Geräte-Taster: leicht erhaben, rasten beim Drücken spürbar ein",
    "🔶 Hauptknöpfe in gebürstetem Bernstein statt Farbverlauf"
  ]},
  { v: "7.1", items: [
    "🎛️ Komplettes Redesign — das Spiel sieht jetzt aus wie echtes Studio-Equipment statt wie eine Webseite",
    "🏷️ Überschriften sitzen auf Gaffer-Tape, so wie in echten Studios auf jedes Gerät geklebt wird",
    "🔤 Neue Schriften: Anton für Schlagzeilen (Kinoplakat-Wucht), Barlow für Fließtext, Space Mono für Zahlen & Beschriftungen",
    "🎨 Neue Farbwelt aus echtem Studio-Material: Flightcase-Anthrazit, Röhren-Bernstein, ON-AIR-Rot",
    "📻 Raumcode & Line-Zähler leuchten jetzt wie Geräte-Displays, Kopfzeile ist eine Rack-Blende mit Rändelschrauben",
    "🧰 Karten sind echte Flightcase-Panels mit Nieten, Metallkante und Bürstung — auch im Editor"
  ]},
  { v: "7.0", items: [
    "🔍 Neuer Selbst-Check: Knopf in den Host-Einstellungen prüft alle Szenen-Dateien auf einmal und listet dir kaputte Verweise auf — kein Rätselraten mehr bei „Video lädt nicht“",
    "✨ UI-Politur: eigene Scrollbalken, weicherer Fokus-Glow statt hartem Rahmen, einheitliche Regler & Dropdown-Pfeile, sanfte Screen-Übergänge, Fortschrittsbalken mit Glow"
  ]},
  { v: "6.9", items: [
    "🐛 Fix: Original-Audio spielte manchmal die Stimme der VORHERIGEN Szene ab (Voice-Track-Cache wurde beim direkten Laden über den Host-Dropdown und beim Duell-Start nicht zurückgesetzt)",
    "🎨 Kritzel-Board: feste Pixel-Maße statt verschachteltem Flexbox+Scroll — sollte das Verzerren/Nicht-Sehen bei manchen Browsern (Opera, Avast) beheben",
    "🥊 Duell-Modus: Host muss jetzt aktiv „Beide Versionen abspielen” klicken, startet nicht mehr automatisch; veraltete „X/Y geladen”-Anzeige vom normalen Modus wird ausgeblendet",
    "⏳ Kurze 3-Sekunden-Pause mit Countdown zwischen Duell-Take 1→2 und zwischen Match-Runden, statt direktem Sprung",
    "🏷️ Moduswechsel-Anzeige im Warteraum wird jetzt bei jedem Betreten frisch neu berechnet (gegen veraltete Labels)",
    "🌑 Podium-Finale: Erst wird's dunkel mit aufbauendem Trommelwirbel, dann schwingt der Scheinwerfer episch zur Enthüllung"
  ]},
  { v: "6.8", items: [
    "🐛 Fix: Wer neu dem Raum beitrat, bekam den bisherigen Kritzel-Board-Stand nie mitgeschickt — Leinwand sah leer aus, bis man selbst malte und dadurch (unabsichtlich) alles Vorherige lokal überschrieb",
    "🐛 Fix: Verzerrte/kaputte Striche, falls die Leinwand beim allerersten Klick noch nicht fertig gelayoutet war"
  ]},
  { v: "6.7", items: [
    "🐛 Fix: Seitenpanels waren beim allerersten Laden (Mikro-Screen) noch sichtbar — der Screen ist per HTML von Anfang an aktiv, bevor meine Sichtbarkeits-Logik überhaupt einmal lief"
  ]},
  { v: "6.6", items: [
    "🖼️ Seitenpanels erscheinen jetzt nur noch in Lobby & Warteraum (vorher fälschlich auch bei Mikro-Setup & Co.)",
    "📏 Kritzel-Board & Fun-Fact-Panel deutlich größer, werden bei Bedarf scrollbar",
    "🎬 Neue Szene: Jujutsu Kaisen — Maki vs Naoya mit Mai-Flashback (von dir selbst gebaut!)"
  ]},
  { v: "6.5", items: [
    "🖼️ Kritzel-Board zieht auf breiten Bildschirmen als festes Panel an den rechten Rand um (statt in der Karten-Spalte)",
    "💡 Neues linkes Seitenpanel mit rotierendem Fun-Fact-Ticker zum Ausgleich",
    "🎨 Nur noch ein gemeinsames Board statt zwei getrennter Kopien (Lobby + Warte-Screen)"
  ]},
  { v: "6.4", items: [
    "🎨 Kritzel-Board neu aufgeteilt: Werkzeugleiste links, größere Leinwand rechts",
    "🧽 Radiergummi ergänzt",
    "🌈 Doppelt so viele Farben (7 → 14)"
  ]},
  { v: "6.3", items: [
    "🎨 Kritzel-Board jetzt auch in der Lobby (vorher nur beim Warten nach der Aufnahme)",
    "🎬 Neue Szene: Star Wars — You Turned Her Against Me (Anakin & Obi-Wan)"
  ]},
  { v: "6.2", items: [
    "🎨 Neues Kritzel-Board in der Warte-Arena — alle malen live zusammen auf derselben Leinwand",
    "🐛 Fix: „Original anhören“ konnte bei langsamem Netzwerk verspätet die Stimme der VORHERIGEN Line abspielen, wenn man währenddessen zur nächsten weitergeklickt hat"
  ]},
  { v: "6.1", items: [
    "📋 Raumcode-Kopieren-Button in der Lobby",
    "🚪 Verlassen-Bestätigung als richtiges Modal statt Browser-Popup",
    "🎙 Mikro-Live-Anzeige neben deinem Namen in der Lobby (leuchtet, wenn Ton ankommt)",
    "🔊 Mehrere Effekte kräftiger gemacht (Telefon, Unter Wasser, Monster, Roboter u.a. — die waren zu schwach)",
    "🎭 Drei neue Effekte: Doppelgänger (Chorus), Nachschlag-Echo, Titan (sehr tiefe Stimme)"
  ]},
  { v: "6.0", items: [
    "🖼️ Hintergrund aufgewertet: dezente, unscharfe Charakterbilder aus unseren Szenen schweben jetzt mit den Farbpunkten"
  ]},
  { v: "5.9", items: ["✨ Profil-Accessoires: Katzenohren, Bärenohren, Kopfhörer, Krone, Heiligenschein & Teufelshörner — überlagern jedes Profilbild"] },
  { v: "5.8", items: [
    "🔇 Fix: Minigame-Sounds aus der Warte-Arena waren auch während der Booth-Aufnahme hörbar",
    "🎮 Zwei neue Warte-Arena-Spiele: Schnick-Schnack-Schnuck & Würfel-Duell",
    "🔦 Podium-Finale mit schwingendem Scheinwerfer über ~7 Sekunden bis zur Sieger-Enthüllung"
  ]},
  { v: "5.6", items: [
    "🐛 Fix: Duell-Modus zeigte nur das Ergebnis von wer zuerst fertig war, statt auf beide zu warten (match.mode wurde bei Mitspielern nie richtig übernommen)",
    "🎬 Cross-Origin-Fix fürs Video-Speichern ergänzt"
  ]},
  { v: "5.5", items: ["🎚 Noise Gate live nachjustierbar direkt in der Booth, wirkt sofort auch während laufender Aufnahme"] },
  { v: "5.3–5.4", items: ["🎬 Mehrere neue Szenen (Toji vs Gojo, Who Decided That, Backrooms Research, Death Note Potato Chip u.a.)", "🐛 Fix: „X/Y geladen“-Anzeige blieb hängen, wenn wer während des Ladens die Verbindung trennte"] },
  { v: "5.0–5.2", items: ["🥊 Neuer Duell-Modus: zwei Spieler sprechen dieselbe Rolle unabhängig ein, danach stimmt die Gruppe ab", "🎚 Eigene Effekt-Wahl pro Line beim Aufnehmen (überschreibt Szenen-Standard)", "🌊 Wellenform detaillierter (mehr Auflösung, Verlauf, Peak-Hold)"] },
  { v: "4.8–4.9", items: ["🌊 Dual-Waveform in der Booth: Original (lila) + eigene Stimme (blau) live überlagert", "🏆 Finale als echtes Podium (1./2./3. Platz) statt einfacher Liste", "⭐ Bewertungs-Screen optisch aufgewertet"] },
  { v: "4.7", items: ["✂️ Frame-genaues Timing im Editor, Wellenform-Vorschau beim Line-Setzen", "🔁 Einzelne Lines nachträglich neu einsprechen (Redo), ohne die ganze Szene zu wiederholen"] }
];
$("patchnotes-btn").onclick = () => {
  $("patchnotes-body").innerHTML = PATCH_NOTES.map(g => `
    <div>
      <div style="font-family:var(--font-display);color:var(--amber);margin-bottom:6px">v${g.v}</div>
      <ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px">${g.items.map(i => `<li>${i}</li>`).join("")}</ul>
    </div>`).join("");
  $("patchnotes-overlay").style.display = "flex";
};
$("patchnotes-close").onclick = () => $("patchnotes-overlay").style.display = "none";
$("patchnotes-overlay").onclick = e => { if (e.target.id === "patchnotes-overlay") $("patchnotes-overlay").style.display = "none"; };

// ═════════════════════════════════════════════════════════════
// MIKROFON — Einstellungen + Processing-Graph
// Aufnahmen laufen durch: Quelle → Brumm-Filter → Gain → recDest
// ═════════════════════════════════════════════════════════════
const micSettings = { deviceId: null, ns: true, ec: true, agc: true, lowcut: true, gain: 1, gate: 0.5 };
let micSrcNode = null, micHP = null, micGain = null, recDest = null, micGateNode = null, gateAn = null;
let vizAn = null, vizRAF = null;
let micReturnScreen = "scr-start";


// Läuft sofort, wenn die Seite schon fertig geladen ist — sonst greift ein
// DOMContentLoaded-Listener zu spät und das Feld bleibt leer.
function whenReady(fn) {
  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", fn);
  else fn();
}

// Name & Mikro-Einstellungen merken (bleibt im Browser gespeichert)
try {
  const savedName = localStorage.getItem("ss_name");
  if (savedName) whenReady(() => { $("in-name").value = savedName; });
  const savedMic = JSON.parse(localStorage.getItem("ss_mic") || "null");
  if (savedMic) Object.assign(micSettings, savedMic);
} catch {}
function saveName() { try { localStorage.setItem("ss_name", myName); } catch {} }
function saveMic() { try { localStorage.setItem("ss_mic", JSON.stringify(micSettings)); } catch {} }


// ═════════════════════════════════════════════════════════════
// PROFILBILD — Emoji oder Szenen-Charakter, frei wählbar, gespeichert
// ═════════════════════════════════════════════════════════════
const AVATAR_EMOJIS = ["😎","🔥","💀","🎭","🐻","🤖","👻","🦈","🐸","🎃","👑","🥷","🧛","🦊","🐵","⚡"];
const AVATAR_CHARS = [
  { img: "scenes/jackpot_konosuba/chris.png", label: "Chris" },
  { img: "scenes/jackpot_konosuba/kazuma.png", label: "Kazuma" },
  { img: "scenes/reze_fireworks/reze.png", label: "Reze" },
  { img: "scenes/reze_fireworks/denji.png", label: "Denji" },
  { img: "scenes/reze_fireworks/announcer.png", label: "Announcer" },
  { img: "scenes/angrygerman_urlaub/interviewer.png", label: "Interviewer" },
  { img: "scenes/angrygerman_urlaub/angrygermanguy.png", label: "Angry German Guy" },
  { img: "scenes/dexter/dexter.png", label: "Dexter" },
  { img: "scenes/dexter/doakes.png", label: "Doakes" },
  { img: "scenes/dexter/random_dude.png", label: "Random Dude" },
  { img: "scenes/spongebob/spongebob.png", label: "Spongebob" },
  { img: "scenes/spongebob/patrick.png", label: "Patrick" },
  { img: "scenes/bigsmoke/big_smoke.png", label: "Big Smoke" },
  { img: "scenes/bigsmoke/cj.png", label: "CJ" },
  { img: "scenes/bigsmoke/sweet.png", label: "Sweet" },
  { img: "scenes/invincible/debbie.png", label: "Debbie" },
  { img: "scenes/invincible/mark.png", label: "Mark" },
  { img: "scenes/invincible/nolan.png", label: "Nolan" },
  { img: "scenes/backroomsdinner/clark.png", label: "Clark" },
  { img: "scenes/backroomsdinner/mary.png", label: "Mary" },
  { img: "scenes/jjkdomain/ryo.png", label: "Ryo" },
  { img: "scenes/jjkdomain/narrator.png", label: "Narrator" },
  { img: "scenes/jjkdomain/uro.png", label: "Uro" },
  { img: "scenes/jjkdomain/yuta.png", label: "Yuta" },
  { img: "scenes/jjkdomain/rika.png", label: "Rika" },
  { img: "scenes/jjkdomain/kurourushi.png", label: "Kurourushi" },
  { img: "scenes/breakingbad/tuco.png", label: "Tuco" },
  { img: "scenes/breakingbad/heisenberg.png", label: "Heisenberg" },
  { img: "scenes/breakingbad/otherguy.png", label: "Anderer Typ" },
  { img: "scenes/strongest/geto.png", label: "Geto" },
  { img: "scenes/strongest/gojo.png", label: "Gojo" },
  { img: "scenes/aibubble/deku.png", label: "Deku" },
  { img: "scenes/aibubble/tungtung.png", label: "Tung Tung" },
  { img: "scenes/chickenjockey/steve.png", label: "Steve" },
  { img: "scenes/chickenjockey/garret.png", label: "Garret" },
  { img: "scenes/chickenjockey/jockey.png", label: "Chicken Jockey" },
  { img: "scenes/tojigojo/toji.png", label: "Toji" },
  { img: "scenes/gokussj/goku.png", label: "Son Goku" },
  { img: "scenes/gokussj/freezer.png", label: "Freezer" },
  { img: "scenes/gokussj/gohan.png", label: "Son Gohan" },
  { img: "scenes/mayonnaise/thaddaeus.png", label: "Thaddäus" },
  { img: "scenes/mayonnaise/sandy.png", label: "Sandy" },
  { img: "scenes/mayonnaise/krabs.png", label: "Mr. Krabs" },
  { img: "scenes/mayonnaise/plankton.png", label: "Plankton" },
  { img: "scenes/mayonnaise/larry.png", label: "Larry der Hummer" },
  { img: "scenes/supersuit/frozone.png", label: "Frozone" },
  { img: "scenes/supersuit/honey.png", label: "Honey" },
  { img: "scenes/tojidomain/nanami.png", label: "Nanami" },
  { img: "scenes/tojidomain/maki.png", label: "Maki" },
  { img: "scenes/tojidomain/dagon.png", label: "Dagon" },
  { img: "scenes/edgerunnerscar/maine.png", label: "Maine" },
  { img: "scenes/edgerunnerscar/kiwi.png", label: "Kiwi" },
  { img: "scenes/edgerunnerscar/rebecca.png", label: "Rebecca" },
  { img: "scenes/edgerunnerscar/david.png", label: "David" },
  { img: "scenes/edgerunnerscar/lucy.png", label: "Lucy" },
  { img: "scenes/edgerunnerscar/wachmann.png", label: "Wachmann" },
  { img: "scenes/allmightnomu/allmight.png", label: "All Might" },
  { img: "scenes/allmightnomu/shigaraki.png", label: "Shigaraki" },
  { img: "scenes/allmightnomu/kirishima.png", label: "Kirishima" },
  { img: "scenes/allmightnomu/nomu.png", label: "Nomu" },
  { img: "scenes/allmightnomu/kurogiri.png", label: "Kurogiri" },
  { img: "scenes/allmightnomu/tokoyami.png", label: "Tokoyami" },
  { img: "scenes/allmightnomu/ojiro.png", label: "Ojiro" },
  { img: "scenes/aottraitor/reiner.png", label: "Reiner" },
  { img: "scenes/aottraitor/eren.png", label: "Eren" },
  { img: "scenes/aottraitor/bertolt.png", label: "Bertolt" },
  { img: "scenes/aottraitor/mikasa.png", label: "Mikasa" },
  { img: "scenes/aottraitor/armin.png", label: "Armin" },
  { img: "scenes/aottraitor/historia.png", label: "Historia" },
  { img: "scenes/silentvoice/shouya.png", label: "Shouya" },
  { img: "scenes/silentvoice/mutter.png", label: "Mutter (Silent Voice)" },
  { img: "scenes/higurumatrial/higuruma.png", label: "Higuruma" },
  { img: "scenes/higurumatrial/yuji.png", label: "Yuji" },
  { img: "scenes/higurumatrial/judgeman.png", label: "Judgeman" },
  { img: "scenes/higurumatrial/tengen.png", label: "Tengen" },
  { img: "scenes/harrycedric/harry.png", label: "Harry" },
  { img: "scenes/harrycedric/dumbledore.png", label: "Dumbledore" },
  { img: "scenes/harrycedric/molly.png", label: "Molly" },
  { img: "scenes/harrycedric/amos.png", label: "Amos Diggory" },
  { img: "scenes/todoflash/todo.png", label: "Todo" },
  { img: "scenes/todoflash/takada.png", label: "Takada" },
  { img: "scenes/bubblemsg/spongebob.png", label: "SpongeBob (Blasen)" },
  { img: "scenes/bubblemsg/thaddaeus.png", label: "Thaddäus (Blasen)" },
  { img: "scenes/fukashigi/mai.png", label: "Mai" },
  { img: "scenes/fukashigi/koga.png", label: "Koga" },
  { img: "scenes/fukashigi/futaba.png", label: "Futaba" },
  { img: "scenes/fukashigi/kaede.png", label: "Kaede" },
  { img: "scenes/fukashigi/shoko.png", label: "Shoko" },
  { img: "scenes/fukashigi/nodoka.png", label: "Nodoka" },
  { img: "scenes/noderrr/wingo.png", label: "Wingo" },
  { img: "scenes/noderrr/boost.png", label: "Boost" },
  { img: "scenes/noderrr/dj.png", label: "DJ" },
  { img: "scenes/noderrr/mack.png", label: "Mack" },
  { img: "scenes/noderrr/snotrod.png", label: "Snot Rod" },
  { img: "scenes/zenitsukaigaku/zenitsu.png", label: "Zenitsu" },
  { img: "scenes/zenitsukaigaku/kaigaku.png", label: "Kaigaku" },
  { img: "scenes/zenitsukaigaku/kokushibo.png", label: "Kokushibo" },
  { img: "scenes/zenitsukaigaku/jigoro.png", label: "Jigoro" },
  { img: "scenes/zenitsukaigaku/yushiro.png", label: "Yushiro" },
  { img: "scenes/tojigojo/gojo.png", label: "Gojo (Toji-Kampf)" },
  { img: "scenes/whodecided/escanor.png", label: "Escanor" },
  { img: "scenes/whodecided/estarossa.png", label: "Estarossa" },
  { img: "scenes/whodecided/zeldris.png", label: "Zeldris" },
  { img: "scenes/marriedcouple/shiori.png", label: "Shiori" },
  { img: "scenes/marriedcouple/jiro.png", label: "Jiro" },
  { img: "scenes/potatochip/light.png", label: "Light" },
  { img: "scenes/potatochip/ryuk.png", label: "Ryuk" },
  { img: "scenes/brresearch/bobby.png", label: "Bobby" },
  { img: "scenes/brresearch/clark.png", label: "Clark (Research)" },
  { img: "scenes/brresearch/kat.png", label: "Kat" },
  { img: "scenes/notmywallet/manray.png", label: "Man Ray" },
  { img: "scenes/turnedagainstme/anakin.png", label: "Anakin" },
  { img: "scenes/turnedagainstme/obiwan.png", label: "Obi-Wan" },
  { img: "scenes/makinaoyamai/naoya.png", label: "Naoya" },
  { img: "scenes/makinaoyamai/maki.png", label: "Maki" },
  { img: "scenes/makinaoyamai/mai.png", label: "Mai" },
  { img: "scenes/akazagyokodoumaszenevideo/douma.png", label: "Douma" },
  { img: "scenes/akazagyokodoumaszenevideo/gyokko.png", label: "Gyokko" },
  { img: "scenes/akazagyokodoumaszenevideo/akaza.png", label: "Akaza" },
  { img: "scenes/megamind/megamind.png", label: "Megamind" },
  { img: "scenes/megamind/hal.png", label: "Hal" },
  { img: "scenes/yosatarou/gojo.png", label: "Gojo (Yo Satoru)" },
  { img: "scenes/yosatarou/kenjaku.png", label: "Kenjaku" },
  { img: "scenes/yosatarou/mahito.png", label: "Mahito" },
  { img: "scenes/yosatarou/jogo.png", label: "Jogo" },
  { img: "scenes/yosatarou/choso.png", label: "Choso" },
  { img: "scenes/ablaze/rengoku.png", label: "Rengoku" },
  { img: "scenes/ablaze/tanjiro.png", label: "Tanjiro" },
  { img: "scenes/broly/goku.png", label: "Goku" },
  { img: "scenes/broly/broly.png", label: "Broly" },
  { img: "scenes/broly/paragus.png", label: "Paragus" },
  { img: "scenes/broly/frieza.png", label: "Frieza" },
  { img: "scenes/broly/krillin.png", label: "Krillin" },
  { img: "scenes/reze/reze.png", label: "Reze" },
  { img: "scenes/reze/cafeowner.png", label: "Café-Chef" },
  { img: "scenes/reze/denji.png", label: "Denji" },
  { img: "scenes/crying/gojo.png", label: "Gojo (Crying)" },
  { img: "scenes/crying/utahime.png", label: "Utahime" },
  { img: "scenes/crying/meimei.png", label: "Mei Mei" },
  { img: "scenes/crying/geto.png", label: "Geto" },
  { img: "scenes/crying/shoko.png", label: "Shoko" },
  { img: "scenes/ijlsa/narrator.png", label: "Erzähler (IJL)" },
  { img: "scenes/ijlsa/quickster.png", label: "Quickster" },
  { img: "scenes/ijlsa/captain_magma.png", label: "Captain Magma" },
  { img: "scenes/ijlsa/elastic_waistband.png", label: "Elastic Waistband" },
  { img: "scenes/ijlsa/miss_appear.png", label: "Miss Appear" },
  { img: "scenes/bubblemsg/patrick.png", label: "Patrick (Blasen)" },
  { img: "scenes/higurumaretrial/judge.png", label: "Random Judge" },
  { img: "scenes/higurumaretrial/higuruma.png", label: "Higuruma (Retrial)" },
  { img: "scenes/higurumaretrial/shimizu.png", label: "Shimizu" },
  { img: "scenes/hashirasmeetmuzan/sanemi.png", label: "Sanemi" },
  { img: "scenes/hashirasmeetmuzan/shinobu.png", label: "Shinobu" },
  { img: "scenes/hashirasmeetmuzan/muichiro.png", label: "Muichiro" },
  { img: "scenes/hashirasmeetmuzan/mitsuri.png", label: "Mitsuri" },
  { img: "scenes/hashirasmeetmuzan/obanai.png", label: "Obanai" },
  { img: "scenes/hashirasmeetmuzan/giyu.png", label: "Giyu" },
  { img: "scenes/hashirasmeetmuzan/gyomei.png", label: "Gyomei" },
  { img: "scenes/hashirasmeetmuzan/tanjiro.png", label: "Tanjiro (Hashira)" },
  { img: "scenes/hashirasmeetmuzan/muzan.png", label: "Muzan" },
  { img: "scenes/ghostrabbit/satsuki.png", label: "Satsuki" },
  { img: "scenes/ghostrabbit/mio.png", label: "Mio" },
  { img: "scenes/ghostrabbit/rabbit.png", label: "Rabbit (Ghost Stories)" },
  { img: "scenes/nwhorganic/andrew.png", label: "Andrew Spidey" },
  { img: "scenes/nwhorganic/ned.png", label: "Ned (NWH)" },
  { img: "scenes/nwhorganic/tom.png", label: "Tom Spidey" },
  { img: "scenes/nwhorganic/tobey.png", label: "Tobey Spidey" },
  { img: "scenes/sbmenacing/patrick.png", label: "Patrick (Menacing)" },
  { img: "scenes/sbmenacing/spongebob.png", label: "SpongeBob (Menacing)" },
  { img: "scenes/kawaimarin/marin1.png", label: "Marin 1" },
  { img: "scenes/kawaimarin/marin2.png", label: "Marin 2" },
  { img: "scenes/kawaimarin/marin3.png", label: "Marin 3" },
  { img: "scenes/kawaimarin/marin4.png", label: "Marin 4" },
  { img: "scenes/yutaryu/yuta.png", label: "Yuta (vs Ryu)" },
  { img: "scenes/yutaryu/ryu.png", label: "Ryu" },
  { img: "scenes/yutaryu/tengen.png", label: "Tengen (vs Ryu)" },
  { img: "scenes/yutaryu/rika.png", label: "Rika (vs Ryu)" },
  { img: "scenes/opensesame/patrick.png", label: "Patrick (Open Sesame)" },
  { img: "scenes/opensesame/spongebob.png", label: "SpongeBob (Open Sesame)" },
  { img: "scenes/interstellarstay/cooper.png", label: "Cooper" },
  { img: "scenes/interstellarstay/murph.png", label: "Murph" },
  { img: "scenes/interstellarstay/tars.png", label: "TARS" },
  { img: "scenes/girlscantlove/madoka.png", label: "Madoka" },
  { img: "scenes/girlscantlove/hitomi.png", label: "Hitomi" },
  { img: "scenes/girlscantlove/sayaka.png", label: "Sayaka" },
  { img: "scenes/girlscantlove/kyubey.png", label: "Kyubey" },
  { img: "scenes/towelieremembers/towelie.png", label: "Towelie" },
  { img: "scenes/towelieremembers/stan.png", label: "Stan" },
  { img: "scenes/towelieremembers/cartman.png", label: "Cartman" },
  { img: "scenes/towelieremembers/kyle.png", label: "Kyle" },
  { img: "scenes/ghostchase/hajime.png", label: "Hajime" },
  { img: "scenes/ghostchase/keiichirou.png", label: "Keiichirou" },
  { img: "scenes/ghostchase/leo.png", label: "Leo (Ghost Stories)" },
  { img: "scenes/muffinman/gingerbread_man.png", label: "Lebkuchenmann" },
  { img: "scenes/muffinman/lord_farquaad.png", label: "Lord Farquaad" },
  { img: "scenes/muffinman/guard.png", label: "Wache (Shrek)" },
  { img: "scenes/muffinman/mirror.png", label: "Zauberspiegel" },
  { img: "scenes/muffinman/thelonius.png", label: "Thelonius" },
  { img: "scenes/krustydog/spongebob.png", label: "SpongeBob (Krusty Dog)" },
  { img: "scenes/krustydog/mr_krabs.png", label: "Mr. Krabs (Krusty Dog)" },
  { img: "scenes/krustydog/squidward.png", label: "Squidward (Krusty Dog)" },
  { img: "scenes/krustydog/guest_1.png", label: "Gast 1 (Krusty Dog)" },
  { img: "scenes/krustydog/guest_2.png", label: "Gast 2 (Krusty Dog)" },
  { img: "scenes/krustydog/guest_3.png", label: "Gast 3 (Krusty Dog)" },
  { img: "scenes/seabear/squidward.png", label: "Squidward (Sea Bear)" },
  { img: "scenes/seabear/spongebob.png", label: "SpongeBob (Sea Bear)" },
  { img: "scenes/seabear/patrick.png", label: "Patrick (Sea Bear)" },
  { img: "scenes/seabear/fish_bear.png", label: "Sea Bear" },
  { img: "scenes/classroomelite/ayanokoji.png", label: "Ayanokoji" },
  { img: "scenes/classroomelite/manabu.png", label: "Manabu" },
  { img: "scenes/classroomelite/suzune.png", label: "Suzune" },
  { img: "scenes/shinjiconfession/shinji.png", label: "Shinji" },
  { img: "scenes/shinjiconfession/rei.png", label: "Rei" },
  { img: "scenes/yeeyee/lamar.png", label: "Lamar" },
  { img: "scenes/yeeyee/franklin.png", label: "Franklin" },
  { img: "scenes/ishowspeedgod/speed.png", label: "IShowSpeed" },
  { img: "scenes/ishowspeedgod/ben.png", label: "Ben" },
  { img: "scenes/sukunashibuya/jogo.png", label: "Jogo" },
  { img: "scenes/sukunashibuya/mimiko_nanako.png", label: "Mimiko & Nanako" },
  { img: "scenes/sukunashibuya/sukuna.png", label: "Sukuna" },
  { img: "scenes/yujitodohanami/yuji.png", label: "Yuji (vs Hanami)" },
  { img: "scenes/yujitodohanami/todo.png", label: "Todo (vs Hanami)" },
  { img: "scenes/yujitodohanami/hanami.png", label: "Hanami" },
  { img: "scenes/yujitodohanami/juzo.png", label: "Juzo" },
  { img: "scenes/yujitodohanami/gojo.png", label: "Gojo (vs Hanami)" },
  { img: "scenes/ichigovsbayakuya/ichigo.png", label: "Ichigo" },
  { img: "scenes/ichigovsbayakuya/byakuya.png", label: "Byakuya" },
  { img: "scenes/ichigovsbayakuya/orihime.png", label: "Orihime" },
  { img: "scenes/ichigovsbayakuya/uryu.png", label: "Uryu" },
  { img: "scenes/the_quintessential_quintuplets/ichika.png", label: "Ichika" },
  { img: "scenes/the_quintessential_quintuplets/nino.png", label: "Nino" },
  { img: "scenes/the_quintessential_quintuplets/miku.png", label: "Miku" },
  { img: "scenes/the_quintessential_quintuplets/yotsuba.png", label: "Yotsuba" },
  { img: "scenes/the_quintessential_quintuplets/itsuki.png", label: "Itsuki" },
  { img: "scenes/yourname/taki.png", label: "Taki" },
  { img: "scenes/yourname/mitsuha.png", label: "Mitsuha" },
  { img: "scenes/profiles/kayleen.png", label: "Kayleen" },
  { img: "scenes/profiles/kayleen2.png", label: "Kayleen 2" },
  { img: "scenes/profiles/kenny1.png", label: "Kenny 1" },
  { img: "scenes/profiles/kenny2.png", label: "Kenny 2" },
  { img: "scenes/profiles/kenny3.png", label: "Kenny 3" },
  { img: "scenes/ghostpajamas/keiichirou.png", label: "Keiichirou (Gay Pajamas)" },
  { img: "scenes/ghostpajamas/satsuki.png", label: "Satsuki (Gay Pajamas)" },
  { img: "scenes/ghostitch/satsuki.png", label: "Satsuki (Itch)" },
  { img: "scenes/ghostitch/keiichirou.png", label: "Keiichirou (Itch)" },
  { img: "scenes/ghostadopted/satsuki.png", label: "Satsuki (Adopted)" },
  { img: "scenes/ghostadopted/keiichirou.png", label: "Keiichirou (Adopted)" },
  { img: "scenes/ghostadopted/kaya.png", label: "Kaya (Ghost Stories)" },
  { img: "scenes/tokyokanekijason/rize.png", label: "Rize" },
  { img: "scenes/tokyokanekijason/jason.png", label: "Jason (Tokyo Ghoul)" },
  { img: "scenes/tokyokanekijason/kaneki.png", label: "Kaneki" },
  { img: "scenes/girlyteengirl/pearl.png", label: "Pearl (Girly Teengirl)" },
  { img: "scenes/girlyteengirl/girly_teengirl.png", label: "Girly Teengirl" },
  { img: "scenes/girlyteengirl/mr_krabs.png", label: "Mr. Krabs (Girly Teengirl)" },
  { img: "scenes/girlyteengirl/spongebob.png", label: "SpongeBob (Girly Teengirl)" },
  { img: "scenes/velocidad/kid_1.png", label: "Kid 1 (Homeless Meme)" },
  { img: "scenes/velocidad/kid_2.png", label: "Kid 2 (Homeless Meme)" },
  { img: "scenes/ghostweight/hajime.png", label: "Hajime (Lose Weight)" },
  { img: "scenes/ghostweight/satsuki.png", label: "Satsuki (Lose Weight)" },
  { img: "scenes/ghostweight/music_teacher.png", label: "Music Teacher" },
  { img: "scenes/iamkira/naomi.png", label: "Naomi Misora" },
  { img: "scenes/iamkira/light.png", label: "Light Yagami" },
  { img: "scenes/megapunk/roxanne.png", label: "Roxanne" },
  { img: "scenes/megapunk/tighten.png", label: "Tighten" },
  { img: "scenes/megapunk/metroman.png", label: "Metroman" },
  { img: "scenes/megapunk/megamind.png", label: "Megamind (Punk)" },
  { img: "scenes/megapunk/minion.png", label: "Minion" },
  { img: "scenes/dxdasia/issei.png", label: "Issei" },
  { img: "scenes/dxdasia/asia.png", label: "Asia" },
  { img: "scenes/dxdasia/rias.png", label: "Rias" },
  { img: "scenes/dxdasia/isseis_dad.png", label: "Issei's Dad" },
  { img: "scenes/dxdasia/isseis_mom.png", label: "Issei's Mom" },
  { img: "scenes/ghostseven/keiichirou.png", label: "Keiichirou (Let's See Seven)" },
  { img: "scenes/ghostseven/satsuki.png", label: "Satsuki (Let's See Seven)" },
  { img: "scenes/sagwallah/kandidat.png", label: "Kandidat" },
  { img: "scenes/sagwallah/trymacs.png", label: "Trymacs" },
  { img: "scenes/sukunamahoraga/megumi.png", label: "Megumi (vs Mahoraga)" },
  { img: "scenes/sukunamahoraga/haruta.png", label: "Haruta (vs Mahoraga)" },
  { img: "scenes/sukunamahoraga/mahoraga.png", label: "Mahoraga (vs Mahoraga)" },
  { img: "scenes/sukunamahoraga/sukuna.png", label: "Sukuna (vs Mahoraga)" },
  { img: "scenes/tedsam/ted.png", label: "Ted" },
  { img: "scenes/tedsam/sam.png", label: "Sam" },
  { img: "scenes/sukunajogo1/sukuna.png", label: "Sukuna (vs Jogo PT1)" },
  { img: "scenes/sukunajogo1/jogo.png", label: "Jogo (vs Jogo PT1)" },
  { img: "scenes/sukunajogo1/geto.png", label: "Geto (vs Jogo PT1)" },
  { img: "scenes/demonslayerakaza/tanjiro.png", label: "Tanjiro" },
  { img: "scenes/demonslayerakaza/giyu.png", label: "Giyu" },
  { img: "scenes/demonslayerakaza/akaza.png", label: "Akaza" },
  { img: "scenes/demonslayertransparent/tanjiro.png", label: "Tanjiro (Transparent World)" },
  { img: "scenes/demonslayertransparent/giyu.png", label: "Giyu (Transparent World)" },
  { img: "scenes/demonslayertransparent/akaza.png", label: "Akaza (Transparent World)" },
  { img: "scenes/milesprowler/miles.png", label: "Miles Morales" },
  { img: "scenes/milesprowler/prowler.png", label: "Prowler" },
  { img: "scenes/chainsawyeehaw/denji.png", label: "Denji" },
  { img: "scenes/chainsawyeehaw/beam.png", label: "Beam" },
  { img: "scenes/chainsawyeehaw/angel.png", label: "Angel (Chainsaw Man)" },
  { img: "scenes/kenjasoncount/ken.png", label: "Ken (Count Scene)" },
  { img: "scenes/kenjasoncount/jason.png", label: "Jason (Count Scene)" },
  { img: "scenes/sukunajogo3/sukuna.png", label: "Sukuna (vs Jogo PT3)" },
  { img: "scenes/sukunajogo3/jogo.png", label: "Jogo (vs Sukuna PT3)" },
  { img: "scenes/sasukenarutofinal/naruto.png", label: "Naruto (Final Fight)" },
  { img: "scenes/sasukenarutofinal/sasuke.png", label: "Sasuke (Final Fight)" },
  { img: "scenes/gojodeath/sukuna.png", label: "Sukuna (Gojo Death)" },
  { img: "scenes/gojodeath/yuji.png", label: "Yuji (Gojo Death)" },
  { img: "scenes/gojodeath/gojo.png", label: "Gojo (Death)" },
  { img: "scenes/sbgeisterpiraten/kind.png", label: "Kind (Geisterpiraten)" },
  { img: "scenes/sbgeisterpiraten/derfliegendehollaender.png", label: "Fliegender Holländer" },
  { img: "scenes/sbgeisterpiraten/patrick.png", label: "Patrick (Geisterpiraten)" },
  { img: "scenes/sbgeisterpiraten/spongebob.png", label: "Spongebob (Geisterpiraten)" },
  { img: "scenes/sbzerhacker/gruenerguy.png", label: "Grüner Guy" },
  { img: "scenes/sbzerhacker/thaddeus.png", label: "Thaddeus (Zerhacker)" },
  { img: "scenes/sbzerhacker/spongebob.png", label: "Spongebob (Zerhacker)" },
  { img: "scenes/akazafullfight/akaza.png", label: "Akaza (FULL FIGHT)" },
  { img: "scenes/akazafullfight/giyu.png", label: "Giyu (FULL FIGHT)" },
  { img: "scenes/akazafullfight/tanjiro.png", label: "Tanjiro (FULL FIGHT)" },
  { img: "scenes/akazafullfight/keizo.png", label: "Keizo" },
  { img: "scenes/akazafullfight/tanjirosdad.png", label: "Tanjiro's Dad" },
];
// ── Schwebende Hintergrund-Punkte: Mix aus Farbverlauf-Kreisen und ganz dezenten Charakterbildern aus unseren Szenen ──
(function buildFloaties() {
  const f = document.getElementById("floaties");
  if (!f) return;
  const pool = [...AVATAR_CHARS].sort(() => Math.random() - 0.5).slice(0, 8);
  const TOTAL = 15;
  for (let i = 0; i < TOTAL; i++) {
    const s = document.createElement("span");
    const useImg = i % 2 === 0 && pool.length;   // jede zweite ein Bild, Rest bleibt schlichter Farbpunkt
    if (useImg) {
      const c = pool[(i / 2) % pool.length | 0];
      s.className = "img-orb";
      s.style.backgroundImage = `url('${c.img}')`;
      const sz = 26 + Math.random() * 24;
      s.style.width = s.style.height = sz + "px";
    } else {
      const sz = 6 + Math.random() * 26;
      s.style.width = s.style.height = sz + "px";
    }
    s.style.left = Math.random() * 100 + "%";
    s.style.animationDuration = (14 + Math.random() * 18) + "s";
    s.style.animationDelay = (-Math.random() * 24) + "s";
    f.appendChild(s);
  }
})();
let myAvatar = null;
try { const a = localStorage.getItem("ss_avatar"); if (a) myAvatar = JSON.parse(a); } catch {}
// Ein gespeichertes Charakterbild kann auf eine Datei zeigen, die es nicht mehr gibt
// (Szene entfernt oder umbenannt) — sonst schleppt man ein kaputtes Bild dauerhaft mit.
if (myAvatar && myAvatar.img && !AVATAR_CHARS.some(c => c.img === myAvatar.img)) {
  myAvatar = null;
  try { localStorage.removeItem("ss_avatar"); } catch {}
}

// ── Profil-Accessoires: selbst gezeichnete SVGs, überlagern den Avatar (kein externes Bildmaterial nötig) ──
const ACCESSORIES = {
  catears: { label: "🐱 Katzenohren", svg: `<svg viewBox="0 0 100 60" style="position:absolute;top:-28%;left:0;width:100%;height:70%;overflow:visible">
    <path d="M8,42 L20,4 L34,34 Z" fill="#3a3a46" stroke="#1a1a22" stroke-width="2"/>
    <path d="M66,34 L80,4 L92,42 Z" fill="#3a3a46" stroke="#1a1a22" stroke-width="2"/>
    <path d="M13,36 L21,14 L29,30 Z" fill="#f691b3"/>
    <path d="M71,30 L79,14 L87,36 Z" fill="#f691b3"/>
  </svg>` },
  bearears: { label: "🐻 Bärenohren", svg: `<svg viewBox="0 0 100 60" style="position:absolute;top:-26%;left:0;width:100%;height:65%;overflow:visible">
    <circle cx="20" cy="20" r="16" fill="#8a5a3c" stroke="#5c3a24" stroke-width="2"/>
    <circle cx="80" cy="20" r="16" fill="#8a5a3c" stroke="#5c3a24" stroke-width="2"/>
    <circle cx="20" cy="20" r="8" fill="#e8c9a8"/>
    <circle cx="80" cy="20" r="8" fill="#e8c9a8"/>
  </svg>` },
  bunny: { label: "🐰 Hasenohren", svg: `<svg viewBox="0 0 100 70" style="position:absolute;top:-42%;left:0;width:100%;height:80%;overflow:visible">
    <ellipse cx="28" cy="28" rx="11" ry="28" fill="#f0e6da" stroke="#c4b5a4" stroke-width="2" transform="rotate(-18 28 28)"/>
    <ellipse cx="72" cy="28" rx="11" ry="28" fill="#f0e6da" stroke="#c4b5a4" stroke-width="2" transform="rotate(18 72 28)"/>
    <ellipse cx="28" cy="30" rx="5" ry="16" fill="#f691b3" transform="rotate(-18 28 30)"/>
    <ellipse cx="72" cy="30" rx="5" ry="16" fill="#f691b3" transform="rotate(18 72 30)"/>
  </svg>` },
  headphones: { label: "🎧 Kopfhörer", svg: `<svg viewBox="0 0 100 100" style="position:absolute;top:-14%;left:0;width:100%;height:100%;overflow:visible">
    <path d="M14,52 A36,36 0 0 1 86,52" fill="none" stroke="#e0e0e8" stroke-width="7" stroke-linecap="round"/>
    <rect x="6" y="46" width="16" height="26" rx="7" fill="#c9483a" stroke="#7a1f16" stroke-width="2"/>
    <rect x="78" y="46" width="16" height="26" rx="7" fill="#c9483a" stroke="#7a1f16" stroke-width="2"/>
  </svg>` },
  sunglasses: { label: "🕶 Sonnenbrille", svg: `<svg viewBox="0 0 100 40" style="position:absolute;top:28%;left:0;width:100%;height:40%;overflow:visible">
    <path d="M8,18 H92" stroke="#1a1a22" stroke-width="3"/>
    <rect x="12" y="8" width="30" height="22" rx="6" fill="#1a1a22" stroke="#f0a830" stroke-width="2"/>
    <rect x="58" y="8" width="30" height="22" rx="6" fill="#1a1a22" stroke="#f0a830" stroke-width="2"/>
    <path d="M42,18 H58" stroke="#1a1a22" stroke-width="3"/>
  </svg>` },
  glasses: { label: "🤓 Brille", svg: `<svg viewBox="0 0 100 40" style="position:absolute;top:28%;left:0;width:100%;height:40%;overflow:visible">
    <circle cx="28" cy="20" r="14" fill="none" stroke="#c8c8d0" stroke-width="3.5"/>
    <circle cx="72" cy="20" r="14" fill="none" stroke="#c8c8d0" stroke-width="3.5"/>
    <path d="M42,20 H58" stroke="#c8c8d0" stroke-width="3"/>
    <path d="M14,18 L4,12" stroke="#c8c8d0" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M86,18 L96,12" stroke="#c8c8d0" stroke-width="2.5" stroke-linecap="round"/>
  </svg>` },
  monocle: { label: "🧐 Monokel", svg: `<svg viewBox="0 0 100 50" style="position:absolute;top:22%;left:0;width:100%;height:50%;overflow:visible">
    <circle cx="68" cy="22" r="16" fill="none" stroke="#f0a830" stroke-width="3.5"/>
    <circle cx="68" cy="22" r="11" fill="rgba(200,220,255,.18)"/>
    <path d="M68,38 Q55,55 48,58" fill="none" stroke="#f0a830" stroke-width="2" stroke-dasharray="3 2"/>
  </svg>` },
  crown: { label: "👑 Krone", svg: `<svg viewBox="0 0 100 60" style="position:absolute;top:-34%;left:0;width:100%;height:55%;overflow:visible">
    <path d="M10,50 L10,26 L30,40 L50,14 L70,40 L90,26 L90,50 Z" fill="#ffc95c" stroke="#a87a1a" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="50" cy="12" r="5" fill="#ff6b6b"/>
  </svg>` },
  party: { label: "🎉 Partyhut", svg: `<svg viewBox="0 0 100 70" style="position:absolute;top:-40%;left:0;width:100%;height:70%;overflow:visible">
    <path d="M28,58 L50,6 L72,58 Z" fill="#e63946" stroke="#8a1a22" stroke-width="2"/>
    <path d="M34,58 L50,18 L66,58 Z" fill="#f0a830"/>
    <circle cx="50" cy="8" r="6" fill="#5fe3a1"/>
    <circle cx="38" cy="40" r="3" fill="#fff"/>
    <circle cx="58" cy="34" r="2.5" fill="#fff"/>
  </svg>` },
  beanie: { label: "🧢 Mütze", svg: `<svg viewBox="0 0 100 55" style="position:absolute;top:-30%;left:0;width:100%;height:60%;overflow:visible">
    <ellipse cx="50" cy="38" rx="38" ry="14" fill="#3d6ea8" stroke="#244a78" stroke-width="2"/>
    <path d="M14,38 Q20,8 50,6 Q80,8 86,38" fill="#4a82c4" stroke="#244a78" stroke-width="2"/>
    <circle cx="50" cy="8" r="5" fill="#e63946"/>
  </svg>` },
  wizard: { label: "🧙 Zauberhut", svg: `<svg viewBox="0 0 100 80" style="position:absolute;top:-48%;left:0;width:100%;height:80%;overflow:visible">
    <ellipse cx="50" cy="62" rx="36" ry="10" fill="#2a2a38" stroke="#15151e" stroke-width="2"/>
    <path d="M22,58 L50,4 L78,58 Z" fill="#3a3a4e" stroke="#15151e" stroke-width="2"/>
    <path d="M38,40 L62,40" stroke="#f0a830" stroke-width="3"/>
    <circle cx="52" cy="22" r="2.5" fill="#ffe38a"/>
    <circle cx="42" cy="30" r="1.8" fill="#ffe38a"/>
  </svg>` },
  halo: { label: "😇 Heiligenschein", svg: `<svg viewBox="0 0 100 40" style="position:absolute;top:-38%;left:0;width:100%;height:40%;overflow:visible">
    <ellipse cx="50" cy="20" rx="26" ry="9" fill="none" stroke="#ffe38a" stroke-width="6"/>
  </svg>` },
  horns: { label: "😈 Teufelshörner", svg: `<svg viewBox="0 0 100 60" style="position:absolute;top:-24%;left:0;width:100%;height:55%;overflow:visible">
    <path d="M22,44 Q10,20 26,6 Q22,26 34,38 Z" fill="#c9312b" stroke="#6e130f" stroke-width="2"/>
    <path d="M78,44 Q90,20 74,6 Q78,26 66,38 Z" fill="#c9312b" stroke="#6e130f" stroke-width="2"/>
  </svg>` },
  flower: { label: "🌸 Blume", svg: `<svg viewBox="0 0 100 50" style="position:absolute;top:-18%;left:0;width:100%;height:50%;overflow:visible">
    <g transform="translate(78,22)">
      <circle cx="0" cy="-10" r="7" fill="#f691b3"/>
      <circle cx="9" cy="-3" r="7" fill="#f691b3"/>
      <circle cx="6" cy="8" r="7" fill="#f691b3"/>
      <circle cx="-6" cy="8" r="7" fill="#f691b3"/>
      <circle cx="-9" cy="-3" r="7" fill="#f691b3"/>
      <circle cx="0" cy="0" r="5" fill="#ffe38a"/>
    </g>
  </svg>` },
  bow: { label: "🎀 Schleife", svg: `<svg viewBox="0 0 100 50" style="position:absolute;top:-16%;left:0;width:100%;height:50%;overflow:visible">
    <path d="M50,28 L22,10 Q18,28 28,36 Z" fill="#e63946" stroke="#8a1a22" stroke-width="1.5"/>
    <path d="M50,28 L78,10 Q82,28 72,36 Z" fill="#e63946" stroke="#8a1a22" stroke-width="1.5"/>
    <circle cx="50" cy="28" r="7" fill="#c9312b" stroke="#8a1a22" stroke-width="1.5"/>
  </svg>` },
  mustache: { label: "🥸 Schnurrbart", svg: `<svg viewBox="0 0 100 40" style="position:absolute;top:58%;left:0;width:100%;height:40%;overflow:visible">
    <path d="M18,22 Q32,6 50,20 Q68,6 82,22 Q68,34 50,24 Q32,34 18,22 Z" fill="#3a2a22" stroke="#1a1210" stroke-width="1.5"/>
  </svg>` },
  star: { label: "⭐ Stern", svg: `<svg viewBox="0 0 100 50" style="position:absolute;top:-22%;left:0;width:100%;height:50%;overflow:visible">
    <path d="M78,22 L82,10 L86,22 L98,24 L88,32 L92,44 L82,36 L72,44 L76,32 L66,24 Z" fill="#f0a830" stroke="#a87a1a" stroke-width="1.5"/>
  </svg>` },
  bandana: { label: "🔴 Bandana", svg: `<svg viewBox="0 0 100 50" style="position:absolute;top:-8%;left:0;width:100%;height:50%;overflow:visible">
    <path d="M6,28 Q50,6 94,28 L88,38 Q50,18 12,38 Z" fill="#e63946" stroke="#8a1a22" stroke-width="2"/>
    <path d="M50,14 L62,2 L58,16 Z" fill="#c9312b"/>
  </svg>` }
};
let myAccessory = null;
try { const a2 = localStorage.getItem("ss_accessory"); if (a2) myAccessory = JSON.parse(a2); } catch {}

function avatarHTML(p) {
  const av = p.avatar;
  const acc = p.accessory && ACCESSORIES[p.accessory] ? ACCESSORIES[p.accessory].svg : "";
  const wrap = (inner) => acc ? `<div style="position:relative;display:inline-block">${inner}${acc}</div>` : inner;
  if (av && av.type === "char") return wrap(`<div class="pavatar pavatar-img" style="background-image:url('${av.value}')"></div>`);
  if (av && av.type === "emoji") return wrap(`<div class="pavatar" style="background:${avatarColor(p.name)}">${av.value}</div>`);
  const initial = (p.name || "?").trim().charAt(0).toUpperCase() || "?";
  return wrap(`<div class="pavatar" style="background:${avatarColor(p.name)}">${esc(initial)}</div>`);
}

function renderAvatarPicker() {
  const grid = $("avatar-grid");
  if (!grid) return;
  const emojiHtml = AVATAR_EMOJIS.map(e => `<button class="avatarbtn" data-type="emoji" data-value="${e}">${e}</button>`).join("");
  const charHtml = AVATAR_CHARS.map(c => `<button class="avatarbtn avatarbtn-img" data-type="char" data-value="${c.img}" style="background-image:url(\'${c.img}\')" title="${esc(c.label)}"></button>`).join("");
  grid.innerHTML = `<div class="avatar-section-label">${tt("Emoji", "Emoji")}</div><div class="avatar-row">${emojiHtml}</div>
    <div class="avatar-section-label">${tt("From our scenes", "Aus unseren Szenen")}</div><div class="avatar-row">${charHtml}</div>`;
  grid.querySelectorAll(".avatarbtn").forEach(b => b.onclick = () => {
    myAvatar = { type: b.dataset.type, value: b.dataset.value };
    try { localStorage.setItem("ss_avatar", JSON.stringify(myAvatar)); } catch {}
    grid.querySelectorAll(".avatarbtn").forEach(x => x.classList.remove("chosen"));
    b.classList.add("chosen");
    renderAccessoryPreview();
    SFX.click();
  });
  if (myAvatar) {
    const sel = grid.querySelector(`.avatarbtn[data-type="${myAvatar.type}"][data-value="${CSS.escape ? CSS.escape(myAvatar.value) : myAvatar.value}"]`);
    if (sel) sel.classList.add("chosen");
  }
  renderAccessoryPicker();
}

// ── Accessoire-Auswahl: Katzenohren, Kopfhörer & Co. — überlagern das gewählte Profilbild ──
function renderAccessoryPicker() {
  const wrap = $("accessory-grid");
  if (!wrap) return;
  wrap.innerHTML = `<button class="avatarbtn accbtn" data-acc="" title="${esc(tt("No accessory", "Kein Accessoire"))}">🚫</button>` +
    Object.entries(ACCESSORIES).map(([k, a]) => `<button class="avatarbtn accbtn" data-acc="${k}" title="${esc(a.label)}">${a.label.split(" ")[0]}</button>`).join("");
  wrap.querySelectorAll(".accbtn").forEach(b => b.onclick = () => {
    myAccessory = b.dataset.acc || null;
    try { localStorage.setItem("ss_accessory", JSON.stringify(myAccessory)); } catch {}
    wrap.querySelectorAll(".accbtn").forEach(x => x.classList.remove("chosen"));
    b.classList.add("chosen");
    renderAccessoryPreview();
    SFX.click();
  });
  const sel = wrap.querySelector(`.accbtn[data-acc="${myAccessory || ""}"]`);
  if (sel) sel.classList.add("chosen");
  renderAccessoryPreview();
}
function renderAccessoryPreview() {
  const el = $("accessory-preview");
  if (!el) return;
  el.innerHTML = avatarHTML({ name: myName || "Du", avatar: myAvatar, accessory: myAccessory });
}

function usableMicId(id) {
  return typeof id === "string" && id.length > 8 && id !== "default" && id !== "communications";
}
function micAudioConstraints(deviceId) {
  const audio = {
    echoCancellation: !!micSettings.ec,
    noiseSuppression: !!micSettings.ns,
    autoGainControl: !!micSettings.agc
  };
  if (usableMicId(deviceId)) audio.deviceId = { ideal: deviceId };
  return { audio };
}
async function getMicStream(preferredId) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
    throw Object.assign(new Error("mediaDevices"), { name: "NotSupportedError" });
  const tries = [
    micAudioConstraints(preferredId),
    { audio: { echoCancellation: !!micSettings.ec, noiseSuppression: !!micSettings.ns, autoGainControl: !!micSettings.agc } },
    { audio: true }
  ];
  let lastErr;
  for (const cons of tries) {
    try { return await navigator.mediaDevices.getUserMedia(cons); }
    catch (e) {
      lastErr = e;
      if (e && (e.name === "NotAllowedError" || e.name === "SecurityError")) throw e;
    }
  }
  throw lastErr;
}
async function buildMic() {
  try {
    if (micStream) micStream.getTracks().forEach(t => t.stop());
    micStream = await getMicStream(micSettings.deviceId);
    try {
      const liveId = micStream.getAudioTracks()[0]?.getSettings?.().deviceId;
      if (usableMicId(liveId)) micSettings.deviceId = liveId;
    } catch {}
    const ctx = getCtx();
    if (!recDest) {
      recDest = ctx.createMediaStreamDestination();
      micHP = ctx.createBiquadFilter(); micHP.type = "highpass";
      micGateNode = ctx.createGain();   // wird NICHT mehr ins Signal eingebunden — nur noch Analyse-Wert fürs Lämpchen
      micGain = ctx.createGain();
      vizAn = ctx.createAnalyser(); vizAn.fftSize = 1024; vizAn.smoothingTimeConstant = 0.75;
      // Wie ein Pegelmesser im Rack einmessen: normales Sprechen soll in der Mitte
      // landen, damit oben noch Luft ist und Rot wirklich „zu laut“ bedeutet.
      vizAn.minDecibels = -85; vizAn.maxDecibels = -20;
      gateAn = ctx.createAnalyser(); gateAn.fftSize = 512;
      micHP.connect(gateAn);                       // Pegel-Analyse fürs Gate-Lämpchen (rein visuell)
      micHP.connect(micGain);                       // Aufgenommenes Signal bleibt roh/ungegatet!
      micGain.connect(recDest); micGain.connect(vizAn);
      startGateLoop();
    }
    if (micSrcNode) micSrcNode.disconnect();
    micSrcNode = ctx.createMediaStreamSource(micStream);
    micSrcNode.connect(micHP);
    applyMicTuning();
    return true;
  } catch (e) {
    const n = e && e.name;
    let msg;
    if (n === "NotAllowedError" || n === "SecurityError")
      msg = tt("🚫 Microphone is blocked. In the address bar click the lock icon → Microphone → Allow, then click “Test record”. (Brave: also try Shields ↓ for this site.)", "🚫 Mikrofon ist blockiert. In der Adressleiste aufs Schloss klicken → Mikrofon → Zulassen, danach auf „Test aufnehmen“. (Brave: Shields für diese Seite runterdrehen.)");
    else if (n === "NotFoundError" || n === "OverconstrainedError")
      msg = tt("🎤 No microphone found. Is one plugged in? Otherwise pick another device below.", "🎤 Kein Mikrofon gefunden. Ist eins angeschlossen? Sonst unten ein anderes Gerät auswählen.");
    else if (n === "NotReadableError")
      msg = tt("🎤 Microphone is in use by another program (Discord, OBS, Teams …). Close it there and try again.", "🎤 Mikrofon ist von einem anderen Programm belegt (Discord, OBS, Teams …). Dort schließen und nochmal versuchen.");
    else if (n === "NotSupportedError")
      msg = tt("🎤 This browser blocked microphone access. Try Chrome or Edge, or turn Brave Shields down for this site.", "🎤 Dieser Browser blockiert das Mikrofon. Versuch Chrome/Edge, oder in Brave die Shields für diese Seite lockern.");
    else
      msg = tt("🎤 Mic access failed", "🎤 Mikro-Zugriff fehlgeschlagen") + (n ? " (" + n + ")" : "") + tt(" — click “Test record” once, or reload.", " — einmal auf „Test aufnehmen“ klicken, oder neu laden.");
    status("mic-status", msg, true);
      SFX.err();
    if (n === "OverconstrainedError" || n === "NotFoundError") {
      micSettings.deviceId = null;
      try { saveMic(); } catch {}
    }
    return false;
  }
}
function applyMicTuning() {
  saveMic();
  if (!micHP) return;
  micHP.frequency.value = micSettings.lowcut ? 90 : 5;
  micGain.gain.value = micSettings.gain;
}

// ── Noise Gate: Mikro ist stumm, solange du nicht sprichst ──
let gateOpen = true, lastLoudT = 0;
// ── VU-Meter im Kopfbereich: LED-Kette, die dem Mikro-Pegel folgt ──
const VU_SEGMENTS = 12;
let vuBuilt = false, vuPeak = 0, vuPeakT = 0;
function updateVuMeter(rms) {
  const wrap = $("vu-leds");
  if (!wrap) return;
  if (!vuBuilt) { wrap.innerHTML = "<i></i>".repeat(VU_SEGMENTS); vuBuilt = true; }
  // RMS ist typischerweise sehr klein — auf eine Skala ziehen, bei der normales Sprechen
  // im mittleren Bereich landet und nur echtes Anschreien ganz oben rot wird
  const level = Math.min(1, Math.pow(Math.max(0, rms) * 3.6, 0.72));
  const lit = Math.round(level * VU_SEGMENTS);
  const now = performance.now();
  if (lit >= vuPeak) { vuPeak = lit; vuPeakT = now; }
  else if (now - vuPeakT > 700) vuPeak = Math.max(lit, vuPeak - 1), vuPeakT = now - 640;   // Spitzenwert klingt langsam ab
  const kids = wrap.children;
  for (let i = 0; i < VU_SEGMENTS; i++) {
    const el = kids[i];
    if (!el) continue;
    const isLit = i < lit, isPeak = i === vuPeak - 1 && vuPeak > lit;
    el.className = (isLit || isPeak) ? (i >= VU_SEGMENTS - 2 ? "on-hi" : i >= VU_SEGMENTS - 5 ? "on-mid" : "on-lo") : "";
    el.style.opacity = isPeak && !isLit ? ".55" : "1";
    el.style.height = (42 + (i / VU_SEGMENTS) * 58) + "%";   // Treppe nach oben, wie am echten Gerät
  }
}

let gateRAF = null;
function stopGateLoop() {
  if (gateRAF) { cancelAnimationFrame(gateRAF); gateRAF = null; }
}
function startGateLoop() {
  stopGateLoop();
  if (!gateAn) return;
  const buf = new Float32Array(gateAn.fftSize);
  function loop() {
    gateRAF = null;
    // Kein Mikro oder Tab im Hintergrund → Loop pausieren (Visibility startet neu)
    if (!micStream || document.hidden) return;
    gateAn.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const now = performance.now();

    // Lobby-Mikro-Live-Anzeige: unabhängig vom Gate, zeigt einfach "kommt gerade Ton an"
    const liveDot = $("mic-live-dot");
    if (liveDot) liveDot.style.background = rms > 0.02 ? "var(--ok)" : "#3a3a46";
    updateVuMeter(rms);

    const thr = micSettings.gate * 0.16;            // Slider 0..1 → Schwelle 0..0.16 RMS (deutlich stärker)
    if (thr <= 0) {
      if (!gateOpen) { micGateNode.gain.setTargetAtTime(1, audioCtx.currentTime, 0.01); gateOpen = true; }
      const lamp0 = $("gate-lamp"), lamp02 = $("booth-gate-lamp");
      if (lamp0) lamp0.style.background = "var(--ok)";
      if (lamp02) lamp02.style.background = "var(--ok)";
    } else {
      if (rms > thr) lastLoudT = now;
      if (rms > thr && !gateOpen) { micGateNode.gain.setTargetAtTime(1, audioCtx.currentTime, 0.004); gateOpen = true; }
      else if (gateOpen && now - lastLoudT > 200) { micGateNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05); gateOpen = false; }
      const lamp = $("gate-lamp"), lamp2 = $("booth-gate-lamp");
      if (lamp) lamp.style.background = gateOpen ? "var(--ok)" : "#3a3a46";
      if (lamp2) lamp2.style.background = gateOpen ? "var(--ok)" : "#3a3a46";
    }
    gateRAF = requestAnimationFrame(loop);
  }
  gateRAF = requestAnimationFrame(loop);
}

function recStream() { return recDest.stream; }
async function ensureMic() { return micStream ? true : buildMic(); }

async function populateDevices() {
  const sel = $("mic-device");
  if (!sel) return;
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput");
    if (!devs.length) {
      sel.innerHTML = `<option value="">${esc(tt("Click “Test record” to choose a microphone", "Klick auf „Test aufnehmen“, dann erscheint die Mikro-Auswahl"))}</option>`;
      return;
    }
    sel.innerHTML = devs.map((d, i) => {
      const label = d.label || tt("Microphone", "Mikrofon") + " " + (i + 1);
      return `<option value="${esc(d.deviceId)}">${esc(label)}</option>`;
    }).join("");
    if (usableMicId(micSettings.deviceId)) sel.value = micSettings.deviceId;
  } catch {
    sel.innerHTML = `<option value="">${esc(tt("Click “Test record” to choose a microphone", "Klick auf „Test aufnehmen“, dann erscheint die Mikro-Auswahl"))}</option>`;
  }
}
try { navigator.mediaDevices.addEventListener("devicechange", () => { populateDevices(); }); } catch {}


// ── Dual-Waveform: lila = Original-Referenz-Peaks (statisch), blau = eigene Stimme (live während Aufnahme) ──
const refPeaksCache = new Map();
async function getRefPeaks(l, cols) {
  const key = l.idx + "|v2|" + cols;
  if (refPeaksCache.has(key)) return refPeaksCache.get(key);
  try {
    const buffer = await getLineOrigBuffer(l);
    if (!buffer) return null;
    const raw = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(raw.length / cols));
    const peaks = new Float32Array(cols);
    for (let i = 0; i < cols; i++) {
      let max = 0, sum = 0, n = 0;
      const a0 = i * step, a1 = Math.min((i + 1) * step, raw.length);
      for (let j = a0; j < a1; j++) {
        const a = Math.abs(raw[j]);
        if (a > max) max = a;
        sum += a; n++;
      }
      // Peak + etwas RMS → dickere, lesbarere Welle (näher an Choicer Voicer)
      peaks[i] = Math.max(max, n ? (sum / n) * 2.2 : 0);
    }
    // Lautstärke normalisieren: leiseste Originals füllen trotzdem die Höhe
    let loud = 0;
    for (let i = 0; i < cols; i++) if (peaks[i] > loud) loud = peaks[i];
    if (loud > 0.015) {
      const scale = 0.94 / loud;
      for (let i = 0; i < cols; i++) peaks[i] = Math.min(1, peaks[i] * scale);
    }
    const result = { peaks, duration: buffer.duration };
    refPeaksCache.set(key, result);
    return result;
  } catch { return null; }
}

// ═════════════════════════════════════════════════════════════
// TAKE-ANSICHT — Original oben, eigene Stimme unten, gemeinsame Zeitachse
// Getrennt statt übereinander: so sieht man mit einem Blick, ob man zu früh
// oder zu spät dran ist, statt zwei ineinanderliegende Wellen zu entwirren.
// Vorschau (nur Original): gespiegelt + volle Breite wie bei Choicer Voicer.
// ═════════════════════════════════════════════════════════════
const VIZ_COLS = 200;
let liveVoicePeaks = null, liveVoiceIdx = -1, currentRefPeaks = null, recording = false;
let vizWindowSec = 3, vizElapsed = 0, vizLoudest = 0, vizClip = 0;

// Aufnahme-Fenster: Original-Länge + etwas Luft — nicht künstlich auf 2,5s aufblasen
function recWindowFor(l) {
  const nextL = (scene && scene.lines) ? scene.lines[l.idx + 1] : null;
  const room = nextL ? Math.max(0.2, nextL.t - l.end) : 0.75;
  const speak = lineSpeakSeconds(l);
  const pad = Math.min(0.85, Math.max(0.3, room * 0.7));
  return Math.min(16, Math.max(0.7, speak + pad));
}

// Gefüllte Wellenform als Treppenzug — liest sich als zusammenhängende Welle
// statt als lose Striche.
function fillWave(g, farbe, mid, richtung, hoehe, W, spalten, bis, amp) {
  const colW = W / spalten;
  g.beginPath();
  g.moveTo(0, mid);
  for (let i = 0; i <= bis; i++) {
    const y = mid + richtung * Math.max(0.012, Math.min(1, amp(i))) * hoehe;
    g.lineTo(i * colW, y);
    g.lineTo((i + 1) * colW, y);
  }
  g.lineTo((bis + 1) * colW, mid);
  g.closePath();
  g.fillStyle = farbe;
  g.fill();
}

function refAmpAt(i, fenster, dur, peaks) {
  const t = (i / VIZ_COLS) * fenster;
  if (t > dur) return 0;
  return peaks[Math.min(peaks.length - 1, Math.floor((t / Math.max(0.001, dur)) * peaks.length))] || 0;
}

function drawTakeViz() {
  const canvas = $("viz");
  if (!canvas) return;
  const g = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const W = Math.round(canvas.clientWidth * dpr), H = Math.round(canvas.clientHeight * dpr);
  if (!W || !H) return;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  g.clearRect(0, 0, W, H);

  const fenster = Math.max(0.4, vizWindowSec);
  const padY = 6 * dpr;
  const previewOnly = !recording && !(liveVoicePeaks && liveVoiceIdx >= 0);
  const mid = Math.round(H * (previewOnly ? 0.5 : 0.48));
  const obenH = mid - padY, untenH = H - padY - mid;

  // ── Zeitraster mit Sekunden ──
  const schritt = fenster > 12 ? 5 : fenster > 6 ? 2 : fenster > 2.5 ? 1 : 0.5;
  g.font = "700 " + (9 * dpr) + "px ui-monospace, monospace";
  g.textBaseline = "top";
  for (let s = schritt; s < fenster - 0.05; s += schritt) {
    const x = (s / fenster) * W;
    g.fillStyle = "rgba(255,255,255,.08)";
    g.fillRect(x, padY, Math.max(1, dpr), H - padY * 2);
    g.fillStyle = "rgba(255,255,255,.4)";
    g.fillText((s % 1 ? s.toFixed(1) : s) + "s", x + 4 * dpr, mid + 3 * dpr);
  }

  // ── Wo das Original zu Ende ist (nur wenn Aufnahme-Fenster länger ist) ──
  if (!previewOnly && currentRefPeaks && currentRefPeaks.duration < fenster - 0.05) {
    const x = (currentRefPeaks.duration / fenster) * W;
    g.fillStyle = "rgba(226,150,255,.45)";
    for (let y = padY; y < H - padY; y += 6 * dpr) g.fillRect(x, y, Math.max(1, dpr), 3 * dpr);
  }

  if (currentRefPeaks && currentRefPeaks.peaks.length) {
    const p = currentRefPeaks.peaks, dur = currentRefPeaks.duration || fenster;
    // Vorschau: Welle füllt die ganze Breite (Fenster = Orig-Länge). Aufnahme: Orig links.
    const bis = previewOnly
      ? VIZ_COLS - 1
      : Math.max(0, Math.min(VIZ_COLS - 1, Math.round((Math.min(dur, fenster) / fenster) * VIZ_COLS) - 1));
    const amp = i => refAmpAt(i, fenster, dur, p);

    if (previewOnly) {
      // Choicer-Style: gespiegelte Magenta-Welle, füllt die Höhe
      const h = Math.min(obenH, untenH) * 0.92;
      const gradUp = g.createLinearGradient(0, mid, 0, mid - h);
      gradUp.addColorStop(0, "rgba(180,70,230,.55)"); gradUp.addColorStop(1, "rgba(255,140,255,.98)");
      const gradDn = g.createLinearGradient(0, mid, 0, mid + h);
      gradDn.addColorStop(0, "rgba(160,50,200,.5)"); gradDn.addColorStop(1, "rgba(120,40,160,.85)");
      fillWave(g, gradUp, mid, -1, h, W, VIZ_COLS, bis, amp);
      fillWave(g, gradDn, mid, 1, h, W, VIZ_COLS, bis, amp);
    } else {
      const grad = g.createLinearGradient(0, mid, 0, padY);
      grad.addColorStop(0, "rgba(150,60,220,.55)"); grad.addColorStop(1, "rgba(240,170,255,.98)");
      fillWave(g, grad, mid, -1, obenH * 0.95, W, VIZ_COLS, bis, amp);
    }
  }

  // ── Eigene Stimme nach unten (normalisiert auf bisher lauteste Stelle) ──
  if (liveVoicePeaks && liveVoiceIdx >= 0) {
    const liveScale = 1 / Math.max(0.16, vizLoudest);
    const grad = g.createLinearGradient(0, mid, 0, H - padY);
    grad.addColorStop(0, "rgba(60,130,240,.55)"); grad.addColorStop(1, "rgba(150,215,255,.98)");
    fillWave(g, grad, mid, 1, untenH * 0.95, W, VIZ_COLS, liveVoiceIdx, i => Math.min(1, (liveVoicePeaks[i] || 0) * liveScale));
  }

  // ── Mittellinie ──
  g.fillStyle = "rgba(255,255,255,.28)";
  g.fillRect(0, mid - dpr * 0.5, W, Math.max(1, dpr));

  g.font = "700 " + (9 * dpr) + "px ui-monospace, monospace";
  if (previewOnly) {
    g.fillStyle = "rgba(240,180,255,.95)";
    g.textBaseline = "top"; g.fillText("ORIGINAL", 6 * dpr, padY + dpr);
  } else {
    g.fillStyle = "rgba(240,180,255,.95)";
    g.textBaseline = "top"; g.fillText("ORIGINAL", 6 * dpr, padY + dpr);
    g.fillStyle = "rgba(170,225,255,.95)";
    g.textBaseline = "bottom"; g.fillText("DU", 6 * dpr, H - padY);
  }

  // ── Laufmarke + Hinweise während der Aufnahme ──
  if (recording) {
    const x = (Math.min(fenster, vizElapsed) / fenster) * W;
    g.fillStyle = "rgba(255,255,255,.25)";
    g.fillRect(x, padY, Math.max(1, 3 * dpr), H - padY * 2);
    g.fillStyle = "#fff";
    g.fillRect(x, padY, Math.max(1, 1.4 * dpr), H - padY * 2);

    let hinweis = null, farbe = null;
    if (vizClip > 0) { hinweis = tt("TOO LOUD", "ZU LAUT"); farbe = "#e63946"; }
    else if (vizElapsed > 0.7 && vizLoudest < 0.1) { hinweis = tt("TOO QUIET — GET CLOSER", "ZU LEISE — NÄHER RAN"); farbe = "#f0a830"; }
    if (hinweis) {
      g.font = "700 " + (8 * dpr) + "px ui-monospace, monospace";
      const b = g.measureText(hinweis).width + 10 * dpr;
      g.fillStyle = "rgba(8,8,12,.85)";
      g.fillRect(W - b - 5 * dpr, padY + dpr, b, 12 * dpr);
      g.fillStyle = farbe;
      g.textBaseline = "middle";
      g.fillText(hinweis, W - b, padY + 7 * dpr);
    }
  }
}

function startDualViz(canvasId, l, recMaxSec) {
  vizWindowSec = recMaxSec;
  vizElapsed = 0; vizLoudest = 0; vizClip = 0;
  liveVoicePeaks = new Float32Array(VIZ_COLS);
  liveVoiceIdx = -1;
  currentRefPeaks = null;
  getRefPeaks(l, VIZ_COLS).then(r => { currentRefPeaks = r; });
  const wave = new Float32Array(vizAn.fftSize);
  cancelAnimationFrame(vizRAF);
  const t0 = performance.now();
  (function draw() {
    vizRAF = requestAnimationFrame(draw);
    if (recording) {
      // Lautstärke aus dem Zeitsignal (RMS) statt aus einzelnen Frequenzbändern:
      // misst die tatsächlich gesprochene Lautheit und bleibt unabhängig von der FFT-Größe.
      vizAn.getFloatTimeDomainData(wave);
      let sq = 0, spitze = 0;
      for (let i = 0; i < wave.length; i++) { const a = wave[i]; sq += a * a; const b = Math.abs(a); if (b > spitze) spitze = b; }
      const level = Math.min(1, Math.sqrt(sq / wave.length) * 4.2);
      vizElapsed = (performance.now() - t0) / 1000;
      vizClip = spitze > 0.985 ? 1.2 : Math.max(0, vizClip - 0.016);
      if (level > vizLoudest) vizLoudest = level;
      const col = Math.min(VIZ_COLS - 1, Math.floor((vizElapsed / vizWindowSec) * VIZ_COLS));
      liveVoicePeaks[col] = Math.max(liveVoicePeaks[col], level);
      // Übersprungene Spalten auffüllen, damit keine Löcher entstehen, wenn ein Bild ausfällt
      for (let i = Math.max(0, liveVoiceIdx); i < col; i++) if (!liveVoicePeaks[i]) liveVoicePeaks[i] = level * 0.7;
      liveVoiceIdx = Math.max(liveVoiceIdx, col);
    }
    drawTakeViz();
  })();
}

// ── Vorschau, bevor man überhaupt aufnimmt: nur das Original, volle Breite ──
function drawStaticRefViz() { drawTakeViz(); }
function previewRefViz(l) {
  cancelAnimationFrame(vizRAF);
  currentRefPeaks = null; recording = false;
  liveVoicePeaks = null; liveVoiceIdx = -1;
  vizElapsed = 0; vizLoudest = 0; vizClip = 0;
  // Vorläufig Szenen-Fenster, nach Laden = echte Original-Länge (volle Breite)
  vizWindowSec = Math.max(0.7, l.end - l.t);
  drawTakeViz();
  getRefPeaks(l, VIZ_COLS).then(r => {
    currentRefPeaks = r;
    if (myLines[curLine] !== l) return;
    if (r && r.duration > 0.25) vizWindowSec = r.duration;
    else vizWindowSec = recWindowFor(l);
    showLineDuration(l);
    drawTakeViz();
  });
}

// Wie lange dauert diese Line wirklich? Bevorzugt Original-Audio, aber keine
// riesigen Ausreißer wenn die Datei/Timing falsch ist.
function lineSpeakSeconds(l) {
  const win = Math.max(0.3, (l.end || 0) - (l.t || 0));
  const ref = currentRefPeaks && currentRefPeaks.duration || 0;
  if (!ref) return win;
  if (ref > win * 2.8) return win;   // Orig verdächtig lang → Szenen-Fenster
  return Math.max(0.3, Math.min(Math.max(ref, win * 0.85), ref + 0.2));
}
function showLineDuration(l) {
  const el = $("line-dur");
  if (el) el.textContent = "~" + Math.max(1, Math.round(lineSpeakSeconds(l))) + " Sek.";
}

// ── Studio-Spektrum: logarithmisch verteilte Bänder als LED-Ketten ──
// Wie an einem echten Analyzer im Rack: unten grün, oben Bernstein/Rot, dazu
// Peak-Haltemarken, die langsam nachfallen, und eine Übersteuerungs-Lampe.
const VIZ_BANDS = 30;
const VIZ_SEGMENTS = 15;
function bandEdges(bands, sampleRate, fftSize) {
  const lo = 55, hi = Math.min(15000, sampleRate / 2);
  const binOf = f => Math.max(0, Math.min(fftSize / 2 - 1, Math.round(f / (sampleRate / fftSize))));
  const out = [];
  for (let i = 0; i < bands; i++) {
    const f0 = lo * Math.pow(hi / lo, i / bands);
    const f1 = lo * Math.pow(hi / lo, (i + 1) / bands);
    const b0 = binOf(f0);
    out.push([b0, Math.max(b0 + 1, binOf(f1))]);
  }
  return out;
}
function startVizOn(canvasId) {
  const canvas = $(canvasId);
  if (!canvas || !vizAn) return;
  const g = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const freq = new Uint8Array(vizAn.frequencyBinCount);
  const wave = new Float32Array(vizAn.fftSize);
  const edges = bandEdges(VIZ_BANDS, getCtx().sampleRate, vizAn.fftSize);
  const level = new Float32Array(VIZ_BANDS);      // geglätteter Pegel je Band
  const hold = new Float32Array(VIZ_BANDS);       // Peak-Haltemarke
  let clipFlash = 0, last = performance.now();
  cancelAnimationFrame(vizRAF);
  (function draw(now) {
    vizRAF = requestAnimationFrame(draw);
    const dt = Math.min(0.1, ((now || performance.now()) - last) / 1000);
    last = now || performance.now();
    const W = canvas.clientWidth * dpr, H = canvas.clientHeight * dpr;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    g.clearRect(0, 0, W, H);

    vizAn.getByteFrequencyData(freq);
    vizAn.getFloatTimeDomainData(wave);

    // Übersteuerung erkennen (Zeitsignal, nicht Spektrum — nur so sieht man echtes Clipping)
    let peak = 0;
    for (let i = 0; i < wave.length; i++) { const a = Math.abs(wave[i]); if (a > peak) peak = a; }
    if (peak > 0.985) clipFlash = 1.4;
    else clipFlash = Math.max(0, clipFlash - dt);

    const pad = 6 * dpr;
    const gridTop = pad, gridH = H - pad * 2;
    const segGap = Math.max(1, 1.2 * dpr);
    const segH = (gridH - segGap * (VIZ_SEGMENTS - 1)) / VIZ_SEGMENTS;
    const colW = (W - pad * 2) / VIZ_BANDS;
    const barW = Math.max(2 * dpr, colW * 0.68);

    // Dezente Skalenlinien als Rack-Referenz
    g.fillStyle = "rgba(255,255,255,.045)";
    for (let s = 0; s <= 3; s++) g.fillRect(pad, gridTop + (gridH / 3) * s - dpr * 0.4, W - pad * 2, dpr * 0.8);

    for (let b = 0; b < VIZ_BANDS; b++) {
      const [b0, b1] = edges[b];
      let m = 0;
      for (let i = b0; i < b1; i++) if (freq[i] > m) m = freq[i];
      // Höhere Frequenzen sind von Natur aus schwächer — leicht anheben, damit die
      // Kette über die ganze Breite lebt und nicht nur links ausschlägt.
      const tilt = 1 + (b / VIZ_BANDS) * 0.6;
      const v = Math.min(1, (m / 255) * tilt);
      // Schneller Anstieg, träges Abfallen — so liest man Sprache angenehm mit
      level[b] = v > level[b] ? level[b] + (v - level[b]) * 0.55 : level[b] + (v - level[b]) * 0.14;
      hold[b] = Math.max(level[b], hold[b] - dt * 0.55);

      const x = pad + b * colW + (colW - barW) / 2;
      const lit = Math.round(level[b] * VIZ_SEGMENTS);
      for (let s = 0; s < VIZ_SEGMENTS; s++) {
        const y = gridTop + gridH - (s + 1) * segH - s * segGap;
        const frac = s / (VIZ_SEGMENTS - 1);
        const on = s < lit;
        if (on) g.fillStyle = frac > 0.86 ? "#e63946" : frac > 0.62 ? "#f0a830" : "#5fe3a1";
        else g.fillStyle = frac > 0.86 ? "rgba(230,57,70,.11)" : frac > 0.62 ? "rgba(240,168,48,.10)" : "rgba(95,227,161,.085)";
        g.fillRect(x, y, barW, segH);
      }
      // Peak-Haltemarke
      if (hold[b] > 0.03) {
        const hy = gridTop + gridH - Math.min(gridH - dpr, hold[b] * gridH);
        g.fillStyle = "rgba(255,255,255,.8)";
        g.fillRect(x, hy, barW, Math.max(1, 1.6 * dpr));
      }
    }

    // Übersteuerungs-Lampe oben rechts
    if (clipFlash > 0) {
      g.fillStyle = "rgba(230,57,70," + Math.min(0.9, clipFlash) + ")";
      g.fillRect(W - pad - 34 * dpr, pad, 34 * dpr, 11 * dpr);
      g.fillStyle = "#12070a";
      g.font = "700 " + (7.5 * dpr) + "px ui-monospace, monospace";
      g.textBaseline = "middle";
      g.fillText("PEAK", W - pad - 30 * dpr, pad + 6 * dpr);
    }
  })();
}

// Setup-Screen
async function initMicScreen() {
  const ok = await buildMic();
  await populateDevices();
  if (!ok) return false;
  // Gespeicherte Einstellungen in die UI übernehmen
  $("mic-ns").checked = micSettings.ns; $("mic-ec").checked = micSettings.ec;
  $("mic-agc").checked = micSettings.agc; $("mic-lowcut").checked = micSettings.lowcut;
  $("mic-gain").value = micSettings.gain; $("mic-gain-val").textContent = Math.round(micSettings.gain * 100) + "%";
  $("mic-gate").value = micSettings.gate; $("mic-gate-val").textContent = micSettings.gate <= 0 ? tt("Off", "Aus") : Math.round(micSettings.gate * 100) + "%";
  startVizOn("mic-viz");
  $("btn-mic-done").disabled = false;
  status("mic-status", tt("Speak into the mic — bars should move. Then do a test record!", "Sprich rein — die Bars sollen ausschlagen. Dann Test aufnehmen!"));
}
$("btn-mic-record").onclick = async () => {
  if (!micStream) { await initMicScreen(); if (!micStream) return; }
  status("mic-status", tt("🎤 Speak for 3 seconds …", "🎤 Sprich jetzt 3 Sekunden …"));
  const rec = new MediaRecorder(recStream(), { mimeType: pickMime() });
  const chunks = [];
  rec.ondataavailable = e => chunks.push(e.data);
  rec.onstop = async () => {
    status("mic-status", tt("This is how you sound in the take:", "So klingst du in der Aufnahme:"));
    const ctx = getCtx();
    const buf = await ctx.decodeAudioData(await new Blob(chunks).arrayBuffer());
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start();
    src.onended = () => { status("mic-status", tt("Good? Continue — or tweak the sliders and test again.", "Passt? Dann weiter — sonst Regler anpassen und nochmal testen.")); $("btn-mic-done").disabled = false; };
  };
  rec.start(); SFX.rec();
  setTimeout(() => { rec.stop(); SFX.stop(); }, 3000);
};
$("btn-mic-done").onclick = () => {
  cancelAnimationFrame(vizRAF);
  if (micReturnScreen === "scr-start") { renderAvatarPicker(); show("scr-avatar"); }
  else show(micReturnScreen);
  SFX.ok();
};
$("btn-avatar-done").onclick = () => { show("scr-start"); SFX.ok(); };
$("btn-mic-settings").onclick = () => {
  micReturnScreen = document.querySelector(".screen.active")?.id || "scr-start";
  if (micReturnScreen === "scr-mic") return;
  show("scr-mic");
  initMicScreen();
};
$("mic-device").onchange = e => {
  const id = e.target.value;
  if (!usableMicId(id)) return;
  micSettings.deviceId = id;
  buildMic();
};
$("mic-ns").onchange = e => { micSettings.ns = e.target.checked; buildMic(); };
$("mic-ec").onchange = e => { micSettings.ec = e.target.checked; buildMic(); };
$("mic-agc").onchange = e => { micSettings.agc = e.target.checked; buildMic(); };
$("mic-lowcut").onchange = e => { micSettings.lowcut = e.target.checked; applyMicTuning(); };
$("btn-mic-raw").onclick = () => {
  Object.assign(micSettings, { ns: false, ec: false, agc: false, lowcut: false, gate: 0 });
  $("mic-ns").checked = $("mic-ec").checked = $("mic-agc").checked = $("mic-lowcut").checked = false;
  $("mic-gate").value = 0; $("mic-gate-val").textContent = tt("Off", "Aus");
  buildMic();
  status("mic-status", tt("🎙 Raw mode: all filters off — pure mic sound. (Headphones required or you'll get echo!)", "🎙 Roh-Modus: Alle Filter aus — pur wie dein Mikro klingt. (Kopfhörer Pflicht, sonst Echo!)"));
};
$("mic-gain").oninput = e => { micSettings.gain = parseFloat(e.target.value); $("mic-gain-val").textContent = Math.round(micSettings.gain * 100) + "%"; applyMicTuning(); };
$("mic-gate").oninput = e => {
  micSettings.gate = parseFloat(e.target.value);
  $("mic-gate-val").textContent = micSettings.gate <= 0 ? tt("Off", "Aus") : Math.round(micSettings.gate * 100) + "%";
  syncBoothGateUI();
};
function syncBoothGateUI() {
  const bg = $("booth-gate"), bv = $("booth-gate-val");
  if (!bg) return;
  bg.value = micSettings.gate;
  bv.textContent = micSettings.gate <= 0 ? tt("Off", "Aus") : Math.round(micSettings.gate * 100) + "%";
}
$("booth-gate").oninput = e => {
  micSettings.gate = parseFloat(e.target.value);
  saveMic();
  syncBoothGateUI();
  $("mic-gate").value = micSettings.gate;
  $("mic-gate-val").textContent = micSettings.gate <= 0 ? tt("Off", "Aus") : Math.round(micSettings.gate * 100) + "%";
};
// Beim ersten Klick den Setup starten (AudioContext braucht eine Nutzergeste).
// Kein { once: true } — sonst verbraucht sich der Listener am ersten Klick, auch wenn dabei nichts passiert ist.
function micKickstart() {
  if (micStream) { document.removeEventListener("click", micKickstart); return; }
  if (document.querySelector("#scr-mic.active")) initMicScreen();
}
document.addEventListener("click", micKickstart);



// ═════════════════════════════════════════════════════════════
// 1) RAUM ERSTELLEN / BEITRETEN
// ═════════════════════════════════════════════════════════════
const HOST_CREATE_MAX = PEER_BROKERS.length * 2; // jeden Broker 2× versuchen
let hostCreateTimer = null;
function clearHostCreateTimer() {
  if (hostCreateTimer) { clearTimeout(hostCreateTimer); hostCreateTimer = null; }
}
let hostPeerStable = false; // erst nach erfolgreichem open — verhindert Close-Races beim Retry
function wireHostPeerLifecycle() {
  peer.on("connection", (conn) => setupHostConn(conn));
  peer.on("disconnected", () => {
    if (absichtlichWeg || hostHandoffActive || !peer || peer.destroyed) return;
    wvBanner("📴 Leitung zum Vermittlungsserver weg — melde neu an …");
    try { peer.reconnect(); } catch {}
    setTimeout(() => { if (peer && !peer.disconnected) wvBannerAus(); }, 2500);
  });
  // Peer komplett tot → Raum-ID neu anmelden (sonst können Freunde nicht mehr rein)
  peer.on("close", () => {
    if (!hostPeerStable || absichtlichWeg || hostHandoffActive || !isHost || !raumCode) return;
    hostPeerStable = false;
    wvBanner(tt("📴 Game server connection lost — reopening the room …", "📴 Spiel-Server-Verbindung weg — öffne Raum neu …"));
    setTimeout(() => {
      if (absichtlichWeg || hostHandoffActive || !isHost || !raumCode) return;
      startHostPeer(0, true);
    }, 900);
  });
}
function startHostPeer(attempt, reopenOnly) {
  clearHostCreateTimer();
  hostPeerStable = false;
  if (peer) { try { peer.destroy(); } catch {} peer = null; }
  const tryNr = Math.max(0, attempt | 0);
  const brokerIdx = tryNr % PEER_BROKERS.length;
  activeBrokerIdx = brokerIdx;
  const broker = PEER_BROKERS[brokerIdx];
  const code = raumCode;
  if (!code) return;

  if (!reopenOnly) {
    if (tryNr === 0) status("start-status", tt("① Connecting to game server …", "① Verbinde zum Spiel-Server …"));
    else status("start-status", tt("🔄 Other game server / retry … (", "🔄 Anderer Spiel-Server / nochmal … (") + (tryNr + 1) + "/" + HOST_CREATE_MAX + " · " + broker.label + ")");
  } else {
    wvBanner(tt("🔄 Re-registering the room on the game server …", "🔄 Melde Raum am Spiel-Server neu an …"));
  }

  let opened = false, finished = false;
  hostCreateTimer = setTimeout(() => {
    if (opened || finished) return;
    finished = true;
    try { peer && peer.destroy(); } catch {}
    peer = null;
    if (tryNr + 1 < HOST_CREATE_MAX) {
      startHostPeer(tryNr + 1, !!reopenOnly);
      return;
    }
    if (reopenOnly) {
      wvBanner(tt("❌ Game server still blocked. ", "❌ Spiel-Server weiter blockiert. ") + BROKER_TIP(), true);
      return;
    }
      status("start-status", tt("❌ Game server unreachable — room could not be created. ", "❌ Spiel-Server nicht erreichbar — Raum konnte nicht erstellt werden. ") + SERVER_BUSY_TIP() + " " + BROKER_TIP(), true);
    SFX.err();
  }, 11000);

  peer = new Peer(PEER_PREFIX + code, makePeerConfig(false, brokerIdx));
  wireHostPeerLifecycle();
  peer.on("open", () => {
    if (finished) return;
    opened = true;
    finished = true;
    clearHostCreateTimer();
    myId = peer.id;
    activeBrokerIdx = brokerIdx;
    hostPeerStable = true;
    if (reopenOnly) {
      // Spielerliste behalten, nur ID aktualisieren
      const me = players.find(p => p.key === myKey) || players[0];
      if (me) me.id = myId;
      wvBannerAus();
      broadcastState();
      return;
    }
    players = [{ id: myId, key: myKey, name: withHostTag(myName), avatar: myAvatar, accessory: myAccessory, role: null, ready: false, done: 0, total: 0, loadPct: 0, videoReady: false }];
    resetDrawBoard();
    enterLobby(code);
    loadSceneList();
  });
  peer.on("error", (e) => {
    console.error("host peer error", e);
    if (finished) return;
    if (e.type === "unavailable-id") {
      finished = true;
      clearHostCreateTimer();
      hostPeerStable = false;
      try { peer.destroy(); } catch {}
      peer = null;
      if (reopenOnly) {
        // ID noch belegt — kurz warten und gleichen Code nochmal
        setTimeout(() => startHostPeer(tryNr, true), 1200);
        return;
      }
      raumCode = randCode();
      startHostPeer(tryNr, false);
      return;
    }
    if (e.type === "browser-incompatible") {
      finished = true;
      clearHostCreateTimer();
      status("start-status", tt("❌ This browser can’t do live connections (WebRTC). Please use Chrome or Edge.", "❌ Dieser Browser kann keine Live-Verbindung (WebRTC). Bitte Chrome oder Edge."), true);
      return;
    }
    // network / websocket / server-error → nächsten Versuch
    if (!opened) {
      finished = true;
      clearHostCreateTimer();
      try { peer && peer.destroy(); } catch {}
      peer = null;
      if (tryNr + 1 < HOST_CREATE_MAX) {
        setTimeout(() => startHostPeer(tryNr + 1, !!reopenOnly), 700);
        return;
      }
      if (reopenOnly) {
        wvBanner(tt("❌ Game server error (", "❌ Spiel-Server-Fehler (") + (e.type || "?") + "). " + BROKER_TIP(), true);
        return;
      }
      const busy = (e.type === "server-error" || e.type === "socket-error" || e.type === "network");
      status("start-status", tt("❌ Game server blocked (", "❌ Spiel-Server blockiert (") + (e.type || tt("network", "Netzwerk")) + "). " + (busy ? SERVER_BUSY_TIP() + " " : "") + BROKER_TIP(), true);
      SFX.err();
    }
  });
}

$("btn-create").onclick = () => {
  myName = $("in-name").value.trim();
  if (!myName) return status("start-status", tt("Enter a name first 😄", "Erst Namen eingeben, digga 😄"), true), SFX.err();
  saveName();
  isHost = true;
  logicalHostKey = myKey;
  absichtlichWeg = false;
  hostHandoffActive = false;
  raumCode = randCode();
  startHostPeer(0, false);
};

$("btn-join").onclick = () => {
  myName = $("in-name").value.trim();
  const code = $("in-code").value.trim();
  if (!myName) return status("start-status", tt("Enter a name first 🙂", "Erst Namen eingeben 🙂"), true), SFX.err();
  if (!isRoomCode(code)) return status("start-status", tt("The room code has 5 digits.", "Der Raumcode hat 5 Ziffern."), true), SFX.err();
  saveName();
  absichtlichWeg = false; wvVersuch = 0; warSchonDrin = false; hostHandoffActive = false;
  logicalHostKey = null;
  gastBeitreten(code, false, 0);
};
let warSchonDrin = false;   // erst nach einem geglückten Beitritt automatisch nachfassen
let hostHandoffActive = false; // Host-Wechsel läuft — kein Doppel-Reconnect / kein Raum-zu

function stripHostTag(name) {
  return String(name || "").replace(/\s*\(Host\)\s*$/i, "").trim();
}
function withHostTag(name) {
  return stripHostTag(name) + " (Host)";
}

// Verbindet als Gast mit einem Raum. Wird auch für jeden Wiederverbindungs-Versuch
// benutzt — bei einer Wiederkehr bleibt der aktuelle Bildschirm dabei unangetastet.
// attempt: rotiert PeerJS-Broker (0/1) und ab der 2. Runde forciert TURN-Relay.
let iceWatchTimer = null;
let joinFailTimers = [];
function clearJoinFailTimers() {
  joinFailTimers.forEach(t => clearTimeout(t));
  joinFailTimers = [];
}
function gastBeitreten(code, wiederkehr, attempt, preferBroker) {
  isHost = false;
  raumCode = code;
  const tryNr = Math.max(0, attempt | 0);
  const nBrokers = PEER_BROKERS.length;
  const brokerIdx = (preferBroker != null && tryNr === 0)
    ? (preferBroker | 0) % nBrokers
    : tryNr % nBrokers;
  const forceRelay = !wiederkehr && tryNr >= nBrokers;
  activeBrokerIdx = brokerIdx;
  const broker = PEER_BROKERS[brokerIdx];
  if (iceWatchTimer) { clearInterval(iceWatchTimer); iceWatchTimer = null; }
  clearJoinFailTimers();
  if (peer) { try { peer.destroy(); } catch {} peer = null; }
  let opened = false, joined = false, finished = false;
  let sawPeerUnavailable = false;
  let iceFailed = false;
  const melde = (msg, err) => { if (!wiederkehr) status("start-status", msg, err); };

  function failJoin(msg, opts) {
    if (finished || joined) return;
    finished = true;
    clearJoinFailTimers();
    if (iceWatchTimer) { clearInterval(iceWatchTimer); iceWatchTimer = null; }
    const noRetry = opts && opts.noRetry;
    if (!wiederkehr && !noRetry && tryNr < JOIN_MAX_TRIES - 1) {
      const next = tryNr + 1;
      melde(tt("🔄 Trying the connection again… (", "🔄 Verbindung wird nochmal versucht… (") + (next + 1) + "/" + JOIN_MAX_TRIES + ")");
      setTimeout(() => gastBeitreten(code, false, next), 700 + tryNr * 400);
      return;
    }
    const tip = ((opts && opts.skipTip) || /Hotspot|blockiert|Tipp|blocked|Tip:|firewall/i.test(msg)) ? "" : " " + NETZ_TIP();
    melde(msg + tip, true);
    if (wiederkehr) planeWiederverbindung();
  }

  function roomMissingMsg(final) {
    if (final) {
      return tt("❌ Room ", "❌ Raum ") + code + tt(" not found / host unreachable. Host still in the lobby? Code right? Both: Ctrl+F5 → host makes a new room → you use the new code. An old invite tab doesn’t count.", " nicht gefunden / Host nicht erreichbar. Host noch in der Lobby? Code richtig? Beide: Strg+F5 → Host neuen Raum → du den neuen Code. Alter Einladungs-Tab zählt nicht.");
    }
    return tt("Room ", "Raum ") + code + tt(" not found on ", " auf ") + broker.label + tt(" — trying another game server…", " nicht gefunden — prüfe anderen Spiel-Server…");
  }

  if (!wiederkehr && tryNr > 0) {
    melde(tt("🔄 Again … (", "🔄 Nochmal … (") + (tryNr + 1) + "/" + JOIN_MAX_TRIES + " · " + broker.label + (forceRelay ? tt(" · relay only", " · nur Relay") : "") + ")");
  } else {
    melde(tt("① Connecting to the game server …", "① Verbinde zum Spiel-Server …"));
  }
  peer = new Peer(makePeerConfig(forceRelay, brokerIdx));

  // Schritt 1: Broker/WebSocket — wenn das schon scheitert, kann er auch keine Lobby hosten
  joinFailTimers.push(setTimeout(() => {
    if (!opened) failJoin(tt("❌ Game server unreachable (signaling blocked). ", "❌ Spiel-Server nicht erreichbar (Vermittlung blockiert). ") + SERVER_BUSY_TIP() + " " + BROKER_TIP(), { skipTip: true });
  }, 12000));

  peer.on("open", () => {
    if (finished || joined) return;
    opened = true;
    myId = peer.id;
    // Alten „Broker öffnen“-Timer weg — sonst kann er später stören
    clearJoinFailTimers();
    melde(tt("② Game server OK (", "② Spiel-Server OK (") + broker.label + tt(") — looking for room ", ") — suche Raum ") + code + " …");
    hostConn = peer.connect(PEER_PREFIX + code, { reliable: true });

    // Schritt 2: Host finden / verbinden — kein endloses „suche Raum“ ohne Meldung
    joinFailTimers.push(setTimeout(() => {
      if (joined || finished) return;
      if (sawPeerUnavailable) {
        failJoin(roomMissingMsg(tryNr >= JOIN_MAX_TRIES - 1), {
          noRetry: tryNr >= JOIN_MAX_TRIES - 1,
          skipTip: true
        });
        return;
      }
      const pc = hostConn && hostConn.peerConnection;
      const st = pc && pc.iceConnectionState;
      // ICE läuft schon (checking/…) → Host existiert, nur NAT ist langsam → länger warten
      if (pc && st && (st === "checking" || st === "connected" || st === "completed" || st === "disconnected")) {
        melde(tt("② Room found — connecting … (", "② Raum gefunden — Verbindung wird aufgebaut … (") + broker.label + ")");
        joinFailTimers.push(setTimeout(() => {
          if (joined || finished) return;
          if (iceFailed) {
            failJoin(tt("❌ Game server OK, but the direct connection is blocked (router/firewall/NAT). ", "❌ Spiel-Server ok, aber Direktverbindung blockiert (Router/Firewall/NAT). ") + BROKER_TIP(), { skipTip: true });
            return;
          }
          failJoin(tt("❌ Game server OK, but the connection to the host isn’t getting through. Often the router/firewall — both try a phone hotspot (switching browsers alone rarely helps).", "❌ Spiel-Server ok, aber Verbindung zum Host kommt nicht durch. Oft Router/Firewall — beide am Handy-Hotspot testen (Browser-Wechsel allein hilft selten)."), { skipTip: true });
        }, ICE_WAIT_MS));
        return;
      }
      // Kein ICE / steckt bei „new“ / kein peerConnection → oft falscher Broker oder toter Raum
      failJoin(roomMissingMsg(tryNr >= JOIN_MAX_TRIES - 1), {
        noRetry: tryNr >= JOIN_MAX_TRIES - 1,
        skipTip: true
      });
    }, ROOM_SEARCH_MS));

    hostConn.on("open", () => {
      joined = true;
      finished = true;
      clearJoinFailTimers();
      if (iceWatchTimer) { clearInterval(iceWatchTimer); iceWatchTimer = null; }
      warSchonDrin = true;
      activeBrokerIdx = brokerIdx;
      if (handoffBrokerIdx != null || hostHandoffActive) handoffBrokerIdx = brokerIdx;
      // Handoff-Disconnect vorbei — ab hier bei Abbruch wieder normal nachfassen
      hostHandoffActive = false;
      sendHost({ t: "hello", name: stripHostTag(myName), avatar: myAvatar, accessory: myAccessory, key: myKey });
      if (wiederkehr) {
        wvBanner(tt("🔌 Reconnected — catching up …", "🔌 Wieder verbunden — hole den Stand …"));
      } else {
        wvVersuch = 0; wvBannerAus();
        resetDrawBoard();
        enterLobby(code);
      }
    });
    let iceTicks = 0;
    iceWatchTimer = setInterval(() => {
      iceTicks++;
      const pc = hostConn && hostConn.peerConnection;
      if (!pc) {
        if (iceTicks > 20) { clearInterval(iceWatchTimer); iceWatchTimer = null; }
        return;
      }
      const st = pc.iceConnectionState;
      if (!joined && (st === "failed" || st === "closed")) {
        iceFailed = true;
        clearInterval(iceWatchTimer); iceWatchTimer = null;
        failJoin(tt("❌ Game server OK, but direct connection AND relay are blocked. ", "❌ Spiel-Server ok, aber Direktverbindung UND Relay blockiert. ") + BROKER_TIP(), { skipTip: true });
        return;
      }
      if (joined && (st === "failed" || st === "closed")) {
        clearInterval(iceWatchTimer); iceWatchTimer = null;
        verbindungWeg();
        return;
      }
      if (joined && iceTicks > 90) {
        clearInterval(iceWatchTimer); iceWatchTimer = null;
      }
    }, 2000);
    hostConn.on("data", (msg) => handleMsg(msg, hostConn));
    hostConn.on("close", verbindungWeg);
    hostConn.on("error", (e) => {
      console.error("conn error", e);
      if (!joined) failJoin(tt("Connection error to the host: ", "Verbindungsfehler zum Host: ") + (e.type || e));
      else verbindungWeg();
    });
  });
  peer.on("disconnected", () => {
    if (!absichtlichWeg && !hostHandoffActive && peer && !peer.destroyed) {
      try { peer.reconnect(); } catch {}
    }
  });
  peer.on("error", (e) => {
    console.error("peer error", e);
    if (e.type === "peer-unavailable") {
      sawPeerUnavailable = true;
      // Wiederkehr / Host-Handoff: Broker rotieren, nicht ewig auf Cloud-0 hängen
      if (wiederkehr || hostHandoffActive) {
        finished = true;
        clearJoinFailTimers();
        if (tryNr < JOIN_MAX_TRIES - 1) {
          setTimeout(() => gastBeitreten(code, true, tryNr + 1, preferBroker != null ? preferBroker : activeBrokerIdx), 450);
          return;
        }
        planeWiederverbindung();
        return;
      }
      // Anderen Broker / nächsten Versuch — Host kann auf Cloud-1 sein
      failJoin(roomMissingMsg(tryNr >= JOIN_MAX_TRIES - 1), {
        noRetry: tryNr >= JOIN_MAX_TRIES - 1,
        skipTip: true
      });
      return;
    }
    if (e.type === "network" || e.type === "socket-error" || e.type === "server-error") {
      if (!joined) {
        const busy = (e.type === "server-error" || e.type === "socket-error" || e.type === "network");
        failJoin(tt("❌ Game server error (", "❌ Spiel-Server-Fehler (") + e.type + "). " + (busy ? SERVER_BUSY_TIP() + " " : "") + BROKER_TIP(), { skipTip: true });
      }
      return;
    }
    if (!joined) failJoin(tt("Connection error: ", "Verbindungsfehler: ") + e.type + ".");
    else if (wiederkehr || raumCode) planeWiederverbindung();
  });
}

// ── Automatisch wieder reinkommen ────────────────────────────
function verbindungWeg() {
  if (isHost || absichtlichWeg || !raumCode || hostHandoffActive) return;
  planeWiederverbindung();
}

let handoffBrokerIdx = null; // nach Host-Wechsel: zuerst denselben Spiel-Server wie der neue Host
function planeWiederverbindung() {
  // hostHandoffActive bewusst erlaubt — sonst stirbt der Rejoin nach „Host geben“
  if (isHost || absichtlichWeg || !raumCode || !warSchonDrin) return;
  // Während Aufnahme/Premiere knackt die Leitung öfter (große Audio-Pakete) —
  // deshalb mehr Versuche, bevor wir aufgeben.
  const maxVersuche = 25;
  if (wvVersuch >= maxVersuche) {
    wvBanner(tt("❌ Can’t get back in. Is the host still running? ", "❌ Komme nicht mehr rein. Läuft der Host noch? ") + NETZ_TIP(), true);
    return;
  }
  clearTimeout(wvTimer);
  wvVersuch++;
  // Erst schnell probieren, dann in immer größeren Abständen — so ist ein kurzes
  // WLAN-Zucken sofort überbrückt, ohne den Host mit Anfragen zu überschütten.
  const warten = Math.min(8000, Math.round(500 * Math.pow(1.45, wvVersuch - 1)));
  wvBanner(tt("📴 Connection lost — trying to get back in … (", "📴 Verbindung weg — versuche wieder reinzukommen … (") + wvVersuch + "/" + maxVersuche + ")");
  const prefer = (handoffBrokerIdx != null) ? handoffBrokerIdx : activeBrokerIdx;
  const attempt = (wvVersuch - 1) % JOIN_MAX_TRIES;
  wvTimer = setTimeout(() => gastBeitreten(raumCode, true, attempt, prefer), warten);
}

function wvBanner(text, dauerhaft) {
  const el = $("wv-banner");
  if (!el) return;
  el.textContent = text;
  el.style.display = "";
  el.style.background = dauerhaft ? "var(--hot)" : "#c9821f";
}
function wvBannerAus() { const el = $("wv-banner"); if (el) el.style.display = "none"; }



// ═════════════════════════════════════════════════════════════
// LOBBY-MUSIK — spielt nur in Lobby & Warte-Screens, nie ingame
// ═════════════════════════════════════════════════════════════
// Lobby music — always via assetUrl (Pages/CDN) + resume AudioContext (otherwise silent)
const lobbyAudio = new Audio();
lobbyAudio.loop = true;
lobbyAudio.preload = "auto";
function ensureLobbySrc() {
  const url = assetUrl("scenes/lobby_music.mp3");
  if (lobbyAudio.getAttribute("data-ss-src") !== url) {
    lobbyAudio.src = url;
    lobbyAudio.setAttribute("data-ss-src", url);
  }
}
ensureLobbySrc();
let musicVol = 0.35, musicOn = true;
try {
  const mv = localStorage.getItem("ss_musicvol"); if (mv !== null) musicVol = parseFloat(mv);
  const mo = localStorage.getItem("ss_musicon"); if (mo !== null) musicOn = mo === "1";
} catch {}
lobbyAudio.volume = musicVol;

const MUSIC_SCREENS = new Set(["scr-mic", "scr-avatar", "scr-start", "scr-lobby", "scr-wait", "scr-final"]);

// ── Lobby-Musik-Visualizer: kleine EQ-Bars, solange Musik läuft ──
let lobbyAn = null, lobbyVizRAF = null;
let lobbyVizData = null;
function ensureLobbyAnalyser() {
  if (lobbyAn) return lobbyAn;
  try {
    const ctx = getCtx();
    const src = ctx.createMediaElementSource(lobbyAudio);
    lobbyAn = ctx.createAnalyser(); lobbyAn.fftSize = 64;
    src.connect(lobbyAn); lobbyAn.connect(ctx.destination);
  } catch (e) { /* schon verbunden (z.B. via elementSource) oder AudioContext noch nicht bereit */ }
  return lobbyAn;
}
function lobbyVizWanted() {
  if (document.hidden || !musicOn || !lobbyAn) return false;
  const active = document.querySelector(".screen.active")?.id;
  return MUSIC_SCREENS.has(active);
}
function stopLobbyViz() {
  if (lobbyVizRAF) { cancelAnimationFrame(lobbyVizRAF); lobbyVizRAF = null; }
  const canvas = document.getElementById("music-viz");
  if (canvas) {
    const g = canvas.getContext("2d");
    if (g) g.clearRect(0, 0, canvas.width, canvas.height);
  }
}
function drawLobbyViz() {
  stopLobbyViz();
  const canvas = document.getElementById("music-viz");
  if (!canvas || !lobbyVizWanted()) return;
  const g = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  if (!lobbyVizData || lobbyVizData.length !== lobbyAn.frequencyBinCount) {
    lobbyVizData = new Uint8Array(lobbyAn.frequencyBinCount);
  }
  (function loop() {
    if (!lobbyVizWanted()) { stopLobbyViz(); return; }
    lobbyVizRAF = requestAnimationFrame(loop);
    const W = canvas.clientWidth * dpr, H = canvas.clientHeight * dpr;
    if (!W || !H) return;
    if (canvas.width !== W) { canvas.width = W; canvas.height = H; }
    g.clearRect(0, 0, W, H);
    if (lobbyAudio.paused) return;
    lobbyAn.getByteFrequencyData(lobbyVizData);
    const bars = 16, bw = W / bars;
    for (let i = 0; i < bars; i++) {
      const v = lobbyVizData[i * 2] / 255;
      const h = Math.max(2 * dpr, v * H);
      g.fillStyle = "rgba(255,201,92,.85)";
      g.fillRect(i * bw + bw * 0.2, H - h, bw * 0.6, h);
    }
  })();
}

function updateLobbyMusic() {
  const active = document.querySelector(".screen.active")?.id;
  const want = musicOn && MUSIC_SCREENS.has(active);
  if (want) {
    ensureLobbySrc();
    try { getCtx().resume(); } catch {}
    ensureLobbyAnalyser();
    lobbyAudio.volume = musicVol;
    lobbyAudio.play().catch(() => {});
    drawLobbyViz();
  } else {
    lobbyAudio.pause();
    stopLobbyViz();
  }
  const btn = $("music-toggle");
  if (btn) btn.textContent = musicOn ? "🎵" : "🔇";
  const sl = $("music-vol"); if (sl) sl.value = musicVol;
}
function stopLobbyPreview() {
  const v = $("preview");
  if (!v) return;
  try { v.pause(); } catch {}
  try { v.currentTime = 0; } catch {}
}
// show() um Musik-Update erweitern
const _origShow = show;
show = function(id) {
  _origShow(id);
  // Vorschau aus der Lobby weiterlaufen lassen = Geister-Ton in Booth/Premiere
  if (id !== "scr-lobby") stopLobbyPreview();
  updateLobbyMusic();
  if (id === "scr-lobby" || id === "scr-wait") { startTipRotation(); renderSettingsView(); } else clearInterval(tipTimer);
  // Ingame (Booth/Aufnahme) ruhig halten: keine Ablenkung
  const calm = id === "scr-booth" || id === "scr-record";
  const f = document.getElementById("floaties");
  if (f) f.style.display = calm ? "none" : "";
  // Seitenpanels NUR in Lobby & Warteraum zeigen — überall sonst (Mikro-Setup, Avatar-Wahl, Premiere, Bewertung …) aus
  const showPanels = id === "scr-lobby" || id === "scr-wait";
  if (!showPanels && BG.running) bgStop(false);   // Beat-Booth beenden, sobald es weitergeht
  const spL = document.getElementById("side-panel-left"), spR = document.getElementById("side-panel-right");
  [spL, spR].forEach(sp => { if (sp) sp.style.visibility = showPanels ? "visible" : "hidden"; });
  if (showPanels) setTimeout(renderDrawBoard, 30);   // Canvas war ggf. gerade erst sichtbar -> Größe neu berechnen & zeichnen
  document.body.classList.toggle("ingame", calm);
};

window.addEventListener("DOMContentLoaded", () => {
  $("music-toggle").onclick = () => {
    musicOn = !musicOn;
    try { localStorage.setItem("ss_musicon", musicOn ? "1" : "0"); } catch {}
    updateLobbyMusic();
    SFX.click();
  };
  $("music-vol").oninput = e => {
    musicVol = parseFloat(e.target.value);
    lobbyAudio.volume = musicVol;
    try { localStorage.setItem("ss_musicvol", musicVol); } catch {}
    if (musicVol > 0 && !musicOn) { musicOn = true; updateLobbyMusic(); }
  };
  updateLobbyMusic();
});
// Autoplay unlock on first gesture — resume WebAudio + play lobby track
document.addEventListener("click", () => {
  try { getCtx().resume(); } catch {}
  if (musicOn) { ensureLobbySrc(); lobbyAudio.play().catch(() => {}); }
}, { once: true });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopLobbyViz();
    stopGateLoop();
  } else {
    updateLobbyMusic();
    if (micStream && gateAn) startGateLoop();
  }
});

// Language switch: refresh live booth / premiere UI strings
document.addEventListener("ss-langchange", () => {
  try {
    if ($("scr-booth")?.classList.contains("active") && typeof renderLine === "function") renderLine();
    if (typeof renderRedoPanel === "function") {
      renderRedoPanel("redo-panel-wait");
      renderRedoPanel("redo-panel-prem");
    }
    if (typeof renderPremState === "function") renderPremState();
    if (typeof updateOuttakesBtn === "function") updateOuttakesBtn();
    if (typeof updateDownloadBtnLabel === "function") updateDownloadBtnLabel();
    const pv = $("play-video");
    if (pv && typeof pv.ontimeupdate === "function") pv.ontimeupdate();
  } catch {}
});

// Editor link only for Elias (unlocked via editor.html?studio=1)
function refreshEditorLink() {
  const wrap = $("editor-link-wrap");
  if (!wrap) return;
  let ok = false;
  try { ok = localStorage.getItem("ss_editor_ok") === "1"; } catch {}
  wrap.style.display = ok ? "" : "none";
}
whenReady(refreshEditorLink);


// ═════════════════════════════════════════════════════════════
// EMOJI-REAKTIONEN — synchron bei allen sichtbar, gegen Lobby-Langeweile
// ═════════════════════════════════════════════════════════════
function emojiAction(char) {
  if (isHost) emojiBroadcast(myId, char);
  else sendHost({ t: "emoji", char });
}
function emojiBroadcast(pid, char) {
  broadcast({ t: "emojiShow", pid, char });
  showEmoji(pid, char);
}
function showEmoji(pid, char) {
  const layer = document.getElementById("emoji-layer");
  if (!layer) return;
  const el = document.createElement("div");
  el.className = "flyemoji";
  el.style.left = (10 + Math.random() * 80) + "%";
  el.style.setProperty("--drift", (Math.random() * 60 - 30) + "px");
  el.textContent = char;
  const label = document.createElement("span");
  label.className = "flyemoji-name";
  label.textContent = nameOf(pid);
  el.appendChild(label);
  layer.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
window.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".emojibtn").forEach(b => b.addEventListener("click", () => { emojiAction(b.dataset.e); SFX.click(); }));
});


// ── Rotierende Tipps/Fun Facts, während man in der Lobby wartet ──
function LOBBY_TIPS() {
  return [
    tt("🔒 Send the room code only to friends — there’s no public lobby browser.", "🔒 Raumcode nur an Freunde schicken — es gibt keinen öffentlichen Lobby-Browser."),
    tt("💡 Tip: wear headphones — otherwise your mic will pick up the video sound!", "💡 Tipp: Kopfhörer aufsetzen — sonst hört dein Mikro den Video-Sound mit!"),
    tt("🎲 Role roulette assigns cast at random — great against long debates.", "🎲 Rollen-Roulette würfelt die Besetzung zufällig — gut gegen Diskussionen."),
    tt("🕶 Blind mode: no translation, no original — pure improvisation.", "🕶 Blind-Modus: keine Übersetzung, kein Original — reines Improvisieren."),
    tt("🐢 In the editor you can watch scenes at 0.5× to time lips better.", "🐢 Im Editor kannst du Szenen in 0.5× ansehen, um Lippen besser zu timen."),
    tt("🎮 While you wait: TicTacToe, click battle, reaction duel and type racer wait below!", "🎮 Während ihr wartet: TicTacToe, Klick-Battle, Reaktions-Duell und Tipp-Renner warten unten!"),
    tt("🗣 “Hear original” shows you the real delivery before you record.", "🗣 „Original anhören” zeigt dir die echte Betonung, bevor du aufnimmst."),
    tt("⭐ After each round you rate each other — best speaker gets the crown 👑", "⭐ Nach jeder Runde bewertet ihr euch gegenseitig — bester Sprecher kriegt die Krone 👑"),
    tt("⬇ The finished result can be saved as video — perfect for TikTok.", "⬇ Das fertige Ergebnis lässt sich als Video speichern — perfekt für TikTok."),
    tt("🎨 Build your own scenes in the scene editor — no Choicer-Voicer pack needed.", "🎨 Baut euch eigene Szenen im Szenen-Editor — kein Choicer-Voicer-Pack nötig."),
  ];
}
let tipIdx = 0, tipTimer = null;
function rotateTip() {
  const el = document.getElementById("lobby-tip");
  if (!el) return;
  el.style.opacity = "0";
  setTimeout(() => { const tips = LOBBY_TIPS(); el.textContent = tips[tipIdx % tips.length]; tipIdx++; el.style.opacity = "1"; }, 300);
}
function startTipRotation() {
  clearInterval(tipTimer);
  rotateTip();
  tipTimer = setInterval(rotateTip, 7000);
}

document.addEventListener("ss-langchange", () => {
  try {
    const leave = $("leave-btn");
    if (leave) leave.textContent = tt("🚪 Leave room", "🚪 Raum verlassen");
    const cancel = $("btn-leave-cancel");
    if (cancel) cancel.textContent = tt("Cancel", "Abbrechen");
    try { if (typeof renderAvatarPicker === "function") renderAvatarPicker(); } catch {}
    renderPlayers();
    try { if (typeof renderBoothPlayers === "function") renderBoothPlayers(); } catch {}
    try { if (typeof checkStartable === "function") checkStartable(); } catch {}
    try { if (typeof renderRoles === "function") renderRoles(); } catch {}
    try { if (typeof renderSettingsView === "function") renderSettingsView(); } catch {}
    try { if (typeof renderRoleFilter === "function") renderRoleFilter(); } catch {}
    try { if (typeof renderSceneGrid === "function") renderSceneGrid(); } catch {}
    try { rotateTip(); } catch {}
    try { rotateFunFact(); } catch {}
    try {
      const link = $("btn-copy-link");
      if (link && !/✅/.test(link.textContent || "")) link.textContent = t("lobby.link");
    } catch {}
    try { syncCodeVisibility(); } catch {}
  } catch (e) { console.warn("ss-langchange", e); }
});

// 💡 Fun-Fact-Ticker fürs linke Seitenpanel — läuft unabhängig durchgehend, rein zur Unterhaltung
function FUN_FACTS() {
  return [
    tt("🐙 Octopuses have three hearts and blue blood.", "🐙 Oktopusse haben drei Herzen und blaues Blut."),
    tt("🍯 Honey almost never spoils — edible honey has been found in 3000-year-old tombs.", "🍯 Honig verdirbt praktisch nie — man hat noch essbaren Honig in 3000 Jahre alten Gräbern gefunden."),
    tt("🌕 The moon drifts about 3.8 cm farther from Earth each year.", "🌕 Der Mond entfernt sich jedes Jahr etwa 3,8 cm von der Erde."),
    tt("🦒 Giraffes and humans have the same number of neck vertebrae: seven.", "🦒 Giraffen und Menschen haben gleich viele Halswirbel: sieben."),
    tt("🍌 Botanically, bananas are berries — strawberries aren’t.", "🍌 Bananen sind aus botanischer Sicht Beeren — Erdbeeren dagegen nicht."),
    tt("⚡ A lightning bolt is about five times hotter than the surface of the sun.", "⚡ Ein Blitz ist etwa fünfmal heißer als die Sonnenoberfläche."),
    tt("🐌 Some snails can sleep for up to three years straight.", "🐌 Manche Schnecken können bis zu drei Jahre am Stück schlafen."),
    tt("🎮 The first video-game Easter egg was hidden in 1979’s “Adventure” for Atari 2600.", "🎮 Das erste Videospiel-Easter-Egg wurde 1979 in „Adventure” für die Atari 2600 versteckt."),
    tt("🧠 Your brain uses about 20% of your daily energy — though it’s only ~2% of body weight.", "🧠 Dein Gehirn verbraucht etwa 20% deiner täglichen Energie — obwohl es nur ~2% deines Körpergewichts ausmacht."),
    tt("🦈 Sharks have been around longer than trees — about 400 million years.", "🦈 Haie gibt es schon länger als Bäume — seit etwa 400 Millionen Jahren."),
    tt("🥶 Water can boil at room temperature — if air pressure is low enough.", "🥶 Wasser kann bei Zimmertemperatur sieden — wenn der Luftdruck niedrig genug ist."),
    tt("🐝 Bees can solve simple math problems and recognize patterns.", "🐝 Bienen können einfache Mathe-Aufgaben lösen und Muster erkennen."),
  ];
}
let funFactIdx = 0, funFactTimer = null;
function rotateFunFact() {
  const el = document.getElementById("funfact-text");
  if (!el) return;
  el.style.transition = "opacity .3s";
  el.style.opacity = "0";
  setTimeout(() => { const facts = FUN_FACTS(); el.textContent = facts[funFactIdx % facts.length]; funFactIdx++; el.style.opacity = "1"; }, 300);
}
// ═════════════════════════════════════════════════════════════
// 🎵 BEAT-BOOTH — Rhythmus-Minispiel (F = links, J = rechts)
// Läuft rein lokal: die Musik hört nur, wer selbst spielt.
// ═════════════════════════════════════════════════════════════
const BG = {
  audio: null, chart: null, notes: [], running: false, raf: null,
  score: 0, combo: 0, maxCombo: 0, counts: { perfect: 0, good: 0, ok: 0, miss: 0 },
  held: [null, null],        // laufende Halte-Note je Spur
  keyDown: [false, false],
  startedAt: 0, countdownUntil: 0, vol: 0.5,
  parts: [], flash: [0, 0], shake: 0, ringPop: [0, 0], pulse: 0, lastBeat: -1,
};
const BG_APPROACH = 0.62;                      // Sekunden von oben bis zur Linie -- kurz = die Noten schießen runter
const BG_WINDOWS = [[0.075, "perfect", 300], [0.13, "good", 180], [0.2, "ok", 80]];
const BG_KEYS = { f: 0, j: 1 };

async function bgLoadChart() {
  if (BG.chart) return BG.chart;
  try {
    const res = await fetch("beatchart.json?v=" + APP_VERSION, { cache: "default" });
    BG.chart = await res.json();
    return BG.chart;
  } catch (e) { console.error("Beat-Chart nicht ladbar:", e); return null; }
}

function bgJudge(text, color) {
  const el = $("bg-judge");
  if (!el) return;
  el.textContent = text;
  el.style.color = color;
  el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
}

// Treffer-Effekte: Funken, kurzer Blitz auf der Spur, leichtes Rütteln
function bgBurst(lane, kind) {
  const colors = { perfect: "#5fe3a1", good: "#f0a830", ok: "#8a8a99", miss: "#e63946" };
  const col = colors[kind] || "#f0a830";
  const n = kind === "perfect" ? 16 : kind === "good" ? 11 : kind === "miss" ? 5 : 8;
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n + Math.random() * 0.5;
    const sp = 1.7 + Math.random() * 3.4;
    BG.parts.push({ lane, x: (Math.random() - .5) * 14, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.3, life: 1, col, r: 1.6 + Math.random() * 2.4 });
  }
  BG.flash[lane] = kind === "miss" ? 0.5 : 1;
  BG.shake = kind === "perfect" ? 5.5 : kind === "miss" ? 3 : 3.5;
  if (kind !== "miss") BG.ringPop[lane] = 1;
}

function bgAddHit(kind, points) {
  BG.counts[kind]++;
  if (kind === "miss") { BG.combo = 0; }
  else {
    BG.combo++;
    BG.maxCombo = Math.max(BG.maxCombo, BG.combo);
    BG.score += points + Math.min(BG.combo, 50) * 2;   // Combo-Bonus, gedeckelt
  }
  const sc = $("bg-score"), cb = $("bg-combo");
  if (sc) sc.textContent = BG.score;
  if (cb) { cb.textContent = BG.combo; cb.classList.toggle("hot", BG.combo >= 10); }
  const colors = { perfect: "#5fe3a1", good: "#f0a830", ok: "#8a8a99", miss: "#e63946" };
  const labels = { perfect: "PERFECT", good: "GOOD", ok: "OK", miss: "MISS" };
  bgJudge(labels[kind], colors[kind]);
}

function bgNow() {
  if (!BG.audio) return 0;
  return BG.audio.currentTime;
}

function bgHitAttempt(lane) {
  if (!BG.running) return;
  const t = bgNow();
  let best = null, bestDiff = 9;
  for (const n of BG.notes) {
    if (n.done || n.lane !== lane) continue;
    const d = Math.abs(n.t - t);
    if (d < bestDiff) { bestDiff = d; best = n; }
  }
  if (!best || bestDiff > 0.2) return;      // nichts in Reichweite -> kein Fehlklick-Abzug, bleibt fair
  for (const [win, kind, pts] of BG_WINDOWS) {
    if (bestDiff <= win) {
      best.done = true; best.hit = kind;
      bgAddHit(kind, pts);
      bgBurst(lane, kind);
      if (best.hold > 0) BG.held[lane] = best;   // Halte-Note startet
      SFX.beathit(kind);
      return;
    }
  }
}

function bgRelease(lane) {
  const h = BG.held[lane];
  if (!h) return;
  BG.held[lane] = null;
  const t = bgNow();
  if (t < h.t + h.hold - 0.15) {              // zu früh losgelassen
    h.holdBroken = true;
    bgAddHit("miss", 0);
  } else {
    h.holdDone = true;
    BG.score += 120;
    const sc = $("bg-score"); if (sc) sc.textContent = BG.score;
    bgJudge("Hold!", "#5fe3a1");
  }
}

function bgDraw() {
  const c = $("bg-canvas");
  if (!c) return;
  const g = c.getContext("2d");
  const W = c.width, H = c.height;
  const hitY = H - 52;
  const laneW = W / 2;
  const t = bgNow();

  // Kamerawackler nach einem Treffer
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (BG.shake > 0.1) {
    g.translate((Math.random() - .5) * BG.shake, (Math.random() - .5) * BG.shake);
    BG.shake *= 0.82;
  }
  g.clearRect(-10, -10, W + 20, H + 20);

  // Hintergrund pulsiert im Takt
  BG.pulse *= 0.9;
  const bpmSec = 60 / ((BG.chart && BG.chart.bpm) || 235) * 2;
  const beatIdx = Math.floor(t / bpmSec);
  if (beatIdx !== BG.lastBeat) { BG.lastBeat = beatIdx; BG.pulse = 1; }
  const bgGrad = g.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, `rgba(168,85,247,${0.05 + BG.pulse * 0.05})`);
  bgGrad.addColorStop(0.55, "rgba(10,10,14,0)");
  g.fillStyle = bgGrad; g.fillRect(0, 0, W, H);

  // Spuren mit Fluchtpunkt-Wirkung
  for (let L = 0; L < 2; L++) {
    const x = L * laneW;
    const lg = g.createLinearGradient(0, 0, 0, hitY);
    const base = L === 0 ? "240,168,48" : "230,57,70";
    lg.addColorStop(0, `rgba(${base},0)`);
    lg.addColorStop(1, `rgba(${base},${BG.keyDown[L] ? .16 : .05})`);
    g.fillStyle = lg; g.fillRect(x + 5, 0, laneW - 10, hitY);
    g.strokeStyle = `rgba(${base},.18)`; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x + 5.5, 0); g.lineTo(x + 5.5, hitY);
    g.moveTo(x + laneW - 5.5, 0); g.lineTo(x + laneW - 5.5, hitY); g.stroke();

    // Aufblitzen direkt nach dem Treffer
    if (BG.flash[L] > 0.02) {
      g.fillStyle = `rgba(255,255,255,${BG.flash[L] * 0.13})`;
      g.fillRect(x + 5, 0, laneW - 10, hitY);
      BG.flash[L] *= 0.84;
    }
  }

  // Trefferlinie: glüht im Takt
  const glowA = 0.35 + BG.pulse * 0.4;
  g.save();
  g.shadowColor = "rgba(240,168,48,.9)"; g.shadowBlur = 12 + BG.pulse * 14;
  g.fillStyle = `rgba(240,168,48,${glowA})`;
  g.fillRect(0, hitY - 1.5, W, 3);
  g.restore();

  // Noten
  for (const n of BG.notes) {
    const dt = n.t - t;
    // Halte-Noten muessen bis zum ENDE ihrer Haltedauer sichtbar bleiben, nicht nur 0.45s nach dem Anschlag
    if (dt > BG_APPROACH || (dt + (n.hold || 0)) < -0.45) continue;
    const cx = n.lane * laneW + laneW / 2;
    const y = hitY * (1 - dt / BG_APPROACH);
    const isHeld = BG.held[n.lane] === n;
    const col = n.hold > 0 ? "168,85,247" : n.lane === 0 ? "240,168,48" : "230,57,70";

    // Beim Halten bleibt die Kugel auf der Trefferlinie stehen, statt darunter zu verschwinden
    const drawY = isHeld ? hitY : y;

    if (n.hold > 0) {                       // Halte-Balken: schrumpft sichtbar von unten weg
      const yEnd = hitY * (1 - (n.t + n.hold - t) / BG_APPROACH);
      const top = Math.min(drawY, yEnd), bot = Math.max(drawY, yEnd);
      const hgt = Math.max(0, bot - top);
      if (hgt > 0.5) {
        g.fillStyle = n.holdBroken ? "rgba(230,57,70,.18)" : `rgba(${col},${isHeld ? .6 : .28})`;
        g.fillRect(cx - 10, top, 20, hgt);
        g.fillStyle = `rgba(255,255,255,${isHeld ? .55 : .15})`;
        g.fillRect(cx - 2.5, top, 5, hgt);
        if (isHeld) {                        // Rand leuchtet, solange gehalten wird
          g.strokeStyle = "rgba(95,227,161,.85)"; g.lineWidth = 2;
          g.strokeRect(cx - 10, top, 20, hgt);
        }
      }
      // Fortschritt: wie viel vom Halten ist geschafft
      if (isHeld) {
        const p = Math.max(0, Math.min(1, (t - n.t) / n.hold));
        g.fillStyle = "rgba(95,227,161,.9)";
        g.fillRect(cx - 14, hitY + 26, 28 * p, 3);
        g.fillStyle = "rgba(255,255,255,.14)";
        g.fillRect(cx - 14 + 28 * p, hitY + 26, 28 * (1 - p), 3);
        if (Math.random() < 0.5) BG.parts.push({ lane: n.lane, x: (Math.random()-.5)*18, y: 0,
          vx: (Math.random()-.5)*1.6, vy: -1.4 - Math.random()*1.6, life: .8, col: "#5fe3a1", r: 1.3 + Math.random()*1.5 });
      }
    }
    if (n.done && !n.hold) continue;
    if (n.done && n.hold && !isHeld) continue;   // fertige Halte-Note nicht weiter zeichnen

    // Schweif hinter der Note
    if (!n.done) {
      const tg = g.createLinearGradient(0, drawY - 26, 0, drawY);
      tg.addColorStop(0, `rgba(${col},0)`); tg.addColorStop(1, `rgba(${col},.35)`);
      g.fillStyle = tg; g.fillRect(cx - 7, drawY - 26, 14, 26);
    }

    const r = (n.hold > 0 ? 13 : 11.5) * (isHeld ? 1.15 : 1);
    g.save();
    g.shadowColor = isHeld ? "rgba(95,227,161,.95)" : `rgba(${col},.9)`;
    g.shadowBlur = isHeld ? 20 : (n.done ? 4 : 14);
    g.beginPath(); g.arc(cx, drawY, r, 0, Math.PI * 2);
    g.fillStyle = isHeld ? "#5fe3a1" : (n.done ? "rgba(120,120,135,.35)" : `rgb(${col})`);
    g.fill();
    g.restore();
    if (!n.done || isHeld) {                // Glanzlicht oben, macht die Note plastisch
      g.beginPath(); g.arc(cx - r * .3, drawY - r * .35, r * .34, 0, Math.PI * 2);
      g.fillStyle = "rgba(255,255,255,.55)"; g.fill();
    }
  }

  // Tastenkappen unten
  for (let L = 0; L < 2; L++) {
    const cx = L * laneW + laneW / 2;
    const base = L === 0 ? "240,168,48" : "230,57,70";
    if (BG.ringPop[L] > 0.02) {              // Ring, der beim Treffer aufploppt
      g.beginPath(); g.arc(cx, hitY, 19 + (1 - BG.ringPop[L]) * 20, 0, Math.PI * 2);
      g.strokeStyle = `rgba(${base},${BG.ringPop[L] * .7})`; g.lineWidth = 2.5; g.stroke();
      BG.ringPop[L] *= 0.88;
    }
    const pressed = BG.keyDown[L];
    g.save();
    g.shadowColor = `rgba(${base},${pressed ? .9 : .3})`; g.shadowBlur = pressed ? 18 : 6;
    g.beginPath(); g.arc(cx, hitY, 18, 0, Math.PI * 2);
    g.fillStyle = pressed ? `rgba(${base},.4)` : "rgba(18,18,24,.9)";
    g.fill();
    g.strokeStyle = pressed ? `rgb(${base})` : `rgba(${base},.55)`; g.lineWidth = 2.5; g.stroke();
    g.restore();
    g.fillStyle = pressed ? "#0b0b0e" : `rgba(${base},.9)`;
    g.font = "700 16px 'Space Mono',monospace"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(L === 0 ? "F" : "J", cx, hitY + 1);
  }

  // Funken
  for (let i = BG.parts.length - 1; i >= 0; i--) {
    const p = BG.parts[i];
    p.x += p.vx; p.y += p.vy; p.vy += 0.16; p.life -= 0.035;
    if (p.life <= 0) { BG.parts.splice(i, 1); continue; }
    const px = p.lane * laneW + laneW / 2 + p.x;
    g.globalAlpha = Math.max(0, p.life);
    g.fillStyle = p.col;
    g.beginPath(); g.arc(px, hitY + p.y, p.r * p.life, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
  }
  if (BG.parts.length > 220) BG.parts.splice(0, BG.parts.length - 220);
  g.setTransform(1, 0, 0, 1, 0, 0);
}

function bgTick() {
  if (!BG.running) return;
  BG.raf = requestAnimationFrame(bgTick);
  const t = bgNow();

  // Countdown vor dem Start
  const cd = $("bg-count");
  if (performance.now() < BG.countdownUntil) {
    const left = Math.ceil((BG.countdownUntil - performance.now()) / 1000);
    if (cd) { cd.classList.add("show"); cd.textContent = left; }
    bgDraw();
    return;
  } else if (cd && cd.classList.contains("show")) {
    cd.classList.remove("show");
    BG.audio.play().catch(() => {});
  }

  // Verpasste Noten einsammeln
  for (const n of BG.notes) {
    if (!n.done && !n.missed && n.t < t - 0.2) { n.missed = true; n.done = true; bgAddHit("miss", 0); bgBurst(n.lane, "miss"); }
    // Halte-Note bis zum Ende durchgehalten -> automatisch gutschreiben
    if (BG.held[n.lane] === n && t >= n.t + n.hold) bgRelease(n.lane);
  }

  bgDraw();
  if (BG.audio.ended || t >= BG.chart.duration - 0.1) bgStop(true);
}

async function bgStart() {
  const chart = await bgLoadChart();
  if (!chart) { status("bg-result", tt("Beat chart not found.", "Beat-Chart nicht gefunden."), true); return; }
  bgStop(false);

  BG.notes = chart.notes.map(n => ({ ...n, done: false, missed: false, hit: null, holdBroken: false, holdDone: false }));
  BG.score = 0; BG.combo = 0; BG.maxCombo = 0;
  BG.counts = { perfect: 0, good: 0, ok: 0, miss: 0 };
  BG.held = [null, null]; BG.keyDown = [false, false];
  BG.parts = []; BG.flash = [0, 0]; BG.shake = 0; BG.ringPop = [0, 0]; BG.pulse = 0; BG.lastBeat = -1;
  $("bg-score").textContent = "0"; $("bg-combo").textContent = "0";
  $("bg-result").textContent = "";
  $("bg-start").style.display = "none"; $("bg-stop").style.display = "";

  if (!BG.audio) { BG.audio = new Audio("beatgame.mp3"); BG.audio.preload = "auto"; }
  BG.audio.volume = BG.vol;
  BG.audio.currentTime = 0;

  lobbyAudio.pause();                       // Lobby-Musik aus, sonst hört man zwei Songs übereinander
  BG.running = true;
  BG.countdownUntil = performance.now() + 3000;
  bgTick();
}

function bgStop(showResult, aborted) {
  const wasRunning = BG.running;
  BG.running = false;
  cancelAnimationFrame(BG.raf);
  if (BG.audio) { BG.audio.pause(); BG.audio.currentTime = 0; }
  const cd = $("bg-count"); if (cd) cd.classList.remove("show");
  const sb = $("bg-start"), st = $("bg-stop");
  if (sb) sb.style.display = ""; if (st) st.style.display = "none";
  if (showResult && wasRunning) {
    const c = BG.counts, total = c.perfect + c.good + c.ok + c.miss;
    const acc = total ? Math.round((c.perfect + c.good * 0.7 + c.ok * 0.35) / total * 100) : 0;
    const res = $("bg-result");
    const head = aborted ? tt("⏹ Stopped", "⏹ Gestoppt") : tt("🏁 Done", "🏁 Fertig");
    if (res) res.innerHTML = `${head} · <b>${BG.score}</b> ${tt("pts", "Punkte")} · ${acc}% ${tt("accuracy", "Genauigkeit")} · ${tt("longest combo", "längste Combo")} ${BG.maxCombo}<br>
      <span style="color:#5fe3a1">${c.perfect} Perfect</span> · <span style="color:#f0a830">${c.good} Good</span> · ${c.ok} OK · <span style="color:#e63946">${c.miss} Miss</span>`;
    if (aborted) SFX.click(); else SFX.done();
  } else if (!showResult) {
    const res = $("bg-result"); if (res) res.textContent = "";
  }
  updateLobbyMusic();                       // Lobby-Musik ggf. wieder an
}

document.addEventListener("keydown", e => {
  const tag = (e.target && e.target.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target.isContentEditable) return;

  // Leertaste in der Booth = Aufnehmen / Stoppen (wie der große Aufnahme-Knopf)
  if ((e.code === "Space" || e.key === " ") && document.querySelector("#scr-booth.active")) {
    const btn = $("btn-line-rec");
    if (btn && !btn.disabled) {
      e.preventDefault();
      if (e.repeat) return;   // gedrückt halten nicht als Dauerfeuer
      btn.click();
    }
    return;
  }

  if (!BG.running) return;
  const lane = BG_KEYS[e.key.toLowerCase()];
  if (lane === undefined || BG.keyDown[lane]) return;
  e.preventDefault();
  BG.keyDown[lane] = true;
  bgHitAttempt(lane);
});
document.addEventListener("keyup", e => {
  const lane = BG_KEYS[(e.key || "").toLowerCase()];
  if (lane === undefined) return;
  BG.keyDown[lane] = false;
  if (BG.running) bgRelease(lane);
});

function startFunFactRotation() {
  clearInterval(funFactTimer);
  rotateFunFact();
  funFactTimer = setInterval(rotateFunFact, 8000);
}


// ── Mini-Konfetti: kleiner Belohnungsmoment beim "Bin bereit" ──
// ── Kurze Einblendung oben, z.B. wenn jemand den Raum verlässt ──
function showToast(text, kind) {
  let host = document.getElementById("toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "toast-host";
    host.style.cssText = "position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:120;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none";
    document.body.appendChild(host);
  }
  const t = document.createElement("div");
  const accent = kind === "leave" ? "var(--hot)" : "var(--amber)";
  t.style.cssText = `font-family:var(--font-body);font-size:.92rem;font-weight:600;color:var(--text);
    background:linear-gradient(180deg,#22222a,#17171d);border:1px solid ${accent};border-left:4px solid ${accent};
    border-radius:8px;padding:11px 18px;box-shadow:0 10px 30px rgba(0,0,0,.6);
    opacity:0;transform:translateY(-10px);transition:opacity .25s, transform .25s`;
  t.textContent = text;
  host.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity = "1"; t.style.transform = "translateY(0)"; });
  setTimeout(() => {
    t.style.opacity = "0"; t.style.transform = "translateY(-10px)";
    setTimeout(() => t.remove(), 300);
  }, 3600);
}

function burstConfetti(mega) {
  const layer = document.getElementById("emoji-layer");
  if (!layer) return;
  const colors = ["#ffc95c", "#ff4d55", "#c84bff", "#5fe3a1", "#ffffff", "#f0a830"];
  const n = mega ? 55 : 18;
  for (let i = 0; i < n; i++) {
    const p = document.createElement("div");
    p.className = "confetti-bit";
    p.style.left = (mega ? Math.random() * 100 : (40 + Math.random() * 20)) + "%";
    p.style.bottom = mega ? (10 + Math.random() * 40) + "%" : "30%";
    p.style.background = colors[i % colors.length];
    p.style.width = (6 + Math.random() * 8) + "px";
    p.style.height = (6 + Math.random() * 8) + "px";
    p.style.setProperty("--dx", (Math.random() * 280 - 140) + "px");
    p.style.setProperty("--rot", (Math.random() * 720 - 360) + "deg");
    p.style.animationDelay = (Math.random() * (mega ? 0.45 : 0.15)) + "s";
    p.style.animationDuration = (1.2 + Math.random() * 1.1) + "s";
    layer.appendChild(p);
    setTimeout(() => p.remove(), 2200);
  }
}


// ═════════════════════════════════════════════════════════════
// REDO-FEATURE: eigene Lines auch nach Fertigmelden noch korrigieren
// (A) jeder spricht nur seine eigenen Lines neu, (B) überschreibt den alten Take,
// (C) geht nur, solange die Premiere noch nicht offiziell gestartet ist.
// ═════════════════════════════════════════════════════════════
let redoMode = null, redoReturnScreen = null;
let finalTracksData = null;   // Host: letzter kompletter Mix-Datensatz, für Nach-Korrekturen
let premiereLocked = false;   // true sobald die Premiere offiziell abgespielt wurde
let pendingPremGo = false;    // premGo kam, Mix war aber noch nicht fertig
let myPremLocalReady = false; // dieser Client hat loadMix + Video-Puffer fertig
let premGoRetryTimer = null;


// ═════════════════════════════════════════════════════════════
// 🥊 DUELL-MODUS: 2 Spieler, 1 Rolle, unabhängige Aufnahmen, Kopf-an-Kopf-Abstimmung
// ═════════════════════════════════════════════════════════════
let duelInfo = null;          // { roleId, aId, bId }
let duelStagedScene = null;   // vom Host im Setup gewählte Szene, bevor das Duell startet
const duelSubs = {};          // Host: playerId -> items[]
const duelVotes = {};         // Host: voterId -> "a" | "b"

// ═════════════════════════════════════════════════════════════
// RAUM VERLASSEN — sauberer Reset ohne Seiten-Reload
// ═════════════════════════════════════════════════════════════
function leaveRoom(statusMsg) {
  // Bewusst gegangen: kein Wiederverbinden versuchen, und der Host soll den Platz
  // sofort räumen statt ihn zwei Minuten freizuhalten.
  absichtlichWeg = true;
  hostHandoffActive = false;
  handoffBrokerIdx = null;
  logicalHostKey = null;
  raumCode = null;
  clearTimeout(wvTimer); wvVersuch = 0; wvBannerAus();
  clearJoinFailTimers();
  if (iceWatchTimer) { clearInterval(iceWatchTimer); iceWatchTimer = null; }
  if (!isHost && hostConn && hostConn.open) { try { sendHost({ t: "bye" }); } catch {} }
  rueckkehrTimer.forEach(t => clearTimeout(t)); rueckkehrTimer.clear();
  try { if (lineRec && lineRec.state === "recording") lineRec.stop(); } catch {}
  clearInterval(recTimer); clearInterval(cbTimer);
  playNodes.forEach(n => { try { n.stop(); } catch {} }); playNodes = [];
  stopGateLoop();
  stopLobbyViz();
  clearTimeout(stateBroadcastTimer); stateBroadcastTimer = null;
  ["preview","booth-video","play-video","rec-video"].forEach(id => { const v = $(id); if (v) { v.pause(); v.removeAttribute("src"); v.load(); } });
  try { peer && peer.destroy(); } catch {}
  peer = null; hostConn = null; conns.clear();
  isHost = false; players = []; scene = null;
  resetDrawBoard();
  pendingPremGo = false; myPremLocalReady = false;
  clearTimeout(premGoRetryTimer); premGoRetryTimer = null;
  if (micStream) { try { micStream.getTracks().forEach(t => t.stop()); } catch {} micStream = null; }
  localVideoBuf = null; clearSceneVideoState();
  takes = {}; myLines = []; curLine = 0; outtakes = []; mixItems = []; collected.clear(); collectedOuttakes.clear();
  ttt = { p: [], board: Array(9).fill(null), turn: 0, winner: null };
  match = { mode: "free", rounds: 3, round: 1, totals: {}, autoRoulette: true, buddyGivers: {} };
  myBuddyUsed = false;
  Object.keys(mgWins).forEach(k => delete mgWins[k]);
  $("host-settings").style.display = "none";
  match.mode = "free";
  $("onair").classList.remove("live");
  $("host-scene").style.display = "none";
  $("host-start").style.display = "none";
  $("scene-card").style.display = "none";
  $("leave-btn").style.display = "none";
  status("start-status", statusMsg || tt("Left the room. You can create or join a new one right away.", "Raum verlassen. Du kannst direkt einen neuen erstellen oder beitreten."));
  show("scr-start");
  SFX.stop();
}
let pendingConfirm = null; // { type:"leave" } | { type:"kick", pid } | { type:"hostgive", pid }
document.body.insertAdjacentHTML("beforeend",
  `<div id="wv-banner" style="display:none;position:fixed;top:0;left:0;right:0;z-index:250;background:#c9821f;color:#12120f;font-family:var(--font-mono);font-size:.8rem;font-weight:700;text-align:center;padding:7px 12px;letter-spacing:.04em;box-shadow:0 2px 12px rgba(0,0,0,.5)"></div>
   <button id="leave-btn" style="position:fixed;right:12px;bottom:10px;z-index:98;display:none;padding:8px 14px;font-size:.82rem;background:#1f1f28;border:1px solid var(--line);border-radius:8px;color:var(--muted)">${tt("🚪 Leave room", "🚪 Raum verlassen")}</button>
   <div id="leave-confirm-overlay" style="display:none;position:fixed;inset:0;z-index:210;background:rgba(0,0,0,.7);align-items:center;justify-content:center;padding:20px">
     <div style="max-width:340px;width:100%;background:#14141b;border:1px solid var(--line);border-radius:16px;padding:22px;text-align:center">
       <p style="margin:0 0 18px;font-size:1rem" id="leave-confirm-text">${tt("Really leave the room?", "Raum wirklich verlassen?")}</p>
       <div class="row" style="justify-content:center;gap:10px">
         <button class="ghost" id="btn-leave-cancel">${tt("Cancel", "Abbrechen")}</button>
         <button class="primary" id="btn-leave-confirm" style="background:var(--hot)">${tt("🚪 Yes, leave", "🚪 Ja, verlassen")}</button>
       </div>
     </div>
   </div>`);
function showConfirmDialog(text, confirmLabel, action) {
  pendingConfirm = action;
  $("leave-confirm-text").textContent = text;
  $("btn-leave-confirm").textContent = confirmLabel;
  $("btn-leave-confirm").style.background = "var(--hot)";
  $("leave-confirm-overlay").style.display = "flex";
}
$("leave-btn").onclick = () => {
  showConfirmDialog(
    tt("Really leave the room?", "Raum wirklich verlassen?") + (isHost
      ? tt(" You hold the room connection — the room will close for everyone!", " Du hältst die Raum-Verbindung — der Raum wird für alle geschlossen!")
      : (iAmLogicalHost() ? tt(" Your host rights then go back to the room creator.", " Deine Host-Rechte gehen dann an den Raum-Ersteller zurück.") : "")),
    tt("🚪 Yes, leave", "🚪 Ja, verlassen"),
    { type: "leave" }
  );
};
$("btn-leave-cancel").onclick = () => { pendingConfirm = null; $("leave-confirm-overlay").style.display = "none"; };
$("leave-confirm-overlay").onclick = e => {
  if (e.target.id === "leave-confirm-overlay") { pendingConfirm = null; $("leave-confirm-overlay").style.display = "none"; }
};
$("btn-leave-confirm").onclick = () => {
  $("leave-confirm-overlay").style.display = "none";
  const a = pendingConfirm; pendingConfirm = null;
  if (!a) return;
  if (a.type === "kick") kickPlayer(a.pid);
  else if (a.type === "hostgive") transferHostTo(a.pid);
  else leaveRoom();
};
document.addEventListener("click", (e) => {
  const kick = e.target.closest("[data-kick]");
  if (kick && iAmLogicalHost()) {
    e.preventDefault();
    const pid = kick.getAttribute("data-kick");
    const p = players.find(x => x.id === pid);
    if (!p || p.id === myId) return;
    showConfirmDialog(
      (p.name || tt("This player", "Diesen Spieler")) + tt(" — really kick from the room?", " wirklich aus dem Raum kicken?"),
      tt("🚪 Yes, kick", "🚪 Ja, kicken"),
      { type: "kick", pid }
    );
    SFX.click();
    return;
  }
  const give = e.target.closest("[data-hostgive]");
  if (give && iAmLogicalHost()) {
    e.preventDefault();
    const pid = give.getAttribute("data-hostgive");
    const p = players.find(x => x.id === pid);
    if (!p || p.id === myId) return;
    if (!hostHandoffAllowed()) {
      showToast(tt("You can only pass host in the lobby or waiting room.", "Host weitergeben geht nur in der Lobby oder im Warteraum."), "leave");
      SFX.err();
      return;
    }
    showConfirmDialog(
      tt("Really pass host to ", "Host wirklich an ") + stripHostTag(p.name || tt("this player", "diesen Spieler")) + tt("? You’ll become a normal player.", " weitergeben? Du wirst dann normaler Mitspieler."),
      tt("👑 Yes, give host", "👑 Ja, Host geben"),
      { type: "hostgive", pid }
    );
    SFX.click();
  }
});

// ── Raumcode verstecken (Blur): gut für Streams/Screenshots — Auge toggelt Sichtbarkeit ──
let codeHidden = false;
try { codeHidden = localStorage.getItem("ss_code_hidden") === "1"; } catch {}
function syncCodeVisibility() {
  const el = $("lobby-code");
  const btn = $("btn-toggle-code");
  if (!el) return;
  el.classList.toggle("is-blurred", !!codeHidden);
  if (btn) {
    btn.textContent = codeHidden ? "👁‍🗨" : "👁";
    btn.title = codeHidden ? tt("Show room code", "Raumcode anzeigen") : tt("Hide room code", "Raumcode verstecken");
  }
}
$("btn-toggle-code") && ($("btn-toggle-code").onclick = () => {
  codeHidden = !codeHidden;
  try { localStorage.setItem("ss_code_hidden", codeHidden ? "1" : "0"); } catch {}
  syncCodeVisibility();
  SFX.click();
});
syncCodeVisibility();

$("btn-copy-code") && ($("btn-copy-code").onclick = async () => {
  const code = raumCode || $("lobby-code").textContent;
  try {
    await navigator.clipboard.writeText(code);
    $("btn-copy-code").textContent = "✅";
    setTimeout(() => { $("btn-copy-code").textContent = "📋"; }, 1500);
    SFX.click();
  } catch { status("lobby-status", tt("Can't copy — select the code manually: ", "Kopieren nicht möglich — Code von Hand markieren: ") + code, true); }
});

// ── Einladungs-Link: Raumcode steckt in der Adresse, ein Klick reicht zum Beitreten ──
function inviteLink(code) {
  const u = new URL(location.href);
  u.hash = "";
  u.search = "?raum=" + code;
  return u.toString();
}
$("btn-copy-link") && ($("btn-copy-link").onclick = async () => {
  const link = inviteLink(raumCode || $("lobby-code").textContent);
  const btn = $("btn-copy-link");
  try {
    await navigator.clipboard.writeText(link);
    btn.textContent = tt("✅ Link copied — paste it now!", "✅ Link kopiert — jetzt einfügen!");
    setTimeout(() => { btn.textContent = t("lobby.link"); }, 2500);
    SFX.click();
  } catch { status("lobby-status", tt("Can't copy — copy the link manually: ", "Kopieren nicht möglich — Link von Hand kopieren: ") + link, true); }
});
// Wer über einen Einladungs-Link kommt, findet den Code schon eingetragen vor.
// Kein Auto-Beitritt: das Mikro braucht erst eine Freigabe durch eine echte Nutzergeste.
const invitedCode = (() => {
  const m = /^\d{5}$/.exec(new URLSearchParams(location.search).get("raum") || "");
  return m ? m[0] : null;
})();
if (invitedCode) whenReady(() => {
  const codeInput = $("in-code");
  const note = $("invite-note");
  codeInput.value = invitedCode;
  const syncInviteNote = () => {
    if (!note) return;
    const v = (codeInput.value || "").trim();
    if (v === invitedCode) {
      note.textContent = tt("🎬 You were invited to room ", "🎬 Du wurdest in Raum ") + invitedCode + tt(" — code is filled in, just hit Join.", " eingeladen — Code steht schon drin, einfach auf „Beitreten“.");
      note.style.display = "";
    } else if (isRoomCode(v)) {
      note.textContent = tt("ℹ️ Invite link was room ", "ℹ️ Einladungs-Link war Raum ") + invitedCode + tt(" — you’re looking for ", " — du suchst jetzt ") + v + tt(" (old link doesn’t count).", " (alter Link zählt nicht).");
      note.style.display = "";
    } else {
      note.style.display = "none";
    }
  };
  syncInviteNote();
  codeInput.addEventListener("input", syncInviteNote);
  const btn = $("btn-join");
  if (btn) btn.classList.add("primary");
});

function enterLobby(code) {
  $("lobby-code").textContent = code;
  syncCodeVisibility();
  show("scr-lobby");
  renderPlayers();
  $("leave-btn").style.display = "";
  if (iAmLogicalHost()) {
    // Match-Stand zuerst in die UI spiegeln — sonst resettet hostSettingsChanged die Szene
    if ($("set-mode")) $("set-mode").value = match.mode;
    if ($("set-rounds")) $("set-rounds").value = String(match.rounds);
    if ($("set-roulette")) $("set-roulette").checked = !!match.autoRoulette;
    syncModePicker(match.mode);
    $("host-settings").style.display = "";
    $("set-mode").onchange = hostSettingsChanged;
    $("set-rounds").onchange = hostSettingsChanged;
    $("set-roulette").onchange = hostSettingsChanged;
    // Nur Raum-Besitzer darf hostSettingsChanged voll ausführen (Broadcast).
    // Sonst nur UI spiegeln — sonst sendet der neue Host sofort ein Proxy-Settings.
    if (isHost) hostSettingsChanged();
  }
  // Host-Start-Karte & Host-UI: syncHostUi ist die Quelle der Wahrheit
  // (früher stand hier nur für Host host-start=anzeigen — das ging bei Host-Transfer verloren)
  syncHostUi();
  renderSettingsView();
  SFX.ok();
}

// ═════════════════════════════════════════════════════════════
// 2) NACHRICHTEN
// ═════════════════════════════════════════════════════════════
function setupHostConn(conn) {
  // Sofort merken — sonst verpasst broadcastState den ersten hello (open kommt manchmal zu spät)
  const track = () => { if (conn && conn.peer) conns.set(conn.peer, conn); };
  track();
  conn.on("open", track);
  conn.on("data", (msg) => handleMsg(msg, conn));
  conn.on("close", () => {
    conns.delete(conn.peer);
    const gone = players.find(p => p.id === conn.peer);
    if (!gone) { broadcastState(); return; }
    if (gone.gehtFreiwillig || !gone.key) { endgueltigWeg(gone); return; }

    // Schon wieder unter neuer Peer-ID drin? Dann nur den alten Geister-Eintrag
    // wegräumen — Rolle/Fortschritt auf den Live-Platz legen, kein Offline-Toast.
    const twin = players.find(p => p !== gone && p.key === gone.key);
    if (twin) {
      if (twin.role == null && gone.role != null) twin.role = gone.role;
      if ((!twin.extraRoles || !twin.extraRoles.length) && gone.extraRoles && gone.extraRoles.length) twin.extraRoles = gone.extraRoles.slice();
      if ((twin.done || 0) < (gone.done || 0)) { twin.done = gone.done; twin.total = gone.total; }
      if (!twin.ready && gone.ready) twin.ready = true;
      if (!twin.prem && gone.prem) twin.prem = true;
      players = players.filter(p => p !== gone);
      clearTimeout(rueckkehrTimer.get(gone.key));
      rueckkehrTimer.delete(gone.key);
      broadcastState();
      maybeFinishTracks();
      syncForceMixBtn();
      return;
    }

    // Platz NICHT sofort löschen. Bei einem kurzen WLAN-Zucken soll die Person mit ihrer
    // Rolle und den schon aufgenommenen Lines zurückkommen können, statt als neuer
    // Spieler von vorne anzufangen.
    const frist = gnadenfristMs();
    gone.offline = true;
    gone.offlineSeit = Date.now();
    gone.offlineBis = Date.now() + frist;
    showToast("📴 " + gone.name + tt(" dropped — seat stays free for ", " ist rausgeflogen — Platz bleibt ") + Math.round(frist / 60000) + tt(" min", " Min. frei"), "leave");
    SFX.leave();
    broadcast({ t: "playerOffline", name: gone.name });
    clearTimeout(rueckkehrTimer.get(gone.key));
    rueckkehrTimer.set(gone.key, setTimeout(() => endgueltigWeg(gone), frist));
    broadcastState();
    // Notausgang-Knopf für den Host neu bewerten, falls gerade auf diese Spur gewartet wird
    maybeFinishTracks();
    syncForceMixBtn();
    maybeFinishRating();
  });
}

// Gnadenfrist abgelaufen oder freiwillig gegangen: Platz endgültig räumen. Erst ab hier
// darf die Runde ohne diese Person weiterlaufen.
function endgueltigWeg(p) {
  if (!p || !players.includes(p)) return;
  const wasLogical = !!(p.key && logicalHostKey && p.key === logicalHostKey);
  if (p.key) { clearTimeout(rueckkehrTimer.get(p.key)); rueckkehrTimer.delete(p.key); }
  players = players.filter(x => x !== p);
  conns.delete(p.id);
  broadcast({ t: "playerLeft", name: p.name });
  showToast("👋 " + p.name + tt(" left the room", " hat den Raum verlassen"), "leave");
  SFX.leave();
  if (wasLogical && isHost) reclaimLogicalHost();
  else broadcastState();
  maybeFinishTracks();
  if (duelInfo && document.querySelector("#scr-duel-vote.active")) maybeFinishDuelVote();
  updateRateProgress();
  maybeFinishRating();
  syncForceMixBtn();
}

// Host kickt jemanden: sofort raus (keine Gnadenfrist), Nachricht schicken, Verbindung zu.
function kickPlayer(pid) {
  if (!iAmLogicalHost() || !pid || pid === myId) return;
  if (!isHost) {
    sendHost({ t: "hostCmd", cmd: "kick", pid });
    return;
  }
  doKickPlayer(pid);
}
function doKickPlayer(pid) {
  if (!isHost || !pid || pid === myId) return;
  const p = players.find(x => x.id === pid);
  if (!p) return;
  const c = conns.get(pid);
  if (c && c.open) {
    try { c.send({ t: "kicked" }); } catch {}
  }
  p.gehtFreiwillig = true;
  endgueltigWeg(p);
  if (c) setTimeout(() => { try { c.close(); } catch {} }, 200);
}

// Host-Rolle weitergeben (nur Lobby/Warteraum): Raum-Peer-ID wird freigegeben,
// neuer Host meldet sich mit demselben Code an, alle anderen verbinden neu per key.
const HOST_HANDOFF_PHASES = new Set(["scr-lobby", "scr-wait"]);
function hostHandoffAllowed() {
  return HOST_HANDOFF_PHASES.has(aktuellePhase());
}
function syncHostUi() {
  const inLobby = !!document.querySelector("#scr-lobby.active");
  const hostUi = iAmLogicalHost();
  const rnd = match.mode === "rounds" || match.mode === "elimination";
  const duell = match.mode === "duell";
  if ($("host-settings")) $("host-settings").style.display = (hostUi && inLobby) ? "" : "none";
  if ($("host-scene")) $("host-scene").style.display = (hostUi && inLobby && !rnd && !duell) ? "" : "none";
  if ($("host-start")) $("host-start").style.display = (hostUi && inLobby) ? "" : "none";
  if ($("duel-setup")) $("duel-setup").style.display = (hostUi && inLobby && duell) ? "" : "none";
  if ($("rounds-opts")) $("rounds-opts").style.display = (hostUi && inLobby && match.mode === "rounds") ? "" : "none";
  if ($("btn-roulette")) $("btn-roulette").style.display = (hostUi && scene) ? "" : "none";
  renderPackUi();
  if (hostUi && inLobby) {
    // DOM an Match-Stand anpassen, OHNE hostSettingsChanged (das würde die Szene resetten)
    if ($("set-mode")) $("set-mode").value = match.mode;
    if ($("set-rounds")) $("set-rounds").value = String(match.rounds);
    if ($("set-roulette")) $("set-roulette").checked = !!match.autoRoulette;
    syncModePicker(match.mode);
    $("set-mode").onchange = hostSettingsChanged;
    $("set-rounds").onchange = hostSettingsChanged;
    $("set-roulette").onchange = hostSettingsChanged;
    if (duell) populateDuelSceneSelect();
    if (!rnd && !duell) loadSceneList();
  }
  renderSettingsView();
  renderPlayers();
  if (hostUi) checkStartable();
}
// Host-Rolle weitergeben OHNE PeerJS-Raum zu zerstören.
// Raum-Besitzer (isHost) behält die Leitung; nur logicalHostKey wandert.
function transferHostTo(pid) {
  if (!iAmLogicalHost() || !pid || pid === myId) return;
  const target = players.find(p => p.id === pid);
  if (!target) return;
  if (!hostHandoffAllowed()) {
    showToast(tt("You can only pass host in the lobby or waiting room.", "Host weitergeben geht nur in der Lobby oder im Warteraum."), "leave");
    SFX.err();
    return;
  }
  if (target.offline) {
    showToast(tt("Player is offline — only give host to someone online.", "Spieler ist offline — Host nur an jemanden, der online ist."), "leave");
    SFX.err();
    return;
  }
  if (!target.key) {
    showToast(tt("Player can’t be re-recognized — ask them to rejoin once, then try again.", "Spieler ohne Wiedererkennung — soll einmal neu beitreten, dann nochmal versuchen."), "leave");
    SFX.err();
    return;
  }
  if (!isHost) {
    sendHost({ t: "hostCmd", cmd: "hostGive", pid });
    return;
  }
  commitLogicalHost(target.key, stripHostTag(target.name));
}
function commitLogicalHost(newKey, newName) {
  if (!isHost || !newKey) return;
  const prev = logicalHostKey;
  logicalHostKey = newKey;
  applyLogicalHostLabels();
  const payload = {
    t: "hostHandoff",
    newKey,
    newName: stripHostTag(newName || ""),
    oldKey: prev,
    code: raumCode
  };
  broadcast(payload);
  broadcastState();
  syncHostUi();
  const neu = stripHostTag(newName || "?");
  if (newKey === myKey) {
    showToast(tt("👑 You’re host again!", "👑 Du bist wieder Host!"), "join");
    status("lobby-status", tt("👑 You’re host again!", "👑 Du bist wieder Host!"));
  } else {
    showToast(tt("👑 Host goes to ", "👑 Host geht an ") + neu, "join");
    status("lobby-status", tt("👑 Host is now ", "👑 Host ist jetzt ") + neu + tt(" — you stay in the room.", " — du bleibst im Raum."));
  }
  SFX.ok();
  wvBannerAus();
}
function reclaimLogicalHost() {
  if (!isHost || logicalHostKey === myKey) return;
  commitLogicalHost(myKey, stripHostTag(myName));
}
// Host-UI-Aktionen vom logischen Host (Gast) → Raum-Besitzer führt aus.
function handleHostCmd(msg, sender) {
  if (!isHost || !msg || !msg.cmd) return;
  switch (msg.cmd) {
    case "kick":
      if (msg.pid) doKickPlayer(msg.pid);
      break;
    case "hostGive": {
      const target = players.find(p => p.id === msg.pid);
      if (target && target.key && !target.offline && hostHandoffAllowed()) {
        commitLogicalHost(target.key, stripHostTag(target.name));
      }
      break;
    }
    case "settings": {
      const prevMode = match.mode;
      if (msg.mode) match.mode = msg.mode;
      if (msg.rounds != null) match.rounds = msg.rounds | 0;
      match.autoRoulette = !!msg.autoRoulette;
      if ($("set-mode")) $("set-mode").value = match.mode;
      if ($("set-rounds")) $("set-rounds").value = String(match.rounds);
      if ($("set-roulette")) $("set-roulette").checked = !!match.autoRoulette;
      syncModePicker(match.mode);
      const rnd = match.mode === "rounds" || match.mode === "elimination";
      const duell = match.mode === "duell";
      if ($("rounds-opts")) $("rounds-opts").style.display = (match.mode === "rounds") ? "" : "none";
      if ($("host-scene")) $("host-scene").style.display = (rnd || duell) ? "none" : "";
      if ($("duel-setup")) $("duel-setup").style.display = duell ? "" : "none";
      if (match.mode !== prevMode) {
        scene = null; clearSceneVideoState();
        scenePool = []; duelInfo = null; duelStagedScene = null;
        packMode = false; packRefFp = null; releasePack(); Object.keys(packPeers).forEach(k => delete packPeers[k]);
        players.forEach(p => { p.role = null; p.extraRoles = []; p.ready = false; p.timesSpectated = 0; p.timesPlayed = 0; p.eliminated = false; });
        if ($("scene-card")) $("scene-card").style.display = "none";
        broadcast({ t: "sceneReset" });
      }
      broadcastSettings();
      broadcastState();
      break;
    }
    case "loadScene": {
      const s = (msg.sceneId && sceneList.find(x => x.id === msg.sceneId))
        || (msg.sceneIdx != null ? sceneList[msg.sceneIdx] : null);
      if (!s) break;
      if (usingSceneIndex && !(s.lines && s.lines.length)) {
        // Zeilen erst nachladen, dann normal weitermachen
        ensureSceneLines(s).then(() => handleMsg(msg, conn));
        break;
      }
      resetForNewRound();
      clearSceneCaches();
      scene = JSON.parse(JSON.stringify(s));
      scene.blind = !!msg.blind;
      clearSceneVideoState();
      resetRoles();
      showScene(sceneVideoSrc());
      broadcast({ t: "again" });
      broadcast({ t: "scene", scene });
      broadcastSettings();
      broadcastState();
      break;
    }
    case "roulette": {
      if (!scene) break;
      const shuffledPlayers = mischen(players);
      const roleIds = mischen(scene.roles.map(r => r.id));
      const n = Math.min(roleIds.length, shuffledPlayers.length);
      players.forEach(p => { p.role = null; p.extraRoles = []; p.ready = false; });
      for (let i = 0; i < n; i++) shuffledPlayers[i].role = roleIds[i];
      broadcastState();
      renderRoles();
      break;
    }
    case "pickRandom":
      pickRandomScene();
      break;
    case "start":
      startSession();
      break;
    case "duelStart": {
      if (!msg.sceneId || msg.roleId == null || !msg.aId || !msg.bId) break;
      const s = sceneList.find(x => x.id === msg.sceneId);
      if (!s) break;
      if (usingSceneIndex && !(s.lines && s.lines.length)) {
        ensureSceneLines(s).then(() => handleMsg(msg, conn));
        break;
      }
      duelStagedScene = JSON.parse(JSON.stringify(s));
      duelInfo = { roleId: msg.roleId | 0, aId: msg.aId, bId: msg.bId };
      scene = JSON.parse(JSON.stringify(duelStagedScene));
      clearSceneVideoState();
      players.forEach(p => {
        p.role = (p.id === msg.aId || p.id === msg.bId) ? duelInfo.roleId : null; p.extraRoles = [];
        p.ready = true;
        p.loadPct = 0;
        p.videoReady = false;
      });
      Object.keys(duelSubs).forEach(k => delete duelSubs[k]);
      Object.keys(duelVotes).forEach(k => delete duelVotes[k]);
      broadcast({ t: "scene", scene });
      showScene(sceneVideoSrc());
      broadcast({ t: "duelSetupInfo", duelInfo });
      broadcastState();
      broadcast({ t: "goLines" });
      queueOrStartBooth();
      break;
    }
    case "forceMix":
      maybeFinishTracks(true);
      break;
    case "again":
      broadcast({ t: "again" });
      resetForNewRound();
      break;
    case "backScene":
      SFX.back();
      scene = null;
      broadcast({ t: "again" });
      resetForNewRound();
      if ($("scene-card")) $("scene-card").style.display = "none";
      break;
    case "packOn":
    case "packOff":
      packMode = (msg.cmd === "packOn");
      if (!packMode) { releasePack(); packRefFp = null; Object.keys(packPeers).forEach(k => delete packPeers[k]); }
      broadcast({ t: "packMode", on: packMode });
      renderPackUi();
      break;
    case "matchLobby":
      broadcast({ t: "matchLobby" });
      backToLobby();
      break;
    case "premGo":
      broadcastPremGoReliable();
      premStart();
      break;
    case "premPause":
      if (premPaused) premResumeAll(true);
      else premPauseAll(true);
      break;
    case "premOrig":
      premOrigOn = !!msg.on;
      if (Array.isArray(msg.muted)) premOrigMuted = new Set(msg.muted);
      if ($("prem-orig-master")) $("prem-orig-master").checked = premOrigOn;
      renderPremOrigPanel();
      broadcastPremOrig();
      invalidatePremCache();
      break;
    case "premReplay":
      broadcast({ t: "premReplay" });
      invalidatePremCache();
      playMix(false);
      break;
    case "playOuttakes":
      broadcast({ t: "playOuttakes" });
      playOuttakesReel();
      break;
    default:
      console.warn("unbekannter hostCmd", msg.cmd);
  }
}
function onHostHandoffMsg(msg) {
  if (!msg || !msg.newKey) return;
  absichtlichWeg = false;
  hostHandoffActive = false;
  clearTimeout(wvTimer);
  wvBannerAus();
  logicalHostKey = msg.newKey;
  applyLogicalHostLabels();
  syncHostUi();
  renderPlayers();
  renderRoles();
  if (msg.newKey === myKey) {
    showToast(tt("👑 You’re the host now!", "👑 Du bist jetzt Host!"), "join");
    SFX.ok();
    if (document.querySelector("#scr-lobby.active")) {
      status("lobby-status", tt("👑 You’re the host now!", "👑 Du bist jetzt Host!"));
    } else if (document.querySelector("#scr-wait.active")) {
      status("wait-status", tt("👑 You’re the host now — wait for the others …", "👑 Du bist jetzt Host — warte auf die anderen …"));
    }
  } else {
    showToast(tt("👑 New host: ", "👑 Neuer Host: ") + stripHostTag(msg.newName || "?"), "join");
  }
}

// Beim Wiederkommen hat die Person eine neue Peer-Adresse. Alles, was noch unter der
// alten Adresse abgelegt ist, muss mitwandern — sonst könnte sie z. B. zweimal abstimmen.
function idUmschreiben(alt, neu) {
  if (!alt || alt === neu) return;
  const ausMap = (m) => { if (m && m.has && m.has(alt)) { m.set(neu, m.get(alt)); m.delete(alt); } };
  const ausObj = (o) => { if (o && Object.prototype.hasOwnProperty.call(o, alt)) { o[neu] = o[alt]; delete o[alt]; } };
  const ausListe = (a) => Array.isArray(a) ? a.map(id => id === alt ? neu : id) : a;

  ausMap(allRatings); ausMap(cbScores); ausMap(rxScores); ausMap(tpScores);
  ausObj(duelVotes); ausObj(duelSubs); ausObj(mgWins);
  if (match && match.totals) ausObj(match.totals);
  if (match && match.buddyGivers) ausObj(match.buddyGivers);
  if (duelInfo) { if (duelInfo.aId === alt) duelInfo.aId = neu; if (duelInfo.bId === alt) duelInfo.bId = neu; }
  if (ttt) ttt.p = ausListe(ttt.p);
  if (rps) { rps.p = ausListe(rps.p); ausObj(rps.picks); ausObj(rps.wins); }
  if (dice) { dice.p = ausListe(dice.p); ausObj(dice.rolls); }
}

// In welcher Phase steckt die Runde gerade? Braucht ein Wiederkehrer, der die Seite
// zwischendurch neu geladen hat und deshalb nichts mehr weiß.
function aktuellePhase() {
  const aktiv = document.querySelector(".screen.active");
  return aktiv ? aktiv.id : "scr-lobby";
}
function broadcast(msg) { conns.forEach(c => { if (c.open) c.send(msg); }); }
let stateBroadcastTimer = null;
function flushStateBroadcast() {
  clearTimeout(stateBroadcastTimer);
  stateBroadcastTimer = null;
  // Phase mitschicken: Gaeste koennen sich damit selbst korrigieren, wenn eine
  // einzelne Steuer-Nachricht (z.B. "again") unterwegs verloren gegangen ist.
  const _phase = (document.querySelector(".screen.active") || {}).id || null;
  broadcast({ t: "state", players, logicalHostKey, premiereLocked: !!premiereLocked, premPaused: !!premPaused, hostPhase: _phase });
  checkStartable();
  checkAllDone();
  if (isHost) renderPremState();
}
// opts.throttle: Netzwerk kurz bündeln (z. B. Line-Fortschritt), UI trotzdem sofort
function broadcastState(opts) {
  renderPlayers();
  renderBoothPlayers();
  if (opts && opts.throttle) {
    clearTimeout(stateBroadcastTimer);
    stateBroadcastTimer = setTimeout(flushStateBroadcast, 300);
    checkStartable();
    if (isHost) renderPremState();
    return;
  }
  flushStateBroadcast();
}

// Nachrichten, die der Host von Gästen annehmen darf (alles andere ignorieren)
const HOST_IN = new Set([
  "hello", "bye", "pickRole", "ready", "progress", "loadProg", "tracks", "trackUpdate",
  "ttt", "rps", "dice", "draw", "rate", "mg", "emoji", "premReady", "premProg", "cb",
  "duelSubmit", "duelVote", "hostCmd", "packInfo"
]);
// Nachrichten, die Gäste vom Host annehmen dürfen
const GUEST_IN = new Set([
  "full", "state", "scene", "playerLeft", "playerOffline", "playerBack", "rejoined", "kicked",
  "hostHandoff",
  "settings", "sceneReset", "duelSetupInfo", "duelReady", "duelPlayGo", "duelVoteBroadcast",
  "duelResult", "wins", "nextRound", "matchEnd", "matchLobby", "videoMeta", "videoChunk",
  "goLines", "go", "mix", "outtakesPool", "playOuttakes", "tttState", "rpsState", "diceState",
  "drawState", "premGo", "premReplay", "premOrig", "premPlayerVol", "premAutoBal", "premPause", "premResume", "emojiShow", "rateResult",
  "rxGo", "tpGo", "mgResult", "cbGo", "cbResult", "again",
  "packState", "packScene", "packMode"
]);

let pendingPhaseRestore = null;

function seedLocalPlayer(role) {
  let me = players.find(p => p.id === myId);
  if (!me) {
    me = {
      id: myId, key: myKey, name: myName, avatar: myAvatar, accessory: myAccessory,
      role: role != null ? role : null, ready: false, done: 0, total: 0,
      loadPct: 0, videoReady: false
    };
    players.push(me);
  } else if (role !== undefined) {
    me.role = role;
  }
  return me;
}

function matchPayload() {
  return { mode: match.mode, rounds: match.rounds, round: match.round, autoRoulette: match.autoRoulette };
}

// Nach Reload / Rausflug / Spätbeitritt: auf Host-Phase springen
function applyPhaseRestore(msg) {
  if (msg.match) {
    match.mode = msg.match.mode; match.rounds = msg.match.rounds;
    match.round = msg.match.round; match.autoRoulette = msg.match.autoRoulette;
    renderSettingsView(msg.match);
  }
  if (msg.duelInfo) duelInfo = msg.duelInfo;
  if (msg.scene) {
    scene = msg.scene;
    if (!msg.hatVideoUebertragung) { revokeFetchedVideo(); videoBlobUrl = null; }
    showScene(sceneVideoSrc());
  }
  seedLocalPlayer(msg.role);

  const meine = aktuellePhase();
  const vorSpiel = ["scr-mic", "scr-avatar", "scr-start", "scr-lobby"].includes(meine);
  const habeStand = myLines.length > 0 || mixItems.length > 0;
  const hostSchonWeiter = ["scr-playback", "scr-final", "scr-duel-vote", "scr-rate"].includes(msg.phase) && meine !== msg.phase;
  // Host schon wieder in der Lobby / Szenenwahl → Gast MUSS mit — sonst hängt er in Booth/Wait ohne Szene
  const hostInLobby = !msg.phase || msg.phase === "scr-lobby" || msg.phase === "scr-start";

  if (!msg.forceRestore && habeStand && !vorSpiel && !hostSchonWeiter && !hostInLobby) {
    showToast(tt("🔌 Back in — just keep going!", "🔌 Wieder drin — mach einfach weiter!"), "join");
    SFX.ok();
    return;
  }

  // Eigenes Video kommt noch per Chunks — danach hier weitermachen
  if (msg.hatVideoUebertragung && !videoBlobUrl) {
    pendingPhaseRestore = Object.assign({}, msg, { forceRestore: true });
    wvBanner(tt("🔌 Getting the video from the host …", "🔌 Hole Video vom Host …"));
    return;
  }
  pendingPhaseRestore = null;
  wvBannerAus();

  const leaveBtn = $("leave-btn");
  if (leaveBtn) leaveBtn.style.display = "";

  if (msg.phase === "scr-playback" && msg.mix) {
    if (!scene) { enterLobby(raumCode); return; }
    loadMix(msg.mix, msg).then(() => {
      if (msg.ratingOpen) {
        premiereLocked = true;
        pendingRate = false;
        status("play-status", tt("🔌 Back in — rating is running …", "🔌 Wieder drin — Bewertung läuft …"));
        if (!rateSent) showRateCard();
      } else if (msg.premiereLocked) {
        // Host hat schon gestartet — nicht ewig auf premGo warten
        premStart({ skipCountdown: true });
        status("play-status", tt("🔌 Back in — premiere is running …", "🔌 Wieder drin — Premiere läuft …"));
      }
    }).catch(e => console.warn("Rejoin-Premiere:", e));
  } else if (msg.phase === "scr-booth") {
    if (msg.role != null && scene) {
      queueOrStartBooth();
      showToast(tt("🔌 Back in — you got your role back", "🔌 Wieder drin — deine Rolle hast du zurück"), "join");
    } else {
      show("scr-wait");
      status("wait-status", tt("🔌 Back in — you’re watching / waiting for the premiere …", "🔌 Wieder drin — du schaust zu / warte auf die Premiere …"));
    }
  } else if (msg.phase === "scr-wait" || msg.phase === "scr-record") {
    show("scr-wait");
    status("wait-status", tt("🔌 Back in — wait for the others …", "🔌 Wieder drin — warte auf die anderen …"));
  } else if (msg.phase === "scr-rate" || msg.ratingOpen) {
    show("scr-playback");
    status("play-status", tt("🔌 Back in — rating is running …", "🔌 Wieder drin — Bewertung läuft …"));
    if (msg.mix) {
      loadMix(msg.mix, msg).then(() => { if (!rateSent) showRateCard(); }).catch(() => { if (!rateSent) showRateCard(); });
    } else if (!rateSent) showRateCard();
  } else if (msg.phase === "scr-duel-vote") {
    show("scr-duel-vote");
    status("duel-vote-status", tt("🔌 Back in — vote now!", "🔌 Wieder drin — stimme jetzt ab!"));
  } else if (msg.phase === "scr-final") {
    show("scr-final");
  } else {
    enterLobby(raumCode);
    // Szene erneut sichtbar machen (enterLobby allein zeigt die Karte nicht)
    if (scene) {
      const card = $("scene-card");
      if (card) card.style.display = "";
      renderRoles();
      renderPlayers();
      if (scene.videoUrl && !myVideoReady) {
        // Load kann schon laufen — Status trotzdem an Host melden
        reportLoadProgress(myLoadPct, myVideoReady);
      } else if (scene.videoUrl && myVideoReady) {
        reportLoadProgress(100, true);
      }
    }
  }
  SFX.ok();
}

function handleMsg(msg, conn) {
  if (!msg || !msg.t) return;
  if (isHost && !HOST_IN.has(msg.t)) return;
  if (!isHost && !GUEST_IN.has(msg.t)) return;

  switch (msg.t) {
    // — Host ← Gast —
    case "hello": {
      // Verbindung sofort in conns — sonst verpasst broadcast den Neuankömmling
      if (conn && conn.peer) conns.set(conn.peer, conn);
      const pushRoster = () => {
        try {
          if (conn && conn.open) {
            conn.send({ t: "state", players, logicalHostKey, premiereLocked: !!premiereLocked, premPaused: !!premPaused });
          }
        } catch {}
      };
      const samePeer = players.find(p => p.id === conn.peer);
      if (samePeer) {
        if (msg.name) samePeer.name = stripHostTag(msg.name);
        if (msg.avatar) samePeer.avatar = msg.avatar;
        if (msg.accessory) samePeer.accessory = msg.accessory;
        if (msg.key && !samePeer.key) samePeer.key = msg.key;
        applyLogicalHostLabels();
        pushRoster();
        broadcastState();
        break;
      }

      const rueck = msg.key ? players.find(p => p.key === msg.key) : null;
      if (rueck) {
        const alteId = rueck.id;
        clearTimeout(rueckkehrTimer.get(msg.key)); rueckkehrTimer.delete(msg.key);
        rueck.id = conn.peer;
        rueck.offline = false; delete rueck.offlineBis; delete rueck.offlineSeit;
        if (msg.name) rueck.name = stripHostTag(msg.name);
        if (msg.avatar) rueck.avatar = msg.avatar;
        if (msg.accessory) rueck.accessory = msg.accessory;
        applyLogicalHostLabels();
        idUmschreiben(alteId, conn.peer);
        players = players.filter(p => p === rueck || !p.key || p.key !== msg.key);
        const oldC = conns.get(alteId);
        if (oldC && oldC !== conn) {
          try { oldC.close(); } catch {}
          conns.delete(alteId);
        }
        // Szene-Metadaten IMMER mitschicken (auch bei eigenem Video) — sonst crasht loadMix
        // players direkt im rejoined — nach Host-Wechsel sonst oft leere Liste beim Ex-Host
        conn.send({
          t: "rejoined", phase: aktuellePhase(), role: rueck.role,
          forceRestore: true,
          scene: scene || null,
          players,
          logicalHostKey,
          hatVideoUebertragung: !!(scene && localVideoBuf),
          match: matchPayload(),
          duelInfo, mix: finalTracksData,
          ...metaMapsFromTracks(finalTracksData),
          ...rejoinPlaybackFlags(),
        });
        if (scene && localVideoBuf) sendLocalVideo(conn);
        conn.send({ t: "drawState", drawBoard, drawEpoch });
        pushRoster();
        showToast("🔌 " + rueck.name + tt(" is back!", " ist wieder da!"), "join");
        SFX.ok();
        broadcast({ t: "playerBack", name: rueck.name });
        broadcastState();
        syncForceMixBtn();
        break;
      }
      if (players.length >= 8) { conn.send({ t: "full", cap: 8 }); setTimeout(() => conn.close(), 500); break; }
      players.push({ id: conn.peer, key: msg.key || null, name: stripHostTag(msg.name), avatar: msg.avatar || null, accessory: msg.accessory || null, role: null, ready: false, done: 0, total: 0, loadPct: 0, videoReady: false });
      applyLogicalHostLabels();
      if (scene) { if (localVideoBuf) sendLocalVideo(conn); else conn.send({ t: "scene", scene }); }
      conn.send({ t: "drawState", drawBoard, drawEpoch });
      // Spät dazukommen mitten in der Runde → in die laufende Phase holen
      const ph = aktuellePhase();
      if (ph && ph !== "scr-lobby" && ph !== "scr-start") {
        conn.send({
          t: "rejoined", phase: ph, role: null, forceRestore: true,
          scene: scene || null,
          players,
          logicalHostKey,
          hatVideoUebertragung: !!(scene && localVideoBuf),
          match: matchPayload(),
          duelInfo, mix: finalTracksData,
          ...metaMapsFromTracks(finalTracksData),
          ...rejoinPlaybackFlags(),
        });
      }
      pushRoster();
      broadcastState();
      break;
    }
    case "bye": {
      const p = players.find(p => p.id === conn.peer);
      if (p) { p.gehtFreiwillig = true; endgueltigWeg(p); }
      break;
    }
    case "hostCmd": {
      if (!isHost || !msg.cmd) break;
      const sender = players.find(p => p.id === conn.peer);
      if (!sender || !sender.key || sender.key !== logicalHostKey) break;
      handleHostCmd(msg, sender);
      break;
    }
    case "pickRole": {
      if (msg.drop) {
      const p0 = players.find(p => p.id === conn.peer);
      if (p0) { rolleAbgeben(p0, msg.role); p0.ready = false; }
      broadcastState(); renderRoles(); checkStartable();
      break;
    }
    const taken = players.some(p => p.id !== conn.peer && rolesOfPlayer(p).includes(msg.role));
      if (!taken) {
        const p = players.find(p => p.id === conn.peer);
        if (p) { rolleUebernehmen(p, msg.role); p.ready = false; }
      }
      broadcastState(); renderRoles(); checkStartable(); break;
    }
    case "ready": {
      const p = players.find(p => p.id === conn.peer);
      if (p) {
        // Rolle ggf. mit dem Ready-Request mitschicken — Roundtrip von pickRole kann sonst noch fehlen
        if (msg.role != null && !players.some(o => o.id !== p.id && rolesOfPlayer(o).includes(msg.role))) {
          rolleUebernehmen(p, msg.role);
        }
        if (p.role != null) p.ready = true;
      }
      broadcastState();
      break;
    }
    case "progress": { const p = players.find(p => p.id === conn.peer); if (p) { p.done = msg.done; p.total = msg.total; } broadcastState({ throttle: true }); break; }
    case "loadProg": {
      const p = players.find(p => p.id === conn.peer);
      if (p) { p.loadPct = msg.pct | 0; p.videoReady = !!msg.ready; }
      broadcastState({ throttle: !msg.ready });
      break;
    }
    case "premProg": {
      const p = players.find(p => p.id === conn.peer);
      if (p) {
        p.premPct = Math.max(0, Math.min(100, msg.pct | 0));
        if (msg.ready) p.prem = true;
      }
      broadcastState({ throttle: !msg.ready });
      renderPremState();
      break;
    }
    case "tracks": collectTracks(msg.role, attachTrackMeta(msg.items, msg), msg.outtakes, conn.peer); break;
    case "trackUpdate": {
      const tm = msg.trackMeta || msg;
      if (msg.buf != null) {
        applyTrackUpdate(msg.role, msg.lineIdx, msg.startAt, msg.buf, tm.effect, tm.gate, tm.boost, tm.fxAmount, tm.pan);
      }
      if (msg.outtakes) {
        const p = players.find(x => x.id === conn.peer);
        ingestOuttakesFromPlayer(conn.peer, (p && p.name) || msg.name, msg.outtakes);
      }
      break;
    }
    case "ttt": tttHandle(msg.a, conn.peer); break;
    case "rps": rpsHandle(msg.a, conn.peer); break;
    case "dice": diceHandle(msg.a, conn.peer); break;
    case "draw": drawHandle(msg.a, conn.peer); break;
    case "rate": collectRating(conn.peer, msg.scores, msg.buddy); break;
    case "mg":
      if (msg.k === "rxStart") { const d = 1500 + Math.random() * 3500; broadcast({ t: "rxGo", delay: d }); rxRun(d); }
      if (msg.k === "tpStart") { const phs = tpPhrases(); const ph = phs[Math.floor(Math.random() * phs.length)]; broadcast({ t: "tpGo", phrase: ph }); tpRun(ph); }
      if (msg.k === "rxScore") mgScore("rx", conn.peer, msg.ms);
      if (msg.k === "tpScore") mgScore("tp", conn.peer, msg.ms);
      break;
    case "emoji": emojiBroadcast(conn.peer, msg.char); break;
    case "premReady": {
      const p = players.find(p => p.id === conn.peer);
      if (p) p.prem = true;
      broadcastState();
      renderPremState();
      broadcastPremOrig();
      break;
    }
    case "cb":
      if (msg.a && msg.a.k === "start") { broadcast({ t: "cbGo" }); cbRun(); }
      if (msg.a && msg.a.k === "score") cbScore(conn.peer, msg.a.n);
      break;
    case "packInfo": collectPackInfo(conn.peer, msg); break;
    case "duelSubmit": collectDuelSubmit(conn.peer, attachTrackMeta(msg.items, msg)); break;
    case "duelVote": collectDuelVote(conn.peer, msg.choice); break;

    // — Gast ← Host —
    case "full":
      status("start-status", tt("Room is full (max. ", "Raum ist voll (max. ") + (msg.cap || 8) + tt(" players). 😅", " Spieler). 😅"), true);
      show("scr-start"); break;
    case "state":
      hostHandoffActive = false;
      players = msg.players || [];
      // Selbstheilung: Host ist in der Lobby, wir haengen noch woanders fest -> nachziehen.
      // Ohne das bleibt ein Gast fuer immer haengen, wenn die "again"-Nachricht verloren ging.
      if (msg.hostPhase === "scr-lobby" && !iAmLogicalHost()) {
        const _cur = (document.querySelector(".screen.active") || {}).id;
        const _stuck = ["scr-playback", "scr-final", "scr-booth", "scr-record", "scr-wait"];
        if (_stuck.includes(_cur)) { try { resetForNewRound(); } catch (e) { show("scr-lobby"); } }
      }
      if (msg.logicalHostKey) logicalHostKey = msg.logicalHostKey;
      try { if (scene) renderRoles(); } catch {}
      // Eigenen Lade-Stand nicht durch veralteten Host-Snapshot überschreiben
      {
        const me = players.find(p => p.id === myId);
        if (me && scene && scene.videoUrl) {
          me.loadPct = Math.max(me.loadPct || 0, myLoadPct || 0);
          if (myVideoReady) me.videoReady = true;
        }
        if (me && me.prem) { /* host says we're ready */ }
        else if (me && mixItems.length && myPremLocalReady) {
          me.prem = true;
          me.premPct = Math.max(me.premPct || 0, 100);
        }
      }
      renderPlayers();
      renderRoles();
      renderBoothPlayers();
      if (iAmLogicalHost()) {
        syncHostUi();
        checkStartable();
        syncForceMixBtn();
      }
      if (document.querySelector("#scr-playback.active")) renderPremStateGuest();
      // Host hat Premiere schon gestartet, unsere premGo-Nachricht kam aber zu spät / ging unter
      if (msg.premiereLocked && !isHost) tryFollowHostPremiere(!!msg.premPaused);
      break;
    case "scene": {
      scene = msg.scene; clearSceneVideoState(); clearSceneCaches();
      // Alte „Video fertig“-Flags der Vorrunde sonst bleiben hängen
      players.forEach(p => { p.loadPct = 0; p.videoReady = false; p.ready = false; p.done = 0; p.total = 0; });
      const phSc = aktuellePhase();
      if (phSc !== "scr-lobby" && phSc !== "scr-start" && phSc !== "scr-mic" && phSc !== "scr-avatar") {
        resetForNewRound();
      } else {
        show("scr-lobby");
      }
      showScene(sceneVideoSrc());
      if (iAmLogicalHost()) { syncHostUi(); checkStartable(); }
      break;
    }
    case "playerLeft": showToast("👋 " + msg.name + tt(" left the room", " hat den Raum verlassen"), "leave"); SFX.leave(); break;
    case "playerOffline": showToast("📴 " + msg.name + tt(" dropped — seat stays free", " ist rausgeflogen — Platz bleibt frei"), "leave"); break;
    case "playerBack": showToast("🔌 " + msg.name + tt(" is back!", " ist wieder da!"), "join"); SFX.ok(); break;
    case "kicked":
      absichtlichWeg = true;
      clearTimeout(wvTimer); wvVersuch = 0; wvBannerAus();
      leaveRoom(tt("You were kicked from the room by the host.", "Du wurdest vom Host aus dem Raum gekickt."));
      break;
    case "hostHandoff":
      onHostHandoffMsg(msg);
      break;
    case "rejoined":
      hostHandoffActive = false;
      wvVersuch = 0; clearTimeout(wvTimer); wvBannerAus();
      if (msg.logicalHostKey) logicalHostKey = msg.logicalHostKey;
      if (Array.isArray(msg.players) && msg.players.length) {
        players = msg.players;
        renderPlayers();
        renderRoles();
        renderBoothPlayers();
      }
      if (iAmLogicalHost()) syncHostUi();
      applyPhaseRestore(msg);
      break;
    case "settings":
      match.mode = msg.mode; match.rounds = msg.rounds; match.round = msg.round; match.autoRoulette = msg.autoRoulette;
      renderSettingsView(msg);
      if (iAmLogicalHost()) syncHostUi();
      break;
    case "sceneReset": {
      scene = null; clearSceneVideoState(); clearSceneCaches();
      const phRs = aktuellePhase();
      if (phRs !== "scr-lobby" && phRs !== "scr-start" && phRs !== "scr-mic" && phRs !== "scr-avatar") {
        resetForNewRound();
      }
      const card = $("scene-card"); if (card) card.style.display = "none";
      renderPlayers();
      break;
    }
    case "packMode":
      packMode = !!msg.on;
      if (!packMode) { releasePack(); Object.keys(packPeers).forEach(k => delete packPeers[k]); }
      renderPackUi();
      break;
    case "packState":
      packRefFp = msg.ref || null;
      Object.keys(packPeers).forEach(k => delete packPeers[k]);
      (msg.list || []).forEach(e => { if (e && e.id) packPeers[e.id] = { fp: e.fp || null, title: e.title, lines: e.lines | 0, roles: e.roles | 0 }; });
      renderPackUi();
      break;
    case "packScene": adoptPackScene(msg); break;
    case "duelSetupInfo": duelInfo = msg.duelInfo; break;
    case "duelReady":
      attachMetaToTracks(msg.dataA, msg.metaA || msg);
      attachMetaToTracks(msg.dataB, msg.metaB || msg);
      loadDuelSequence(msg.dataA, msg.dataB, msg.duelInfo);
      break;
    case "duelPlayGo": if (window.__duelRunSequence) { window.__duelRunSequence(); window.__duelRunSequence = null; } break;
    case "duelVoteBroadcast": showDuelVoteLive(msg.tally); break;
    case "duelResult": showDuelResult(msg.result); break;
    case "wins": Object.assign(mgWins, msg.wins); renderWins(); break;
    case "nextRound":
      match.round = msg.round; players = msg.players;
      if (msg.scene) { scene = msg.scene; clearSceneVideoState(); clearSceneCaches(); backToLobby(true); showScene(sceneVideoSrc()); renderSettingsView(); status("lobby-status", tt("🎲 Round ", "🎲 Runde ") + match.round + tt(": new scene & roles! Hit “I’m ready”.", ": neue Szene & Rollen! „Bin bereit“ drücken.")); }
      else startNewRound();
      break;
    case "matchEnd": showFinal(msg.list, msg.rounds, msg.championName); break;
    case "matchLobby": backToLobby(); break;
    case "videoMeta": startVideoReceive(msg); break;
    case "videoChunk": receiveVideoChunk(msg.buf); break;
    case "goLines": queueOrStartBooth(); break;
    case "go": queueOrStartRealtime(); break;
    case "mix": loadMix(msg.data, msg); break;
    case "outtakesPool":
      outtakes = dedupeOuttakes(Array.isArray(msg.items) ? msg.items : []).map(o => {
        let buf = o && o.buf;
        try {
          if (buf instanceof ArrayBuffer) buf = buf.slice(0);
          else if (ArrayBuffer.isView(buf)) buf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        } catch {}
        return { ...o, buf };
      }).filter(o => outtakeBufOk(o.buf));
      outtakesCache = null;
      resolveOuttakesCachePending(null);
      updateOuttakesBtn();
      scheduleOuttakesPrecache();
      break;
    case "playOuttakes":
      // Host spielt lokal selbst — Echo/Doppelstart vermeiden
      if (!isHost) playOuttakesReel();
      break;
    case "tttState": ttt = msg.ttt; renderTTT(); break;
    case "rpsState": rps = msg.rps; renderRPS(); break;
    case "diceState": dice = msg.dice; renderDice(); break;
    case "drawState":
      // Host ist Autorität — Epoch vom Host übernehmen (Raum-Wechsel / Rejoin)
      if (msg.drawEpoch != null) drawEpoch = msg.drawEpoch;
      if (msg._clear) {
        drawBoard = { strokes: [] };
        renderDrawBoard();
        break;
      }
      if (msg.drawBoard && Array.isArray(msg.drawBoard.strokes)) {
        mergeDrawBoard(msg.drawBoard);
        renderDrawBoard();
      }
      break;
    case "premGo":
      onPremGoMsg(msg);
      break;
    case "premReplay":
      invalidatePremCache();
      playMix(false);
      break;
    case "premOrig": applyPremOrigMsg(msg); break;
    case "premPlayerVol": applyPremPlayerGainsMsg(msg); break;
    case "premAutoBal": applyPremAutoBalMsg(msg); break;
    case "premPause": premPauseAll(false, msg.tVideo); break;
    case "premResume": premResumeAll(false, msg.tVideo); break;
    case "emojiShow": showEmoji(msg.pid, msg.char); break;
    case "rateResult": showRateResult(msg.results, msg.eliminatedName); break;
    case "rxGo": rxRun(msg.delay); break;
    case "tpGo": tpRun(msg.phrase); break;
    case "mgResult": mgShowResult(msg.game, msg.list); break;
    case "cbGo": cbRun(); break;
    case "cbResult": cbShowResult(msg.list); break;
    case "again": resetForNewRound(); break;
  }
}


// ═════════════════════════════════════════════════════════════
// 3) SZENEN
// ═════════════════════════════════════════════════════════════
let sceneList = [];

/** Scene title for UI: “(N Rollen)” ↔ “(N roles)” by language. */
function sceneTitleDisplay(title) {
  if (!title) return "";
  const t = String(title);
  if (getLang() === "de") {
    return t
      .replace(/\((\d+)\s*roles\)/gi, "($1 Rollen)")
      .replace(/\((\d+)\s*role\)/gi, "($1 Rolle)");
  }
  return t
    .replace(/\((\d+)\s*Rollen\)/gi, "($1 roles)")
    .replace(/\((\d+)\s*Rolle\)/gi, "($1 role)");
}
function roleCountLabel(n) {
  if (getLang() === "de") return n + (n === 1 ? " Rolle" : " Rollen");
  return n + (n === 1 ? " role" : " roles");
}

// ── Schwierigkeitsgrad einer Szene (automatisch berechnet aus Tempo & Zeitfenstern) ──
function sceneDifficulty(s) {
  const easy = { label: tt("Easy", "Leicht"), emoji: "🟢" };
  const medium = { label: tt("Medium", "Mittel"), emoji: "🟡" };
  const hard = { label: tt("Tongue twister", "Zungenbrecher"), emoji: "🔴" };
  if (s.difficultyOverride) {
    const map = { easy, medium, hard };
    if (map[s.difficultyOverride]) return map[s.difficultyOverride];
  }
  // Ohne geladene Zeilen den beim Index-Bau vorberechneten Wert verwenden
  if (!s.lines || !s.lines.length) {
    const map = { easy, medium, hard };
    return s.difficultyPre ? (map[s.difficultyPre] || null) : null;
  }
  const lines = s.lines;
  const dur = Math.max(...lines.map(l => l.end)) - Math.min(...lines.map(l => l.t));
  const words = lines.reduce((sum, l) => sum + (l.text || "").split(/\s+/).filter(Boolean).length, 0);
  const wps = words / Math.max(1, dur);
  const avgWin = lines.reduce((sum, l) => sum + (l.end - l.t), 0) / lines.length;
  const avgWords = words / lines.length;
  const score = wps * 1.4 - avgWin * 0.25 + avgWords * 0.05;
  if (score < 2.0) return easy;
  if (score < 3.2) return medium;
  return hard;
}

const HINTEN_ANSTELLEN = new Set(["testplace"]);

let usingSceneIndex = false;
const sceneLinesCache = new Map();   // id -> lines, damit dieselbe Szene nur einmal geholt wird

// Holt die Zeilen einer Szene nach. Ist der Index nicht in Gebrauch (alte Struktur),
// sind die Zeilen bereits da und es passiert nichts.
async function ensureSceneLines(s) {
  if (!s) return s;
  if (Array.isArray(s.lines) && s.lines.length) return s;
  if (!usingSceneIndex) return s;
  if (sceneLinesCache.has(s.id)) { s.lines = sceneLinesCache.get(s.id); return s; }
  try {
    const r = await fetch("scenedata/" + encodeURIComponent(s.id) + ".json", { cache: "default" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const data = await r.json();
    const lines = data.lines || [];
    sceneLinesCache.set(s.id, lines);
    s.lines = lines;
    // auch im Listeneintrag hinterlegen, damit spaetere Zugriffe direkt passen
    const inList = sceneList.find(x => x.id === s.id);
    if (inList && inList !== s) inList.lines = lines;
  } catch (e) {
    console.error("Zeilen der Szene konnten nicht geladen werden:", s.id, e);
    s.lines = s.lines || [];
  }
  return s;
}

let sceneListLoaded = false, sceneListLoading = null;
async function loadSceneList(force) {
  const sel = $("scene-select");
  if (!sel) return;
  // Mehrfachaufrufe abfangen: die Liste wird an mehreren Stellen angestossen
  // (Raum erstellen, Modus wechseln, Runde beenden) -- ohne das laedt sie 3x.
  if (sceneListLoading) return sceneListLoading;
  if (sceneListLoaded && !force) { renderRoleFilter(); renderSceneGrid(); return; }
  sceneListLoading = (async () => {
  try {
    // Beim Start reicht ein schlanker Index (~54 KB): Titel, Rollen, Bilder.
    // Die Zeilen einer Szene (zusammen ~480 KB) werden erst geholt, wenn sie
    // wirklich gebraucht werden. Das spart beim Laden rund 94 %.
    // Der Index hängt an der Versionsnummer statt an einem Zeitstempel: so darf der
    // Browser ihn behalten (spart 57 KB bei jedem weiteren Besuch), holt ihn aber
    // garantiert neu, sobald APP_VERSION steigt. Wichtig: nach jeder Szenen-Änderung
    // APP_VERSION hochzählen, sonst sehen Wiederkehrer die neue Szene nicht.
    let ok = false;
    try {
      const r = await fetch("scenes-index.json?v=" + APP_VERSION, { cache: "default" });
      if (r.ok) {
        const data = await r.json();
        // Nur uebernehmen, wenn es wirklich eine Liste ist. Eine beschaedigte oder
        // halb hochgeladene Datei wuerde sonst den ganzen Start lahmlegen.
        if (Array.isArray(data) && data.length) { sceneList = data; usingSceneIndex = true; ok = true; }
        else console.error("scenes-index.json unbrauchbar, weiche auf scenes.json aus");
      }
    } catch (_) {}
    if (!ok) {
      // Kein (brauchbarer) Index -> wie bisher die komplette Datei laden
      const res = await fetch("scenes.json?v=" + APP_VERSION, { cache: "default" });
      const full = await res.json();
      sceneList = Array.isArray(full) ? full : [];
      usingSceneIndex = false;
    }
  } catch (e) {
    console.error("Szenenliste laden fehlgeschlagen:", e);
    sceneList = [];
  }
  // Test-Szenen gehören ans Ende: sie sind nur zum Ausprobieren da und sollen beim
  // Durchschauen nicht im Weg stehen. Alles andere behält seine Reihenfolge.
  sceneList = [...sceneList.filter(s => !HINTEN_ANSTELLEN.has(s.id)), ...sceneList.filter(s => HINTEN_ANSTELLEN.has(s.id))];
  sel.innerHTML = sceneList.length
    ? sceneList.map((s, i) => {
        const d = sceneDifficulty(s);
        return `<option value="${i}">${d ? d.emoji + " " : ""}${esc(sceneTitleDisplay(s.title))} (${roleCountLabel(s.roles.length)}${(s.lines && s.lines.length) || s.lineCount ? ", " + ((s.lines && s.lines.length) || s.lineCount) + " lines" : ""}${d ? " · " + d.label : ""})</option>`;
      }).join("")
    : `<option>${tt("— Loading scenes… wait a sec & reload —", "— Szenen laden… kurz warten & Seite neu laden —")}</option>`;
  renderRoleFilter();
  renderSceneGrid();
  sceneListLoaded = true;
  })();
  try { await sceneListLoading; } finally { sceneListLoading = null; }
}

// ── Szenen-Auswahl als Bild-Raster ──
// Das <select> bleibt als unsichtbare Quelle der Wahrheit erhalten, damit der restliche
// Code (Laden-Knopf, Duell, Roulette) unverändert damit weiterarbeiten kann.
let sceneRoleFilter = "all";   // "all" | "2" | "3" | … | "7p" (≥7)

function renderRoleFilter() {
  const bar = $("role-filter");
  if (!bar) return;
  const counts = {};
  for (const s of sceneList) {
    const n = (s.roles || []).length;
    if (!n) continue;
    const key = n >= 7 ? "7p" : String(n);
    counts[key] = (counts[key] || 0) + 1;
  }
  const chips = [{ key: "all", label: tt("All", "Alle") }];
  for (let n = 1; n <= 6; n++) if (counts[String(n)]) chips.push({ key: String(n), label: roleCountLabel(n) });
  if (counts["7p"]) chips.push({ key: "7p", label: "7+" });
  if (!counts[sceneRoleFilter] && sceneRoleFilter !== "all") sceneRoleFilter = "all";
  bar.innerHTML = `<span class="rf-label">${tt("Roles", "Rollen")}</span>` + chips.map(c =>
    `<button type="button" class="rf-chip${c.key === sceneRoleFilter ? " on" : ""}" data-rf="${c.key}">${c.label}</button>`
  ).join("");
  bar.querySelectorAll(".rf-chip").forEach(btn => {
    btn.onclick = () => {
      sceneRoleFilter = btn.dataset.rf;
      bar.querySelectorAll(".rf-chip").forEach(b => b.classList.toggle("on", b.dataset.rf === sceneRoleFilter));
      SFX.click();
      renderSceneGrid();
    };
  });
}

function renderSceneGrid(filter) {
  const grid = $("scene-grid");
  if (!grid) return;
  const q = (filter == null ? ($("scene-search") ? $("scene-search").value : "") : filter).trim().toLowerCase();
  const hits = sceneList
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => {
      const n = (s.roles || []).length;
      if (sceneRoleFilter === "7p") { if (n < 7) return false; }
      else if (sceneRoleFilter !== "all" && n !== parseInt(sceneRoleFilter, 10)) return false;
      if (!q) return true;
      return (sceneTitleDisplay(s.title) + " " + s.title + " " + (s.roles || []).map(r => r.name).join(" ")).toLowerCase().includes(q);
    });

  if (!sceneList.length) {
    grid.innerHTML = `<p class="sub" style="grid-column:1/-1">${tt("Loading scenes… wait a moment and reload the page.", "Szenen laden … kurz warten und Seite neu laden.")}</p>`;
    return;
  }
  if (!hits.length) {
    const tip = sceneRoleFilter !== "all" ? tt(" with this role filter", " mit diesem Rollen-Filter") : "";
    grid.innerHTML = `<p class="sub" style="grid-column:1/-1">${tt("No scene matches", "Keine Szene passt")}${q ? " “" + esc(q) + "”" : ""}${tip}.</p>`;
    return;
  }

  const sel = $("scene-select");
  // Steht die aktuell gewählte Szene nicht in den Suchtreffern, rutscht die Auswahl
  // auf den ersten Treffer — sonst würde „Laden“ eine Szene starten, die gar nicht zu sehen ist.
  if (sel && !hits.some(h => String(h.i) === String(sel.value))) sel.value = String(hits[0].i);
  const current = sel ? String(sel.value) : "0";
  grid.innerHTML = hits.map(({ s, i }) => {
    const d = sceneDifficulty(s);
    const faces = Object.values(s.avatars || {}).slice(0, 4)
      .map(src => `<img src="${esc(assetUrl(src))}" alt="" loading="lazy" decoding="async">`)
      .join("");
    return `<button type="button" class="scene-tile${String(i) === current ? " sel" : ""}" data-i="${i}">
      <span class="st-thumb">${faces ? `<span class="st-faces">${faces}</span>` : `<span class="st-ph">🎬</span>`}<span class="st-badge">${roleCountLabel(s.roles.length).replace(" ", "&nbsp;")}</span></span>
      <span class="st-title">${esc(sceneTitleDisplay(s.title))}</span>
      <span class="st-meta">${d ? d.emoji + " " + esc(d.label) : "—"}${(s.lines && s.lines.length) || s.lineCount ? " · " + ((s.lines && s.lines.length) || s.lineCount) + " lines" : ""}</span>
    </button>`;
  }).join("");

  grid.querySelectorAll(".scene-tile").forEach(tile => {
    tile.onclick = () => {
      const alreadyPicked = tile.classList.contains("sel");
      grid.querySelectorAll(".scene-tile.sel").forEach(t => t.classList.remove("sel"));
      tile.classList.add("sel");
      if (sel) sel.value = tile.dataset.i;
      SFX.click();
      if (alreadyPicked) $("btn-load-scene").click();   // zweiter Klick auf dieselbe Szene lädt sie direkt
    };
  });
}
$("scene-search") && ($("scene-search").oninput = () => renderSceneGrid());

// Spielmodus: große Taster statt kleinem Dropdown — wählt intern weiter das <select>
function syncModePicker(mode) {
  const m = mode || ($("set-mode") && $("set-mode").value) || "free";
  if ($("set-mode")) $("set-mode").value = m;
  document.querySelectorAll("#mode-picker .mode-btn").forEach(btn => {
    const on = btn.dataset.mode === m;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}
$("mode-picker") && $("mode-picker").querySelectorAll(".mode-btn").forEach(btn => {
  btn.onclick = () => {
    if (!iAmLogicalHost()) return;
    syncModePicker(btn.dataset.mode);
    SFX.click();
    hostSettingsChanged();
  };
});
syncModePicker();

// ── 🔍 Selbst-Check: prüft, ob wirklich alle in scenes.json referenzierten Dateien existieren ──
function filesOfScene(s) {
  const out = [];
  if (s.videoUrl) out.push(assetUrl(s.videoUrl));
  if (s.voiceTrack) out.push(assetUrl(s.voiceTrack));
  for (const a of Object.values(s.avatars || {})) out.push(assetUrl(a));
  for (const l of (s.lines || [])) if (l.orig) out.push(assetUrl(l.orig));
  return [...new Set(out)];   // Duplikate raus, spart Anfragen
}
async function checkFileExists(url) {
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store" });
    return res.ok;
  } catch { return false; }
}
async function runWithLimit(tasks, limit) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (i < tasks.length) {
      const idx = i++;
      results[idx] = await tasks[idx]();
    }
  });
  await Promise.all(workers);
  return results;
}
$("btn-check-scenes") && ($("btn-check-scenes").onclick = async () => {
  const btn = $("btn-check-scenes");
  btn.disabled = true;
  $("check-result").style.display = "none";
  $("check-bar").style.display = "";
  setBar("check-bar", 0);

  // Alle Datei-Referenzen aus allen Szenen einsammeln
  const jobs = [];
  for (const s of sceneList) for (const f of filesOfScene(s)) jobs.push({ sceneId: s.id, title: s.title, file: f });
  if (!jobs.length) { status("check-status", tt("No scenes loaded.", "Keine Szenen geladen."), true); btn.disabled = false; $("check-bar").style.display = "none"; return; }

  let done = 0;
  const tasks = jobs.map(j => async () => {
    const ok = await checkFileExists(j.file);
    done++;
    setBar("check-bar", Math.round(done / jobs.length * 100));
    status("check-status", tt("Checking … ", "Prüfe … ") + done + "/" + jobs.length);
    return { ...j, ok };
  });
  const results = await runWithLimit(tasks, 8);   // max. 8 gleichzeitig, sonst überlastet's den Browser

  // Fehlende Dateien nach Szene gruppieren
  const broken = results.filter(r => !r.ok);
  const bySc = {};
  for (const b of broken) (bySc[b.sceneId] = bySc[b.sceneId] || { title: b.title, files: [] }).files.push(b.file);

  $("check-bar").style.display = "none";
  const el = $("check-result");
  el.style.display = "";
  if (!broken.length) {
    status("check-status", "");
    el.innerHTML = `<div class="raterow" style="border-color:var(--ok)"><span>✅ ${tt("All good — all ", "Alles in Ordnung — alle ")}${jobs.length}${tt(" files from ", " Dateien aus ")}${sceneList.length}${tt(" scenes are reachable.", " Szenen sind erreichbar.")}</span></div>`;
  } else {
    status("check-status", "");
    el.innerHTML = `<div class="raterow" style="border-color:var(--hot);margin-bottom:8px"><span>⚠️ ${broken.length} ${tt("of", "von")} ${jobs.length} ${tt("files missing", "Dateien fehlen")} (${Object.keys(bySc).length} ${tt("scenes affected", "Szenen betroffen")})</span></div>` +
      Object.entries(bySc).map(([sid, info]) => `
        <div style="background:#14141b;border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin-bottom:6px">
          <div style="font-weight:700;margin-bottom:4px">${esc(info.title)} <span class="tag">(${esc(sid)})</span></div>
          ${info.files.map(f => `<div class="tag" style="color:var(--hot);text-transform:none;letter-spacing:0">✕ ${esc(f)}</div>`).join("")}
        </div>`).join("");
  }
  btn.disabled = false;
});

$("btn-load-scene").onclick = async () => {
  const s = sceneList[$("scene-select").value];
  if (!s || !iAmLogicalHost()) return;
  await ensureSceneLines(s);
  const blind = !!($("blind-mode") && $("blind-mode").checked);
  if (!isHost) {
    sendHost({ t: "hostCmd", cmd: "loadScene", sceneId: s.id, blind });
    return;
  }
  // Host lokal genauso zurücksetzen wie die Gäste (Premiere-Reste, Takes, …)
  resetForNewRound();
  clearSceneCaches();
  scene = JSON.parse(JSON.stringify(s));       // Kopie, damit Blind-Flag das Original nicht verändert
  scene.blind = blind;
  clearSceneVideoState();
  resetRoles();
  showScene(sceneVideoSrc());
  // Zuerst alle aus Premiere/Warte holen (falls „again“ vorher verpasst wurde), dann Szene.
  broadcast({ t: "again" });
  broadcast({ t: "scene", scene });
  broadcastSettings();
  broadcastState();
};

const EFFECTS = {
  none: "none", vintage_1990: "vintage_1990", radio: "radio", telefon: "telefon", hall: "hall",
  megaphone: "megaphone", underwater: "underwater", helium: "helium", monster: "monster", robot: "robot",
  chorus: "chorus", echo: "echo", titan: "titan",
  studio: "studio",
  // Raum & Position -- fuer Figuren, die nicht direkt vor der Kamera stehen
  far: "far", veryfar: "veryfar", offscreen: "offscreen", behinddoor: "behinddoor",
  nextroom: "nextroom", above: "above", whisper: "whisper", shout: "shout",
  crowd: "crowd", pa: "pa", tv: "tv", memory: "memory"
};
function effectLabel(key) {
  const k = key || "none";
  const map = {
    none: tt("Normal", "Normal"),
    vintage_1990: tt("Vintage / 90s tape", "Vintage / 90er Tape"),
    radio: tt("Walkie-talkie", "Funkgerät"),
    telefon: tt("Phone", "Telefon"),
    hall: tt("Reverb room", "Halliger Raum"),
    megaphone: tt("Megaphone", "Megafon"),
    underwater: tt("Underwater", "Unter Wasser"),
    helium: tt("Helium", "Helium"),
    monster: tt("Monster", "Monster"),
    robot: tt("Robot", "Roboter"),
    chorus: tt("Doppelgänger", "Doppelgänger"),
    echo: tt("Slapback echo", "Nachschlag-Echo"),
    titan: tt("Titan (very deep)", "Titan (sehr tief)"),
    studio: tt("🎙 Studio quality (helps bad mics)", "🎙 Studio-Qualität (rettet schlechte Mikros)"),
    far: tt("📏 A few steps away", "📏 Ein paar Schritte entfernt"),
    veryfar: tt("📏 Far away (shouting distance)", "📏 Weit weg (Rufweite)"),
    offscreen: tt("👁 Off-screen / out of frame", "👁 Außerhalb des Bildes"),
    behinddoor: tt("🚪 Behind a door", "🚪 Hinter einer Tür"),
    nextroom: tt("🏠 From the next room", "🏠 Aus dem Nebenzimmer"),
    above: tt("⬆ From above / from a rooftop", "⬆ Von oben / vom Dach"),
    whisper: tt("🤫 Whisper (close to ear)", "🤫 Flüstern (dicht am Ohr)"),
    shout: tt("📣 Shouting", "📣 Rufen / Schreien"),
    crowd: tt("👥 In a crowd", "👥 In einer Menschenmenge"),
    pa: tt("📢 PA / loudspeaker announcement", "📢 Lautsprecher-Durchsage"),
    tv: tt("📺 From a TV / small speaker", "📺 Aus dem Fernseher / kleiner Box"),
    memory: tt("💭 Memory / flashback", "💭 Erinnerung / Rückblende")
  };
  return map[k] || k;
}

// ── Spieler kann pro Line seinen eigenen Effekt waehlen — ueberschreibt Rollen-/Szenen-Standard NUR fuer diese Line ──
let myEffectOverrides = {};   // lineIdx -> Effekt-Key (nur gesetzt, wenn vom Standard abweichend)
let myEffectAmounts = {};     // lineIdx -> Effekt-Staerke 0..1 (nur gesetzt, wenn abweichend von voll)
let myLineGains = {};        // lineIdx -> Lautstaerke-Faktor (1 = unveraendert)
let myLinePans = {};         // lineIdx -> Stereo-Pan -1..1 (nur gesetzt, wenn Spieler selbst wählt; sonst Mitte)
let stripRoleFx = false;     // true = Szenen-/Rollen-Effekt aus (z.B. kein Monster bei Kaigaku), außer man wählt selbst einen
// Einfache Stereo-Presets — Standard ist immer Mitte (Rollen-Pan aus scenes.json greift nicht mehr)
function linePanPresets() {
  return [
    { id: "C", label: tt("Center", "Mitte"), tip: tt("Default — dead center", "Standard — genau in der Mitte"), pan: 0 },
    { id: "L", label: tt("Left", "Links"), tip: tt("Full left ear", "Ganzer linker Ohrhörer"), pan: -1 },
    { id: "l", label: tt("Slight L", "Etwas L"), tip: tt("Slightly left", "Leicht nach links"), pan: -0.5 },
    { id: "r", label: tt("Slight R", "Etwas R"), tip: tt("Slightly right", "Leicht nach rechts"), pan: 0.5 },
    { id: "R", label: tt("Right", "Rechts"), tip: tt("Full right ear", "Ganzer rechter Ohrhörer"), pan: 1 },
  ];
}
function panPresetId(pan) {
  if (pan === undefined || pan === null) return "C";
  const hit = linePanPresets().find(p => p.pan === pan);
  return hit ? hit.id : "C";
}
/** Pan für Mix/Submit: Mitte (0), außer Spieler hat es in den Line-Einstellungen geändert. */
function submitPanFor(l) {
  return myLinePans[l.idx] !== undefined ? myLinePans[l.idx] : 0;
}
function panLabel(pan) {
  if (pan == null || pan === 0) return tt("Center", "Mitte");
  if (pan <= -0.85) return tt("Left", "Links");
  if (pan < 0) return tt("Slight L", "Etwas L");
  if (pan >= 0.85) return tt("Right", "Rechts");
  return tt("Slight R", "Etwas R");
}
// ── Noise Gate NACHTRÄGLICH auf eine fertige Aufnahme anwenden (wie ein Effekt, nicht live eingebrannt) ──
// ═════════════════════════════════════════════════════════════
// 🎙 STUDIO-AUFBEREITUNG — echte Rauschunterdrueckung im Frequenzbereich
// Reine EQ-Filter machen eine Aufnahme nur lauter/heller. Was wirklich "sauber" klingt,
// ist das Herausrechnen von Grundrauschen, Luefter-, Raum- und Elektronikgeraeuschen.
// Dafuer wird das Signal in ueberlappende Zeitfenster zerlegt, jedes in seine Frequenzen
// zerlegt (FFT), der Rauschteppich pro Frequenz geschaetzt und abgezogen -- dann zurueck.
// ═════════════════════════════════════════════════════════════
function fftRadix2(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {           // Bit-Umkehr-Sortierung
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

function denoiseChannel(x, strength, sampleRate) {
  const N = 2048, HOP = 512, SR = sampleRate || 44100;
  if (x.length < N * 3) return x;
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const frames = Math.floor((x.length - N) / HOP) + 1;
  const bins = N / 2 + 1;

  // ── 1) Zerlegen: Betrag + Phase je Zeitfenster ──
  const pow = [], phRe = [], phIm = [];
  for (let f = 0; f < frames; f++) {
    const re = new Float64Array(N), im = new Float64Array(N);
    const off = f * HOP;
    for (let i = 0; i < N; i++) re[i] = (x[off + i] || 0) * win[i];
    fftRadix2(re, im, false);
    const p = new Float32Array(bins);
    for (let b = 0; b < bins; b++) p[b] = re[b] * re[b] + im[b] * im[b];
    pow.push(p); phRe.push(re); phIm.push(im);
  }

  // ── 2) Stoerteppich mitlaufend schaetzen (Minimum-Statistik) ──
  // Pro Frequenz wird das Minimum in einem Zeitfenster verfolgt: waehrend einer Sprechpause
  // bleibt nur das Stoergeraeusch uebrig, und das ist die Schaetzung. Berechnet in Bloecken
  // und danach ueber die Nachbarbloecke -- gleiches Ergebnis wie ein gleitendes Fenster,
  // aber ein Vielfaches schneller (vorher lief das bei jeder Aufnahme spuerbar lange).
  const SMOOTH = 0.9;
  const smoothed = [];
  const cur = new Float32Array(bins);
  for (let b = 0; b < bins; b++) cur[b] = pow[0][b];
  for (let f = 0; f < frames; f++) {
    const sm = new Float32Array(bins);
    for (let b = 0; b < bins; b++) { cur[b] = SMOOTH * cur[b] + (1 - SMOOTH) * pow[f][b]; sm[b] = cur[b]; }
    smoothed.push(sm);
  }
  const BLK = Math.max(4, Math.round(0.7 * SR / HOP));
  const nblk = Math.max(1, Math.ceil(frames / BLK));
  const blkMin = [];
  for (let k = 0; k < nblk; k++) {
    const m = new Float32Array(bins).fill(Infinity);
    const hi = Math.min(frames, (k + 1) * BLK);
    for (let f = k * BLK; f < hi; f++) { const sm = smoothed[f]; for (let b = 0; b < bins; b++) if (sm[b] < m[b]) m[b] = sm[b]; }
    blkMin.push(m);
  }
  const noiseBlk = [];
  for (let k = 0; k < nblk; k++) {
    const nz = new Float32Array(bins);
    const a = blkMin[Math.max(0, k - 1)], c = blkMin[Math.min(nblk - 1, k + 1)], m = blkMin[k];
    // Faktor 1.5, weil ein Minimum den Stoerteppich systematisch etwas zu tief schaetzt.
    // Vorher stand hier 1.9 und spaeter noch ein zweiter Faktor -- zusammen wurde damit rund
    // das Dreifache abgezogen, und genau davon kam der dumpfe, gluckernde Klang.
    for (let b = 0; b < bins; b++) nz[b] = Math.min(a[b], Math.min(m[b], c[b])) * 1.5;
    noiseBlk.push(nz);
  }

  // ── 2b) Zwei Bremsen gegen "die ganze Aufnahme ist Rauschen" ──
  // Die Minimum-Statistik setzt voraus, dass es zwischendurch Sprechpausen gibt. Bei einem
  // lang gehaltenen Laut -- Schrei, gehaltener Vokal, in Anime-Szenen ständig -- gibt es die
  // nicht. Dann haelt sie den Laut selbst fuer Rauschen und saugt die Stimme weg.
  // Bremse 1: die Schaetzung darf nur einen kleinen Teil der Gesamtenergie erklaeren.
  let gesamtE = 0, geschaetztE = 0;
  for (let f = 0; f < frames; f++) { const p = pow[f]; for (let b = 0; b < bins; b++) gesamtE += p[b]; }
  for (let f = 0; f < frames; f++) { const nz = noiseBlk[Math.min(nblk - 1, Math.floor(f / BLK))]; for (let b = 0; b < bins; b++) geschaetztE += nz[b]; }
  const OBERGRENZE = 0.12;
  if (geschaetztE > gesamtE * OBERGRENZE && geschaetztE > 0) {
    const k = (gesamtE * OBERGRENZE) / geschaetztE;
    for (const nz of noiseBlk) for (let b = 0; b < bins; b++) nz[b] *= k;
  }
  // Bremse 2: je deutlicher ein Zeitfenster ueber der ruhigsten Stelle der Aufnahme liegt,
  // desto weniger wird darin eingegriffen -- laute Stellen sind mit Sicherheit Stimme.
  const rahmenE = new Float32Array(frames);
  for (let f = 0; f < frames; f++) { let s2 = 0; const p = pow[f]; for (let b = 0; b < bins; b++) s2 += p[b]; rahmenE[f] = s2; }
  const sortiert = Float32Array.from(rahmenE).sort();
  const ruheE = Math.max(sortiert[Math.floor(frames * 0.15)], 1e-12);
  const sicherStimme = new Float32Array(frames);
  for (let f = 0; f < frames; f++) sicherStimme[f] = Math.max(0, Math.min(1, (10 * Math.log10(rahmenE[f] / ruheE)) / 20));

  // ── 3) Klick-Erkennung ──
  // Mausklicks/Tastenanschlaege sind sehr kurz und ueber alle Frequenzen verteilt.
  // Ein Frame gilt als Klick, wenn die Energie in den Hoehen schlagartig hochschiesst
  // und direkt danach wieder faellt -- so etwas macht keine Stimme.
  const hfStart = Math.floor(bins * 0.45);
  const hf = new Float32Array(frames);
  for (let f = 0; f < frames; f++) { let s2 = 0; for (let b = hfStart; b < bins; b++) s2 += pow[f][b]; hf[f] = s2; }
  const isClick = new Uint8Array(frames);
  for (let f = 2; f < frames - 2; f++) {
    const around = (hf[f - 2] + hf[f - 1] + hf[f + 1] + hf[f + 2]) / 4 + 1e-12;
    if (hf[f] > around * 6) isClick[f] = 1;
  }

  // ── 4) Zischlaut-Daempfer (De-Esser) ──
  // Billige Mikrofone uebertreiben S-, Z- und T-Laute. Pro Zeitfenster wird verglichen,
  // wie viel Energie im Zischbereich sitzt im Verhaeltnis zum Stimmkoerper. Nur wenn das
  // Verhaeltnis aus dem Ruder laeuft, wird der Zischbereich fuer dieses Fenster leiser
  // gemacht -- ein fester Filter wuerde dagegen die ganze Aufnahme dumpf machen.
  const binHz = SR / N;
  const sbLo = Math.min(bins - 1, Math.round(4800 / binHz)), sbHi = Math.min(bins - 1, Math.round(9800 / binHz));
  const bdLo = Math.min(bins - 1, Math.round(250 / binHz)), bdHi = Math.min(bins - 1, Math.round(3400 / binHz));
  const sibG = new Float32Array(frames).fill(1);
  let sibPrev = 1;
  for (let f = 0; f < frames; f++) {
    const p = pow[f];
    let sib = 0, body = 0;
    for (let b = sbLo; b <= sbHi; b++) sib += p[b];
    for (let b = bdLo; b <= bdHi; b++) body += p[b];
    const verhaeltnis = sib / (body + 1e-12);
    const GRENZE = 0.32;
    let dg = verhaeltnis > GRENZE ? Math.sqrt(GRENZE / verhaeltnis) : 1;
    dg = Math.max(0.42, dg);                    // maximal rund 7 dB -- mehr klingt gelispelt
    sibPrev = dg < sibPrev ? 0.4 * sibPrev + 0.6 * dg : 0.75 * sibPrev + 0.25 * dg;   // schnell zu, langsam auf
    sibG[f] = sibPrev;
  }

  // ── 5) Wiener-Filter mit vorausschauender Signalschaetzung ──
  // Der entscheidende Unterschied zum simplen Abziehen: die Daempfung pro Frequenz wird
  // aus dem VERLAUF ueber die Zeit abgeleitet und geglaettet. Dadurch springen einzelne
  // Frequenzpunkte nicht mehr zufaellig an/aus -- genau das erzeugt sonst das metallische Glucksen.
  const s = Math.max(0, Math.min(1, strength === undefined ? 1 : strength));
  const ALPHA = 0.98;                                   // wie stark der Verlauf mitzaehlt
  // Untergrenze der Daempfung. Bewusst hoch angesetzt: 15 dB saubere, ruhige Absenkung
  // klingen deutlich besser als 25 dB, die dabei pumpen und zirpen.
  const floorG = Math.max(0.15, 0.34 - s * 0.19);
  const gPrev = new Float32Array(bins).fill(1);
  const gamPrev = new Float32Array(bins).fill(1);
  const gSmoothPrev = new Float32Array(bins).fill(1);
  const out = new Float32Array(x.length), norm = new Float32Array(x.length);
  const g = new Float32Array(bins), gs = new Float32Array(bins);

  for (let f = 0; f < frames; f++) {
    const p = pow[f], nz = noiseBlk[Math.min(nblk - 1, Math.floor(f / BLK))];
    for (let b = 0; b < bins; b++) {
      const nn = Math.max(nz[b], 1e-12) * (0.9 + s * 0.5);
      const gamma = p[b] / nn;                                        // gemessener Abstand zum Stoerteppich
      const inst = Math.max(gamma - 1, 0);
      const xi = Math.max(ALPHA * gPrev[b] * gPrev[b] * gamPrev[b] + (1 - ALPHA) * inst, 1e-4);
      g[b] = Math.max(floorG, xi / (1 + xi));                         // Wiener-Daempfung
      gamPrev[b] = gamma;
    }
    for (let b = 0; b < bins; b++) {                                  // ueber Nachbarfrequenzen glaetten
      const a = g[Math.max(0, b - 2)], b1 = g[Math.max(0, b - 1)];
      const c1 = g[Math.min(bins - 1, b + 1)], c = g[Math.min(bins - 1, b + 2)];
      gs[b] = (a + b1 * 2 + g[b] * 3 + c1 * 2 + c) / 9;
    }
    const sg = sibG[f];
    // Bei sicherer Sprache nur noch ein Viertel der Daempfung anwenden. Die Schaetzung selbst
    // laeuft unveraendert weiter (gPrev/gSmoothPrev), damit der Verlauf nicht durcheinandergeraet.
    const nachlass = 1 - 0.75 * sicherStimme[f];
    for (let b = 0; b < bins; b++) {                                  // ueber die Zeit glaetten
      gs[b] = 0.7 * gsPrevSafe(gSmoothPrev, b) + 0.3 * gs[b];
      if (isClick[f] && b >= hfStart) gs[b] = Math.min(gs[b], floorG);   // Klick wegdaempfen
      gSmoothPrev[b] = gs[b];
      gPrev[b] = gs[b];
      gs[b] = 1 - (1 - gs[b]) * nachlass;
      if (b >= sbLo && b <= sbHi) gs[b] *= sg;                        // Zischlaut-Daempfung obendrauf
    }
    const re = phRe[f], im = phIm[f];
    for (let b = 0; b < bins; b++) {
      re[b] *= gs[b]; im[b] *= gs[b];
      if (b > 0 && b < N / 2) { re[N - b] = re[b]; im[N - b] = -im[b]; }
    }
    fftRadix2(re, im, true);
    const off = f * HOP;
    for (let i = 0; i < N; i++) {
      if (off + i >= out.length) break;
      out[off + i] += re[i] * win[i];
      norm[off + i] += win[i] * win[i];
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = norm[i] > 1e-6 ? out[i] / norm[i] : x[i];
  return out;
}
function gsPrevSafe(arr, b) { const v = arr[b]; return isFinite(v) ? v : 1; }

function studioEnhanceBuffer(ctx, buffer, strength) {
  try {
    const s = Math.max(0, Math.min(1, strength === undefined ? 1 : strength));
    const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    let peak = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      // Gleichspannungs-Versatz abziehen. Viele billige Mikros liefern eine leicht
      // verschobene Nulllinie -- das kostet Pegel und macht den Klang matschig.
      // Auf einer Kopie, damit die Rohaufnahme unberuehrt bleibt (die wird noch gebraucht,
      // wenn man den Effekt wieder abwaehlt).
      const roh = Float32Array.from(buffer.getChannelData(ch));
      let mittel = 0;
      for (let i = 0; i < roh.length; i++) mittel += roh[i];
      mittel /= Math.max(1, roh.length);
      if (Math.abs(mittel) > 0.0008) for (let i = 0; i < roh.length; i++) roh[i] -= mittel;

      const d = denoiseChannel(roh, s, buffer.sampleRate);
      out.copyToChannel(d, ch);
      for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
    }

    // Lautheit statt Spitzenwert angleichen: ein einzelnes Knacken oder Atmen setzt sonst
    // den Spitzenwert, und die eigentliche Stimme bleibt zu leise. Gemessen wird deshalb
    // der Mittelwert der wirklich gesprochenen Stellen.
    const d0 = out.getChannelData(0);
    const schwelle = peak * 0.16;
    let sq = 0, n = 0;
    for (let i = 0; i < d0.length; i++) { const a = Math.abs(d0[i]); if (a > schwelle) { sq += d0[i] * d0[i]; n++; } }
    const rms = n > 64 ? Math.sqrt(sq / n) : 0;
    let gain = rms > 0.0005 ? 0.13 / rms : (peak > 0.001 ? 0.7 / peak : 1);
    gain = Math.max(1, Math.min(4, gain));
    if (peak * gain > 0.94) gain = 0.94 / Math.max(peak, 1e-6);   // nichts uebersteuern lassen
    if (gain !== 1) {
      for (let ch = 0; ch < out.numberOfChannels; ch++) {
        const d = out.getChannelData(ch);
        for (let i = 0; i < d.length; i++) d[i] *= gain;
      }
    }
    return out;
  } catch (e) { console.error("Studio-Aufbereitung fehlgeschlagen:", e); return buffer; }
}

// Leichte Spektral-Reinigung ohne Studio-Lautheits-Boost (für Gate-Regler)
function lightDenoiseBuffer(ctx, buffer, strength) {
  try {
    const s = Math.max(0, Math.min(1, strength || 0));
    if (s <= 0.02) return buffer;
    const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const roh = Float32Array.from(buffer.getChannelData(ch));
      out.copyToChannel(denoiseChannel(roh, s, buffer.sampleRate), ch);
    }
    return out;
  } catch (e) {
    console.warn("leichte Rauschunterdrückung fehlgeschlagen:", e);
    return buffer;
  }
}

// Gate + (optional) leichte Denoise; Studio-Effekt wie bisher extra
function processTakeBuffer(ctx, buffer, gateAmount, effect, fxAmount) {
  let b = applyGateToBuffer(ctx, buffer, gateAmount);
  const g = Math.max(0, Math.min(1, gateAmount || 0));
  // Auch ohne Studio-Effekt: Gate-Stärke steuert leichte Denoise (max ~0.55)
  if (g > 0.05 && effect !== "studio") {
    b = lightDenoiseBuffer(ctx, b, Math.min(0.55, g * 0.65));
  }
  if (effect === "studio") b = studioEnhanceBuffer(ctx, b, fxAmount === undefined ? 1 : fxAmount);
  return b;
}

function applyGateToBuffer(ctx, buffer, gateAmount) {
  if (!gateAmount || gateAmount <= 0) return buffer;   // Gate aus -> unverändert
  const sr = buffer.sampleRate;
  const winSize = Math.max(1, Math.round(sr * 0.012));     // ~12ms
  const threshold = gateAmount * 0.14;                      // etwas sanfter als früher
  const kneeLo = threshold * 0.45;                          // Soft-Knee-Untergrenze
  const holdSamples = Math.round(sr * 0.28);                 // längeres Hangover
  const attackSamples = Math.round(sr * 0.005);
  const releaseSamples = Math.round(sr * 0.09);
  // Geschlossen nicht hart auf 0 — Restboden schützt leise Sprache
  const closedFloor = Math.max(0.03, 0.14 * (1 - gateAmount));

  const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, sr);
  const nWindows = Math.ceil(buffer.length / winSize);
  const rms = new Float32Array(nWindows);
  // Grober Sprachband-Anteil: Differenz Hochpass-ähnlich (Differenz aufeinanderfolgender Samples)
  // + Mid-Energie — schützt Stimme, wenn Mid klar über dem Threshold liegt
  const midRatio = new Float32Array(nWindows);
  for (let w = 0; w < nWindows; w++) {
    let sum = 0, mid = 0, count = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      const start = w * winSize, end = Math.min(buffer.length, start + winSize);
      let prev = start > 0 ? data[start - 1] : 0;
      for (let i = start; i < end; i++) {
        const x = data[i];
        sum += x * x;
        const d = x - prev;           // Hochton-/Transient-Anteil
        mid += (x * x) * 0.55 + (d * d) * 0.45;
        prev = x;
        count++;
      }
    }
    rms[w] = count ? Math.sqrt(sum / count) : 0;
    midRatio[w] = count && sum > 1e-12 ? mid / sum : 0;
  }
  // Soft-Knee-Zielgain pro Fenster + Hangover wenn Sprachband klar da ist
  const targetGain = new Float32Array(nWindows);
  let lastOpenWin = -Infinity;
  for (let w = 0; w < nWindows; w++) {
    const r = rms[w];
    const speechProtect = midRatio[w] > 0.85 && r > kneeLo * 0.7;
    let g;
    if (r >= threshold || speechProtect) g = 1;
    else if (r <= kneeLo) g = closedFloor;
    else {
      const t = (r - kneeLo) / Math.max(1e-9, threshold - kneeLo);
      // smoothstep
      const s = t * t * (3 - 2 * t);
      g = closedFloor + (1 - closedFloor) * s;
    }
    if (g > 0.55) lastOpenWin = w;
    if ((w - lastOpenWin) * winSize <= holdSamples) g = Math.max(g, 0.85);
    targetGain[w] = g;
  }
  const gainCurve = new Float32Array(buffer.length);
  let currentGain = targetGain[0];
  for (let w = 0; w < nWindows; w++) {
    const start = w * winSize, end = Math.min(buffer.length, start + winSize);
    const target = targetGain[w];
    const speed = target > currentGain ? attackSamples : releaseSamples;
    for (let i = start; i < end; i++) {
      currentGain += (target - currentGain) / Math.max(1, speed);
      gainCurve[i] = currentGain;
    }
  }
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch), dst = out.getChannelData(ch);
    for (let i = 0; i < buffer.length; i++) dst[i] = src[i] * gainCurve[i];
  }
  return out;
}

function myEffectiveRole(l) {
  // Reihenfolge: Spieler-Wahl > (optional Strip) > Szenen-Autor-Override (l.effect) > Rollen-Standard
  // Pan: immer Mitte, außer in den Line-Einstellungen anders gewählt (kein Auto/Rollen-Pan mehr)
  const base = roleOf(roleOfLine(l) ?? myRole()) || { pan: 0, effect: "none", gain: 1 };
  const amt = myEffectAmounts[l.idx];
  const boost = myLineGains[l.idx];
  const panOv = myLinePans[l.idx];
  const withAmt = (r) => {
    let o = amt === undefined ? r : { ...r, fxAmount: amt };
    if (boost !== undefined && boost !== 1) o = { ...o, gain: (o.gain ?? 1) * boost };
    o = { ...o, pan: panOv !== undefined ? panOv : 0 };
    return o;
  };
  const chosen = myEffectOverrides[l.idx];
  if (chosen) return withAmt({ ...base, effect: chosen });
  if (stripRoleFx) return withAmt({ ...base, effect: "none" });
  return withAmt(effectiveRole(base, l));
}

/** Effekt-Feld für Host/Mix: bei Strip muss "none" mitgeschickt werden, sonst greift wieder der Szenen-Standard. */
function submitEffectFor(l) {
  if (myEffectOverrides[l.idx]) return myEffectOverrides[l.idx];
  if (stripRoleFx) return "none";
  return undefined;
}

function isRatingCardOpen() {
  const el = $("rate-card");
  return !!(el && el.style.display !== "none");
}

function rejoinPlaybackFlags() {
  return {
    premiereLocked: !!premiereLocked,
    ratingOpen: isRatingCardOpen(),
    playerGains: Object.assign(Object.create(null), premPlayerGains),
  };
}

$("file-video").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  status("scene-status", tt("Reading video …", "Lese Video ein …"));
  localVideoBuf = await f.arrayBuffer();
  status("scene-status", tt("Video loaded (", "Video geladen (") + Math.round(localVideoBuf.byteLength / 1e6) + tt(" MB). Now set the roles.", " MB). Jetzt Rollen einstellen.") +
    (localVideoBuf.byteLength > 60e6 ? tt(" ⚠ Large — transfer will take a while.", " ⚠ Groß — Übertragung dauert.") : ""));
  $("local-cfg").style.display = "";
  if (!$("rolecfg-list").children.length) { addRoleCfg(); addRoleCfg(); }
};

function addRoleCfg() {
  const n = $("rolecfg-list").children.length + 1;
  if (n > 4) return;
  const div = document.createElement("div");
  div.className = "rolecfg";
  div.innerHTML = `
    <input type="text" placeholder="${tt("Character", "Charakter")} ${n}" value="${tt("Character", "Charakter")} ${n}">
    <div><label class="small">${tt("Pan L↔R", "Pan L↔R")}</label><input type="range" min="-1" max="1" step="0.1" value="0"></div>
    <select>${Object.keys(EFFECTS).map((k) => `<option value="${k}">${esc(effectLabel(k))}</option>`).join("")}</select>`;
  $("rolecfg-list").appendChild(div);
}
$("btn-add-role").onclick = addRoleCfg;

$("btn-use-local").onclick = () => {
  const roles = [...$("rolecfg-list").children].map((div, i) => ({
    id: i + 1,
    name: div.querySelector("input[type=text]").value || tt("Character ", "Charakter ") + (i + 1),
    pan: parseFloat(div.querySelector("input[type=range]").value),
    effect: div.querySelector("select").value,
    gain: 1.0
  }));
  scene = { title: $("file-video").files[0].name.replace(/\.\w+$/, ""), roles };
  resetRoles();
  videoBlobUrl = URL.createObjectURL(new Blob([localVideoBuf], { type: "video/mp4" }));
  showScene(videoBlobUrl);
  conns.forEach(c => sendLocalVideo(c));
  broadcastState();
};

function resetRoles() {
  players.forEach(p => {
    p.role = null; p.extraRoles = []; p.ready = false; p.done = 0; p.total = 0;
    p.loadPct = 0; p.videoReady = false;
  });
}

function sendLocalVideo(conn) {
  conn.send({ t: "videoMeta", scene, size: localVideoBuf.byteLength });
  let off = 0;
  const pump = () => {
    while (off < localVideoBuf.byteLength) {
      if (conn.dataChannel && conn.dataChannel.bufferedAmount > BUFFER_LIMIT) { setTimeout(pump, 30); return; }
      conn.send({ t: "videoChunk", buf: localVideoBuf.slice(off, off + CHUNK_SIZE) });
      off += CHUNK_SIZE;
    }
  };
  pump();
}

let rxBuf = null, rxOff = 0, rxSize = 0;
function startVideoReceive(msg) {
  scene = msg.scene; rxSize = msg.size; rxBuf = new Uint8Array(rxSize); rxOff = 0;
  $("scene-card").style.display = "";
  $("scene-title").textContent = scene.title;
  $("download-bar").style.display = "";
  renderRoles();
}
function receiveVideoChunk(buf) {
  const arr = new Uint8Array(buf);
  rxBuf.set(arr, rxOff); rxOff += arr.length;
  const bar = $("download-bar");
  if (bar) bar.querySelector("i").style.width = Math.round(rxOff / rxSize * 100) + "%";
  if (rxOff >= rxSize) {
    if (bar) bar.style.display = "none";
    videoBlobUrl = URL.createObjectURL(new Blob([rxBuf], { type: "video/mp4" }));
    rxBuf = null;
    showScene(videoBlobUrl);
    SFX.ok();
    // Nach Reload mit eigenem Host-Video: Phase fortsetzen, sobald Bytes da sind
    if (pendingPhaseRestore) {
      const m = pendingPhaseRestore;
      pendingPhaseRestore = null;
      applyPhaseRestore(Object.assign({}, m, { hatVideoUebertragung: false, forceRestore: true }));
    }
  }
}

function showScene(src) {
  // Robust gegen unsortierte Lines-Arrays (z.B. selbstgebaute Szenen): immer chronologisch sortieren.
  // Sonst kann der Teleprompter beim "Gleich kommt..."-Hinweis die falsche Person zeigen.
  if (scene.lines && scene.lines.length) scene.lines.sort((a, b) => a.t - b.t);
  $("scene-card").style.display = "";
  $("btn-roulette").style.display = iAmLogicalHost() ? "" : "none";
  const diff = sceneDifficulty(scene);
  $("scene-title").innerHTML = esc(scene.title) + (diff ? ` <span class="difftag diff-${diff.label.toLowerCase().replace(/[^a-z]/g,"")}">${diff.emoji} ${diff.label}</span>` : "");
  renderRoles();
  beginSceneVideoLoad(src);
  // Bei lokalen Packs steckt im dub_video der Originalton — deshalb stumm schalten
  // und stattdessen den Backing-Track im Gleichschritt mitlaufen lassen.
  if (scene && scene.localPack && myPack) attachPackBacking($("preview"), myPack.backingUrl);
  else detachPackBacking();
}

// ═════════════════════════════════════════════════════════════
// 4) LOBBY-UI
// ═════════════════════════════════════════════════════════════
function avatarColor(name) {
  let h = 0; for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 70%, 55%)`;
}
function playerCard(p) {
  const rs = rolesOfPlayer(p);
  const role = rs.length && scene ? rs.map(x => scene.roles.find(r => r.id === x)?.name || "?").join(" + ") : null;
  const prog = p.total > 0 ? `<div class="pbar"><i style="width:${Math.round(p.done / p.total * 100)}%"></i></div><span class="tag">${p.done}/${p.total} Lines</span>` : "";
  let loadHtml = "";
  if (scene && scene.videoUrl) {
    if (!p.videoReady) {
      const pct = Math.max(0, Math.min(100, p.loadPct || 0));
      loadHtml = `<div class="pbar load"><i style="width:${pct}%"></i></div><span class="pload">📥 Video ${pct}%</span>`;
    } else if (!p.total) {
      loadHtml = `<span class="pload done">📥 ${tt("Video ready", "Video fertig")}</span>`;
    }
  }
  const micDot = p.id === myId ? `<span id="mic-live-dot" title="${esc(tt("Your mic — lights up when sound is coming in", "Dein Mikro — leuchtet, wenn gerade Ton ankommt"))}" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#3a3a46;margin-left:6px"></span>` : "";
  // Wer rausgeflogen ist, behält seinen Platz — das muss man sehen, damit niemand denkt
  // die Runde hängt. Mit Restzeit, bis der Platz freigegeben wird.
  const wegTag = p.offline
    ? `<span class="tag offline-cd" data-offline-cd style="color:#e8a33d">${escOfflineCountdown(p)}</span>`
    : "";
  const loadingCls = (scene && scene.videoUrl && !p.videoReady) ? " loading" : "";
  const showHostActs = iAmLogicalHost() && p.id !== myId && !p.offline;
  // Raum-Besitzer (Peer-ID = Raumcode) hält die Leitung — den kann man nicht kicken
  const isRoomPeer = !!(raumCode && p.id === PEER_PREFIX + raumCode);
  const kickBtn = (showHostActs && !isRoomPeer)
    ? `<button type="button" class="kick-btn" data-kick="${esc(p.id)}" title="${esc(tt("Kick from room", "Aus dem Raum kicken"))}">${tt("Kick", "Kicken")}</button>`
    : "";
  const hostGiveBtn = (showHostActs && p.key && hostHandoffAllowed())
    ? `<button type="button" class="host-btn" data-hostgive="${esc(p.id)}" title="${esc(tt("Pass host role", "Host-Rolle weitergeben"))}">${tt("Give host", "Host geben")}</button>`
    : "";
  const acts = (kickBtn || hostGiveBtn) ? `<div class="player-acts">${hostGiveBtn}${kickBtn}</div>` : "";
  return `<div class="player ${p.ready ? "ready" : ""}${loadingCls}" data-pid="${p.id}" style="${p.eliminated ? "opacity:.5" : p.offline ? "opacity:.55" : ""}">
    ${avatarHTML(p)}
    <div class="pinfo">
      <span class="pname">${esc(p.name)}${micDot}</span>
      ${p.eliminated ? '<span class="prole" style="color:var(--hot)">' + tt("🔪 eliminated", "🔪 eliminiert") + '</span>' : `<span class="prole ${role ? "" : "empty"}">${role ? "🎭 " + esc(role) : tt("no role yet", "noch keine Rolle")}</span>`}
      ${wegTag}${p.ready && !p.total ? '<span class="tag" style="color:var(--ok)">' + tt('ready', 'bereit') + '</span>' : ""}${loadHtml}${prog}
    </div>
    ${acts}
  </div>`;
}
function escOfflineCountdown(p) {
  const restSek = p.offline && p.offlineBis ? Math.max(0, Math.round((p.offlineBis - Date.now()) / 1000)) : 0;
  return tt("📴 Connection lost", "📴 Verbindung weg") + (restSek
    ? tt(" · hopefully back soon (", " · kommt hoffentlich zurück (") + Math.floor(restSek / 60) + ":" + String(restSek % 60).padStart(2, "0") + ")"
    : "");
}
function renderPlayers() { $("player-list").innerHTML = players.map(playerCard).join(""); }
// Offline-Restzeit: nur Text-Tags ticken, kein kompletter Listen-Rebuild
setInterval(() => {
  if (!players.some(p => p.offline)) return;
  for (const p of players) {
    if (!p.offline) continue;
    const text = escOfflineCountdown(p);
    document.querySelectorAll('.player[data-pid="' + p.id.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"] [data-offline-cd]').forEach(el => {
      if (el.textContent !== text) el.textContent = text;
    });
  }
}, 1000);
function renderBoothPlayers() {
  const html = players.map(playerCard).join("");
  $("booth-players").innerHTML = html;
  $("wait-players").innerHTML = html;
}

function renderRoles() {
  if (!scene) return;
  const lineCount = (rid) => scene.lines ? scene.lines.filter(l => l.chars.includes(rid)).length : null;
  const meineRollen = myRoles();
  $("role-list").innerHTML = scene.roles.map(r => {
    const owner = besitzerVon(r.id);
    const mine = meineRollen.includes(r.id);
    const lc = lineCount(r.id);
    // Wer eine Rolle hat, darf freie Rollen zusätzlich übernehmen — dann sprechen
    // z.B. drei Leute eine Szene mit vier Rollen. Besetzte Rollen bleiben gesperrt.
    const zusatz = mine && meineRollen[0] !== r.id;
    return `<button class="rolebtn ${mine ? "mine" : owner ? "taken" : ""}" data-r="${r.id}" ${owner && !mine ? "disabled" : ""}>
      <span>${zusatz ? "➕ " : ""}${esc(r.name)}${lc != null ? ` <span class="meta">· ${lc} Lines</span>` : ""}</span>
      <span class="meta">${owner ? esc(owner.name) + (mine && meineRollen.length > 1 ? tt(" (also others)", " (spricht mehrere)") : "") : tt("free — tap to add", "frei — antippen zum Dazunehmen")} · Pan ${r.pan > 0 ? "R" : r.pan < 0 ? "L" : tt("Center", "Mitte")} · ${esc(effectLabel(r.effect))}</span>
    </button>`;
  }).join("");
  $("role-list").querySelectorAll(".rolebtn").forEach(b => b.onclick = () => pickRole(parseInt(b.dataset.r)));
  // Deutlicher Hinweis, wenn Rollen übrig sind und weniger Leute als Rollen da sind
  const hinweis = $("role-hint");
  if (hinweis) {
    const frei = scene.roles.filter(r => !besitzerVon(r.id));
    const zeigen = frei.length > 0 && meineRollen.length > 0 && match.mode !== "rounds";
    hinweis.style.display = zeigen ? "" : "none";
    if (zeigen) {
      hinweis.textContent = "➕ " + tt(
        frei.length + " role(s) still free — tap one to speak it as well. Tap again to give it back.",
        frei.length + (frei.length === 1 ? " Rolle ist" : " Rollen sind") + " noch frei — antippen und du sprichst sie mit. Nochmal antippen gibt sie zurück.");
    }
  }
}

function pickRole(roleId) {
  if (match.mode === "rounds") { status("lobby-status", tt("🎲 In a match roles are assigned randomly — you can't pick yourself.", "🎲 Im Match werden Rollen zufällig verteilt — du kannst nicht selbst wählen."), true); return; }
  // Fremd besetzte Rollen bleiben tabu
  const fremd = players.some(p => p.id !== myId && rolesOfPlayer(p).includes(roleId));
  if (fremd) return;
  let me = players.find(p => p.id === myId);
  if (!me) { if (isHost) return; me = seedLocalPlayer(roleId); me.extraRoles = []; renderRoles(); renderPlayers(); sendHost({ t: "pickRole", role: roleId }); return; }
  const hatSie = rolesOfPlayer(me).includes(roleId);
  const vorher = rolesOfPlayer(me).length;
  if (hatSie) rolleAbgeben(me, roleId);   // nochmal antippen = wieder abgeben
  else rolleUebernehmen(me, roleId);
  me.ready = false;
  // Ohne Rückmeldung merkt man nicht, dass eine ZWEITE Rolle dazugekommen ist —
  // die Liste allein ist zu unauffällig.
  const rname = (roleOf(roleId) || {}).name || "?";
  const jetzt = rolesOfPlayer(me).length;
  if (hatSie) {
    showToast("➖ " + rname + tt(" given back", " wieder abgegeben") + (jetzt ? tt(" — you still have ", " — du hast noch ") + jetzt : ""), "leave");
  } else if (vorher >= 1) {
    showToast("➕ " + rname + tt(" added — you now speak ", " dazugenommen — du sprichst jetzt ") + jetzt + tt(" roles", " Rollen"), "join");
    SFX.click && SFX.click();
  }
  if (isHost) broadcastState();
  else sendHost({ t: "pickRole", role: roleId, drop: hatSie, extraRoles: me.extraRoles || [], primary: me.role });
  renderRoles();
  renderPlayers();
  checkStartable();
}


// Echter Zufallsmix (Fisher-Yates) — Math.random()-0.5 ist ungleichmäßig und ließ
// bei vielen Rollen oft immer dieselben oberen Rollen übrig.
function mischen(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

$("btn-roulette").onclick = () => {
  if (!iAmLogicalHost() || !scene) return;
  if (!isHost) {
    sendHost({ t: "hostCmd", cmd: "roulette" });
    status("lobby-status", tt("🎲 Rolling roles …", "🎲 Rollen werden ausgewürfelt …"));
    SFX.done();
    return;
  }
  const shuffledPlayers = mischen(players);
  // WICHTIG: auch die Rollen mischen — sonst kriegen 4 Spieler bei 20 Rollen
  // immer nur Rolle 1–4 („die obersten“), nie die weiter hinten.
  const roleIds = mischen(scene.roles.map(r => r.id));
  const n = Math.min(roleIds.length, shuffledPlayers.length);
  players.forEach(p => { p.role = null; p.extraRoles = []; p.ready = false; });
  for (let i = 0; i < n; i++) shuffledPlayers[i].role = roleIds[i];
  broadcastState(); renderRoles();
  status("lobby-status", tt("🎲 Roles rolled! No role = spectator. Everyone press “I'm ready”.", "🎲 Rollen ausgewürfelt! Wer keine hat, ist Zuschauer. Jetzt alle „Bin bereit“."));
  SFX.done();
};


// ═════════════════════════════════════════════════════════════
// MATCH-SYSTEM: Runden, Gesamtwertung, Finale
// ═════════════════════════════════════════════════════════════
let match = { mode: "free", rounds: 3, round: 1, totals: {}, autoRoulette: true, buddyGivers: {} };
let myBuddyUsed = false;   // SynchroBuddy nur 1× pro ganzem Match (nicht jede Bewertungsrunde)
const mgWins = {};   // Arena-Siege der Session

function hostSettingsChanged() {
  if (!iAmLogicalHost()) return;
  const mode = $("set-mode").value;
  const rounds = parseInt($("set-rounds").value);
  const autoRoulette = $("set-roulette").checked;
  if (!isHost) {
    // Lokale UI sofort spiegeln; Autorität bleibt beim Raum-Besitzer
    const prevMode = match.mode;
    match.mode = mode;
    match.rounds = rounds;
    match.autoRoulette = autoRoulette;
    syncModePicker(match.mode);
    const rnd = match.mode === "rounds" || match.mode === "elimination";
    const duell = match.mode === "duell";
    $("rounds-opts").style.display = (match.mode === "rounds") ? "" : "none";
    $("host-scene").style.display = (rnd || duell) ? "none" : "";
    $("duel-setup").style.display = duell ? "" : "none";
    if (duell) populateDuelSceneSelect();
    if (!rnd && !duell) loadSceneList();
    if (match.mode !== prevMode) {
      scene = null; clearSceneVideoState();
      scenePool = []; duelInfo = null; duelStagedScene = null;
      players.forEach(p => { p.role = null; p.extraRoles = []; p.ready = false; p.timesSpectated = 0; p.timesPlayed = 0; p.eliminated = false; });
      $("scene-card").style.display = "none";
      $("btn-go-round").style.display = "none";
      $("btn-start").style.display = "";
    }
    sendHost({ t: "hostCmd", cmd: "settings", mode, rounds, autoRoulette });
    checkStartable();
    return;
  }
  const prevMode = match.mode;
  match.mode = mode;
  match.rounds = rounds;
  match.autoRoulette = autoRoulette;
  syncModePicker(match.mode);
  // Im Runden- UND Battle-Royale-Modus ist alles Zufall: Rollenwahl & Szenenwahl werden ausgeblendet
  const rnd = match.mode === "rounds" || match.mode === "elimination";
  const duell = match.mode === "duell";
  $("rounds-opts").style.display = (match.mode === "rounds") ? "" : "none";
  $("host-scene").style.display = (rnd || duell) ? "none" : "";
  $("duel-setup").style.display = duell ? "" : "none";
  if (duell) populateDuelSceneSelect();
  // WICHTIG: Szenenliste immer (neu) laden, damit das Dropdown im Freien Modus gefüllt ist
  if (!rnd && !duell) loadSceneList();

  // FIX: Beim Moduswechsel eine evtl. schon geladene Szene/Rollen zurücksetzen —
  // sonst bleiben z.B. manuell gewählte Free-Modus-Rollen im Runden-Modus aktiv nutzbar.
  if (match.mode !== prevMode) {
    scene = null; clearSceneVideoState();
    scenePool = []; duelInfo = null; duelStagedScene = null;
    players.forEach(p => { p.role = null; p.extraRoles = []; p.ready = false; p.timesSpectated = 0; p.timesPlayed = 0; p.eliminated = false; });
    $("scene-card").style.display = "none";
    $("btn-go-round").style.display = "none";
    $("btn-start").style.display = "";
    broadcast({ t: "sceneReset" });
  }

  broadcastSettings();
  broadcastState();
}
function broadcastSettings() {
  broadcast({ t: "settings", mode: match.mode, rounds: match.rounds, round: match.round, autoRoulette: match.autoRoulette, blind: !!(scene && scene.blind) });
  renderSettingsView();
}
function renderSettingsView(s) {
  const el = $("settings-view");
  if (!el) return;
  const mode = s ? s.mode : match.mode;
  const rounds = s ? s.rounds : match.rounds, round = s ? s.round : match.round;
  const rl = s ? s.autoRoulette : match.autoRoulette;
  const bl = s ? s.blind : !!(scene && scene.blind);
  const activeLeft = players.filter(p => !p.eliminated).length;
  const onOff = bl ? tt("on", "an") : tt("off", "aus");
  if (mode === "elimination") {
    el.innerHTML = `🔪 <b>${tt("Battle Royale · Round ", "Battle Royale · Runde ")}${round}</b> · ${activeLeft} ${tt("still in", "noch im Rennen")} · 🎲 ${tt("random scenes & roles", "Zufalls-Szenen &amp; -Rollen")} · 🕶 ${tt("Blind", "Blind")}: ${onOff}` + (iAmLogicalHost() ? "" : ' <span class="tag">(Host)</span>');
  } else if (mode === "rounds") {
    el.innerHTML = `🏆 <b>${tt("Match · Round ", "Match · Runde ")}${round}/${rounds}</b> · 🎲 ${tt("random scenes & roles", "Zufalls-Szenen &amp; -Rollen")} · 🕶 ${tt("Blind", "Blind")}: ${onOff}` + (iAmLogicalHost() ? "" : ' <span class="tag">(Host)</span>');
  } else if (mode === "duell") {
    el.innerHTML = `🥊 <b>${tt("Duel mode", "Duell-Modus")}</b> · ${tt("Host picks scene, role &amp; both duelists · everyone else watches &amp; votes after", "Host wählt Szene, Rolle &amp; die zwei Duellanten · Rest schaut zu &amp; stimmt danach ab")}` + (iAmLogicalHost() ? "" : ' <span class="tag">(Host)</span>');
  } else {
    el.innerHTML = `🎮 <b>${tt("Free play", "Freies Spiel")}</b> · ${tt("pick scene &amp; roles freely", "Szene &amp; Rollen frei wählbar")} · 🕶 ${tt("Blind", "Blind")}: ${onOff}` + (iAmLogicalHost() ? "" : ' <span class="tag">(Host)</span>');
  }
}
function renderWins() {
  const el = $("mg-wins");
  if (!el) return;
  const entries = Object.entries(mgWins).sort((a, b) => b[1] - a[1]);
  el.innerHTML = entries.length ? tt("🎖 Arena wins: ", "🎖 Arena-Siege: ") + entries.map(([pid, n]) => `<b>${esc(nameOf(pid))}</b> ×${n}`).join(" · ") : "";
}
function addWin(pid) {
  if (!isHost || !pid) return;
  mgWins[pid] = (mgWins[pid] || 0) + 1;
  broadcast({ t: "wins", wins: mgWins });
  renderWins();
}

$("btn-ready").onclick = async () => {
  const me = players.find(p => p.id === myId);
  if (me?.role == null) {
    const free = scene ? scene.roles.some(r => !players.find(p => p.role === r.id)) : true;
    return status("lobby-status", free ? tt("Pick a role first! (Or watch without a role 🍿)", "Erst eine Rolle aussuchen! (Oder ohne Rolle einfach zuschauen 🍿)") : tt("All roles taken — you're a spectator and still see the premiere! 🍿", "Alle Rollen sind weg — du bist Zuschauer und siehst die Premiere trotzdem! 🍿"), !free ? false : true), free && SFX.err();
  }
  if (!isHost && !videoBlobUrl && !scene?.videoUrl) return status("lobby-status", tt("Video still loading …", "Video lädt noch …"), true);
  if (scene?.videoUrl && !myVideoReady) {
    return status("lobby-status", tt("Video still loading (", "Video lädt noch (") + myLoadPct + tt("%) — wait until it finishes, then “I'm ready”.", "%) — warte bis es bei dir fertig ist, dann „Bin bereit“."), true), SFX.err();
  }
  if (!(await ensureMic())) return;
  if (isHost) { me.ready = true; broadcastState(); }
  else {
    me.ready = true; // lokal sofort — Host bestätigt per state
    renderPlayers();
    sendHost({ t: "ready", role: me.role });
  }
  status("lobby-status", tt("✅ Ready! Waiting for the others …", "✅ Bereit! Warten auf die anderen …"));
  SFX.ok();
  burstConfetti();
};

function checkStartable() {
  if (!iAmLogicalHost()) return;
  if (match.mode === "duell") {
    // Duell hat seinen eigenen Start-Button (🥊 Duell starten) — der normale Button bleibt aussen vor
    $("btn-start").style.display = "none";
    return;
  }
  if ((match.mode === "rounds" || match.mode === "elimination") && !scene) {
    // Match noch nicht gestartet → Button startet das Match
    $("btn-start").style.display = "";
    $("btn-start").disabled = players.length < 2;
    if (match.mode === "elimination") {
      $("btn-start").textContent = tt("🔪 Start Battle Royale (", "🔪 Battle Royale starten (") + players.length + tt(" players)", " Spieler)");
      $("start-hint").textContent = players.length < 2 ? tt("Need at least 2 players!", "Mindestens 2 Spieler nötig!") : tt("Random scenes & roles — after each round the worst is out until one remains!", "Zufalls-Szenen & -Rollen — nach jeder Runde fliegt der Schlechteste raus, bis nur noch einer übrig ist!");
    } else {
      $("btn-start").textContent = tt("🎲 Start match (", "🎲 Match starten (") + match.rounds + tt(" rounds)", " Runden)");
      $("start-hint").textContent = tt("Random scene & roles for everyone. Go as soon as you start!", "Zufalls-Szene & zufällige Rollen für alle. Los geht's, sobald du startest!");
    }
    return;
  }
  $("btn-start").textContent = t("host.start");
  const speakers = players.filter(p => p.role != null);
  // Wer gerade rausgeflogen ist, darf den Start nicht blockieren — sein Platz bleibt
  // ja trotzdem frei, er kann jederzeit zurückkommen.
  const anwesend = speakers.filter(p => !p.offline);
  const weg = speakers.filter(p => p.offline);
  const stillLoading = anwesend.filter(p => !p.videoReady);
  const notReady = anwesend.filter(p => p.videoReady && !p.ready);
  const tor = packGate();
  const ok = anwesend.length >= 1 && anwesend.every(p => p.ready && p.videoReady) && tor.ok;
  const spectators = players.length - speakers.length;
  $("btn-start").disabled = !ok;
  if (!tor.ok) {
    $("start-hint").textContent = "📦 " + tor.grund;
  } else if (ok) {
    $("start-hint").textContent = tt("Let's go! ", "Los geht's! ") + (spectators ? spectators + tt(" spectators watching. ", " Zuschauer gucken zu. ") : tt("Unfilled roles speak original. ", "Unbesetzte Rollen sprechen original. "))
      + (weg.length ? "⚠ " + weg.map(p => p.name).join(", ") + tt(" has no connection right now — seat stays free.", " hat gerade keine Verbindung — Platz bleibt frei.") : "");
  } else if (stillLoading.length) {
    $("start-hint").textContent = tt("📥 Video still loading: ", "📥 Video lädt noch: ") + stillLoading.map(p => p.name + " " + (p.loadPct || 0) + "%").join(" · ")
      + (notReady.length ? tt(" — then still need ready: ", " — danach noch „bereit“: ") + notReady.map(p => p.name).join(", ") : "");
  } else {
    $("start-hint").textContent = tt("Wait until all speakers are “ready” …", "Warte, bis alle Sprecher „bereit“ sind …");
  }
}



function pickMime() {
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"])
    if (MediaRecorder.isTypeSupported(m)) return m;
  return "";
}

$("btn-mic-test").onclick = async () => {
  if (!(await ensureMic())) return;
  status("lobby-status", tt("🎤 Speak for 3 seconds …", "🎤 Sprich jetzt 3 Sekunden …"));
  const rec = new MediaRecorder(recStream(), { mimeType: pickMime() });
  const chunks = [];
  rec.ondataavailable = e => chunks.push(e.data);
  rec.onstop = async () => {
    status("lobby-status", tt("Playing with your role effect …", "Abspielen mit deinem Rollen-Effekt …"));
    const buf = await new Blob(chunks).arrayBuffer();
    const ctx = getCtx();
    const audio = await ctx.decodeAudioData(buf);
    const me = players.find(p => p.id === myId);
    const role = scene?.roles.find(r => r.id === me?.role) || { pan: 0, effect: "none", gain: 1 };
    const src = ctx.createBufferSource();
    src.buffer = audio;
    src.playbackRate.value = effectPitch(role.effect);
    src.connect(buildChain(ctx, role, ctx.destination));
    src.start();
    src.onended = () => status("lobby-status", tt("This is how you sound in the take. Good? Then “I'm ready”.", "So klingst du im Take. Passt? Dann „Bin bereit“."));
  };
  rec.start();
  setTimeout(() => rec.stop(), 3000);
};

// ═════════════════════════════════════════════════════════════
// 5) SESSION-START (Host)
// ═════════════════════════════════════════════════════════════

// Im Runden-Modus: Zufalls-Szene laden + Rollen würfeln (Host)
// ── FAIRE Szenen-Auswahl: solange nicht alle Szenen dran waren, wird keine wiederholt.
// Nach einer vollen Runde durch den Pool startet ein neuer, frisch gemischter Durchlauf.
let scenePool = [];
async function pickRandomScene() {
  // Mit dem schlanken Index sind die Zeilen noch nicht geladen -- dann zaehlt lineCount,
  // sonst wuerde hier faelschlich KEINE Szene als spielbar gelten.
  const hasLines = s => (s.lines && s.lines.length) || (s.lineCount > 0);
  const playable = sceneList.filter(s => hasLines(s) && s.id !== "testplace");
  if (!scenePool.length) {
    scenePool = [...playable].sort(() => Math.random() - 0.5);   // frisch mischen, erst wenn der Stapel leer ist
  }
  const s = scenePool.pop();
  if (!s) return;
  await ensureSceneLines(s);
  scene = JSON.parse(JSON.stringify(s));
  scene.blind = $("blind-mode") ? $("blind-mode").checked : false;
  clearSceneVideoState();
  clearSceneCaches();
  rouletteRoles();
  showScene(sceneVideoSrc());
  broadcast({ t: "scene", scene });
  broadcastSettings();
  broadcastState();
}
// ── FAIRE Rollenverteilung: wer schon (öfter) Zuschauer war, ist garantiert bevorzugt dran.
// Bei exakt gleichem Zuschauer-Stand entscheidet der Zufall — sonst nie.
function rouletteRoles() {
  // Auch hier Rollen mischen — sonst landen bei wenigen Spielern und vielen Rollen
  // immer nur die ersten Einträge aus scenes.json.
  const roleIds = mischen(scene.roles.map(r => r.id));
  // Eliminierte sind für IMMER Zuschauer (Battle Royale).
  // Wer gerade keine Verbindung hat, bekommt ebenfalls keine Rolle: Abwesende haben
  // naturgemäß die meiste Bank-Zeit gesammelt und würden anwesenden Spielern sonst
  // die Plätze wegschnappen — im Extremfall startet die Runde ohne einen einzigen
  // Sprecher. Beim Zurückkommen sind sie über timesSpectated sowieso zuerst dran.
  let eligible = players.filter(p => !p.eliminated && !p.offline);
  // Ist gerade NIEMAND erreichbar, lieber wie früher verteilen als gar keine Rollen
  // zu vergeben — sonst stünde der Raum nach einem kurzen Netz-Aussetzer still.
  if (!eligible.length) eligible = players.filter(p => !p.eliminated);
  const n = Math.min(roleIds.length, eligible.length);

  const ranked = eligible.map(p => ({ p, benched: p.timesSpectated || 0, rnd: Math.random() }))
    .sort((a, b) => b.benched - a.benched || b.rnd - a.rnd);

  const playing = ranked.slice(0, n).map(x => x.p);
  const spectating = ranked.slice(n).map(x => x.p);

  players.forEach(p => { p.role = null; p.extraRoles = []; p.ready = false; });
  const shuffledPlaying = mischen(playing);
  shuffledPlaying.forEach((p, i) => { p.role = roleIds[i]; });

  // Fairness-Zähler fortschreiben: Bank-Zeit steigt, Spielzeit steigt — Grundlage für die nächste Runde
  spectating.forEach(p => { p.timesSpectated = (p.timesSpectated || 0) + 1; });
  playing.forEach(p => { p.timesPlayed = (p.timesPlayed || 0) + 1; });
}

$("btn-start").onclick = async () => {
  if (!iAmLogicalHost()) return;
  if ((match.mode === "rounds" || match.mode === "elimination") && !scene) {
    if (!isHost) {
      sendHost({ t: "hostCmd", cmd: "pickRandom" });
      status("lobby-status", "🎲 " + tt("Picking a random scene …", "Szene wird ausgewürfelt …"));
      $("btn-start").style.display = "none";
      $("btn-go-round").style.display = "";
      return;
    }
    // Match-Kickoff: Zufalls-Szene laden, dann warten auf Bereit
    await pickRandomScene();
    const label = match.mode === "elimination"
      ? tt("🔪 Round 1: scene & roles rolled!", "🔪 Runde 1: Szene & Rollen ausgewürfelt!")
      : tt("🎲 Round 1: scene & roles rolled!", "🎲 Runde 1: Szene & Rollen ausgewürfelt!");
    status("lobby-status", label + tt(" Everyone hit “I’m ready”.", " Alle „Bin bereit“ drücken."));
    $("btn-start").style.display = "none";
    $("btn-go-round").style.display = "";
    return;
  }
  if (!isHost) {
    sendHost({ t: "hostCmd", cmd: "start" });
    return;
  }
  startSession();
};
$("btn-go-round").onclick = () => {
  if (!iAmLogicalHost()) return;
  if (!isHost) { sendHost({ t: "hostCmd", cmd: "start" }); return; }
  startSession();
};
function startSession() {
  if (!isHost) return;
  const tor = packGate();
  if (!tor.ok) { status("lobby-status", "📦 " + tor.grund, true); SFX.err(); return; }
  const speakers = players.filter(p => p.role != null);
  const anwesend = speakers.filter(p => !p.offline);
  if (!anwesend.length || !anwesend.every(p => p.ready && p.videoReady)) {
    const loading = anwesend.filter(p => !p.videoReady);
    status("lobby-status", loading.length
      ? tt("Not yet — video still loading for: ", "Noch nicht — Video lädt bei: ") + loading.map(p => p.name + " " + (p.loadPct || 0) + "%").join(", ")
      : tt("All speakers need to be “ready” first!", "Es müssen erst alle Sprecher „bereit“ sein!"), true);
    SFX.err(); return;
  }
  stopLobbyPreview();
  if (scene.lines?.length) { broadcast({ t: "goLines" }); startBooth(); }
  else { broadcast({ t: "go" }); startRealtime(); }
}


// ═════════════════════════════════════════════════════════════
// LOKALE PACKS (Choicer-Voicer-Format)
// Jede Person lädt dasselbe Pack selbst hoch. Grund: die Dateien landen als
// blob:-Adressen im Browser und die gelten nur dort — verschicken bringt nichts.
// Deshalb baut jeder seine eigene Szene und wir vergleichen nur einen Fingerabdruck.
// Erst wenn ALLE dasselbe Pack haben, darf der Host starten.
// ═════════════════════════════════════════════════════════════
let packMode = false;          // Lobby-Schalter: spielen wir aus einem lokalen Pack?
let myPack = null;             // { fp, title, scene, backingUrl, urls: [] }
const packPeers = {};          // Host: playerId -> { fp, title, lines, roles, error }
let packRefFp = null;          // Fingerabdruck, auf den sich alle einigen müssen

/** Liest ein ZIP komplett im Browser — Zentralverzeichnis + DecompressionStream.
 *  Bewusst ohne fremde Bibliothek, passt zum Rest des Projekts. */
async function readZipEntries(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  // "End of central directory" von hinten suchen (Kommentar am Ende möglich)
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new PackError(tt("Not a valid ZIP file.", "Das ist keine gültige ZIP-Datei."));
  let count = dv.getUint16(eocd + 10, true);
  let cdOff = dv.getUint32(eocd + 16, true);
  // ZIP64: Werte stehen dann woanders
  if (cdOff === 0xffffffff || count === 0xffff) {
    throw new PackError(tt("ZIP64 archives aren't supported — please re-zip the folder.",
      "ZIP64-Archive werden nicht unterstützt — bitte den Ordner neu zippen."));
  }
  const out = new Map();
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const rawSize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const cmtLen = dv.getUint16(p + 32, true);
    const lfhOff = dv.getUint32(p + 42, true);
    const name = new TextDecoder("utf-8").decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + cmtLen;
    if (name.endsWith("/")) continue;                      // Ordnereintrag
    if (/(^|\/)__MACOSX\//.test(name) || /(^|\/)\._/.test(name)) continue;  // macOS-Beiwerk
    // Lokaler Kopf: dort stehen die echten Längen der Namens-/Extrafelder
    const lnLen = dv.getUint16(lfhOff + 26, true);
    const leLen = dv.getUint16(lfhOff + 28, true);
    const dataStart = lfhOff + 30 + lnLen + leLen;
    const comp = u8.subarray(dataStart, dataStart + compSize);
    let bytes;
    if (method === 0) bytes = comp.slice();
    else if (method === 8) {
      if (typeof DecompressionStream !== "function") {
        throw new PackError(tt("Your browser is too old to unpack ZIP files.",
          "Dein Browser ist zu alt, um ZIP-Dateien zu entpacken."));
      }
      const ds = new DecompressionStream("deflate-raw");
      const stream = new Blob([comp]).stream().pipeThrough(ds);
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    } else {
      throw new PackError(tt("Unsupported compression in: ", "Nicht unterstützte Komprimierung in: ") + name);
    }
    if (rawSize && bytes.length !== rawSize) {
      throw new PackError(tt("Damaged file in the pack: ", "Beschädigte Datei im Pack: ") + name);
    }
    out.set(name, bytes);
  }
  if (!out.size) throw new PackError(tt("The ZIP is empty.", "Die ZIP-Datei ist leer."));
  return out;
}

/** Eigener Fehlertyp: damit im UI die Klartext-Meldung landet und nicht ein Stacktrace. */
function PackError(msg) { this.name = "PackError"; this.message = msg; }
PackError.prototype = Object.create(Error.prototype);

const packText = (bytes) => new TextDecoder("utf-8").decode(bytes);
/** Räumt eine Bildunterschrift auf. Manche Packs schreiben den Sprecher voran
 *  ("[Okuhito] “Text…”") — der Name steht bei uns schon an der Rolle, also weg damit.
 *  Danach die Anführungszeichen abziehen, auch die typografischen. */
function saeubereBildunterschrift(roh) {
  let t = String(roh || "").trim();
  t = t.replace(/^\[[^\]]{1,40}\]\s*/, "");        // führendes [Name]
  t = t.replace(/^[“”"'«»\s]+|[“”"'«»\s]+$/g, "");  // Anführungszeichen außen
  return t.trim();
}
/** Winziger INI-Leser für das Choicer-Voicer-Format (key="wert" / key=[1.5] / key=["a","b"]). */
function parseIniish(txt) {
  const o = {};
  txt.split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Za-z_]+)\s*=\s*(.+?)\s*$/);
    if (!m) return;
    let v = m[2];
    if (v.startsWith("[")) {
      try { o[m[1]] = JSON.parse(v.replace(/'/g, '"')); return; } catch { }
      o[m[1]] = v.slice(1, -1).split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      return;
    }
    o[m[1]] = v.replace(/^"|"$/g, "");
  });
  return o;
}

/** Fingerabdruck über Dateinamen + Größen. Bewusst NICHT über die Rohbytes des ZIPs:
 *  wer denselben Ordner neu zippt, bekommt andere Bytes, aber dasselbe Pack. */
async function packFingerprint(files) {
  const list = [...files.keys()].map(n => n.split("/").pop().toLowerCase() + ":" + files.get(n).length)
    .sort().join("|");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(list));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

/** Baut aus den Pack-Dateien eine Szene im Format des Spiels. Wirft PackError mit
 *  Klartext, sobald etwas fehlt — lieber sauber abbrechen als halb starten. */
async function buildSceneFromPack(files, packName) {
  const urls = [];
  const kurz = new Map();   // Dateiname ohne Ordner, klein geschrieben -> Bytes
  files.forEach((v, k) => kurz.set(k.split("/").pop().toLowerCase(), v));
  const hol = (name) => name ? kurz.get(String(name).split("/").pop().toLowerCase()) : null;
  const blobFor = (bytes, mime) => { const u = URL.createObjectURL(new Blob([bytes], { type: mime })); urls.push(u); return u; };

  // ── Video + Backing-Track ──
  let videoName = null, backingName = null;
  kurz.forEach((_, n) => {
    if (/^dub_video\.(mp4|ogv|webm|ogg|mov)$/.test(n)) videoName = n;
    if (/^_backing_track\.(mp3|wav|ogg|m4a|opus)$/.test(n)) backingName = n;
  });
  if (!videoName) throw new PackError(tt("No dub_video found in the pack.", "Im Pack fehlt das dub_video."));
  const vExt = videoName.split(".").pop();
  const vMime = vExt === "mp4" ? "video/mp4" : vExt === "webm" ? "video/webm" : "video/ogg";
  const videoUrl = blobFor(kurz.get(videoName), vMime);
  const backingUrl = backingName ? blobFor(kurz.get(backingName), "audio/mpeg") : null;

  // ── Zeilen einsammeln ──
  const zeilen = [];
  const AUDIO_EXT = ["mp3", "wav", "ogg", "m4a", "opus"];
  kurz.forEach((bytes, n) => {
    if (!n.endsWith(".txt") || n.startsWith("_")) return;
    const meta = parseIniish(packText(bytes));
    if (!meta.caption && !meta.dub_characters) return;
    const basis = n.replace(/\.txt$/, "");
    let audio = null;
    for (const e of AUDIO_EXT) { if (kurz.has(basis + "." + e)) { audio = kurz.get(basis + "." + e); break; } }
    const ts = Array.isArray(meta.dub_timestamps) ? parseFloat(meta.dub_timestamps[0]) : NaN;
    const wer = Array.isArray(meta.dub_characters) ? String(meta.dub_characters[0] || "").trim() : "";
    if (!wer) return;
    zeilen.push({
      basis,
      t: isFinite(ts) ? ts : 0,
      who: wer,
      text: saeubereBildunterschrift(meta.caption),
      bild: meta.image ? hol(meta.image) : null,
      audio
    });
  });
  if (!zeilen.length) throw new PackError(tt("No usable lines found in the pack.", "Im Pack wurden keine brauchbaren Zeilen gefunden."));
  zeilen.sort((a, b) => a.t - b.t || a.basis.localeCompare(b.basis));

  // ── Rollen: Reihenfolge des ersten Auftretens, damit sie bei allen gleich ist ──
  // Achtung: manche Packs schreiben denselben Namen mal "Chris", mal "chris", mal
  // "CHRIS" (echter Fall: JACKPOOOOT ergab sonst 5 Rollen statt 2). Deshalb wird
  // klein geschrieben verglichen und als Anzeige die schönste Schreibweise genommen.
  const varianten = new Map();   // klein -> Liste der vorgefundenen Schreibweisen
  zeilen.forEach(z => {
    const k = z.who.toLowerCase();
    if (!varianten.has(k)) varianten.set(k, []);
    varianten.get(k).push(z.who);
  });
  const huebsch = (liste) => {
    const gemischt = liste.find(v => v !== v.toUpperCase() && v !== v.toLowerCase());
    if (gemischt) return gemischt;
    return liste[0].toLowerCase().replace(/(^|[\s_-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  };
  const rollenNamen = [...varianten.keys()].map(k => huebsch(varianten.get(k)));
  const roleId = {};
  // Zuordnung ebenfalls über die Kleinschreibung
  const idFuer = (name) => roleId[name.toLowerCase()];
  const roles = rollenNamen.map((name, i) => {
    roleId[name.toLowerCase()] = i + 1;
    // Stimmen leicht im Raum verteilen, damit man sie auseinanderhält
    const pan = rollenNamen.length < 2 ? 0 : Math.round((-0.6 + (1.2 * i) / (rollenNamen.length - 1)) * 100) / 100;
    return { id: i + 1, name, pan, effect: "none", gain: 1 };
  });

  // ── Avatare: pro Rolle das erste Bild, das dazu auftaucht ──
  const avatars = {};
  zeilen.forEach(z => { const id = idFuer(z.who); if (z.bild && !avatars[id]) avatars[id] = blobFor(z.bild, "image/png"); });

  // ── Endzeiten: bis zur nächsten Zeile; die letzte über ihre Tonlänge ──
  // Achtung: Packs können mehrere Zeilen auf DENSELBEN Zeitstempel legen (zwei
  // Leute reden gleichzeitig). Dann wäre end == t und die Zeile hätte kein
  // Zeitfenster — Teleprompter und Aufnahme kämen durcheinander. Mindestens 0,8 s.
  const MIN_FENSTER = 0.8;
  const lines = zeilen.map((z, i) => ({
    t: z.t,
    end: Math.max((i + 1 < zeilen.length ? zeilen[i + 1].t : z.t + 4), z.t + MIN_FENSTER),
    chars: [idFuer(z.who)],
    who: rollenNamen[idFuer(z.who) - 1],
    text: z.text,
    de: z.text,
    orig: z.audio ? blobFor(z.audio, "audio/mpeg") : null
  }));
  const letzte = zeilen[zeilen.length - 1];
  if (letzte.audio) {
    try {
      const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 44100);
      const ab = await ctx.decodeAudioData(letzte.audio.buffer.slice(letzte.audio.byteOffset, letzte.audio.byteOffset + letzte.audio.byteLength));
      lines[lines.length - 1].end = Math.max(letzte.t + ab.duration, letzte.t + MIN_FENSTER);
    } catch { /* Schätzung von oben reicht */ }
  }

  // ── Titel aus _pack_info.ini, sonst Dateiname ──
  let title = packName.replace(/\.(zip|rar)$/i, "").replace(/[_-]+/g, " ").trim();
  const ini = kurz.get("_pack_info.ini");
  if (ini) { const m = parseIniish(packText(ini)); if (m.title) title = m.title; }
  if (title.length > 90) title = title.slice(0, 87) + "…";

  return {
    scene: {
      id: "localpack",
      title: "📦 " + title + " (" + roles.length + (roles.length === 1 ? " Rolle)" : " Rollen)"),
      videoUrl, avatars, roles, lines,
      localPack: true,
      mutedVideo: true            // Originalton aus, nur der Backing-Track läuft
    },
    backingUrl, urls
  };
}

/** Alte blob:-Adressen freigeben, damit der Speicher nicht vollläuft. */
function releasePack() {
  if (myPack && myPack.urls) myPack.urls.forEach(u => { try { URL.revokeObjectURL(u); } catch { } });
  detachPackBacking();
  myPack = null;
}

// ── Backing-Track: läuft als eigenes Audio-Element im Gleichschritt mit dem Video ──
// Das Video wird stumm geschaltet, weil in dub_video die ORIGINALSTIMMEN stecken.
let packBackingEl = null, packBackingHandlers = null;
function detachPackBacking() {
  if (packBackingEl) { try { packBackingEl.pause(); } catch { } }
  if (packBackingHandlers) {
    const { el, map } = packBackingHandlers;
    Object.keys(map).forEach(ev => { try { el.removeEventListener(ev, map[ev]); } catch { } });
  }
  packBackingHandlers = null; packBackingEl = null;
}
function attachPackBacking(videoEl, url) {
  detachPackBacking();
  if (!videoEl || !url) return;
  const a = new Audio(); a.src = url; a.preload = "auto";
  packBackingEl = a;
  try { videoEl.muted = true; } catch { }
  const sync = (hart) => {
    const soll = videoEl.currentTime;
    if (hart || Math.abs(a.currentTime - soll) > 0.15) { try { a.currentTime = soll; } catch { } }
  };
  const map = {
    play: () => { sync(true); a.play().catch(() => { }); },
    pause: () => { try { a.pause(); } catch { } },
    seeking: () => sync(true),
    seeked: () => sync(true),
    timeupdate: () => sync(false),
    ratechange: () => { try { a.playbackRate = videoEl.playbackRate; } catch { } },
    ended: () => { try { a.pause(); } catch { } }
  };
  Object.keys(map).forEach(ev => videoEl.addEventListener(ev, map[ev]));
  packBackingHandlers = { el: videoEl, map };
}

// ── Was passiert, wenn jemand eine Datei auswählt ──
async function onPackFile(file) {
  if (!file) return;
  packStatus(tt("📦 Reading pack …", "📦 Pack wird gelesen …"), "");
  if (/\.rar$/i.test(file.name)) {
    packStatus(tt("RAR can't be read in the browser — please repack the folder as ZIP.",
      "RAR kann der Browser nicht lesen — bitte den Ordner als ZIP neu packen."), "err");
    return;
  }
  try {
    const buf = await file.arrayBuffer();
    const files = await readZipEntries(buf);
    const fp = await packFingerprint(files);
    const built = await buildSceneFromPack(files, file.name);
    releasePack();
    myPack = { fp, title: built.scene.title, scene: built.scene, backingUrl: built.backingUrl, urls: built.urls };
    packStatus(tt("✅ Pack loaded: ", "✅ Pack geladen: ") + built.scene.title + " — " +
      built.scene.lines.length + tt(" lines, ", " Zeilen, ") + built.scene.roles.length + tt(" roles", " Rollen"), "ok");
    if (!built.backingUrl) {
      packStatus(tt("⚠ No _backing_track in the pack — the scene will play silent.",
        "⚠ Kein _backing_track im Pack — die Szene läuft ohne Hintergrundton."), "warn", true);
    }
    announceMyPack();
    if (isHost) applyPackSceneIfReady();
    renderPackUi();
  } catch (e) {
    releasePack();
    const txt = (e && e.name === "PackError") ? e.message : (tt("Pack couldn't be read: ", "Pack konnte nicht gelesen werden: ") + (e && e.message ? e.message : e));
    packStatus("❌ " + txt, "err");
    console.warn("Pack-Fehler:", e);
    announceMyPack();
  }
  renderPackList();
}

function announceMyPack() {
  const info = myPack ? { fp: myPack.fp, title: myPack.title, lines: myPack.scene.lines.length, roles: myPack.scene.roles.length }
    : { fp: null, title: null, lines: 0, roles: 0 };
  if (isHost) { packPeers[myId] = info; broadcastPackState(); checkStartable(); }
  else sendHost({ t: "packInfo", ...info });
}

function collectPackInfo(pid, msg) {
  if (!isHost) return;
  packPeers[pid] = { fp: msg.fp || null, title: msg.title || null, lines: msg.lines | 0, roles: msg.roles | 0 };
  applyPackSceneIfReady();
  broadcastPackState();
  renderPackList();
  checkStartable();
}

/** Host übernimmt seine eigene Pack-Szene als aktuelle Szene, sobald sie da ist. */
function applyPackSceneIfReady() {
  if (!isHost || !packMode || !myPack) return;
  packRefFp = myPack.fp;
  scene = myPack.scene;
  clearSceneVideoState && clearSceneVideoState();
  rouletteRoles();
  showScene(sceneVideoSrc());
  // Bewusst NUR die Rollen/Namen verschicken, nicht die blob:-Adressen — die
  // sind bei jedem anders. Alle bauen ihre Szene selbst aus ihrem eigenen Pack.
  broadcast({ t: "packScene", fp: myPack.fp, roles: scene.roles, title: scene.title });
  broadcastState && broadcastState();
}

/** Gast: eigene Pack-Szene übernehmen, Rollenzuschnitt kommt vom Host. */
function adoptPackScene(msg) {
  if (!myPack) return;
  if (msg.fp && msg.fp !== myPack.fp) return;   // anderes Pack — Gate schlägt sowieso an
  scene = myPack.scene;
  if (Array.isArray(msg.roles) && msg.roles.length === scene.roles.length) {
    // Namen/Pan vom Host übernehmen, damit alle dieselbe Beschriftung sehen
    msg.roles.forEach((r, i) => { if (scene.roles[i]) Object.assign(scene.roles[i], { name: r.name, pan: r.pan, effect: r.effect, gain: r.gain }); });
  }
  clearSceneVideoState && clearSceneVideoState();
  showScene(sceneVideoSrc());
}

function broadcastPackState() {
  if (!isHost) return;
  const list = players.map(p => ({ id: p.id, name: p.name, ...(packPeers[p.id] || { fp: null }) }));
  broadcast({ t: "packState", list, ref: packRefFp });
}

/** Kern des Tors: erst wenn jeder Anwesende dasselbe Pack hat, darf es losgehen. */
function packGate() {
  if (!packMode) return { ok: true };
  const anwesend = players.filter(p => !p.offline);
  if (!myPack) return { ok: false, grund: tt("You still need to load the pack.", "Du musst das Pack noch laden.") };
  const ref = packRefFp || myPack.fp;
  const fehlt = [], anders = [];
  anwesend.forEach(p => {
    const e = packPeers[p.id];
    if (!e || !e.fp) fehlt.push(p.name);
    else if (e.fp !== ref) anders.push(p.name);
  });
  if (anders.length) return { ok: false, grund: tt("Different pack: ", "Anderes Pack: ") + anders.join(", ") };
  if (fehlt.length) return { ok: false, grund: tt("Still missing the pack: ", "Pack fehlt noch bei: ") + fehlt.join(", ") };
  return { ok: true };
}

function packStatus(txt, art, anhaengen) {
  const el = $("pack-status");
  if (!el) return;
  const farbe = art === "err" ? "var(--hot)" : art === "ok" ? "var(--vu)" : art === "warn" ? "var(--amber)" : "";
  const html = `<div style="color:${farbe}">${esc(txt)}</div>`;
  if (anhaengen) el.innerHTML += html; else el.innerHTML = html;
}

function renderPackList() {
  const el = $("pack-list");
  if (!el) return;
  if (!packMode) { el.innerHTML = ""; return; }
  const ref = packRefFp || (myPack && myPack.fp);
  el.innerHTML = players.map(p => {
    const e = packPeers[p.id] || {};
    let sym = "⏳", farbe = "var(--amber)", zus = tt("waiting", "wartet");
    if (p.offline) { sym = "🔌"; farbe = "#888"; zus = tt("offline", "offline"); }
    else if (e.fp && ref && e.fp === ref) { sym = "✅"; farbe = "var(--vu)"; zus = e.lines + tt(" lines", " Zeilen"); }
    else if (e.fp) { sym = "❌"; farbe = "var(--hot)"; zus = tt("different pack!", "anderes Pack!"); }
    return `<div class="raterow" style="border-color:${farbe}"><span>${sym} ${esc(p.name)}</span><span class="mono" style="opacity:.7">${esc(zus)}</span></div>`;
  }).join("");
}


/** Schalter + Sichtbarkeit der Pack-Karte. */
function renderPackUi() {
  const inLobby = !!document.querySelector("#scr-lobby.active");
  const karte = $("pack-card");
  if (karte) karte.style.display = (packMode && inLobby) ? "" : "none";
  const sw = $("pack-mode");
  if (sw) {
    sw.classList.toggle("on", !!packMode);
    sw.setAttribute("aria-pressed", packMode ? "true" : "false");
    sw.disabled = !iAmLogicalHost();
  }
  const zeile = $("pack-mode-row");
  if (zeile) zeile.style.display = (iAmLogicalHost() && inLobby) ? "" : "none";
  // Der Host legt zuerst ab — sein Pack gibt vor, welches das richtige ist.
  // Vorher bleibt die Ablage für Gäste gesperrt, sonst laden alle wild durcheinander.
  const frei = iAmLogicalHost() || !!packRefFp;
  const zone = $("pack-drop");
  if (zone) {
    zone.classList.toggle("locked", !frei);
    const t = $("pack-drop-text");
    if (t) {
      t.innerHTML = !frei
        ? tt("⏳ Waiting for the host's pack …", "⏳ Warten auf das Pack des Hosts …")
        : (myPack
          ? "✅ " + esc(myPack.title)
          : (iAmLogicalHost()
            ? tt("📦 Drop the ZIP here — you go first", "📦 ZIP hier ablegen — du machst den Anfang")
            : tt("📦 Drop the same ZIP here", "📦 Dieselbe ZIP hier ablegen")));
    }
  }
  renderPackList();
  checkStartable();
}

// Taster (nur Host): schaltet den lokalen Pack-Modus fuer alle an/aus
if ($("pack-mode")) $("pack-mode").onclick = () => {
  if (!iAmLogicalHost()) return;
  packMode = !packMode;
  if (!packMode) {
    releasePack(); packRefFp = null;
    Object.keys(packPeers).forEach(k => delete packPeers[k]);
    packStatus("", "");
  }
  if (isHost) broadcast({ t: "packMode", on: packMode });
  else sendHost({ t: "hostCmd", cmd: packMode ? "packOn" : "packOff" });
  renderPackUi();
};
if ($("pack-file")) $("pack-file").onchange = (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = "";
  onPackFile(f);
};
// ── Ablagefeld: klicken oder ZIP hineinziehen ──
(function () {
  const zone = $("pack-drop");
  if (!zone) return;
  const gesperrt = () => !(iAmLogicalHost() || packRefFp);
  zone.onclick = () => { if (!gesperrt() && $("pack-file")) $("pack-file").click(); };
  const stop = e => { e.preventDefault(); e.stopPropagation(); };
  ["dragenter", "dragover"].forEach(ev => zone.addEventListener(ev, e => {
    stop(e);
    if (gesperrt()) { e.dataTransfer.dropEffect = "none"; return; }
    e.dataTransfer.dropEffect = "copy";
    zone.classList.add("over");
  }));
  ["dragleave", "dragend"].forEach(ev => zone.addEventListener(ev, e => { stop(e); zone.classList.remove("over"); }));
  zone.addEventListener("drop", e => {
    stop(e);
    zone.classList.remove("over");
    if (gesperrt()) {
      packStatus(tt("The host has to drop their pack first.", "Erst muss der Host sein Pack ablegen."), "warn");
      return;
    }
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) onPackFile(f);
  });
})();
// Das ganze Fenster abfangen, damit ein danebengegangenes ZIP nicht den Browser
// dazu bringt, die Datei einfach anzuzeigen und das Spiel zu verlassen.
["dragover", "drop"].forEach(ev => window.addEventListener(ev, e => {
  if (packMode && document.querySelector("#scr-lobby.active")) e.preventDefault();
}));

// ═════════════════════════════════════════════════════════════
// 6) LINE-BOOTH — Zeile für Zeile, unendlich Versuche
// ═════════════════════════════════════════════════════════════
let myLines = [], curLine = 0, takes = {};   // takes: lineIdx → ArrayBuffer
let outtakes = [];   // verworfene Takes fürs Outtakes-Reel [{lineIdx,text,t,end,buf,name,uid}]
const OUTTAKE_MAX = 8;          // pro Spieler in der Booth
const OUTTAKE_POOL_MAX = 24;    // gemischter Pool für die Premiere (alle zusammen)
const OUTTAKE_MIN_BYTES = 400;  // leere/zu kurze Clips nicht behalten
let collectedOuttakes = new Map(); // host: peerId -> outtake[]
let outtakeUidSeq = 0;
function outtakeUid() { return Date.now().toString(36) + "-" + (++outtakeUidSeq); }
function outtakeBufOk(buf) { return !!(buf && (buf.byteLength || 0) >= OUTTAKE_MIN_BYTES); }
function outtakeKey(o) {
  // Verschiedene Fehlversuche derselben Line behalten (uid); ohne uid Fallback auf Größe
  if (o && o.uid != null) return String(o.name || "?") + "|" + String(o.lineIdx) + "|u:" + o.uid;
  const len = o && o.buf ? (o.buf.byteLength || 0) : 0;
  return String(o.name || "?") + "|" + String(o.lineIdx) + "|b:" + len;
}
/** Doppelte Einträge (gleicher uid / gleiche Größe) raus — verschiedene Bloopers bleiben. */
function dedupeOuttakes(list) {
  const map = new Map();
  for (const o of list || []) {
    if (!o || o.lineIdx == null) continue;
    map.set(outtakeKey(o), o);
  }
  return [...map.values()];
}
function pushLocalOuttake(ot) {
  if (!ot) return;
  if (!ot.uid) ot.uid = outtakeUid();
  if (!outtakeBufOk(ot.buf)) return;
  const key = outtakeKey(ot);
  outtakes = outtakes.filter(o => outtakeKey(o) !== key);
  outtakes.push(ot);
  if (outtakes.length > OUTTAKE_MAX) outtakes.shift();
}
let lineRec = null, lineChunks = [], recTimer = null, recStartT = 0, recMax = 0;
let recAbortOuttake = false;   // Abbrechen → Clip als Outtake, Take nicht ersetzen
let recPrepCancel = false;     // Countdown/Vorbereitung abbrechen


function myRole() { return players.find(p => p.id === myId)?.role; }

// ── Mehrfachrollen ───────────────────────────────────────────────
// p.role bleibt die Hauptrolle (alles Bestehende arbeitet weiter damit),
// p.extraRoles sind zusätzlich übernommene Rollen. Aufnahme, Premiere,
// Outtakes und Download sind ohnehin NACH ROLLE sortiert, nicht nach Spieler —
// deshalb reicht es, beim Abschicken sauber pro Rolle aufzuteilen.
function rolesOfPlayer(p) {
  if (!p) return [];
  const out = [];
  if (p.role != null) out.push(p.role);
  (p.extraRoles || []).forEach(r => { if (r != null && !out.includes(r)) out.push(r); });
  return out;
}
function myRoles() { return rolesOfPlayer(players.find(p => p.id === myId)); }
/** Wem gehört diese Zeile? Zeilen haben in der Praxis genau eine Rolle. */
function roleOfLine(l) { return l && l.chars && l.chars.length ? l.chars[0] : null; }
/** Alle Rollen, die gerade gesprochen werden. nurOnline blendet Abwesende aus. */
function besetzteRollen(nurOnline) {
  const s = new Set();
  players.forEach(p => { if (!nurOnline || !p.offline) rolesOfPlayer(p).forEach(r => s.add(r)); });
  return s;
}
function besitzerVon(roleId) { return players.find(p => rolesOfPlayer(p).includes(roleId)); }

// Wie lange eine Rolle nach einem Verbindungsabriss noch mitgezählt wird.
// Ohne diese Schonzeit reichte ein kurzes WLAN-Zucken beim Aufnehmenden, damit
// seine Rolle sofort aus dem Soll fiel und die Premiere ohne ihn losging.
const OFFLINE_SCHONZEIT_MS = 30000;
function nochInSchonzeit(p) {
  if (!p || !p.offline) return false;
  if (!p.offlineSeit) return true;               // Zeitpunkt unbekannt → lieber warten
  return (Date.now() - p.offlineSeit) < OFFLINE_SCHONZEIT_MS;
}
/** Rollen, auf deren Aufnahme die Premiere warten muss. */
function benoetigteRollen() {
  const s = new Set();
  players.forEach(p => {
    if (p.offline && !nochInSchonzeit(p)) return;   // lange weg → nicht mehr warten
    rolesOfPlayer(p).forEach(r => s.add(r));
  });
  return s;
}
/** Läuft die Schonzeit von jemandem noch, später nochmal prüfen — sonst
 *  bliebe die Premiere hängen, bis zufällig eine andere Nachricht eintrudelt. */
let offlineNachpruefTimer = null;
function planeOfflineNachpruefung() {
  const wartende = players.filter(p => p.offline && nochInSchonzeit(p));
  if (!wartende.length) return;
  const rest = Math.max(...wartende.map(p => OFFLINE_SCHONZEIT_MS - (Date.now() - (p.offlineSeit || Date.now()))));
  clearTimeout(offlineNachpruefTimer);
  offlineNachpruefTimer = setTimeout(() => {
    try { maybeFinishTracks(); syncForceMixBtn(); } catch (e) { console.warn("Nachprüfung:", e); }
  }, Math.max(1000, rest + 250));
}
/** Rolle freigeben — egal ob Haupt- oder Zusatzrolle. */
function rolleAbgeben(p, roleId) {
  if (!p) return;
  if (p.extraRoles) p.extraRoles = p.extraRoles.filter(r => r !== roleId);
  if (p.role === roleId) {
    // Eine Zusatzrolle rückt nach, damit der Spieler Sprecher bleibt
    p.role = (p.extraRoles && p.extraRoles.length) ? p.extraRoles.shift() : null;
  }
}
/** Rolle übernehmen. Die erste wird Hauptrolle, weitere landen in extraRoles. */
function rolleUebernehmen(p, roleId) {
  if (!p || roleId == null) return;
  if (!p.extraRoles) p.extraRoles = [];
  if (rolesOfPlayer(p).includes(roleId)) return;
  if (p.role == null) p.role = roleId;
  else p.extraRoles.push(roleId);
}
function roleOf(id) { return scene?.roles?.find(r => r.id === id); }

// Findet den frühesten Startzeitpunkt, an dem DIESELBE Rolle danach wieder spricht —
// nur DAS darf eine laufende Aufnahme beschneiden, nicht die Lines anderer Charaktere.
function nextSameRoleStart(lineIdx) {
  const l = scene.lines[lineIdx];
  const roleSet = new Set(l.chars);
  let best = null;
  for (let i = 0; i < scene.lines.length; i++) {
    if (i === lineIdx) continue;
    const other = scene.lines[i];
    if (other.t > l.t + 0.01 && other.chars.some(c => roleSet.has(c))) {
      if (best === null || other.t < best) best = other.t;
    }
  }
  return best;
}


// ── Duell-Setup: Szene wählen, dann Rolle + beide Duellanten festlegen ──
function populateDuelSceneSelect() {
  const sel = $("duel-scene-select");
  sel.innerHTML = sceneList.length
    ? sceneList.map((s, i) => `<option value="${i}">${esc(sceneTitleDisplay(s.title))}</option>`).join("")
    : `<option>— ${tt("Loading scenes…", "Szenen laden…")} —</option>`;
}
$("btn-duel-load-scene").onclick = async () => {
  const s = sceneList[$("duel-scene-select").value];
  if (!s) return;
  await ensureSceneLines(s);
  duelStagedScene = JSON.parse(JSON.stringify(s));
  $("duel-role-select").innerHTML = duelStagedScene.roles.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join("");
  const playerOpts = players.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
  $("duel-player-a").innerHTML = playerOpts;
  $("duel-player-b").innerHTML = playerOpts;
  if (players[1]) $("duel-player-b").value = players[1].id;
  $("duel-pickers").style.display = "flex";
  status("duel-setup-status", tt("Scene loaded — now pick a role & both duelists.", "Szene geladen — jetzt Rolle & beide Duellanten wählen."));
};
$("btn-duel-start").onclick = () => {
  if (!iAmLogicalHost() || !duelStagedScene) return;
  const roleId = parseInt($("duel-role-select").value);
  const aId = $("duel-player-a").value, bId = $("duel-player-b").value;
  if (aId === bId) return status("duel-setup-status", tt("Duelist A and B must be different people!", "Duellant A und B müssen unterschiedlich sein!"), true), SFX.err();
  if (!isHost) {
    sendHost({ t: "hostCmd", cmd: "duelStart", sceneId: duelStagedScene.id, roleId, aId, bId });
    status("duel-setup-status", tt("🥊 Starting the duel …", "🥊 Duell wird gestartet …"));
    return;
  }
  duelInfo = { roleId, aId, bId };
  scene = JSON.parse(JSON.stringify(duelStagedScene));
  clearSceneVideoState();
  players.forEach(p => {
    p.role = (p.id === aId || p.id === bId) ? roleId : null; p.extraRoles = [];
    p.ready = true;
    p.loadPct = 0;
    p.videoReady = false;
  });
  Object.keys(duelSubs).forEach(k => delete duelSubs[k]);
  Object.keys(duelVotes).forEach(k => delete duelVotes[k]);
  broadcast({ t: "scene", scene });
  showScene(sceneVideoSrc());
  broadcast({ t: "duelSetupInfo", duelInfo });
  broadcastState();
  status("duel-setup-status", tt("🥊 Duel set: ", "🥊 Duell steht: ") + nameOf(aId) + " vs " + nameOf(bId) + tt(" as ", " als ") + duelStagedScene.roles.find(r => r.id === roleId).name + tt(" — waiting for the video download …", " — warte auf Video-Download …"));
  broadcast({ t: "goLines" });
  queueOrStartBooth();
};

function startBooth() {
  stopLobbyPreview();
  const rid = myRole();
  if (rid == null) {                      // Zuschauer
    show("scr-wait");
    renderBoothPlayers();
    $("duel-waiting-note").style.display = match.mode === "duell" ? "" : "none";
    const me0 = players.find(p => p.id === myId);
    const bench = me0 ? (me0.timesSpectated || 0) : 0;
    status("wait-status", match.mode === "duell"
      ? tt("🥊 Duel running — ", "🥊 Duell läuft — ") + nameOf(duelInfo?.aId) + " vs " + nameOf(duelInfo?.bId) + tt(" record independently. Then you hear both versions and vote!", " nehmen unabhängig voneinander auf. Danach hört ihr beide Versionen und stimmt ab!")
      : tt("🍿 You’re watching — the premiere starts automatically when everyone’s done.", "🍿 Du bist Zuschauer — die Premiere startet automatisch, wenn alle fertig sind.") + (match.mode === "rounds" ? tt(" (Next round you’re guaranteed a preferred slot, banked ", " (Nächste Runde bist du garantiert bevorzugt dran, ") + bench + tt("× so far.)", "x gebankt bisher.)") : ""));
    return;
  }
  // Alle Zeilen ALLER eigenen Rollen — wer zwei Rollen übernommen hat, spricht
  // sie in einem Durchgang nacheinander ab. Die Zuordnung steckt in l.chars.
  const meineRollen = myRoles();
  myLines = scene.lines.map((l, i) => ({ ...l, idx: i })).filter(l => l.chars.some(c => meineRollen.includes(c)));
  curLine = 0; takes = {}; outtakes = []; myEffectOverrides = {}; myEffectAmounts = {}; myLineGains = {}; myLinePans = {};
  const r = roleOf(rid);
  $("booth-rolename").textContent = meineRollen.length > 1
    ? meineRollen.map(x => (roleOf(x) || {}).name || "?").join(" + ")
    : r.name;
  const av = scene.avatars?.[String(rid)];
  $("booth-avatar").style.display = av ? "" : "none";
  if (av) $("booth-avatar").src = assetUrl(av);
  const bv = $("booth-video");
  bv.src = sceneVideoSrc();
  $("btn-line-rec").disabled = true;
  status("booth-status", tt("⏳ Loading video — one moment …", "⏳ Video lädt — einen Moment …"));
  setBar("booth-bar", 30);
  waitCanPlay(bv).then(() => {
    setBar("booth-bar", 100);
    $("btn-line-rec").disabled = false;
    status("booth-status", t("booth.status"));
    SFX.ok();
  });
  sendProgress();
  show("scr-booth");
  $("onair").classList.add("live");
  SFX.go();
  startVizOn("viz");
  renderLine();
}

/** Primary caption for UI: EN → original `text`, DE → `de` (fallback the other way). */
function linePrimaryText(l) {
  if (!l) return "";
  if (getLang() === "de") return (l.de || l.text || "");
  return (l.text || l.de || "");
}
/** Secondary line (only in DE mode: show English original under German). EN mode: no German secondary. */
function lineSecondaryText(l) {
  if (!l || !scene || scene.blind) return "";
  if (getLang() === "de" && l.de && l.text && l.text !== l.de) return l.text;
  return "";
}

function renderLine() {
  const l = myLines[curLine];
  if (!l) return finishBooth();
  origReqId++;   // Line gewechselt -> jede noch wartende "Original anhören"-Anfrage von vorher wird ungültig
  if (origSrc) { try { origSrc.stop(); } catch {} origSrc = null; }
  stopRecCue();
  const ob = $("btn-line-orig"); if (ob) ob.textContent = tt("🗣 Listen to original", "🗣 Original anhören");
  syncBoothGateUI();
  $("booth-count").innerHTML = `${curLine + 1}/${myLines.length}<small>Voiceline</small>`;
  $("line-who").textContent = l.who + (l.chars.length > 1 ? tt(" (together!)", " (zusammen!)") : "");
  $("line-text").textContent = linePrimaryText(l);
  const sec = lineSecondaryText(l);
  $("line-de").textContent = scene.blind
    ? tt("🕶 Blind mode — improvise!", "🕶 Blind-Modus — improvisier!")
    : (sec ? "🇬🇧 " + sec : "");
  showLineDuration(l);
  $("booth-video").currentTime = l.t;
  $("btn-line-play").disabled = !takes[l.idx] || takes[l.idx] === "SKIP";
  $("btn-line-next").disabled = !takes[l.idx];
  const prevBtn = $("btn-line-prev");
  if (prevBtn) { prevBtn.style.display = redoMode !== null ? "none" : ""; prevBtn.disabled = curLine <= 0; }
  $("btn-line-next").textContent = redoMode !== null
    ? tt("✅ Update & back", "✅ Aktualisieren & zurück")
    : tt("✅ Good, next", "✅ Passt, weiter");
  const sk = $("btn-line-skip"); if (sk) sk.style.display = lineHasOrig(l) ? "" : "none";
  const og = $("btn-line-orig"); if (og) og.style.display = (lineHasOrig(l) && !scene.blind) ? "" : "none";
  const cueWrap = $("rec-cue-wrap");
  if (cueWrap) cueWrap.style.display = (lineHasOrig(l) && !scene.blind) ? "" : "none";
  const efSel = $("my-effect-select");
  if (efSel) {
    const baseRole = roleOf(roleOfLine(l) ?? myRole()) || { effect: "none" };
    const sceneDefault = effectiveRole(baseRole, l).effect;
    const stdLabel = stripRoleFx
      ? tt("Normal (role FX off)", "Normal (Rollen-Effekt aus)")
      : effectLabel(sceneDefault);
    efSel.innerHTML = `<option value="">🎭 ${esc(tt("Default", "Standard"))} (${esc(stdLabel)})</option>` +
      Object.keys(EFFECTS).map((k) => `<option value="${k}">${esc(effectLabel(k))}</option>`).join("");
    efSel.value = myEffectOverrides[l.idx] || "";
  }
  const sx = $("strip-role-fx");
  if (sx) sx.checked = !!stripRoleFx;
  syncFxAmountUI(l);
  syncLineGainUI(l);
  syncLinePanUI(l);
  stopFxPreview(); fxPreviewRaw = null; fxPreviewCacheKey = null;
  $("rectime-fill").style.width = "0";
  if (lineHasOrig(l)) previewRefViz(l); else { cancelAnimationFrame(vizRAF); const c = $("viz"); if (c) { const g = c.getContext("2d"); g.clearRect(0,0,c.width,c.height); } }
  status("booth-status", takes[l.idx] ? tt("Take saved — listen, re-record or continue.", "Take gespeichert — anhören, neu aufnehmen oder weiter.") : t("booth.status"));
}

// Szenen-Ausschnitt zum Reinhören

// Original-Voiceline anhören (Aussprache-Referenz, z. B. "Surprise Mothafucka")

// Voice-Track: eine lange Stimmen-Spur, aus der Lines per Zeitfenster geschnitten werden.
// Cache pro URL (wie origCache) statt einer globalen Variable: dadurch kann die Spur einer
// vorherigen Szene nie hängenbleiben, egal an welcher Stelle `scene` neu gesetzt wird.
const voiceTrackCache = new Map();     // url -> AudioBuffer
const voiceTrackLoading = new Map();   // url -> laufender Ladevorgang
async function getVoiceTrack() {
  const url = scene && scene.voiceTrack && assetUrl(scene.voiceTrack);
  if (!url) return null;
  if (voiceTrackCache.has(url)) return voiceTrackCache.get(url);
  if (voiceTrackLoading.has(url)) return voiceTrackLoading.get(url);
  const load = (async () => {
    try {
      const ctx = getCtx();
      const raw = await (await fetch(url)).arrayBuffer();
      const buf = await ctx.decodeAudioData(raw);
      voiceTrackCache.set(url, buf);
      return buf;
    } catch (e) {
      console.warn("Voice-Track nicht ladbar:", e);
      return null;   // Fehlschlag nicht cachen, damit ein erneuter Klick es nochmal versucht
    } finally {
      voiceTrackLoading.delete(url);
    }
  })();
  voiceTrackLoading.set(url, load);
  return load;
}
// Schneidet ein Stück [t, end] aus dem Voice-Track als eigenen AudioBuffer
function sliceBuffer(full, t, end) {
  const ctx = getCtx();
  const sr = full.sampleRate;
  const from = Math.max(0, Math.floor(t * sr));
  const to = Math.min(full.length, Math.floor(end * sr));
  const len = Math.max(1, to - from);
  const out = ctx.createBuffer(full.numberOfChannels, len, sr);
  for (let ch = 0; ch < full.numberOfChannels; ch++) {
    out.getChannelData(ch).set(full.getChannelData(ch).subarray(from, to));
  }
  return out;
}
// Holt den Original-AudioBuffer einer Line: entweder aus l.orig ODER aus dem Voice-Track
async function getLineOrigBuffer(l) {
  if (l.orig) {
    const ctx = getCtx();
    const url = assetUrl(l.orig);
    if (!origCache.has(url)) {
      // Früher: await (await fetch(url)).arrayBuffer() — ohne jede Prüfung.
      // Antwortete das CDN mit 403/404, wurden die Fehlerseiten-Bytes an
      // decodeAudioData weitergereicht, das warf, und im Booth stand nur
      // "Original nicht ladbar". Genau das trat bei einzelnen Lines auf.
      // Jetzt: Antwort prüfen und wie beim Video auf GitHub Raw ausweichen.
      const laden = async (u) => {
        const res = await fetch(u, { mode: "cors" });
        if (!res.ok) throw new Error("HTTP " + res.status + " für " + u);
        const ab = await res.arrayBuffer();
        if (!ab || ab.byteLength < 256) throw new Error("Datei zu klein/leer: " + u);
        return await ctx.decodeAudioData(ab);
      };
      let dec = null;
      try {
        dec = await laden(url);
      } catch (e1) {
        const raw = rawUrlFor(url);
        if (!raw) throw e1;
        console.warn("Original-Ton über CDN fehlgeschlagen (" + e1.message + ") → Notfallweg GitHub Raw");
        dec = await laden(raw);
      }
      origCache.set(url, dec);
    }
    return origCache.get(url);
  }
  const full = await getVoiceTrack();
  if (full) return sliceBuffer(full, l.t, l.end);
  return null;
}
function lineHasOrig(l) { return !!(l.orig || scene.voiceTrack); }

const origCache = new Map();
let origSrc = null, origReqId = 0;
$("btn-line-orig").onclick = async () => {
  const l = myLines[curLine];
  if (!lineHasOrig(l)) return;
  if (origSrc) { try { origSrc.stop(); } catch {} origSrc = null; $("btn-line-orig").textContent = t("booth.orig"); $("booth-video").pause(); return; }
  const ctx = getCtx();
  const myReqId = ++origReqId;   // eigener Zähler-Wert -- wenn sich die Line inzwischen geändert hat, brechen wir unten ab
  try {
    $("btn-line-orig").textContent = "⏳ …";
    const buffer = await getLineOrigBuffer(l);
    if (myReqId !== origReqId) return;   // zwischenzeitlich wurde die Line gewechselt oder neu geklickt -> diese veraltete Anfrage verwerfen, NICHT mehr abspielen
    if (!buffer) throw new Error("kein Original");
    // Video läuft synchron mit, Original-Stimme liegt drüber (Video leise)
    const v = $("booth-video");
    v.pause(); v.currentTime = l.t; v.volume = boothVol * 0.45; v.playbackRate = practiceSpeed;
    await v.play().catch(() => {});
    if (myReqId !== origReqId) return;   // sicherheitshalber nach dem await auf v.play() nochmal prüfen
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = practiceSpeed;
    src.connect(ctx.destination);
    src.start();
    origSrc = src;
    $("btn-line-orig").textContent = "⏹ Stopp";
    src.onended = () => { if (origSrc === src) { origSrc = null; $("btn-line-orig").textContent = t("booth.orig"); v.pause(); } };
  } catch (e) {
    if (myReqId !== origReqId) return;
    $("btn-line-orig").textContent = t("booth.orig");
    status("booth-status", tt("Original audio couldn’t load — GitHub Pages still deploying?", "Original-Audio nicht ladbar — GitHub Pages noch am Deployen?"), true);
  }
};


// Übungs-Tempo: Szene & Original langsamer ansehen/anhören — die AUFNAHME läuft
// immer in Normal-Tempo, damit das Endergebnis richtig klingt.
let practiceSpeed = 1;
document.querySelectorAll(".speedbtn").forEach(b => b.onclick = () => {
  practiceSpeed = parseFloat(b.dataset.s);
  document.querySelectorAll(".speedbtn").forEach(x => x.classList.toggle("mine", x === b));
});

let sceneStopHandler = null;
$("btn-line-scene").onclick = () => {
  const l = myLines[curLine];
  const v = $("booth-video");
  if (sceneStopHandler) { v.removeEventListener("timeupdate", sceneStopHandler); sceneStopHandler = null; }
  if (!v.paused) { v.pause(); $("btn-line-scene").textContent = t("booth.scene"); return; }   // 2. Klick = Stopp
  v.currentTime = Math.max(0, l.t - 0.5);
  v.volume = boothVol; v.playbackRate = practiceSpeed;
  v.play();
  $("btn-line-scene").textContent = tt("⏹ Stop", "⏹ Stopp");
  sceneStopHandler = () => {
    if (v.currentTime >= l.end + 0.3) {
      v.pause();
      v.removeEventListener("timeupdate", sceneStopHandler); sceneStopHandler = null;
      $("btn-line-scene").textContent = t("booth.scene");
    }
  };
  v.addEventListener("timeupdate", sceneStopHandler);
};

let recBusy = false;
let recCueSrc = null, recCueGain = null;   // Original-Cue nur im Ohr, nie im MediaRecorder
function stopRecCue() {
  if (recCueSrc) { try { recCueSrc.stop(); } catch {} recCueSrc = null; }
  recCueGain = null;
}
function cueWhileRecOn() {
  const c = $("rec-cue-orig");
  return !!(c && c.checked && scene && !scene.blind);
}
function cueVolNow() {
  const cv = $("rec-cue-vol");
  const v = cv ? parseFloat(cv.value) : 0.45;
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.45;
}
async function startRecCue(l) {
  stopRecCue();
  if (!cueWhileRecOn() || !lineHasOrig(l)) return;
  try {
    const ctx = getCtx();
    const buffer = await getLineOrigBuffer(l);
    if (!buffer || !recording) return;   // Aufnahme schon wieder vorbei
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.value = cueVolNow();
    src.connect(g); g.connect(ctx.destination);   // nur Lautsprecher/Kopfhörer — nicht ins Mic-Rec
    src.start();
    recCueSrc = src;
    recCueGain = g;
    src.onended = () => { if (recCueSrc === src) { recCueSrc = null; recCueGain = null; } };
  } catch (e) { console.warn("Rec-Cue Original:", e); }
}
function boothButtons_unused(dis) { ["btn-line-scene","btn-line-play","btn-line-next","btn-line-skip"].forEach(id => $(id).disabled = dis || (id !== "btn-line-scene" && $(id).disabled)); if(!dis) renderLine._keep || 0; }
function setAbortBtn(show) {
  const b = $("btn-line-abort");
  if (b) b.style.display = show ? "" : "none";
}
function abortLineRec() {
  // Countdown / Vorbereitung: sauber abbrechen, nichts speichern
  if (recBusy && !recording) {
    recPrepCancel = true;
    forceRecReset();
    status("booth-status", tt("Recording cancelled.", "Aufnahme abgebrochen."));
    SFX.click();
    return;
  }
  if (!recording || !lineRec || lineRec.state !== "recording") return;
  // Mitten in der Line: Clip als Outtake behalten, bisherigen Take nicht überschreiben
  recAbortOuttake = true;
  stopLineRec();
}
if ($("btn-line-abort")) $("btn-line-abort").onclick = () => { abortLineRec(); };

$("btn-line-rec").onclick = async () => {
  if (lineRec && lineRec.state === "recording") { stopLineRec(); return; }
  if (recBusy) {
    // Notaus: Falls ein früherer Start hängen geblieben ist, nach 6s Reset erlauben
    if (performance.now() - (recBusy.t || 0) > 6000) forceRecReset();
    return;
  }
  recBusy = { t: performance.now() };
  recPrepCancel = false;
  recAbortOuttake = false;
  stopRecCue();
  // Original-Anhören stoppen, sonst doppelt mit Cue
  if (origSrc) { try { origSrc.stop(); } catch {} origSrc = null; const ob = $("btn-line-orig"); if (ob) ob.textContent = t("booth.orig"); }
  ["btn-line-scene","btn-line-play","btn-line-next","btn-line-skip","btn-line-orig","btn-line-prev"].forEach(id => { const el = $(id); if (el) el.disabled = true; });
  setAbortBtn(true);
  status("booth-status", tt("🎯 Getting ready to record …", "🎯 Bereite Aufnahme vor …"));
  try {
    if ($("rec-timer").checked) {
      if ($("rec-wipe") && $("rec-wipe").checked) await wipeCountdown();
      else await recCountdown();
    }
    if (recPrepCancel) throw Object.assign(new Error("cancel"), { name: "RecCancel" });
    const l = myLines[curLine];
    // Adaptiver Puffer: nicht in die nächste Line reinlaufen
    recMax = recWindowFor(l);
    const v = $("booth-video");
    v.pause(); v.currentTime = l.t; v.volume = boothVol; v.playbackRate = 1;
    await new Promise((res, rej) => {
      const to = setTimeout(res, 4000);
      const h = () => { clearTimeout(to); v.removeEventListener("seeked", h); clearInterval(chk); res(); };
      v.addEventListener("seeked", h);
      const chk = setInterval(() => {
        if (recPrepCancel) { clearTimeout(to); clearInterval(chk); v.removeEventListener("seeked", h); rej(Object.assign(new Error("cancel"), { name: "RecCancel" })); }
      }, 40);
    });
    lineChunks = [];
    lineRec = new MediaRecorder(recStream(), { mimeType: pickMime() });
    lineRec.ondataavailable = e => { if (e.data.size) lineChunks.push(e.data); };
    lineRec.onstop = onLineRecorded;
    await v.play();
    // KEIN Event-Warten mehr (Race!): pollen, bis das Video wirklich läuft
    await new Promise((res, rej) => {
      const t0 = performance.now();
      const iv = setInterval(() => {
        if (recPrepCancel) { clearInterval(iv); rej(Object.assign(new Error("cancel"), { name: "RecCancel" })); return; }
        if (v.currentTime > l.t + 0.03 || performance.now() - t0 > 2500) { clearInterval(iv); res(); }
      }, 16);
    });
    if (recPrepCancel) throw Object.assign(new Error("cancel"), { name: "RecCancel" });
    lineRec.start();
    recBusy = false;
    recording = true;
    setAbortBtn(true);
    // Cue parallel zum Mic starten (nur Wiedergabe, nicht in der Aufnahme)
    startRecCue(l);
    startDualViz("viz", l, recMax);
    SFX.rec();
    $("btn-line-rec").textContent = tt("⏹ Stop", "⏹ Stopp");
    $("btn-line-rec").classList.add("recording");
    recStartT = performance.now();
    clearInterval(recTimer);
    recTimer = setInterval(() => {
      const el = (performance.now() - recStartT) / 1000;
      $("rectime-fill").style.width = Math.min(100, el / recMax * 100) + "%";
      if (el >= recMax) stopLineRec();
    }, 50);
    const cueHint = cueWhileRecOn() && lineHasOrig(l) ? tt(" · original in your ear", " · Original im Ohr") : "";
    status("booth-status", tt("🔴 Recording … Stop = keep take · Cancel = outtake", "🔴 Aufnahme läuft … Stopp = Take behalten · Abbrechen = Outtake") + cueHint);
  } catch (e) {
    if (e && e.name === "RecCancel") {
      forceRecReset();
      status("booth-status", tt("Recording cancelled.", "Aufnahme abgebrochen."));
      return;
    }
    console.error("Rec-Start fehlgeschlagen:", e);
    forceRecReset();
    status("booth-status", tt("⚠ Record start stuck — press again!", "⚠ Aufnahme-Start hakte — nochmal drücken!"), true);
  } finally {
    recPrepCancel = false;
  }
};

// Alles zurücksetzen, falls ein Start hängen bleibt
function forceRecReset() {
  recBusy = false;
  recording = false;
  recAbortOuttake = false;
  clearInterval(recTimer);
  stopRecCue();
  try { $("booth-video").pause(); } catch {}
  if (lineRec && lineRec.state === "recording") {
    try { if (typeof lineRec.requestData === "function") lineRec.requestData(); } catch {}
    try { lineRec.stop(); } catch {}
  }
  setAbortBtn(false);
  $("btn-line-rec").textContent = t("booth.rec");
  $("btn-line-rec").classList.remove("recording");
  $("btn-line-rec").disabled = false;
  ["btn-line-scene","btn-line-orig"].forEach(id => { const el = $(id); if (el) el.disabled = false; });
  renderLine();
}


function recCountdown() {
  return new Promise((res, rej) => {
    const b = $("btn-line-rec");
    let n = 3;
    b.disabled = true;
    b.textContent = "⏱ " + n + " …";
    setAbortBtn(true);
    SFX.beep();
    const iv = setInterval(() => {
      if (recPrepCancel) {
        clearInterval(iv);
        b.disabled = false;
        rej(Object.assign(new Error("cancel"), { name: "RecCancel" }));
        return;
      }
      n--;
      if (n === 0) { clearInterval(iv); b.disabled = false; SFX.go(); res(); }
      else { b.textContent = "⏱ " + n + " …"; SFX.beep(); }
    }, 800);
  });
}

// Weiße Balken nur in der Line-Booth — nie bei Premiere/Playback
function wipeCountdown() {
  return new Promise((res, rej) => {
    const el = $("wipe-booth");
    const num = el && el.querySelector(".wipe-num");
    if (!el || !document.querySelector("#scr-booth.active")) { recCountdown().then(res, rej); return; }
    el.classList.remove("run", "flash");
    el.classList.add("show");
    void el.offsetWidth;
    el.classList.add("run");
    let n = 3;
    if (num) num.textContent = n;
    setAbortBtn(true);
    SFX.beep();
    const iv = setInterval(() => {
      if (recPrepCancel) {
        clearInterval(iv);
        el.classList.remove("show", "run", "flash");
        if (num) num.textContent = "3";
        rej(Object.assign(new Error("cancel"), { name: "RecCancel" }));
        return;
      }
      n--;
      if (n <= 0) {
        clearInterval(iv);
        el.classList.add("flash");
        SFX.go();
        setTimeout(() => {
          el.classList.remove("show", "run", "flash");
          if (num) num.textContent = "3";
          res();
        }, 100);
      } else {
        if (num) num.textContent = n;
        SFX.beep();
      }
    }, 900);
  });
}

function preferWipe() {
  return !!( $("rec-wipe") && $("rec-wipe").checked );
}

// Theater-Vorhang — nur Podest-Finale (schnell, ohne Premiere-Verzögerung)
function curtainsShow(closed) {
  const el = $("cinema-curtains");
  if (!el) return;
  el.classList.add("show");
  el.classList.toggle("open", !closed);
}
function curtainsOpen() {
  return new Promise(res => {
    const el = $("cinema-curtains");
    if (!el) { res(); return; }
    curtainsShow(true);
    void el.offsetWidth;
    requestAnimationFrame(() => {
      el.classList.add("open");
      setTimeout(res, 720);
    });
  });
}
function curtainsClose() {
  return new Promise(res => {
    const el = $("cinema-curtains");
    if (!el) { res(); return; }
    el.classList.add("show");
    el.classList.remove("open");
    setTimeout(() => { el.classList.remove("show"); res(); }, 650);
  });
}

function stopLineRec() {
  recBusy = false;
  recording = false;
  clearInterval(recTimer);
  stopRecCue();
  $("booth-video").pause();
  if (lineRec && lineRec.state === "recording") {
    try { if (typeof lineRec.requestData === "function") lineRec.requestData(); } catch {}
    try { lineRec.stop(); } catch {}
  }
  setAbortBtn(false);
  $("btn-line-rec").textContent = tt("⏺ Record again", "⏺ Nochmal aufnehmen");
  $("btn-line-rec").classList.remove("recording");
  SFX.stop();
}

async function onLineRecorded() {
  const wasAbort = recAbortOuttake;
  recAbortOuttake = false;
  recBusy = false;
  setAbortBtn(false);
  ["btn-line-scene","btn-line-skip","btn-line-orig"].forEach(id => { const el = $(id); if (el) el.disabled = false; });
  const l = myLines[curLine];
  if (!l) return;

  let buf = null;
  try {
    if (lineChunks.length) {
      buf = await new Blob(lineChunks, { type: lineChunks[0]?.type || "audio/webm" }).arrayBuffer();
    }
  } catch (e) { console.warn("Take-Blob:", e); }

  // Abbrechen mitten in der Line → Blooper behalten, bisherigen Take nicht anfassen
  if (wasAbort) {
    if (outtakeBufOk(buf)) {
      try {
        pushLocalOuttake({
          lineIdx: l.idx,
          text: linePrimaryText(l) || ("Line " + (l.idx + 1)),
          t: l.t,
          end: l.end,
          buf: buf.slice(0),
          name: myName,
          uid: outtakeUid()
        });
        updateOuttakesBtn();
        status("booth-status", tt("Outtake saved — previous take stays. Again or continue.", "Outtake gespeichert — alter Take bleibt. Nochmal oder weiter."));
      } catch (e) { console.warn("Outtake abort:", e); }
    } else {
      status("booth-status", tt("Cancelled (too short for an outtake).", "Abgebrochen (zu kurz für Outtake)."));
    }
    $("btn-line-play").disabled = !takes[l.idx] || takes[l.idx] === "SKIP";
    $("btn-line-next").disabled = !takes[l.idx];
    return;
  }

  const prev = takes[l.idx];
  // Alten Take als Outtake behalten (Blooper-Reel nach der Premiere)
  if (prev && prev !== "SKIP" && outtakeBufOk(prev)) {
    try {
      pushLocalOuttake({
        lineIdx: l.idx,
        text: linePrimaryText(l) || ("Line " + (l.idx + 1)),
        t: l.t,
        end: l.end,
        buf: prev.slice(0),
        name: myName,
        uid: outtakeUid()
      });
      updateOuttakesBtn();
    } catch {}
  }
  if (outtakeBufOk(buf)) {
    takes[l.idx] = buf;
    $("btn-line-play").disabled = false;
    $("btn-line-next").disabled = false;
    status("booth-status", tt("Take in the can! Listen or continue.", "Take im Kasten! Anhören oder direkt weiter."));
  } else {
    $("btn-line-play").disabled = !takes[l.idx] || takes[l.idx] === "SKIP";
    $("btn-line-next").disabled = !takes[l.idx];
    status("booth-status", tt("Recording was empty/too short — try again.", "Aufnahme war leer/zu kurz — nochmal versuchen."), true);
  }
}

let previewSrc = null;
$("btn-line-play").onclick = async () => {
  const l = myLines[curLine];
  if (!takes[l.idx] || takes[l.idx] === "SKIP") return;
  if (previewSrc) { try { previewSrc.stop(); } catch {} previewSrc = null; }
  const ctx = getCtx();
  const rawBuf = await ctx.decodeAudioData(await toArrayBuffer(takes[l.idx]));
  const _r = myEffectiveRole(myLines[curLine] || {});
  const buf = processTakeBuffer(ctx, rawBuf, micSettings.gate, _r.effect, _r.fxAmount);   // Gate + ggf. Studio-Aufbereitung
  // Videobild läuft synchron mit (leise), kein Standbild mehr
  const v = $("booth-video");
  v.pause(); v.currentTime = l.t; v.volume = boothVol * 0.6; v.playbackRate = 1;
  await v.play();
  const effRole = myEffectiveRole(myLines[curLine]);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = effectPitch(effRole.effect);
  src.connect(buildChain(ctx, effRole, ctx.destination));
  src.start();
  previewSrc = src;
  src.onended = () => { if (previewSrc === src) previewSrc = null; v.pause(); };
};

function bufferPeak(buf) {
  let p = 0;
  // Jeden Wert pruefen -- kurze Spitzen wuerden beim Ueberspringen sonst untergehen,
  // und genau die sind es, die beim Lauterdrehen als Erstes uebersteuern.
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > p) p = v; }
  }
  return p;
}

function syncLineGainUI(l) {
  const sl = $("my-line-gain"), val = $("my-line-gain-val"), warn = $("my-line-gain-warn");
  if (!sl || !l) return;
  const g = myLineGains[l.idx];
  sl.value = g === undefined ? 1 : g;
  if (val) val.textContent = Math.round(parseFloat(sl.value) * 100) + "%";
  // Warnen, wenn die Aufnahme durch das Anheben in die Uebersteuerung laeuft (klingt dann kratzig).
  // takes[] sind ArrayBuffers — Peak erst nach Decode; hier nur grob ausblenden wenn kein Take.
  if (warn) {
    const t = takes[l.idx];
    if (!t || t === "SKIP") { warn.style.display = "none"; }
    else {
      // Async Peak-Check, damit die UI nicht hakt und ArrayBuffer nicht falsch gelesen wird
      const gainNow = parseFloat(sl.value);
      toArrayBuffer(t).then(ab => getCtx().decodeAudioData(ab.slice(0))).then(buf => {
        if (myLines[curLine] !== l) return; // Line inzwischen gewechselt
        warn.style.display = (bufferPeak(buf) * gainNow > 0.99) ? "" : "none";
      }).catch(() => { warn.style.display = "none"; });
    }
  }
}

function syncLinePanUI(l) {
  const wrap = $("my-line-pan");
  if (!wrap || !l) return;
  const presets = linePanPresets();
  const active = panPresetId(myLinePans[l.idx]);
  wrap.innerHTML = presets.map(p =>
    `<button type="button" class="pan-btn${p.id === active ? " on" : ""}" data-pan="${p.id}" title="${esc(p.tip)}">${esc(p.label)}</button>`
  ).join("");
  wrap.querySelectorAll(".pan-btn").forEach(btn => {
    btn.onclick = () => {
      const preset = presets.find(p => p.id === btn.dataset.pan);
      if (!preset) return;
      // Mitte = Standard → Eintrag löschen; alles andere speichern
      if (preset.pan === 0) delete myLinePans[l.idx];
      else myLinePans[l.idx] = preset.pan;
      syncLinePanUI(l);
      fxPreviewCacheKey = null;
      if (fxPreviewSrc) { clearTimeout(fxRestartT); fxRestartT = setTimeout(startFxPreview, 220); }
      SFX.click();
    };
  });
}

function syncFxAmountUI(l) {
  const sl = $("my-effect-amount"), val = $("my-effect-amount-val");
  if (!sl || !l) return;
  const amt = myEffectAmounts[l.idx];
  sl.value = amt === undefined ? 1 : amt;
  if (val) val.textContent = Math.round(parseFloat(sl.value) * 100) + "%";
  // Bei "Normal" bringt der Regler nichts -- dann ausgrauen statt Verwirrung stiften
  const eff = myEffectiveRole(l).effect;
  const off = !eff || eff === "none";
  sl.disabled = off;
  sl.style.opacity = off ? ".35" : "1";
}

$("my-effect-select").onchange = () => {
  const l = myLines[curLine];
  if (!l) return;
  const v = $("my-effect-select").value;
  if (v) myEffectOverrides[l.idx] = v; else delete myEffectOverrides[l.idx];
  syncFxAmountUI(l);
  fxPreviewCacheKey = null;
  if (fxPreviewSrc) startFxPreview();
  SFX.click();
};
$("my-effect-amount") && ($("my-effect-amount").oninput = e => {
  const l = myLines[curLine];
  if (!l) return;
  const v = parseFloat(e.target.value);
  if (v >= 0.999) delete myEffectAmounts[l.idx]; else myEffectAmounts[l.idx] = v;
  const val = $("my-effect-amount-val");
  if (val) val.textContent = Math.round(v * 100) + "%";
  // laeuft gerade eine Vorschau? Dann mit der neuen Staerke direkt neu abspielen
  if (fxPreviewSrc) { clearTimeout(fxRestartT); fxRestartT = setTimeout(startFxPreview, 220); }
});
let fxRestartT = null;

$("my-line-gain") && ($("my-line-gain").oninput = e => {
  const l = myLines[curLine];
  if (!l) return;
  const v = parseFloat(e.target.value);
  if (Math.abs(v - 1) < 0.001) delete myLineGains[l.idx]; else myLineGains[l.idx] = v;
  syncLineGainUI(l);
  if (fxPreviewSrc) { clearTimeout(fxRestartT); fxRestartT = setTimeout(startFxPreview, 220); }
});

// 🔊 Vorhoeren: spielt den eigenen Take (oder ersatzweise das Original) durch den aktuell
// eingestellten Effekt -- damit man Effekt UND Staerke hoert, bevor man sich festlegt.
let fxPreviewSrc = null, fxPreviewRaw = null, fxPreviewIsTake = false, fxPreviewCacheKey = null, fxPreviewCacheBuf = null;
async function fxPreview() {
  const btn = $("btn-fx-preview");
  const l = myLines[curLine];
  if (!l || !btn) return;
  if (fxPreviewSrc) { stopFxPreview(); return; }
  try {
    const ctx = getCtx();
    if (ctx.state === "suspended") await ctx.resume();   // Browser pausieren den Ton bis zur ersten Geste
    btn.textContent = "⏳ …";
    let raw = null;
    let isTake = false;
    if (takes[l.idx] && takes[l.idx] !== "SKIP") {
      // Takes liegen als ArrayBuffer — processTakeBuffer braucht ein AudioBuffer
      raw = await ctx.decodeAudioData(await toArrayBuffer(takes[l.idx]));
      isTake = true;
    } else {
      try { raw = await getLineOrigBuffer(l); } catch {}
    }
    if (!raw) {
      status("booth-status", tt("Record first to preview — or pick a scene with original audio.", "Zum Vorhören erst aufnehmen — oder eine Szene mit Original wählen."), true);
      btn.textContent = t("booth.fx.prev"); return;
    }
    fxPreviewRaw = raw;
    fxPreviewIsTake = isTake;
    fxPreviewCacheKey = null;
    startFxPreview();
  } catch (e) {
    console.error("Vorhören fehlgeschlagen:", e);
    status("booth-status", tt("Preview didn’t work — try again.", "Vorhören hat nicht geklappt — nochmal versuchen."), true);
    btn.textContent = t("booth.fx.prev");
  }
}

function stopFxPreview() {
  if (fxPreviewSrc) { try { fxPreviewSrc.stop(); } catch {} fxPreviewSrc = null; }
  const btn = $("btn-fx-preview"); if (btn) btn.textContent = t("booth.fx.prev");
}

function startFxPreview() {
  const l = myLines[curLine];
  const btn = $("btn-fx-preview");
  if (!l || !fxPreviewRaw) return;
  if (fxPreviewSrc) { try { fxPreviewSrc.stop(); } catch {} fxPreviewSrc = null; }
  const ctx = getCtx();
  const role = myEffectiveRole(l);
  // Aufbereitung kann bei „Studio" rechenintensiv sein -> Ergebnis je Einstellung merken,
  // damit man am Stärke-Regler ziehen kann, ohne dass es jedes Mal neu rechnet und hakt.
  const key = role.effect + "|" + (role.fxAmount === undefined ? 1 : role.fxAmount) + "|" + (role.gain ?? 1) + "|" + (role.pan ?? 0) + "|" + micSettings.gate + "|" + (fxPreviewIsTake ? "t" : "o") + "|" + stripRoleFx;
  let buf;
  if (fxPreviewCacheKey === key && fxPreviewCacheBuf) buf = fxPreviewCacheBuf;
  else {
    buf = fxPreviewIsTake ? processTakeBuffer(ctx, fxPreviewRaw, micSettings.gate, role.effect, role.fxAmount) : fxPreviewRaw;
    fxPreviewCacheKey = key; fxPreviewCacheBuf = buf;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = effectPitch(role.effect);
  src.connect(buildChain(ctx, role, ctx.destination));
  src.start();
  fxPreviewSrc = src;
  if (btn) btn.textContent = tt("⏹ Stop", "⏹ Stopp");
  src.onended = () => { if (fxPreviewSrc === src) { fxPreviewSrc = null; if (btn) btn.textContent = t("booth.fx.prev"); } };
}
$("btn-fx-preview") && ($("btn-fx-preview").onclick = fxPreview);
$("btn-line-prev").onclick = () => {
  if (recording || recBusy) return;
  if (redoMode !== null || curLine <= 0) return;
  curLine--; renderLine(); SFX.click();
};
$("btn-line-next").onclick = () => {
  if (redoMode !== null) { finishRedo(); return; }
  SFX.ok();
  curLine++;
  sendProgress();
  renderLine();
};
$("btn-line-skip").onclick = () => {
  const l = myLines[curLine];
  takes[l.idx] = "SKIP";              // Marker: diese Line behält das Original-Audio
  SFX.ok();
  if (redoMode !== null) { finishRedo(); return; }
  curLine++;
  sendProgress();
  renderLine();
};

function sendProgress(force) {
  const done = Object.keys(takes).length, total = myLines.length;
  const me = players.find(p => p.id === myId);
  if (me) { me.done = done; me.total = total; }
  if (isHost) broadcastState(force ? undefined : { throttle: true });
  else sendHost({ t: "progress", done, total });
}

function serializeOuttakes(onlyMine) {
  let list = dedupeOuttakes(outtakes).filter(o => outtakeBufOk(o && o.buf));
  if (onlyMine) list = list.filter(o => (o.name || myName) === myName);
  return list.map(o => {
    let buf = o.buf;
    try {
      if (buf instanceof ArrayBuffer) buf = buf.slice(0);
      else if (ArrayBuffer.isView(buf)) buf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    } catch {}
    return {
      lineIdx: o.lineIdx,
      text: o.text,
      t: o.t,
      end: o.end,
      name: o.name || myName,
      uid: o.uid || outtakeUid(),
      buf
    };
  });
}

/** Host: Outtakes eines Spielers im gemeinsamen Pool ersetzen und an alle schicken. */
function ingestOuttakesFromPlayer(fromId, playerName, ots) {
  if (!Array.isArray(ots) || !ots.length) return;
  const name = playerName || (players.find(p => p.id === fromId) || {}).name || myName || "?";
  const keep = outtakes.filter(o => o && o.name !== name);
  const incoming = ots.map(o => {
    let buf = o && o.buf;
    try {
      if (buf instanceof ArrayBuffer) buf = buf.slice(0);
      else if (ArrayBuffer.isView(buf)) buf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    } catch {}
    return {
      lineIdx: o.lineIdx,
      text: o.text,
      t: o.t,
      end: o.end,
      name: o.name || name,
      uid: o.uid || outtakeUid(),
      buf
    };
  }).filter(o => outtakeBufOk(o.buf));
  outtakes = dedupeOuttakes(keep.concat(incoming)).slice(0, OUTTAKE_POOL_MAX);
  outtakesCache = null;
  resolveOuttakesCachePending(null);
  updateOuttakesBtn();
  if (isHost) {
    broadcast({
      t: "outtakesPool",
      items: outtakes.map(o => {
        let buf = o.buf;
        try {
          if (buf instanceof ArrayBuffer) buf = buf.slice(0);
          else if (ArrayBuffer.isView(buf)) buf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        } catch {}
        return { lineIdx: o.lineIdx, text: o.text, t: o.t, end: o.end, name: o.name, uid: o.uid, buf };
      })
    });
    scheduleOuttakesPrecache();
  }
}

/** Boost-/Pan-Werte extra mitschicken — PeerJS verliert Nebenfelder neben ArrayBuffers manchmal. */
function boostMapFromItems(items) {
  const m = {};
  for (const it of items) {
    if (it.boost != null && it.boost !== 1 && it.idx != null) m[it.idx] = it.boost;
  }
  return m;
}
function attachBoosts(items, boostByIdx) {
  if (!items || !boostByIdx) return items;
  for (const it of items) {
    if (it.boost != null) continue;
    const b = boostByIdx[it.idx] ?? boostByIdx[String(it.idx)];
    if (b != null) it.boost = b;
  }
  return items;
}
function panMapFromItems(items) {
  const m = {};
  for (const it of items) {
    if (it.pan != null && it.idx != null) m[it.idx] = it.pan;
  }
  return m;
}
function attachPans(items, panByIdx) {
  if (!items || !panByIdx) return items;
  for (const it of items) {
    if (it.pan != null) continue;
    const p = panByIdx[it.idx] ?? panByIdx[String(it.idx)];
    if (p != null) it.pan = p;
  }
  return items;
}
function attachTrackMeta(items, msg) {
  return attachPans(attachBoosts(items, msg && msg.boostByIdx), msg && msg.panByIdx);
}
/** Alle Takes einer Mix-Nachricht → Boost/Pan-Maps (für Host→Gast-Broadcast). */
function metaMapsFromTracks(tracks) {
  const all = [];
  for (const tr of tracks || []) {
    if (tr && tr.items) for (const it of tr.items) all.push(it);
  }
  return { boostByIdx: boostMapFromItems(all), panByIdx: panMapFromItems(all) };
}
function attachMetaToTracks(tracks, msg) {
  if (!tracks || !msg) return tracks;
  for (const tr of tracks) {
    if (tr && tr.items) attachTrackMeta(tr.items, msg);
  }
  return tracks;
}
/** Eigene Booth-Einstellungen nachziehen, falls PeerJS Meta unterwegs verloren hat. */
function applyLocalLineMeta(tracks) {
  const meine = myRoles();
  if (!meine.length || !tracks) return;
  for (const tr of tracks) {
    if (!tr || !meine.includes(tr.role) || !tr.items) continue;
    for (const it of tr.items) {
      if (it.boost == null && myLineGains[it.idx] != null) it.boost = myLineGains[it.idx];
      if (it.pan == null && myLinePans[it.idx] != null) it.pan = myLinePans[it.idx];
    }
  }
}
/** Mix an alle schicken — Boost/Pan extra, weil sie neben Audio-Buffern oft verloren gehen. */
function publishMix(data) {
  finalTracksData = data;
  const maps = metaMapsFromTracks(data);
  broadcast({ t: "mix", data, ...maps });
  loadMix(data);
}

function finishBooth() {
  cancelAnimationFrame(vizRAF);
  $("onair").classList.remove("live");
  SFX.done();
  sendProgress(true);   // letzten Fortschritt sofort pushen (kein Debounce-Rest)
  show("scr-wait");
  renderBoothPlayers();
  const items = myLines.filter(l => takes[l.idx] && takes[l.idx] !== "SKIP")
    .map(l => ({ startAt: l.t, idx: l.idx, buf: takes[l.idx], effect: submitEffectFor(l), fxAmount: myEffectAmounts[l.idx], boost: myLineGains[l.idx], pan: submitPanFor(l), gate: micSettings.gate }));
  const ots = serializeOuttakes(true);
  const boostByIdx = boostMapFromItems(items);
  const panByIdx = panMapFromItems(items);
  if (match.mode === "duell" && duelInfo) {
    if (isHost) collectDuelSubmit(myId, items);
    else sendHost({ t: "duelSubmit", playerId: myId, items, boostByIdx, panByIdx });
    status("wait-status", tt("🥊 Your take is in the can! Waiting for the other duelist …", "🥊 Dein Take ist im Kasten! Warte auf den anderen Duellanten …"));
    return;
  }
  // Die gesamte Nachbearbeitung (Premiere, Outtakes, Download) ist nach ROLLE
  // sortiert, nicht nach Spieler. Wer mehrere Rollen hatte, schickt deshalb pro
  // Rolle ein eigenes Paket — danach ist alles Weitere blind für Mehrfachrollen.
  const proRolle = new Map();
  for (const it of items) {
    const l = scene.lines[it.idx];
    const rid = roleOfLine(l);
    if (rid == null) continue;
    if (!proRolle.has(rid)) proRolle.set(rid, []);
    proRolle.get(rid).push(it);
  }
  // Auch Rollen ohne brauchbare Aufnahme melden, sonst wartet die Premiere ewig
  myRoles().forEach(r => { if (!proRolle.has(r)) proRolle.set(r, []); });
  let ersteRolle = true;
  for (const [rid, teil] of proRolle) {
    // Outtakes nur EINMAL mitschicken, sonst landet jeder Versprecher mehrfach im Topf
    const otsFuerDiese = ersteRolle ? ots : [];
    if (isHost) collectTracks(rid, teil, otsFuerDiese, myId);
    else sendHost({ t: "tracks", role: rid, items: teil, boostByIdx: boostMapFromItems(teil), panByIdx: panMapFromItems(teil), outtakes: otsFuerDiese });
    ersteRolle = false;
  }
}

// ═════════════════════════════════════════════════════════════
// 7) REALTIME-MODUS (Szenen ohne Line-Timings)
// ═════════════════════════════════════════════════════════════
let rtRecorder = null, rtChunks = [];

async function startRealtime() {
  stopLobbyPreview();
  const rid = myRole();
  if (rid == null) {                       // Zuschauer — wie im Line-Booth, sonst stürzt die Seite ab
    show("scr-wait");
    renderBoothPlayers();
    const dn = $("duel-waiting-note"); if (dn) dn.style.display = "none";
    status("wait-status", tt("🍿 You’re watching — the premiere starts automatically when everyone’s done.", "🍿 Du bist Zuschauer — die Premiere startet automatisch, wenn alle fertig sind."));
    return;
  }
  const role = roleOf(rid) || { name: "—" };
  $("rec-role").textContent = tt("🎭 You are: ", "🎭 Du bist: ") + role.name;
  const v = $("rec-video");
  v.src = sceneVideoSrc();
  attachPrompter(v, $("rec-prompter"), myRoles());
  show("scr-record");
  await countdown();
  $("onair").classList.add("live");
  rtChunks = [];
  rtRecorder = new MediaRecorder(recStream(), { mimeType: pickMime() });
  rtRecorder.ondataavailable = e => { if (e.data.size) rtChunks.push(e.data); };
  rtRecorder.onstop = async () => {
    $("onair").classList.remove("live");
    status("rec-status", tt("Recording done — collecting all tracks …", "Aufnahme fertig — sammle alle Spuren ein …"));
    const buf = await new Blob(rtChunks, { type: rtChunks[0]?.type }).arrayBuffer();
    const items = [{ startAt: 0, buf }];
    if (isHost) collectTracks(myRole(), items);
    else sendHost({ t: "tracks", role: myRole(), items });
  };
  rtRecorder.start();
  v.currentTime = 0;
  await v.play();
  v.onended = () => { if (rtRecorder.state !== "inactive") rtRecorder.stop(); };
}

// opts.wipe !== false → Balken nur wenn Checkbox an UND Booth aktiv
function countdown(opts = {}) {
  if (opts.wipe !== false && preferWipe() && document.querySelector("#scr-booth.active")) {
    return wipeCountdown();
  }
  return new Promise(res => {
    const el = $("countdown"), num = el.querySelector("div");
    el.classList.add("show");
    let n = 3;
    num.textContent = n; SFX.beep();
    const iv = setInterval(() => {
      n--;
      if (n === 0) { clearInterval(iv); el.classList.remove("show"); SFX.go(); res(); }
      else { num.textContent = n; SFX.beep(); }
    }, 900);
  });
}


// ═════════════════════════════════════════════════════════════
// WARTE-ARENA: TicTacToe (Host verwaltet, alle im Warte-Screen)
// ═════════════════════════════════════════════════════════════
let ttt = { p: [], board: Array(9).fill(null), turn: 0, winner: null };
const TTT_WINS = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

function tttAction(a) { if (isHost) tttHandle(a, myId); else sendHost({ t: "ttt", a }); }
function tttHandle(a, pid) {
  if (a.k === "join" && ttt.p.length < 2 && !ttt.p.includes(pid) && !ttt.winner) ttt.p.push(pid);
  if (a.k === "move" && !ttt.winner && ttt.p.length === 2 && ttt.p[ttt.turn] === pid && ttt.board[a.i] == null) {
    ttt.board[a.i] = ttt.turn === 0 ? "X" : "O";
    for (const w of TTT_WINS) if (w.every(i => ttt.board[i] === ttt.board[w[0]] && ttt.board[i])) { ttt.winner = ttt.turn; addWin(ttt.p[ttt.turn]); }
    if (ttt.winner == null && ttt.board.every(c => c)) ttt.winner = -1;   // Unentschieden
    if (ttt.winner == null) ttt.turn = 1 - ttt.turn;
  }
  if (a.k === "reset") { ttt = { p: ttt.winner != null ? [...ttt.p].reverse() : [], board: Array(9).fill(null), turn: 0, winner: null }; if (a.hard) ttt.p = []; }
  broadcast({ t: "tttState", ttt });
  renderTTT();
}
function nameOf(pid) { return players.find(p => p.id === pid)?.name || "?"; }
function onWaitScreen() { return !!document.querySelector("#scr-wait.active"); }   // nur Sound spielen, wenn man die Warte-Arena wirklich SIEHT

function renderTTT() {
  const board = $("ttt-board");
  if (!board) return;
  const iAmIn = ttt.p.includes(myId);
  const myTurn = iAmIn && ttt.p[ttt.turn] === myId && ttt.p.length === 2 && ttt.winner == null;
  board.innerHTML = ttt.board.map((c, i) =>
    `<button class="tttcell" data-i="${i}" ${c || !myTurn ? "disabled" : ""} style="${c === "X" ? "color:var(--amber)" : c === "O" ? "color:var(--violet)" : ""}">${c || ""}</button>`
  ).join("");
  board.querySelectorAll(".tttcell").forEach(b => b.onclick = () => tttAction({ k: "move", i: parseInt(b.dataset.i) }));
  $("btn-ttt-join").style.display = (!iAmIn && ttt.p.length < 2) ? "" : "none";
  let info;
  if (ttt.p.length < 2) info = ttt.p.length === 0 ? tt("Two people waiting can play — who’s in?", "Zwei Wartende können zocken — wer traut sich?") : nameOf(ttt.p[0]) + tt(" is waiting for an opponent …", " wartet auf einen Gegner …");
  else if (ttt.winner === -1) info = tt("Draw! 🤝", "Unentschieden! 🤝");
  else if (ttt.winner != null) info = "🏆 " + nameOf(ttt.p[ttt.winner]) + tt(" wins!", " gewinnt!");
  else info = (myTurn ? tt("🫵 YOUR turn (", "🫵 DU bist dran (") : nameOf(ttt.p[ttt.turn]) + tt("’s turn (", " ist dran (")) + (ttt.turn === 0 ? "X" : "O") + ")";
  $("ttt-info").textContent = nameOf(ttt.p[0] || "") && ttt.p.length === 2 ? nameOf(ttt.p[0]) + " (X) vs " + nameOf(ttt.p[1]) + " (O) — " + info : info;
}
document.addEventListener("DOMContentLoaded", () => {
  $("btn-ttt-join").onclick = () => tttAction({ k: "join" });
  $("btn-ttt-reset").onclick = () => tttAction({ k: "reset" });
  renderTTT();
  $("btn-rps-join") && ($("btn-rps-join").onclick = () => rpsAction({ k: "join" }));
  $("btn-rps-reset") && ($("btn-rps-reset").onclick = () => rpsAction({ k: "reset" }));
  renderRPS();
  $("btn-dice-join") && ($("btn-dice-join").onclick = () => diceAction({ k: "join" }));
  $("btn-dice-reset") && ($("btn-dice-reset").onclick = () => diceAction({ k: "reset" }));
  renderDice();
  initDrawCanvas("draw-canvas", "draw-colors", "draw-size", "btn-draw-clear", "btn-draw-eraser");
  $("bg-start") && ($("bg-start").onclick = () => bgStart());
  $("bg-stop") && ($("bg-stop").onclick = () => bgStop(true, true));
  $("bg-vol") && ($("bg-vol").oninput = e => { BG.vol = parseFloat(e.target.value); if (BG.audio) BG.audio.volume = BG.vol; });
  startFunFactRotation();
});


// ═════════════════════════════════════════════════════════════
// WARTE-ARENA 2: Klick-Battle (10 Sekunden, alle Wartenden)
// ═════════════════════════════════════════════════════════════
let cbActive = false, cbClicks = 0, cbTimer = null;
function cbStart() {
  if (isHost) { broadcast({ t: "cbGo" }); cbRun(); }
  else sendHost({ t: "cb", a: { k: "start" } });
}
function cbRun() {
  cbActive = true; cbClicks = 0;
  $("cb-btn").style.display = ""; $("btn-cb-start").style.display = "none";
  $("cb-result").innerHTML = "";
  let left = 10;
  $("cb-info").textContent = tt("⚡ GO! Click as fast as you can — ", "⚡ LOS! Klick was das Zeug hält — ") + left + "s";
  if (onWaitScreen()) SFX.go();
  clearInterval(cbTimer);
  cbTimer = setInterval(() => {
    left--;
    $("cb-info").textContent = left > 0 ? tt("⚡ ", "⚡ ") + left + tt("s — CLICK CLICK CLICK!", "s — KLICK KLICK KLICK!") : tt("Time’s up!", "Zeit um!");
    if (left <= 0) {
      clearInterval(cbTimer);
      cbActive = false;
      $("cb-btn").style.display = "none"; $("btn-cb-start").style.display = "";
      if (isHost) cbScore(myId, cbClicks); else sendHost({ t: "cb", a: { k: "score", n: cbClicks } });
    }
  }, 1000);
}
const cbScores = new Map();
function cbScore(pid, n) {
  cbScores.set(pid, n);
  clearTimeout(cbScore._t);
  cbScore._t = setTimeout(() => {
    const list = [...cbScores.entries()].sort((a, b) => b[1] - a[1]);
    broadcast({ t: "cbResult", list });
    cbShowResult(list);
    if (list.length) addWin(list[0][0]);
    cbScores.clear();
  }, 1500);
}
function cbShowResult(list) {
  $("cb-result").innerHTML = list.map(([pid, n], i) =>
    `<div>${i === 0 ? "🏆" : i === 1 ? "🥈" : i === 2 ? "🥉" : "•"} <b>${esc(nameOf(pid))}</b> — ${n} ${tt("clicks", "Klicks")}</div>`).join("");
  $("cb-info").textContent = list.length ? tt("Results! Rematch?", "Ergebnis! Revanche?") : tt("Two waiting, one button — who clicks faster?", "Zwei Wartende, ein Button — wer klickt schneller?");
  if (onWaitScreen()) SFX.done();
}
document.addEventListener("DOMContentLoaded", () => {
  $("btn-cb-start").onclick = cbStart;
  $("cb-btn").onclick = () => { if (cbActive) { cbClicks++; $("cb-btn").textContent = "🔥 " + cbClicks; } };
});


// ═════════════════════════════════════════════════════════════
// WARTE-ARENA 5: Schnick-Schnack-Schnuck (2 Wartende)
// ═════════════════════════════════════════════════════════════
let rps = { p: [], picks: {}, wins: {}, lastResult: null };
const RPS_ICON = { rock: "✊", paper: "✋", scissors: "✌️" };
const RPS_BEATS = { rock: "scissors", paper: "rock", scissors: "paper" };
function rpsAction(a) { if (isHost) rpsHandle(a, myId); else sendHost({ t: "rps", a }); }
function rpsHandle(a, pid) {
  if (a.k === "join" && rps.p.length < 2 && !rps.p.includes(pid)) { rps.p.push(pid); rps.wins[pid] = 0; }
  if (a.k === "pick" && rps.p.includes(pid) && rps.p.length === 2 && !rps.lastResult) {
    rps.picks[pid] = a.choice;
    if (Object.keys(rps.picks).length === 2) {
      const [a1, a2] = rps.p, c1 = rps.picks[a1], c2 = rps.picks[a2];
      let winner = null;
      if (c1 !== c2) winner = RPS_BEATS[c1] === c2 ? a1 : a2;
      if (winner) { rps.wins[winner]++; addWin(winner); }
      rps.lastResult = { c1, c2, winner };
      broadcast({ t: "rpsState", rps }); renderRPS();
      setTimeout(() => { rps.picks = {}; rps.lastResult = null; broadcast({ t: "rpsState", rps }); renderRPS(); }, 2200);
      return;
    }
  }
  if (a.k === "reset") rps = { p: Object.keys(rps.wins).length ? [...rps.p].reverse() : [], picks: {}, wins: {}, lastResult: null };
  broadcast({ t: "rpsState", rps });
  renderRPS();
}
function renderRPS() {
  const el = $("rps-area"); if (!el) return;
  const iAmIn = rps.p.includes(myId);
  const bothIn = rps.p.length === 2;
  $("btn-rps-join").style.display = (!iAmIn && rps.p.length < 2) ? "" : "none";
  if (!bothIn) { el.innerHTML = ""; $("rps-info").textContent = rps.p.length === 0 ? tt("Two people waiting can play — who’s in?", "Zwei Wartende können zocken — wer traut sich?") : nameOf(rps.p[0]) + tt(" is waiting for an opponent …", " wartet auf einen Gegner …"); return; }
  const [a1, a2] = rps.p;
  if (rps.lastResult) {
    const { c1, c2, winner } = rps.lastResult;
    $("rps-info").textContent = winner ? "🏆 " + nameOf(winner) + tt(" wins the round!", " gewinnt die Runde!") : tt("🤝 Draw!", "🤝 Unentschieden!");
    el.innerHTML = `<div style="display:flex;gap:24px;justify-content:center;font-size:3rem">
      <div style="text-align:center"><div>${RPS_ICON[c1]}</div><div class="tag">${esc(nameOf(a1))}</div></div>
      <div style="align-self:center;font-size:1.4rem">⚔️</div>
      <div style="text-align:center"><div>${RPS_ICON[c2]}</div><div class="tag">${esc(nameOf(a2))}</div></div>
    </div>`;
    if (onWaitScreen()) winner ? SFX.done() : SFX.beep();
  } else {
    const myTurn = iAmIn && !rps.picks[myId];
    $("rps-info").textContent = nameOf(a1) + " (" + (rps.wins[a1]||0) + ") vs " + nameOf(a2) + " (" + (rps.wins[a2]||0) + ")" + (iAmIn ? (rps.picks[myId] ? tt(" — waiting for opponent …", " — warte auf Gegner …") : tt(" — pick your move!", " — wähl deinen Zug!")) : tt(" — both are picking …", " — beide wählen gerade …"));
    el.innerHTML = !myTurn ? "" : `<div style="display:flex;gap:10px;justify-content:center">${Object.entries(RPS_ICON).map(([k,ic]) => `<button class="big" data-k="${k}" style="font-size:1.8rem;padding:14px 20px">${ic}</button>`).join("")}</div>`;
    el.querySelectorAll("button").forEach(b => b.onclick = () => rpsAction({ k: "pick", choice: b.dataset.k }));
  }
}

// ═════════════════════════════════════════════════════════════
// WARTE-ARENA 6: Würfel-Duell (2 Wartende)
// ═════════════════════════════════════════════════════════════
let dice = { p: [], rolls: {}, winner: null };
function diceAction(a) { if (isHost) diceHandle(a, myId); else sendHost({ t: "dice", a }); }
function diceHandle(a, pid) {
  if (a.k === "join" && dice.p.length < 2 && !dice.p.includes(pid)) dice.p.push(pid);
  if (a.k === "roll" && dice.p.includes(pid) && dice.rolls[pid] == null && !dice.winner) {
    dice.rolls[pid] = 1 + Math.floor(Math.random() * 6);
    if (Object.keys(dice.rolls).length === 2) {
      const [a1, a2] = dice.p;
      if (dice.rolls[a1] !== dice.rolls[a2]) { dice.winner = dice.rolls[a1] > dice.rolls[a2] ? a1 : a2; addWin(dice.winner); }
      else dice.winner = "tie";
    }
  }
  if (a.k === "reset") dice = { p: dice.winner && dice.winner !== "tie" ? [...dice.p].reverse() : dice.p, rolls: {}, winner: null };
  broadcast({ t: "diceState", dice });
  renderDice();
}
const DICE_FACE = ["⚀","⚁","⚂","⚃","⚄","⚅"];
function renderDice() {
  const el = $("dice-area"); if (!el) return;
  const iAmIn = dice.p.includes(myId);
  $("btn-dice-join").style.display = (!iAmIn && dice.p.length < 2) ? "" : "none";
  if (dice.p.length < 2) { el.innerHTML = ""; $("dice-info").textContent = dice.p.length === 0 ? tt("Two people waiting can play — who’s in?", "Zwei Wartende können zocken — wer traut sich?") : nameOf(dice.p[0]) + tt(" is waiting for an opponent …", " wartet auf einen Gegner …"); return; }
  const [a1, a2] = dice.p;
  const r1 = dice.rolls[a1], r2 = dice.rolls[a2];
  el.innerHTML = `<div style="display:flex;gap:24px;justify-content:center;font-size:3.2rem">
    <div style="text-align:center"><div>${r1 ? DICE_FACE[r1-1] : "🎲"}</div><div class="tag">${esc(nameOf(a1))}</div></div>
    <div style="align-self:center;font-size:1.2rem">vs</div>
    <div style="text-align:center"><div>${r2 ? DICE_FACE[r2-1] : "🎲"}</div><div class="tag">${esc(nameOf(a2))}</div></div>
  </div>`;
  if (dice.winner) {
    $("dice-info").textContent = dice.winner === "tie" ? tt("🤝 Draw! Again?", "🤝 Unentschieden! Nochmal?") : "🏆 " + nameOf(dice.winner) + tt(" wins (", " gewinnt (") + Math.max(r1,r2) + " vs " + Math.min(r1,r2) + ")!";
    if (onWaitScreen()) dice.winner === "tie" ? SFX.beep() : SFX.done();
  } else if (iAmIn && dice.rolls[myId] == null) {
    $("dice-info").textContent = tt("🎲 Your turn — roll!", "🎲 Du bist dran — würfeln!");
  } else {
    $("dice-info").textContent = nameOf(a1) + " vs " + nameOf(a2) + tt(" — waiting for both rolls …", " — warte auf beide Würfe …");
  }
}
$("btn-dice-roll") && ($("btn-dice-roll").onclick = () => diceAction({ k: "roll" }));

// ═════════════════════════════════════════════════════════════
// 🎨 Kritzel-Board: alle warten zusammen malen auf derselben Leinwand
// ═════════════════════════════════════════════════════════════
let drawBoard = { strokes: [] };
let drawEpoch = 0;   // steigt bei jedem Raum-Wechsel — fremde Boards ignorieren
let drawColor = "#ffc95c", drawSize = 4;
let drawing = false, curStroke = null, lastSentLen = 0, drawThrottle = null;
const DRAW_COLORS = ["#ffc95c", "#ff5470", "#7c5cff", "#4ade80", "#4ac9e8", "#f5f5f5", "#3a3a46",
  "#ff8a3d", "#ff4dd8", "#4d7bff", "#2fbf71", "#e8e037", "#8a4b2f", "#000000"];
const DRAW_CANVAS_IDS = ["draw-canvas"];   // nur noch EIN Canvas -- festes Seitenpanel statt Duplikat pro Screen

function resetDrawBoard() {
  drawEpoch = (drawEpoch || 0) + 1;
  drawBoard = { strokes: [] };
  drawing = false; curStroke = null; lastSentLen = 0;
  try { renderDrawBoard(); } catch {}
}
/** Strokes mergen — kürzere/ältere Versionen dürfen längere nicht „wegwischen“. */
function mergeDrawBoard(incoming) {
  if (!incoming || !Array.isArray(incoming.strokes)) return;
  if (!incoming.strokes.length && drawBoard.strokes.length && incoming._clear) {
    drawBoard = { strokes: [] };
    return;
  }
  const byId = new Map();
  for (const s of drawBoard.strokes) if (s && s.id) byId.set(s.id, s);
  for (const s of incoming.strokes) {
    if (!s || !s.id) continue;
    const prev = byId.get(s.id);
    const nNew = (s.points && s.points.length) || 0;
    const nOld = (prev && prev.points && prev.points.length) || 0;
    if (!prev || nNew >= nOld) byId.set(s.id, s);
  }
  drawBoard = { strokes: [...byId.values()] };
}
function drawAction(a) { if (isHost) drawHandle(a, myId); else sendHost({ t: "draw", a }); }
function drawHandle(a, pid) {
  // Ohne Aktion nichts tun: eine unvollstaendige Nachricht (z.B. abgeschnitten
  // uebertragen) hat den Empfaenger sonst abstuerzen lassen.
  if (!a || typeof a !== "object") return;
  if (a.k === "stroke" && a.stroke) {
    const idx = drawBoard.strokes.findIndex(s => s.id === a.stroke.id);
    const nNew = (a.stroke.points && a.stroke.points.length) || 0;
    if (idx >= 0) {
      const nOld = (drawBoard.strokes[idx].points && drawBoard.strokes[idx].points.length) || 0;
      if (nNew >= nOld) drawBoard.strokes[idx] = a.stroke;
    } else drawBoard.strokes.push(a.stroke);
  } else if (a.k === "clear") {
    drawBoard = { strokes: [] };
  }
  broadcast({ t: "drawState", drawBoard, drawEpoch, _clear: a.k === "clear" });
  renderDrawBoard();
}
// Offscreen-Puffer: nie clearRect auf dem sichtbaren Canvas — Opera zeigt sonst kurz ein leeres Board (Flackern).
let drawOffscreen = null;
function ensureDrawCanvasSize(c) {
  // clientWidth*dpr oft Bruchzahl; Canvas-Größe ist immer int → ohne Round: bei JEDEM Aufruf Resize (= Clear).
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(c.clientWidth * dpr));
  const h = Math.max(1, Math.round(c.clientHeight * dpr));
  const resized = c.width !== w || c.height !== h;
  if (resized) { c.width = w; c.height = h; }
  return { w, h, resized, dpr };
}
function drawCanvasCtx(canvasId) {
  const c = $(canvasId);
  if (!c) return null;
  ensureDrawCanvasSize(c);
  return c.getContext("2d");
}
const DRAW_BG = "#0e0e13";
function strokeVisual(color, size) {
  // "eraser" ist keine echte Farbe -- male stattdessen mit der Canvas-Hintergrundfarbe und etwas dicker
  return color === "eraser" ? { color: DRAW_BG, width: size * 2.2 } : { color, width: size };
}
function drawOneStroke(g, w, h, s) {
  if (!s || !s.points.length) return;
  const v = strokeVisual(s.color, s.size || 4);
  g.strokeStyle = v.color; g.lineWidth = v.width * (window.devicePixelRatio || 1);
  g.lineCap = "round"; g.lineJoin = "round";
  g.beginPath();
  s.points.forEach((p, i) => {
    const x = p[0] * w, y = p[1] * h;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  });
  g.stroke();
}
function renderDrawBoardOn(canvasId) {
  const c = $(canvasId);
  if (!c) return;
  const { w, h } = ensureDrawCanvasSize(c);
  if (!drawOffscreen) drawOffscreen = document.createElement("canvas");
  if (drawOffscreen.width !== w || drawOffscreen.height !== h) {
    drawOffscreen.width = w; drawOffscreen.height = h;
  }
  const g = drawOffscreen.getContext("2d");
  g.fillStyle = DRAW_BG;
  g.fillRect(0, 0, w, h);
  const live = (drawing && curStroke) ? curStroke : null;
  for (const s of drawBoard.strokes) {
    if (live && s.id === live.id) continue;   // gespeicherte Fassung ist älter — gleich kommt die aktuelle
    drawOneStroke(g, w, h, s);
  }
  // Den eigenen Strich, an dem gerade gezogen wird, immer zuletzt und in seiner neuesten Fassung zeichnen.
  // Sonst verschwindet der zuletzt gezogene Teil bei jedem Neuaufbau kurz -> sichtbares Flackern.
  if (live) drawOneStroke(g, w, h, live);
  // Ein GPU-Blit statt clear+neuzeichnen — kein leerer Zwischenframe (Opera).
  const ctx = c.getContext("2d");
  ctx.save();
  ctx.globalCompositeOperation = "copy";
  ctx.drawImage(drawOffscreen, 0, 0);
  ctx.restore();
}
function renderDrawBoard() { DRAW_CANVAS_IDS.forEach(renderDrawBoardOn); }
const DRAW_CANVAS_COLOR_IDS = ["draw-colors"];
const DRAW_ERASER_IDS = ["btn-draw-eraser"];
function drawColorPicker(colorsId) {
  const wrap = $(colorsId);
  if (!wrap) return;
  wrap.innerHTML = DRAW_COLORS.map(c => `<button class="colorbtn" data-c="${c}" style="width:22px;height:22px;border-radius:50%;background:${c};border:2px solid ${c === drawColor ? "var(--amber)" : "transparent"};padding:0"></button>`).join("");
  wrap.querySelectorAll(".colorbtn").forEach(b => b.onclick = () => {
    drawColor = b.dataset.c;
    syncDrawToolUI();
  });
}
function syncDrawToolUI() {
  DRAW_CANVAS_COLOR_IDS.forEach(drawColorPicker);
  DRAW_ERASER_IDS.forEach(id => { const b = $(id); if (b) b.style.borderColor = drawColor === "eraser" ? "var(--amber)" : "var(--line)"; });
}
function initDrawCanvas(canvasId, colorsId, sizeId, clearId, eraserId) {
  const c = $(canvasId);
  if (!c || c.__wired) return;
  c.__wired = true;
  drawColorPicker(colorsId);
  renderDrawBoardOn(canvasId);
  const posOf = (e) => {
    const r = c.getBoundingClientRect();
    if (!r.width || !r.height) return [0.5, 0.5];   // Canvas noch nicht fertig gelayoutet -> keine kaputten/verzerrten Punkte erzeugen
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
    return [Math.min(1, Math.max(0, cx / r.width)), Math.min(1, Math.max(0, cy / r.height))];
  };
  const start = (e) => {
    e.preventDefault();
    drawing = true;
    curStroke = { id: myId + "_" + Date.now(), color: drawColor, size: drawSize, points: [posOf(e)] };
    lastSentLen = 0;
    renderDrawBoardOn(canvasId); drawLiveSegment();
  };
  const move = (e) => {
    if (!drawing) return;
    e.preventDefault();
    curStroke.points.push(posOf(e));
    drawLiveSegment();
    if (!drawThrottle) drawThrottle = setTimeout(() => { drawThrottle = null; flushStroke(); }, 90);
  };
  const end = () => {
    if (!drawing) return;
    drawing = false;
    flushStroke();
    curStroke = null;
  };
  function drawLiveSegment() {
    // Nur neuen Abschnitt anhängen — kein Full-Redraw (sonst Flackern bei Sync-Updates).
    const g = drawCanvasCtx(canvasId);
    if (!g) return;
    const pts = curStroke.points;
    if (pts.length < 2) return;
    const v = strokeVisual(curStroke.color, curStroke.size);
    g.strokeStyle = v.color; g.lineWidth = v.width * (window.devicePixelRatio || 1);
    g.lineCap = "round"; g.lineJoin = "round";
    const a = pts[pts.length - 2], b = pts[pts.length - 1];
    g.beginPath(); g.moveTo(a[0] * c.width, a[1] * c.height); g.lineTo(b[0] * c.width, b[1] * c.height); g.stroke();
  }
  function flushStroke() {
    if (!curStroke || curStroke.points.length === lastSentLen) return;
    lastSentLen = curStroke.points.length;
    drawAction({ k: "stroke", stroke: { ...curStroke, points: [...curStroke.points] } });
  }
  c.addEventListener("mousedown", start); c.addEventListener("mousemove", move);
  window.addEventListener("mouseup", end);
  c.addEventListener("touchstart", start, { passive: false }); c.addEventListener("touchmove", move, { passive: false });
  c.addEventListener("touchend", end);
  $(sizeId) && ($(sizeId).oninput = e => drawSize = parseInt(e.target.value));
  $(clearId) && ($(clearId).onclick = () => drawAction({ k: "clear" }));
  $(eraserId) && ($(eraserId).onclick = () => { drawColor = "eraser"; syncDrawToolUI(); });
}

// ═════════════════════════════════════════════════════════════
// BEWERTUNGS-SHOW: Nach der Premiere Sterne + optional SynchroBuddy
// ═════════════════════════════════════════════════════════════
let pendingRate = false, myStars = {}, myBuddy = null, rateSent = false;
const allRatings = new Map();   // Host: voterId → { scores, buddy }
const BUDDY_BONUS = 1.0;        // Extra-Punkte pro erhaltenem SynchroBuddy

function showRateCard() {
  exitCinemaMode();
  const c = $("cinema-curtains"); if (c) c.classList.remove("show", "open");
  const speakers = players.filter(p => p.role != null && !p.offline && p.id !== myId);
  const anySpeakers = players.filter(p => p.role != null && !p.offline).length >= 2;
  if (!anySpeakers) {
    status("play-status", tt("Not enough speakers for a rating — continuing without stars.", "Zu wenig Sprecher für eine Bewertung — weiter ohne Sterne."));
    return;
  }
  myStars = {}; myBuddy = null; rateSent = false; ratingDone = false; allRatings.clear();
  const rp = $("rate-progress"); if (rp) rp.textContent = "";
  $("rate-card").style.display = "";
  $("rate-result").innerHTML = "";
  $("btn-rate-submit").style.display = "";
  $("btn-rate-force").style.display = "none";
  updateOuttakesBtn();
  const canBuddy = !myBuddyUsed && speakers.length > 0;
  const hint = $("buddy-hint");
  if (hint) {
    hint.style.display = speakers.length ? "" : "none";
    hint.innerHTML = myBuddyUsed
      ? tt("🤝 You already gave your SynchroBuddy this match.", "🤝 SynchroBuddy hast du in diesem Match schon vergeben.")
      : tt("🤝 Optional: give <b>one</b> speaker a <b>SynchroBuddy</b> sticker (<b>1× per match</b>) — extra points!", "🤝 Optional: gib <b>einem</b> Sprecher einen <b>SynchroBuddy</b>-Sticker (nur <b>1× pro Match</b>) — Extra-Punkte!");
  }
  if (!speakers.length) {
    $("rate-rows").innerHTML = `<p class="sub">${tt("You were the only speaker — the others are rating you right now… 👀", "Du warst der einzige Sprecher — die anderen bewerten dich gerade… 👀")}</p>`;
    $("btn-rate-submit").style.display = "none";
    sendRating({}, null);
    return;
  }
  $("rate-rows").innerHTML = speakers.map(p => `
    <div class="raterow" data-p="${p.id}">
      ${avatarHTML(p)}
      <div class="rateinfo">
        <span class="ratename">${esc(p.name)}</span>
        <span class="tag">🎭 ${esc(rolesOfPlayer(p).map(x => scene.roles.find(r => r.id === x)?.name || "").filter(Boolean).join(" + "))}</span>
      </div>
      <div class="starrow" role="group" aria-label="${esc(tt("Stars for ", "Sterne für ") + p.name)}">${[1,2,3,4,5].map(n => `<button type="button" class="starbtn" data-n="${n}" title="${n} ${n > 1 ? tt("stars", "Sterne") : tt("star", "Stern")}">★</button>`).join("")}</div>
      ${canBuddy ? `<button type="button" class="buddy-btn" data-buddy="${p.id}" title="${esc(tt("Give SynchroBuddy (1× per match)", "SynchroBuddy geben (1× pro Match)"))}">Buddy</button>` : ""}
    </div>`).join("");
  $("rate-rows").querySelectorAll(".raterow").forEach(row => {
    row.querySelectorAll(".starbtn").forEach(b => b.onclick = () => {
      const n = parseInt(b.dataset.n);
      myStars[row.dataset.p] = n;
      row.querySelectorAll(".starbtn").forEach(x => {
        const on = parseInt(x.dataset.n) <= n;
        x.classList.toggle("on", on);
        if (on) { x.classList.remove("pop"); void x.offsetWidth; x.classList.add("pop"); }
      });
      row.classList.toggle("rated", true);
      $("btn-rate-submit").disabled = Object.keys(myStars).length < speakers.length;
      SFX.click();
    });
    const bb = row.querySelector(".buddy-btn");
    if (bb) bb.onclick = () => {
      const id = bb.dataset.buddy;
      myBuddy = (myBuddy === id) ? null : id;
      $("rate-rows").querySelectorAll(".buddy-btn").forEach(x => x.classList.toggle("on", x.dataset.buddy === myBuddy));
      SFX.click();
    };
  });
  $("btn-rate-submit").disabled = true;
}

$("btn-rate-submit").onclick = () => {
  if (rateSent) return;
  rateSent = true;
  $("btn-rate-submit").disabled = true;
  $("btn-rate-submit").textContent = tt("✅ Sent — waiting for the others …", "✅ Abgeschickt — warte auf die anderen …");
  // Buddy nur 1× pro Match — lokal sofort merken, Host prüft zusätzlich
  const buddy = (!myBuddyUsed && myBuddy) ? myBuddy : null;
  if (buddy) myBuddyUsed = true;
  sendRating(myStars, buddy);
};
let rateForceTimer = null;
function sendRating(scores, buddy) {
  if (isHost) {
    collectRating(myId, scores, buddy);
    clearTimeout(rateForceTimer);
    rateForceTimer = setTimeout(() => {
      const need = onlinePlayers().length;
      if (allRatings.size < need) {
        const btn = $("btn-rate-force");
        if (btn) btn.style.display = "";
      }
    }, 25000);
  } else sendHost({ t: "rate", scores, buddy: buddy || null });
}
function collectRating(voterId, scores, buddy) {
  if (!match.buddyGivers) match.buddyGivers = {};
  // SynchroBuddy nur einmal pro Match und Wähler
  let okBuddy = buddy || null;
  if (okBuddy && match.buddyGivers[voterId]) okBuddy = null;
  if (okBuddy) match.buddyGivers[voterId] = okBuddy;
  allRatings.set(voterId, { scores: scores || {}, buddy: okBuddy });
  updateRateProgress();
  maybeFinishRating();
}
function maybeFinishRating() {
  if (!isHost || ratingDone) return;
  const onlineIds = new Set(onlinePlayers().map(p => p.id));
  if (!onlineIds.size) return;
  const onlineVoted = [...allRatings.keys()].filter(id => onlineIds.has(id)).length;
  if (onlineVoted >= onlineIds.size) finishRating();
}
function updateRateProgress() {
  if (!isHost) return;
  const onlineIds = new Set(onlinePlayers().map(p => p.id));
  const have = [...allRatings.keys()].filter(id => onlineIds.has(id)).length;
  const total = onlineIds.size;
  const el = $("rate-progress");
  if (el) el.textContent = "🗳 " + have + "/" + total + (have < total
    ? tt(" online have voted …", " online haben abgestimmt …")
    : tt(" online have voted — everyone’s done!", " online haben abgestimmt — alle fertig!"));
  const btn = $("btn-rate-force");
  if (btn && have >= total) btn.style.display = "none";
}
$("btn-rate-force").onclick = () => { if (confirm(tt("Really continue without the missing votes?", "Wirklich ohne die fehlenden Stimmen weiter?"))) finishRating(); };
let ratingDone = false;
// Wer fliegt im Battle Royale raus?
// Früher wurde nur ausgewertet, wer in DIESER Runde Sterne bekommen hat. Blieben davon
// weniger als zwei übrig (z. B. weil ein Sprecher offline war oder der Host ohne die
// fehlenden Stimmen weitergedrückt hat), flog niemand raus — activeLeft blieb gleich und
// das Match lief endlos, „Champion küren" kam nie. Deshalb: solange mehr als eine Person
// im Rennen ist, scheidet garantiert jemand aus, notfalls nach Gesamtpunkten.
function waehleAusscheidenden(results) {
  const aktive = players.filter(p => !p.eliminated);
  if (aktive.length <= 1) return null;
  const zufallAus = (liste) => liste[Math.floor(Math.random() * liste.length)];

  // 1) Normalfall — Bewertung dieser Runde (results ist absteigend sortiert)
  const bewertet = results.filter(r => aktive.some(p => p.id === r.id));
  if (bewertet.length > 1) {
    const schlechteste = bewertet[bewertet.length - 1].avg;
    const kandidaten = bewertet.filter(r => Math.abs(r.avg - schlechteste) < 0.0001);
    // Achtung: die Auslosung MUSS vor dem find() passieren. Steht sie im Prädikat,
    // wird für jeden geprüften Spieler neu gewürfelt — dann trifft womöglich niemand
    // seinen eigenen Wurf, treffer bleibt leer und der Notfallweg unten greift zu Unrecht.
    const gezogen = zufallAus(kandidaten);
    const treffer = gezogen ? players.find(p => p.id === gezogen.id) : null;
    if (treffer) return treffer;
  }

  // 2) Notfallweg — Gesamtpunkte über alle bisherigen Runden, bei Gleichstand Zufall
  const rang = aktive.map(p => ({ p, sum: match.totals[p.id] || 0 })).sort((a, b) => a.sum - b.sum);
  const schlechteste = rang[0].sum;
  return zufallAus(rang.filter(x => Math.abs(x.sum - schlechteste) < 0.0001)).p;
}

function finishRating() {
  if (!isHost || ratingDone) return;
  ratingDone = true;
  clearTimeout(rateForceTimer);
  const sums = {}, counts = {}, buddyCounts = {};
  allRatings.forEach(entry => {
    const scores = entry.scores || entry; // Rückwärtskompat falls altes Format
    const buddy = entry.buddy || null;
    for (const [pid, n] of Object.entries(scores)) {
      if (typeof n !== "number") continue;
      sums[pid] = (sums[pid] || 0) + n;
      counts[pid] = (counts[pid] || 0) + 1;
    }
    if (buddy) buddyCounts[buddy] = (buddyCounts[buddy] || 0) + 1;
  });
  const results = Object.keys(sums).map(pid => {
    const avgStars = sums[pid] / counts[pid];
    const buddies = buddyCounts[pid] || 0;
    return {
      id: pid,
      name: nameOf(pid),
      avg: avgStars + buddies * BUDDY_BONUS,
      avgStars,
      buddies,
      votes: counts[pid]
    };
  }).sort((a, b) => b.avg - a.avg);
  results.forEach(r => { match.totals[r.id] = (match.totals[r.id] || 0) + r.avg; });

  let eliminatedName = null;
  if (match.mode === "elimination") {
    const raus = waehleAusscheidenden(results);
    if (raus) { raus.eliminated = true; eliminatedName = raus.name; }
  }

  broadcast({ t: "rateResult", results, eliminatedName });
  showRateResult(results, eliminatedName);
  allRatings.clear();

  const activeLeft = players.filter(p => !p.eliminated).length;
  const btn = $("btn-next-round");
  btn.style.display = "";
  if (match.mode === "elimination") {
    btn.textContent = activeLeft > 1 ? (tt("▶ Next round (", "▶ Nächste Runde (") + activeLeft + tt(" still in)", " noch im Rennen)")) : tt("🏆 Crown the champion!", "🏆 Champion küren!");
  } else {
    btn.textContent = match.round < match.rounds ? (tt("▶ Next round (", "▶ Nächste Runde (") + (match.round + 1) + "/" + match.rounds + ")") : tt("🏁 Show finale!", "🏁 Finale anzeigen!");
  }
}

$("btn-next-round").onclick = async () => {
  if (!isHost) return;
  $("btn-next-round").style.display = "none";

  const activeLeft = players.filter(p => !p.eliminated).length;
  const continueMatch = match.mode === "elimination" ? activeLeft > 1 : match.round < match.rounds;

  if (continueMatch) {
    match.round++;
    if (match.mode === "rounds" || match.mode === "elimination") {
      // Kurze Verschnaufpause mit Countdown, bevor's in die naechste Runde geht
      for (let s = 3; s >= 1; s--) { $("btn-next-round").style.display = "none"; status("rate-progress", tt("⏳ Next round in ", "⏳ Nächste Runde in ") + s + " …"); await new Promise(r => setTimeout(r, 1000)); }
      // Neue Zufalls-Szene + neue Zufalls-Rollen, zurück in die Lobby zum Bereitmachen
      backToLobby(true);
      await pickRandomScene();
      const label = match.mode === "elimination"
        ? (tt("🔪 Round ", "🔪 Runde ") + match.round + tt(" — ", " — ") + activeLeft + tt(" still in!", " noch im Rennen!"))
        : (tt("🎲 Round ", "🎲 Runde ") + match.round + "/" + match.rounds);
      status("lobby-status", label + tt(": new scene & roles! Everyone hit “I’m ready”.", ": neue Szene & Rollen! Alle „Bin bereit“."));
      $("btn-go-round").style.display = "";
      broadcast({ t: "nextRound", round: match.round, players, scene });
      return;
    }
    broadcast({ t: "nextRound", round: match.round, players });
    startNewRound();
  } else {
    const list = Object.entries(match.totals).map(([pid, sum]) => ({ id: pid, name: nameOf(pid), sum }))
      .sort((a, b) => b.sum - a.sum);
    const championName = match.mode === "elimination" ? (players.find(p => !p.eliminated)?.name || list[0]?.name) : null;
    broadcast({ t: "matchEnd", list, rounds: match.rounds, championName });
    showFinal(list, match.rounds, championName);
  }
};

function startNewRound() {
  resetForNewRound();
  broadcastSettings && isHost && broadcastSettings();
  renderSettingsView();
  status("lobby-status", tt("🎬 Round ", "🎬 Runde ") + match.round + "/" + match.rounds + (match.autoRoulette ? tt(" — new roles rolled!", " — neue Rollen ausgewürfelt!") : "") + tt(" Everyone “I’m ready” again!", " Alle wieder „Bin bereit“!"));
  SFX.go();
}

// ═══ ANIMIERTES FINALE — Awards-Show mit Riser, Scheinwerfer, Applaus ═══
function showFinal(list, rounds, championName) {
  show("scr-final");
  $("leave-btn").style.display = "";
  // Kinosaal/Vorhang nur hier am Podest — kurz auf, dann Reveal
  curtainsShow(true);
  requestAnimationFrame(() => { setTimeout(() => curtainsOpen(), 80); });

  // Bei Battle Royale: Champion steht unabhängig von der Punktsumme immer auf Platz 1
  let ordered = [...list];
  if (championName) {
    ordered.sort((a, b) => (a.name === championName ? -1 : b.name === championName ? 1 : 0));
  }
  const top3 = ordered.slice(0, 3);
  const also = ordered.slice(3, 5);   // 4. & 5. unter dem Podium
  const rest = ordered.slice(5);

  $("final-sub").textContent = championName
    ? tt("🔪 Battle Royale over — ", "🔪 Battle Royale beendet — ") + championName + tt(" is the last one standing!", " hat als Einzige(r) überlebt!")
    : rounds + (rounds > 1 ? tt(" rounds played — here’s the overall score:", " Runden gespielt — hier ist eure Gesamtwertung:") : tt(" round played — here’s the overall score:", " Runde gespielt — hier ist eure Gesamtwertung:"));

  const stage = $("podium-stage");
  if (stage) stage.classList.remove("alive");
  const champEl = $("podium-champ");
  if (champEl) { champEl.textContent = ""; champEl.classList.remove("show"); }

  const fillSlot = (slotId, entry) => {
    const el = $(slotId);
    if (!el) return;
    if (!entry) { el.style.display = "none"; el.classList.remove("show", "pop"); return; }
    el.style.display = "";
    el.classList.remove("show", "pop");
    const p = players.find(pl => pl.id === entry.id);
    el.querySelector(".p-avatar-wrap").innerHTML = p ? avatarHTML(p) : "";
    el.querySelector(".p-name").textContent = entry.name;
    el.querySelector(".p-score").textContent = entry.sum.toFixed(1) + " ★";
  };
  fillSlot("podium-1", top3[0]);
  fillSlot("podium-2", top3[1]);
  fillSlot("podium-3", top3[2]);

  const fillAlso = (slotId, entry, rank) => {
    const el = $(slotId);
    if (!el) return;
    if (!entry) { el.style.display = "none"; el.classList.remove("show"); return; }
    el.style.display = "";
    el.classList.remove("show");
    const p = players.find(pl => pl.id === entry.id);
    el.querySelector(".p-avatar-wrap").innerHTML = p ? avatarHTML(p) : "";
    el.querySelector(".p-name").textContent = entry.name;
    el.querySelector(".p-score").textContent = entry.sum.toFixed(1) + " ★";
    const rk = el.querySelector(".also-rank");
    if (rk) rk.textContent = rank + ".";
  };
  fillAlso("podium-4", also[0], 4);
  fillAlso("podium-5", also[1], 5);

  $("final-rest").innerHTML = rest.map((r, i) => `
    <div class="finalrow">
      <span class="tag">${i + 6}.</span>
      <span class="fname">${esc(r.name)}</span>
      <span class="fscore">${r.sum.toFixed(1)} ★</span>
    </div>`).join("");

  if (iAmLogicalHost()) $("btn-back-lobby").style.display = "";

  // 🌑 Dunkel + Riser baut Spannung auf → Scheinwerfer → 3 → 2 → 1 → Applaus → 4./5.
  const blackout = $("podium-blackout");
  blackout.className = "podium-blackout";
  void blackout.offsetWidth;
  blackout.classList.add("in");

  const spot = $("podium-spotlight");
  spot.className = "spotlight";

  const REVEAL_START = 4200;      // Enthüllung startet, während der Riser (~6.2s) noch hochzieht
  SFX.riser();

  const steps = [];
  if (top3[2]) steps.push({ id: "podium-3", settle: "settle-3", sweepMs: 900, gap: 750 });
  if (top3[1]) steps.push({ id: "podium-2", settle: "settle-2", sweepMs: 850, gap: 900 });
  if (top3[0]) steps.push({ id: "podium-1", settle: "settle-1", sweepMs: 1100, gap: 400, winner: true });

  setTimeout(() => {
    blackout.classList.remove("in");
    blackout.classList.add("out");
  }, REVEAL_START - 400);

  let t = REVEAL_START;
  steps.forEach((step, i) => {
    setTimeout(() => { spot.className = "spotlight sweeping"; }, t);
    t += step.sweepMs;
    setTimeout(() => { spot.className = "spotlight " + step.settle; }, t);
    setTimeout(() => {
      const el = $(step.id);
      if (!el) return;
      el.classList.add("show", "pop");
      if (step.winner) {
        SFX.winner();
        // Applaus-Stärke nach Abstand Platz 1 ↔ 2
        const gap = top3[1] ? Math.max(0, (top3[0].sum || 0) - (top3[1].sum || 0)) : 99;
        let vol = 0.42, holdMs = 9000, label = "knapp";
        if (!top3[1] || gap >= 2.5) { vol = 0.78; holdMs = 16000; label = "dominant"; }
        else if (gap >= 1.0) { vol = 0.6; holdMs = 12500; label = "klar"; }
        else if (gap >= 0.4) { vol = 0.5; holdMs = 10500; label = "solide"; }
        const applause = SFX.applause(vol);
        setTimeout(() => SFX.fadeStop(applause, 1800), holdMs);
        burstConfetti(true);
        setTimeout(() => burstConfetti(true), 700);
        setTimeout(() => burstConfetti(gap >= 1 ? true : false), 1400);
        if (stage) stage.classList.add("alive");
        if (champEl && top3[0]) {
          const gapTxt = top3[1] ? (label === "dominant" ? " · klare Sache!" : label === "knapp" ? " · knapper Sieg!" : "") : "";
          champEl.textContent = "👑 " + top3[0].name.toUpperCase() + " — CHAMPION" + gapTxt;
          champEl.classList.add("show");
        }
      } else {
        SFX.beep();
        burstConfetti(false);
      }
    }, t + 140);
    t += step.gap;
  });

  // 4. & 5. nach dem Sieger unter den Säulen einblenden
  const alsoAt = t + 600;
  setTimeout(() => {
    ["podium-4", "podium-5"].forEach((id, i) => {
      setTimeout(() => {
        const el = $(id);
        if (el && el.style.display !== "none") {
          el.classList.add("show");
          SFX.beep();
        }
      }, i * 350);
    });
  }, alsoAt);

  setTimeout(() => {
    spot.className = "spotlight hide";
    blackout.className = "podium-blackout";
  }, alsoAt + 1800);
}

$("btn-back-lobby").onclick = () => {
  if (!iAmLogicalHost()) return;
  SFX.back();
  if (!isHost) { sendHost({ t: "hostCmd", cmd: "matchLobby" }); return; }
  broadcast({ t: "matchLobby" });
  backToLobby();
};
function backToLobby(keepMatch) {
  exitCinemaMode();
  const c = $("cinema-curtains"); if (c) c.classList.remove("show", "open");
  if (!keepMatch) { match.round = 1; match.totals = {}; match.buddyGivers = {}; myBuddyUsed = false; }
  players.forEach(p => { p.ready = false; p.done = 0; p.total = 0; p.prem = false; p.premPct = 0; });
  mixItems = []; collected.clear(); collectedOuttakes.clear(); takes = {}; outtakes = []; outtakesCache = null;
  finalTracksData = null; premiereLocked = false; redoMode = null;
  resetPremPlayerGains();
  pendingRate = false; rateSent = false; ratingDone = false; allRatings.clear(); myStars = {}; myBuddy = null;
  $("rate-card").style.display = "none"; $("rate-rows").innerHTML = ""; $("rate-result").innerHTML = "";
  $("btn-next-round").style.display = "none"; $("btn-rate-submit").disabled = true;
  $("btn-rate-submit").textContent = tt("Submit rating", "Bewertung abschicken");
  updateOuttakesBtn();
  show("scr-lobby");
  $("leave-btn").style.display = "";
  if (isHost) { broadcastState(); }
  renderSettingsView();
  updateLobbyMusic();
  if (!keepMatch) status("lobby-status", tt("🏠 Back in the lobby!", "🏠 Zurück in der Lobby!"));
}
function showRateResult(results, eliminatedName) {
  $("btn-rate-submit").style.display = "none";
  $("btn-rate-force").style.display = "none";
  $("rate-rows").innerHTML = "";
  const hint = $("buddy-hint"); if (hint) hint.style.display = "none";
  const rows = $("rate-result");
  rows.innerHTML = results.map((r, i) => {
    const p = players.find(pl => pl.id === r.id);
    const buddyBit = r.buddies
      ? `<span class="buddy-badge">🤝 ×${r.buddies} SynchroBuddy${r.buddies > 1 ? "s" : ""} (+${(r.buddies * BUDDY_BONUS).toFixed(0)})</span>`
      : "";
    const scoreLabel = r.avgStars != null
      ? `${r.avg.toFixed(1)} ★` + (r.buddies ? ` <span class="tag" style="color:var(--muted)">(${r.avgStars.toFixed(1)}+Buddy)</span>` : "")
      : `${r.avg.toFixed(1)} ★`;
    return `<div class="raterow resultrow ${i === 0 ? "winner" : ""}" style="opacity:0;transform:translateX(-14px)">
      ${p ? avatarHTML(p) : ""}
      <div class="rateinfo">
        <span class="ratename">${i === 0 ? "🏆 " : i === 1 ? "🥈 " : i === 2 ? "🥉 " : "• "}${esc(r.name)}</span>
        ${i === 0 ? `<span class="tag" style="color:var(--amber)">${tt("Best voice actor!", "Bester Synchronsprecher!")}</span>` : `<span class="tag">${r.votes} ${tt("votes", "Stimmen")}</span>`}
        ${buddyBit}
      </div>
      <span class="resultscore">${scoreLabel}</span>
    </div>`;
  }).join("") + (eliminatedName ? `<div class="raterow" style="border-color:var(--hot);opacity:0">🔪 <b>${esc(eliminatedName)}</b> ist raus aus dem Battle Royale!</div>` : "");
  [...rows.children].forEach((row, i) => {
    setTimeout(() => { row.style.transition = "opacity .4s, transform .4s"; row.style.opacity = "1"; row.style.transform = "translateX(0)"; }, i * 150);
  });
  SFX.done();
  updateOuttakesBtn();
}

function outtakesCacheReady() {
  return !!(outtakesCache && outtakesCache.blob && outtakesCache.blob.size > 1000);
}
function updateOuttakesBtn() {
  const bar = $("outtakes-bar");
  const otBtn = $("btn-outtakes");
  const dlBtn = $("btn-outtakes-dl");
  const hint = $("outtakes-bar-hint");
  const ovDl = $("btn-outtakes-dl-overlay");
  if (!outtakes.length) {
    if (bar) bar.classList.remove("show");
    if (ovDl) ovDl.style.display = "none";
    return;
  }
  if (bar) bar.classList.add("show");
  try { preloadOuttakesTransition(); } catch {}
  if (otBtn) otBtn.textContent = tt("🎬 Watch outtakes (", "🎬 Outtakes anschauen (") + outtakes.length + ")";
  if (dlBtn) {
    if (outtakesCacheReady()) {
      dlBtn.textContent = tt("⬇ Save now (ready!)", "⬇ Sofort speichern (fertig!)");
    } else if (outtakesCachePending || (outtakesPlaying && outtakesQuietJob)) {
      dlBtn.textContent = tt("⬇ Save (still cutting …)", "⬇ Speichern (schneidet noch …)");
    } else {
      dlBtn.textContent = tt("⬇ Save outtakes (", "⬇ Outtakes speichern (") + outtakes.length + ")";
    }
  }
  if (hint) {
    hint.textContent = outtakesCacheReady()
      ? outtakes.length + tt(" bloopers · ready to save now", " Bloopers · Sofort speichern bereit")
      : (outtakesCachePending || outtakesQuietJob)
        ? outtakes.length + tt(" bloopers · cutting in background …", " Bloopers · wird im Hintergrund geschnitten …")
        : outtakes.length + tt(" bloopers · saving cuts briefly in background", " Bloopers · Speichern schneidet kurz im Hintergrund");
  }
  if (ovDl) {
    ovDl.style.display = "";
    ovDl.textContent = outtakesCacheReady()
      ? tt("⬇ Save now", "⬇ Sofort speichern")
      : tt("⬇ Save reel", "⬇ Reel speichern");
  }
}

// ── Outtakes-Reel: anschauen + Hintergrund-Schnitt für Sofort-Speichern ──
let outtakeAbort = false;
let outtakesPlaying = false;
let outtakesQuietJob = false;     // true = stiller Hintergrund-Schnitt (kein Overlay)
let outtakesCache = null;         // { blob, endung }
let outtakesCachePending = null;  // Promise → cache, während Hintergrund läuft
let outtakesCacheResolve = null;
let outtakesPrecacheTimer = null;
let outtakesSaveWhenReady = false; // Speichern anfordern, während stiller Schnitt läuft
let outtakesDidSaveBlob = false;   // letzter Lauf hat saveBlob bereits ausgelöst

/** Optional: kurzes Rausch-Audio (Bild kommt immer aus Canvas — Datei war oft grün/kaputt). */
const OUTTAKES_TRANS_URL = "sfx/outtakes-static.mp4";
const OUTTAKES_TRANS_GAIN = 0.55;
/**
 * Ein Dauerwert für Anschauen UND Speichern — Bild + Ton müssen gleich lang sein.
 * Früher Export 70ms bei ~350ms Noise-Buffer → Bild viel kürzer / Ton abgeschnitten.
 */
const OUTTAKES_TRANS_MS = 220;
/** Ab so vielen Outtakes nur noch jeden 2. Übergang (weniger Spam). */
const OUTTAKES_TRANS_SPARSE_AT = 10;
let outtakesTransPreload = null;
let outtakesTransGainNode = null;
let outtakesNoiseBuf = null;
let outtakesNoiseBufDur = 0;
/** Nur Outtakes-frameSource darf das lesen — Premiere nie (sonst Rauschen im Original-Mix). */
let outtakesDrawTrans = false;
let outtakesStaticRaf = null;
let outtakesNoiseSrc = null;
/** Nutzer-Schalter „Rauschen an/aus“ (lokal, merkt sich localStorage). */
let outtakesBeepOn = true;
try {
  if (localStorage.getItem("ss_outtakes_beep") === "0") outtakesBeepOn = false;
} catch {}

function syncOuttakesBeepToggles() {
  const a = $("outtakes-beep-tog"), b = $("outtakes-beep-tog-ov");
  if (a) a.checked = outtakesBeepOn;
  if (b) b.checked = outtakesBeepOn;
  document.querySelectorAll(".ot-beep-lab").forEach(el => {
    el.textContent = outtakesBeepOn ? "Rauschen an" : "Rauschen aus";
  });
}
function setOuttakesBeepOn(on) {
  outtakesBeepOn = !!on;
  try { localStorage.setItem("ss_outtakes_beep", outtakesBeepOn ? "1" : "0"); } catch {}
  syncOuttakesBeepToggles();
}
/** Ob zwischen Clip i und i+1 ein Übergang kommt. */
function shouldPlayOuttakesTransition(gapIndex, reelLen) {
  if (!outtakesBeepOn) return false;
  if (reelLen >= OUTTAKES_TRANS_SPARSE_AT) return (gapIndex % 2 === 0);
  return true;
}
function countOuttakesTransitions(reelLen) {
  if (!outtakesBeepOn || reelLen < 2) return 0;
  let n = 0;
  for (let i = 0; i < reelLen - 1; i++) if (shouldPlayOuttakesTransition(i, reelLen)) n++;
  return n;
}
function outtakesTransMs() {
  return OUTTAKES_TRANS_MS;
}
/** Premiere läuft / schneidet mit — Outtakes-Hintergrund dann pausieren. */
function premIsBusy() {
  return !!(premCachePending || premActiveRecorder);
}
function stopOuttakesNoiseSrc() {
  try { if (outtakesNoiseSrc) outtakesNoiseSrc.stop(); } catch {}
  outtakesNoiseSrc = null;
}
function silenceOuttakesTransBus() {
  outtakesDrawTrans = false;
  stopOuttakesNoiseSrc();
  try { if (outtakesTransGainNode) outtakesTransGainNode.disconnect(); } catch {}
  try { if (outtakesTransGainNode) outtakesTransGainNode.gain.value = 0; } catch {}
  showOuttakesStaticOverlay(false);
}

/** Grau/Schwarzweiß-TV-Rauschen (nie die kaputte grüne MP4-Bildspur). */
function drawTvStatic(g2, w, h) {
  if (!g2 || !w || !h) return;
  const cw = Math.max(48, Math.min(180, w | 0));
  const ch = Math.max(27, Math.min(100, Math.round(cw * (h / w))));
  try {
    const img = g2.createImageData(cw, ch);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = (Math.random() * 220 + 18) | 0;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    const tmp = drawTvStatic._c || (drawTvStatic._c = document.createElement("canvas"));
    tmp.width = cw; tmp.height = ch;
    const tg = tmp.getContext("2d", { alpha: false });
    tg.putImageData(img, 0, 0);
    g2.save();
    g2.imageSmoothingEnabled = false;
    try { g2.imageSmoothingQuality = "low"; } catch {}
    g2.fillStyle = "#000";
    g2.fillRect(0, 0, w, h);
    g2.drawImage(tmp, 0, 0, w, h);
    // leichte Scanlines
    g2.fillStyle = "rgba(0,0,0,.18)";
    for (let y = 0; y < h; y += 3) g2.fillRect(0, y, w, 1);
    g2.restore();
  } catch {
    try { g2.fillStyle = "#1a1a1a"; g2.fillRect(0, 0, w, h); } catch {}
  }
}

function showOuttakesStaticOverlay(on) {
  const c = $("outtakes-static-canvas");
  if (!c) return;
  if (on) {
    c.classList.add("show");
    const wrap = c.parentElement;
    const w = (wrap && wrap.clientWidth) || 640;
    const h = (wrap && wrap.clientHeight) || 360;
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    const g2 = c.getContext("2d", { alpha: false });
    const tick = () => {
      if (!outtakesDrawTrans) return;
      drawTvStatic(g2, c.width, c.height);
      outtakesStaticRaf = requestAnimationFrame(tick);
    };
    if (outtakesStaticRaf) cancelAnimationFrame(outtakesStaticRaf);
    outtakesStaticRaf = requestAnimationFrame(tick);
  } else {
    c.classList.remove("show");
    if (outtakesStaticRaf) { cancelAnimationFrame(outtakesStaticRaf); outtakesStaticRaf = null; }
  }
}

function preloadOuttakesTransition() {
  const tv = $("outtakes-transition");
  if (!tv) return Promise.resolve();
  try { tv.muted = true; } catch {}
  if (!tv.getAttribute("src") && !tv.src) tv.src = assetUrl(OUTTAKES_TRANS_URL);
  else if (tv.src && !String(tv.src).includes("outtakes-static")) tv.src = assetUrl(OUTTAKES_TRANS_URL);
  if (!outtakesTransPreload) {
    try { tv.preload = "auto"; tv.playsInline = true; } catch {}
    outtakesTransPreload = waitCanPlay(tv, 4000).catch(() => {});
  }
  return outtakesTransPreload;
}

function ensureOuttakesNoiseBuf(ctx, durSec) {
  const sec = Math.max(0.05, durSec || OUTTAKES_TRANS_MS / 1000);
  if (outtakesNoiseBuf
      && outtakesNoiseBuf.sampleRate === ctx.sampleRate
      && Math.abs(outtakesNoiseBufDur - sec) < 0.001) {
    return outtakesNoiseBuf;
  }
  const len = Math.max(1, Math.floor(ctx.sampleRate * sec));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    // Leichtes Fade-Out am Ende, damit MediaRecorder nichts abrupt abschneidet
    const fade = i > len - 64 ? (len - i) / 64 : 1;
    ch[i] = (Math.random() * 2 - 1) * 0.35 * fade;
  }
  outtakesNoiseBuf = buf;
  outtakesNoiseBufDur = sec;
  return buf;
}

function ensureOuttakesTransGain(ctx) {
  if (!ctx) return null;
  if (!outtakesTransGainNode) {
    try {
      outtakesTransGainNode = ctx.createGain();
      outtakesTransGainNode.gain.value = OUTTAKES_TRANS_GAIN;
    } catch (e) {
      console.warn("Outtakes-Transition-Audio:", e);
      return null;
    }
  }
  return outtakesTransGainNode;
}

function connectOuttakesTransBus(hearGain, recDest) {
  if (!outtakesTransGainNode) return;
  try { outtakesTransGainNode.disconnect(); } catch {}
  outtakesTransGainNode.gain.value = OUTTAKES_TRANS_GAIN;
  // Nur Outtakes-Bus — nie an Premiere-masterGain / ctx.destination direkt
  if (hearGain) try { outtakesTransGainNode.connect(hearGain); } catch {}
  if (recDest) try { outtakesTransGainNode.connect(recDest); } catch {}
}

/** Spielt grau/SW-Rauschen (Canvas) + synthetisches Audio — Bilddauer = Tondauer. */
async function playOuttakesTransitionClip({ quiet, lab, lineEl, capEl, frames, ctx, hearGain, recDest }) {
  if (outtakeAbort) return;
  outtakesOverlayLine = "";
  if (!quiet) {
    if (lab) lab.textContent = "…";
    if (lineEl) lineEl.textContent = "";
    if (capEl) capEl.textContent = "";
  }
  if (outtakeAbort) return;
  const durMs = outtakesTransMs();
  const durSec = durMs / 1000;
  ensureOuttakesTransGain(ctx);
  connectOuttakesTransBus(hearGain, recDest);
  stopOuttakesNoiseSrc();
  let noiseSrc = null;
  try {
    if (ctx && outtakesTransGainNode) {
      if (ctx.state === "suspended") try { await ctx.resume(); } catch {}
      const buf = ensureOuttakesNoiseBuf(ctx, durSec);
      noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = buf;
      noiseSrc.connect(outtakesTransGainNode);
      const t0 = ctx.currentTime;
      noiseSrc.start(t0);
      noiseSrc.stop(t0 + durSec);
      outtakesNoiseSrc = noiseSrc;
      noiseSrc.onended = () => { if (outtakesNoiseSrc === noiseSrc) outtakesNoiseSrc = null; };
    }
  } catch (e) { console.warn("Outtakes-Noise:", e); }
  // Bildflag erst NACH Audio-Start — gleiche Clock für A/V
  outtakesDrawTrans = true;
  if (!quiet) showOuttakesStaticOverlay(true);
  if (frames) try { frames.paint(); } catch {}
  const wall0 = performance.now();
  await new Promise(r => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      r();
    };
    const t = setTimeout(finish, durMs);
    const btn = $("btn-outtakes-skip");
    if (btn && !quiet) {
      btn.onclick = () => {
        try { if (noiseSrc) noiseSrc.stop(); } catch {}
        finish();
      };
    }
  });
  // Falls Timeout etwas früher als Audio-Ende: kurz nachziehen (kein abgeschnittener Ton)
  const remain = durMs - (performance.now() - wall0);
  if (remain > 8 && !outtakeAbort) await new Promise(r => setTimeout(r, Math.min(remain, 40)));
  outtakesDrawTrans = false;
  if (outtakesNoiseSrc === noiseSrc) outtakesNoiseSrc = null;
  if (!quiet) showOuttakesStaticOverlay(false);
  // Ein Extra-Frame ohne Rauschen, damit MediaRecorder das Ende sauber schließt
  if (frames) {
    try { frames.paint(); } catch {}
    await new Promise(r => setTimeout(r, 34));
    if (frames) try { frames.paint(); } catch {}
  }
}

/** Kopie der Outtake-Audiodaten — decodeAudioData darf das Original nie detach'en. */
async function outtakeAudioCopy(buf) {
  if (buf == null) throw new Error("Outtake ohne Audio");
  try {
    return await toArrayBuffer(buf);
  } catch (e) {
    // Detached ArrayBuffer / kaputte PeerJS-Daten
    if (buf && typeof buf.slice === "function") {
      try { return await toArrayBuffer(buf.slice(0)); } catch {}
    }
    throw e;
  }
}

function resolveOuttakesCachePending(val) {
  if (outtakesCacheResolve) {
    const r = outtakesCacheResolve;
    outtakesCacheResolve = null;
    outtakesCachePending = null;
    try { r(val); } catch {}
  } else {
    outtakesCachePending = null;
  }
}

function scheduleOuttakesPrecache() {
  clearTimeout(outtakesPrecacheTimer);
  if (!outtakes.length || outtakesCacheReady()) return;
  outtakesPrecacheTimer = setTimeout(() => {
    if (!outtakes.length || outtakesCacheReady() || outtakesPlaying || outtakesCachePending) return;
    // Nie parallel zur Premiere — sonst malt outtakesDrawTrans Rauschen in den Original-Mix
    if (premIsBusy()) {
      scheduleOuttakesPrecache();
      return;
    }
    playOuttakesReel({ quiet: true }).catch(e => console.warn("Outtakes-Precache:", e));
  }, 350);
}

async function playOuttakesReel(opts) {
  let saveFile = !!(opts && opts.save);
  const quiet = !!(opts && opts.quiet);   // Hintergrund: kein Overlay, Lautsprecher stumm (Gain 0)
  // Stiller Precache nie parallel zur Premiere (Rauschen/Bus sonst im falschen Mix)
  if (quiet && !saveFile && premIsBusy()) {
    scheduleOuttakesPrecache();
    return;
  }
  // Schon ein Durchlauf aktiv?
  if (outtakesPlaying) {
    // Zweiter stiller Job: Speichern vormerken statt stillem No-Op
    if (quiet) {
      if (saveFile) outtakesSaveWhenReady = true;
      return;
    }
    // Sichtbares Anschauen unterbricht stillen Precache
    if (outtakesQuietJob) {
      outtakeAbort = true;
      const t0 = performance.now();
      while (outtakesPlaying && performance.now() - t0 < 8000) {
        await new Promise(r => setTimeout(r, 50));
      }
      if (outtakesPlaying) return;
    } else return;
  }
  if (!outtakes.length) return;

  // Sofort sperren (vor jedem await)
  outtakesPlaying = true;
  outtakesQuietJob = quiet;
  outtakeAbort = false;
  if (saveFile) outtakesSaveWhenReady = false;
  outtakesDidSaveBlob = false;
  outtakes = dedupeOuttakes(outtakes);
  const reel = outtakes.slice();
  const ov = $("outtakes-overlay");
  const v = $("outtakes-video");
  const lab = $("outtakes-label");
  const lineEl = $("outtakes-line");
  const capEl = $("outtakes-caption");
  const recStat = $("outtakes-rec-status");
  outtakesOverlayLine = "";
  if (!ov || !v) {
    outtakesPlaying = false; outtakesQuietJob = false;
    resolveOuttakesCachePending(null);
    return;
  }

  const auchCachen = quiet || saveFile || !outtakesCacheReady();
  if (auchCachen) {
    outtakesCache = null;
    if (!outtakesCachePending) {
      outtakesCachePending = new Promise(res => { outtakesCacheResolve = res; });
    }
  }

  if (!quiet) ov.classList.add("show");
  if (recStat) {
    if (quiet) {
      recStat.style.display = "none";
    } else if (saveFile || auchCachen) {
      recStat.style.display = "";
      recStat.textContent = saveFile
        ? tt("🔴 Recording outtakes (video+audio) …", "🔴 Nimmt Outtakes auf (Bild+Ton) …")
        : tt("💾 Cutting along — save will be instant after", "💾 Schneidet mit — Speichern danach sofort");
      recStat.style.color = saveFile ? "var(--hot)" : "var(--amber)";
    } else recStat.style.display = "none";
  }
  // MediaRecorder misst Echtzeit — nie schneller abspielen beim Mitschnitt,
  // sonst landet Zeitraffer (hohe Geschwindigkeit) in der gespeicherten Datei.
  const exportRate = 1;
  const reportOtProg = (i, total, phase) => {
    const pct = total ? Math.max(1, Math.min(99, Math.round((i / total) * 100))) : 0;
    const msg = phase === "decode"
      ? (tt("🎬 Preparing outtakes … ", "🎬 Outtakes vorbereiten … ") + pct + "%")
      : (tt("🎬 Saving outtakes … ", "🎬 Outtakes speichern … ") + (i + 1) + "/" + total + " (" + pct + "%)");
    if (quiet || saveFile) status("play-status", msg);
    if (recStat && (quiet || saveFile || auchCachen)) {
      recStat.style.display = "";
      recStat.textContent = msg;
      recStat.style.color = "var(--amber)";
    }
    const dl = $("btn-outtakes-dl");
    if (dl && (outtakesCachePending || quiet)) dl.textContent = "⬇ " + pct + "% …";
  };
  if (quiet) status("play-status", tt("🎬 Cutting outtakes …", "🎬 Outtakes werden geschnitten …"));
  updateOuttakesBtn();

  let vidGain = null, hearGain = null, recDest = null, frames = null, fileRec = null;
  let cacheOk = null;
  let outtakesRecT0 = 0;
  const chunks = [];
  const mime = outtakesMime();
  const endung = mime.startsWith("video/mp4") ? "mp4" : "webm";

  try {
    v.src = sceneVideoSrc() || "";
    try { await waitCanPlay(v, 8000); } catch {}
    const ctx = getCtx();
    if (ctx.state === "suspended") try { await ctx.resume(); } catch {}

    // Audio-Bus: immer an destination hängen (auch quiet mit Gain 0).
    // Sonst rendert Chromium den Graphen oft nicht → MediaRecorder / Anschauen ohne Ton.
    try {
      hearGain = ctx.createGain();
      hearGain.gain.value = quiet ? 0 : 1;
      hearGain.connect(ctx.destination);
      vidGain = ctx.createGain();
      vidGain.gain.value = 0.35;
      try { v.muted = false; } catch {}
      try { v.volume = 1; } catch {}
      const elSrc = elementSource(ctx, v);
      try { elSrc.disconnect(); } catch {}
      elSrc.connect(vidGain);
      vidGain.connect(hearGain);
    } catch (e) { console.warn("Outtakes video-audio:", e); }

    try {
      ensureOuttakesTransGain(ctx);
      connectOuttakesTransBus(hearGain, null);
    } catch (e) { console.warn("Outtakes-Transition-Bus:", e); }

    // Alle Takes parallel dekodieren — spart Sekunden beim Speichern
    reportOtProg(0, reel.length, "decode");
    const decodedBufs = await Promise.all(reel.map(async (ot, idx) => {
      try {
        const ab = await outtakeAudioCopy(ot.buf);
        const buf = await ctx.decodeAudioData(ab);
        if (idx % 2 === 0 || idx === reel.length - 1) reportOtProg(idx + 1, reel.length, "decode");
        return buf;
      } catch (e) {
        console.warn("Outtake decode:", e);
        return null;
      }
    }));

    if (auchCachen) {
      try {
        recDest = ctx.createMediaStreamDestination();
        if (vidGain) vidGain.connect(recDest);
        connectOuttakesTransBus(hearGain, recDest);
        const lockW = v.videoWidth || 1280;
        const lockH = v.videoHeight || 720;
        frames = frameSource(v, { alwaysRaf: true, outtakesBadge: true, lockW, lockH });
        await new Promise(r => {
          const t0 = performance.now();
          const iv = setInterval(() => {
            if (frames) try { frames.paint(); } catch {}
            if ((v.videoWidth > 0 && frames && frames.count() >= 4) || performance.now() - t0 > 1500) {
              clearInterval(iv); r();
            }
          }, 32);
        });
        const vTrack = frames.stream.getVideoTracks()[0];
        if (vTrack) try { vTrack.enabled = true; } catch {}
        const aTracks = recDest.stream.getAudioTracks();
        if (!aTracks.length) console.warn("Outtakes: keine Audio-Spur am Recorder");
        const stream = new MediaStream([
          ...frames.stream.getVideoTracks(),
          ...aTracks
        ]);
        fileRec = new MediaRecorder(stream, {
          mimeType: mime,
          videoBitsPerSecond: quiet ? 2_500_000 : 3_500_000,
          audioBitsPerSecond: 128_000
        });
        fileRec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
        if (!startMediaRecorder(fileRec, 200)) throw new Error("MediaRecorder start failed");
        holdPremWakeLock();
        outtakesRecT0 = performance.now();
      } catch (e) {
        console.warn("Outtakes-Recorder startet nicht:", e);
        fileRec = null;
        if (!quiet && recStat && saveFile) {
          recStat.style.display = "";
          recStat.textContent = tt("⚠ Can't record — watch only", "⚠ Aufnehmen nicht möglich — nur Anschauen");
          recStat.style.color = "var(--hot)";
        }
      }
    }

    try { v.playbackRate = exportRate; } catch {}

    for (let i = 0; i < reel.length; i++) {
      if (outtakeAbort) break;
      reportOtProg(i, reel.length, "cut");
      const ot = reel[i];
      const who = ot.name ? (" · " + ot.name) : "";
      const lineTxt = String(ot.text || "").trim();
      outtakesOverlayLine = lineTxt;
      if (!quiet) {
        if (lab) lab.textContent = "OUTTAKE " + (i + 1) + "/" + reel.length + who;
        if (lineEl) lineEl.textContent = lineTxt ? ("„" + lineTxt + "“") : "";
        if (capEl) capEl.textContent = lineTxt ? ("„" + lineTxt + "“") : "";
      }
      let src = null;
      try {
        if (ctx.state === "suspended") try { await ctx.resume(); } catch {}
        v.pause();
        v.currentTime = Math.max(0, ot.t - 0.15);
        await new Promise(r => {
          const h = () => { v.removeEventListener("seeked", h); r(); };
          v.addEventListener("seeked", h);
          setTimeout(r, quiet ? 180 : 450);
        });
        if (frames) try { frames.paint(); } catch {}
        const buf = decodedBufs[i];
        if (!buf) throw new Error("kein Buffer");
        src = ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = exportRate;
        const g = ctx.createGain(); g.gain.value = 1.1;
        src.connect(g);
        if (hearGain) g.connect(hearGain);
        else if (!quiet) g.connect(ctx.destination);
        if (recDest) g.connect(recDest);
        await Promise.race([v.play().catch(() => {}), new Promise(r => setTimeout(r, 400))]);
        if (frames) try { frames.paint(); } catch {}
        src.start();
        const natural = Math.min(buf.duration, Math.max(0.8, (ot.end - ot.t) + 0.4));
        const dur = natural / exportRate;
        await new Promise(r => {
          let done = false;
          const finish = () => { if (done) return; done = true; clearTimeout(t); r(); };
          const t = setTimeout(finish, dur * 1000 + 40);
          const skip = () => { try { src.stop(); } catch {} finish(); };
          const btn = $("btn-outtakes-skip");
          if (btn && !quiet) btn.onclick = skip;
          src.onended = finish;
        });
      } catch (e) { console.warn("Outtake skip:", e); }
      try { if (src) src.stop(); } catch {}
      v.pause();
      if (frames) try { frames.paint(); } catch {}
      if (i < reel.length - 1 && !outtakeAbort && shouldPlayOuttakesTransition(i, reel.length)) {
        await playOuttakesTransitionClip({ quiet, lab, lineEl, capEl, frames, ctx, hearGain, recDest });
      }
    }
    reportOtProg(reel.length - 1, reel.length, "cut");

    if (fileRec && fileRec.state !== "inactive") {
      await new Promise(r => {
        const to = setTimeout(r, 4000);
        fileRec.onstop = () => { clearTimeout(to); r(); };
        try { fileRec.stop(); } catch { clearTimeout(to); r(); }
      });
    }

    // Speichern während Precache angefordert? Cache reicht — downloadOuttakes holt die Datei.
    const wantSave = saveFile || outtakesSaveWhenReady;
    if (outtakesSaveWhenReady && !saveFile) outtakesSaveWhenReady = false;

    if (fileRec && chunks.length && !outtakeAbort) {
      let blob = new Blob(chunks, { type: mime.split(";")[0] });
      // Echte Aufnahme-Länge in Echtzeit (exportRate ist immer 1 beim Mitschnitt)
      const durSec = outtakesRecT0
        ? Math.max(0.5, (performance.now() - outtakesRecT0) / 1000)
        : reel.reduce((s, ot) => s + Math.max(0.8, (ot.end - ot.t) + 0.4), 0)
          + countOuttakesTransitions(reel.length) * (outtakesTransMs() / 1000);
      try { blob = await withRecordedDuration(blob, durSec); } catch {}
      if (blob.size > 1000) {
        outtakesCache = { blob, endung };
        cacheOk = outtakesCache;
        // Nur speichern wenn dieser Lauf explizit mit save:true gestartet wurde
        // (nicht bei saveWhenReady — sonst Doppel-Download mit downloadOuttakes)
        if (saveFile) {
          const name = (scene?.id || "synchro") + "_outtakes." + endung;
          try {
            const wie = await saveBlob(blob, name);
            outtakesDidSaveBlob = true;
            if (wie === "abort") status("play-status", tt("Outtakes save cancelled.", "Outtakes-Speichern abgebrochen."));
            else {
              status("play-status", tt("✅ Outtakes saved!", "✅ Outtakes gespeichert!"));
              SFX.done();
            }
          } catch (e) {
            console.warn("Outtakes saveBlob:", e);
            status("play-status", tt("⚠ Outtakes save failed — try again.", "⚠ Outtakes-Speichern fehlgeschlagen — nochmal versuchen."), true);
          }
        } else if (wantSave) {
          status("play-status", tt("✅ Outtakes cut — starting download …", "✅ Outtakes fertiggeschnitten — Speichern startet …"));
        } else if (quiet) {
          status("play-status", tt("✅ Outtakes cut — ready to save now!", "✅ Outtakes fertiggeschnitten — Sofort speichern bereit!"));
        } else {
          status("play-status", tt("✅ Outtakes done — ready to save now!", "✅ Outtakes durch — Speichern ist jetzt sofort bereit!"));
        }
      } else if (wantSave) {
        status("play-status", tt("⚠ Outtakes capture was empty — keep the window in front and try again.", "⚠ Outtakes-Mitschnitt war leer — Fenster im Vordergrund lassen und nochmal versuchen."), true);
      }
    } else if (wantSave && !outtakeAbort) {
      status("play-status", tt("⚠ Outtakes capture failed — keep the tab in front and save again.", "⚠ Outtakes-Mitschnitt fehlgeschlagen — Tab im Vordergrund lassen und nochmal speichern."), true);
    }
  } catch (e) {
    console.warn("Outtakes-Reel Fehler:", e);
    if (saveFile) status("play-status", tt("⚠ Outtakes error — please save again.", "⚠ Outtakes-Fehler — bitte nochmal speichern."), true);
  } finally {
    silenceOuttakesTransBus();
    try { v.playbackRate = 1; } catch {}
    try {
      if (fileRec && fileRec.state !== "inactive") fileRec.stop();
    } catch {}
    try {
      const tv = $("outtakes-transition");
      if (tv) { tv.pause(); tv.classList.remove("show"); tv.removeAttribute("src"); tv.load(); }
    } catch {}
    try { if (frames) frames.stop(); } catch {}
    try { if (vidGain && recDest) vidGain.disconnect(recDest); } catch {}
    try { if (vidGain && hearGain) vidGain.disconnect(hearGain); } catch {}
    try { if (hearGain) hearGain.disconnect(); } catch {}
    releasePremWakeLock();
    // Flags zuerst freigeben, dann Pending auflösen — sonst Save-Race mit early-return
    outtakesPlaying = false;
    outtakesQuietJob = false;
    if (auchCachen) resolveOuttakesCachePending(cacheOk);
    // Nach abgebrochenem Precache (wegen Premiere) später nochmal versuchen
    if (!cacheOk && outtakes.length && !outtakesCacheReady()) {
      try { scheduleOuttakesPrecache(); } catch {}
    }
    outtakesOverlayLine = "";
    if (capEl) capEl.textContent = "";
    if (recStat) { recStat.style.display = "none"; recStat.style.color = ""; }
    if (!quiet) ov.classList.remove("show");
    try { v.pause(); } catch {}
    updateOuttakesBtn();
    if (!saveFile && !quiet && !outtakeAbort) SFX.ok();
  }
}

async function downloadOuttakes() {
  if (!outtakes.length) return;
  // Schon fertig vom Hintergrund-Schnitt?
  if (outtakesCacheReady()) {
    const name = (scene?.id || "synchro") + "_outtakes." + outtakesCache.endung;
    const wie = await saveBlob(outtakesCache.blob, name);
    if (wie === "abort") return status("play-status", tt("Outtakes save cancelled.", "Outtakes-Speichern abgebrochen."));
    status("play-status", tt("✅ Outtakes saved instantly!", "✅ Outtakes sofort gespeichert!"));
    SFX.done();
    return;
  }
  // Hintergrund läuft noch → warten, dann speichern (kein zweites Abspielen)
  if (outtakesCachePending || (outtakesPlaying && outtakesQuietJob)) {
    outtakesSaveWhenReady = true;
    status("play-status", tt("⏳ Outtakes still cutting — progress is above …", "⏳ Outtakes werden noch geschnitten — Fortschritt steht oben …"));
    updateOuttakesBtn();
    try {
      if (outtakesCachePending) {
        const c = await outtakesCachePending;
        if (c && c.blob && c.blob.size > 1000) {
          // Falls Precache selbst schon gespeichert hat (saveWhenReady), fertig
          if (!outtakesCacheReady()) outtakesCache = c;
          const name = (scene?.id || "synchro") + "_outtakes." + c.endung;
          const wie = await saveBlob(c.blob, name);
          if (wie === "abort") return status("play-status", tt("Outtakes save cancelled.", "Outtakes-Speichern abgebrochen."));
          status("play-status", tt("✅ Outtakes saved!", "✅ Outtakes gespeichert!"));
          SFX.done();
          updateOuttakesBtn();
          return;
        }
      } else {
        // Quiet läuft, Pending fehlt kurz — auf Ende warten
        const t0 = performance.now();
        while (outtakesPlaying && performance.now() - t0 < 120000) {
          await new Promise(r => setTimeout(r, 100));
        }
        if (outtakesCacheReady()) {
          const name = (scene?.id || "synchro") + "_outtakes." + outtakesCache.endung;
          const wie = await saveBlob(outtakesCache.blob, name);
          if (wie === "abort") return status("play-status", tt("Outtakes save cancelled.", "Outtakes-Speichern abgebrochen."));
          status("play-status", tt("✅ Outtakes saved!", "✅ Outtakes gespeichert!"));
          SFX.done();
          updateOuttakesBtn();
          return;
        }
      }
    } catch {}
  }
  if (outtakesPlaying && !outtakesQuietJob) {
    status("play-status", tt("Outtakes still playing — save will be ready right after.", "Outtakes laufen noch — danach ist Speichern sofort bereit."), true);
    return;
  }
  // Noch kein Cache → still im Hintergrund schneiden und direkt speichern
  status("play-status", tt("🎬 Cutting outtakes in background — keep the window open …", "🎬 Schneide Outtakes im Hintergrund — Fenster offen lassen …"));
  await playOuttakesReel({ quiet: true, save: true });
  if (outtakesDidSaveBlob) return;
  // Race: stiller Job lief schon → Save war nur vorgemerkt; auf Cache warten
  if (!outtakesCacheReady()) {
    const t0 = performance.now();
    while ((outtakesPlaying || outtakesCachePending) && performance.now() - t0 < 120000) {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  if (outtakesCacheReady()) {
    outtakesSaveWhenReady = false;
    const name = (scene?.id || "synchro") + "_outtakes." + outtakesCache.endung;
    const wie = await saveBlob(outtakesCache.blob, name);
    if (wie === "abort") return status("play-status", tt("Outtakes save cancelled.", "Outtakes-Speichern abgebrochen."));
    status("play-status", tt("✅ Outtakes saved!", "✅ Outtakes gespeichert!"));
    SFX.done();
  } else if (!outtakesPlaying) {
    await playOuttakesReel({ quiet: true, save: true });
  }
}
$("btn-outtakes") && ($("btn-outtakes").onclick = () => {
  SFX.click();
  // Host startet für alle — Gäste dürfen lokal trotzdem nachstarten, falls sie verpasst haben
  if (iAmLogicalHost() && !isHost) sendHost({ t: "hostCmd", cmd: "playOuttakes" });
  else if (isHost) broadcast({ t: "playOuttakes" });
  playOuttakesReel();
});
$("btn-outtakes-dl") && ($("btn-outtakes-dl").onclick = () => { SFX.click(); downloadOuttakes(); });
$("btn-outtakes-dl-overlay") && ($("btn-outtakes-dl-overlay").onclick = () => { SFX.click(); downloadOuttakes(); });
$("btn-outtakes-close") && ($("btn-outtakes-close").onclick = () => {
  outtakeAbort = true;
  silenceOuttakesTransBus();
  $("outtakes-overlay").classList.remove("show");
  const v = $("outtakes-video"); if (v) v.pause();
});
// Beep-Schalter (Leiste + Overlay) — speichert lokal, invalidiert Outtakes-Cache
(() => {
  syncOuttakesBeepToggles();
  const bind = id => {
    const el = $(id);
    if (!el) return;
    el.onchange = () => {
      setOuttakesBeepOn(el.checked);
      // Anderer Beep-Stand → altes Reel-Video verwerfen
      outtakesCache = null;
      updateOuttakesBtn();
      scheduleOuttakesPrecache();
    };
  };
  bind("outtakes-beep-tog");
  bind("outtakes-beep-tog-ov");
})();

// Timer / Wipe / Cue / Effekt-Strip-Einstellungen merken
(() => {
  const t = $("rec-timer"), w = $("rec-wipe"), c = $("rec-cue-orig"), cv = $("rec-cue-vol"), cvl = $("rec-cue-vol-val");
  const sx = $("strip-role-fx");
  try {
    if (t && localStorage.getItem("ss_rec_timer") != null) t.checked = localStorage.getItem("ss_rec_timer") === "1";
    if (w && localStorage.getItem("ss_rec_wipe") === "1") w.checked = true;
    if (c && localStorage.getItem("ss_rec_cue") === "1") c.checked = true;
    if (cv && localStorage.getItem("ss_rec_cue_vol") != null) {
      cv.value = localStorage.getItem("ss_rec_cue_vol");
      if (cvl) cvl.textContent = Math.round(parseFloat(cv.value) * 100) + "%";
    }
    if (sx && localStorage.getItem("ss_strip_role_fx") === "1") sx.checked = true;
  } catch {}
  stripRoleFx = !!(sx && sx.checked);
  if (t) t.onchange = () => { try { localStorage.setItem("ss_rec_timer", t.checked ? "1" : "0"); } catch {} };
  if (w) w.onchange = () => { try { localStorage.setItem("ss_rec_wipe", w.checked ? "1" : "0"); } catch {} };
  if (c) c.onchange = () => { try { localStorage.setItem("ss_rec_cue", c.checked ? "1" : "0"); } catch {} };
  if (cv) cv.oninput = () => {
    const v = parseFloat(cv.value);
    if (cvl) cvl.textContent = Math.round(v * 100) + "%";
    if (recCueGain) try { recCueGain.gain.value = v; } catch {}
    try { localStorage.setItem("ss_rec_cue_vol", String(v)); } catch {}
  };
  if (sx) sx.onchange = () => {
    stripRoleFx = !!sx.checked;
    try { localStorage.setItem("ss_strip_role_fx", stripRoleFx ? "1" : "0"); } catch {}
    const l = myLines[curLine];
    if (l) { syncFxAmountUI(l); fxPreviewCacheKey = null; if (fxPreviewSrc) startFxPreview(); }
    SFX.click();
  };
})();


// ═════════════════════════════════════════════════════════════
// WARTE-ARENA 3+4: Reaktions-Duell & Tipp-Renner
// ═════════════════════════════════════════════════════════════
// — Reaktion —
let rxWaiting = false, rxGreenAt = 0, rxDone = false;
const rxScores = new Map(), tpScores = new Map();

$("btn-rx-start").onclick = () => {
  const delay = 1500 + Math.random() * 3500;
  if (isHost) { broadcast({ t: "rxGo", delay }); rxRun(delay); }
  else sendHost({ t: "mg", k: "rxStart" });
};
function rxRun(delay) {
  rxWaiting = true; rxDone = false;
  $("rx-pad").style.display = ""; $("btn-rx-start").style.display = "none";
  $("rx-result").innerHTML = "";
  const pad = $("rx-pad");
  pad.style.background = "#5c1a1e"; pad.textContent = tt("WAIT FOR GREEN …", "WARTE AUF GRÜN …");
  rxGreenAt = 0;
  setTimeout(() => {
    if (!rxWaiting) return;
    rxGreenAt = performance.now();
    pad.style.background = "#1a5c34"; pad.textContent = tt("NOW! CLICK!", "JETZT! KLICK!");
    if (onWaitScreen()) SFX.go();
  }, delay);
}
$("rx-pad") && ($("rx-pad").onclick = () => {
  if (!rxWaiting || rxDone) return;
  rxDone = true; rxWaiting = false;
  let ms;
  if (!rxGreenAt) { ms = 9999; $("rx-pad").textContent = tt("TOO EARLY! 😅", "ZU FRÜH! 😅"); SFX.err(); }
  else { ms = Math.round(performance.now() - rxGreenAt); $("rx-pad").textContent = ms + " ms!"; SFX.ok(); }
  setTimeout(() => { $("rx-pad").style.display = "none"; $("btn-rx-start").style.display = ""; }, 1200);
  if (isHost) mgScore("rx", myId, ms); else sendHost({ t: "mg", k: "rxScore", ms });
});

// — Tipp-Renner (eigene, kurze Phrasen) —
const TP_PHRASES_DE = ["synchronstudio läuft heiß", "wer klickt der spricht", "mikro an hirn aus", "premiere in drei zwei eins", "der take sitzt beim ersten mal", "kopfhörer auf und los", "gate offen stimme raus", "voll auf die lippen getimet"];
const TP_PHRASES_EN = ["synchronstudio running hot", "clickers gonna speak", "mic on brain off", "premiere in three two one", "nailed it first take", "headphones on let's go", "gate open voice out", "timed right on the lips"];
function tpPhrases() { return getLang() === "de" ? TP_PHRASES_DE : TP_PHRASES_EN; }
let tpPhrase = "", tpStartT = 0, tpDone = false;
$("btn-tp-start").onclick = () => {
  const phrase = tpPhrases()[Math.floor(Math.random() * tpPhrases().length)];
  if (isHost) { broadcast({ t: "tpGo", phrase }); tpRun(phrase); }
  else sendHost({ t: "mg", k: "tpStart" });
};
function tpRun(phrase) {
  tpPhrase = phrase; tpDone = false; tpStartT = performance.now();
  $("tp-area").style.display = ""; $("btn-tp-start").style.display = "none";
  $("tp-result").innerHTML = "";
  $("tp-phrase").textContent = "„" + phrase + "“";
  const inp = $("tp-input");
  inp.value = ""; inp.disabled = false; inp.focus();
  inp.oninput = () => {
    if (tpDone) return;
    if (inp.value.trim().toLowerCase() === tpPhrase) {
      tpDone = true; inp.disabled = true;
      const ms = Math.round(performance.now() - tpStartT);
      $("tp-phrase").textContent = "✅ " + (ms / 1000).toFixed(2) + "s!";
      SFX.ok();
      setTimeout(() => { $("tp-area").style.display = "none"; $("btn-tp-start").style.display = ""; }, 1200);
      if (isHost) mgScore("tp", myId, ms); else sendHost({ t: "mg", k: "tpScore", ms });
    }
  };
}

// — Auswertung (Host sammelt, kleinste Zeit gewinnt) —
function mgScore(game, pid, ms) {
  const map = game === "rx" ? rxScores : tpScores;
  map.set(pid, ms);
  clearTimeout(mgScore["_t" + game]);
  mgScore["_t" + game] = setTimeout(() => {
    const list = [...map.entries()].sort((a, b) => a[1] - b[1]);
    broadcast({ t: "mgResult", game, list });
    mgShowResult(game, list);
    if (list.length && list[0][1] < 9999) addWin(list[0][0]);
    map.clear();
  }, game === "rx" ? 4000 : 15000);
}
function mgShowResult(game, list) {
  const el = $(game === "rx" ? "rx-result" : "tp-result");
  el.innerHTML = list.map(([pid, ms], i) =>
    `<div>${i === 0 ? "🏆" : i === 1 ? "🥈" : i === 2 ? "🥉" : "•"} <b>${esc(nameOf(pid))}</b> — ${ms >= 9999 ? tt("too early 😅", "zu früh 😅") : game === "rx" ? ms + " ms" : (ms / 1000).toFixed(2) + "s"}</div>`).join("");
  if (onWaitScreen()) SFX.done();
}

// ═════════════════════════════════════════════════════════════
// 8) HOST: Spuren einsammeln → Mix an alle
// ═════════════════════════════════════════════════════════════
const collected = new Map();   // role → items

// ── Redo starten: springt für GENAU eine Line zurück in die Booth-Aufnahme ──
function redoLine(lineIdx, fromScreen) {
  if (premiereLocked) return;
  const idxInMyLines = myLines.findIndex(l => l.idx === lineIdx);
  if (idxInMyLines < 0) return;
  redoMode = lineIdx;
  redoReturnScreen = fromScreen;
  curLine = idxInMyLines;
  const bv = $("booth-video");
  bv.src = sceneVideoSrc();
  const rid = myRole();
  const av = scene.avatars?.[String(rid)];
  $("booth-avatar").style.display = av ? "" : "none";
  if (av) $("booth-avatar").src = assetUrl(av);
  $("booth-rolename").textContent = roleOf(rid).name + tt(" (fix)", " (Korrektur)");
  setBar("booth-bar", 30);
  waitCanPlay(bv).then(() => { setBar("booth-bar", 100); $("btn-line-rec").disabled = false; });
  show("scr-booth");
  $("onair").classList.add("live");
  startVizOn("viz");
  renderLine();
}

// ── Redo abschließen: aktualisierten Take an den Host schicken, zurück zur Warte-/Premiere-Ansicht ──
function finishRedo() {
  const l = myLines[curLine];
  const buf = takes[l.idx];
  const startAt = l.t;
  const lineIdx = l.idx;
  const effect = submitEffectFor(l);
  const gate = micSettings.gate;
  const boost = myLineGains[l.idx];
  const fxAmount = myEffectAmounts[l.idx];
  const pan = submitPanFor(l);
  redoMode = null;
  cancelAnimationFrame(vizRAF);
  $("onair").classList.remove("live");
  const back = redoReturnScreen || "scr-wait";
  show(back);
  const ots = serializeOuttakes(true);
  if (buf && buf !== "SKIP") {
    if (isHost) {
      applyTrackUpdate(roleOfLine(scene.lines[lineIdx]) ?? myRole(), lineIdx, startAt, buf, effect, gate, boost, fxAmount, pan);
      ingestOuttakesFromPlayer(myId, myName, ots);
    } else sendHost({
      t: "trackUpdate", role: roleOfLine(scene.lines[lineIdx]) ?? myRole(), lineIdx, startAt, buf,
      effect, gate, boost, fxAmount, pan,
      // Meta ohne Audio-Buffer — PeerJS streicht Nebenfelder neben buf manchmal
      trackMeta: { effect, gate, boost, fxAmount, pan },
      outtakes: ots,
      name: myName,
    });
  } else if (ots.length) {
    if (isHost) ingestOuttakesFromPlayer(myId, myName, ots);
    else sendHost({ t: "trackUpdate", role: roleOfLine(scene.lines[lineIdx]) ?? myRole(), lineIdx, startAt, buf: null, outtakes: ots, name: myName });
  }
  status(back === "scr-playback" ? "play-status" : "wait-status", tt("✅ Line updated! It’ll be in the final mix.", "✅ Line aktualisiert! Wird im Endergebnis berücksichtigt."));
  renderRedoPanel("redo-panel-wait");
  renderRedoPanel("redo-panel-prem");
  SFX.done();
}

// ── Panel mit den eigenen Lines + "Neu aufnehmen"-Button je Line ──
function renderRedoPanel(containerId) {
  const el = $(containerId);
  if (!el) return;
  if (premiereLocked || !scene || !scene.lines) { el.innerHTML = ""; return; }
  const rid = myRole();
  if (rid == null) { el.innerHTML = ""; return; }   // Zuschauer haben nichts zu korrigieren
  const mine = scene.lines.map((l, i) => ({ ...l, idx: i })).filter(l => l.chars.includes(rid));
  if (!mine.length) { el.innerHTML = ""; return; }
  const fromScreen = containerId === "redo-panel-wait" ? "scr-wait" : "scr-playback";
  el.innerHTML = `<div class="tag" style="margin:10px 0 6px">${esc(tt("🔁 Not happy with one of your lines?", "🔁 Eine deiner Lines noch nicht zufrieden?"))}</div>` +
    mine.map(l => `<div class="row" style="justify-content:space-between;background:#14141b;border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin-bottom:6px;gap:10px">
      <span style="font-size:.85rem;flex:1">${esc(linePrimaryText(l).slice(0, 55))}${linePrimaryText(l).length > 55 ? "…" : ""}</span>
      <button class="ghost redo-btn" data-idx="${l.idx}" style="padding:5px 12px;font-size:.8rem;white-space:nowrap">${esc(tt("🔁 Re-record", "🔁 Neu aufnehmen"))}</button>
    </div>`).join("");
  el.querySelectorAll(".redo-btn").forEach(b => b.onclick = () => redoLine(parseInt(b.dataset.idx), fromScreen));
}

// ── Host: patcht einen einzelnen Take in den bestehenden Mix und verteilt neu ──
async function applyTrackUpdate(role, lineIdx, startAt, rawBuf, effect, gate, boost, fxAmount, pan) {
  if (!finalTracksData) return;
  try {
    const ctx = getCtx();
    const ab = await toArrayBuffer(rawBuf);
    const entry = { startAt, idx: lineIdx, buf: ab, effect, gate, boost, fxAmount, pan };
    finalTracksData = finalTracksData.map(track => {
      if (track.role !== role) return track;
      const items = track.items.filter(it => it.idx !== lineIdx);
      items.push(entry);
      return { role, items };
    });
    if (!finalTracksData.some(t => t.role === role)) finalTracksData.push({ role, items: [entry] });
    publishMix(finalTracksData);
  } catch (e) { console.error("Track-Update fehlgeschlagen:", e); }
}


// ── Duell: beide Einreichungen sammeln, dann zwei komplette Mixe bauen ──
function collectDuelSubmit(playerId, items) {
  duelSubs[playerId] = items;
  if (duelSubs[duelInfo.aId] && duelSubs[duelInfo.bId]) assembleDuelMixes();
}
function assembleDuelMixes() {
  if (!isHost) return;
  const dataA = [{ role: duelInfo.roleId, items: duelSubs[duelInfo.aId] }];
  const dataB = [{ role: duelInfo.roleId, items: duelSubs[duelInfo.bId] }];
  broadcast({
    t: "duelReady", dataA, dataB, duelInfo,
    metaA: metaMapsFromTracks(dataA),
    metaB: metaMapsFromTracks(dataB),
  });
  loadDuelSequence(dataA, dataB, duelInfo);
}

// ── Beide Versionen nacheinander abspielen, dann Abstimm-Screen zeigen ──
async function decodeDuelData(data) {
  const ctx = getCtx();
  const items = [];
  for (const track of data) {
    for (const item of track.items) {
      try {
        const ab = await toArrayBuffer(item.buf);
        items.push({ role: track.role, startAt: item.startAt, lineIdx: item.idx, buffer: processTakeBuffer(ctx, await ctx.decodeAudioData(ab), item.gate, item.effect || (roleOf(track.role) || {}).effect, item.fxAmount), effect: item.effect, fxAmount: item.fxAmount, boost: item.boost, pan: item.pan });
      } catch (e) { console.warn("Duell-Spur kaputt:", e); }
    }
  }
  // Alle anderen Rollen (nicht die Duell-Rolle) sprechen original, falls vorhanden
  if (scene && scene.lines) {
    const coveredIdx = new Set(items.map(i => i.lineIdx));
    for (let i = 0; i < scene.lines.length; i++) {
      const l = scene.lines[i];
      if (!lineHasOrig(l) || coveredIdx.has(i)) continue;
      try {
        const buffer = await getLineOrigBuffer(l);
        if (buffer) {
          items.push({
            role: null, startAt: l.t, lineIdx: i, buffer,
            isOrig: true, origRoles: Array.isArray(l.chars) ? l.chars.slice() : []
          });
        }
      } catch {}
    }
  }
  return items;
}

async function loadDuelSequence(dataA, dataB, info) {
  duelInfo = info;
  show("scr-playback");
  $("btn-replay").style.display = "none"; $("btn-download-audio").style.display = "none";
  $("btn-download").style.display = "none"; $("btn-again").style.display = "none"; $("btn-back").style.display = "none";
  const otDuel = $("btn-outtakes"); if (otDuel) otDuel.style.display = "none";
  $("prem-status").textContent = "";   // veraltete "X/Y geladen"-Anzeige vom normalen Modus ausblenden, gilt hier nicht
  $("btn-prem-start").style.display = "none";
  status("play-status", tt("🥊 Preparing both versions …", "🥊 Bereite beide Versionen vor …"));

  const itemsA = await decodeDuelData(dataA);
  const itemsB = await decodeDuelData(dataB);

  const pv = $("play-video");
  pv.src = sceneVideoSrc();
  attachPrompter(pv, $("play-prompter"), null);
  await waitCanPlay(pv, 25000);

  const playOnce = (items, label) => new Promise(resolve => {
    status("play-status", "🥊 " + label);
    mixItems = items;
    pv.addEventListener("ended", resolve, { once: true });
    playMix(false);
  });

  const runSequence = async () => {
    $("btn-duel-play-start").style.display = "none";
    await playOnce(itemsA, "Take 1: " + nameOf(duelInfo.aId));
    for (let s = 3; s >= 1; s--) { status("play-status", tt("⏳ Take 2 in ", "⏳ Take 2 in ") + s + " …"); await new Promise(r => setTimeout(r, 1000)); }
    await playOnce(itemsB, "Take 2: " + nameOf(duelInfo.bId));
    showDuelVote();
  };

  if (isHost) {
    status("play-status", tt("✅ Both versions ready — you decide when it starts!", "✅ Beide Versionen bereit — du entscheidest, wann's losgeht!"));
    $("btn-duel-play-start").style.display = "";
    $("btn-duel-play-start").onclick = () => { broadcast({ t: "duelPlayGo" }); runSequence(); };
  } else {
    status("play-status", tt("✅ Ready — waiting for the host to start …", "✅ Bereit — warte, bis der Host startet …"));
    window.__duelRunSequence = runSequence;   // Gast wartet auf die "duelPlayGo"-Nachricht vom Host
  }
}

// ── Abstimm-Screen: alle außer den beiden Duellanten stimmen ab ──
function showDuelVote() {
  show("scr-duel-vote");
  $("leave-btn").style.display = "";
  const pA = players.find(p => p.id === duelInfo.aId), pB = players.find(p => p.id === duelInfo.bId);
  $("btn-vote-a").innerHTML = (pA ? avatarHTML(pA) : "") + `<b>${esc(nameOf(duelInfo.aId))}</b><span class="tag">Take 1</span>`;
  $("btn-vote-b").innerHTML = (pB ? avatarHTML(pB) : "") + `<b>${esc(nameOf(duelInfo.bId))}</b><span class="tag">Take 2</span>`;
  $("duel-result").innerHTML = "";
  $("btn-duel-back").style.display = "none";
  const amDuelist = myId === duelInfo.aId || myId === duelInfo.bId;
  const soloDuel = duelNeutralIds().length === 0;   // nur die beiden Duellanten im Raum
  $("btn-vote-a").disabled = amDuelist && !soloDuel;
  $("btn-vote-b").disabled = amDuelist && !soloDuel;
  status("duel-vote-status", soloDuel
    ? tt("It’s just the two of you — so you vote yourselves. Be honest 😄", "Ihr seid nur zu zweit — also stimmt ihr selbst ab. Seid ehrlich 😄")
    : amDuelist ? tt("As a duelist you can’t vote for yourself 😄", "Als Duellant darfst du nicht über dich selbst abstimmen 😄") : tt("Click the version you liked better!", "Klick auf die Version, die dir besser gefallen hat!"));
}
// Wer darf abstimmen? Normalerweise alle außer den Duellanten. Sind aber NUR die beiden
// Duellanten im Raum, dürfen sie selbst ran — sonst könnte niemand abstimmen und der
// Abstimm-Screen würde für immer stehen bleiben.
function duelNeutralIds() {
  return players.filter(p => p.id !== duelInfo.aId && p.id !== duelInfo.bId).map(p => p.id);
}
function duelVoterIds() {
  const neutral = duelNeutralIds();
  return neutral.length ? neutral : players.filter(p => p.id === duelInfo.aId || p.id === duelInfo.bId).map(p => p.id);
}
$("btn-vote-a").onclick = () => castDuelVote("a");
$("btn-vote-b").onclick = () => castDuelVote("b");
function castDuelVote(choice) {
  if (!duelVoterIds().includes(myId)) return;
  $("btn-vote-a").disabled = true; $("btn-vote-b").disabled = true;
  status("duel-vote-status", tt("✅ Vote in — waiting for the others …", "✅ Stimme abgegeben — warte auf die anderen …"));
  SFX.click();
  if (isHost) collectDuelVote(myId, choice);
  else sendHost({ t: "duelVote", choice });
}
function collectDuelVote(voterId, choice) {
  duelVotes[voterId] = choice;
  maybeFinishDuelVote();
}
function maybeFinishDuelVote() {
  if (!isHost || !duelInfo) return;
  const tally = { a: Object.values(duelVotes).filter(v => v === "a").length, b: Object.values(duelVotes).filter(v => v === "b").length };
  broadcast({ t: "duelVoteBroadcast", tally });
  showDuelVoteLive(tally);
  const voters = duelVoterIds();
  // Nur noch Stimmen von Leuten zählen, die auch wirklich noch im Raum sind
  const abgegeben = Object.keys(duelVotes).filter(id => voters.includes(id)).length;
  if (voters.length && abgegeben >= voters.length) finishDuelVote(tally);
}
function showDuelVoteLive(tally) {
  $("duel-vote-sub").textContent = tt("Votes so far: ", "Stimmen bisher: ") + nameOf(duelInfo.aId) + " " + tally.a + " : " + tally.b + " " + nameOf(duelInfo.bId);
}
function finishDuelVote(tally) {
  if (!isHost) return;
  let winner = tally.a > tally.b ? "a" : tally.b > tally.a ? "b" : "tie";
  const result = { tally, winner, aName: nameOf(duelInfo.aId), bName: nameOf(duelInfo.bId) };
  broadcast({ t: "duelResult", result });
  showDuelResult(result);
  addWin(winner === "a" ? duelInfo.aId : winner === "b" ? duelInfo.bId : null);
}
function showDuelResult(result) {
  $("btn-vote-a").disabled = true; $("btn-vote-b").disabled = true;
  const { tally, winner, aName, bName } = result;
  $("duel-result").innerHTML = winner === "tie"
    ? `<div class="raterow">🤝 ${tt("Draw!", "Unentschieden!")} ${tally.a} : ${tally.b}</div>`
    : `<div class="raterow winner" style="border-color:var(--amber);box-shadow:0 0 16px rgba(255,201,92,.3)">🏆 <b>${esc(winner === "a" ? aName : bName)}</b> ${tt("wins the duel!", "gewinnt das Duell!")} (${tally.a} : ${tally.b})</div>`;
  status("duel-vote-status", "");
  if (isHost) $("btn-duel-back").style.display = "";
  SFX.done();
  if (winner !== "tie") burstConfetti();
}
$("btn-duel-back").onclick = () => {
  if (!isHost) return;
  duelInfo = null; duelStagedScene = null;
  Object.keys(duelSubs).forEach(k => delete duelSubs[k]);
  Object.keys(duelVotes).forEach(k => delete duelVotes[k]);
  broadcast({ t: "again" });
  backToLobby();
};

function collectTracks(role, items, ots, fromId) {
  if (role != null) collected.set(role, items);
  if (ots && ots.length && fromId != null) collectedOuttakes.set(fromId, ots);
  maybeFinishTracks();
}
function publishOuttakesPool() {
  const pool = [];
  for (const [, list] of collectedOuttakes) {
    for (const o of list) if (outtakeBufOk(o && o.buf)) pool.push(o);
  }
  // Exakte Doppelte raus — verschiedene Fehlversuche derselben Line bleiben
  const unique = dedupeOuttakes(pool);
  // Mischen, damit nicht immer derselbe Spieler zuerst kommt
  for (let i = unique.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = unique[i]; unique[i] = unique[j]; unique[j] = tmp;
  }
  // Kopien der Audio-Buffer — Broadcast darf lokale Outtakes nicht detach'en
  outtakes = unique.slice(0, OUTTAKE_POOL_MAX).map(o => {
    let buf = o.buf;
    try {
      if (buf instanceof ArrayBuffer) buf = buf.slice(0);
      else if (ArrayBuffer.isView(buf)) buf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    } catch {}
    return { ...o, buf };
  });
  collectedOuttakes.clear();
  outtakesCache = null;
  resolveOuttakesCachePending(null);
  updateOuttakesBtn();
  broadcast({ t: "outtakesPool", items: outtakes.map(o => {
    let buf = o.buf;
    try {
      if (buf instanceof ArrayBuffer) buf = buf.slice(0);
      else if (ArrayBuffer.isView(buf)) buf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    } catch {}
    return { lineIdx: o.lineIdx, text: o.text, t: o.t, end: o.end, name: o.name, uid: o.uid, buf };
  }) });
  scheduleOuttakesPrecache();
}
// Getrennt aufrufbar, damit auch ein Verbindungsabbruch die Premiere auslösen kann:
// wer weg ist, wird nicht mehr gebraucht — sonst wartet die Runde endlos auf seine Spur.
let forceMixTimer = null;
function maybeFinishTracks(force) {
  if (!isHost || !collected.size) return;
  const neededRoles = benoetigteRollen();
  // FRÜHER wurden nur die ANZAHLEN verglichen. Ging jemand mitten in der Aufnahme
  // raus, fiel seine Rolle aus dem Soll — und weil zufällig genauso viele fremde
  // Spuren schon dalagen, sprang die Premiere los, während andere noch sprachen.
  // Jetzt zählt, ob JEDE benötigte Rolle wirklich abgegeben hat.
  const fehlende = [...neededRoles].filter(r => !collected.has(r));
  if (!force && fehlende.length) {
    clearTimeout(forceMixTimer);
    forceMixTimer = setTimeout(syncForceMixBtn, 45000);   // Notausgang erst anbieten, wenn es wirklich hängt
    planeOfflineNachpruefung();
    return;
  }
  clearTimeout(forceMixTimer);
  const data = [...collected.entries()].map(([r, it]) => ({ role: r, items: it }));
  // WICHTIG: Mix ZUERST — Outtakes-Pool ist riesig und hat premGo bei Gästen oft blockiert
  publishMix(data);
  collected.clear();
  syncForceMixBtn();
  setTimeout(() => {
    try { publishOuttakesPool(); } catch (e) { console.warn("outtakes pool:", e); }
  }, 800);
}
// Notausgang für den Host, falls jemand hängt, ohne die Verbindung sauber zu schließen
function syncForceMixBtn() {
  const btn = $("btn-force-mix");
  if (!btn) return;
  // Button nur beim logischen Host; collected.size kennt nur der Raum-Besitzer —
  // deshalb zusätzlich State-Hinweis über wait-screen + Host-UI.
  const fehlen = [...benoetigteRollen()].filter(r => !collected.has(r));
  const waiting = iAmLogicalHost() && isHost && collected.size > 0 &&
    fehlen.length > 0 &&
    !!document.querySelector("#scr-wait.active");
  btn.style.display = waiting ? "" : "none";
}
$("btn-force-mix") && ($("btn-force-mix").onclick = () => {
  if (!iAmLogicalHost()) return;
  $("btn-force-mix").style.display = "none";
  status("wait-status", tt("🎬 Starting the premiere with the tracks we have …", "🎬 Starte die Premiere mit den vorhandenen Spuren …"));
  if (!isHost) { sendHost({ t: "hostCmd", cmd: "forceMix" }); return; }
  maybeFinishTracks(true);
});
function checkAllDone() { /* Fortschritt läuft über state-Broadcasts */ }

// ═════════════════════════════════════════════════════════════
// 9) PREMIERE — Web-Audio-Engine + Download
// ═════════════════════════════════════════════════════════════

// P2P-empfangene Binärdaten kommen je nach Browser als ArrayBuffer, TypedArray
// oder Blob an — decodeAudioData will exakt einen ArrayBuffer. Normalisieren:
async function toArrayBuffer(x) {
  if (x instanceof ArrayBuffer) return x.slice(0);
  if (ArrayBuffer.isView(x)) return x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength);
  if (x instanceof Blob) return await x.arrayBuffer();
  throw new Error("Unbekanntes Binärformat: " + Object.prototype.toString.call(x));
}

function reportPremLoad(pct, ready) {
  const p = Math.max(0, Math.min(100, pct | 0));
  const me = players.find(x => x.id === myId);
  if (me) {
    me.premPct = p;
    if (ready) me.prem = true;
  }
  renderPremState();
  if (isHost) broadcastState({ throttle: !ready });
  else sendHost({ t: "premProg", pct: p, ready: !!ready });
}

function waitCanPlayProgress(v, onProg, timeoutMs = 25000) {
  return new Promise(res => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(to);
      clearInterval(iv);
      v.removeEventListener("canplaythrough", finish);
      v.removeEventListener("canplay", finish);
      v.removeEventListener("progress", tick);
      if (onProg) onProg(100);
      res();
    };
    const tick = () => {
      if (!onProg || finished) return;
      try {
        if (v.buffered && v.buffered.length && v.duration && isFinite(v.duration) && v.duration > 0) {
          const end = v.buffered.end(v.buffered.length - 1);
          onProg(Math.min(99, Math.round((end / v.duration) * 100)));
        } else if (v.readyState >= 2) onProg(40);
        else if (v.readyState >= 1) onProg(15);
      } catch {}
    };
    if (v.readyState >= 3) { if (onProg) onProg(100); return res(); }
    const to = setTimeout(finish, timeoutMs);
    const iv = setInterval(tick, 200);
    v.addEventListener("canplaythrough", finish);
    v.addEventListener("canplay", finish);
    v.addEventListener("progress", tick);
    tick();
    try { v.load(); } catch {}
  });
}

let ambilightRAF = 0;
let ambilightOn = true;
let ambilightCanvasOk = true; // false → CSS-Projektor-Glow als Fallback (Opera/CORS)
try { ambilightOn = localStorage.getItem("ss_ambilight") !== "0"; } catch {}

function get2dContext(canvas) {
  if (!canvas) return null;
  // desynchronized kann in manchen Chromium/Opera-Builds null/kaputt liefern
  let ctx = null;
  try { ctx = canvas.getContext("2d", { alpha: true, desynchronized: true }); } catch {}
  if (!ctx) {
    try { ctx = canvas.getContext("2d", { alpha: true }); } catch {}
  }
  if (!ctx) {
    try { ctx = canvas.getContext("2d"); } catch {}
  }
  return ctx;
}
function stopAmbilight() {
  if (ambilightRAF) { cancelAnimationFrame(ambilightRAF); ambilightRAF = 0; }
}
function syncGlowBtn() {
  const btn = $("btn-cinema-glow");
  if (!btn) return;
  btn.classList.toggle("off", !ambilightOn);
  btn.setAttribute("aria-pressed", ambilightOn ? "true" : "false");
  btn.title = ambilightOn ? tt("Glow off", "Glow aus") : tt("Glow on", "Glow an");
}
function setCinemaGlowFallback(on) {
  document.body.classList.toggle("cinema-glow-fallback", !!on);
}
function setAmbilightEnabled(on) {
  ambilightOn = !!on;
  try { localStorage.setItem("ss_ambilight", ambilightOn ? "1" : "0"); } catch {}
  syncGlowBtn();
  document.body.classList.toggle("cinema-no-glow", !ambilightOn);
  if (!ambilightOn) setCinemaGlowFallback(false);
  if (!document.body.classList.contains("cinema")) return;
  if (ambilightOn) startAmbilight();
  else stopAmbilight();
}
function startAmbilight() {
  stopAmbilight();
  const v = $("play-video");
  const c = $("play-ambilight");
  if (!v || !c) {
    setCinemaGlowFallback(ambilightOn);
    return;
  }
  if (!ambilightOn) {
    document.body.classList.add("cinema-no-glow");
    setCinemaGlowFallback(false);
    return;
  }
  document.body.classList.remove("cinema-no-glow");
  // Ohne CORS-taugliche Quelle (oder bei Opera Battery Saver) Canvas oft tot —
  // dann bleibt der CSS-Projektor-Schein sichtbar.
  if (!ambilightCanvasOk) {
    setCinemaGlowFallback(true);
    return;
  }
  const ctx = get2dContext(c);
  if (!ctx) {
    ambilightCanvasOk = false;
    setCinemaGlowFallback(true);
    return;
  }
  setCinemaGlowFallback(false);
  let lastDraw = 0;
  let failStreak = 0;
  const tick = (now) => {
    ambilightRAF = requestAnimationFrame(tick);
    if (!document.body.classList.contains("cinema") || !ambilightOn) return;
    if (v.readyState < 2 || v.paused || v.ended) return;
    // ~20 fps reicht fürs Glow — spart CPU
    if (now - lastDraw < 50) return;
    lastDraw = now;
    const vw = v.videoWidth || 16, vh = v.videoHeight || 9;
    const w = 56;
    const h = Math.max(2, Math.round(w * vh / vw));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    try {
      ctx.drawImage(v, 0, 0, w, h);
      failStreak = 0;
    } catch {
      failStreak++;
      // CORS / tainted — nicht stumm aufgeben ohne Fallback
      if (failStreak >= 2) {
        ambilightCanvasOk = false;
        stopAmbilight();
        setCinemaGlowFallback(true);
      }
    }
  };
  ambilightRAF = requestAnimationFrame(tick);
}
function syncPpvToggleUi() {
  const panel = $("prem-player-vol");
  const btn = $("ppv-toggle");
  if (!panel || !btn) return;
  const open = panel.classList.contains("ppv-open");
  btn.setAttribute("aria-expanded", open ? "true" : "false");
  const chev = btn.querySelector(".ppv-chev");
  if (chev) chev.textContent = open ? "▾" : "▸";
}
function bindPremPlayerVolToggle() {
  const btn = $("ppv-toggle");
  if (!btn || premPlayerVolToggleBound) return;
  premPlayerVolToggleBound = true;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const panel = $("prem-player-vol");
    if (!panel || !panel.classList.contains("ppv-dock")) return;
    panel.classList.toggle("ppv-open");
    syncPpvToggleUi();
    try { SFX.click(); } catch {}
  });
}
function dockPremPlayerVolPanel(cinema) {
  const panel = $("prem-player-vol");
  if (!panel) return;
  bindPremPlayerVolToggle();
  try {
    if (cinema) {
      if (panel.parentElement !== document.body) document.body.appendChild(panel);
      // Neu in Kinosaal: zugeklappt, damit Emoji-Leiste frei bleibt
      if (!panel.classList.contains("ppv-dock")) panel.classList.remove("ppv-open");
      panel.classList.add("ppv-dock");
    } else {
      panel.classList.remove("ppv-dock", "ppv-open");
      const slot = $("prem-player-vol-slot");
      if (slot && panel.parentElement !== slot) slot.appendChild(panel);
    }
  } catch {}
  syncPpvToggleUi();
}
function enterCinemaMode() {
  document.body.classList.add("cinema");
  document.body.classList.toggle("cinema-no-glow", !ambilightOn);
  setCinemaGlowFallback(false);
  try { if ($("leave-btn")) $("leave-btn").style.pointerEvents = "none"; } catch {}
  // Bubbles/Profilbilder aus dem Hintergrund — sonst fliegen sie übers Video
  try { const f = document.getElementById("floaties"); if (f) f.style.display = "none"; } catch {}
  // Leiste + Mitspieler-Vol ans body (über Kinosaal-Leiste, sonst −/+ tot)
  try {
    const bar = $("cinema-vol");
    if (bar && bar.parentElement !== document.body) document.body.appendChild(bar);
  } catch {}
  dockPremPlayerVolPanel(true);
  syncCinemaVolSliders();
  syncGlowBtn();
  startAmbilight();
  renderPremPlayerVolPanel();
}
function exitCinemaMode() {
  document.body.classList.remove("cinema");
  document.body.classList.remove("cinema-no-glow");
  setCinemaGlowFallback(false);
  stopAmbilight();
  dockPremPlayerVolPanel(false);
  try { if ($("leave-btn")) $("leave-btn").style.pointerEvents = ""; } catch {}
  // Floaties wieder wie vom aktuellen Screen vorgesehen
  try {
    const calm = !!document.body.classList.contains("ingame");
    const f = document.getElementById("floaties");
    if (f) f.style.display = calm ? "none" : "";
  } catch {}
}
function bindCinemaGlowBtn() {
  const btn = $("btn-cinema-glow");
  if (!btn || btn._ssGlowBound) return;
  btn._ssGlowBound = true;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setAmbilightEnabled(!ambilightOn);
    try { SFX.click(); } catch {}
  });
}
bindCinemaGlowBtn();
syncGlowBtn();

async function loadMix(data, metaMsg) {
  if (!scene) {
    status("play-status", tt("⚠ Scene isn’t here yet — wait a moment or reload the page.", "⚠ Szene fehlt noch — kurz warten oder Seite neu laden."), true);
    return;
  }
  // PeerJS streicht Boost/Pan oft neben den Audio-Buffern — Maps / eigene Booth-Werte nachziehen
  if (metaMsg) attachMetaToTracks(data, metaMsg);
  applyLocalLineMeta(data);
  if (metaMsg && metaMsg.playerGains) ingestPremPlayerGains(metaMsg.playerGains);
  show("scr-playback");
  exitCinemaMode();
  status("play-status", tt("Decoding tracks …", "Dekodiere Spuren …"));
  invalidatePremCache();
  const me0 = players.find(x => x.id === myId);
  if (me0) { me0.prem = false; me0.premPct = 0; }
  armLoadReassure("prem");
  reportPremLoad(2, false);
  myPremLocalReady = false;
  const ctx = getCtx();
  mixItems = [];
  let okCount = 0, failCount = 0;
  // Alle Items zählen für Prozent beim Dekodieren
  let totalItems = 0;
  for (const track of data) totalItems += (track.items || []).length;
  let doneItems = 0;
  for (const track of data) {
    for (const item of track.items) {
      try {
        const ab = await toArrayBuffer(item.buf);
        mixItems.push({ role: track.role, startAt: item.startAt, lineIdx: item.idx, buffer: processTakeBuffer(ctx, await ctx.decodeAudioData(ab), item.gate, item.effect || (roleOf(track.role) || {}).effect, item.fxAmount), effect: item.effect, fxAmount: item.fxAmount, boost: item.boost, pan: item.pan });
        okCount++;
      } catch (e) { failCount++; console.warn("Spur kaputt:", track.role, e); }
      doneItems++;
      const decodePct = totalItems ? Math.round((doneItems / totalItems) * 45) : 45;
      reportPremLoad(Math.max(3, decodePct), false);
    }
  }
  console.log("Mix geladen:", okCount, "Spuren ok,", failCount, "fehlgeschlagen");
  if (failCount) status("play-status", "⚠ " + failCount + tt(" track(s) couldn’t load — F12 → Console.", " Spur(en) konnten nicht geladen werden — F12 → Console."), true);
  reportPremLoad(48, false);
  // Original-Stimmen für alle Lines, die KEIN Spieler eingesprochen hat
  // (unbesetzte Rollen + übersprungene Lines)
  if (scene.lines) {
    const hasIdx = data.some(t => t.items.some(i => i.idx != null));
    const coveredIdx = new Set();
    const playedRoles = new Set(data.map(t => t.role));
    data.forEach(t => t.items.forEach(i => { if (i.idx != null) coveredIdx.add(i.idx); }));
    for (let i = 0; i < scene.lines.length; i++) {
      const l = scene.lines[i];
      if (!lineHasOrig(l)) continue;
      const covered = hasIdx ? coveredIdx.has(i) : l.chars.some(c => playedRoles.has(c));
      if (covered) continue;
      try {
        const buffer = await getLineOrigBuffer(l);
        if (buffer) {
          mixItems.push({
            role: null, startAt: l.t, lineIdx: i, buffer,
            isOrig: true, origRoles: Array.isArray(l.chars) ? l.chars.slice() : []
          });
        }
      } catch { console.warn("Original fehlt für Line", i); }
    }
  }
  reportPremLoad(55, false);
  // Video KOMPLETT vorladen, damit die Premiere bei allen gleichzeitig & ruckelfrei startet
  const pv = $("play-video");
  // Neues Video → Ambilight erneut versuchen (vorheriger CORS-Fail gilt nicht mehr)
  ambilightCanvasOk = true;
  try {
    const src = sceneVideoSrc() || "";
    if (/^blob:/i.test(src)) pv.removeAttribute("crossorigin");
    else pv.setAttribute("crossorigin", "anonymous");
  } catch {}
  pv.src = sceneVideoSrc();
  attachPrompter(pv, $("play-prompter"), null);
  status("play-status", tt("⏳ Preloading video …", "⏳ Video wird vorgeladen …"));
  await waitCanPlayProgress(pv, pct => {
    // 55–99 % = Videopuffer
    reportPremLoad(55 + Math.round((pct / 100) * 44), false);
  }, 25000);
  reportPremLoad(100, true);
  clearLoadReassure("prem");
  myPremLocalReady = true;
  // Fertig geladen → beim Host melden
  $("btn-replay").disabled = true;
  $("btn-download").disabled = true;
  initPremOrigFromMix();
  renderPremPlayerVolPanel();
  updatePremAutoBalBtn();
  if (isHost) { broadcastState(); renderPremState(); broadcastPremOrig(); broadcastPremPlayerGains(); }
  else {
    sendHost({ t: "premReady" });
    status("play-status", tt("✅ Loaded — waiting for the host to start premiere …", "✅ Fertig geladen — warte, bis der Host die Premiere startet …"));
  }
  renderRedoPanel("redo-panel-prem");
  updateOuttakesBtn();
  SFX.ok();
  // Host hat schon auf Start gedrückt, während wir noch geladen haben
  if (!isHost && (pendingPremGo || premiereLocked)) {
    const alreadyPlaying = premiereLocked && document.querySelector("#scr-playback.active")
      && $("play-video") && !$("play-video").paused && !$("play-video").ended;
    pendingPremGo = false;
    if (!alreadyPlaying) premStart({ skipCountdown: true, grund: "Mix fertig geladen, premGo lag vor" });
  }
}

function renderPremStateGuest() { renderPremState(); }
function renderPremState() {
  const active = onlinePlayers();
  const total = active.length;
  const ready = active.filter(p => p.prem).length;
  const allReady = total > 0 && ready >= total;
  const pcts = active.map(p => p.prem ? 100 : Math.max(0, Math.min(100, p.premPct | 0)));
  const avg = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : 0;
  const bar = $("prem-bar");
  const label = $("prem-bar-label");
  const wrap = $("prem-load-wrap");
  if (bar) {
    bar.style.display = allReady ? "none" : "";
    const fill = bar.querySelector("i");
    if (fill) fill.style.width = (allReady ? 100 : Math.max(avg, 1)) + "%";
  }
  if (label) {
    label.style.display = allReady ? "none" : "";
    label.textContent = avg + "%";
  }
  if (wrap) wrap.style.display = allReady ? "none" : "";
  if (allReady) clearLoadReassure("prem");
  else if (!loadReassureTimers.prem) armLoadReassure("prem");
  const el = $("prem-status");
  if (el) {
    if (!total) el.textContent = tt("⏳ Preparing premiere …", "⏳ Premiere wird vorbereitet …");
    else if (allReady) {
      el.textContent = iAmLogicalHost()
        ? tt("✅ Everyone loaded (", "✅ Alle fertig geladen (") + ready + "/" + total + tt(") — you can start!", ") — du kannst starten!")
        : tt("✅ Everyone loaded — wait for the host!", "✅ Alle fertig geladen — warte auf den Host!");
    } else {
      const parts = active.map(p => {
        const pct = p.prem ? 100 : (p.premPct | 0);
        return p.name.replace(/\s*\(Host\)\s*/i, "") + " " + pct + "%";
      });
      el.textContent = tt("⏳ Premiere loading … ", "⏳ Premiere lädt … ") + parts.join(" · ");
    }
  }
  if (iAmLogicalHost()) {
    const btn = $("btn-prem-start");
    if (btn) {
      btn.style.display = "";
      btn.disabled = total > 0 && ready < total;
    }
  } else {
    const btn = $("btn-prem-start");
    if (btn) btn.style.display = "none";
  }
}

function isOrigItemAudible(item) {
  if (!item || !item.isOrig) return true;
  if (!premOrigOn) return false;
  const roles = item.origRoles || [];
  if (!roles.length) return true;
  return !roles.some(r => premOrigMuted.has(r));
}

function initPremOrigFromMix() {
  const map = new Map();
  for (const it of mixItems) {
    if (!it.isOrig || !it.origRoles) continue;
    for (const rid of it.origRoles) {
      if (map.has(rid)) continue;
      const role = roleOf(rid);
      map.set(rid, (role && role.name) || ("Rolle " + rid));
    }
  }
  premOrigUnfilled = [...map.entries()].map(([id, name]) => ({ id, name }));
  // Beim frischen Mix: Standard an, nichts stumm — außer Host hatte schon Einstellungen
  // (bei Gästen überschreibt applyPremOrigMsg danach)
  if (isHost) {
    premOrigOn = true;
    premOrigMuted = new Set();
  }
  renderPremOrigPanel();
}

function renderPremOrigPanel() {
  const panel = $("prem-orig-panel");
  const rolesEl = $("prem-orig-roles");
  const master = $("prem-orig-master");
  if (!panel || !rolesEl || !master) return;
  const hasOrig = premOrigUnfilled.length > 0;
  panel.style.display = hasOrig ? "" : "none";
  master.checked = premOrigOn;
  master.disabled = !iAmLogicalHost();
  rolesEl.innerHTML = "";
  for (const r of premOrigUnfilled) {
    const lab = document.createElement("label");
    lab.style.cssText = "display:flex;gap:6px;align-items:center;padding:4px 8px;border:1px solid var(--line);border-radius:8px;cursor:pointer;font-size:13px";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = premOrigOn && !premOrigMuted.has(r.id);
    cb.disabled = !iAmLogicalHost() || !premOrigOn;
    cb.dataset.roleId = String(r.id);
    cb.onchange = () => {
      if (!iAmLogicalHost()) return;
      const id = +cb.dataset.roleId;
      if (cb.checked) premOrigMuted.delete(id);
      else premOrigMuted.add(id);
      if (!isHost) {
        sendHost({ t: "hostCmd", cmd: "premOrig", on: premOrigOn, muted: [...premOrigMuted] });
        return;
      }
      broadcastPremOrig();
      invalidatePremCache();
    };
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(r.name));
    rolesEl.appendChild(lab);
  }
}

function broadcastPremOrig() {
  if (!isHost) return;
  broadcast({ t: "premOrig", on: !!premOrigOn, muted: [...premOrigMuted] });
}

function applyPremOrigMsg(msg) {
  premOrigOn = !!msg.on;
  premOrigMuted = new Set(Array.isArray(msg.muted) ? msg.muted : []);
  renderPremOrigPanel();
  if (!premiereLocked) invalidatePremCache();
}

/** Rollen-ID als stabile String-Key ("0","1",…) — Zahl und "1" treffen sich immer. */
function roleKey(role) {
  if (role == null || role === "") return null;
  const n = +role;
  if (!Number.isFinite(n)) return null;
  return String(n);
}
function normRoleId(role) {
  const k = roleKey(role);
  return k == null ? null : +k;
}
function clampPremPlayerGain(g) {
  const n = Number(g);
  if (!isFinite(n)) return 1;
  // 5 % … 300 %, in 5 %-Schritten
  return Math.max(0.05, Math.min(3, Math.round(n * 20) / 20));
}
/** Kompressor ausknipsen sobald jemand ≠100 % — sonst frisst er −/+ komplett. */
function tunePremCompForPlayerGains() {
  if (!premNodes || !premNodes.comp) return;
  let maxG = 1, minG = 1, tweaked = false;
  for (const g of Object.values(premPlayerGains)) {
    const n = Number(g);
    if (!isFinite(n)) continue;
    tweaked = true;
    if (n > maxG) maxG = n;
    if (n < minG) minG = n;
  }
  try {
    if (tweaked && (maxG > 1.02 || minG < 0.98)) {
      premNodes.comp.threshold.value = 0;
      premNodes.comp.knee.value = 0;
      premNodes.comp.ratio.value = 1;
      premNodes.comp.attack.value = 0.003;
      premNodes.comp.release.value = 0.1;
      return;
    }
    premNodes.comp.threshold.value = -18;
    premNodes.comp.knee.value = 20;
    premNodes.comp.ratio.value = 4;
    premNodes.comp.attack.value = 0.005;
    premNodes.comp.release.value = 0.15;
  } catch {}
}
function playerGainFor(role) {
  const k = roleKey(role);
  if (k == null) return 1;
  const g = premPlayerGains[k];
  return g == null ? 1 : clampPremPlayerGain(g);
}
function ingestPremPlayerGains(gains) {
  premPlayerGains = Object.create(null);
  if (!gains || typeof gains !== "object") return;
  for (const [k0, v] of Object.entries(gains)) {
    const k = roleKey(k0);
    if (k == null) continue;
    const g = clampPremPlayerGain(v);
    if (Math.abs(g - 1) > 0.001) premPlayerGains[k] = g;
  }
}
function clearPremPlayerGainNodes() {
  for (const g of premPlayerGainNodes.values()) {
    try { g.disconnect(); } catch {}
  }
  premPlayerGainNodes.clear();
}
function setGainParam(node, value) {
  if (!node || !node.gain) return;
  const v = Number(value);
  if (!isFinite(v)) return;
  try {
    const t = node.context ? node.context.currentTime : 0;
    node.gain.cancelScheduledValues(t);
    node.gain.setValueAtTime(v, t);
  } catch {
    try { node.gain.value = v; } catch {}
  }
}
function ensurePremPlayerGainNode(ctx, role, dest) {
  const k = roleKey(role);
  if (k == null) return dest;
  let g = premPlayerGainNodes.get(k);
  if (!g) {
    g = ctx.createGain();
    g.connect(dest);
    premPlayerGainNodes.set(k, g);
  }
  setGainParam(g, playerGainFor(k));
  return g;
}
function applyPremPlayerGainsLive() {
  for (const [k, node] of premPlayerGainNodes) {
    setGainParam(node, playerGainFor(k));
  }
  tunePremCompForPlayerGains();
}
function broadcastPremPlayerGains() {
  if (!isHost) return;
  broadcast({ t: "premPlayerVol", gains: Object.assign(Object.create(null), premPlayerGains) });
}
function applyPremPlayerGainsMsg(msg) {
  if (isHost) return;
  ingestPremPlayerGains(msg && msg.gains);
  applyPremPlayerGainsLive();
  renderPremPlayerVolPanel();
  schedulePremRecache();
}
function setPremPlayerGain(role, gain) {
  if (!isHost) return;
  const k = roleKey(role);
  if (k == null) return;
  const g = clampPremPlayerGain(gain);
  if (Math.abs(g - 1) < 0.001) delete premPlayerGains[k];
  else premPlayerGains[k] = g;
  applyPremPlayerGainsLive();
  // Anzeige sofort (ohne volles Rebuild), dann Broadcast
  const row = document.querySelector('#prem-player-vol-list .ppv-row[data-role="' + k + '"]');
  if (row) {
    const pct = Math.round(g * 100);
    const pctEl = row.querySelector(".ppv-pct");
    if (pctEl) { pctEl.textContent = pct + "%"; pctEl.title = "Aktuell " + pct + "% (max. 300 %)"; }
    const minus = row.querySelector('.ppv-btn[data-delta="-"]');
    const plus = row.querySelector('.ppv-btn[data-delta="+"]');
    if (minus) minus.disabled = g <= 0.05;
    if (plus) {
      plus.disabled = g >= 3;
      plus.title = g >= 3 ? "Schon maximal (300 %)" : "Lauter (bis 300 %)";
    }
  } else {
    renderPremPlayerVolPanel();
  }
  broadcastPremPlayerGains();
  schedulePremRecache();
}
function resetPremPlayerGains() {
  premPlayerGains = Object.create(null);
  premAutoBalance = false;
  clearPremPlayerGainNodes();
  tunePremCompForPlayerGains();
  const panel = $("prem-player-vol");
  if (panel) {
    panel.style.display = "none";
    panel.classList.remove("ppv-open");
    syncPpvToggleUi();
  }
  const list = $("prem-player-vol-list");
  if (list) list.innerHTML = "";
}
function bufferRms(buffer) {
  if (!buffer) return 0;
  let sum = 0, n = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) { const x = d[i]; sum += x * x; n++; }
  }
  return n ? Math.sqrt(sum / n) : 0;
}
/** Pro Rolle: gewichteter RMS über alle Voicelines (inkl. Booth-Boost). */
function computeRoleVoiceLevels() {
  const byRole = new Map();
  for (const item of mixItems) {
    if (item.isOrig || item.role == null || !item.buffer) continue;
    const k = roleKey(item.role);
    if (k == null) continue;
    let rms = bufferRms(item.buffer);
    const boost = item.boost != null && item.boost !== 1 ? item.boost : 1;
    rms *= boost;
    if (rms < 1e-7) continue;
    const dur = Math.max(0.001, item.buffer.duration || 0.001);
    if (!byRole.has(k)) byRole.set(k, { weighted: 0, dur: 0 });
    const e = byRole.get(k);
    e.weighted += rms * dur;
    e.dur += dur;
  }
  const levels = Object.create(null);
  for (const [k, e] of byRole) {
    if (e.dur > 0) levels[k] = e.weighted / e.dur;
  }
  return levels;
}
function applyAutoBalanceMix() {
  const levels = computeRoleVoiceLevels();
  const vals = Object.values(levels).filter(v => v > 1e-6).sort((a, b) => a - b);
  if (!vals.length) return { ok: false, reason: "empty" };
  const target = Math.max(vals[Math.floor(vals.length / 2)], 0.04);
  premPlayerGains = Object.create(null);
  let maxG = 1;
  for (const [k, rms] of Object.entries(levels)) {
    if (rms < 1e-6) continue;
    const g = clampPremPlayerGain(target / rms);
    if (Math.abs(g - 1) > 0.001) premPlayerGains[k] = g;
    if (g > maxG) maxG = g;
  }
  // Musik leicht ducken, damit Stimmen klar vorne bleiben — abhängig von gemessener Lautstärke
  premVol.voice = 1;
  premVol.video = target > 0.11 || maxG > 1.35 ? 0.68 : target < 0.055 ? 0.88 : 0.78;
  applyPremVol();
  syncAllPremVolSliders();
  applyPremPlayerGainsLive();
  return { ok: true, target, maxG, roles: Object.keys(levels).length };
}
function updatePremAutoBalBtn() {
  const btn = $("btn-prem-autobal");
  if (!btn) return;
  const show = isHost && mixItems.length > 0 && !!document.querySelector("#scr-playback.active");
  btn.style.display = show ? "" : "none";
  btn.classList.toggle("primary", premAutoBalance);
  btn.setAttribute("aria-pressed", premAutoBalance ? "true" : "false");
  btn.textContent = premAutoBalance ? t("prem.autobal.on") : t("prem.autobal");
}
function setPremAutoBalance(on) {
  if (!isHost) return;
  premAutoBalance = !!on;
  if (premAutoBalance) {
    const r = applyAutoBalanceMix();
    if (!r.ok) {
      premAutoBalance = false;
      status("play-status", tt("No voice tracks to balance yet.", "Noch keine Stimmen zum Ausgleichen."), true);
      updatePremAutoBalBtn();
      return;
    }
    status("play-status", tt("🎚 Auto-balance on — voices matched, music ducked to ", "🎚 Auto-Ausgleich an — Stimmen angeglichen, Musik auf ") + Math.round(premVol.video * 100) + "%");
  } else {
    premPlayerGains = Object.create(null);
    applyPremPlayerGainsLive();
    status("play-status", tt("🎚 Auto-balance off — everyone back to 100%.", "🎚 Auto-Ausgleich aus — alle wieder bei 100 %."));
  }
  updatePremAutoBalBtn();
  renderPremPlayerVolPanel();
  broadcastPremAutoBalance();
  schedulePremRecache();
}
function broadcastPremAutoBalance() {
  if (!isHost) return;
  broadcast({
    t: "premAutoBal",
    on: premAutoBalance,
    gains: Object.assign(Object.create(null), premPlayerGains),
    vol: { master: premVol.master, voice: premVol.voice, video: premVol.video }
  });
}
function applyPremAutoBalMsg(msg) {
  if (isHost) return;
  premAutoBalance = !!(msg && msg.on);
  ingestPremPlayerGains(msg && msg.gains);
  if (msg && msg.vol) {
    if (msg.vol.master != null) premVol.master = msg.vol.master;
    if (msg.vol.voice != null) premVol.voice = msg.vol.voice;
    if (msg.vol.video != null) premVol.video = msg.vol.video;
    applyPremVol();
    syncAllPremVolSliders();
  }
  applyPremPlayerGainsLive();
  updatePremAutoBalBtn();
  renderPremPlayerVolPanel();
  schedulePremRecache();
}
function rolesInPremMix() {
  const roles = new Set();
  for (const it of mixItems) {
    const k = it && !it.isOrig ? roleKey(it.role) : null;
    if (k != null) roles.add(k);
  }
  return roles;
}
function bindPremPlayerVolClicks() {
  const list = $("prem-player-vol-list");
  if (!list || premPlayerVolBound) return;
  premPlayerVolBound = true;
  // Delegation: überlebt Re-Render, kein stopPropagation-Konflikt mit Kinosaal
  list.addEventListener("pointerup", (e) => {
    const btn = e.target && e.target.closest ? e.target.closest(".ppv-btn") : null;
    if (!btn || btn.disabled || !list.contains(btn)) return;
    e.preventDefault();
    e.stopPropagation();
    const row = btn.closest(".ppv-row");
    const k = row && row.dataset.role;
    if (k == null || !isHost) return;
    const delta = btn.dataset.delta === "+" ? 0.1 : -0.1;
    try { SFX.click(); } catch {}
    setPremPlayerGain(k, playerGainFor(k) + delta);
  });
}
function renderPremPlayerVolPanel() {
  const panel = $("prem-player-vol");
  const list = $("prem-player-vol-list");
  if (!panel || !list) return;
  bindPremPlayerVolClicks();
  dockPremPlayerVolPanel(document.body.classList.contains("cinema"));
  // Nur Host sieht die Knöpfe — Gäste bekommen die Werte per Broadcast
  if (!isHost) {
    panel.style.display = "none";
    list.innerHTML = "";
    return;
  }
  const roles = rolesInPremMix();
  const rows = players.filter(p => {
    const k = roleKey(p.role);
    return k != null && roles.has(k);
  });
  if (!rows.length) {
    panel.style.display = "none";
    list.innerHTML = "";
    updatePremAutoBalBtn();
    return;
  }
  panel.style.display = "";
  list.innerHTML = "";
  for (const p of rows) {
    const k = roleKey(p.role);
    const g = playerGainFor(k);
    const pct = Math.round(g * 100);
    const row = document.createElement("div");
    row.className = "ppv-row";
    row.dataset.role = k;
    const avWrap = document.createElement("div");
    avWrap.innerHTML = avatarHTML(p);
    const avNode = avWrap.firstElementChild;
    if (avNode) row.appendChild(avNode);
    const name = document.createElement("span");
    name.className = "ppv-name";
    name.textContent = stripHostTag(p.name || "?");
    name.title = name.textContent;
    const minus = document.createElement("button");
    minus.type = "button";
    minus.className = "ppv-btn";
    minus.dataset.delta = "-";
    minus.textContent = "−";
    minus.title = "Leiser";
    minus.disabled = g <= 0.05;
    const pctEl = document.createElement("span");
    pctEl.className = "ppv-pct";
    pctEl.textContent = pct + "%";
    pctEl.title = "Aktuell " + pct + "% (max. 300 %)";
    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "ppv-btn";
    plus.dataset.delta = "+";
    plus.textContent = "+";
    plus.title = g >= 3 ? "Schon maximal (300 %)" : "Lauter (bis 300 %)";
    plus.disabled = g >= 3;
    row.appendChild(name);
    row.appendChild(minus);
    row.appendChild(pctEl);
    row.appendChild(plus);
    list.appendChild(row);
  }
  updatePremAutoBalBtn();
}

function updatePremPauseBtn() {
  const btn = $("btn-prem-pause");
  if (!btn) return;
  const v = $("play-video");
  const laeuft = premiereLocked && aktuellePhase() === "scr-playback" && v && !v.ended;
  if (!iAmLogicalHost() || !laeuft) {
    btn.style.display = "none";
    return;
  }
  btn.style.display = "";
  btn.textContent = premPaused ? "▶ Weiter für alle" : "⏸ Pause für alle";
}

function premPauseAll(fromHostClick, syncT) {
  premPaused = true;
  invalidatePremCache();
  const v = $("play-video");
  try {
    if (v && typeof syncT === "number" && isFinite(syncT)) v.currentTime = syncT;
    if (v) v.pause();
  } catch {}
  try { if (audioCtx && audioCtx.state === "running") audioCtx.suspend(); } catch {}
  updatePremPauseBtn();
  if (fromHostClick && isHost) {
    const tVideo = v && isFinite(v.currentTime) ? v.currentTime : 0;
    broadcast({ t: "premPause", tVideo });
  }
  status("play-status", "⏸ Pause");
}

function premResumeAll(fromHostClick, syncT) {
  premPaused = false;
  const ctx = getCtx();
  const v = $("play-video");
  try {
    if (v && typeof syncT === "number" && isFinite(syncT)) v.currentTime = syncT;
  } catch {}
  Promise.resolve(ctx.resume()).catch(() => {}).then(() => {
    try { if (v && v.paused && !v.ended) v.play(); } catch {}
  });
  updatePremPauseBtn();
  if (fromHostClick && isHost) {
    const tVideo = v && isFinite(v.currentTime) ? v.currentTime : 0;
    broadcast({ t: "premResume", tVideo });
  }
  status("play-status", "🍿 Premiere!");
}

function premStart(opts) {
  // Diagnose: Connor startete einmal, waehrend alle anderen noch luden. Der Weg
  // dorthin laesst sich nur am lebenden System unterscheiden — deshalb festhalten,
  // WER wodurch gestartet ist. Steht in der Browser-Konsole (F12).
  try {
    console.info("[Premiere-Start]", {
      weg: (opts && opts.grund) || "premGo",
      istHost: !!isHost,
      spuren: mixItems.length,
      andereNochAmLaden: onlinePlayers().filter(p => !p.prem).map(p => p.name),
      zeit: new Date().toISOString()
    });
  } catch {}
  pendingPremGo = false;
  myPremLocalReady = myPremLocalReady || mixItems.length > 0;
  premiereLocked = true;
  premPaused = false;
  renderRedoPanel("redo-panel-wait"); renderRedoPanel("redo-panel-prem");
  pendingRate = true;
  $("btn-replay").disabled = false;
  $("btn-download").disabled = false;
  $("btn-prem-start") && ($("btn-prem-start").style.display = "none");
  status("play-status", "🍿 Premiere!");
  updateOuttakesBtn();
  updatePremPauseBtn();
  enterCinemaMode();
  // Zahlen-Countdown — weiße Balken nur in der Booth, nie hier
  // Rejoin mitten in der Premiere: ohne Countdown sofort starten
  if (opts && opts.skipCountdown) playMix(false);
  else countdown({ wipe: false }).then(() => playMix(false));
  if (isHost) broadcastState();
}

/** Gast: premGo reliable verarbeiten (auch wenn Mix noch lädt). */
function onPremGoMsg(msg) {
  if (isHost) return;
  if (mixItems.length && $("play-video") && ($("play-video").src || sceneVideoSrc())) {
    if (premiereLocked && document.querySelector("#scr-playback.active") && !$("play-video").paused && !$("play-video").ended) {
      return; // läuft schon
    }
    premStart({ skipCountdown: !!(msg && msg.skipCountdown) });
    return;
  }
  pendingPremGo = true;
  status("play-status", tt("🍿 Host started — finishing load, then we join …", "🍿 Host hat gestartet — Lade fertig, dann geht’s los …"));
}

/** Gast: Host hat laut State schon Premiere an — mitziehen, falls premGo untergegangen ist. */
function tryFollowHostPremiere(paused) {
  if (isHost) return;
  if (premiereLocked && document.querySelector("#scr-playback.active")) {
    if (paused && !premPaused) premPauseAll(false);
    else if (!paused && premPaused) premResumeAll(false);
    return;
  }
  if (!mixItems.length) {
    pendingPremGo = true;
    premiereLocked = true; // merken, bis loadMix fertig
    return;
  }
  premStart({ skipCountdown: true, grund: "Host-Zustand (premiereLocked)" });
  if (paused) setTimeout(() => premPauseAll(false), 50);
}

function broadcastPremGoReliable() {
  const payload = { t: "premGo", skipCountdown: false };
  broadcast(payload);
  // Nochmal nachschicken — DataChannel kann nach großem Mix noch voll sein
  clearTimeout(premGoRetryTimer);
  let n = 0;
  const tick = () => {
    n++;
    broadcast({ t: "premGo", skipCountdown: true });
    broadcastState(); // premiereLocked mitschicken
    if (n < 4) premGoRetryTimer = setTimeout(tick, 700 * n);
  };
  premGoRetryTimer = setTimeout(tick, 400);
}

$("btn-prem-start").onclick = () => {
  if (!iAmLogicalHost()) return;
  if (!isHost) { sendHost({ t: "hostCmd", cmd: "premGo" }); return; }
  premiereLocked = true;
  broadcastPremGoReliable();
  premStart();
};
$("btn-prem-pause") && ($("btn-prem-pause").onclick = () => {
  if (!iAmLogicalHost() || !premiereLocked) return;
  if (!isHost) { sendHost({ t: "hostCmd", cmd: "premPause" }); return; }
  if (premPaused) premResumeAll(true);
  else premPauseAll(true);
});
$("prem-orig-master") && ($("prem-orig-master").onchange = () => {
  if (!iAmLogicalHost()) return;
  premOrigOn = !!$("prem-orig-master").checked;
  if (!isHost) {
    sendHost({ t: "hostCmd", cmd: "premOrig", on: premOrigOn });
    renderPremOrigPanel();
    return;
  }
  renderPremOrigPanel();
  broadcastPremOrig();
  invalidatePremCache();
});
$("btn-replay").onclick = () => {
  invalidatePremCache();
  if (iAmLogicalHost()) {
    if (!isHost) sendHost({ t: "hostCmd", cmd: "premReplay" });
    else broadcast({ t: "premReplay" });
  }
  playMix(false);
};
$("btn-download").onclick = () => downloadPremiere();
$("btn-download-audio").onclick = () => exportAudioFast();

const elemSrcMap = new Map();
function elementSource(ctx, v) {
  if (!elemSrcMap.has(v)) elemSrcMap.set(v, ctx.createMediaElementSource(v));
  return elemSrcMap.get(v);
}


// Ein einziger, dauerhafter Audio-Graph für die Premiere.
// (Vorher wurde pro "Nochmal abspielen" ein neuer Kompressor gebaut und der
//  Video-Ton blieb mit ALLEN alten verbunden → wurde immer lauter. Gefixt.)
let premNodes = null;
const premVol = { master: 1, voice: 1, video: 1 };
function premGraph(ctx, v) {
  if (!premNodes) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 20;
    comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.15;
    const masterGain = ctx.createGain();
    const voiceGain = ctx.createGain();
    const vidGain = ctx.createGain();
    const hearGain = ctx.createGain();
    voiceGain.connect(comp); vidGain.connect(comp);
    comp.connect(masterGain); masterGain.connect(hearGain); hearGain.connect(ctx.destination);
    elementSource(ctx, v).connect(vidGain);
    premNodes = { comp, masterGain, voiceGain, vidGain, hearGain };
    applyPremVol();
  }
  return premNodes;
}
function applyPremVol() {
  if (!premNodes) return;
  premNodes.masterGain.gain.value = premVol.master;
  premNodes.voiceGain.gain.value = premVol.voice;
  premNodes.vidGain.gain.value = premVol.video;
  tunePremCompForPlayerGains();
}


// ── WAV-Encoder (reines JS, keine Bibliothek nötig) ──
function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const blockAlign = numChannels * 2;
  const dataSize = numFrames * blockAlign;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
  writeStr(0, "RIFF"); view.setUint32(4, 36 + dataSize, true); writeStr(8, "WAVE");
  writeStr(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); view.setUint16(32, blockAlign, true); view.setUint16(34, 16, true);
  writeStr(36, "data"); view.setUint32(40, dataSize, true);
  const channels = []; for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }
  }
  return new Blob([buf], { type: "audio/wav" });
}

// ── Schneller Ton-Export: rendert den kompletten Mix OHNE Echtzeit-Warten ──
async function exportAudioFast() {
  try {
    status("play-status", tt("⚡ Rendering audio … (only takes seconds, no need to watch)", "⚡ Rendere Ton … (dauert nur Sekunden, kein Zuschauen nötig)"));
    const OfflineCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const fromLines = scene?.lines?.length ? Math.max(...scene.lines.map(l => l.end)) : 0;
    const fromMix = mixItems.length ? Math.max(...mixItems.map(i => i.startAt + (i.buffer?.duration || 0))) : 0;
    const fromVid = $("play-video")?.duration || 0;
    const lastEnd = Math.max(1, fromLines, fromMix, fromVid) + 1.5;
    const offlineCtx = new OfflineCtor(2, Math.ceil(lastEnd * 44100), 44100);

    const master = offlineCtx.createDynamicsCompressor();
    master.threshold.value = -18; master.knee.value = 20; master.ratio.value = 4; master.attack.value = 0.005; master.release.value = 0.15;
    master.connect(offlineCtx.destination);

    // Video-eigene Tonspur (Musik/SFX) mit reinrechnen
    try {
      const videoBuf = await (await fetch(sceneVideoSrc())).arrayBuffer();
      const videoAudio = await offlineCtx.decodeAudioData(videoBuf.slice(0));
      const vSrc = offlineCtx.createBufferSource();
      vSrc.buffer = videoAudio;
      vSrc.connect(master);
      vSrc.start(0);
    } catch (e) { console.warn("Video-Ton nicht verfügbar für Offline-Export:", e); }

    for (const item of mixItems) {
      if (item.isOrig && !isOrigItemAudible(item)) continue;
      let role = item.role != null ? (roleOf(item.role) || { pan: 0, effect: "none", gain: 1 }) : { pan: 0, effect: "none", gain: 1 };
      if (scene.lines && item.lineIdx != null) role = effectiveRole(role, scene.lines[item.lineIdx]);
      if (item.effect) role = { ...role, effect: item.effect };
      if (item.fxAmount !== undefined) role = { ...role, fxAmount: item.fxAmount };
      if (item.boost != null && item.boost !== 1) role = { ...role, gain: (role.gain ?? 1) * item.boost };
      // Host-Mitspieler-Lautstärke auch im schnellen Ton-Export
      if (!item.isOrig && item.role != null) {
        const pg = playerGainFor(item.role);
        if (pg !== 1) role = { ...role, gain: (role.gain ?? 1) * pg };
      }
      if (!item.isOrig) role = { ...role, pan: item.pan != null ? item.pan : 0 };
      else if (item.pan != null) role = { ...role, pan: item.pan };
      const src = offlineCtx.createBufferSource();
      src.buffer = item.buffer;
      const rate = effectPitch(role.effect);
      src.playbackRate.value = rate;
      src.connect(buildChain(offlineCtx, role, master));
      let maxDur = item.buffer.duration;
      if (scene.lines && item.lineIdx != null) {
        const l = scene.lines[item.lineIdx];
        const cutoffT = nextSameRoleStart(item.lineIdx);
        // Fensterlaenge in ECHTZEIT
        const windowSec = ((cutoffT != null ? cutoffT : l.end + 0.8) - l.t) + 0.25;
        // start(when, offset, duration) erwartet die Dauer im QUELLMATERIAL.
        // Bei verlangsamter Wiedergabe (Monster/Titan) dauert dieselbe Quell-Laenge
        // entsprechend laenger -- deshalb mit der Rate umrechnen, sonst laeuft die
        // Stimme in die naechste Line hinein.
        maxDur = Math.min(maxDur, windowSec * rate);
      }
      const when = Math.max(0, item.startAt + syncOffsetMs / 1000);
      src.start(when, 0, maxDur);
    }

    const rendered = await offlineCtx.startRendering();
    const blob = audioBufferToWav(rendered);
    const wie = await saveBlob(blob, (scene?.id || "synchro") + "_ton.wav");
    if (wie === "abort") { status("play-status", tt("Save cancelled.", "Speichern abgebrochen.")); return; }
    status("play-status", tt("✅ Audio saved (WAV, instant)! Just drop it on the video track in CapCut/Premiere/AE.", "✅ Ton gespeichert (WAV, sofort)! Einfach auf die Videospur in CapCut/Premiere/AE ziehen."));
    SFX.done();
  } catch (e) {
    console.error("Schneller Ton-Export fehlgeschlagen:", e);
    status("play-status", tt("❌ Audio export failed — F12 console for details.", "❌ Ton-Export hat nicht geklappt — F12-Konsole für Details."), true);
  }
}

// Bestes Videoformat, das dieser Browser aufnehmen kann. MP4 hat Vorrang, weil man das
// ohne Umwandeln bei TikTok, Insta und WhatsApp hochladen kann.
function videoMime() {
  const kandidaten = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const m of kandidaten) if (MediaRecorder.isTypeSupported(m)) return m;
  return "video/webm";
}

/**
 * Chromium-MediaRecorder schreibt oft keine Duration in WebM (besonders mit timeslice).
 * Windows-Player zeigt dann aktuelle Zeit, aber keine Gesamtlänge — obwohl das Video
 * bis zum Ende spielt. WebM: Duration-Element nachtragen. MP4: unverändert zurück.
 * @param {Blob} blob
 * @param {number} durationSec Dauer in Sekunden
 */
async function withRecordedDuration(blob, durationSec) {
  if (!blob || blob.size < 100) return blob;
  const sec = Number(durationSec);
  if (!(sec > 0) || !isFinite(sec)) return blob;
  const type = String(blob.type || "").toLowerCase();
  if (!type.includes("webm")) return blob;
  const fix = typeof ysFixWebmDuration === "function" ? ysFixWebmDuration
    : (typeof window !== "undefined" && typeof window.ysFixWebmDuration === "function" ? window.ysFixWebmDuration : null);
  if (!fix) return blob;
  try {
    const ms = Math.max(1, Math.round(sec * 1000));
    const out = await fix(blob, ms, { logger: false });
    return out || blob;
  } catch (e) {
    console.warn("WebM-Duration-Fix:", e);
    return blob;
  }
}

/** MediaRecorder starten — ohne timeslice, damit Duration-Metadaten eher geschrieben werden.
 *  Fallback mit timeslice, falls start() ohne Argumente scheitert. */
function startMediaRecorder(rec, timesliceFallbackMs) {
  try {
    rec.start();
    return "once";
  } catch (e) {
    console.warn("MediaRecorder.start() ohne timeslice fehlgeschlagen, Fallback:", e);
    try {
      rec.start(timesliceFallbackMs || 1000);
      return "timeslice";
    } catch (e2) {
      console.warn("MediaRecorder.start Fallback fehlgeschlagen:", e2);
      return null;
    }
  }
}

const OUTTAKES_SITE = "synchron-studio.github.io/synchronstudio/";
/** Aktuelle Zeile für Canvas-Export (wird pro Clip gesetzt). */
let outtakesOverlayLine = "";

/** Zeile auf max. 2 Zeilen kürzen (Ellipsis) — für Canvas-Overlay. */
function wrapOuttakeCaption(g2, text, maxW, maxLines) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return [];
  const words = raw.split(" ");
  const lines = [];
  let cur = "";
  for (let i = 0; i < words.length; i++) {
    const next = cur ? cur + " " + words[i] : words[i];
    if (g2.measureText(next).width <= maxW) { cur = next; continue; }
    if (cur) lines.push(cur);
    cur = words[i];
    if (lines.length >= maxLines) { cur = ""; break; }
    // Einzelwort zu lang → hart kürzen
    while (cur && g2.measureText(cur).width > maxW) cur = cur.slice(0, -1);
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  // Rest → Ellipsis auf letzter Zeile
  const used = lines.join(" ").length;
  if (used < raw.length && lines.length) {
    let last = lines[lines.length - 1];
    while (last.length > 1 && g2.measureText(last + "…").width > maxW) last = last.slice(0, -1);
    lines[lines.length - 1] = last + "…";
  }
  return lines.slice(0, maxLines);
}

/** OUTTAKES + Zeilentext + Site-URL — dezent, Ecken (Canvas-Export). */
function drawOuttakesBadge(g2, w, h, lineText) {
  if (!g2 || !w || !h) return;
  const padX = Math.round(w * 0.02);
  const padY = Math.round(h * 0.03);
  const badgeSize = Math.max(14, Math.round(Math.min(w, h) * 0.035));

  g2.save();
  // OUTTAKES oben links
  g2.font = "700 " + badgeSize + "px Anton, Impact, sans-serif";
  g2.textBaseline = "top";
  g2.letterSpacing = "0.12em";
  g2.lineWidth = Math.max(2, Math.round(badgeSize / 6));
  g2.strokeStyle = "rgba(0,0,0,.85)";
  g2.fillStyle = "#e63946";
  try { g2.strokeText("OUTTAKES", padX, padY); } catch {}
  try { g2.fillText("OUTTAKES", padX, padY); } catch {}

  // Site-URL unten rechts (ohne https://)
  const siteSize = Math.max(10, Math.round(Math.min(w, h) * 0.018));
  g2.font = "500 " + siteSize + "px \"Space Mono\", monospace";
  g2.letterSpacing = "0";
  g2.textAlign = "right";
  g2.textBaseline = "bottom";
  g2.fillStyle = "rgba(220,220,228,.38)";
  g2.shadowColor = "rgba(0,0,0,.75)";
  g2.shadowBlur = 3;
  try { g2.fillText(OUTTAKES_SITE, w - padX, h - padY); } catch {}

  // Gesprochene Zeile unten links (max. 2 Zeilen)
  const caption = String(lineText != null ? lineText : outtakesOverlayLine || "").trim();
  if (caption) {
    const capSize = Math.max(12, Math.round(Math.min(w, h) * 0.028));
    const maxW = w - padX * 2;
    const siteReserve = siteSize * 1.8;
    g2.shadowBlur = 4;
    g2.font = "500 " + capSize + "px Barlow, sans-serif";
    g2.textAlign = "left";
    g2.textBaseline = "bottom";
    g2.fillStyle = "rgba(245,245,248,.68)";
    const lines = wrapOuttakeCaption(g2, "„" + caption + "“", maxW, 2);
    const lineH = Math.round(capSize * 1.25);
    let y = h - padY - siteReserve - (lines.length - 1) * lineH;
    for (const ln of lines) {
      try { g2.fillText(ln, padX, y); } catch {}
      y += lineH;
    }
  }
  g2.restore();
}

// Malt das laufende Video fortlaufend auf eine Leinwand und gibt einen Bildstrom davon
// zurück. requestVideoFrameCallback trifft genau die echten Videobilder; where es das nicht
// gibt (oder Outtakes mit Pause/Seek), alwaysRaf: Dauer-RAF damit MediaRecorder nicht
// nur Ton speichert.
// opts.lockW/lockH: feste Export-Größe (Outtakes); Übergang wird cover-fit hinein gemalt.
function frameSource(v, opts) {
  const alwaysRaf = !!(opts && opts.alwaysRaf);
  const outtakesBadge = !!(opts && opts.outtakesBadge);
  const lockW = (opts && opts.lockW) || 0;
  const lockH = (opts && opts.lockH) || 0;
  const c = document.createElement("canvas");
  c.width = lockW || v.videoWidth || 1280;
  c.height = lockH || v.videoHeight || 720;
  const g2 = c.getContext("2d", { alpha: false, desynchronized: true });
  let laeuft = true, bilder = 0, rafId = null;

  const malen = () => {
    if (!laeuft) return;
    if (!lockW && v.videoWidth && (c.width !== v.videoWidth || c.height !== v.videoHeight)) {
      c.width = v.videoWidth; c.height = v.videoHeight;
    }
    try {
      // WICHTIG: Rauschen nur auf Outtakes-Canvas (outtakesBadge).
      // Premiere nutzt dieselbe frameSource — global outtakesDrawTrans darf dort NIE greifen,
      // sonst landet TV-Rauschen zwischen den Lines im Original-Mix.
      if (outtakesBadge && outtakesDrawTrans) {
        drawTvStatic(g2, c.width, c.height);
        drawOuttakesBadge(g2, c.width, c.height, "");
        bilder++;
      } else if (v.readyState >= 2) {
        g2.drawImage(v, 0, 0, c.width, c.height);
        if (outtakesBadge) drawOuttakesBadge(g2, c.width, c.height, outtakesOverlayLine);
        bilder++;
      }
    } catch {}
  };
  // Outtakes: immer RAF — bei Pause/Seek liefert rVFC keine Frames → Datei ohne Bild
  if (!alwaysRaf && typeof v.requestVideoFrameCallback === "function") {
    const schritt = () => { if (!laeuft) return; malen(); v.requestVideoFrameCallback(schritt); };
    v.requestVideoFrameCallback(schritt);
  } else {
    const schritt = () => { if (!laeuft) return; malen(); rafId = requestAnimationFrame(schritt); };
    rafId = requestAnimationFrame(schritt);
  }
  malen();   // erstes Bild sofort, damit der Strom nicht schwarz anfängt

  return {
    stream: c.captureStream(30),
    count: () => bilder,
    paint: malen,
    stop: () => { laeuft = false; if (rafId) cancelAnimationFrame(rafId); }
  };
}
// Outtakes: WebM bevorzugen — MP4-Encoder droppt bei Canvas-Capture oft die Bildspur
function outtakesMime() {
  const kandidaten = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
  ];
  for (const m of kandidaten) if (MediaRecorder.isTypeSupported(m)) return m;
  return "video/webm";
}

// Beim ersten Anschauen der Premiere wird das fertige Video schon mitgeschnitten.
// Danach ist „Speichern“ sofort fertig — niemand muss die Szene nochmal durchsitzen.
let premCache = null;          // { blob, endung, volSig, fps }
let premCachePending = null;   // Promise → premCache, solange gerade mitgeschnitten wird
let premCacheResolve = null;   // Resolver zum sauberen Abbrechen
let premCacheGen = 0;          // Generation — veraltete Mitschnitte nicht übernehmen
let premCacheDirty = false;    // Lautstärke/Sync geändert — alter Cache ggf. veraltet
let premActiveRecorder = null; // laufender MediaRecorder (zum sauberen Stoppen)
let premRecacheTimer = null;
let premWakeLock = null;
function premVolSig() {
  return JSON.stringify(premVol) + "|" + syncOffsetMs + "|" + JSON.stringify(premPlayerGains);
}
function premCacheReady(c) {
  return !!(c && c.blob && c.blob.size > 1000);
}
function stopPremRecorder() {
  const rec = premActiveRecorder;
  premActiveRecorder = null;
  if (rec && rec.state !== "inactive") {
    try { rec.stop(); } catch {}
  }
}
function invalidatePremCache() {
  clearTimeout(premRecacheTimer);
  premRecacheTimer = null;
  premCache = null;
  premCacheDirty = false;
  premCacheGen++;              // laufende Recorder werden beim Stop irrelevant
  stopPremRecorder();
  if (premCacheResolve) {
    const r = premCacheResolve;
    premCacheResolve = null;
    premCachePending = null;
    try { r(null); } catch {}
  } else {
    premCachePending = null;
  }
  updateDownloadBtnLabel();
}
function updateDownloadBtnLabel() {
  const btn = $("btn-download");
  if (!btn) return;
  if (premCachePending) {
    btn.textContent = tt("⬇ Save video (still cutting …)", "⬇ Video speichern (schneidet noch …)");
    btn.title = tt("Capture from first watch is running — click waits briefly, then finishes", "Mitschnitt vom ersten Anschauen läuft — Klick wartet kurz, dann sofort fertig");
  } else if (premCacheReady(premCache) && !premCacheDirty && premCache.volSig === premVolSig()) {
    btn.textContent = tt("⬇ Save now (ready!)", "⬇ Sofort speichern (fertig!)");
    btn.title = tt("Already captured on first watch — download starts immediately (also after outtakes)", "Schon beim ersten Anschauen mitgeschnitten — Download startet sofort (auch nach Outtakes)");
  } else if (premCacheReady(premCache)) {
    // Dirty / Lautstärke geändert: trotzdem Sofort-Save vom Anschauen — kein erneutes Durchsitzen
    btn.textContent = tt("⬇ Save now (as watched)", "⬇ Sofort speichern (wie angeschaut)");
    btn.title = tt("Saves the capture from watching immediately. For new volume: replay, then save.", "Speichert den Mitschnitt vom Anschauen sofort. Für neue Lautstärke: „Nochmal abspielen“, dann speichern.");
  } else {
    btn.textContent = tt("⬇ Save full video", "⬇ Komplettes Video speichern");
    btn.title = tt("Cuts once in the background (please keep the window open)", "Schneidet einmal im Hintergrund (Fenster bitte offen lassen)");
  }
}
async function holdPremWakeLock() {
  try {
    if (premWakeLock) return;
    if (navigator.wakeLock && navigator.wakeLock.request) {
      premWakeLock = await navigator.wakeLock.request("screen");
      premWakeLock.addEventListener("release", () => { premWakeLock = null; });
    }
  } catch {}
}
function releasePremWakeLock() {
  try { if (premWakeLock) premWakeLock.release(); } catch {}
  premWakeLock = null;
}
// Lautstärke/Sync geändert: Cache als veraltet markieren — aber NICHT automatisch
// nochmal die ganze Premiere abspielen. Neu-Schnitt nur beim Speichern-Klick.
function schedulePremRecache() {
  clearTimeout(premRecacheTimer);
  premRecacheTimer = null;
  // Laufenden Erst-Mitschnitt nicht abwürgen und nicht löschen
  if (premCachePending) {
    premCacheDirty = true;
    updateDownloadBtnLabel();
    return;
  }
  if (premCacheReady(premCache)) {
    // Alten Mitschnitt behalten für Sofort-Save; als dirty markieren wenn Settings weg sind
    if (premCache.volSig !== premVolSig()) premCacheDirty = true;
    updateDownloadBtnLabel();
    return;
  }
  premCacheDirty = true;
  updateDownloadBtnLabel();
}

async function downloadPremiere() {
  const nameBase = (scene?.id || "synchro") + "_dub.";
  // Noch am Mitschneiden vom ersten Anschauen? Darauf warten — kein Zweitdurchlauf.
  if (premCachePending) {
    status("play-status", tt("⏳ Still finishing the cut from first watch — one moment …", "⏳ Schneide noch vom ersten Anschauen fertig — einen Moment …"));
    $("dl-progress").style.display = "";
    try {
      const c = await premCachePending;
      $("dl-progress").style.display = "none";
      // Auch „veraltet“ (Lautstärke geändert): trotzdem speichern was angeschaut wurde
      if (!premCacheReady(c) && !premCacheReady(premCache)) throw new Error("leer");
      const use = premCacheReady(premCache) ? premCache : c;
      const wie = await saveBlob(use.blob, nameBase + use.endung);
      if (wie === "abort") return status("play-status", tt("Save cancelled.", "Speichern abgebrochen."));
      status("play-status", use.endung === "mp4"
        ? tt("✅ Saved as MP4 — from watching, no second pass needed.", "✅ Gespeichert als MP4 — vom Anschauen, kein zweites Mal nötig.")
        : tt("✅ Saved!", "✅ Gespeichert!"));
      SFX.done();
      updateDownloadBtnLabel();
    } catch {
      $("dl-progress").style.display = "none";
      // Nur wenn wirklich nichts da ist: stiller Hintergrund-Schnitt (kein „nochmal angucken“)
      if (premCacheReady(premCache)) {
        const wie = await saveBlob(premCache.blob, nameBase + premCache.endung);
        if (wie === "abort") return status("play-status", tt("Save cancelled.", "Speichern abgebrochen."));
        status("play-status", tt("✅ Saved (capture from watching)!", "✅ Gespeichert (Mitschnitt vom Anschauen)!"));
        SFX.done();
        updateDownloadBtnLabel();
        return;
      }
      status("play-status", tt("First-pass cut failed — redoing once in the background …", "Schnitt vom ersten Lauf hat nicht geklappt — einmal neu im Hintergrund …"), true);
      await playMix({ save: true, quiet: true });
    }
    return;
  }
  // Fertiger Mitschnitt vom Anschauen — IMMER sofort speichern (auch nach Outtakes / Lautstärke-Tweak).
  // Früher: dirty → Cache löschen → ganzes Video nochmal durchlaufen. Das war der Bug.
  if (premCacheReady(premCache)) {
    const dirtyNote = (premCacheDirty || premCache.volSig !== premVolSig())
      ? tt(" (as watched — for new volume: replay, then save)", " (wie angeschaut — für neue Lautstärke: Nochmal abspielen, dann speichern)")
      : "";
    const wie = await saveBlob(premCache.blob, nameBase + premCache.endung);
    if (wie === "abort") return status("play-status", tt("Save cancelled.", "Speichern abgebrochen."));
    if (premCache.fps < 5) status("play-status", tt("⚠ Saved, but the picture may stutter or be black. Keep the window in front and watch the premiere again.", "⚠ Gespeichert, aber das Bild dürfte ruckeln oder schwarz sein. Bitte Fenster im Vordergrund lassen und Premiere nochmal anschauen."), true);
    else status("play-status", (premCache.endung === "mp4"
      ? tt("✅ Saved instantly as MP4 — from watching.", "✅ Sofort gespeichert als MP4 — vom Anschauen.")
      : tt("✅ Saved instantly! Your browser only does .webm — for TikTok/Insta convert once to MP4 in CapCut.", "✅ Sofort gespeichert! Dein Browser kann nur .webm — für TikTok/Insta ggf. einmal in CapCut zu MP4.")) + dirtyNote);
    SFX.done();
    updateDownloadBtnLabel();
    return;
  }
  // Gar kein Cache → einmal im Hintergrund neu schneiden (Audio stumm, Fenster offen lassen)
  status("play-status", tt("🎬 Cutting video in background — you don't have to watch, but keep the window open …", "🎬 Schneide Video im Hintergrund — musst nicht zuschauen, Fenster aber bitte offen lassen …"));
  await playMix({ save: true, quiet: true });
}

async function playMix(opts) {
  // opts: true/false (alt) oder { save, quiet, cache }
  const saveFile = opts === true || !!(opts && opts.save);
  const quiet = !!(opts && opts.quiet);
  const auchCachen = !saveFile;   // normale Premiere: still mitschneiden für späteren Sofort-Download
  const ctx = getCtx();
  const v = $("play-video");
  playNodes.forEach(n => { try { n.stop(); } catch {} });
  playNodes = [];
  premPaused = false;
  // Outtakes-Hintergrundschnitt stoppen — Rausch-Bus/Flag darf Premiere nicht verunreinigen
  if (outtakesPlaying && outtakesQuietJob) outtakeAbort = true;
  silenceOuttakesTransBus();
  try { await ctx.resume(); } catch {}
  updatePremPauseBtn();

  const g = premGraph(ctx, v);
  // Quiet: Lautsprecher stumm (Gain 0), Recorder hängt weiter am masterGain — wie Outtakes
  if (!g.hearGain) {
    try { g.masterGain.disconnect(ctx.destination); } catch {}
    g.hearGain = ctx.createGain();
    g.masterGain.connect(g.hearGain);
    g.hearGain.connect(ctx.destination);
  }
  g.hearGain.gain.value = quiet ? 0 : 1;
  const master = g.voiceGain;          // Stimmen laufen über den Voice-Regler in den Graph
  clearPremPlayerGainNodes();          // frische Per-Spieler-Gains für diesen Lauf
  tunePremCompForPlayerGains();
  v.playbackRate = 1;

  let fileRec = null;
  let myGen = 0;
  if (saveFile || auchCachen) {
    // Neue Generation — veraltete onstop-Handler dürfen Pending/Cache nicht mehr anfassen
    premCacheGen++;
    myGen = premCacheGen;
    const dest = ctx.createMediaStreamDestination();
    g.masterGain.connect(dest);

    // Bildquelle: Video Bild für Bild auf eine Leinwand malen und DIESE aufnehmen.
    // Der direkte Weg über video.captureStream() liefert auf manchen Rechnern nur
    // Schwarzbild (Hardware-Dekoder/Grafiktreiber) — der Ton war dann da, das Bild fehlte.
    const frames = frameSource(v);
    const stream = new MediaStream([...frames.stream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    // MP4 wenn der Browser es kann: das laesst sich direkt bei TikTok/Insta hochladen,
    // ohne vorher in CapCut umgewandelt zu werden. WebM nur noch als Rueckfalloption.
    const mime = videoMime();
    const endung = mime.startsWith("video/mp4") ? "mp4" : "webm";
    try {
      fileRec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
    } catch (e) {
      console.warn("MediaRecorder startet nicht:", e);
      fileRec = null;
    }
    const chunks = [];
    const volSig = premVolSig();
    if (fileRec) {
      premActiveRecorder = fileRec;
      fileRec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      fileRec.onerror = e => console.warn("MediaRecorder Fehler:", e);
      // Alten Pending sauber auflösen, bevor wir einen neuen setzen
      if (premCacheResolve) { try { premCacheResolve(null); } catch {} }
      premCachePending = new Promise(res => { premCacheResolve = res; });
      premCacheDirty = false;
      updateDownloadBtnLabel();
      holdPremWakeLock();
      fileRec.onstop = async () => {
        if (premActiveRecorder === fileRec) premActiveRecorder = null;
        try { g.masterGain.disconnect(dest); } catch {}
        frames.stop();
        releasePremWakeLock(); // immer, auch bei veraltetem Mitschnitt
        if (myGen !== premCacheGen) return; // veralteter Mitschnitt — Pending gehört dem neueren Lauf
        let blob = new Blob(chunks, { type: mime.split(";")[0] });
        const sek = Math.max(1, v.duration || ((performance.now() - recT0) / 1000) || 1);
        try { blob = await withRecordedDuration(blob, sek); } catch {}
        const fps = frames.count() / sek;
        const ok = blob.size > 1000;
        const result = ok ? { blob, endung, volSig, fps } : null;
        premCache = result;
        // Settings während des Mitschnitts geändert? Cache behalten, als dirty markieren
        if (ok) premCacheDirty = (volSig !== premVolSig());
        const r = premCacheResolve;
        premCacheResolve = null;
        premCachePending = null;
        if (r) try { r(result); } catch {}
        updateDownloadBtnLabel();
        if (!ok && !saveFile) {
          status("play-status", tt("⚠ Instant save didn’t work this time (window in the background?). When saving, let it play through — please keep the tab in the foreground.", "⚠ Sofort-Speichern hat diesmal nicht geklappt (Fenster im Hintergrund?). Beim Speichern einmal durchlaufen — bitte Tab im Vordergrund lassen."), true);
        }
        if (saveFile && ok) {
          const name = (scene?.id || "synchro") + "_dub." + endung;
          saveBlob(blob, name).then(wie => {
            if (wie === "abort") { status("play-status", tt("Save cancelled.", "Speichern abgebrochen.")); return; }
            if (fps < 5) status("play-status", tt("⚠ Saved, but the picture may stutter or be black (only ", "⚠ Gespeichert, aber das Bild dürfte ruckeln oder schwarz sein (nur ") + fps.toFixed(1) + tt(" frames/sec.). The browser throttles recording when the window is in the background — please save again and keep the window open in the foreground.", " Bilder/Sek.). Der Browser drosselt das Aufnehmen, wenn das Fenster im Hintergrund ist — bitte nochmal speichern und das Fenster dabei offen im Vordergrund lassen."), true);
            else {
              status("play-status", endung === "mp4"
                ? tt("✅ Saved as MP4 — you can upload it straight to TikTok, Insta or WhatsApp.", "✅ Gespeichert als MP4 — kann direkt bei TikTok, Insta oder WhatsApp hochgeladen werden.")
                : tt("✅ Saved! Your browser can only do .webm — for TikTok/Insta export once to MP4 in CapCut or similar.", "✅ Gespeichert! Dein Browser kann nur .webm — für TikTok/Insta einmal in CapCut o. Ä. zu MP4 exportieren."));
              SFX.done();
            }
          });
        } else if (saveFile && !ok) {
          status("play-status", tt("⚠ Save failed — please keep the tab in the foreground and try again.", "⚠ Speichern fehlgeschlagen — bitte Tab im Vordergrund lassen und nochmal versuchen."), true);
        } else if (ok && !quiet) {
          status("play-status", tt("✅ Premiere finished — save is ready instantly now!", "✅ Premiere durch — Speichern ist jetzt sofort bereit!"));
        }
      };
    }
    if (saveFile) {
      status("play-status", quiet
        ? "🎬 Schneide im Hintergrund — musst nicht zuschauen, Fenster bitte offen lassen …"
        : "🔴 Nimmt Video auf — Fenster bitte im Vordergrund lassen, sonst wird das Bild schwarz!");
      $("dl-progress").style.display = "";
    }
  }

  v.pause(); v.currentTime = 0;
  await v.play();
  const recT0 = performance.now();
  if (fileRec) {
    // Ohne timeslice: Chromium schreibt eher Duration. Fallback mit timeslice falls nötig.
    if (!startMediaRecorder(fileRec, 1000)) {
      console.warn("fileRec.start fehlgeschlagen");
    }
    const progInterval = setInterval(() => {
      const pct = v.duration ? Math.round((v.currentTime / v.duration) * 100) : 0;
      if ($("dl-progress-bar")) $("dl-progress-bar").style.width = pct + "%";
      if ($("dl-progress-label")) $("dl-progress-label").textContent = pct + "%";
      if (v.ended || fileRec.state === "inactive") clearInterval(progInterval);
    }, 200);
    v.addEventListener("ended", () => { clearInterval(progInterval); if (saveFile) $("dl-progress").style.display = "none"; }, { once: true });
  }
  const t0 = ctx.currentTime;
  const off = syncOffsetMs / 1000;

  for (const item of mixItems) {
    if (item.isOrig && !isOrigItemAudible(item)) continue;
    let role = item.role != null ? (roleOf(item.role) || { pan: 0, effect: "none", gain: 1 }) : { pan: 0, effect: "none", gain: 1 };
    if (scene.lines && item.lineIdx != null) role = effectiveRole(role, scene.lines[item.lineIdx]);
    if (item.effect) role = { ...role, effect: item.effect };   // Spieler-eigene Wahl übersticht alles andere
    if (item.fxAmount !== undefined) role = { ...role, fxAmount: item.fxAmount };
    // „Deine Lautstärke“ aus der Booth — fehlte hier bisher (Export hatte es, Premiere nicht)
    if (item.boost != null && item.boost !== 1) role = { ...role, gain: (role.gain ?? 1) * item.boost };
    // Spieler-Stimmen: Pan aus der Booth (Default Mitte). Original-Lücken behalten Szenen-Pan.
    if (!item.isOrig) role = { ...role, pan: item.pan != null ? item.pan : 0 };
    else if (item.pan != null) role = { ...role, pan: item.pan };
    const src = ctx.createBufferSource();
    src.buffer = item.buffer;
    src.playbackRate.value = effectPitch(role.effect);
    // Host-Mitspieler-Lautstärke: eigene GainNode pro Rolle (live änderbar für alle)
    const rk = !item.isOrig ? roleKey(item.role) : null;
    const dest = (rk != null)
      ? ensurePremPlayerGainNode(ctx, rk, master)
      : master;
    src.connect(buildChain(ctx, role, dest));
    // Spur auf ihr Line-Fenster begrenzen → kein Reinlabern in die nächste Line
    const _rate = src.playbackRate.value || 1;
    let maxDur = item.buffer.duration;
    if (scene.lines && item.lineIdx != null) {
      const l = scene.lines[item.lineIdx];
      const cutoffT = nextSameRoleStart(item.lineIdx);
      const windowSec = ((cutoffT != null ? cutoffT : l.end + 0.8) - l.t) + 0.25;
      // Dauer bezieht sich aufs Quellmaterial -> mit der Abspielrate umrechnen,
      // sonst laufen langsame Effekte (Monster/Titan) ueber ihr Fenster hinaus.
      maxDur = Math.min(maxDur, windowSec * _rate);
    }
    const when = t0 + item.startAt + off;
    if (when >= ctx.currentTime) src.start(when, 0, maxDur);
    else {
      const lateSec = ctx.currentTime - when;            // schon verstrichene ECHTZEIT
      const offsetSrc = lateSec * _rate;                  // entspricht so viel Quellmaterial
      src.start(ctx.currentTime, offsetSrc, Math.max(0.05, maxDur - offsetSrc));
    }
    playNodes.push(src);
  }
  // Videoende = ALLES stoppt → kein 1–2s-Nachlauf-Audio mehr
  v.addEventListener("ended", () => {
    playNodes.forEach(n => { try { n.stop(); } catch {} });
    premPaused = false;
    updatePremPauseBtn();
    if (pendingRate && !saveFile) { pendingRate = false; showRateCard(); }
  }, { once: true });

  if (fileRec) v.addEventListener("ended", () => { if (fileRec.state !== "inactive") fileRec.stop(); }, { once: true });
}


function syncCinemaVolSliders() {
  const m = $("cin-vol-master"), v = $("cin-vol-voice"), u = $("cin-vol-video");
  if (m) m.value = premVol.master;
  if (v) v.value = premVol.voice;
  if (u) u.value = premVol.video;
}
function syncAllPremVolSliders() {
  syncCinemaVolSliders();
  for (const [id, key] of [["vol-master", "master"], ["vol-voice", "voice"], ["vol-video", "video"]]) {
    const el = $(id);
    if (el) el.value = premVol[key];
  }
}
function bindVolSlider(id, key, twinId) {
  const el = $(id);
  if (!el) return;
  el.oninput = e => {
    premVol[key] = parseFloat(e.target.value);
    const twin = twinId && $(twinId);
    if (twin && twin !== el) twin.value = e.target.value;
    applyPremVol();
    schedulePremRecache();
  };
}
bindVolSlider("vol-master", "master", "cin-vol-master");
bindVolSlider("vol-voice", "voice", "cin-vol-voice");
bindVolSlider("vol-video", "video", "cin-vol-video");
bindVolSlider("cin-vol-master", "master", "vol-master");
bindVolSlider("cin-vol-voice", "voice", "vol-voice");
bindVolSlider("cin-vol-video", "video", "vol-video");
syncAllPremVolSliders();
$("btn-prem-autobal") && ($("btn-prem-autobal").onclick = () => { if (isHost) { try { SFX.click(); } catch {} setPremAutoBalance(!premAutoBalance); } });
let boothVol = 0.55;
$("booth-vol").oninput = e => { boothVol = parseFloat(e.target.value); $("booth-video").volume = boothVol; };

$("sync-offset").oninput = (e) => {
  syncOffsetMs = parseInt(e.target.value);
  $("sync-val").textContent = syncOffsetMs + " ms";
  schedulePremRecache();
};

// ── Effekt-Ketten ────────────────────────────────────────────
function buildChain(ctx, role, dest) {
  const input = ctx.createGain();
  input.gain.value = role.gain ?? 1;
  const pan = ctx.createStereoPanner();
  pan.pan.value = role.pan ?? 0;

  // Effekt-Staerke 0..1 -- 0 = aus (nur Originalstimme), 1 = voll.
  // Umgesetzt als Ueberblendung zwischen unbearbeitetem und bearbeitetem Signal.
  // Dadurch wirkt der Regler bei JEDEM Effekt gleich, ohne jeden einzeln umbauen zu muessen.
  let amt = role.fxAmount;
  amt = (amt === undefined || amt === null) ? 1 : Math.max(0, Math.min(1, amt));
  const fxIn = ctx.createGain(), fxOut = ctx.createGain();
  const dryG = ctx.createGain(); dryG.gain.value = 1 - amt;
  const wetG = ctx.createGain(); wetG.gain.value = amt;
  input.connect(fxIn);
  input.connect(dryG); dryG.connect(pan);
  fxOut.connect(wetG); wetG.connect(pan);
  pan.connect(dest);

  let node = fxIn;
  const filt = (type, freq, q, gain) => {
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq;
    if (q) f.Q.value = q; if (gain) f.gain.value = gain;
    node.connect(f); node = f;
  };

  switch (role.effect) {
    case "vintage_1990":
      filt("highpass", 140); filt("lowpass", 5600);
      filt("peaking", 2600, 1, 4.5);
      node = chainShaper(ctx, node, 10);
      break;
    case "radio":
      filt("highpass", 380); filt("lowpass", 3000);
      node = chainShaper(ctx, node, 25);
      break;
    case "telefon":
      filt("highpass", 350); filt("lowpass", 2900); filt("peaking", 1700, 1.3, 5);
      node = chainShaper(ctx, node, 15);
      break;
    case "megaphone":
      filt("highpass", 550); filt("lowpass", 2500); filt("peaking", 1500, 2, 9);
      node = chainShaper(ctx, node, 55);
      break;
    case "underwater": {
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 550;
      node.connect(lp); node = lp;
      filt("peaking", 260, 1.5, 5);
      // Wabbel-Effekt: LFO schiebt die Lowpass-Frequenz langsam auf und ab, wie Schallwellen unter Wasser
      const uwLfo = ctx.createOscillator(); uwLfo.type = "sine"; uwLfo.frequency.value = 3.1;
      const uwDepth = ctx.createGain(); uwDepth.gain.value = 230;
      uwLfo.connect(uwDepth); uwDepth.connect(lp.frequency);
      try { uwLfo.start(); } catch {}
      break;
    }
    case "helium":
      filt("highpass", 200); filt("peaking", 3500, 1, 6);
      break;
    case "monster":
      filt("lowpass", 1900); filt("peaking", 130, 1.4, 7);
      node = chainShaper(ctx, node, 20);
      break;
    case "robot": {
      const lfo = ctx.createOscillator(); lfo.type = "square"; lfo.frequency.value = 38;
      const ringGain = ctx.createGain(); ringGain.gain.value = 0.72;
      const dcOffset = ctx.createGain(); dcOffset.gain.value = 0.28;
      lfo.connect(ringGain.gain);
      node.connect(ringGain); node.connect(dcOffset);
      const merge = ctx.createGain();
      ringGain.connect(merge); dcOffset.connect(merge);
      node = merge;
      try { lfo.start(); } catch {}
      filt("bandpass", 1800, 0.7);
      break;
    }
    case "chorus": {
      // Doppelgänger-Effekt: leicht verstimmte, verzögerte Kopie wird dazugemischt -> schwebender Doppel-Klang
      const dry = ctx.createGain(); dry.gain.value = 0.75;
      const wet = ctx.createGain(); wet.gain.value = 0.55;
      const delay = ctx.createDelay(); delay.delayTime.value = 0.022;
      const chLfo = ctx.createOscillator(); chLfo.type = "sine"; chLfo.frequency.value = 0.9;
      const chDepth = ctx.createGain(); chDepth.gain.value = 0.006;
      chLfo.connect(chDepth); chDepth.connect(delay.delayTime);
      try { chLfo.start(); } catch {}
      node.connect(dry); node.connect(delay); delay.connect(wet);
      const merge2 = ctx.createGain();
      dry.connect(merge2); wet.connect(merge2);
      node = merge2;
      break;
    }
    case "echo": {
      // Deutlicher Einzel-Nachschlag (Slap-Echo), anders als der weiche "halliger Raum"
      const dry = ctx.createGain(); dry.gain.value = 0.9;
      const wet = ctx.createGain(); wet.gain.value = 0.55;
      const delay = ctx.createDelay(); delay.delayTime.value = 0.22;
      const fb = ctx.createGain(); fb.gain.value = 0.22;
      node.connect(dry); node.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet);
      const merge3 = ctx.createGain();
      dry.connect(merge3); wet.connect(merge3);
      node = merge3;
      break;
    }
    // ── Raum & Position ──────────────────────────────────────────────
    // Grundgedanke: Entfernung heisst nicht einfach "leiser". Luft schluckt hohe Toene
    // staerker als tiefe, und je weiter weg, desto mehr hoert man den Raum statt der Stimme.
    // Genau diese zwei Dinge zusammen ergeben den ueberzeugenden Abstands-Eindruck.
    case "far":
    case "veryfar":
    case "offscreen":
    case "nextroom":
    case "behinddoor":
    case "above":
    case "crowd":
    case "memory": {
      const P = {
        //            Hoehen-Grenze  Tiefen-Cut  Lautstaerke  Raumanteil  Nachhallzeit
        far:        { lp: 6500,  hp: 120, vol: 0.62, wet: 0.24, dl: 0.045 },
        veryfar:    { lp: 3400,  hp: 200, vol: 0.40, wet: 0.44, dl: 0.085 },
        offscreen:  { lp: 5200,  hp: 150, vol: 0.52, wet: 0.32, dl: 0.06 },
        nextroom:   { lp: 1500,  hp: 180, vol: 0.45, wet: 0.38, dl: 0.07 },
        behinddoor: { lp: 900,   hp: 160, vol: 0.42, wet: 0.30, dl: 0.05 },
        above:      { lp: 4200,  hp: 260, vol: 0.55, wet: 0.36, dl: 0.075 },
        crowd:      { lp: 5000,  hp: 200, vol: 0.58, wet: 0.30, dl: 0.05 },
        memory:     { lp: 3800,  hp: 220, vol: 0.60, wet: 0.55, dl: 0.11 },
      }[role.effect];

      filt("highpass", P.hp, 0.7);
      filt("lowpass", P.lp, 0.7);
      if (role.effect === "behinddoor") filt("peaking", 400, 1.2, 4);   // dumpfes Wummern durchs Holz
      if (role.effect === "above")      filt("peaking", 2500, 1.5, -4); // von oben fehlt Direktschall
      if (role.effect === "memory")     filt("peaking", 1800, 0.8, 3);  // leicht traumhaft angehoben

      const q = ctx.createGain(); q.gain.value = P.vol;
      node.connect(q); node = q;

      // Raumanteil: kurze Verzoegerung mit Rueckkopplung = der Hall, den man aus der Ferne hoert
      const dry = ctx.createGain(); dry.gain.value = 1 - P.wet * 0.6;
      const wet = ctx.createGain(); wet.gain.value = P.wet;
      const dly = ctx.createDelay(); dly.delayTime.value = P.dl;
      const fb  = ctx.createGain(); fb.gain.value = role.effect === "memory" ? 0.5 : 0.34;
      const dlp = ctx.createBiquadFilter(); dlp.type = "lowpass"; dlp.frequency.value = Math.min(P.lp, 2600);
      node.connect(dry);
      node.connect(dly); dly.connect(dlp); dlp.connect(fb); fb.connect(dly);
      dlp.connect(wet);
      const mix = ctx.createGain();
      dry.connect(mix); wet.connect(mix);
      node = mix;
      break;
    }

    case "whisper": {
      // Dicht am Ohr: kaum Tiefen, dafuer viel Atem-Anteil oben und leichte Kompression
      filt("highpass", 240, 0.7);
      filt("peaking", 5200, 0.9, 6);      // Luft/Atem betonen
      filt("peaking", 900, 1.0, -3);      // Brustanteil raus, wirkt naeher
      const wc = ctx.createDynamicsCompressor();
      wc.threshold.value = -34; wc.knee.value = 14; wc.ratio.value = 5;
      wc.attack.value = 0.004; wc.release.value = 0.12;
      node.connect(wc); node = wc;
      const wg = ctx.createGain(); wg.gain.value = 1.5;
      node.connect(wg); node = wg;
      break;
    }

    case "shout": {
      // Rufen: die Stimme verzerrt leicht, Mitten treten hervor, Raum antwortet
      filt("highpass", 150, 0.7);
      filt("peaking", 1900, 1.1, 5);
      node = chainShaper(ctx, node, 12);
      const sc = ctx.createDynamicsCompressor();
      sc.threshold.value = -18; sc.knee.value = 6; sc.ratio.value = 6;
      sc.attack.value = 0.002; sc.release.value = 0.2;
      node.connect(sc); node = sc;
      const sdry = ctx.createGain(); sdry.gain.value = 0.9;
      const swet = ctx.createGain(); swet.gain.value = 0.22;
      const sdl = ctx.createDelay(); sdl.delayTime.value = 0.09;
      const sfb = ctx.createGain(); sfb.gain.value = 0.28;
      node.connect(sdry); node.connect(sdl); sdl.connect(sfb); sfb.connect(sdl); sdl.connect(swet);
      const smix = ctx.createGain(); sdry.connect(smix); swet.connect(smix);
      node = smix;
      break;
    }

    case "pa": {
      // Durchsage: schmalbandig wie ein Trichterlautsprecher, mit Hallfahne in der Halle
      filt("highpass", 420, 0.9);
      filt("lowpass", 3600, 0.9);
      filt("peaking", 1600, 2.2, 7);
      node = chainShaper(ctx, node, 22);
      const pdry = ctx.createGain(); pdry.gain.value = 0.75;
      const pwet = ctx.createGain(); pwet.gain.value = 0.45;
      const pdl = ctx.createDelay(); pdl.delayTime.value = 0.13;
      const pfb = ctx.createGain(); pfb.gain.value = 0.42;
      const plp = ctx.createBiquadFilter(); plp.type = "lowpass"; plp.frequency.value = 2200;
      node.connect(pdry);
      node.connect(pdl); pdl.connect(plp); plp.connect(pfb); pfb.connect(pdl); plp.connect(pwet);
      const pmix = ctx.createGain(); pdry.connect(pmix); pwet.connect(pmix);
      node = pmix;
      break;
    }

    case "tv": {
      // Kleiner Lautsprecher: keine Tiefen, leicht blechern, minimal verzerrt
      filt("highpass", 300, 0.8);
      filt("lowpass", 5000, 0.8);
      filt("peaking", 1200, 1.6, 4);
      filt("peaking", 3000, 2.0, -3);
      node = chainShaper(ctx, node, 8);
      const tg = ctx.createGain(); tg.gain.value = 0.7;
      node.connect(tg); node = tg;
      break;
    }

    case "studio": {
      // Rettet guenstige Mikrofone. Leitgedanke: aufraeumen und glaetten statt aufbohren.
      // Billige Mikros klingen schlecht, WEIL obenrum zu viel Zischeln und Rauschen sitzt --
      // ein Hoehen-Boost macht genau das lauter. Deshalb hier gezielte Korrekturen,
      // sanfte Verdichtung in zwei Stufen und am Ende ein Limiter, damit nichts uebersteuert.
      filt("highpass", 80, 0.7);           // Trittschall, Tischklopfen, Klima-Brummen
      filt("peaking", 175, 0.9, 2);        // etwas Koerper -- duenne Stimmen wirken sonst schmal
      filt("peaking", 400, 1.0, -3);       // Pappkarton-Klang der billigen Kapsel
      filt("peaking", 1050, 1.5, -1.5);    // Naeselndes/Quaekiges rausnehmen
      filt("peaking", 2700, 1.2, 3);       // Praesenz fuer Verstaendlichkeit -- bewusst moderat
      filt("peaking", 5200, 2.4, -2);      // Haerte/Schaerfe
      filt("peaking", 7400, 2.6, -3);      // Zischeln
      filt("highshelf", 11000, 0.7, -3.5); // ganz oben zurueck: da sitzt fast nur Rauschen

      // Erste Stufe: sanft und langsam -- gleicht nur laute und leise Stellen aus,
      // ohne die Stimme zusammenzupressen.
      const lev = ctx.createDynamicsCompressor();
      lev.threshold.value = -22; lev.knee.value = 20; lev.ratio.value = 2.2;
      lev.attack.value = 0.015; lev.release.value = 0.25;
      node.connect(lev); node = lev;

      const makeup = ctx.createGain(); makeup.gain.value = 1.35;
      node.connect(makeup); node = makeup;

      // Zweite Stufe: schneller Limiter als Deckel. Ohne den knallte die Kette vorher
      // ins Maximum und klang dadurch hart und verzerrt.
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20;
      lim.attack.value = 0.001; lim.release.value = 0.08;
      node.connect(lim); node = lim;
      break;
    }
    case "titan":
      // Sehr tiefe, bedrohliche Stimme -- staerkerer Bruder von "monster", mit mehr Growl
      filt("lowpass", 1300); filt("peaking", 90, 1.6, 9);
      node = chainShaper(ctx, node, 30);
      break;
    case "hall": {
      const dry = ctx.createGain(); dry.gain.value = 0.85;
      const wet = ctx.createGain(); wet.gain.value = 0.4;
      const delay = ctx.createDelay(); delay.delayTime.value = 0.11;
      const fb = ctx.createGain(); fb.gain.value = 0.38;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2400;
      node.connect(dry); dry.connect(fxOut);
      node.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay);
      lp.connect(wet); wet.connect(fxOut);
      return input;
    }
  }
  node.connect(fxOut);
  return input;
}


// Falls eine einzelne Line einen eigenen Effekt festlegt (z.B. "diese eine Line klingt wie Telefon"),
// überschreibt das den normalen Rollen-Effekt NUR für diese Line.
function effectiveRole(role, line) {
  if (line && line.effect) return { ...role, effect: line.effect };
  return role;
}
function effectPitch(effect) {
  if (effect === "helium") return 1.35;
  if (effect === "monster") return 0.72;
  if (effect === "titan") return 0.6;
  return 1;
}
function chainShaper(ctx, node, amount) { const s = shaper(ctx, amount); node.connect(s); return s; }
function shaper(ctx, amount) {
  const ws = ctx.createWaveShaper();
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((3 + amount) * x * 0.5) / (Math.PI + amount * Math.abs(x)) * Math.PI;
  }
  ws.curve = curve; ws.oversample = "2x";
  return ws;
}

// ── Teleprompter (Premiere-Untertitel + Realtime-Cues) ───────
function attachPrompter(videoEl, promptEl, myRoleId) {
  // myRoleId darf eine einzelne Rolle ODER eine Liste sein (Mehrfachrollen)
  const meine = Array.isArray(myRoleId) ? myRoleId : (myRoleId == null ? [] : [myRoleId]);
  promptEl.innerHTML = "";
  if (!scene?.lines?.length) return;
  const lines = scene.lines;
  let lastIdx = -2;
  videoEl.ontimeupdate = () => {
    const t = videoEl.currentTime;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) if (t >= lines[i].t && t < lines[i].end) { idx = i; break; }
    if (idx === lastIdx) return;
    lastIdx = idx;
    const cur = idx >= 0 ? lines[idx] : null;
    const next = lines.find(l => l.t > t);
    const mine = !!(cur && cur.chars.some(c => meine.includes(c)));
    const av = cur && scene.avatars ? scene.avatars[String(cur.chars[0])] : null;
    promptEl.innerHTML =
      (cur ? `<div class="pline ${mine ? "mine" : ""}">
          ${av ? `<img src="${esc(assetUrl(av))}" alt="" data-mono="${esc(cur.who || "?")}">` : ""}
          <div class="ptext"><div class="pwho">${esc(cur.who)}${mine ? tt(" — 🎙 YOU!", " — 🎙 DU!") : ""}</div><div class="pcap">${esc(linePrimaryText(cur))}</div>${lineSecondaryText(cur) ? `<div style="font-size:.85rem;color:var(--amber)">${esc(lineSecondaryText(cur))}</div>` : ""}</div>
        </div>` : `<div class="pline"><div class="ptext"><div class="pwho">…</div><div class="pcap" style="color:var(--muted)">${esc(tt("Quiet in the studio", "Ruhe im Studio"))}</div></div></div>`) +
      (next ? `<div class="pnext">${esc(tt("Next", "Gleich"))} (${Math.max(0, next.t - t).toFixed(0)}s): <b>${esc(next.who)}</b> — ${esc(linePrimaryText(next))}</div>` : "");
  };
}

// ═════════════════════════════════════════════════════════════
// 10) NEUE RUNDE
// ═════════════════════════════════════════════════════════════
$("btn-again").onclick = () => {
  if (!iAmLogicalHost()) return status("play-status", tt("Only the host can start a new round.", "Nur der Host kann eine neue Runde starten."), true);
  if (!isHost) { sendHost({ t: "hostCmd", cmd: "again" }); return; }
  broadcast({ t: "again" }); resetForNewRound();
};
$("btn-back").onclick = () => {
  if (!iAmLogicalHost()) return status("play-status", tt("Only the host can change the scene.", "Nur der Host kann die Szene wechseln."), true);
  if (!isHost) { sendHost({ t: "hostCmd", cmd: "backScene" }); return; }
  SFX.back(); scene = null; broadcast({ t: "again" }); resetForNewRound(); $("scene-card").style.display = "none";
};
function resetForNewRound() {
  players.forEach(p => {
    p.ready = false; p.done = 0; p.total = 0; p.prem = false; p.premPct = 0;
    p.loadPct = 0; p.videoReady = false;
  });
  mixItems = []; collected.clear(); collectedOuttakes.clear(); takes = {}; outtakes = []; outtakesCache = null;
  clearTimeout(outtakesPrecacheTimer); outtakesPrecacheTimer = null;
  outtakeAbort = true; outtakesPlaying = false; outtakesQuietJob = false;
  outtakesSaveWhenReady = false; outtakesDidSaveBlob = false;
  silenceOuttakesTransBus();
  resolveOuttakesCachePending(null);
  premOrigOn = true; premOrigUnfilled = []; premOrigMuted = new Set(); premPaused = false;
  resetPremPlayerGains();
  invalidatePremCache();
  clearSceneCaches();
  pendingPhaseRestore = null;
  finalTracksData = null; premiereLocked = false; redoMode = null;
  try { if (audioCtx && audioCtx.state === "suspended") audioCtx.resume(); } catch {}
  const pop = $("prem-orig-panel"); if (pop) pop.style.display = "none";
  updatePremPauseBtn();
  pendingRate = false; rateSent = false; allRatings.clear(); myStars = {}; myBuddy = null;
  exitCinemaMode();
  const c = $("cinema-curtains"); if (c) c.classList.remove("show", "open");
  $("rate-card").style.display = "none";
  $("rate-rows").innerHTML = ""; $("rate-result").innerHTML = "";
  $("btn-rate-submit").textContent = tt("Submit rating", "Bewertung abschicken");
  $("btn-rate-submit").disabled = true;
  $("btn-next-round").style.display = "none";
  updateOuttakesBtn();
  if (isHost) { ttt = { p: [], board: Array(9).fill(null), turn: 0, winner: null }; broadcast({ t: "tttState", ttt }); renderTTT(); }
  show("scr-lobby");
  if (isHost) broadcastState(); else { renderPlayers(); renderRoles(); }
  status("lobby-status", tt("New round — hit “I’m ready” again when you want to go.", "Neue Runde — wieder „Bin bereit“ drücken, wenn's losgehen soll."));
}
