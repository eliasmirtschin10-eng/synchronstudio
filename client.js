/* ═══════════════════════════════════════════════════════════════
   SYNCHRONSTUDIO — privates Online-Dubbing-Game
   Komplett statisch: PeerJS (P2P) statt eigenem Server.
   Host = Autorität. Gäste verbinden sich über den Raumcode.
   ═══════════════════════════════════════════════════════════════ */

const PEER_PREFIX = "syncstudio-emvw-";   // macht die Raum-IDs auf dem öffentlichen PeerServer einzigartig — kannst du ändern
const CHUNK_SIZE = 128 * 1024;            // Video-Übertragung in 128-KB-Häppchen

// ── State ────────────────────────────────────────────────────
let peer = null;
let isHost = false;
let myName = "";
let myId = "";
let hostConn = null;              // Gast → Host
const conns = new Map();          // Host: peerId → conn
let players = [];                 // [{id, name, role, ready}]
let scene = null;                 // {title, roles:[{id,name,pan,effect,gain}], videoUrl?}
let localVideoBuf = null;         // ArrayBuffer, wenn Host eigenes Video nutzt
let videoBlobUrl = null;
let micStream = null;
let recorder = null;
let recChunks = [];
let audioCtx = null;
let tracks = {};                  // roleId → AudioBuffer
let playNodes = [];
let syncOffsetMs = 0;

// ── Kleine Helfer ────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const show = (id) => {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  $(id).classList.add("active");
};
const status = (id, msg, isErr) => {
  const el = $(id);
  el.textContent = msg;
  el.style.color = isErr ? "var(--rec)" : "";
};
const randCode = () => String(Math.floor(1000 + Math.random() * 9000));

// ═════════════════════════════════════════════════════════════
// 1) RAUM ERSTELLEN / BEITRETEN
// ═════════════════════════════════════════════════════════════

$("btn-create").onclick = () => {
  myName = $("in-name").value.trim();
  if (!myName) return status("start-status", "Erst Namen eingeben, digga 😄", true);
  isHost = true;
  const code = randCode();
  status("start-status", "Erstelle Raum …");
  peer = new Peer(PEER_PREFIX + code);
  peer.on("open", () => {
    myId = peer.id;
    players = [{ id: myId, name: myName + " (Host)", role: null, ready: false }];
    enterLobby(code);
    loadSceneList();
  });
  peer.on("connection", (conn) => setupHostConn(conn));
  peer.on("error", (e) => {
    if (e.type === "unavailable-id") { peer.destroy(); $("btn-create").click(); } // Code schon belegt → neu würfeln
    else status("start-status", "Verbindungsfehler: " + e.type, true);
  });
};

$("btn-join").onclick = () => {
  myName = $("in-name").value.trim();
  const code = $("in-code").value.trim();
  if (!myName) return status("start-status", "Erst Namen eingeben 🙂", true);
  if (!/^\d{4}$/.test(code)) return status("start-status", "Der Raumcode hat 4 Ziffern.", true);
  isHost = false;
  status("start-status", "Verbinde …");
  peer = new Peer();
  peer.on("open", () => {
    myId = peer.id;
    hostConn = peer.connect(PEER_PREFIX + code, { reliable: true });
    hostConn.on("open", () => {
      hostConn.send({ t: "hello", name: myName });
      enterLobby(code);
    });
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
}

// ═════════════════════════════════════════════════════════════
// 2) NACHRICHTEN (Host = Verteiler)
// ═════════════════════════════════════════════════════════════

function setupHostConn(conn) {
  conn.on("open", () => conns.set(conn.peer, conn));
  conn.on("data", (msg) => handleMsg(msg, conn));
  conn.on("close", () => {
    conns.delete(conn.peer);
    players = players.filter(p => p.id !== conn.peer);
    broadcastState();
  });
}

function broadcast(msg) { conns.forEach(c => { if (c.open) c.send(msg); }); }
function broadcastState() {
  renderPlayers();
  broadcast({ t: "state", players });
  checkStartable();
}

function handleMsg(msg, conn) {
  switch (msg.t) {

    // — beim Host —
    case "hello":
      players.push({ id: conn.peer, name: msg.name, role: null, ready: false });
      // Neuem Spieler den aktuellen Stand schicken
      if (scene) {
        if (localVideoBuf) sendLocalVideo(conn);
        else conn.send({ t: "scene", scene });
      }
      broadcastState();
      break;

    case "pickRole": {
      const taken = players.some(p => p.role === msg.role && p.id !== conn.peer);
      if (!taken) {
        const p = players.find(p => p.id === conn.peer);
        if (p) { p.role = msg.role; p.ready = false; }
      }
      broadcastState();
      break;
    }

    case "ready": {
      const p = players.find(p => p.id === conn.peer);
      if (p) p.ready = true;
      broadcastState();
      break;
    }

    case "audio":
      collectAudio(msg.role, msg.buf);
      break;

    // — bei Gästen —
    case "state":
      players = msg.players;
      renderPlayers();
      renderRoles();
      break;

    case "scene":
      scene = msg.scene;
      videoBlobUrl = null;
      showScene(scene.videoUrl);
      break;

    case "videoMeta":
      startVideoReceive(msg);
      break;
    case "videoChunk":
      receiveVideoChunk(msg.buf);
      break;

    case "go":
      startRecording();
      break;

    case "mix":
      loadMix(msg.tracks);
      break;

    case "again":
      resetForNewRound();
      break;
  }
}

// ═════════════════════════════════════════════════════════════
// 3) SZENEN — scenes.json ODER eigenes Video vom PC
// ═════════════════════════════════════════════════════════════

let sceneList = [];

async function loadSceneList() {
  try {
    const res = await fetch("scenes.json");
    sceneList = await res.json();
  } catch { sceneList = []; }
  const sel = $("scene-select");
  sel.innerHTML = sceneList.length
    ? sceneList.map((s, i) => `<option value="${i}">${s.title} (${s.roles.length} Rollen)</option>`).join("")
    : "<option>— keine Szenen in scenes.json —</option>";
}

$("btn-load-scene").onclick = () => {
  const s = sceneList[$("scene-select").value];
  if (!s) return;
  scene = s; localVideoBuf = null; videoBlobUrl = null;
  resetRoles();
  showScene(scene.videoUrl);
  broadcast({ t: "scene", scene });
  broadcastState();
};

// — Eigenes Video: Rollen-Editor —
const EFFECTS = { none: "Normal", vintage_1990: "Vintage / 90er Tape", radio: "Funkgerät", telefon: "Telefon", hall: "Halliger Raum" };

$("file-video").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  status("scene-status", "Lese Video ein …");
  localVideoBuf = await f.arrayBuffer();
  if (localVideoBuf.byteLength > 60 * 1024 * 1024)
    status("scene-status", "⚠ " + Math.round(localVideoBuf.byteLength / 1e6) + " MB — geht, aber die Übertragung an die anderen dauert. Unter 30 MB ist smoother.");
  else status("scene-status", "Video geladen (" + Math.round(localVideoBuf.byteLength / 1e6) + " MB). Jetzt Rollen einstellen.");
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
    name: div.querySelector('input[type=text]').value || "Charakter " + (i + 1),
    pan: parseFloat(div.querySelector('input[type=range]').value),
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

function resetRoles(){ players.forEach(p => { p.role = null; p.ready = false; }); }

// — Video-Übertragung an Gäste (chunked) —
function sendLocalVideo(conn) {
  conn.send({ t: "videoMeta", scene, size: localVideoBuf.byteLength });
  let off = 0;
  const pump = () => {
    while (off < localVideoBuf.byteLength) {
      if (conn.dataChannel && conn.dataChannel.bufferedAmount > 4 * 1024 * 1024) { setTimeout(pump, 100); return; }
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
  }
}

function showScene(src) {
  $("scene-card").style.display = "";
  $("scene-title").textContent = scene.title;
  if (src) $("preview").src = src;
  renderRoles();
}

// ═════════════════════════════════════════════════════════════
// 4) LOBBY-UI: Spieler, Rollen, Bereit
// ═════════════════════════════════════════════════════════════

function renderPlayers() {
  $("player-list").innerHTML = players.map(p => {
    const role = p.role != null && scene ? (scene.roles.find(r => r.id === p.role)?.name || "?") : null;
    return `<div class="player ${p.ready ? "ready" : ""}">
      <span class="pname">${esc(p.name)}</span>
      <span class="prole ${role ? "" : "empty"}">${role ? "🎭 " + esc(role) : "noch keine Rolle"}</span>
      ${p.ready ? '<span class="tag" style="color:var(--ok)">bereit</span>' : ""}
    </div>`;
  }).join("");
}

function renderRoles() {
  if (!scene) return;
  $("role-list").innerHTML = scene.roles.map(r => {
    const owner = players.find(p => p.role === r.id);
    const mine = owner && owner.id === myId;
    return `<button class="rolebtn ${mine ? "mine" : owner ? "taken" : ""}" data-r="${r.id}" ${owner && !mine ? "disabled" : ""}>
      <span>${esc(r.name)}</span>
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
  } else {
    hostConn.send({ t: "pickRole", role: roleId });
  }
}

$("btn-ready").onclick = async () => {
  const me = players.find(p => p.id === myId);
  const myRole = isHost ? me?.role : players.find(p => p.id === myId)?.role;
  if (myRole == null) return status("lobby-status", "Erst eine Rolle aussuchen!", true);
  if (!videoReady()) return status("lobby-status", "Video lädt noch …", true);
  const ok = await ensureMic();
  if (!ok) return;
  if (isHost) { me.ready = true; broadcastState(); }
  else hostConn.send({ t: "ready" });
  status("lobby-status", "✅ Bereit! Warten auf die anderen …");
};

function videoReady() {
  return isHost ? true : (videoBlobUrl || (scene && scene.videoUrl));
}

function checkStartable() {
  if (!isHost) return;
  const withRole = players.filter(p => p.role != null);
  const ok = withRole.length >= 1 && withRole.every(p => p.ready) && players.every(p => p.role != null);
  $("btn-start").disabled = !ok;
  $("start-hint").textContent = ok ? "Alle bereit — los geht's!" : "Warte, bis alle eine Rolle haben und „bereit“ sind …";
}

// ── Mikro ────────────────────────────────────────────────────
async function ensureMic() {
  if (micStream) return true;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    return true;
  } catch {
    status("lobby-status", "Kein Mikro-Zugriff. In den Browser-Einstellungen erlauben!", true);
    return false;
  }
}

$("btn-mic-test").onclick = async () => {
  if (!(await ensureMic())) return;
  status("lobby-status", "🎤 Sprich jetzt 3 Sekunden …");
  const rec = new MediaRecorder(micStream, { mimeType: pickMime() });
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
// 5) AUFNAHME — synchron bei allen
// ═════════════════════════════════════════════════════════════

$("btn-start").onclick = () => {
  broadcast({ t: "go" });
  startRecording();
};

function pickMime() {
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"])
    if (MediaRecorder.isTypeSupported(m)) return m;
  return "";
}

// ── Teleprompter (Choicer-Voicer-Style Line-Cues) ────────────
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
          <div class="ptext"><div class="pwho">${esc(cur.who)}</div><div class="pcap">${esc(cur.text)}</div></div>
        </div>` : `<div class="pline"><div class="ptext"><div class="pwho">…</div><div class="pcap" style="color:var(--muted)">Ruhe im Studio</div></div></div>`) +
      (next ? `<div class="pnext">Gleich (${Math.max(0, next.t - t).toFixed(0)}s): <b>${esc(next.who)}</b> — ${esc(next.text)}</div>` : "");
  };
}

async function startRecording() {
  const me = players.find(p => p.id === myId);
  const role = scene.roles.find(r => r.id === me.role);
  $("rec-role").textContent = "🎭 Du bist: " + role.name;
  const v = $("rec-video");
  v.src = videoBlobUrl || scene.videoUrl;
  attachPrompter(v, $("rec-prompter"), me.role);
  show("scr-record");

  await countdown();
  $("onair").classList.add("live");

  recChunks = [];
  recorder = new MediaRecorder(micStream, { mimeType: pickMime() });
  recorder.ondataavailable = e => { if (e.data.size) recChunks.push(e.data); };
  recorder.onstop = onRecorded;

  // Beides so gleichzeitig wie möglich starten
  recorder.start();
  v.currentTime = 0;
  await v.play();

  v.onended = () => { if (recorder.state !== "inactive") recorder.stop(); };
}

function countdown() {
  return new Promise(res => {
    const el = $("countdown"), num = el.querySelector("div");
    el.classList.add("show");
    let n = 3;
    num.textContent = n;
    const iv = setInterval(() => {
      n--;
      if (n === 0) { clearInterval(iv); el.classList.remove("show"); res(); }
      else num.textContent = n;
    }, 900);
  });
}

async function onRecorded() {
  $("onair").classList.remove("live");
  status("rec-status", "Aufnahme fertig — sammle alle Spuren ein …");
  const buf = await new Blob(recChunks, { type: recChunks[0]?.type }).arrayBuffer();
  const me = players.find(p => p.id === myId);
  if (isHost) collectAudio(me.role, buf);
  else hostConn.send({ t: "audio", role: me.role, buf });
}

// — Host sammelt & verteilt den Mix —
const collected = new Map();
function collectAudio(roleId, buf) {
  collected.set(roleId, buf);
  const needed = players.filter(p => p.role != null).length;
  if (collected.size >= needed) {
    const trackList = [...collected.entries()].map(([role, b]) => ({ role, buf: b }));
    broadcast({ t: "mix", tracks: trackList });
    loadMix(trackList);
    collected.clear();
  }
}

// ═════════════════════════════════════════════════════════════
// 6) PREMIERE — Web Audio Engine (Pan + Effekte + Kompressor)
// ═════════════════════════════════════════════════════════════

function getCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

async function loadMix(trackList) {
  show("scr-playback");
  status("play-status", "Dekodiere Spuren …");
  const ctx = getCtx();
  tracks = {};
  for (const t of trackList) {
    try { tracks[t.role] = await ctx.decodeAudioData(t.buf.slice(0)); }
    catch { console.warn("Spur kaputt:", t.role); }
  }
  $("play-video").src = videoBlobUrl || scene.videoUrl;
  attachPrompter($("play-video"), $("play-prompter"), null);
  status("play-status", "Bereit! Drück Play. 🍿");
  playMix();
}

$("btn-replay").onclick = playMix;

async function playMix() {
  const ctx = getCtx();
  const v = $("play-video");
  playNodes.forEach(n => { try { n.stop(); } catch {} });
  playNodes = [];

  // Master: Kompressor sorgt dafür, dass alles zusammen "wie aus einem Guss" klingt
  const master = ctx.createDynamicsCompressor();
  master.threshold.value = -18; master.knee.value = 20;
  master.ratio.value = 4; master.attack.value = 0.005; master.release.value = 0.15;
  master.connect(ctx.destination);

  v.pause(); v.currentTime = 0;
  await v.play();
  const t0 = ctx.currentTime + Math.max(0, syncOffsetMs / 1000);
  const early = Math.max(0, -syncOffsetMs / 1000);

  for (const [roleId, buffer] of Object.entries(tracks)) {
    const role = scene.roles.find(r => r.id === parseInt(roleId)) || { pan: 0, effect: "none", gain: 1 };
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(buildChain(ctx, role, master));
    src.start(t0, early);
    playNodes.push(src);
  }
}

$("sync-offset").oninput = (e) => {
  syncOffsetMs = parseInt(e.target.value);
  $("sync-val").textContent = syncOffsetMs + " ms";
};

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
      node = chainShaper(ctx, node, 6); // sanfte Tape-Sättigung
      break;
    case "radio":
      filt("highpass", 380); filt("lowpass", 3000);
      node = chainShaper(ctx, node, 25);
      break;
    case "telefon":
      filt("highpass", 300); filt("lowpass", 3400);
      break;
    case "hall": {
      // Dry + Echo-Fahne (Delay-Feedback, dumpf gefiltert)
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

function chainShaper(ctx, node, amount) {
  const s = shaper(ctx, amount);
  node.connect(s);
  return s;
}
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

// ═════════════════════════════════════════════════════════════
// 7) NEUE RUNDE
// ═════════════════════════════════════════════════════════════

if (true) {
  $("btn-again").style.display = "";
  $("btn-back").style.display = "";
}
$("btn-again").onclick = () => {
  if (isHost) { broadcast({ t: "again" }); resetForNewRound(); }
  else status("play-status", "Nur der Host kann eine neue Runde starten.", true);
};
$("btn-back").onclick = () => {
  if (isHost) { scene = null; broadcast({ t: "again" }); resetForNewRound(); $("scene-card").style.display = "none"; }
  else status("play-status", "Nur der Host kann die Szene wechseln.", true);
};

function resetForNewRound() {
  players.forEach(p => p.ready = false);
  tracks = {}; collected.clear();
  show("scr-lobby");
  if (isHost) broadcastState(); else { renderPlayers(); renderRoles(); }
  status("lobby-status", "Neue Runde — wieder „Bin bereit“ drücken, wenn's losgehen soll.");
}

function esc(s) { return String(s).replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c])); }
