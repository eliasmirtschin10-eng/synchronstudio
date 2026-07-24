/* ═══════════════════════════════════════════════════════════════
   SYNCHRONSTUDIO — privates Online-Dubbing-Game
   Statisch (GitHub Pages) + PeerJS (P2P). Host = Autorität.
   Modus A: Line-Booth (Szenen mit "lines"-Timings, Choicer-Voicer-Style)
   Modus B: Realtime (eigene Videos ohne Timings)
   ═══════════════════════════════════════════════════════════════ */

const APP_VERSION = "5.9";
const PEER_PREFIX = "syncstudio-emvw-";
// ╔══════════════════════════════════════════════════════════════════╗
// ║  TURN-RELAY — HIER DEINE EIGENEN ZUGANGSDATEN EINTRAGEN!          ║
// ║  Nötig, wenn "Raum gefunden, aber Verbindung kommt nicht durch"   ║
// ║  (typisch bei DS-Lite/CGNAT, z. B. Vodafone Kabel oder O2).       ║
// ║                                                                    ║
// ║  1. Kostenloses Konto auf https://www.metered.ca/stun-turn        ║
// ║  2. Im Dashboard die 4 "ICE Server"-Zeilen kopieren               ║
// ║  3. Die MY_TURN-Zeilen unten damit ersetzen (urls/username/       ║
// ║     credential) — fertig. 50 GB/Monat gratis, für Audio massig.   ║
// ╚══════════════════════════════════════════════════════════════════╝
const MY_TURN = [
  // Metered-Account "synchronstudio" — exakt aus dem Dashboard (global.relay!)
  { urls: "stun:stun.relay.metered.ca:80" },
  { urls: "turn:global.relay.metered.ca:80",                 username: "784a2cacd45f00da0669d578", credential: "ix7IinZzU+ItucbO" },
  { urls: "turn:global.relay.metered.ca:80?transport=tcp",   username: "784a2cacd45f00da0669d578", credential: "ix7IinZzU+ItucbO" },
  { urls: "turn:global.relay.metered.ca:443",                username: "784a2cacd45f00da0669d578", credential: "ix7IinZzU+ItucbO" },
  { urls: "turns:global.relay.metered.ca:443?transport=tcp", username: "784a2cacd45f00da0669d578", credential: "ix7IinZzU+ItucbO" },
];
const PEER_CONFIG = { config: { iceServers: [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  ...MY_TURN
], iceCandidatePoolSize: 4 } };
const CHUNK_SIZE = 128 * 1024;

// ── State ────────────────────────────────────────────────────
let peer = null, isHost = false, myName = "", myId = "";
let hostConn = null;
const conns = new Map();
let players = [];                 // [{id,name,role,ready,done,total}]
let scene = null;
let localVideoBuf = null, videoBlobUrl = null;
let micStream = null;
let audioCtx = null;
let mixItems = [];                // [{role, startAt, buffer}]
let playNodes = [];
let syncOffsetMs = 0;

const $ = (id) => document.getElementById(id);
let show = (id) => { document.querySelectorAll(".screen").forEach(s => s.classList.remove("active")); $(id).classList.add("active"); };
const status = (id, msg, isErr) => { const el = $(id); el.textContent = msg; el.style.color = isErr ? "var(--hot)" : ""; };
const randCode = () => String(Math.floor(1000 + Math.random() * 9000));
const esc = (s) => String(s).replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));



function watchVideoErrors(vid, statusId) {
  vid.addEventListener("error", () => {
    status(statusId, "❌ Video konnte nicht geladen werden! Wenn du gerade erst hochgeladen hast: GitHub Pages braucht 2–5 Min zum Deployen — kurz warten, dann Strg+Shift+R.", true);
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

function getCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
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
  return {
    click: () => tone(950, 0.045, "square", 0.05),
    ok:    () => { tone(660, 0.09, "triangle", 0.11); tone(990, 0.13, "triangle", 0.11, 0.09); },
    beep:  () => tone(440, 0.12, "sine", 0.14),
    go:    () => tone(880, 0.3, "sine", 0.16),
    rec:   () => tone(340, 0.14, "sine", 0.16, 0, 170),
    stop:  () => tone(170, 0.14, "sine", 0.14, 0, 340),
    done:  () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.13, "triangle", 0.1, i * 0.09)),
    err:   () => tone(150, 0.22, "sawtooth", 0.09),
  };
})();
document.addEventListener("click", e => { if (e.target.closest("button:not(:disabled)")) SFX.click(); });
window.addEventListener("DOMContentLoaded", () => {
  watchVideoErrors($("preview"), "lobby-status");
  watchVideoErrors($("booth-video"), "booth-status");
  watchVideoErrors($("play-video"), "play-status");
});
document.body.insertAdjacentHTML("beforeend",
  `<button id="patchnotes-btn" style="position:fixed;left:10px;bottom:8px;z-index:99;font-size:.68rem;color:#8a8aa0;letter-spacing:.08em;background:#14141b;border:1px solid var(--line);border-radius:99px;padding:3px 10px;cursor:pointer">v${APP_VERSION} · 📋 Patch Notes</button>
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
      <div style="font-family:'Archivo Black';color:var(--amber);margin-bottom:6px">v${g.v}</div>
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


// Name & Mikro-Einstellungen merken (bleibt im Browser gespeichert)
try {
  const savedName = localStorage.getItem("ss_name");
  if (savedName) window.addEventListener("DOMContentLoaded", () => { $("in-name").value = savedName; });
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
  { img: "scenes/godfather/peter.png", label: "Peter" },
  { img: "scenes/godfather/familie.png", label: "Lois" },
  { img: "scenes/tojigojo/toji.png", label: "Toji" },
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
];
let myAvatar = null;
try { const a = localStorage.getItem("ss_avatar"); if (a) myAvatar = JSON.parse(a); } catch {}

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
  headphones: { label: "🎧 Kopfhörer", svg: `<svg viewBox="0 0 100 100" style="position:absolute;top:-14%;left:0;width:100%;height:100%;overflow:visible">
    <path d="M14,52 A36,36 0 0 1 86,52" fill="none" stroke="#e0e0e8" stroke-width="7" stroke-linecap="round"/>
    <rect x="6" y="46" width="16" height="26" rx="7" fill="#c9483a" stroke="#7a1f16" stroke-width="2"/>
    <rect x="78" y="46" width="16" height="26" rx="7" fill="#c9483a" stroke="#7a1f16" stroke-width="2"/>
  </svg>` },
  crown: { label: "👑 Krone", svg: `<svg viewBox="0 0 100 60" style="position:absolute;top:-34%;left:0;width:100%;height:55%;overflow:visible">
    <path d="M10,50 L10,26 L30,40 L50,14 L70,40 L90,26 L90,50 Z" fill="#ffc95c" stroke="#a87a1a" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="50" cy="12" r="5" fill="#ff6b6b"/>
  </svg>` },
  halo: { label: "😇 Heiligenschein", svg: `<svg viewBox="0 0 100 40" style="position:absolute;top:-38%;left:0;width:100%;height:40%;overflow:visible">
    <ellipse cx="50" cy="20" rx="26" ry="9" fill="none" stroke="#ffe38a" stroke-width="6"/>
  </svg>` },
  horns: { label: "😈 Teufelshörner", svg: `<svg viewBox="0 0 100 60" style="position:absolute;top:-24%;left:0;width:100%;height:55%;overflow:visible">
    <path d="M22,44 Q10,20 26,6 Q22,26 34,38 Z" fill="#c9312b" stroke="#6e130f" stroke-width="2"/>
    <path d="M78,44 Q90,20 74,6 Q78,26 66,38 Z" fill="#c9312b" stroke="#6e130f" stroke-width="2"/>
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
  grid.innerHTML = `<div class="avatar-section-label">Emoji</div><div class="avatar-row">${emojiHtml}</div>
    <div class="avatar-section-label">Aus unseren Szenen</div><div class="avatar-row">${charHtml}</div>`;
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
  wrap.innerHTML = `<button class="avatarbtn accbtn" data-acc="" title="Kein Accessoire">🚫</button>` +
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

async function buildMic() {
  try {
    if (micStream) micStream.getTracks().forEach(t => t.stop());
    micStream = await navigator.mediaDevices.getUserMedia({ audio: {
      deviceId: micSettings.deviceId ? { exact: micSettings.deviceId } : undefined,
      echoCancellation: micSettings.ec,
      noiseSuppression: micSettings.ns,
      autoGainControl: micSettings.agc
    }});
    const ctx = getCtx();
    if (!recDest) {
      recDest = ctx.createMediaStreamDestination();
      micHP = ctx.createBiquadFilter(); micHP.type = "highpass";
      micGateNode = ctx.createGain();   // wird NICHT mehr ins Signal eingebunden — nur noch Analyse-Wert fürs Lämpchen
      micGain = ctx.createGain();
      vizAn = ctx.createAnalyser(); vizAn.fftSize = 256;
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
    status("mic-status", "Kein Mikro-Zugriff — im Browser oben links erlauben!", true);
    SFX.err();
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
function startGateLoop() {
  const buf = new Float32Array(gateAn.fftSize);
  (function loop() {
    requestAnimationFrame(loop);
    if (!micStream) return;
    const thr = micSettings.gate * 0.16;            // Slider 0..1 → Schwelle 0..0.16 RMS (deutlich stärker)
    if (thr <= 0) { if (!gateOpen) { micGateNode.gain.setTargetAtTime(1, audioCtx.currentTime, 0.01); gateOpen = true; } return; }
    gateAn.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const now = performance.now();
    if (rms > thr) lastLoudT = now;
    if (rms > thr && !gateOpen) { micGateNode.gain.setTargetAtTime(1, audioCtx.currentTime, 0.004); gateOpen = true; }
    else if (gateOpen && now - lastLoudT > 200) { micGateNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05); gateOpen = false; }
    const lamp = $("gate-lamp"), lamp2 = $("booth-gate-lamp");
    if (lamp) lamp.style.background = gateOpen ? "var(--ok)" : "#3a3a46";
    if (lamp2) lamp2.style.background = gateOpen ? "var(--ok)" : "#3a3a46";
  })();
}

function recStream() { return recDest.stream; }
async function ensureMic() { return micStream ? true : buildMic(); }

async function populateDevices() {
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput");
    $("mic-device").innerHTML = devs.map(d => `<option value="${d.deviceId}">${esc(d.label || "Mikrofon")}</option>`).join("");
    if (micSettings.deviceId) $("mic-device").value = micSettings.deviceId;
  } catch {}
}


// ── Dual-Waveform: lila = Original-Referenz-Peaks (statisch), blau = eigene Stimme (live während Aufnahme) ──
const refPeaksCache = new Map();
async function getRefPeaks(l, cols) {
  const key = l.idx;
  if (refPeaksCache.has(key)) return refPeaksCache.get(key);
  try {
    const buffer = await getLineOrigBuffer(l);
    if (!buffer) return null;
    const raw = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(raw.length / cols));
    const peaks = new Float32Array(cols);
    for (let i = 0; i < cols; i++) {
      let max = 0;
      for (let j = i * step; j < Math.min((i + 1) * step, raw.length); j++) { const a = Math.abs(raw[j]); if (a > max) max = a; }
      peaks[i] = max;
    }
    const result = { peaks, duration: buffer.duration };
    refPeaksCache.set(key, result);
    return result;
  } catch { return null; }
}

let liveVoicePeaks = null, liveVoiceIdx = 0, currentRefPeaks = null, recording = false, livePeakHold = null;
function startDualViz(canvasId, l, recMaxSec) {
  const canvas = $(canvasId), g = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const data = new Uint8Array(vizAn.frequencyBinCount);
  const COLS = 176;   // feinere Aufloesung fuer mehr Detail in der Wellenform
  liveVoicePeaks = new Float32Array(COLS);
  livePeakHold = new Float32Array(COLS);
  liveVoiceIdx = 0;
  currentRefPeaks = null;
  getRefPeaks(l, COLS).then(r => { currentRefPeaks = r; });
  cancelAnimationFrame(vizRAF);
  const t0 = performance.now();
  (function draw() {
    vizRAF = requestAnimationFrame(draw);
    const W = canvas.clientWidth * dpr, H = canvas.clientHeight * dpr;
    if (canvas.width !== W) { canvas.width = W; canvas.height = H; }
    g.clearRect(0, 0, W, H);
    const mid = H / 2, colW = W / COLS;

    // Feine Mittellinie als Referenz
    g.fillStyle = "rgba(255,255,255,.08)";
    g.fillRect(0, mid - dpr * 0.4, W, dpr * 0.8);

    // Lila Hintergrund: Original-Referenz, gestaucht auf ihre eigene Dauer relativ zu recMaxSec
    if (currentRefPeaks) {
      const refGrad = g.createLinearGradient(0, mid - H * 0.42, 0, mid + H * 0.42);
      refGrad.addColorStop(0, "rgba(232,150,255,.65)"); refGrad.addColorStop(1, "rgba(160,50,220,.5)");
      const refCols = Math.max(1, Math.round(COLS * Math.min(1, currentRefPeaks.duration / recMaxSec)));
      for (let i = 0; i < refCols; i++) {
        const srcI = Math.floor(i * currentRefPeaks.peaks.length / refCols);
        const h = Math.max(1 * dpr, currentRefPeaks.peaks[srcI] * H * 0.85);
        g.fillStyle = refGrad;
        g.fillRect(i * colW, mid - h / 2, Math.max(1, colW - dpr * 0.3), h);
      }
    }

    // Blaue Live-Aufnahme: aktueller Mikro-Pegel wird fortlaufend als eigener Balken angehängt
    if (recording) {
      vizAn.getByteFrequencyData(data);
      let sum = 0; for (let i = 0; i < 24; i++) sum += data[i];
      const level = Math.min(1, (sum / 24 / 255) * 1.6);
      const elapsed = (performance.now() - t0) / 1000;
      const col = Math.min(COLS - 1, Math.floor((elapsed / recMaxSec) * COLS));
      liveVoicePeaks[col] = Math.max(liveVoicePeaks[col], level);
      liveVoiceIdx = col;
    }
    const liveGrad = g.createLinearGradient(0, mid - H * 0.42, 0, mid + H * 0.42);
    liveGrad.addColorStop(0, "rgba(140,200,255,.95)"); liveGrad.addColorStop(1, "rgba(60,130,240,.85)");
    for (let i = 0; i <= liveVoiceIdx; i++) {
      const h = Math.max(1 * dpr, liveVoicePeaks[i] * H * 0.85);
      g.fillStyle = liveGrad;
      g.shadowColor = "rgba(90,170,255,.5)"; g.shadowBlur = 3 * dpr;
      g.fillRect(i * colW, mid - h / 2, Math.max(1, colW - dpr * 0.3), h);
      g.shadowBlur = 0;
      // Peak-Hold: langsam abklingender heller Strich am bisher lautesten Punkt dieser Spalte
      livePeakHold[i] = Math.max(liveVoicePeaks[i] * 0.999, (livePeakHold[i] || 0) * 0.985);
      const ph = livePeakHold[i] * H * 0.85;
      if (ph > h) {
        g.fillStyle = "rgba(220,240,255,.9)";
        g.fillRect(i * colW, mid - ph / 2, Math.max(1, colW - dpr * 0.3), Math.max(1, dpr * 0.8));
        g.fillRect(i * colW, mid + ph / 2 - dpr * 0.8, Math.max(1, colW - dpr * 0.3), Math.max(1, dpr * 0.8));
      }
    }
    // Fortschritts-Linie
    if (recording) {
      const elapsed = Math.min(recMaxSec, (performance.now() - t0) / 1000);
      const px = (elapsed / recMaxSec) * W;
      g.fillStyle = "#f0f0f5";
      g.fillRect(px, 0, Math.max(1, 1.5 * dpr), H);
    }
  })();
}


// ── Statische Vorschau der Original-Wellenform, bevor man überhaupt aufnimmt ──
function drawStaticRefViz() {
  const canvas = $("viz");
  if (!canvas) return;
  const g = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth * dpr, H = canvas.clientHeight * dpr;
  if (canvas.width !== W) { canvas.width = W; canvas.height = H; }
  g.clearRect(0, 0, W, H);
  const mid = H / 2;
  g.fillStyle = "rgba(255,255,255,.08)";
  g.fillRect(0, mid - dpr * 0.4, W, dpr * 0.8);
  if (!currentRefPeaks) return;
  const COLS = currentRefPeaks.peaks.length, colW = W / COLS;
  const grad = g.createLinearGradient(0, mid - H * 0.42, 0, mid + H * 0.42);
  grad.addColorStop(0, "rgba(232,150,255,.65)"); grad.addColorStop(1, "rgba(160,50,220,.5)");
  for (let i = 0; i < COLS; i++) {
    const h = Math.max(1 * dpr, currentRefPeaks.peaks[i] * H * 0.85);
    g.fillStyle = grad;
    g.fillRect(i * colW, mid - h / 2, Math.max(1, colW - dpr * 0.3), h);
  }
}
function previewRefViz(l) {
  cancelAnimationFrame(vizRAF);
  currentRefPeaks = null; recording = false;
  const canvas = $("viz");
  if (canvas) { const g = canvas.getContext("2d"); g.clearRect(0, 0, canvas.width, canvas.height); }
  getRefPeaks(l, 176).then(r => { currentRefPeaks = r; drawStaticRefViz(); });
}

function startVizOn(canvasId) {
  const canvas = $(canvasId), g = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const data = new Uint8Array(vizAn.frequencyBinCount);
  cancelAnimationFrame(vizRAF);
  (function draw() {
    vizRAF = requestAnimationFrame(draw);
    const W = canvas.clientWidth * dpr, H = canvas.clientHeight * dpr;
    if (canvas.width !== W) { canvas.width = W; canvas.height = H; }
    g.clearRect(0, 0, W, H);
    vizAn.getByteFrequencyData(data);
    const bars = 48, bw = W / bars;
    for (let i = 0; i < bars; i++) {
      const v = data[Math.floor(i * data.length / bars / 1.6)] / 255;
      const h = Math.max(2 * dpr, v * H * 0.95);
      const grad = g.createLinearGradient(0, H, 0, H - h);
      grad.addColorStop(0, "#ffc95c"); grad.addColorStop(0.6, "#ff4d55"); grad.addColorStop(1, "#c84bff");
      g.fillStyle = grad;
      g.fillRect(i * bw + bw * 0.18, H - h, bw * 0.64, h);
    }
  })();
}

// Setup-Screen
async function initMicScreen() {
  const ok = await buildMic();
  if (!ok) return;
  await populateDevices();
  // Gespeicherte Einstellungen in die UI übernehmen
  $("mic-ns").checked = micSettings.ns; $("mic-ec").checked = micSettings.ec;
  $("mic-agc").checked = micSettings.agc; $("mic-lowcut").checked = micSettings.lowcut;
  $("mic-gain").value = micSettings.gain; $("mic-gain-val").textContent = Math.round(micSettings.gain * 100) + "%";
  $("mic-gate").value = micSettings.gate; $("mic-gate-val").textContent = micSettings.gate <= 0 ? "Aus" : Math.round(micSettings.gate * 100) + "%";
  startVizOn("mic-viz");
  $("btn-mic-done").disabled = false;
  status("mic-status", "Sprich rein — die Bars sollen ausschlagen. Dann Test aufnehmen!");
}
$("btn-mic-record").onclick = async () => {
  if (!micStream) { await initMicScreen(); if (!micStream) return; }
  status("mic-status", "🎤 Sprich jetzt 3 Sekunden …");
  const rec = new MediaRecorder(recStream(), { mimeType: pickMime() });
  const chunks = [];
  rec.ondataavailable = e => chunks.push(e.data);
  rec.onstop = async () => {
    status("mic-status", "So klingst du in der Aufnahme:");
    const ctx = getCtx();
    const buf = await ctx.decodeAudioData(await new Blob(chunks).arrayBuffer());
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start();
    src.onended = () => { status("mic-status", "Passt? Dann weiter — sonst Regler anpassen und nochmal testen."); $("btn-mic-done").disabled = false; };
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
$("mic-device").onchange = e => { micSettings.deviceId = e.target.value; buildMic(); };
$("mic-ns").onchange = e => { micSettings.ns = e.target.checked; buildMic(); };
$("mic-ec").onchange = e => { micSettings.ec = e.target.checked; buildMic(); };
$("mic-agc").onchange = e => { micSettings.agc = e.target.checked; buildMic(); };
$("mic-lowcut").onchange = e => { micSettings.lowcut = e.target.checked; applyMicTuning(); };
$("btn-mic-raw").onclick = () => {
  Object.assign(micSettings, { ns: false, ec: false, agc: false, lowcut: false, gate: 0 });
  $("mic-ns").checked = $("mic-ec").checked = $("mic-agc").checked = $("mic-lowcut").checked = false;
  $("mic-gate").value = 0; $("mic-gate-val").textContent = "Aus";
  buildMic();
  status("mic-status", "🎙 Roh-Modus: Alle Filter aus — pur wie dein Mikro klingt. (Kopfhörer Pflicht, sonst Echo!)");
};
$("mic-gain").oninput = e => { micSettings.gain = parseFloat(e.target.value); $("mic-gain-val").textContent = Math.round(micSettings.gain * 100) + "%"; applyMicTuning(); };
$("mic-gate").oninput = e => {
  micSettings.gate = parseFloat(e.target.value);
  $("mic-gate-val").textContent = micSettings.gate <= 0 ? "Aus" : Math.round(micSettings.gate * 100) + "%";
  syncBoothGateUI();
};
function syncBoothGateUI() {
  const bg = $("booth-gate"), bv = $("booth-gate-val");
  if (!bg) return;
  bg.value = micSettings.gate;
  bv.textContent = micSettings.gate <= 0 ? "Aus" : Math.round(micSettings.gate * 100) + "%";
}
$("booth-gate").oninput = e => {
  micSettings.gate = parseFloat(e.target.value);
  saveMic();
  syncBoothGateUI();
  $("mic-gate").value = micSettings.gate;
  $("mic-gate-val").textContent = micSettings.gate <= 0 ? "Aus" : Math.round(micSettings.gate * 100) + "%";
};
// Beim ersten Klick irgendwo den Setup starten (AudioContext braucht eine Geste)
document.addEventListener("click", function once() { if (document.querySelector("#scr-mic.active") && !micStream) initMicScreen(); }, { once: true });


// ═════════════════════════════════════════════════════════════
// 1) RAUM ERSTELLEN / BEITRETEN
// ═════════════════════════════════════════════════════════════
$("btn-create").onclick = () => {
  myName = $("in-name").value.trim();
  if (!myName) return status("start-status", "Erst Namen eingeben, digga 😄", true), SFX.err();
  saveName();
  isHost = true;
  const code = randCode();
  status("start-status", "① Verbinde zum Vermittlungsserver …");
  let opened = false;
  setTimeout(() => {
    if (!opened) status("start-status", "❌ Kein Kontakt zum Vermittlungsserver. Fast immer: Brave-Shields / Adblocker — für diese Seite ausschalten und neu laden.", true);
  }, 10000);
  peer = new Peer(PEER_PREFIX + code, PEER_CONFIG);
  peer.on("open", () => {
    opened = true;
    myId = peer.id;
    players = [{ id: myId, name: myName + " (Host)", avatar: myAvatar, accessory: myAccessory, role: null, ready: false, done: 0, total: 0 }];
    enterLobby(code);
    loadSceneList();
  });
  peer.on("connection", (conn) => setupHostConn(conn));
  peer.on("error", (e) => {
    if (e.type === "unavailable-id") { peer.destroy(); $("btn-create").click(); }
    else status("start-status", "Verbindungsfehler: " + e.type, true);
  });
};

$("btn-join").onclick = () => {
  myName = $("in-name").value.trim();
  const code = $("in-code").value.trim();
  if (!myName) return status("start-status", "Erst Namen eingeben 🙂", true), SFX.err();
  if (!/^\d{4}$/.test(code)) return status("start-status", "Der Raumcode hat 4 Ziffern.", true), SFX.err();
  saveName();
  isHost = false;
  status("start-status", "① Verbinde zum Vermittlungsserver …");
  let opened = false, joined = false;
  peer = new Peer(PEER_CONFIG);

  // Schritt 1 hängt → Server nicht erreichbar (Brave-Shields, Adblocker, Firewall)
  setTimeout(() => {
    if (!opened) status("start-status", "❌ Kein Kontakt zum Vermittlungsserver. Fast immer: Brave-Shields / Adblocker blockt — Schild-Icon anklicken, für diese Seite ausschalten, neu laden. Oder kurz in Chrome/Firefox testen.", true);
  }, 10000);

  peer.on("open", () => {
    opened = true;
    myId = peer.id;
    status("start-status", "② Server OK — suche Raum " + code + " …");
    hostConn = peer.connect(PEER_PREFIX + code, { reliable: true });

    // Schritt 2 hängt → Raum existiert, aber Peer-Verbindung kommt nicht durch (NAT/Firewall)
    setTimeout(() => {
      if (!joined) status("start-status", "❌ Raum gefunden, aber die Verbindung zum Host kommt nicht durch. Beide mal: anderes Netz testen (z. B. Handy-Hotspot), VPN aus, Brave-Shields aus.", true);
    }, 15000);

    hostConn.on("open", () => { joined = true; hostConn.send({ t: "hello", name: myName, avatar: myAvatar, accessory: myAccessory }); enterLobby(code); });
    // Debug: ICE-Status in der Console (F12) verfolgen
    const watchIce = setInterval(() => {
      const pc = hostConn.peerConnection;
      if (!pc) return;
      console.log("ICE:", pc.iceConnectionState, "| Gathering:", pc.iceGatheringState);
      if (joined || pc.iceConnectionState === "failed") clearInterval(watchIce);
      if (pc.iceConnectionState === "failed")
        status("start-status", "❌ ICE failed — Direktverbindung UND TURN-Relay fehlgeschlagen. Jetzt hilft: eigener TURN-Zugang (steht in client.js ganz oben, 5 Min, gratis).", true);
    }, 2000);
    hostConn.on("data", (msg) => handleMsg(msg, hostConn));
    hostConn.on("close", () => status("lobby-status", "Verbindung zum Host weg 😬 Seite neu laden.", true));
    hostConn.on("error", (e) => { console.error("conn error", e); status("start-status", "Verbindungsfehler zum Host: " + (e.type || e), true); });
  });
  peer.on("error", (e) => {
    console.error("peer error", e);
    if (e.type === "peer-unavailable") status("start-status", "Raum " + code + " nicht gefunden. Läuft der Host noch? Code richtig?", true);
    else status("start-status", "Verbindungsfehler: " + e.type + " — F12 → Console für Details.", true);
  });
};



// ═════════════════════════════════════════════════════════════
// LOBBY-MUSIK — spielt nur in Lobby & Warte-Screens, nie ingame
// ═════════════════════════════════════════════════════════════
const lobbyAudio = new Audio("scenes/lobby_music.mp3");
lobbyAudio.loop = true;
let musicVol = 0.35, musicOn = true;
try {
  const mv = localStorage.getItem("ss_musicvol"); if (mv !== null) musicVol = parseFloat(mv);
  const mo = localStorage.getItem("ss_musicon"); if (mo !== null) musicOn = mo === "1";
} catch {}
lobbyAudio.volume = musicVol;

const MUSIC_SCREENS = new Set(["scr-mic", "scr-avatar", "scr-start", "scr-lobby", "scr-wait", "scr-final"]);

// ── Lobby-Musik-Visualizer: kleine EQ-Bars, solange Musik läuft ──
let lobbyAn = null, lobbyVizRAF = null;
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
function drawLobbyViz() {
  const canvas = document.getElementById("music-viz");
  cancelAnimationFrame(lobbyVizRAF);
  if (!canvas) return;
  const g = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  (function loop() {
    lobbyVizRAF = requestAnimationFrame(loop);
    const W = canvas.clientWidth * dpr, H = canvas.clientHeight * dpr;
    if (!W || !H) return;
    if (canvas.width !== W) { canvas.width = W; canvas.height = H; }
    g.clearRect(0, 0, W, H);
    if (!musicOn || lobbyAudio.paused || !lobbyAn) return;
    const data = new Uint8Array(lobbyAn.frequencyBinCount);
    lobbyAn.getByteFrequencyData(data);
    const bars = 16, bw = W / bars;
    for (let i = 0; i < bars; i++) {
      const v = data[i * 2] / 255;
      const h = Math.max(2 * dpr, v * H);
      g.fillStyle = "rgba(255,201,92,.85)";
      g.fillRect(i * bw + bw * 0.2, H - h, bw * 0.6, h);
    }
  })();
}

function updateLobbyMusic() {
  const active = document.querySelector(".screen.active")?.id;
  const want = musicOn && MUSIC_SCREENS.has(active);
  if (want) { ensureLobbyAnalyser(); lobbyAudio.play().catch(() => {}); }
  else { lobbyAudio.pause(); }
  const btn = $("music-toggle");
  if (btn) btn.textContent = musicOn ? "🎵" : "🔇";
  const sl = $("music-vol"); if (sl) sl.value = musicVol;
}
// show() um Musik-Update erweitern
const _origShow = show;
show = function(id) {
  _origShow(id);
  updateLobbyMusic();
  if (id === "scr-lobby" || id === "scr-wait") startTipRotation(); else clearInterval(tipTimer);
  // Ingame (Booth/Aufnahme) ruhig halten: keine Ablenkung
  const calm = id === "scr-booth" || id === "scr-record";
  const f = document.getElementById("floaties");
  if (f) f.style.display = calm ? "none" : "";
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
  drawLobbyViz();
});
// Autoplay-Freischaltung beim ersten Klick
document.addEventListener("click", () => { if (musicOn) lobbyAudio.play().catch(() => {}); }, { once: true });


// ═════════════════════════════════════════════════════════════
// EMOJI-REAKTIONEN — synchron bei allen sichtbar, gegen Lobby-Langeweile
// ═════════════════════════════════════════════════════════════
function emojiAction(char) {
  if (isHost) emojiBroadcast(myId, char);
  else hostConn.send({ t: "emoji", char });
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
const LOBBY_TIPS = [
  "💡 Tipp: Kopfhörer aufsetzen — sonst hört dein Mikro den Video-Sound mit!",
  "🎲 Rollen-Roulette würfelt die Besetzung zufällig — gut gegen Diskussionen.",
  "🕶 Blind-Modus: keine Übersetzung, kein Original — reines Improvisieren.",
  "🐢 Im Editor kannst du Szenen in 0.5× ansehen, um Lippen besser zu timen.",
  "🎮 Während ihr wartet: TicTacToe, Klick-Battle, Reaktions-Duell und Tipp-Renner warten unten!",
  "🗣 „Original anhören” zeigt dir die echte Betonung, bevor du aufnimmst.",
  "⭐ Nach jeder Runde bewertet ihr euch gegenseitig — bester Sprecher kriegt die Krone 👑",
  "⬇ Das fertige Ergebnis lässt sich als Video speichern — perfekt für TikTok.",
  "🎨 Baut euch eigene Szenen im Szenen-Editor — kein Choicer-Voicer-Pack nötig.",
];
let tipIdx = 0, tipTimer = null;
function rotateTip() {
  const el = document.getElementById("lobby-tip");
  if (!el) return;
  el.style.opacity = "0";
  setTimeout(() => { el.textContent = LOBBY_TIPS[tipIdx % LOBBY_TIPS.length]; tipIdx++; el.style.opacity = "1"; }, 300);
}
function startTipRotation() {
  clearInterval(tipTimer);
  rotateTip();
  tipTimer = setInterval(rotateTip, 7000);
}


// ── Mini-Konfetti: kleiner Belohnungsmoment beim "Bin bereit" ──
function burstConfetti() {
  const layer = document.getElementById("emoji-layer");
  if (!layer) return;
  const colors = ["#ffc95c", "#ff4d55", "#c84bff"];
  for (let i = 0; i < 18; i++) {
    const p = document.createElement("div");
    p.className = "confetti-bit";
    p.style.left = (40 + Math.random() * 20) + "%";
    p.style.background = colors[i % colors.length];
    p.style.setProperty("--dx", (Math.random() * 200 - 100) + "px");
    p.style.setProperty("--rot", (Math.random() * 720 - 360) + "deg");
    p.style.animationDelay = (Math.random() * 0.15) + "s";
    layer.appendChild(p);
    setTimeout(() => p.remove(), 1600);
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
function leaveRoom() {
  try { if (lineRec && lineRec.state === "recording") lineRec.stop(); } catch {}
  clearInterval(recTimer); clearInterval(cbTimer);
  playNodes.forEach(n => { try { n.stop(); } catch {} }); playNodes = [];
  ["preview","booth-video","play-video","rec-video"].forEach(id => { const v = $(id); if (v) { v.pause(); v.removeAttribute("src"); v.load(); } });
  try { peer && peer.destroy(); } catch {}
  peer = null; hostConn = null; conns.clear();
  isHost = false; players = []; scene = null;
  localVideoBuf = null; videoBlobUrl = null;
  takes = {}; myLines = []; curLine = 0; mixItems = []; collected.clear();
  ttt = { p: [], board: Array(9).fill(null), turn: 0, winner: null };
  match = { rounds: 1, round: 1, totals: {}, autoRoulette: false };
  Object.keys(mgWins).forEach(k => delete mgWins[k]);
  $("host-settings").style.display = "none";
  match.mode = "free";
  $("onair").classList.remove("live");
  $("host-scene").style.display = "none";
  $("host-start").style.display = "none";
  $("scene-card").style.display = "none";
  $("leave-btn").style.display = "none";
  status("start-status", "Raum verlassen. Du kannst direkt einen neuen erstellen oder beitreten.");
  show("scr-start");
  SFX.stop();
}
document.body.insertAdjacentHTML("beforeend",
  `<button id="leave-btn" style="position:fixed;right:12px;bottom:10px;z-index:98;display:none;padding:8px 14px;font-size:.82rem;background:#1f1f28;border:1px solid var(--line);border-radius:8px;color:var(--muted)">🚪 Raum verlassen</button>`);
$("leave-btn").onclick = () => {
  if (confirm("Raum wirklich verlassen?" + (isHost ? " Du bist Host — der Raum wird für alle geschlossen!" : ""))) leaveRoom();
};

function enterLobby(code) {
  $("lobby-code").textContent = code;
  if (isHost) { $("host-scene").style.display = ""; $("host-start").style.display = ""; }
  show("scr-lobby");
  renderPlayers();
  $("leave-btn").style.display = "";
  if (isHost) {
    $("host-settings").style.display = "";
    $("set-mode").onchange = hostSettingsChanged;
    $("set-rounds").onchange = hostSettingsChanged;
    $("set-roulette").onchange = hostSettingsChanged;
    hostSettingsChanged();
  }
  renderSettingsView();
  SFX.ok();
}

// ═════════════════════════════════════════════════════════════
// 2) NACHRICHTEN
// ═════════════════════════════════════════════════════════════
function setupHostConn(conn) {
  conn.on("open", () => conns.set(conn.peer, conn));
  conn.on("data", (msg) => handleMsg(msg, conn));
  conn.on("close", () => { conns.delete(conn.peer); players = players.filter(p => p.id !== conn.peer); broadcastState(); });
}
function broadcast(msg) { conns.forEach(c => { if (c.open) c.send(msg); }); }
function broadcastState() { renderPlayers(); renderBoothPlayers(); broadcast({ t: "state", players }); checkStartable(); checkAllDone(); if (isHost) renderPremState(); }

function handleMsg(msg, conn) {
  switch (msg.t) {
    // — beim Host —
    case "hello": {
      if (players.length >= 8) { conn.send({ t: "full", cap: 8 }); setTimeout(() => conn.close(), 500); break; }
      players.push({ id: conn.peer, name: msg.name, avatar: msg.avatar || null, accessory: msg.accessory || null, role: null, ready: false, done: 0, total: 0 });
      if (scene) { if (localVideoBuf) sendLocalVideo(conn); else conn.send({ t: "scene", scene }); }
      broadcastState();
      break;
    }
    case "pickRole": {
      const taken = players.some(p => p.role === msg.role && p.id !== conn.peer);
      if (!taken) { const p = players.find(p => p.id === conn.peer); if (p) { p.role = msg.role; p.ready = false; } }
      broadcastState(); break;
    }
    case "ready": { const p = players.find(p => p.id === conn.peer); if (p && p.role != null) p.ready = true; broadcastState(); break; }
    case "progress": { const p = players.find(p => p.id === conn.peer); if (p) { p.done = msg.done; p.total = msg.total; } broadcastState(); break; }
    case "tracks": collectTracks(msg.role, msg.items); break;
    case "trackUpdate": applyTrackUpdate(msg.role, msg.lineIdx, msg.startAt, msg.buf, msg.effect, msg.gate); break;
    case "ttt": tttHandle(msg.a, conn.peer); break;
    case "rps": rpsHandle(msg.a, conn.peer); break;
    case "dice": diceHandle(msg.a, conn.peer); break;
    case "rate": collectRating(conn.peer, msg.scores); break;
    case "mg":
      if (msg.k === "rxStart") { const d = 1500 + Math.random() * 3500; broadcast({ t: "rxGo", delay: d }); rxRun(d); }
      if (msg.k === "tpStart") { const ph = TP_PHRASES[Math.floor(Math.random() * TP_PHRASES.length)]; broadcast({ t: "tpGo", phrase: ph }); tpRun(ph); }
      if (msg.k === "rxScore") mgScore("rx", conn.peer, msg.ms);
      if (msg.k === "tpScore") mgScore("tp", conn.peer, msg.ms);
      break;
    case "emoji": emojiBroadcast(conn.peer, msg.char); break;
    case "premReady": { const p = players.find(p => p.id === conn.peer); if (p) p.prem = true; broadcastState(); renderPremState(); break; }
    case "cb":
      if (msg.a.k === "start") { broadcast({ t: "cbGo" }); cbRun(); }
      if (msg.a.k === "score") cbScore(conn.peer, msg.a.n);
      break;

    // — bei Gästen —
    case "full":
      status("start-status", "Raum ist voll — diese Szene hat nur " + msg.cap + " Rollen. 😅", true);
      show("scr-start"); break;
    case "state": players = msg.players; renderPlayers(); renderRoles(); renderBoothPlayers(); if (document.querySelector("#scr-playback.active")) renderPremStateGuest(); break;
    case "scene": scene = msg.scene; videoBlobUrl = null; voiceTrackBuf = null; voiceTrackTried = false; showScene(scene.videoUrl); break;
    case "settings": match.mode = msg.mode; match.rounds = msg.rounds; match.round = msg.round; match.autoRoulette = msg.autoRoulette; renderSettingsView(msg); break;
    case "sceneReset":
      scene = null; videoBlobUrl = null;
      $("scene-card").style.display = "none";
      renderPlayers();
      break;
    case "duelSetupInfo": duelInfo = msg.duelInfo; break;
    case "duelSubmit": collectDuelSubmit(msg.playerId, msg.items); break;
    case "duelReady": loadDuelSequence(msg.dataA, msg.dataB, msg.duelInfo); break;
    case "duelVote": collectDuelVote(conn.peer, msg.choice); break;
    case "duelVoteBroadcast": showDuelVoteLive(msg.tally); break;
    case "duelResult": showDuelResult(msg.result); break;
    case "wins": Object.assign(mgWins, msg.wins); renderWins(); break;
    case "nextRound":
      match.round = msg.round; players = msg.players;
      if (msg.scene) { scene = msg.scene; videoBlobUrl = null; backToLobby(true); showScene(scene.videoUrl); renderSettingsView(); status("lobby-status", "🎲 Runde " + match.round + ": neue Szene & Rollen! „Bin bereit“ drücken."); }
      else startNewRound();
      break;
    case "matchEnd": showFinal(msg.list, msg.rounds, msg.championName); break;
    case "matchLobby": backToLobby(); break;
    case "videoMeta": startVideoReceive(msg); break;
    case "videoChunk": receiveVideoChunk(msg.buf); break;
    case "goLines": startBooth(); break;
    case "go": startRealtime(); break;
    case "mix": loadMix(msg.data); break;
    case "tttState": ttt = msg.ttt; renderTTT(); break;
    case "rpsState": rps = msg.rps; renderRPS(); break;
    case "diceState": dice = msg.dice; renderDice(); break;
    case "premGo": premStart(); break;
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

// ── Schwierigkeitsgrad einer Szene (automatisch berechnet aus Tempo & Zeitfenstern) ──
function sceneDifficulty(s) {
  if (s.difficultyOverride) {
    const map = { easy: { label: "Easy", emoji: "🟢" }, medium: { label: "Medium", emoji: "🟡" }, hard: { label: "Zungenbrecher", emoji: "🔴" } };
    if (map[s.difficultyOverride]) return map[s.difficultyOverride];
  }
  if (!s.lines || !s.lines.length) return null;
  const lines = s.lines;
  const dur = Math.max(...lines.map(l => l.end)) - Math.min(...lines.map(l => l.t));
  const words = lines.reduce((sum, l) => sum + (l.text || "").split(/\s+/).filter(Boolean).length, 0);
  const wps = words / Math.max(1, dur);
  const avgWin = lines.reduce((sum, l) => sum + (l.end - l.t), 0) / lines.length;
  const avgWords = words / lines.length;
  const score = wps * 1.4 - avgWin * 0.25 + avgWords * 0.05;
  if (score < 2.0) return { label: "Easy", emoji: "🟢" };
  if (score < 3.2) return { label: "Medium", emoji: "🟡" };
  return { label: "Zungenbrecher", emoji: "🔴" };
}

async function loadSceneList() {
  const sel = $("scene-select");
  if (!sel) return;
  try {
    const res = await fetch("scenes.json?t=" + Date.now(), { cache: "no-store" });
    sceneList = await res.json();
  } catch (e) {
    console.error("scenes.json laden fehlgeschlagen:", e);
    sceneList = [];
  }
  sel.innerHTML = sceneList.length
    ? sceneList.map((s, i) => {
        const d = sceneDifficulty(s);
        return `<option value="${i}">${d ? d.emoji + " " : ""}${esc(s.title)} (${s.roles.length} Rollen${s.lines ? ", " + s.lines.length + " Lines" : ""}${d ? " · " + d.label : ""})</option>`;
      }).join("")
    : "<option>— Szenen laden… kurz warten &amp; Seite neu laden —</option>";
}

$("btn-load-scene").onclick = () => {
  const s = sceneList[$("scene-select").value];
  if (!s) return;
  scene = JSON.parse(JSON.stringify(s));       // Kopie, damit Blind-Flag das Original nicht verändert
  scene.blind = $("blind-mode").checked;
  localVideoBuf = null; videoBlobUrl = null;
  resetRoles();
  showScene(scene.videoUrl);
  broadcast({ t: "scene", scene });
  broadcastSettings();
  broadcastState();
};

const EFFECTS = {
  none: "Normal", vintage_1990: "Vintage / 90er Tape", radio: "Funkgerät", telefon: "Telefon", hall: "Halliger Raum",
  megaphone: "Megafon", underwater: "Unter Wasser", helium: "Helium", monster: "Monster", robot: "Roboter"
};

// ── Spieler kann pro Line seinen eigenen Effekt waehlen — ueberschreibt Rollen-/Szenen-Standard NUR fuer diese Line ──
let myEffectOverrides = {};   // lineIdx -> Effekt-Key (nur gesetzt, wenn vom Standard abweichend)
// ── Noise Gate NACHTRÄGLICH auf eine fertige Aufnahme anwenden (wie ein Effekt, nicht live eingebrannt) ──
function applyGateToBuffer(ctx, buffer, gateAmount) {
  if (!gateAmount || gateAmount <= 0) return buffer;   // Gate aus -> unverändert
  const sr = buffer.sampleRate;
  const winSize = Math.max(1, Math.round(sr * 0.01));      // 10ms-Analysefenster
  const threshold = gateAmount * 0.16;                       // gleiche Formel wie früher live
  const holdSamples = Math.round(sr * 0.2);                  // 200ms Hangover, bevor's zumacht
  const attackSamples = Math.round(sr * 0.004);               // schnelles Öffnen
  const releaseSamples = Math.round(sr * 0.05);               // sanftes Schließen

  const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, sr);
  const nWindows = Math.ceil(buffer.length / winSize);
  const rms = new Float32Array(nWindows);
  for (let w = 0; w < nWindows; w++) {
    let sum = 0, count = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      const start = w * winSize, end = Math.min(buffer.length, start + winSize);
      for (let i = start; i < end; i++) { sum += data[i] * data[i]; count++; }
    }
    rms[w] = count ? Math.sqrt(sum / count) : 0;
  }
  const targetOpen = new Uint8Array(nWindows);
  let lastLoudWin = -Infinity;
  for (let w = 0; w < nWindows; w++) {
    if (rms[w] > threshold) lastLoudWin = w;
    targetOpen[w] = (w - lastLoudWin) * winSize <= holdSamples ? 1 : 0;
  }
  const gainCurve = new Float32Array(buffer.length);
  let currentGain = targetOpen[0] ? 1 : 0;
  for (let w = 0; w < nWindows; w++) {
    const start = w * winSize, end = Math.min(buffer.length, start + winSize);
    const target = targetOpen[w] ? 1 : 0;
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
  // Reihenfolge: Spieler-Wahl > Szenen-Autor-Override (l.effect) > Rollen-Standard
  const base = roleOf(myRole()) || { pan: 0, effect: "none", gain: 1 };
  const chosen = myEffectOverrides[l.idx];
  if (chosen) return { ...base, effect: chosen };
  return effectiveRole(base, l);
}

$("file-video").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  status("scene-status", "Lese Video ein …");
  localVideoBuf = await f.arrayBuffer();
  status("scene-status", "Video geladen (" + Math.round(localVideoBuf.byteLength / 1e6) + " MB). Jetzt Rollen einstellen." +
    (localVideoBuf.byteLength > 60e6 ? " ⚠ Groß — Übertragung dauert." : ""));
  $("local-cfg").style.display = "";
  if (!$("rolecfg-list").children.length) { addRoleCfg(); addRoleCfg(); }
};

function addRoleCfg() {
  const n = $("rolecfg-list").children.length + 1;
  if (n > 4) return;
  const div = document.createElement("div");
  div.className = "rolecfg";
  div.innerHTML = `
    <input type="text" placeholder="Charakter ${n}" value="Charakter ${n}">
    <div><label class="small">Pan L↔R</label><input type="range" min="-1" max="1" step="0.1" value="0"></div>
    <select>${Object.entries(EFFECTS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>`;
  $("rolecfg-list").appendChild(div);
}
$("btn-add-role").onclick = addRoleCfg;

$("btn-use-local").onclick = () => {
  const roles = [...$("rolecfg-list").children].map((div, i) => ({
    id: i + 1,
    name: div.querySelector("input[type=text]").value || "Charakter " + (i + 1),
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

function resetRoles() { players.forEach(p => { p.role = null; p.ready = false; p.done = 0; p.total = 0; }); }

function sendLocalVideo(conn) {
  conn.send({ t: "videoMeta", scene, size: localVideoBuf.byteLength });
  let off = 0;
  const pump = () => {
    while (off < localVideoBuf.byteLength) {
      if (conn.dataChannel && conn.dataChannel.bufferedAmount > 4e6) { setTimeout(pump, 100); return; }
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
  $("download-bar").querySelector("i").style.width = Math.round(rxOff / rxSize * 100) + "%";
  if (rxOff >= rxSize) {
    $("download-bar").style.display = "none";
    videoBlobUrl = URL.createObjectURL(new Blob([rxBuf], { type: "video/mp4" }));
    rxBuf = null;
    showScene(videoBlobUrl);
    SFX.ok();
  }
}

function showScene(src) {
  // Robust gegen unsortierte Lines-Arrays (z.B. selbstgebaute Szenen): immer chronologisch sortieren.
  // Sonst kann der Teleprompter beim "Gleich kommt..."-Hinweis die falsche Person zeigen.
  if (scene.lines && scene.lines.length) scene.lines.sort((a, b) => a.t - b.t);
  $("scene-card").style.display = "";
  $("btn-roulette").style.display = isHost ? "" : "none";
  const diff = sceneDifficulty(scene);
  $("scene-title").innerHTML = esc(scene.title) + (diff ? ` <span class="difftag diff-${diff.label.toLowerCase().replace(/[^a-z]/g,"")}">${diff.emoji} ${diff.label}</span>` : "");
  if (src) $("preview").src = src;
  renderRoles();
}

// ═════════════════════════════════════════════════════════════
// 4) LOBBY-UI
// ═════════════════════════════════════════════════════════════
function avatarColor(name) {
  let h = 0; for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 70%, 55%)`;
}
function playerCard(p) {
  const role = p.role != null && scene ? (scene.roles.find(r => r.id === p.role)?.name || "?") : null;
  const prog = p.total > 0 ? `<div class="pbar"><i style="width:${Math.round(p.done / p.total * 100)}%"></i></div><span class="tag">${p.done}/${p.total} Lines</span>` : "";
  return `<div class="player ${p.ready ? "ready" : ""}" data-pid="${p.id}" style="${p.eliminated ? "opacity:.5" : ""}">
    ${avatarHTML(p)}
    <div class="pinfo">
      <span class="pname">${esc(p.name)}</span>
      ${p.eliminated ? '<span class="prole" style="color:var(--hot)">🔪 eliminiert</span>' : `<span class="prole ${role ? "" : "empty"}">${role ? "🎭 " + esc(role) : "noch keine Rolle"}</span>`}
      ${p.ready && !p.total ? '<span class="tag" style="color:var(--ok)">bereit</span>' : ""}${prog}
    </div>
  </div>`;
}
function renderPlayers() { $("player-list").innerHTML = players.map(playerCard).join(""); }
function renderBoothPlayers() {
  const html = players.map(playerCard).join("");
  $("booth-players").innerHTML = html;
  $("wait-players").innerHTML = html;
}

function renderRoles() {
  if (!scene) return;
  const lineCount = (rid) => scene.lines ? scene.lines.filter(l => l.chars.includes(rid)).length : null;
  $("role-list").innerHTML = scene.roles.map(r => {
    const owner = players.find(p => p.role === r.id);
    const mine = owner && owner.id === myId;
    const lc = lineCount(r.id);
    return `<button class="rolebtn ${mine ? "mine" : owner ? "taken" : ""}" data-r="${r.id}" ${owner && !mine ? "disabled" : ""}>
      <span>${esc(r.name)}${lc != null ? ` <span class="meta">· ${lc} Lines</span>` : ""}</span>
      <span class="meta">${owner ? esc(owner.name) : "frei"} · Pan ${r.pan > 0 ? "R" : r.pan < 0 ? "L" : "Mitte"} · ${EFFECTS[r.effect] || r.effect}</span>
    </button>`;
  }).join("");
  $("role-list").querySelectorAll(".rolebtn").forEach(b => b.onclick = () => pickRole(parseInt(b.dataset.r)));
}

function pickRole(roleId) {
  if (match.mode === "rounds") { status("lobby-status", "🎲 Im Match werden Rollen zufällig verteilt — du kannst nicht selbst wählen.", true); return; }
  if (isHost) {
    const taken = players.some(p => p.role === roleId && p.id !== myId);
    if (taken) return;
    const me = players.find(p => p.id === myId);
    me.role = roleId; me.ready = false;
    broadcastState(); renderRoles();
  } else hostConn.send({ t: "pickRole", role: roleId });
}


$("btn-roulette").onclick = () => {
  if (!isHost || !scene) return;
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  const roleIds = scene.roles.map(r => r.id);
  players.forEach(p => { p.role = null; p.ready = false; });
  shuffled.slice(0, roleIds.length).forEach((p, i) => { p.role = roleIds[i]; });
  broadcastState(); renderRoles();
  status("lobby-status", "🎲 Rollen ausgewürfelt! Wer keine hat, ist Zuschauer. Jetzt alle „Bin bereit“.");
  SFX.done();
};


// ═════════════════════════════════════════════════════════════
// MATCH-SYSTEM: Runden, Gesamtwertung, Finale
// ═════════════════════════════════════════════════════════════
let match = { mode: "free", rounds: 3, round: 1, totals: {}, autoRoulette: true };
const mgWins = {};   // Arena-Siege der Session

function hostSettingsChanged() {
  if (!isHost) return;
  const prevMode = match.mode;
  match.mode = $("set-mode").value;
  match.rounds = parseInt($("set-rounds").value);
  match.autoRoulette = $("set-roulette").checked;
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
    scene = null; localVideoBuf = null; videoBlobUrl = null;
    scenePool = []; duelInfo = null; duelStagedScene = null;
    players.forEach(p => { p.role = null; p.ready = false; p.timesSpectated = 0; p.timesPlayed = 0; p.eliminated = false; });
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
  if (mode === "elimination") {
    el.innerHTML = `🔪 <b>Battle Royale · Runde ${round}</b> · ${activeLeft} noch im Rennen · 🎲 Zufalls-Szenen &amp; -Rollen · 🕶 Blind: ${bl ? "an" : "aus"}` + (isHost ? "" : ' <span class="tag">(Host)</span>');
  } else if (mode === "rounds") {
    el.innerHTML = `🏆 <b>Match · Runde ${round}/${rounds}</b> · 🎲 Zufalls-Szenen &amp; -Rollen · 🕶 Blind: ${bl ? "an" : "aus"}` + (isHost ? "" : ' <span class="tag">(Host)</span>');
  } else if (mode === "duell") {
    el.innerHTML = `🥊 <b>Duell-Modus</b> · Host wählt Szene, Rolle &amp; die zwei Duellanten · Rest schaut zu &amp; stimmt danach ab` + (isHost ? "" : ' <span class="tag">(Host)</span>');
  } else {
    el.innerHTML = `🎮 <b>Freies Spiel</b> · Szene &amp; Rollen frei wählbar · 🕶 Blind: ${bl ? "an" : "aus"}` + (isHost ? "" : ' <span class="tag">(Host)</span>');
  }
}
function renderWins() {
  const el = $("mg-wins");
  if (!el) return;
  const entries = Object.entries(mgWins).sort((a, b) => b[1] - a[1]);
  el.innerHTML = entries.length ? "🎖 Arena-Siege: " + entries.map(([pid, n]) => `<b>${esc(nameOf(pid))}</b> ×${n}`).join(" · ") : "";
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
    return status("lobby-status", free ? "Erst eine Rolle aussuchen! (Oder ohne Rolle einfach zuschauen 🍿)" : "Alle Rollen sind weg — du bist Zuschauer und siehst die Premiere trotzdem! 🍿", !free ? false : true), free && SFX.err();
  }
  if (!isHost && !videoBlobUrl && !scene?.videoUrl) return status("lobby-status", "Video lädt noch …", true);
  if (!(await ensureMic())) return;
  if (isHost) { me.ready = true; broadcastState(); }
  else hostConn.send({ t: "ready" });
  status("lobby-status", "✅ Bereit! Warten auf die anderen …");
  SFX.ok();
  burstConfetti();
};

function checkStartable() {
  if (!isHost) return;
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
      $("btn-start").textContent = "🔪 Battle Royale starten (" + players.length + " Spieler)";
      $("start-hint").textContent = players.length < 2 ? "Mindestens 2 Spieler nötig!" : "Zufalls-Szenen & -Rollen — nach jeder Runde fliegt der Schlechteste raus, bis nur noch einer übrig ist!";
    } else {
      $("btn-start").textContent = "🎲 Match starten (" + match.rounds + " Runden)";
      $("start-hint").textContent = "Zufalls-Szene & zufällige Rollen für alle. Los geht's, sobald du startest!";
    }
    return;
  }
  $("btn-start").textContent = "🔴 Session starten";
  const speakers = players.filter(p => p.role != null);
  const ok = speakers.length >= 1 && speakers.every(p => p.ready);
  const spectators = players.length - speakers.length;
  $("btn-start").disabled = !ok;
  $("start-hint").textContent = ok
    ? "Los geht's! " + (spectators ? spectators + " Zuschauer gucken zu." : "Unbesetzte Rollen sprechen original.")
    : "Warte, bis alle Sprecher „bereit“ sind …";
}



function pickMime() {
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"])
    if (MediaRecorder.isTypeSupported(m)) return m;
  return "";
}

$("btn-mic-test").onclick = async () => {
  if (!(await ensureMic())) return;
  status("lobby-status", "🎤 Sprich jetzt 3 Sekunden …");
  const rec = new MediaRecorder(recStream(), { mimeType: pickMime() });
  const chunks = [];
  rec.ondataavailable = e => chunks.push(e.data);
  rec.onstop = async () => {
    status("lobby-status", "Abspielen mit deinem Rollen-Effekt …");
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
    src.onended = () => status("lobby-status", "So klingst du im Take. Passt? Dann „Bin bereit“.");
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
  const playable = sceneList.filter(s => s.lines && s.lines.length && s.id !== "testplace");
  if (!scenePool.length) {
    scenePool = [...playable].sort(() => Math.random() - 0.5);   // frisch mischen, erst wenn der Stapel leer ist
  }
  const s = scenePool.pop();
  scene = JSON.parse(JSON.stringify(s));
  scene.blind = $("blind-mode") ? $("blind-mode").checked : false;
  localVideoBuf = null; videoBlobUrl = null;
  voiceTrackBuf = null; voiceTrackTried = false;   // FIX: sonst spielt "Original anhören" die Stimmen der VORHERIGEN Szene ab!
  rouletteRoles();
  showScene(scene.videoUrl);
  broadcast({ t: "scene", scene });
  broadcastSettings();
  broadcastState();
}
// ── FAIRE Rollenverteilung: wer schon (öfter) Zuschauer war, ist garantiert bevorzugt dran.
// Bei exakt gleichem Zuschauer-Stand entscheidet der Zufall — sonst nie.
function rouletteRoles() {
  const roleIds = scene.roles.map(r => r.id);
  const eligible = players.filter(p => !p.eliminated);   // Eliminierte sind für IMMER Zuschauer (Battle Royale)
  const n = Math.min(roleIds.length, eligible.length);

  const ranked = eligible.map(p => ({ p, benched: p.timesSpectated || 0, rnd: Math.random() }))
    .sort((a, b) => b.benched - a.benched || b.rnd - a.rnd);

  const playing = ranked.slice(0, n).map(x => x.p);
  const spectating = ranked.slice(n).map(x => x.p);

  players.forEach(p => { p.role = null; p.ready = false; });
  const shuffledPlaying = [...playing].sort(() => Math.random() - 0.5);
  shuffledPlaying.forEach((p, i) => { p.role = roleIds[i]; });

  // Fairness-Zähler fortschreiben: Bank-Zeit steigt, Spielzeit steigt — Grundlage für die nächste Runde
  spectating.forEach(p => { p.timesSpectated = (p.timesSpectated || 0) + 1; });
  playing.forEach(p => { p.timesPlayed = (p.timesPlayed || 0) + 1; });
}

$("btn-start").onclick = async () => {
  if ((match.mode === "rounds" || match.mode === "elimination") && !scene) {
    // Match-Kickoff: Zufalls-Szene laden, dann warten auf Bereit
    await pickRandomScene();
    const label = match.mode === "elimination" ? "🔪 Runde 1: Szene &amp; Rollen ausgewürfelt!" : "🎲 Runde 1: Szene &amp; Rollen ausgewürfelt!";
    status("lobby-status", label + " Alle „Bin bereit“ drücken.");
    $("btn-start").style.display = "none";
    $("btn-go-round").style.display = "";
    return;
  }
  startSession();
};
$("btn-go-round").onclick = () => startSession();
function startSession() {
  const speakers = players.filter(p => p.role != null);
  if (!speakers.length || !speakers.every(p => p.ready)) {
    status("lobby-status", "Es müssen erst alle Sprecher „bereit“ sein!", true); SFX.err(); return;
  }
  if (scene.lines?.length) { broadcast({ t: "goLines" }); startBooth(); }
  else { broadcast({ t: "go" }); startRealtime(); }
}

// ═════════════════════════════════════════════════════════════
// 6) LINE-BOOTH — Zeile für Zeile, unendlich Versuche
// ═════════════════════════════════════════════════════════════
let myLines = [], curLine = 0, takes = {};   // takes: lineIdx → ArrayBuffer
let lineRec = null, lineChunks = [], recTimer = null, recStartT = 0, recMax = 0;


function myRole() { return players.find(p => p.id === myId)?.role; }
function roleOf(id) { return scene.roles.find(r => r.id === id); }

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
    ? sceneList.map((s, i) => `<option value="${i}">${esc(s.title)}</option>`).join("")
    : "<option>— Szenen laden… —</option>";
}
$("btn-duel-load-scene").onclick = () => {
  const s = sceneList[$("duel-scene-select").value];
  if (!s) return;
  duelStagedScene = JSON.parse(JSON.stringify(s));
  $("duel-role-select").innerHTML = duelStagedScene.roles.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join("");
  const playerOpts = players.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
  $("duel-player-a").innerHTML = playerOpts;
  $("duel-player-b").innerHTML = playerOpts;
  if (players[1]) $("duel-player-b").value = players[1].id;
  $("duel-pickers").style.display = "flex";
  status("duel-setup-status", "Szene geladen — jetzt Rolle & beide Duellanten wählen.");
};
$("btn-duel-start").onclick = () => {
  const roleId = parseInt($("duel-role-select").value);
  const aId = $("duel-player-a").value, bId = $("duel-player-b").value;
  if (aId === bId) return status("duel-setup-status", "Duellant A und B müssen unterschiedlich sein!", true), SFX.err();
  duelInfo = { roleId, aId, bId };
  scene = JSON.parse(JSON.stringify(duelStagedScene));
  localVideoBuf = null; videoBlobUrl = null;
  players.forEach(p => { p.role = (p.id === aId || p.id === bId) ? roleId : null; p.ready = true; });
  Object.keys(duelSubs).forEach(k => delete duelSubs[k]);
  Object.keys(duelVotes).forEach(k => delete duelVotes[k]);
  broadcast({ t: "scene", scene });
  broadcast({ t: "duelSetupInfo", duelInfo });
  broadcastState();
  status("duel-setup-status", "🥊 Duell steht: " + nameOf(aId) + " vs " + nameOf(bId) + " als " + duelStagedScene.roles.find(r => r.id === roleId).name);
  broadcast({ t: "goLines" });
  startBooth();
};

function startBooth() {
  const rid = myRole();
  if (rid == null) {                      // Zuschauer
    show("scr-wait");
    renderBoothPlayers();
    $("duel-waiting-note").style.display = match.mode === "duell" ? "" : "none";
    const me0 = players.find(p => p.id === myId);
    const bench = me0 ? (me0.timesSpectated || 0) : 0;
    status("wait-status", match.mode === "duell"
      ? "🥊 Duell läuft — " + nameOf(duelInfo?.aId) + " vs " + nameOf(duelInfo?.bId) + " nehmen unabhängig voneinander auf. Danach hört ihr beide Versionen und stimmt ab!"
      : "🍿 Du bist Zuschauer — die Premiere startet automatisch, wenn alle fertig sind." + (match.mode === "rounds" ? " (Nächste Runde bist du garantiert bevorzugt dran, " + bench + "x gebankt bisher.)" : ""));
    return;
  }
  myLines = scene.lines.map((l, i) => ({ ...l, idx: i })).filter(l => l.chars.includes(rid));
  curLine = 0; takes = {}; myEffectOverrides = {};
  const r = roleOf(rid);
  $("booth-rolename").textContent = r.name;
  const av = scene.avatars?.[String(rid)];
  $("booth-avatar").style.display = av ? "" : "none";
  if (av) $("booth-avatar").src = av;
  const bv = $("booth-video");
  bv.src = videoBlobUrl || scene.videoUrl;
  $("btn-line-rec").disabled = true;
  status("booth-status", "⏳ Video lädt — einen Moment …");
  setBar("booth-bar", 30);
  waitCanPlay(bv).then(() => {
    setBar("booth-bar", 100);
    $("btn-line-rec").disabled = false;
    status("booth-status", "Unendlich Versuche — nimm auf, bis es sitzt.");
    SFX.ok();
  });
  sendProgress();
  show("scr-booth");
  $("onair").classList.add("live");
  SFX.go();
  startVizOn("viz");
  renderLine();
}

function renderLine() {
  const l = myLines[curLine];
  if (!l) return finishBooth();
  syncBoothGateUI();
  $("booth-count").innerHTML = `${curLine + 1}/${myLines.length}<small>Voiceline</small>`;
  $("line-who").textContent = l.who + (l.chars.length > 1 ? " (zusammen!)" : "");
  $("line-text").textContent = l.text;
  $("line-de").textContent = (l.de && !scene.blind) ? "🇩🇪 " + l.de : (scene.blind ? "🕶 Blind-Modus — improvisier!" : "");
  $("line-dur").textContent = "~" + Math.max(1, Math.round(l.end - l.t)) + " Sek.";
  $("booth-video").currentTime = l.t;
  $("btn-line-play").disabled = !takes[l.idx] || takes[l.idx] === "SKIP";
  $("btn-line-next").disabled = !takes[l.idx];
  const prevBtn = $("btn-line-prev");
  if (prevBtn) { prevBtn.style.display = redoMode !== null ? "none" : ""; prevBtn.disabled = curLine <= 0; }
  $("btn-line-next").textContent = redoMode !== null ? "✅ Aktualisieren & zurück" : "✅ Passt, weiter";
  const sk = $("btn-line-skip"); if (sk) sk.style.display = lineHasOrig(l) ? "" : "none";
  const og = $("btn-line-orig"); if (og) og.style.display = (lineHasOrig(l) && !scene.blind) ? "" : "none";
  const efSel = $("my-effect-select");
  if (efSel) {
    const baseRole = roleOf(myRole()) || { effect: "none" };
    const sceneDefault = effectiveRole(baseRole, l).effect;
    efSel.innerHTML = `<option value="">🎭 Standard (${esc(EFFECTS[sceneDefault] || sceneDefault)})</option>` +
      Object.entries(EFFECTS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
    efSel.value = myEffectOverrides[l.idx] || "";
  }
  $("rectime-fill").style.width = "0";
  if (lineHasOrig(l)) previewRefViz(l); else { cancelAnimationFrame(vizRAF); const c = $("viz"); if (c) { const g = c.getContext("2d"); g.clearRect(0,0,c.width,c.height); } }
  status("booth-status", takes[l.idx] ? "Take gespeichert — anhören, neu aufnehmen oder weiter." : "Unendlich Versuche — nimm auf, bis es sitzt.");
}

// Szenen-Ausschnitt zum Reinhören

// Original-Voiceline anhören (Aussprache-Referenz, z. B. "Surprise Mothafucka")

// Voice-Track: eine lange Stimmen-Spur, aus der Lines per Zeitfenster geschnitten werden
let voiceTrackBuf = null, voiceTrackTried = false;
async function getVoiceTrack() {
  if (voiceTrackBuf || voiceTrackTried || !scene.voiceTrack) return voiceTrackBuf;
  voiceTrackTried = true;
  try {
    const ctx = getCtx();
    const raw = await (await fetch(scene.voiceTrack)).arrayBuffer();
    voiceTrackBuf = await ctx.decodeAudioData(raw);
  } catch (e) { console.warn("Voice-Track nicht ladbar:", e); }
  return voiceTrackBuf;
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
    if (!origCache.has(l.orig)) {
      const buf = await (await fetch(l.orig)).arrayBuffer();
      origCache.set(l.orig, await ctx.decodeAudioData(buf));
    }
    return origCache.get(l.orig);
  }
  const full = await getVoiceTrack();
  if (full) return sliceBuffer(full, l.t, l.end);
  return null;
}
function lineHasOrig(l) { return !!(l.orig || scene.voiceTrack); }

const origCache = new Map();
let origSrc = null;
$("btn-line-orig").onclick = async () => {
  const l = myLines[curLine];
  if (!lineHasOrig(l)) return;
  if (origSrc) { try { origSrc.stop(); } catch {} origSrc = null; $("btn-line-orig").textContent = "🗣 Original anhören"; $("booth-video").pause(); return; }
  const ctx = getCtx();
  try {
    $("btn-line-orig").textContent = "⏳ …";
    const buffer = await getLineOrigBuffer(l);
    if (!buffer) throw new Error("kein Original");
    // Video läuft synchron mit, Original-Stimme liegt drüber (Video leise)
    const v = $("booth-video");
    v.pause(); v.currentTime = l.t; v.volume = boothVol * 0.45; v.playbackRate = practiceSpeed;
    await v.play().catch(() => {});
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = practiceSpeed;
    src.connect(ctx.destination);
    src.start();
    origSrc = src;
    $("btn-line-orig").textContent = "⏹ Stopp";
    src.onended = () => { if (origSrc === src) { origSrc = null; $("btn-line-orig").textContent = "🗣 Original anhören"; v.pause(); } };
  } catch (e) {
    $("btn-line-orig").textContent = "🗣 Original anhören";
    status("booth-status", "Original-Audio nicht ladbar — GitHub Pages noch am Deployen?", true);
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
  if (!v.paused) { v.pause(); $("btn-line-scene").textContent = "🎬 Szene ansehen"; return; }   // 2. Klick = Stopp
  v.currentTime = Math.max(0, l.t - 0.5);
  v.volume = boothVol; v.playbackRate = practiceSpeed;
  v.play();
  $("btn-line-scene").textContent = "⏹ Stopp";
  sceneStopHandler = () => {
    if (v.currentTime >= l.end + 0.3) {
      v.pause();
      v.removeEventListener("timeupdate", sceneStopHandler); sceneStopHandler = null;
      $("btn-line-scene").textContent = "🎬 Szene ansehen";
    }
  };
  v.addEventListener("timeupdate", sceneStopHandler);
};

let recBusy = false;
function boothButtons_unused(dis) { ["btn-line-scene","btn-line-play","btn-line-next","btn-line-skip"].forEach(id => $(id).disabled = dis || (id !== "btn-line-scene" && $(id).disabled)); if(!dis) renderLine._keep || 0; }
$("btn-line-rec").onclick = async () => {
  if (lineRec && lineRec.state === "recording") { stopLineRec(); return; }
  if (recBusy) {
    // Notaus: Falls ein früherer Start hängen geblieben ist, nach 6s Reset erlauben
    if (performance.now() - (recBusy.t || 0) > 6000) forceRecReset();
    return;
  }
  recBusy = { t: performance.now() };
  ["btn-line-scene","btn-line-play","btn-line-next","btn-line-skip","btn-line-orig"].forEach(id => { const el = $(id); if (el) el.disabled = true; });
  status("booth-status", "🎯 Bereite Aufnahme vor …");
  try {
    if ($("rec-timer").checked) await recCountdown();
    const l = myLines[curLine];
    // Adaptiver Puffer: nicht in die nächste Line reinlaufen
    const nextL = scene.lines[l.idx + 1];
    const room = nextL ? Math.max(0.3, nextL.t - l.end) : 1.2;
    recMax = Math.min(20, Math.max(2.5, (l.end - l.t) + Math.min(1.2, room)));
    const v = $("booth-video");
    v.pause(); v.currentTime = l.t; v.volume = boothVol; v.playbackRate = 1;
    await new Promise(res => {
      const to = setTimeout(res, 4000);
      const h = () => { clearTimeout(to); v.removeEventListener("seeked", h); res(); };
      v.addEventListener("seeked", h);
    });
    lineChunks = [];
    lineRec = new MediaRecorder(recStream(), { mimeType: pickMime() });
    lineRec.ondataavailable = e => { if (e.data.size) lineChunks.push(e.data); };
    lineRec.onstop = onLineRecorded;
    await v.play();
    // KEIN Event-Warten mehr (Race!): pollen, bis das Video wirklich läuft
    await new Promise(res => {
      const t0 = performance.now();
      const iv = setInterval(() => {
        if (v.currentTime > l.t + 0.03 || performance.now() - t0 > 2500) { clearInterval(iv); res(); }
      }, 16);
    });
    lineRec.start();
    recBusy = false;
    recording = true;
    startDualViz("viz", l, recMax);
    SFX.rec();
    $("btn-line-rec").textContent = "⏹ Stopp";
    $("btn-line-rec").classList.add("recording");
    recStartT = performance.now();
    clearInterval(recTimer);
    recTimer = setInterval(() => {
      const el = (performance.now() - recStartT) / 1000;
      $("rectime-fill").style.width = Math.min(100, el / recMax * 100) + "%";
      if (el >= recMax) stopLineRec();
    }, 50);
    status("booth-status", "🔴 Aufnahme läuft … (stoppt automatisch nach " + recMax.toFixed(1) + "s)");
  } catch (e) {
    console.error("Rec-Start fehlgeschlagen:", e);
    forceRecReset();
    status("booth-status", "⚠ Aufnahme-Start hakte — nochmal drücken!", true);
  }
};

// Alles zurücksetzen, falls ein Start hängen bleibt
function forceRecReset() {
  recBusy = false;
  clearInterval(recTimer);
  try { $("booth-video").pause(); } catch {}
  if (lineRec && lineRec.state === "recording") { try { lineRec.stop(); } catch {} }
  $("btn-line-rec").textContent = "⏺ Aufnehmen";
  $("btn-line-rec").classList.remove("recording");
  $("btn-line-rec").disabled = false;
  ["btn-line-scene","btn-line-orig"].forEach(id => { const el = $(id); if (el) el.disabled = false; });
  renderLine();
}


function recCountdown() {
  return new Promise(res => {
    const b = $("btn-line-rec");
    let n = 3;
    b.disabled = true;
    b.textContent = "⏱ " + n + " …";
    SFX.beep();
    const iv = setInterval(() => {
      n--;
      if (n === 0) { clearInterval(iv); b.disabled = false; SFX.go(); res(); }
      else { b.textContent = "⏱ " + n + " …"; SFX.beep(); }
    }, 800);
  });
}

function stopLineRec() {
  recBusy = false;
  recording = false;
  clearInterval(recTimer);
  $("booth-video").pause();
  if (lineRec && lineRec.state === "recording") lineRec.stop();
  $("btn-line-rec").textContent = "⏺ Nochmal aufnehmen";
  $("btn-line-rec").classList.remove("recording");
  SFX.stop();
}

async function onLineRecorded() {
  recBusy = false;
  ["btn-line-scene","btn-line-skip","btn-line-orig"].forEach(id => { const el = $(id); if (el) el.disabled = false; });
  const l = myLines[curLine];
  takes[l.idx] = await new Blob(lineChunks, { type: lineChunks[0]?.type }).arrayBuffer();
  $("btn-line-play").disabled = false;
  $("btn-line-next").disabled = false;
  status("booth-status", "Take im Kasten! Anhören oder direkt weiter.");
}

let previewSrc = null;
$("btn-line-play").onclick = async () => {
  const l = myLines[curLine];
  if (!takes[l.idx] || takes[l.idx] === "SKIP") return;
  if (previewSrc) { try { previewSrc.stop(); } catch {} previewSrc = null; }
  const ctx = getCtx();
  const rawBuf = await ctx.decodeAudioData(await toArrayBuffer(takes[l.idx]));
  const buf = applyGateToBuffer(ctx, rawBuf, micSettings.gate);   // aktuelles Gate live auf den Take anwenden
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

$("my-effect-select").onchange = () => {
  const l = myLines[curLine];
  if (!l) return;
  const v = $("my-effect-select").value;
  if (v) myEffectOverrides[l.idx] = v; else delete myEffectOverrides[l.idx];
  SFX.click();
};
$("btn-line-prev").onclick = () => {
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

function sendProgress() {
  const done = Object.keys(takes).length, total = myLines.length;
  const me = players.find(p => p.id === myId);
  if (me) { me.done = done; me.total = total; }
  if (isHost) broadcastState();
  else hostConn.send({ t: "progress", done, total });
}

function finishBooth() {
  cancelAnimationFrame(vizRAF);
  $("onair").classList.remove("live");
  SFX.done();
  show("scr-wait");
  renderBoothPlayers();
  const items = myLines.filter(l => takes[l.idx] && takes[l.idx] !== "SKIP")
    .map(l => ({ startAt: l.t, idx: l.idx, buf: takes[l.idx], effect: myEffectOverrides[l.idx] || undefined, gate: micSettings.gate }));
  if (match.mode === "duell" && duelInfo) {
    if (isHost) collectDuelSubmit(myId, items);
    else hostConn.send({ t: "duelSubmit", playerId: myId, items });
    status("wait-status", "🥊 Dein Take ist im Kasten! Warte auf den anderen Duellanten …");
    return;
  }
  if (isHost) collectTracks(myRole(), items);
  else hostConn.send({ t: "tracks", role: myRole(), items });
}

// ═════════════════════════════════════════════════════════════
// 7) REALTIME-MODUS (Szenen ohne Line-Timings)
// ═════════════════════════════════════════════════════════════
let rtRecorder = null, rtChunks = [];

async function startRealtime() {
  const role = roleOf(myRole());
  $("rec-role").textContent = "🎭 Du bist: " + role.name;
  const v = $("rec-video");
  v.src = videoBlobUrl || scene.videoUrl;
  attachPrompter(v, $("rec-prompter"), myRole());
  show("scr-record");
  await countdown();
  $("onair").classList.add("live");
  rtChunks = [];
  rtRecorder = new MediaRecorder(recStream(), { mimeType: pickMime() });
  rtRecorder.ondataavailable = e => { if (e.data.size) rtChunks.push(e.data); };
  rtRecorder.onstop = async () => {
    $("onair").classList.remove("live");
    status("rec-status", "Aufnahme fertig — sammle alle Spuren ein …");
    const buf = await new Blob(rtChunks, { type: rtChunks[0]?.type }).arrayBuffer();
    const items = [{ startAt: 0, buf }];
    if (isHost) collectTracks(myRole(), items);
    else hostConn.send({ t: "tracks", role: myRole(), items });
  };
  rtRecorder.start();
  v.currentTime = 0;
  await v.play();
  v.onended = () => { if (rtRecorder.state !== "inactive") rtRecorder.stop(); };
}

function countdown() {
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

function tttAction(a) { if (isHost) tttHandle(a, myId); else hostConn.send({ t: "ttt", a }); }
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
  if (ttt.p.length < 2) info = ttt.p.length === 0 ? "Zwei Wartende können zocken — wer traut sich?" : nameOf(ttt.p[0]) + " wartet auf einen Gegner …";
  else if (ttt.winner === -1) info = "Unentschieden! 🤝";
  else if (ttt.winner != null) info = "🏆 " + nameOf(ttt.p[ttt.winner]) + " gewinnt!";
  else info = (myTurn ? "🫵 DU bist dran (" : nameOf(ttt.p[ttt.turn]) + " ist dran (") + (ttt.turn === 0 ? "X" : "O") + ")";
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
});


// ═════════════════════════════════════════════════════════════
// WARTE-ARENA 2: Klick-Battle (10 Sekunden, alle Wartenden)
// ═════════════════════════════════════════════════════════════
let cbActive = false, cbClicks = 0, cbTimer = null;
function cbStart() {
  if (isHost) { broadcast({ t: "cbGo" }); cbRun(); }
  else hostConn.send({ t: "cb", a: { k: "start" } });
}
function cbRun() {
  cbActive = true; cbClicks = 0;
  $("cb-btn").style.display = ""; $("btn-cb-start").style.display = "none";
  $("cb-result").innerHTML = "";
  let left = 10;
  $("cb-info").textContent = "⚡ LOS! Klick was das Zeug hält — " + left + "s";
  if (onWaitScreen()) SFX.go();
  clearInterval(cbTimer);
  cbTimer = setInterval(() => {
    left--;
    $("cb-info").textContent = left > 0 ? "⚡ " + left + "s — KLICK KLICK KLICK!" : "Zeit um!";
    if (left <= 0) {
      clearInterval(cbTimer);
      cbActive = false;
      $("cb-btn").style.display = "none"; $("btn-cb-start").style.display = "";
      if (isHost) cbScore(myId, cbClicks); else hostConn.send({ t: "cb", a: { k: "score", n: cbClicks } });
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
    `<div>${i === 0 ? "🏆" : i === 1 ? "🥈" : i === 2 ? "🥉" : "•"} <b>${esc(nameOf(pid))}</b> — ${n} Klicks</div>`).join("");
  $("cb-info").textContent = list.length ? "Ergebnis! Revanche?" : "Zwei Wartende, ein Button — wer klickt schneller?";
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
function rpsAction(a) { if (isHost) rpsHandle(a, myId); else hostConn.send({ t: "rps", a }); }
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
  if (!bothIn) { el.innerHTML = ""; $("rps-info").textContent = rps.p.length === 0 ? "Zwei Wartende können zocken — wer traut sich?" : nameOf(rps.p[0]) + " wartet auf einen Gegner …"; return; }
  const [a1, a2] = rps.p;
  if (rps.lastResult) {
    const { c1, c2, winner } = rps.lastResult;
    $("rps-info").textContent = winner ? "🏆 " + nameOf(winner) + " gewinnt die Runde!" : "🤝 Unentschieden!";
    el.innerHTML = `<div style="display:flex;gap:24px;justify-content:center;font-size:3rem">
      <div style="text-align:center"><div>${RPS_ICON[c1]}</div><div class="tag">${esc(nameOf(a1))}</div></div>
      <div style="align-self:center;font-size:1.4rem">⚔️</div>
      <div style="text-align:center"><div>${RPS_ICON[c2]}</div><div class="tag">${esc(nameOf(a2))}</div></div>
    </div>`;
    if (onWaitScreen()) winner ? SFX.done() : SFX.beep();
  } else {
    const myTurn = iAmIn && !rps.picks[myId];
    $("rps-info").textContent = nameOf(a1) + " (" + (rps.wins[a1]||0) + ") vs " + nameOf(a2) + " (" + (rps.wins[a2]||0) + ")" + (iAmIn ? (rps.picks[myId] ? " — warte auf Gegner …" : " — wähl deinen Zug!") : " — beide wählen gerade …");
    el.innerHTML = !myTurn ? "" : `<div style="display:flex;gap:10px;justify-content:center">${Object.entries(RPS_ICON).map(([k,ic]) => `<button class="big" data-k="${k}" style="font-size:1.8rem;padding:14px 20px">${ic}</button>`).join("")}</div>`;
    el.querySelectorAll("button").forEach(b => b.onclick = () => rpsAction({ k: "pick", choice: b.dataset.k }));
  }
}

// ═════════════════════════════════════════════════════════════
// WARTE-ARENA 6: Würfel-Duell (2 Wartende)
// ═════════════════════════════════════════════════════════════
let dice = { p: [], rolls: {}, winner: null };
function diceAction(a) { if (isHost) diceHandle(a, myId); else hostConn.send({ t: "dice", a }); }
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
  if (dice.p.length < 2) { el.innerHTML = ""; $("dice-info").textContent = dice.p.length === 0 ? "Zwei Wartende können zocken — wer traut sich?" : nameOf(dice.p[0]) + " wartet auf einen Gegner …"; return; }
  const [a1, a2] = dice.p;
  const r1 = dice.rolls[a1], r2 = dice.rolls[a2];
  el.innerHTML = `<div style="display:flex;gap:24px;justify-content:center;font-size:3.2rem">
    <div style="text-align:center"><div>${r1 ? DICE_FACE[r1-1] : "🎲"}</div><div class="tag">${esc(nameOf(a1))}</div></div>
    <div style="align-self:center;font-size:1.2rem">vs</div>
    <div style="text-align:center"><div>${r2 ? DICE_FACE[r2-1] : "🎲"}</div><div class="tag">${esc(nameOf(a2))}</div></div>
  </div>`;
  if (dice.winner) {
    $("dice-info").textContent = dice.winner === "tie" ? "🤝 Unentschieden! Nochmal?" : "🏆 " + nameOf(dice.winner) + " gewinnt (" + Math.max(r1,r2) + " vs " + Math.min(r1,r2) + ")!";
    if (onWaitScreen()) dice.winner === "tie" ? SFX.beep() : SFX.done();
  } else if (iAmIn && dice.rolls[myId] == null) {
    $("dice-info").textContent = "🎲 Du bist dran — würfeln!";
  } else {
    $("dice-info").textContent = nameOf(a1) + " vs " + nameOf(a2) + " — warte auf beide Würfe …";
  }
}
$("btn-dice-roll") && ($("btn-dice-roll").onclick = () => diceAction({ k: "roll" }));

// ═════════════════════════════════════════════════════════════
// BEWERTUNGS-SHOW: Nach der Premiere Sterne verteilen
// ═════════════════════════════════════════════════════════════
let pendingRate = false, myStars = {}, rateSent = false;
const allRatings = new Map();   // Host: voterId → {targetId: stars}

function showRateCard() {
  const speakers = players.filter(p => p.role != null && p.id !== myId);
  const anySpeakers = players.filter(p => p.role != null).length >= 2;
  if (!anySpeakers) return;                      // Solo: keine Show
  myStars = {}; rateSent = false; ratingDone = false; allRatings.clear();
  const rp = $("rate-progress"); if (rp) rp.textContent = "";
  $("rate-card").style.display = "";
  $("rate-result").innerHTML = "";
  $("btn-rate-submit").style.display = ""; 
  $("btn-rate-force").style.display = "none";
  if (!speakers.length) {                        // Ich bin einziger Sprecher → nur zuschauen
    $("rate-rows").innerHTML = '<p class="sub">Du warst der einzige Sprecher — die anderen bewerten dich gerade… 👀</p>';
    $("btn-rate-submit").style.display = "none";
    sendRating({});
    return;
  }
  $("rate-rows").innerHTML = speakers.map(p => `
    <div class="raterow" data-p="${p.id}">
      ${avatarHTML(p)}
      <div class="rateinfo">
        <span class="ratename">${esc(p.name)}</span>
        <span class="tag">🎭 ${esc(scene.roles.find(r => r.id === p.role)?.name || "")}</span>
      </div>
      <div class="starrow">${[1,2,3,4,5].map(n => `<button class="starbtn" data-n="${n}">★</button>`).join("")}</div>
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
  });
  $("btn-rate-submit").disabled = true;
}

$("btn-rate-submit").onclick = () => {
  if (rateSent) return;
  rateSent = true;
  $("btn-rate-submit").disabled = true;
  $("btn-rate-submit").textContent = "✅ Abgeschickt — warte auf die anderen …";
  sendRating(myStars);
};
let rateForceTimer = null;
function sendRating(scores) {
  if (isHost) {
    collectRating(myId, scores);
    clearTimeout(rateForceTimer);
    rateForceTimer = setTimeout(() => {
      if (allRatings.size < players.length) $("btn-rate-force").style.display = "";
    }, 25000);   // Notfall-Button erst nach 25s, falls jemand hängt
  } else hostConn.send({ t: "rate", scores });
}
function collectRating(voterId, scores) {
  allRatings.set(voterId, scores);
  updateRateProgress();
  if (allRatings.size >= players.length) finishRating();   // wirklich ALLE
}
function updateRateProgress() {
  if (!isHost) return;
  const have = allRatings.size, total = players.length;
  const el = $("rate-progress");
  if (el) el.textContent = "🗳 " + have + "/" + total + " haben abgestimmt" + (have < total ? " …" : " — alle fertig!");
  // Force-Button erst NACH langem Warten anbieten, nicht sofort
  const btn = $("btn-rate-force");
  if (have >= total) btn.style.display = "none";
}
$("btn-rate-force").onclick = () => { if (confirm("Wirklich ohne die fehlenden Stimmen weiter?")) finishRating(); };
let ratingDone = false;
function finishRating() {
  if (!isHost || ratingDone) return;
  ratingDone = true;
  clearTimeout(rateForceTimer);
  const sums = {}, counts = {};
  allRatings.forEach(scores => {
    for (const [pid, n] of Object.entries(scores)) { sums[pid] = (sums[pid] || 0) + n; counts[pid] = (counts[pid] || 0) + 1; }
  });
  const results = Object.keys(sums).map(pid => ({ id: pid, name: nameOf(pid), avg: sums[pid] / counts[pid], votes: counts[pid] }))
    .sort((a, b) => b.avg - a.avg);
  // Sterne in die Match-Gesamtwertung übernehmen
  results.forEach(r => { match.totals[r.id] = (match.totals[r.id] || 0) + r.avg; });

  let eliminatedName = null;
  if (match.mode === "elimination" && results.length > 1) {
    // Schlechtester Sprecher DIESER Runde fliegt für immer raus (bei Gleichstand: zufällig unter den Schlechtesten)
    const worstScore = results[results.length - 1].avg;
    const worstCandidates = results.filter(r => Math.abs(r.avg - worstScore) < 0.0001);
    const out = worstCandidates[Math.floor(Math.random() * worstCandidates.length)];
    const p = players.find(pl => pl.id === out.id);
    if (p) { p.eliminated = true; eliminatedName = p.name; }
  }

  broadcast({ t: "rateResult", results, eliminatedName });
  showRateResult(results, eliminatedName);
  allRatings.clear();

  // Host-Steuerung: weiter oder Finale
  const activeLeft = players.filter(p => !p.eliminated).length;
  const btn = $("btn-next-round");
  btn.style.display = "";
  if (match.mode === "elimination") {
    btn.textContent = activeLeft > 1 ? ("▶ Nächste Runde (" + activeLeft + " noch im Rennen)") : "🏆 Champion küren!";
  } else {
    btn.textContent = match.round < match.rounds ? ("▶ Nächste Runde (" + (match.round + 1) + "/" + match.rounds + ")") : "🏁 Finale anzeigen!";
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
      // Neue Zufalls-Szene + neue Zufalls-Rollen, zurück in die Lobby zum Bereitmachen
      backToLobby(true);
      await pickRandomScene();
      const label = match.mode === "elimination" ? ("🔪 Runde " + match.round + " — " + activeLeft + " noch im Rennen!") : ("🎲 Runde " + match.round + "/" + match.rounds);
      status("lobby-status", label + ": neue Szene &amp; Rollen! Alle „Bin bereit“.");
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
  status("lobby-status", "🎬 Runde " + match.round + "/" + match.rounds + (match.autoRoulette ? " — neue Rollen ausgewürfelt!" : "") + " Alle wieder „Bin bereit“!");
  SFX.go();
}

// ═══ ANIMIERTES FINALE ═══
function showFinal(list, rounds, championName) {
  show("scr-final");
  $("leave-btn").style.display = "";

  // Bei Battle Royale: Champion steht unabhängig von der Punktsumme immer auf Platz 1
  let ordered = [...list];
  if (championName) {
    ordered.sort((a, b) => (a.name === championName ? -1 : b.name === championName ? 1 : 0));
  }
  const top3 = ordered.slice(0, 3);
  const rest = ordered.slice(3);

  $("final-sub").textContent = championName
    ? "🔪 Battle Royale beendet — " + esc(championName) + " hat als Einzige(r) überlebt!"
    : rounds + " Runde" + (rounds > 1 ? "n" : "") + " gespielt — hier ist eure Gesamtwertung:";

  const fillSlot = (slotId, entry) => {
    const el = $(slotId);
    if (!entry) { el.style.display = "none"; return; }
    el.style.display = "";
    el.classList.remove("show");
    const p = players.find(pl => pl.id === entry.id);
    el.querySelector(".p-avatar-wrap").innerHTML = p ? avatarHTML(p) : "";
    el.querySelector(".p-name").textContent = entry.name;
    el.querySelector(".p-score").textContent = entry.sum.toFixed(1) + " ★";
  };
  fillSlot("podium-1", top3[0]);
  fillSlot("podium-2", top3[1]);
  fillSlot("podium-3", top3[2]);

  $("final-rest").innerHTML = rest.map((r, i) => `
    <div class="finalrow">
      <span class="tag">${i + 4}.</span>
      <span class="fname">${esc(r.name)}</span>
      <span class="fscore">${r.sum.toFixed(1)} ★</span>
    </div>`).join("");

  if (isHost) $("btn-back-lobby").style.display = "";

  // 🔦 Scheinwerfer-Enthüllung: schwingt hin und her, hält kurz je Platz, ~7 Sekunden episch bis zum 1. Platz
  const spot = $("podium-spotlight");
  spot.className = "spotlight";
  const steps = [];
  if (top3[2]) steps.push({ id: "podium-3", settle: "settle-3", sweepMs: 1600 });
  if (top3[1]) steps.push({ id: "podium-2", settle: "settle-2", sweepMs: top3[2] ? 1100 : 1600 });
  if (top3[0]) steps.push({ id: "podium-1", settle: "settle-1", sweepMs: (top3[2] || top3[1]) ? 1400 : 1600 });

  let t = 0;
  steps.forEach((step, i) => {
    setTimeout(() => { spot.className = "spotlight sweeping"; }, t);
    t += step.sweepMs;
    setTimeout(() => { spot.className = "spotlight " + step.settle; }, t);
    setTimeout(() => {
      $(step.id).classList.add("show");
      if (i === steps.length - 1) { SFX.done(); burstConfetti(); }
      else SFX.beep();
    }, t + 160);
    t += 700;   // kurz auf dem enthüllten Platz verweilen, bevor's weiterschwingt
  });
  setTimeout(() => { spot.className = "spotlight hide"; }, t + 500);
}

$("btn-back-lobby").onclick = () => {
  if (!isHost) return;
  broadcast({ t: "matchLobby" });
  backToLobby();
};
function backToLobby(keepMatch) {
  if (!keepMatch) { match.round = 1; match.totals = {}; }
  players.forEach(p => { p.ready = false; p.done = 0; p.total = 0; p.prem = false; });
  mixItems = []; collected.clear(); takes = {};
  finalTracksData = null; premiereLocked = false; redoMode = null;
  pendingRate = false; rateSent = false; ratingDone = false; allRatings.clear(); myStars = {};
  $("rate-card").style.display = "none"; $("rate-rows").innerHTML = ""; $("rate-result").innerHTML = "";
  $("btn-next-round").style.display = "none"; $("btn-rate-submit").disabled = true;
  $("btn-rate-submit").textContent = "Bewertung abschicken";
  show("scr-lobby");
  $("leave-btn").style.display = "";
  if (isHost) { broadcastState(); }
  renderSettingsView();
  updateLobbyMusic();
  if (!keepMatch) status("lobby-status", "🏠 Zurück in der Lobby!");
}
function showRateResult(results, eliminatedName) {
  $("btn-rate-submit").style.display = "none";
  $("btn-rate-force").style.display = "none";
  $("rate-rows").innerHTML = "";
  const rows = $("rate-result");
  rows.innerHTML = results.map((r, i) => {
    const p = players.find(pl => pl.id === r.id);
    return `<div class="raterow resultrow ${i === 0 ? "winner" : ""}" style="opacity:0;transform:translateX(-14px)">
      ${p ? avatarHTML(p) : ""}
      <div class="rateinfo">
        <span class="ratename">${i === 0 ? "🏆 " : i === 1 ? "🥈 " : i === 2 ? "🥉 " : "• "}${esc(r.name)}</span>
        ${i === 0 ? '<span class="tag" style="color:var(--amber)">Bester Synchronsprecher!</span>' : `<span class="tag">${r.votes} Stimmen</span>`}
      </div>
      <span class="resultscore">${r.avg.toFixed(1)} ★</span>
    </div>`;
  }).join("") + (eliminatedName ? `<div class="raterow" style="border-color:var(--hot);opacity:0">🔪 <b>${esc(eliminatedName)}</b> ist raus aus dem Battle Royale!</div>` : "");
  [...rows.children].forEach((row, i) => {
    setTimeout(() => { row.style.transition = "opacity .4s, transform .4s"; row.style.opacity = "1"; row.style.transform = "translateX(0)"; }, i * 150);
  });
  SFX.done();
}


// ═════════════════════════════════════════════════════════════
// WARTE-ARENA 3+4: Reaktions-Duell & Tipp-Renner
// ═════════════════════════════════════════════════════════════
// — Reaktion —
let rxWaiting = false, rxGreenAt = 0, rxDone = false;
const rxScores = new Map(), tpScores = new Map();

$("btn-rx-start").onclick = () => {
  const delay = 1500 + Math.random() * 3500;
  if (isHost) { broadcast({ t: "rxGo", delay }); rxRun(delay); }
  else hostConn.send({ t: "mg", k: "rxStart" });
};
function rxRun(delay) {
  rxWaiting = true; rxDone = false;
  $("rx-pad").style.display = ""; $("btn-rx-start").style.display = "none";
  $("rx-result").innerHTML = "";
  const pad = $("rx-pad");
  pad.style.background = "#5c1a1e"; pad.textContent = "WARTE AUF GRÜN …";
  rxGreenAt = 0;
  setTimeout(() => {
    if (!rxWaiting) return;
    rxGreenAt = performance.now();
    pad.style.background = "#1a5c34"; pad.textContent = "JETZT! KLICK!";
    if (onWaitScreen()) SFX.go();
  }, delay);
}
$("rx-pad") && ($("rx-pad").onclick = () => {
  if (!rxWaiting || rxDone) return;
  rxDone = true; rxWaiting = false;
  let ms;
  if (!rxGreenAt) { ms = 9999; $("rx-pad").textContent = "ZU FRÜH! 😅"; SFX.err(); }
  else { ms = Math.round(performance.now() - rxGreenAt); $("rx-pad").textContent = ms + " ms!"; SFX.ok(); }
  setTimeout(() => { $("rx-pad").style.display = "none"; $("btn-rx-start").style.display = ""; }, 1200);
  if (isHost) mgScore("rx", myId, ms); else hostConn.send({ t: "mg", k: "rxScore", ms });
});

// — Tipp-Renner (eigene, kurze Phrasen) —
const TP_PHRASES = ["synchronstudio läuft heiß", "wer klickt der spricht", "mikro an hirn aus", "premiere in drei zwei eins", "der take sitzt beim ersten mal", "kopfhörer auf und los", "gate offen stimme raus", "voll auf die lippen getimet"];
let tpPhrase = "", tpStartT = 0, tpDone = false;
$("btn-tp-start").onclick = () => {
  const phrase = TP_PHRASES[Math.floor(Math.random() * TP_PHRASES.length)];
  if (isHost) { broadcast({ t: "tpGo", phrase }); tpRun(phrase); }
  else hostConn.send({ t: "mg", k: "tpStart" });
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
      if (isHost) mgScore("tp", myId, ms); else hostConn.send({ t: "mg", k: "tpScore", ms });
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
    `<div>${i === 0 ? "🏆" : i === 1 ? "🥈" : i === 2 ? "🥉" : "•"} <b>${esc(nameOf(pid))}</b> — ${ms >= 9999 ? "zu früh 😅" : game === "rx" ? ms + " ms" : (ms / 1000).toFixed(2) + "s"}</div>`).join("");
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
  bv.src = videoBlobUrl || scene.videoUrl;
  const rid = myRole();
  const av = scene.avatars?.[String(rid)];
  $("booth-avatar").style.display = av ? "" : "none";
  if (av) $("booth-avatar").src = av;
  $("booth-rolename").textContent = roleOf(rid).name + " (Korrektur)";
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
  const effect = myEffectOverrides[l.idx] || undefined;
  const gate = micSettings.gate;
  redoMode = null;
  cancelAnimationFrame(vizRAF);
  $("onair").classList.remove("live");
  const back = redoReturnScreen || "scr-wait";
  show(back);
  if (buf && buf !== "SKIP") {
    if (isHost) applyTrackUpdate(myRole(), lineIdx, startAt, buf, effect, gate);
    else hostConn.send({ t: "trackUpdate", role: myRole(), lineIdx, startAt, buf, effect, gate });
  }
  status(back === "scr-playback" ? "play-status" : "wait-status", "✅ Line aktualisiert! Wird im Endergebnis berücksichtigt.");
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
  el.innerHTML = `<div class="tag" style="margin:10px 0 6px">🔁 Eine deiner Lines noch nicht zufrieden?</div>` +
    mine.map(l => `<div class="row" style="justify-content:space-between;background:#14141b;border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin-bottom:6px;gap:10px">
      <span style="font-size:.85rem;flex:1">${esc(l.text.slice(0, 55))}${l.text.length > 55 ? "…" : ""}</span>
      <button class="ghost redo-btn" data-idx="${l.idx}" style="padding:5px 12px;font-size:.8rem;white-space:nowrap">🔁 Neu aufnehmen</button>
    </div>`).join("");
  el.querySelectorAll(".redo-btn").forEach(b => b.onclick = () => redoLine(parseInt(b.dataset.idx), fromScreen));
}

// ── Host: patcht einen einzelnen Take in den bestehenden Mix und verteilt neu ──
async function applyTrackUpdate(role, lineIdx, startAt, rawBuf, effect, gate) {
  if (!finalTracksData) return;
  try {
    const ctx = getCtx();
    const ab = await toArrayBuffer(rawBuf);
    finalTracksData = finalTracksData.map(track => {
      if (track.role !== role) return track;
      const items = track.items.filter(it => it.idx !== lineIdx);
      items.push({ startAt, idx: lineIdx, buf: ab, effect, gate });
      return { role, items };
    });
    if (!finalTracksData.some(t => t.role === role)) finalTracksData.push({ role, items: [{ startAt, idx: lineIdx, buf: ab, effect, gate }] });
    broadcast({ t: "mix", data: finalTracksData });
    loadMix(finalTracksData);
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
  broadcast({ t: "duelReady", dataA, dataB, duelInfo });
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
        items.push({ role: track.role, startAt: item.startAt, lineIdx: item.idx, buffer: applyGateToBuffer(ctx, await ctx.decodeAudioData(ab), item.gate), effect: item.effect });
      } catch (e) { console.warn("Duell-Spur kaputt:", e); }
    }
  }
  // Alle anderen Rollen (nicht die Duell-Rolle) sprechen original, falls vorhanden
  if (scene.lines) {
    const coveredIdx = new Set(items.map(i => i.lineIdx));
    for (let i = 0; i < scene.lines.length; i++) {
      const l = scene.lines[i];
      if (!lineHasOrig(l) || coveredIdx.has(i)) continue;
      try {
        const buffer = await getLineOrigBuffer(l);
        if (buffer) items.push({ role: null, startAt: l.t, lineIdx: i, buffer });
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
  status("play-status", "🥊 Bereite beide Versionen vor …");

  const itemsA = await decodeDuelData(dataA);
  const itemsB = await decodeDuelData(dataB);

  const pv = $("play-video");
  pv.src = videoBlobUrl || scene.videoUrl;
  attachPrompter(pv, $("play-prompter"), null);
  await waitCanPlay(pv, 25000);

  const playOnce = (items, label) => new Promise(resolve => {
    status("play-status", "🥊 " + label);
    mixItems = items;
    pv.addEventListener("ended", resolve, { once: true });
    playMix(false);
  });

  await playOnce(itemsA, "Take 1: " + nameOf(duelInfo.aId));
  await new Promise(r => setTimeout(r, 500));
  await playOnce(itemsB, "Take 2: " + nameOf(duelInfo.bId));

  showDuelVote();
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
  $("btn-vote-a").disabled = amDuelist;
  $("btn-vote-b").disabled = amDuelist;
  status("duel-vote-status", amDuelist ? "Als Duellant darfst du nicht über dich selbst abstimmen 😄" : "Klick auf die Version, die dir besser gefallen hat!");
}
$("btn-vote-a").onclick = () => castDuelVote("a");
$("btn-vote-b").onclick = () => castDuelVote("b");
function castDuelVote(choice) {
  if (myId === duelInfo.aId || myId === duelInfo.bId) return;
  $("btn-vote-a").disabled = true; $("btn-vote-b").disabled = true;
  status("duel-vote-status", "✅ Stimme abgegeben — warte auf die anderen …");
  SFX.click();
  if (isHost) collectDuelVote(myId, choice);
  else hostConn.send({ t: "duelVote", choice });
}
function collectDuelVote(voterId, choice) {
  duelVotes[voterId] = choice;
  const eligible = players.filter(p => p.id !== duelInfo.aId && p.id !== duelInfo.bId);
  const tally = { a: Object.values(duelVotes).filter(v => v === "a").length, b: Object.values(duelVotes).filter(v => v === "b").length };
  broadcast({ t: "duelVoteBroadcast", tally });
  showDuelVoteLive(tally);
  if (Object.keys(duelVotes).length >= eligible.length && eligible.length > 0) finishDuelVote(tally);
}
function showDuelVoteLive(tally) {
  $("duel-vote-sub").textContent = "Stimmen bisher: " + nameOf(duelInfo.aId) + " " + tally.a + " : " + tally.b + " " + nameOf(duelInfo.bId);
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
    ? `<div class="raterow">🤝 Unentschieden! ${tally.a} : ${tally.b}</div>`
    : `<div class="raterow winner" style="border-color:var(--amber);box-shadow:0 0 16px rgba(255,201,92,.3)">🏆 <b>${esc(winner === "a" ? aName : bName)}</b> gewinnt das Duell! (${tally.a} : ${tally.b})</div>`;
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

function collectTracks(role, items) {
  collected.set(role, items);
  const neededRoles = new Set(players.filter(p => p.role != null).map(p => p.role));
  if (collected.size >= neededRoles.size) {
    const data = [...collected.entries()].map(([r, it]) => ({ role: r, items: it }));
    finalTracksData = data;   // persistent merken, damit spaetere Redo-Korrekturen darauf aufbauen koennen
    broadcast({ t: "mix", data });
    loadMix(data);
    collected.clear();
  }
}
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

async function loadMix(data) {
  show("scr-playback");
  status("play-status", "Dekodiere Spuren …");
  const ctx = getCtx();
  mixItems = [];
  let okCount = 0, failCount = 0;
  for (const track of data) {
    for (const item of track.items) {
      try {
        const ab = await toArrayBuffer(item.buf);
        mixItems.push({ role: track.role, startAt: item.startAt, lineIdx: item.idx, buffer: applyGateToBuffer(ctx, await ctx.decodeAudioData(ab), item.gate), effect: item.effect });
        okCount++;
      } catch (e) { failCount++; console.warn("Spur kaputt:", track.role, e); }
    }
  }
  console.log("Mix geladen:", okCount, "Spuren ok,", failCount, "fehlgeschlagen");
  if (failCount) status("play-status", "⚠ " + failCount + " Spur(en) konnten nicht geladen werden — F12 → Console.", true);
  setBar("prem-bar", 70);
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
        if (buffer) mixItems.push({ role: null, startAt: l.t, lineIdx: i, buffer });
      } catch { console.warn("Original fehlt für Line", i); }
    }
  }
  // Video KOMPLETT vorladen, damit die Premiere bei allen gleichzeitig & ruckelfrei startet
  const pv = $("play-video");
  pv.src = videoBlobUrl || scene.videoUrl;
  attachPrompter(pv, $("play-prompter"), null);
  status("play-status", "⏳ Video wird vorgeladen …");
  await waitCanPlay(pv, 25000);
  setBar("prem-bar", 100);
  // Fertig geladen → beim Host melden
  const me = players.find(p => p.id === myId);
  if (me) me.prem = true;
  $("btn-replay").disabled = true;
  $("btn-download").disabled = true;
  if (isHost) { broadcastState(); renderPremState(); }
  else { hostConn.send({ t: "premReady" }); status("play-status", "✅ Fertig geladen — warte, bis der Host die Premiere startet …"); }
  renderRedoPanel("redo-panel-prem");
  SFX.ok();
}

function renderPremStateGuest() {
  const total = players.length, ready = players.filter(p => p.prem).length;
  const el = $("prem-status");
  if (el) el.textContent = "📦 " + ready + "/" + total + " haben fertig geladen" + (ready < total ? " …" : " — warte auf den Host!");
}
function renderPremState() {
  const total = players.length;
  const ready = players.filter(p => p.prem).length;
  const el = $("prem-status");
  if (el) el.textContent = "📦 " + ready + "/" + total + " haben fertig geladen" + (ready < total ? " …" : " — alle bereit!");
  if (isHost) {
    $("btn-prem-start").style.display = "";
    $("btn-prem-start").disabled = ready < total;
  }
}

function premStart() {
  premiereLocked = true;
  renderRedoPanel("redo-panel-wait"); renderRedoPanel("redo-panel-prem");
  pendingRate = true;
  $("btn-replay").disabled = false;
  $("btn-download").disabled = false;
  $("btn-prem-start") && ($("btn-prem-start").style.display = "none");
  status("play-status", "🍿 Premiere!");
  countdown().then(() => playMix(false));
}

$("btn-prem-start").onclick = () => {
  broadcast({ t: "premGo" });
  premStart();
};
$("btn-replay").onclick = () => playMix(false);
$("btn-download").onclick = () => playMix(true);
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
    voiceGain.connect(comp); vidGain.connect(comp);
    comp.connect(masterGain); masterGain.connect(ctx.destination);
    elementSource(ctx, v).connect(vidGain);
    premNodes = { comp, masterGain, voiceGain, vidGain };
    applyPremVol();
  }
  return premNodes;
}
function applyPremVol() {
  if (!premNodes) return;
  premNodes.masterGain.gain.value = premVol.master;
  premNodes.voiceGain.gain.value = premVol.voice;
  premNodes.vidGain.gain.value = premVol.video;
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
    status("play-status", "⚡ Rendere Ton … (dauert nur Sekunden, kein Zuschauen nötig)");
    const OfflineCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const lastEnd = Math.max(1, ...scene.lines.map(l => l.end)) + 1.5;
    const offlineCtx = new OfflineCtor(2, Math.ceil(lastEnd * 44100), 44100);

    const master = offlineCtx.createDynamicsCompressor();
    master.threshold.value = -18; master.knee.value = 20; master.ratio.value = 4; master.attack.value = 0.005; master.release.value = 0.15;
    master.connect(offlineCtx.destination);

    // Video-eigene Tonspur (Musik/SFX) mit reinrechnen
    try {
      const videoBuf = await (await fetch(videoBlobUrl || scene.videoUrl)).arrayBuffer();
      const videoAudio = await offlineCtx.decodeAudioData(videoBuf.slice(0));
      const vSrc = offlineCtx.createBufferSource();
      vSrc.buffer = videoAudio;
      vSrc.connect(master);
      vSrc.start(0);
    } catch (e) { console.warn("Video-Ton nicht verfügbar für Offline-Export:", e); }

    for (const item of mixItems) {
      let role = item.role != null ? (roleOf(item.role) || { pan: 0, effect: "none", gain: 1 }) : { pan: 0, effect: "none", gain: 1 };
      if (scene.lines && item.lineIdx != null) role = effectiveRole(role, scene.lines[item.lineIdx]);
      if (item.effect) role = { ...role, effect: item.effect };
      const src = offlineCtx.createBufferSource();
      src.buffer = item.buffer;
      src.playbackRate.value = effectPitch(role.effect);
      src.connect(buildChain(offlineCtx, role, master));
      let maxDur = item.buffer.duration;
      if (scene.lines && item.lineIdx != null) {
        const l = scene.lines[item.lineIdx];
        const cutoffT = nextSameRoleStart(item.lineIdx);
        maxDur = Math.min(maxDur, ((cutoffT != null ? cutoffT : l.end + 0.8) - l.t) + 0.25);
      }
      const when = Math.max(0, item.startAt + syncOffsetMs / 1000);
      src.start(when, 0, maxDur);
    }

    const rendered = await offlineCtx.startRendering();
    const blob = audioBufferToWav(rendered);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = (scene?.id || "synchro") + "_ton.wav";
    a.click();
    status("play-status", "✅ Ton gespeichert (WAV, sofort)! Einfach auf die Videospur in CapCut/Premiere/AE ziehen.");
    SFX.done();
  } catch (e) {
    console.error("Schneller Ton-Export fehlgeschlagen:", e);
    status("play-status", "❌ Ton-Export hat nicht geklappt — F12-Konsole für Details.", true);
  }
}

async function playMix(saveFile) {
  const ctx = getCtx();
  const v = $("play-video");
  playNodes.forEach(n => { try { n.stop(); } catch {} });
  playNodes = [];

  const g = premGraph(ctx, v);
  const master = g.voiceGain;          // Stimmen laufen über den Voice-Regler in den Graph
  v.playbackRate = 1;

  let fileRec = null;
  if (saveFile) {
    const dest = ctx.createMediaStreamDestination();
    g.masterGain.connect(dest);
    const capture = (v.captureStream || v.mozCaptureStream).call(v);
    const stream = new MediaStream([...capture.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
    fileRec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
    const chunks = [];
    fileRec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    fileRec.onstop = () => {
      try { g.masterGain.disconnect(dest); } catch {}
      const url = URL.createObjectURL(new Blob(chunks, { type: "video/webm" }));
      const a = document.createElement("a");
      a.href = url; a.download = (scene?.id || "synchro") + "_dub.webm";
      a.click();
      status("play-status", "✅ Gespeichert! Für TikTok/Insta die .webm in CapCut o. Ä. zu MP4 exportieren.");
      SFX.done();
    };
    status("play-status", "🔴 Nimmt Video auf — läuft einmal in Originallänge durch. Tab kann im Hintergrund bleiben.");
    $("dl-progress").style.display = "";
  }

  v.pause(); v.currentTime = 0;
  await v.play();
  if (fileRec) {
    fileRec.start();
    const progInterval = setInterval(() => {
      const pct = v.duration ? Math.round((v.currentTime / v.duration) * 100) : 0;
      $("dl-progress-bar").style.width = pct + "%";
      $("dl-progress-label").textContent = pct + "%";
      if (v.ended || fileRec.state === "inactive") clearInterval(progInterval);
    }, 200);
    v.addEventListener("ended", () => { clearInterval(progInterval); $("dl-progress").style.display = "none"; }, { once: true });
  }
  const t0 = ctx.currentTime;
  const off = syncOffsetMs / 1000;

  for (const item of mixItems) {
    let role = item.role != null ? (roleOf(item.role) || { pan: 0, effect: "none", gain: 1 }) : { pan: 0, effect: "none", gain: 1 };
    if (scene.lines && item.lineIdx != null) role = effectiveRole(role, scene.lines[item.lineIdx]);
    if (item.effect) role = { ...role, effect: item.effect };   // Spieler-eigene Wahl übersticht alles andere
    const src = ctx.createBufferSource();
    src.buffer = item.buffer;
    src.playbackRate.value = effectPitch(role.effect);
    src.connect(buildChain(ctx, role, master));
    // Spur auf ihr Line-Fenster begrenzen → kein Reinlabern in die nächste Line
    let maxDur = item.buffer.duration;
    if (scene.lines && item.lineIdx != null) {
      const l = scene.lines[item.lineIdx];
      const cutoffT = nextSameRoleStart(item.lineIdx);
      maxDur = Math.min(maxDur, ((cutoffT != null ? cutoffT : l.end + 0.8) - l.t) + 0.25);
    }
    const when = t0 + item.startAt + off;
    if (when >= ctx.currentTime) src.start(when, 0, maxDur);
    else src.start(ctx.currentTime, ctx.currentTime - when, Math.max(0.05, maxDur - (ctx.currentTime - when)));
    playNodes.push(src);
  }
  // Videoende = ALLES stoppt → kein 1–2s-Nachlauf-Audio mehr
  v.addEventListener("ended", () => {
    playNodes.forEach(n => { try { n.stop(); } catch {} });
    if (pendingRate && !saveFile) { pendingRate = false; showRateCard(); }
  }, { once: true });

  if (fileRec) v.addEventListener("ended", () => { if (fileRec.state !== "inactive") fileRec.stop(); }, { once: true });
}


$("vol-master").oninput = e => { premVol.master = parseFloat(e.target.value); applyPremVol(); };
$("vol-voice").oninput  = e => { premVol.voice  = parseFloat(e.target.value); applyPremVol(); };
$("vol-video").oninput  = e => { premVol.video  = parseFloat(e.target.value); applyPremVol(); };
let boothVol = 0.55;
$("booth-vol").oninput = e => { boothVol = parseFloat(e.target.value); $("booth-video").volume = boothVol; };

$("sync-offset").oninput = (e) => { syncOffsetMs = parseInt(e.target.value); $("sync-val").textContent = syncOffsetMs + " ms"; };

// ── Effekt-Ketten ────────────────────────────────────────────
function buildChain(ctx, role, dest) {
  const input = ctx.createGain();
  input.gain.value = role.gain ?? 1;
  const pan = ctx.createStereoPanner();
  pan.pan.value = role.pan ?? 0;

  let node = input;
  const filt = (type, freq, q, gain) => {
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq;
    if (q) f.Q.value = q; if (gain) f.gain.value = gain;
    node.connect(f); node = f;
  };

  switch (role.effect) {
    case "vintage_1990":
      filt("highpass", 120); filt("lowpass", 6200);
      filt("peaking", 2800, 1, 3);
      node = chainShaper(ctx, node, 6);
      break;
    case "radio":
      filt("highpass", 380); filt("lowpass", 3000);
      node = chainShaper(ctx, node, 25);
      break;
    case "telefon":
      filt("highpass", 300); filt("lowpass", 3400);
      break;
    case "megaphone":
      filt("highpass", 500); filt("lowpass", 2600); filt("peaking", 1500, 2, 8);
      node = chainShaper(ctx, node, 45);
      break;
    case "underwater":
      filt("lowpass", 700); filt("peaking", 300, 1.5, 4);
      break;
    case "helium":
      filt("highpass", 200); filt("peaking", 3500, 1, 6);
      break;
    case "monster":
      filt("lowpass", 2200); filt("peaking", 150, 1.2, 5);
      break;
    case "robot": {
      const lfo = ctx.createOscillator(); lfo.type = "square"; lfo.frequency.value = 32;
      const ringGain = ctx.createGain(); ringGain.gain.value = 0.5;
      const dcOffset = ctx.createGain(); dcOffset.gain.value = 0.5;
      lfo.connect(ringGain.gain);
      node.connect(ringGain); node.connect(dcOffset);
      const merge = ctx.createGain();
      ringGain.connect(merge); dcOffset.connect(merge);
      node = merge;
      try { lfo.start(); } catch {}
      filt("bandpass", 1800, 0.7);
      break;
    }
    case "hall": {
      const dry = ctx.createGain(); dry.gain.value = 0.85;
      const wet = ctx.createGain(); wet.gain.value = 0.4;
      const delay = ctx.createDelay(); delay.delayTime.value = 0.11;
      const fb = ctx.createGain(); fb.gain.value = 0.38;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2400;
      node.connect(dry); dry.connect(pan);
      node.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay);
      lp.connect(wet); wet.connect(pan);
      pan.connect(dest);
      return input;
    }
  }
  node.connect(pan);
  pan.connect(dest);
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
    const mine = cur && myRoleId != null && cur.chars.includes(myRoleId);
    const av = cur && scene.avatars ? scene.avatars[String(cur.chars[0])] : null;
    promptEl.innerHTML =
      (cur ? `<div class="pline ${mine ? "mine" : ""}">
          ${av ? `<img src="${av}" alt="">` : ""}
          <div class="ptext"><div class="pwho">${esc(cur.who)}${mine ? " — 🎙 DU!" : ""}</div><div class="pcap">${esc(cur.text)}</div>${(cur.de && !scene.blind) ? `<div style="font-size:.85rem;color:var(--amber)">${esc(cur.de)}</div>` : ""}</div>
        </div>` : `<div class="pline"><div class="ptext"><div class="pwho">…</div><div class="pcap" style="color:var(--muted)">Ruhe im Studio</div></div></div>`) +
      (next ? `<div class="pnext">Gleich (${Math.max(0, next.t - t).toFixed(0)}s): <b>${esc(next.who)}</b> — ${esc(next.text)}</div>` : "");
  };
}

// ═════════════════════════════════════════════════════════════
// 10) NEUE RUNDE
// ═════════════════════════════════════════════════════════════
$("btn-again").onclick = () => {
  if (isHost) { broadcast({ t: "again" }); resetForNewRound(); }
  else status("play-status", "Nur der Host kann eine neue Runde starten.", true);
};
$("btn-back").onclick = () => {
  if (isHost) { scene = null; broadcast({ t: "again" }); resetForNewRound(); $("scene-card").style.display = "none"; }
  else status("play-status", "Nur der Host kann die Szene wechseln.", true);
};
function resetForNewRound() {
  players.forEach(p => { p.ready = false; p.done = 0; p.total = 0; p.prem = false; });
  mixItems = []; collected.clear(); takes = {};
  finalTracksData = null; premiereLocked = false; redoMode = null;
  pendingRate = false; rateSent = false; allRatings.clear(); myStars = {};
  $("rate-card").style.display = "none";
  $("rate-rows").innerHTML = ""; $("rate-result").innerHTML = "";
  $("btn-rate-submit").textContent = "Bewertung abschicken";
  $("btn-rate-submit").disabled = true;
  $("btn-next-round").style.display = "none";
  if (isHost) { ttt = { p: [], board: Array(9).fill(null), turn: 0, winner: null }; broadcast({ t: "tttState", ttt }); renderTTT(); }
  show("scr-lobby");
  if (isHost) broadcastState(); else { renderPlayers(); renderRoles(); }
  status("lobby-status", "Neue Runde — wieder „Bin bereit“ drücken, wenn's losgehen soll.");
}
