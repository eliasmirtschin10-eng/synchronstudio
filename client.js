/* ═══════════════════════════════════════════════════════════════
   SYNCHRONSTUDIO — privates Online-Dubbing-Game
   Statisch (GitHub Pages) + PeerJS (P2P). Host = Autorität.
   Modus A: Line-Booth (Szenen mit "lines"-Timings, Choicer-Voicer-Style)
   Modus B: Realtime (eigene Videos ohne Timings)
   ═══════════════════════════════════════════════════════════════ */

const PEER_PREFIX = "syncstudio-emvw-";
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
const show = (id) => { document.querySelectorAll(".screen").forEach(s => s.classList.remove("active")); $(id).classList.add("active"); };
const status = (id, msg, isErr) => { const el = $(id); el.textContent = msg; el.style.color = isErr ? "var(--hot)" : ""; };
const randCode = () => String(Math.floor(1000 + Math.random() * 9000));
const esc = (s) => String(s).replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

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

// ═════════════════════════════════════════════════════════════
// MIKROFON — Einstellungen + Processing-Graph
// Aufnahmen laufen durch: Quelle → Brumm-Filter → Gain → recDest
// ═════════════════════════════════════════════════════════════
const micSettings = { deviceId: null, ns: true, ec: true, agc: true, lowcut: true, gain: 1 };
let micSrcNode = null, micHP = null, micGain = null, recDest = null;
let vizAn = null, vizRAF = null;
let micReturnScreen = "scr-start";

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
      micGain = ctx.createGain();
      vizAn = ctx.createAnalyser(); vizAn.fftSize = 256;
      micHP.connect(micGain); micGain.connect(recDest); micGain.connect(vizAn);
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
  if (!micHP) return;
  micHP.frequency.value = micSettings.lowcut ? 90 : 5;
  micGain.gain.value = micSettings.gain;
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
$("btn-mic-done").onclick = () => { cancelAnimationFrame(vizRAF); show(micReturnScreen); SFX.ok(); };
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
$("mic-gain").oninput = e => { micSettings.gain = parseFloat(e.target.value); $("mic-gain-val").textContent = Math.round(micSettings.gain * 100) + "%"; applyMicTuning(); };
// Beim ersten Klick irgendwo den Setup starten (AudioContext braucht eine Geste)
document.addEventListener("click", function once() { if (document.querySelector("#scr-mic.active") && !micStream) initMicScreen(); }, { once: true });


// ═════════════════════════════════════════════════════════════
// 1) RAUM ERSTELLEN / BEITRETEN
// ═════════════════════════════════════════════════════════════
$("btn-create").onclick = () => {
  myName = $("in-name").value.trim();
  if (!myName) return status("start-status", "Erst Namen eingeben, digga 😄", true), SFX.err();
  isHost = true;
  const code = randCode();
  status("start-status", "Erstelle Raum …");
  peer = new Peer(PEER_PREFIX + code);
  peer.on("open", () => {
    myId = peer.id;
    players = [{ id: myId, name: myName + " (Host)", role: null, ready: false, done: 0, total: 0 }];
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
  isHost = false;
  status("start-status", "Verbinde …");
  peer = new Peer();
  peer.on("open", () => {
    myId = peer.id;
    hostConn = peer.connect(PEER_PREFIX + code, { reliable: true });
    hostConn.on("open", () => { hostConn.send({ t: "hello", name: myName }); enterLobby(code); });
    hostConn.on("data", (msg) => handleMsg(msg, hostConn));
    hostConn.on("close", () => status("lobby-status", "Verbindung zum Host weg 😬 Seite neu laden.", true));
  });
  peer.on("error", (e) => {
    if (e.type === "peer-unavailable") status("start-status", "Raum " + code + " nicht gefunden. Läuft der Host noch?", true);
    else status("start-status", "Verbindungsfehler: " + e.type, true);
  });
};

function enterLobby(code) {
  $("lobby-code").textContent = code;
  if (isHost) { $("host-scene").style.display = ""; $("host-start").style.display = ""; }
  show("scr-lobby");
  renderPlayers();
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
function broadcastState() { renderPlayers(); renderBoothPlayers(); broadcast({ t: "state", players }); checkStartable(); checkAllDone(); }

function handleMsg(msg, conn) {
  switch (msg.t) {
    // — beim Host —
    case "hello": {
      const cap = scene ? scene.roles.length : 4;
      if (players.length >= cap) { conn.send({ t: "full", cap }); setTimeout(() => conn.close(), 500); break; }
      players.push({ id: conn.peer, name: msg.name, role: null, ready: false, done: 0, total: 0 });
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

    // — bei Gästen —
    case "full":
      status("start-status", "Raum ist voll — diese Szene hat nur " + msg.cap + " Rollen. 😅", true);
      show("scr-start"); break;
    case "state": players = msg.players; renderPlayers(); renderRoles(); renderBoothPlayers(); break;
    case "scene": scene = msg.scene; videoBlobUrl = null; showScene(scene.videoUrl); break;
    case "videoMeta": startVideoReceive(msg); break;
    case "videoChunk": receiveVideoChunk(msg.buf); break;
    case "goLines": startBooth(); break;
    case "go": startRealtime(); break;
    case "mix": loadMix(msg.data); break;
    case "again": resetForNewRound(); break;
  }
}

// ═════════════════════════════════════════════════════════════
// 3) SZENEN
// ═════════════════════════════════════════════════════════════
let sceneList = [];
async function loadSceneList() {
  try { sceneList = await (await fetch("scenes.json")).json(); } catch { sceneList = []; }
  const sel = $("scene-select");
  sel.innerHTML = sceneList.length
    ? sceneList.map((s, i) => `<option value="${i}">${esc(s.title)} (${s.roles.length} Rollen${s.lines ? ", " + s.lines.length + " Lines" : ""})</option>`).join("")
    : "<option>— keine Szenen in scenes.json —</option>";
}

$("btn-load-scene").onclick = () => {
  const s = sceneList[$("scene-select").value];
  if (!s) return;
  if (players.length > s.roles.length)
    return status("scene-status", "⚠ Ihr seid " + players.length + " Leute, aber die Szene hat nur " + s.roles.length + " Rollen.", true);
  scene = s; localVideoBuf = null; videoBlobUrl = null;
  resetRoles();
  showScene(scene.videoUrl);
  broadcast({ t: "scene", scene });
  broadcastState();
};

const EFFECTS = { none: "Normal", vintage_1990: "Vintage / 90er Tape", radio: "Funkgerät", telefon: "Telefon", hall: "Halliger Raum" };

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
  if (players.length > roles.length)
    return status("scene-status", "⚠ Ihr seid " + players.length + " Leute, aber nur " + roles.length + " Rollen.", true);
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
  $("scene-card").style.display = "";
  $("scene-title").textContent = scene.title;
  if (src) $("preview").src = src;
  renderRoles();
}

// ═════════════════════════════════════════════════════════════
// 4) LOBBY-UI
// ═════════════════════════════════════════════════════════════
function playerCard(p) {
  const role = p.role != null && scene ? (scene.roles.find(r => r.id === p.role)?.name || "?") : null;
  const prog = p.total > 0 ? `<div class="pbar"><i style="width:${Math.round(p.done / p.total * 100)}%"></i></div><span class="tag">${p.done}/${p.total} Lines</span>` : "";
  return `<div class="player ${p.ready ? "ready" : ""}">
    <span class="pname">${esc(p.name)}</span>
    <span class="prole ${role ? "" : "empty"}">${role ? "🎭 " + esc(role) : "noch keine Rolle"}</span>
    ${p.ready && !p.total ? '<span class="tag" style="color:var(--ok)">bereit</span>' : ""}${prog}
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
  if (isHost) {
    const taken = players.some(p => p.role === roleId && p.id !== myId);
    if (taken) return;
    const me = players.find(p => p.id === myId);
    me.role = roleId; me.ready = false;
    broadcastState(); renderRoles();
  } else hostConn.send({ t: "pickRole", role: roleId });
}

$("btn-ready").onclick = async () => {
  const me = players.find(p => p.id === myId);
  if (me?.role == null) return status("lobby-status", "Erst eine Rolle aussuchen!", true), SFX.err();
  if (!isHost && !videoBlobUrl && !scene?.videoUrl) return status("lobby-status", "Video lädt noch …", true);
  if (!(await ensureMic())) return;
  if (isHost) { me.ready = true; broadcastState(); }
  else hostConn.send({ t: "ready" });
  status("lobby-status", "✅ Bereit! Warten auf die anderen …");
  SFX.ok();
};

function checkStartable() {
  if (!isHost) return;
  const ok = players.length && players.every(p => p.role != null && p.ready);
  $("btn-start").disabled = !ok;
  $("start-hint").textContent = ok ? "Alle bereit — los geht's!" : "Warte, bis alle eine Rolle haben und „bereit“ sind …";
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
$("btn-start").onclick = () => {
  if (scene.lines?.length) { broadcast({ t: "goLines" }); startBooth(); }
  else { broadcast({ t: "go" }); startRealtime(); }
};

// ═════════════════════════════════════════════════════════════
// 6) LINE-BOOTH — Zeile für Zeile, unendlich Versuche
// ═════════════════════════════════════════════════════════════
let myLines = [], curLine = 0, takes = {};   // takes: lineIdx → ArrayBuffer
let lineRec = null, lineChunks = [], recTimer = null, recStartT = 0, recMax = 0;


function myRole() { return players.find(p => p.id === myId)?.role; }
function roleOf(id) { return scene.roles.find(r => r.id === id); }

function startBooth() {
  const rid = myRole();
  myLines = scene.lines.map((l, i) => ({ ...l, idx: i })).filter(l => l.chars.includes(rid));
  curLine = 0; takes = {};
  const r = roleOf(rid);
  $("booth-rolename").textContent = r.name;
  const av = scene.avatars?.[String(rid)];
  $("booth-avatar").style.display = av ? "" : "none";
  if (av) $("booth-avatar").src = av;
  $("booth-video").src = videoBlobUrl || scene.videoUrl;
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
  $("booth-count").innerHTML = `${curLine + 1}/${myLines.length}<small>Voiceline</small>`;
  $("line-who").textContent = l.who + (l.chars.length > 1 ? " (zusammen!)" : "");
  $("line-text").textContent = l.text;
  $("line-de").textContent = l.de ? "🇩🇪 " + l.de : "";
  $("line-dur").textContent = "~" + Math.max(1, Math.round(l.end - l.t)) + " Sek.";
  $("booth-video").currentTime = l.t;
  $("btn-line-play").disabled = !takes[l.idx];
  $("btn-line-next").disabled = !takes[l.idx];
  $("rectime-fill").style.width = "0";
  status("booth-status", takes[l.idx] ? "Take gespeichert — anhören, neu aufnehmen oder weiter." : "Unendlich Versuche — nimm auf, bis es sitzt.");
}

// Szenen-Ausschnitt zum Reinhören
$("btn-line-scene").onclick = () => {
  const l = myLines[curLine];
  const v = $("booth-video");
  v.currentTime = Math.max(0, l.t - 0.5);
  v.volume = 0.6;
  v.play();
  const stopAt = () => { if (v.currentTime >= l.end + 0.3) { v.pause(); v.removeEventListener("timeupdate", stopAt); } };
  v.addEventListener("timeupdate", stopAt);
};

$("btn-line-rec").onclick = () => {
  if (lineRec && lineRec.state === "recording") { stopLineRec(); return; }
  const l = myLines[curLine];
  recMax = Math.min(20, Math.max(2.5, (l.end - l.t) + 1.2));
  // Video läuft automatisch als Guide mit (leiser, Kopfhörer!)
  const v = $("booth-video");
  v.currentTime = l.t; v.volume = 0.55; v.play();
  lineChunks = [];
  lineRec = new MediaRecorder(recStream(), { mimeType: pickMime() });
  lineRec.ondataavailable = e => { if (e.data.size) lineChunks.push(e.data); };
  lineRec.onstop = onLineRecorded;
  lineRec.start();
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
};

function stopLineRec() {
  clearInterval(recTimer);
  $("booth-video").pause();
  if (lineRec && lineRec.state === "recording") lineRec.stop();
  $("btn-line-rec").textContent = "⏺ Nochmal aufnehmen";
  $("btn-line-rec").classList.remove("recording");
  SFX.stop();
}

async function onLineRecorded() {
  const l = myLines[curLine];
  takes[l.idx] = await new Blob(lineChunks, { type: lineChunks[0]?.type }).arrayBuffer();
  $("btn-line-play").disabled = false;
  $("btn-line-next").disabled = false;
  status("booth-status", "Take im Kasten! Anhören oder direkt weiter.");
}

$("btn-line-play").onclick = async () => {
  const l = myLines[curLine];
  if (!takes[l.idx]) return;
  const ctx = getCtx();
  const buf = await ctx.decodeAudioData(takes[l.idx].slice(0));
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(buildChain(ctx, roleOf(myRole()), ctx.destination));
  src.start();
};

$("btn-line-next").onclick = () => {
  SFX.ok();
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
  const items = myLines.map(l => ({ startAt: l.t, buf: takes[l.idx] })).filter(i => i.buf);
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
// 8) HOST: Spuren einsammeln → Mix an alle
// ═════════════════════════════════════════════════════════════
const collected = new Map();   // role → items
function collectTracks(role, items) {
  collected.set(role, items);
  const neededRoles = new Set(players.filter(p => p.role != null).map(p => p.role));
  if (collected.size >= neededRoles.size) {
    const data = [...collected.entries()].map(([r, it]) => ({ role: r, items: it }));
    broadcast({ t: "mix", data });
    loadMix(data);
    collected.clear();
  }
}
function checkAllDone() { /* Fortschritt läuft über state-Broadcasts */ }

// ═════════════════════════════════════════════════════════════
// 9) PREMIERE — Web-Audio-Engine + Download
// ═════════════════════════════════════════════════════════════
async function loadMix(data) {
  show("scr-playback");
  status("play-status", "Dekodiere Spuren …");
  const ctx = getCtx();
  mixItems = [];
  for (const track of data) {
    for (const item of track.items) {
      try { mixItems.push({ role: track.role, startAt: item.startAt, buffer: await ctx.decodeAudioData(item.buf.slice(0)) }); }
      catch { console.warn("Spur kaputt:", track.role); }
    }
  }
  // Nicht besetzte Rollen: Original-Stimmen aus dem Pack einsetzen
  if (scene.lines) {
    const played = new Set(data.map(t => t.role));
    for (const l of scene.lines) {
      if (!l.orig) continue;
      if (l.chars.some(c => played.has(c))) continue;   // mindestens ein Spieler spricht die Line
      try {
        const buf = await (await fetch(l.orig)).arrayBuffer();
        mixItems.push({ role: null, startAt: l.t, buffer: await ctx.decodeAudioData(buf) });
      } catch { console.warn("Original fehlt:", l.orig); }
    }
  }
  $("play-video").src = videoBlobUrl || scene.videoUrl;
  attachPrompter($("play-video"), $("play-prompter"), null);
  status("play-status", "Bereit! 🍿");
  SFX.done();
  playMix(false);
}

$("btn-replay").onclick = () => playMix(false);
$("btn-download").onclick = () => playMix(true);

const elemSrcMap = new Map();
function elementSource(ctx, v) {
  if (!elemSrcMap.has(v)) elemSrcMap.set(v, ctx.createMediaElementSource(v));
  return elemSrcMap.get(v);
}

async function playMix(saveFile) {
  const ctx = getCtx();
  const v = $("play-video");
  playNodes.forEach(n => { try { n.stop(); } catch {} });
  playNodes = [];

  const master = ctx.createDynamicsCompressor();
  master.threshold.value = -18; master.knee.value = 20;
  master.ratio.value = 4; master.attack.value = 0.005; master.release.value = 0.15;
  master.connect(ctx.destination);
  elementSource(ctx, v).connect(master);

  let fileRec = null;
  if (saveFile) {
    const dest = ctx.createMediaStreamDestination();
    master.connect(dest);
    const capture = (v.captureStream || v.mozCaptureStream).call(v);
    const stream = new MediaStream([...capture.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
    fileRec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
    const chunks = [];
    fileRec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    fileRec.onstop = () => {
      const url = URL.createObjectURL(new Blob(chunks, { type: "video/webm" }));
      const a = document.createElement("a");
      a.href = url; a.download = (scene?.id || "synchro") + "_dub.webm";
      a.click();
      status("play-status", "✅ Gespeichert! Für TikTok/Insta die .webm in CapCut o. Ä. zu MP4 exportieren.");
      SFX.done();
    };
    status("play-status", "🔴 Nimmt auf — läuft einmal komplett durch, nicht wegklicken …");
  }

  v.pause(); v.currentTime = 0;
  await v.play();
  if (fileRec) fileRec.start();
  const t0 = ctx.currentTime;
  const off = syncOffsetMs / 1000;

  for (const item of mixItems) {
    const role = item.role != null ? (roleOf(item.role) || { pan: 0, effect: "none", gain: 1 }) : { pan: 0, effect: "none", gain: 1 };
    const src = ctx.createBufferSource();
    src.buffer = item.buffer;
    src.connect(buildChain(ctx, role, master));
    const when = t0 + item.startAt + off;
    if (when >= ctx.currentTime) src.start(when);
    else src.start(ctx.currentTime, ctx.currentTime - when);
    playNodes.push(src);
  }

  if (fileRec) v.addEventListener("ended", () => { if (fileRec.state !== "inactive") fileRec.stop(); }, { once: true });
}

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
          <div class="ptext"><div class="pwho">${esc(cur.who)}${mine ? " — 🎙 DU!" : ""}</div><div class="pcap">${esc(cur.text)}</div>${cur.de ? `<div style="font-size:.85rem;color:var(--amber)">${esc(cur.de)}</div>` : ""}</div>
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
  players.forEach(p => { p.ready = false; p.done = 0; p.total = 0; });
  mixItems = []; collected.clear(); takes = {};
  show("scr-lobby");
  if (isHost) broadcastState(); else { renderPlayers(); renderRoles(); }
  status("lobby-status", "Neue Runde — wieder „Bin bereit“ drücken, wenn's losgehen soll.");
}
