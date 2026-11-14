// Stage 8 Audio Manager. Background music is three licensed MP3s (Pixabay artists, credited in
// the in-game guide, guide.js). Combat effects and the victory fanfare are synthesized with the
// Web Audio API (no files, nothing to license), and the browser's speechSynthesis supplies voice.
// Stage 9.3.1: while the Judging/Loading screen is up (scene 'battle'), the two fighters' text is
// classified into sound palettes (PALETTE_RULES) and Pixabay MP3 clips (COMBAT_SOUNDS) are scheduled
// at varied intervals on a separate, speech-ducked bus. They stop before the verdict is shown;
// the Victory/Verdict screen never plays combat effects.
//
// Scenes: 'home' / 'quiet' (Warrior MP3), 'dex' (Epic Battle MP3), 'battle' / 'victory' (Taiko MP3; battle adds the
// synthesized skirmish effects, victory adds the synthesized fanfare), 'silent'.
// Background music is MP3-only: if a track cannot load, that scene is simply silent (effects,
// fanfare and narration still work).
// Nothing plays until the browser allows it: the AudioContext is created on the first
// user gesture only, and the gesture listeners detach once audio is running.
const BGAudio = (function () {
  // ===== Music configuration (edit here) =====
  // MP3 background music. Everything about the recordings lives in this one object.
  //   startOffset: seconds to skip at the start of every play-through (0 until measured).
  //   volume:      per-track trim (1 = unchanged), multiplied by the player's "Background Music"
  //                slider (BGSettings musicVolume, default 50%). Independent of narration (the
  //                browser voice) and of the synthesized sound effects / fanfare.
  //   sceneTrack:  which track each scene uses; the same track is kept across scenes
  //                (e.g. battle -> victory) instead of being restarted.
  //   fadeOutSeconds: smooth fade over the final seconds of the recording.
  //   gapSeconds:  silence between repetitions.
  //   duckFactor:  music level multiplier while speech plays (restored smoothly afterwards).
  //   enabled:     false turns background music off entirely.
  const MUSIC_CONFIG = {
    enabled: true,
    tracks: {
      warrior: { src: 'assets/audio/music/hitslab-warrior-soldier-fighting-music-489236.mp3', startOffset: 0, volume: 1 },
      taiko: { src: 'assets/audio/music/alec_koff-japan-taiko-490663.mp3', startOffset: 0, volume: 1 },
      epic: { src: 'assets/audio/music/yevhenastafiev-epic-epic-battle-607250.mp3', startOffset: 0, volume: 1 },
    },
    sceneTrack: { home: 'warrior', quiet: 'warrior', dex: 'epic', battle: 'taiko', victory: 'taiko' },
    fadeOutSeconds: 3,
    gapSeconds: 3,
    duckFactor: 0.3,
  };

  const SFX_LEVEL = 0.5;
  const FANFARE_MS = 2900;
  const MAX_SFX_EVENTS = 6; // simultaneous combat sounds, so it never becomes a wall of noise

  let ctx = null;
  let master = null;
  let sfxBus = null;
  let noiseBuffer = null;
  let wantedScene = 'silent';
  let currentScene = null;
  let sfxSession = null; // { stop() } active only during battle
  let fanfareTimer = null;
  let speaking = 0;
  let speechTimer = null;
  let userActive = false;
  let voiceSeq = 0; // increments whenever a new music voice starts (restart detection in tests)
  let fighterTags = new Set();
  let mp3Bus = null; // all MP3 music passes through here (ducking happens on this bus)
  let combatBus = null; // AI-directed combat effects (Stage 9.3); ducked while speech plays
  let musicScene = null; // scene whose music is currently playing (mp3 or synthesized)
  const mp3 = { key: null, state: 'idle', token: 0, fading: false, timers: new Set(), els: {} }; // state: idle | starting | playing | gap

  const mode = () => BGSettings.get().audio;
  const musicOn = () => mode() === 'all' || mode() === 'music';
  const voiceOn = () => mode() === 'all' || mode() === 'voice';
  const speechSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  const rand = (a, b) => a + Math.random() * (b - a);

  // ---------- fighter-aware classification (deterministic, no AI) ----------
  // Whole-word keyword rules on the fighter text. Unknown names get no tags, which means
  // the generic skirmish soundscape.
  const TAG_RULES = [
    ['dragon', /\b(dragons?|wyrms?|wyverns?|drakes?|hydras?|basilisks?|leviathans?)\b/],
    ['beast', /\b(wolf|wolves|werewolf|werewolves|werebears?|bears?|lions?|tigers?|panthers?|boars?|dogs?|cats?|cows?|bulls?|horses?|rabbits?|rats?|snakes?|serpents?|spiders?|griffins?|gryphons?|minotaurs?|manticores?|chimeras?|krakens?|sharks?|gorillas?|apes?|ogres?|trolls?|giants?|yetis?|bigfoot|sasquatch|cerberus|hounds?|beasts?|monsters?|gremlins?|goblins?|orcs?)\b/],
    ['warrior', /\b(knights?|soldiers?|seals?|samurai|ninjas?|vikings?|warriors?|gladiators?|spartans?|achilles|amazons?|valkyries|valkyrie|elves|elf|dwarves|dwarf|pirates?|navy|marines?|army|commandos?|delta|rangers?|mercenar(?:y|ies)|assassins?|archers?|swordsmen|swordsman|fighters?|boxers?|centaurs?|legion(?:s|naires?)?|barbarians?|paladins?|crusaders?|templars?|hunters?)\b/],
    ['magic', /\b(wizards?|warlocks?|witch(?:es)?|sorcer(?:er|ers|ess|esses)|mages?|necromancers?|liches?|lich|genies?|djinn|fairy|fairies|elementals?|ghosts?|spectres?|wraiths?|phoenix|medusa|loki|odin|merlin|magicians?|druids?|shamans?|demons?|angels?)\b/],
  ];

  function classify(name) {
    const n = String(name || '').toLowerCase();
    const tags = new Set();
    for (const [tag, re] of TAG_RULES) if (re.test(n)) tags.add(tag);
    return tags;
  }

  function setFighters(a, b) {
    fighterNames = [String(a || ''), String(b || '')];
    fighterTags = new Set();
    for (const n of [a, b]) if (n) classify(n).forEach((t) => fighterTags.add(t));
  }

  // ---------- context / unlock ----------
  function ensureContext() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    // A gentle limiter on the main output keeps layered drums and shouts from clipping.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -16;
    limiter.knee.value = 12;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.005;
    limiter.release.value = 0.25;
    limiter.connect(ctx.destination);
    master = ctx.createGain();
    master.gain.value = 1;
    master.connect(limiter);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = SFX_LEVEL;
    sfxBus.connect(master);
    mp3Bus = ctx.createGain();
    mp3Bus.gain.value = 1;
    mp3Bus.connect(master);
    combatBus = ctx.createGain();
    combatBus.gain.value = COMBAT_LEVEL;
    combatBus.connect(master);
    const len = ctx.sampleRate * 2;
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function running() {
    return !!ctx && ctx.state === 'running';
  }

  function onGesture() {
    userActive = true;
    if (mode() !== 'mute' && mode() !== 'voice') {
      const c = ensureContext();
      if (c && c.state !== 'running') c.resume().then(applyScene, () => {});
    }
    applyScene();
    if (running() || mode() === 'mute' || mode() === 'voice') detachGestures();
  }
  const GESTURES = ['pointerdown', 'keydown', 'touchend'];
  function attachGestures() {
    GESTURES.forEach((g) => document.addEventListener(g, onGesture, true));
  }
  function detachGestures() {
    GESTURES.forEach((g) => document.removeEventListener(g, onGesture, true));
  }

  // ---------- small synth helpers ----------
  function env(gainNode, t, attack, peak, hold, release) {
    const g = gainNode.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(peak, t + attack);
    g.setValueAtTime(peak, t + attack + hold);
    g.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  }

  function panned(dest, pan) {
    if (pan === undefined || !ctx.createStereoPanner) return dest;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(dest);
    return p;
  }

  function noiseSource(dest, t, dur, type, freq, peak, q) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q) f.Q.value = q;
    const g = ctx.createGain();
    env(g, t, 0.004, peak, 0, dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  function tone(dest, t, type, f0, f1, dur, peak, attack) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    env(g, t, attack || 0.004, peak, 0, dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // Big resonant war drum: pitched body drop + long sub tail + skin thump.
  function warDrum(dest, t, vel, pan) {
    const d = panned(dest, pan);
    tone(d, t, 'sine', 125, 46, 0.55, 0.85 * vel);
    tone(d, t, 'sine', 82, 38, 1.0, 0.6 * vel, 0.01);
    noiseSource(d, t, 0.06, 'lowpass', 700, 0.5 * vel); // stick/skin
    noiseSource(d, t, 0.4, 'bandpass', 170, 0.45 * vel, 4); // shell resonance
  }

  // Smaller tom for fills and rolls.
  function tom(dest, t, vel, pitch, pan) {
    const d = panned(dest, pan);
    tone(d, t, 'sine', pitch, pitch * 0.5, 0.28, 0.6 * vel);
    noiseSource(d, t, 0.04, 'lowpass', 900, 0.3 * vel);
  }

  // Brass-like note: detuned saws + a square, with a bright "blat" at the attack.
  function brass(dest, t, freq, dur, peak, swell) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(freq * 1.4, t);
    lp.frequency.linearRampToValueAtTime(freq * 5, t + (swell || 0.12));
    lp.frequency.exponentialRampToValueAtTime(freq * 2.2, t + dur);
    const g = ctx.createGain();
    env(g, t, swell || 0.06, peak, Math.max(0.02, dur * 0.55), Math.max(0.05, dur * 0.4));
    lp.connect(g).connect(dest);
    [[-7, 'sawtooth', 1], [6, 'sawtooth', 1], [0, 'square', 0.5]].forEach(([det, type, gain]) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq * 0.985, t);
      o.frequency.linearRampToValueAtTime(freq, t + 0.08);
      o.detune.value = det;
      const og = ctx.createGain();
      og.gain.value = gain;
      o.connect(og).connect(lp);
      o.start(t);
      o.stop(t + dur + 0.1);
    });
  }

  // ---------- victory fanfare: ceremonial drums + triumphant horns, ~2.9 s ----------
  function playFanfare() {
    if (!running()) return;
    const t0 = ctx.currentTime + 0.05;
    const out = ctx.createGain();
    out.gain.value = 0.9;
    out.connect(sfxBus);
    for (let k = 0; k < 8; k++) tom(out, t0 + k * 0.075, 0.25 + k * 0.07, 165, k % 2 ? 0.2 : -0.2); // roll
    warDrum(out, t0 + 0.64, 1);
    // horn motif: G4 G4 C5 E5
    brass(out, t0 + 0.64, 392, 0.26, 0.15);
    brass(out, t0 + 0.92, 392, 0.2, 0.15);
    brass(out, t0 + 1.14, 523.3, 0.3, 0.17);
    brass(out, t0 + 1.5, 659.3, 0.3, 0.17);
    warDrum(out, t0 + 1.14, 0.7);
    // held C major chord with two heavy ceremonial hits
    warDrum(out, t0 + 1.85, 1);
    warDrum(out, t0 + 2.12, 0.85);
    [261.6, 329.6, 392, 523.3, 784].forEach((f) => brass(out, t0 + 1.85, f, 1.15, 0.11, 0.08));
    noiseSource(out, t0 + 1.85, 0.9, 'highpass', 5500, 0.05);
    setTimeout(() => {
      try {
        out.disconnect();
      } catch {
        // ignore
      }
    }, FANFARE_MS + 800);
  }

  // ---------- combat effects: each returns its duration in seconds ----------
  function sfxClash(dest) {
    const t = ctx.currentTime + 0.01;
    const pitch = rand(0.9, 1.1);
    noiseSource(dest, t, 0.09, 'highpass', 2500, 0.35);
    [1820, 2740, 4210, 5630].forEach((f, k) => tone(dest, t, 'sine', f * pitch, f * pitch * 0.985, 0.28 + k * 0.04, 0.09 / (k + 1)));
    return 0.5;
  }
  function sfxStrike(dest) {
    const t = ctx.currentTime + 0.01;
    noiseSource(dest, t, 0.13, 'bandpass', rand(800, 1300), 0.4);
    tone(dest, t, 'sine', 230, 110, 0.14, 0.3);
    return 0.25;
  }
  function sfxHeavy(dest) {
    const t = ctx.currentTime + 0.01;
    tone(dest, t, 'sine', 90, 32, 0.6, 0.65);
    noiseSource(dest, t, 0.4, 'lowpass', 420, 0.5);
    noiseSource(dest, t + 0.02, 0.09, 'highpass', 2000, 0.15);
    return 0.7;
  }

  // Human voice: a sawtooth "glottal" source through vowel formant filters, plus breath.
  const VOWELS = {
    ah: [[700, 8, 1], [1100, 10, 0.6], [2600, 12, 0.3]],
    aa: [[800, 8, 1], [1300, 10, 0.5], [2700, 12, 0.25]],
    oh: [[450, 8, 1], [800, 10, 0.5], [2500, 12, 0.2]],
    uh: [[500, 8, 1], [1000, 10, 0.4], [2400, 12, 0.2]],
  };
  function vocal(dest, t, f0, f1, dur, vowel, peak, breath) {
    const src = ctx.createOscillator();
    src.type = 'sawtooth';
    src.frequency.setValueAtTime(f0, t);
    src.frequency.linearRampToValueAtTime(f1, t + dur * 0.35);
    src.frequency.linearRampToValueAtTime(f0 * 0.82, t + dur);
    const vib = ctx.createOscillator();
    vib.frequency.value = rand(5, 7);
    const vibGain = ctx.createGain();
    vibGain.gain.value = f0 * 0.025;
    vib.connect(vibGain).connect(src.frequency);
    const mix = ctx.createGain();
    env(mix, t, Math.min(0.06, dur * 0.3), peak, dur * 0.3, dur * 0.6);
    mix.connect(dest);
    VOWELS[vowel].forEach(([freq, q, gain]) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq * rand(0.94, 1.06);
      bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(bp).connect(g).connect(mix);
    });
    if (breath) {
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer;
      n.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1500;
      const ng = ctx.createGain();
      ng.gain.value = breath;
      n.connect(hp).connect(ng).connect(mix);
      n.start(t, Math.random());
      n.stop(t + dur + 0.05);
    }
    src.start(t);
    vib.start(t);
    src.stop(t + dur + 0.05);
    vib.stop(t + dur + 0.05);
  }
  function sfxCry(dest) {
    const t = ctx.currentTime + 0.01;
    const f0 = rand(125, 185);
    const dur = rand(0.6, 1.0);
    vocal(dest, t, f0, f0 * rand(1.25, 1.55), dur, Math.random() < 0.5 ? 'ah' : 'aa', 0.5, 0.05);
    return dur + 0.1;
  }
  function sfxGrunt(dest) {
    const t = ctx.currentTime + 0.01;
    const dur = rand(0.14, 0.24);
    vocal(dest, t, rand(90, 125), rand(80, 105), dur, Math.random() < 0.5 ? 'uh' : 'oh', 0.55, 0.12);
    return dur + 0.1;
  }

  // Creature voice: low saw pair with fast amplitude modulation (growl) and a noisy breath
  // band, pitch falling over the call. type: 'dragon' | 'beast' | 'generic'
  function sfxRoar(dest, type) {
    const t = ctx.currentTime + 0.01;
    const P = {
      dragon: { f: rand(52, 72), dur: rand(1.7, 2.3), am: rand(20, 28), cut: 1600, peak: 0.7, noise: 0.35 },
      beast: { f: rand(105, 155), dur: rand(0.7, 1.1), am: rand(14, 20), cut: 1800, peak: 0.55, noise: 0.25 },
      generic: { f: rand(78, 110), dur: rand(1.1, 1.5), am: rand(22, 30), cut: 1500, peak: 0.6, noise: 0.3 },
    }[type || 'generic'];
    const out = ctx.createGain();
    env(out, t, 0.12, P.peak, P.dur * 0.4, P.dur * 0.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1.5;
    lp.frequency.setValueAtTime(P.cut * 0.35, t);
    lp.frequency.linearRampToValueAtTime(P.cut, t + P.dur * 0.3);
    lp.frequency.exponentialRampToValueAtTime(P.cut * 0.2, t + P.dur);
    const am = ctx.createGain();
    am.gain.value = 0.55;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = P.am;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.45;
    lfo.connect(lfoDepth).connect(am.gain);
    lp.connect(am).connect(out).connect(dest);
    [-9, 8].forEach((det) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = det;
      o.frequency.setValueAtTime(P.f * 1.18, t);
      o.frequency.exponentialRampToValueAtTime(P.f * 0.8, t + P.dur);
      o.connect(lp);
      o.start(t);
      o.stop(t + P.dur + 0.1);
    });
    lfo.start(t);
    lfo.stop(t + P.dur + 0.1);
    noiseSource(out, t, P.dur, 'bandpass', type === 'beast' ? 900 : 500, P.noise, 0.8);
    if (type === 'dragon') tone(out, t, 'sine', 42, 30, P.dur, 0.6, 0.15); // chest rumble
    return P.dur + 0.2;
  }
  const sfxRoarDragon = (d) => sfxRoar(d, 'dragon');
  const sfxGrowl = (d) => sfxRoar(d, 'beast');
  const sfxRoarGeneric = (d) => sfxRoar(d, 'generic');

  // Distant battlefield: low, far-away noise swell with a faint clash inside it.
  function sfxCommotion(dest) {
    const t = ctx.currentTime + 0.01;
    const dur = rand(0.8, 1.6);
    noiseSource(dest, t, dur, 'bandpass', rand(450, 800), 0.16, 0.9);
    if (Math.random() < 0.6) {
      const far = ctx.createGain();
      far.gain.value = 0.3;
      far.connect(dest);
      sfxClash(far);
    }
    return dur + 0.3;
  }

  // Subtle supernatural shimmer for magical fighters.
  function sfxMagic(dest) {
    const t = ctx.currentTime + 0.01;
    const base = rand(500, 800);
    [1, 1.5, 2, 3].forEach((m, k) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(base * m, t);
      o.frequency.exponentialRampToValueAtTime(base * m * 2.2, t + 0.9);
      const g = ctx.createGain();
      env(g, t + k * 0.04, 0.2, 0.05, 0.1, 0.6);
      const trem = ctx.createOscillator();
      trem.frequency.value = rand(6, 9);
      const td = ctx.createGain();
      td.gain.value = 0.03;
      trem.connect(td).connect(g.gain);
      o.connect(g).connect(dest);
      o.start(t);
      trem.start(t);
      o.stop(t + 1.2);
      trem.stop(t + 1.2);
    });
    noiseSource(dest, t, 0.8, 'highpass', 6500, 0.04);
    return 1.3;
  }

  // Effect weights, shifted by the fighter tags. No tags -> the generic skirmish mix.
  function effectWeights() {
    const w = { clash: 3, strike: 2, heavy: 1.2, cry: 1.6, grunt: 1.4, roarGeneric: 0.5, commotion: 1.5 };
    if (fighterTags.has('dragon')) {
      w.roarDragon = 3;
      w.heavy += 2;
      w.roarGeneric = 0;
      w.clash *= 0.5;
    }
    if (fighterTags.has('beast')) {
      w.growl = 3;
      w.strike += 1;
      w.roarGeneric = 0.2;
    }
    if (fighterTags.has('warrior')) {
      w.clash += 2;
      w.cry += 2;
      w.grunt += 1.5;
    }
    if (fighterTags.has('magic')) {
      w.magic = 2.2;
      w.clash *= 0.6;
    }
    return w;
  }
  const EFFECTS = {
    clash: sfxClash,
    strike: sfxStrike,
    heavy: sfxHeavy,
    cry: sfxCry,
    grunt: sfxGrunt,
    roarGeneric: sfxRoarGeneric,
    roarDragon: sfxRoarDragon,
    growl: sfxGrowl,
    commotion: sfxCommotion,
    magic: sfxMagic,
  };

  function pickEffect(w) {
    const entries = Object.entries(w).filter(([, v]) => v > 0);
    let r = Math.random() * entries.reduce((s, [, v]) => s + v, 0);
    for (const [k, v] of entries) {
      r -= v;
      if (r <= 0) return k;
    }
    return entries[0][0];
  }

  // Skirmish: bursts of 3-6 events with natural gaps, then a quiet lull. Everything lives
  // under one bus and one timer chain, so stop() silences and cleans it all at once.
  const played = {}; // effect name -> count this page load (test visibility)
  function startSfxSession() {
    if (sfxSession || !running()) return;
    const bedOnly = true; // Stage 9.3.1: the MP3 combat library supplies the hits; this keeps only the faint crowd bed
    const bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(sfxBus);
    const weights = effectWeights();
    let alive = true;
    let timer = null;
    let active = 0;
    let burstLeft = 0;
    const pending = new Set();
    // faint distant crowd / battlefield bed
    const bed = ctx.createBufferSource();
    bed.buffer = noiseBuffer;
    bed.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 350;
    bp.Q.value = 0.6;
    const bedGain = ctx.createGain();
    bedGain.gain.value = 0.045;
    bed.connect(bp).connect(bedGain).connect(bus);
    bed.start();

    const fire = (name) => {
      if (active >= MAX_SFX_EVENTS) return;
      active++;
      played[name] = (played[name] || 0) + 1;
      const g = ctx.createGain();
      g.gain.value = rand(0.45, 1);
      g.connect(bus);
      const dur = EFFECTS[name](panned(g, rand(-0.85, 0.85))) || 0.6;
      const id = setTimeout(() => {
        pending.delete(id);
        active--;
        try {
          g.disconnect();
        } catch {
          // ignore
        }
      }, dur * 1000 + 300);
      pending.add(id);
    };

    const next = () => {
      if (!alive) return;
      if (burstLeft > 0) {
        burstLeft--;
        fire(pickEffect(weights));
        timer = setTimeout(next, rand(140, 520));
      } else {
        burstLeft = 3 + Math.floor(Math.random() * 4);
        timer = setTimeout(next, rand(1300, 3600)); // lull between bursts
      }
    };
    if (!bedOnly) timer = setTimeout(next, 600);

    sfxSession = {
      stop() {
        alive = false;
        clearTimeout(timer);
        pending.forEach((id) => clearTimeout(id));
        pending.clear();
        // silence immediately, including any ringing tails
        const now = ctx.currentTime;
        bus.gain.cancelScheduledValues(now);
        bus.gain.setValueAtTime(bus.gain.value, now);
        bus.gain.linearRampToValueAtTime(0.0001, now + 0.05);
        setTimeout(() => {
          try {
            bed.stop();
            bus.disconnect();
          } catch {
            // ignore
          }
        }, 120);
      },
    };
  }

  function stopSfx() {
    if (sfxSession) {
      sfxSession.stop();
      sfxSession = null;
    }
  }

  // ---------- MP3 background music (plays through the same context, buses and lifecycle) ----------
  function mp3Supported() {
    return MUSIC_CONFIG.enabled && typeof Audio === 'function' && !!ctx && !!ctx.createMediaElementSource;
  }

  function mp3Later(fn, ms) {
    const id = setTimeout(() => {
      mp3.timers.delete(id);
      fn();
    }, ms);
    mp3.timers.add(id);
    return id;
  }

  function mp3ClearTimers() {
    mp3.timers.forEach((id) => {
      clearTimeout(id);
      clearInterval(id);
    });
    mp3.timers.clear();
  }

  function mp3Track(key) {
    let t = mp3.els[key];
    if (t) return t;
    const el = new Audio();
    el.preload = 'auto';
    el.loop = false; // we handle the natural ending, the gap and the restart ourselves
    el.src = MUSIC_CONFIG.tracks[key].src;
    const gain = ctx.createGain();
    gain.gain.value = 0; // silent until playback has actually started
    ctx.createMediaElementSource(el).connect(gain).connect(mp3Bus);
    t = { el, gain, failed: false };
    el.addEventListener('error', () => mp3Failed(key));
    mp3.els[key] = t;
    return t;
  }

  // A track that cannot load or decode is marked failed and its scenes stay silent (no synthesized
  // replacement). Sound effects, fanfare and narration are unaffected.
  function mp3Failed(key) {
    const t = mp3.els[key];
    if (!t || t.failed) return;
    t.failed = true;
    if (mp3.key === key) {
      mp3Halt(0.05);
      musicScene = null;
    }
  }

  // Level of a track = its config trim x the player's Background Music slider.
  function trackLevel(key) {
    return MUSIC_CONFIG.tracks[key].volume * BGSettings.get().musicVolume;
  }

  // Slider moved: adjust the playing track smoothly, without restarting or seeking it.
  function applyMusicVolume() {
    if (!ctx || !mp3.key || mp3.state !== 'playing' || mp3.fading) return; // a gap/fade picks the new level up itself
    const t = mp3.els[mp3.key];
    const now = ctx.currentTime;
    t.gain.gain.cancelScheduledValues(now);
    t.gain.gain.setValueAtTime(t.gain.gain.value, now);
    t.gain.gain.setTargetAtTime(trackLevel(mp3.key), now, 0.04);
  }

  // Fade the active track out and stop it. Cancels every pending restart/fade timer.
  function mp3Halt(fade) {
    mp3ClearTimers();
    mp3.token++;
    const key = mp3.key;
    mp3.key = null;
    mp3.state = 'idle';
    mp3.fading = false;
    if (!key || !ctx) return;
    const t = mp3.els[key];
    const now = ctx.currentTime;
    t.gain.gain.cancelScheduledValues(now);
    t.gain.gain.setValueAtTime(t.gain.gain.value, now);
    t.gain.gain.linearRampToValueAtTime(0, now + Math.max(0.02, fade));
    const token = mp3.token;
    const id = setTimeout(() => {
      if (mp3.key !== key || mp3.token === token) t.el.pause(); // not restarted meanwhile
    }, Math.max(0.02, fade) * 1000 + 60);
    t.haltTimer = id;
  }

  // One play-through: seek silently, start, then watch for the final seconds to fade out.
  function mp3Begin(key, token) {
    if (token !== mp3.token || !ctx) return;
    const t = mp3Track(key);
    clearTimeout(t.haltTimer);
    const cfg = MUSIC_CONFIG.tracks[key];
    const el = t.el;
    mp3.fading = false;
    const now = ctx.currentTime;
    t.gain.gain.cancelScheduledValues(now);
    t.gain.gain.setValueAtTime(0, now); // silence while seeking: no click

    const go = () => {
      if (token !== mp3.token) return;
      el.play().then(
        () => {
          if (token !== mp3.token) {
            el.pause();
            return;
          }
          mp3.state = 'playing';
          // Starts at full level (no fade-in); a ~15 ms smoothing only prevents a click.
          t.gain.gain.setTargetAtTime(trackLevel(key), ctx.currentTime, 0.005);
          mp3Watch(key, token);
        },
        (err) => {
          if (token !== mp3.token) return;
          if (err && err.name === 'NotAllowedError') {
            // Browser has not allowed playback yet: stay idle and retry on the next gesture.
            mp3.key = null;
            mp3.state = 'idle';
            musicScene = null;
            currentScene = null;
            attachGestures();
          } else {
            mp3Failed(key);
          }
        }
      );
    };

    const seek = () => {
      if (token !== mp3.token) return;
      const target = cfg.startOffset || 0;
      if (Math.abs(el.currentTime - target) < 0.05) return go();
      el.addEventListener('seeked', go, { once: true });
      el.currentTime = target;
    };
    if (el.readyState >= 1) seek();
    else {
      el.addEventListener('loadedmetadata', seek, { once: true });
      if (el.networkState === 3 /* NETWORK_NO_SOURCE */) el.load();
    }
  }

  function mp3Watch(key, token) {
    const t = mp3.els[key];
    const el = t.el;
    let fading = false;
    const check = () => {
      if (token !== mp3.token) return;
      const remaining = el.duration - el.currentTime;
      if (!fading && Number.isFinite(remaining) && remaining <= MUSIC_CONFIG.fadeOutSeconds + 0.05) {
        fading = true;
        mp3.fading = true;
        const now = ctx.currentTime;
        t.gain.gain.cancelScheduledValues(now);
        t.gain.gain.setValueAtTime(t.gain.gain.value, now);
        t.gain.gain.linearRampToValueAtTime(0, now + Math.max(0.1, Math.min(MUSIC_CONFIG.fadeOutSeconds, remaining)));
      }
      if (el.ended || (Number.isFinite(remaining) && remaining <= 0.03)) {
        mp3ClearTimers();
        el.pause();
        t.gain.gain.cancelScheduledValues(ctx.currentTime);
        t.gain.gain.setValueAtTime(0, ctx.currentTime);
        mp3.state = 'gap';
        // Silent gap, then restart from the configured offset (unless the scene changed).
        mp3Later(() => mp3Begin(key, token), MUSIC_CONFIG.gapSeconds * 1000);
      }
    };
    const id = setInterval(check, 100);
    mp3.timers.add(id);
    check();
  }

  // Start the track for a scene. The same track is never restarted; a different one waits for the
  // previous to fade out, so only one background-music instance is ever audible.
  function mp3Play(key) {
    if (mp3.key === key && mp3.state !== 'idle') return true;
    if (mp3.els[key] && mp3.els[key].failed) return false;
    const switching = mp3.key !== null;
    mp3Halt(switching ? 0.25 : 0.02);
    mp3.key = key;
    mp3.state = 'starting';
    voiceSeq++;
    const token = mp3.token;
    mp3Track(key);
    if (switching) mp3Later(() => mp3Begin(key, token), 420) // after the old track has faded (250 ms) and been paused (+60 ms): never two playing;
    else mp3Begin(key, token);
    return true;
  }

  // Hidden tab: pause the recording too, so its clock (and the end-of-track fade) stays in step.
  function mp3PauseForHidden() {
    const t = mp3.key && mp3.els[mp3.key];
    if (t && mp3.state === 'playing') t.el.pause();
  }
  function mp3ResumeAfterHidden() {
    const t = mp3.key && mp3.els[mp3.key];
    if (t && mp3.state === 'playing' && t.el.paused) t.el.play().catch(() => {});
  }

  // ---------- Stage 9.3 / 9.3.1: combat sound library (played while judging) ----------
  // Keys are 'type.subtype'; the palettes below choose keys from the fighters' text, and this registry
  // is the ONLY place a key turns into a file. Nothing from the server or the AI picks a file. Each clip is a window into an MP3: { file, start, dur, gain, rate }
  // (start/dur in seconds; several source files are long compilations, so only one hit is cut
  // out of them). Add a clip by adding a line; add its creator to SFX_CREDITS in guide.js.
  const SFX_DIR = 'assets/audio/';
  const clip = (file, start, dur, gain, rate) => ({ file, start, dur, gain: gain || 1, rate: rate || 1 });
  const WHOOSH = 'ponjisk-whooshslash-sounds-different-pitches-vol2-187377.mp3';
  const SWORDS = 'freesound_community-sword-against-sword-6341.mp3';
  const ROARS = 'febixaj5-edited-dinosaur-roars-15-566149.mp3';
  const COMBAT_SOUNDS = {
    'weapon_swing.blade': [
      clip('dragon-studio-sword-slice-393847.mp3', 0, 1.3, 0.9),
      clip('dragon-studio-sword-slice-2-393845.mp3', 0, 1.3, 0.9),
      clip(WHOOSH, 1.15, 0.5, 0.9),
      clip(WHOOSH, 3.3, 0.5, 0.9),
      clip(WHOOSH, 6.55, 0.5, 0.9),
    ],
    'weapon_swing.heavy_blade': [clip('dragon-studio-violent-sword-slice-393839.mp3', 0, 1.5, 1), clip(WHOOSH, 13.05, 0.5, 1, 0.8)],
    'metal_impact.blade_clash': [
      clip('dragon-studio-sword-clashhit-393837.mp3', 0, 0.9, 1.4),
      clip('magiaz-swords-423819.mp3', 0, 0.7, 1),
      clip('magiaz-swords-423816.mp3', 0.1, 0.8, 1.1),
      clip(SWORDS, 2.35, 0.8, 0.9),
      clip(SWORDS, 11, 0.9, 0.9),
      clip(SWORDS, 19.45, 0.8, 0.9),
    ],
    'metal_impact.shield': [
      clip('dragon-studio-sword-clashhit-393837.mp3', 0, 0.9, 1.6, 0.7),
      clip(SWORDS, 4.45, 1.4, 0.9),
      clip('magiaz-swords-423816.mp3', 2.6, 0.8, 1.1),
    ],
    'physical_impact.punch': [clip('universfield-punch-03-352040.mp3', 0, 1, 1.1)],
    'physical_impact.kick': [clip('universfield-punch-03-352040.mp3', 0, 1, 1.2, 0.85)],
    'physical_impact.heavy_hit': [clip('universfield-punch-03-352040.mp3', 0, 1.3, 1.5, 0.65)],
    // No archery recordings are in the library yet: arrows reuse the whoosh clips, pitched up.
    'projectile.arrow': [clip(WHOOSH, 4.35, 0.5, 0.8, 1.5), clip(WHOOSH, 9.8, 0.5, 0.8, 1.4), clip(WHOOSH, 14.25, 0.5, 0.8, 1.5)],
    'gunfire.pistol': [clip('foisal72-gun-fire-346766.mp3', 0.5, 1.4, 1.5)],
    'gunfire.auto': [clip('soundreality-auto-gun-shots-312660.mp3', 0, 1.8, 0.9)],
    'gunfire.rifle': [clip('freesound_community-m4-assault-rifle-long-burst-102682.mp3', 0.1, 2.2, 0.55)],
    'energy_weapon.blaster': [clip('universfield-sci-fi-blaster-shot-229313.mp3', 0, 0.9, 1.2)],
    'energy_weapon.beam': [clip('freesound_community-beam-8-43831.mp3', 0, 0.9, 1.3), clip('yodguard-short-energy-beam-shot-3-482517.mp3', 0, 1.5, 1)],
    'energy_weapon.plasma': [clip('lordsonny-plasma-gun-fire-162136.mp3', 0.1, 2, 0.5)],
    'energy_weapon.energy_gun': [clip('freesound_community-sci-fi-energy-gun-39409.mp3', 0, 1.8, 1.2)],
    'mechanical.servo': [clip('audiopapkin-sound-design-elements-robot-mechanism-015-336704.mp3', 0.5, 2, 0.9)],
    'mechanical.machinery': [clip('audiopapkin-sound-design-elements-robot-mechanism-032-500870.mp3', 0.35, 2.6, 1)],
    'magic.ice': [clip('dragon-studio-elemental-spell-impact-ice-448564.mp3', 1, 1.9, 0.9)],
    'magic.elemental': [clip('asproductionmusic-magic-boom-fx-587687.mp3', 0.4, 2.2, 0.8)],
    'magic.arcane': [clip('asproductionmusic-magic-boom-fx-587687.mp3', 0.4, 2.2, 0.7, 1.25)],
    'creature.roar': [clip(ROARS, 0.25, 3, 0.8), clip(ROARS, 11.8, 3.5, 0.8), clip(ROARS, 19.3, 3.2, 0.8), clip(ROARS, 46.05, 3.5, 0.8)],
    'creature.growl': [clip(ROARS, 32.7, 1.8, 0.8, 1.1), clip(ROARS, 36.4, 2, 0.8, 1.1), clip(ROARS, 52.85, 1.35, 0.8, 1.1)],
    'explosion.blast': [clip('soundreality-explosion-fx-343683.mp3', 0.1, 2.6, 0.8)],
    'voice.war_cry': [
      clip('jesuschristisgod-army-of-soldiers-battle-cry-322709.mp3', 0.5, 1.3, 1.4),
      clip('jesuschristisgod-army-of-soldiers-battle-cry-322709.mp3', 4.9, 1.9, 1.4),
    ],
    'voice.grunt_male': [
      clip('phatphrogstudio-male-fighter-voice-heavy-attack-grunt-544355.mp3', 0, 0.7, 1),
      clip('phatphrogstudio-male-soldier-voice-attack-grunt-520841.mp3', 0, 0.72, 1),
      clip('phatphrogstudio-male-fighter-voice-2-heavy-attack-grunt-582547.mp3', 0, 0.86, 1),
    ],
    'voice.grunt_female': [clip('phatphrogstudio-female-fighter-voice-heavy-attack-grunt-544351.mp3', 0, 0.86, 1)],
    'voice.yell': [clip('jimiwild-hilarious-yelling-123621.mp3', 0.1, 2, 1.6), clip('jimiwild-hilarious-yelling-123621.mp3', 4.3, 2, 1.6)],
  };
  // Sustained beds: looped whole files, one at a time, always under the one-shots and narration.
  const COMBAT_AMBIENCE = {
    'ambience.skirmish': clip('mavopix-brutal-battle-159869.mp3', 0, 0, 4), // very quiet recording
    'ambience.crowd': clip('freesound_community-angry-mob-loop-6847.mp3', 0, 0, 1.2),
    'ambience.warfield': clip('two_hats-wwii-battle-408734.mp3', 0, 0, 0.45), // very loud recording
  };

  const COMBAT_LEVEL = 0.6; // overall level of AI-directed effects (on top of each clip's own gain)
  const AMBIENCE_LEVEL = 0.3;
  const COMBAT_MAX_ACTIVE = 4; // one-shots sounding at the same moment
  const COMBAT_COOLDOWN_MS = 450; // the same type.subtype can't retrigger faster than this
  const COMBAT_LATE_MS = 2500; // a clip that finishes loading later than this after its cue is dropped
  const COMBAT_DUCK = 0.4; // effect level multiplier while speech plays

  let combat = null; // active judging session (see newCombatSession)
  let fighterNames = ['', '']; // the two fighter texts for the current battle
  const clipCache = new Map(); // "file@start+dur" -> Promise<AudioBuffer|null>
  const decoding = new Map(); // file -> in-flight Promise<AudioBuffer>
  const ambienceCache = new Map(); // file -> Promise<AudioBuffer|null>
  const combatStats = { played: [], skipped: 0, missing: 0, maxActive: 0, sessions: 0 };

  const combatPossible = () => musicOn() && running() && !!combatBus;

  function fetchDecode(file) {
    if (decoding.has(file)) return decoding.get(file);
    const p = fetch(SFX_DIR + file)
      .then((r) => {
        if (!r.ok) throw new Error('missing ' + file);
        return r.arrayBuffer();
      })
      .then((ab) => ctx.decodeAudioData(ab))
      .finally(() => decoding.delete(file));
    decoding.set(file, p);
    return p;
  }

  // Decode, then keep only the needed window as its own small buffer (the full file is dropped).
  function loadClip(c) {
    const key = `${c.file}@${c.start}+${c.dur}`;
    if (clipCache.has(key)) return clipCache.get(key);
    const p = fetchDecode(c.file)
      .then((full) => {
        const sr = full.sampleRate;
        const from = Math.min(full.length - 1, Math.floor(c.start * sr));
        const to = Math.min(full.length, from + Math.max(1, Math.floor(c.dur * sr)));
        const out = ctx.createBuffer(full.numberOfChannels, to - from, sr);
        for (let ch = 0; ch < full.numberOfChannels; ch++) out.getChannelData(ch).set(full.getChannelData(ch).subarray(from, to));
        return out;
      })
      .catch(() => {
        combatStats.missing++;
        clipCache.delete(key); // a later battle may retry (e.g. after a network blip)
        return null;
      });
    clipCache.set(key, p);
    return p;
  }

  function loadAmbience(c) {
    if (ambienceCache.has(c.file)) return ambienceCache.get(c.file);
    const p = fetchDecode(c.file).catch(() => {
      combatStats.missing++;
      ambienceCache.delete(c.file);
      return null;
    });
    ambienceCache.set(c.file, p);
    return p;
  }

  // Pick a variant, never the one this key used last (so repeated cues don't sound identical).
  const lastVariant = {};
  // The three long compilation files take a second or two to decode, so the opening hits of a
  // soundscape use only the small files ("light"); the big ones are decoded in the background.
  const BIG_FILES = new Set(['febixaj5-edited-dinosaur-roars-15-566149.mp3', 'freesound_community-sword-against-sword-6341.mp3']);
  function pickClip(key, light) {
    const all = COMBAT_SOUNDS[key];
    const list = all && light ? all.filter((c) => !BIG_FILES.has(c.file)) : all;
    if (!list || !list.length) return null;
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === lastVariant[key]) i = (i + 1) % list.length;
    lastVariant[key] = i;
    return list[i];
  }

  // Silence and clean up the active session: timers, sources and nodes. Safe to call any time.
  function stopCombat(fade) {
    const c = combat;
    if (!c) return;
    combat = null;
    c.alive = false;
    c.timers.forEach((id) => clearTimeout(id));
    c.timers.clear();
    const f = Math.max(0.03, fade === undefined ? 0.15 : fade);
    try {
      const now = ctx.currentTime;
      c.bus.gain.cancelScheduledValues(now);
      c.bus.gain.setValueAtTime(c.bus.gain.value, now);
      c.bus.gain.linearRampToValueAtTime(0.0001, now + f);
    } catch {
      // ignore
    }
    setTimeout(() => {
      c.sources.forEach((s) => {
        try {
          s.stop();
        } catch {
          // already stopped
        }
      });
      c.sources.clear();
      try {
        c.bus.disconnect();
      } catch {
        // ignore
      }
    }, f * 1000 + 40);
  }

  function combatLater(c, fn, ms) {
    const id = setTimeout(() => {
      c.timers.delete(id);
      if (c.alive) fn();
    }, Math.max(0, ms));
    c.timers.add(id);
  }

  function fireOneShot(c, ev, due) {
    const key = `${ev.type}.${ev.subtype}`;
    const now = performance.now();
    if ((c.last[key] !== undefined && now - c.last[key] < COMBAT_COOLDOWN_MS) || c.active >= COMBAT_MAX_ACTIVE) {
      combatStats.skipped++;
      return;
    }
    const cl = ev.clip || pickClip(key, ev.light);
    if (!cl) {
      if (!ev.light) combatStats.missing++;
      return;
    }
    c.last[key] = now;
    c.active++; // reserve the slot now, so a burst of cues can't all pass the limit check
    combatStats.maxActive = Math.max(combatStats.maxActive, c.active);
    loadClip(cl).then((buf) => {
      if (!c.alive || !buf || !running() || performance.now() - due > COMBAT_LATE_MS) {
        c.active--;
        if (buf) combatStats.skipped++;
        return;
      }
      try {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = cl.rate;
        const g = ctx.createGain();
        const t = ctx.currentTime + 0.01;
        const len = buf.duration / cl.rate;
        const release = Math.min(0.35, len * 0.4);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(cl.gain, t + 0.006);
        g.gain.setValueAtTime(cl.gain, Math.max(t + 0.006, t + len - release));
        g.gain.linearRampToValueAtTime(0.0001, t + len);
        src.connect(g);
        g.connect(panned(c.bus, rand(-0.35, 0.35)));
        c.sources.add(src);
        src.onended = () => {
          c.active--;
          c.sources.delete(src);
          try {
            g.disconnect();
          } catch {
            // ignore
          }
        };
        src.start(t);
        combatStats.played.push(key);
        if (combatStats.played.length > 200) combatStats.played.shift();
      } catch {
        c.active--;
        combatStats.skipped++;
      }
    });
  }

  function startAmbience(c, ev) {
    if (c.ambience || !c.alive) return;
    const key = `${ev.type}.${ev.subtype}`;
    const cl = COMBAT_AMBIENCE[key];
    if (!cl) return;
    c.ambience = { key };
    loadAmbience(cl).then((buf) => {
      if (!c.alive || !buf || !running()) return;
      try {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const g = ctx.createGain();
        const t = ctx.currentTime;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(AMBIENCE_LEVEL * cl.gain, t + 1.2); // gentle swell in, never a spike
        src.connect(g).connect(c.bus);
        c.sources.add(src);
        c.ambience.src = src;
        c.ambience.gain = g;
        src.start(t);
        combatStats.played.push(key);
      } catch {
        // ambience is optional
      }
    });
  }

  // Fade the sustained bed out (one-shots finish on their own). Safe to call repeatedly.
  function endAmbience(c, fade) {
    const a = c.ambience;
    if (!a || !a.gain || a.ending) return;
    a.ending = true;
    const now = ctx.currentTime;
    a.gain.gain.cancelScheduledValues(now);
    a.gain.gain.setValueAtTime(a.gain.gain.value, now);
    a.gain.gain.linearRampToValueAtTime(0.0001, now + fade);
  }

  function newCombatSession(mode, palette) {
    stopCombat(0.05); // a new battle always replaces the old one
    const bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(combatBus);
    combat = { mode, alive: true, bus, timers: new Set(), sources: new Set(), active: 0, last: {}, ambience: null, palette, lastKey: null, lastLoud: -1e9, count: 0 };
    combatStats.sessions++;
    return combat;
  }

  // ---------- Stage 9.3.1: fighter metadata -> sound palette ----------
  // The only fighter metadata the game has is the text the player typed (name and short
  // description), so that text is classified with whole-word rules into sound "palettes": weights
  // over the type.subtype keys of COMBAT_SOUNDS. No AI is involved and nothing is requested from the
  // server. A fighter that matches nothing gets the generic brawl palette, so the soundscape is never
  // empty, and a fighter is never assumed to hold a sword or gun unless its text says so.
  const PALETTE_RULES = [
    ['blade', /\b(swords?|swordsm[ae]n|swordswoman|samurai|katanas?|knights?|ninjas?|vikings?|pirates?|gladiators?|spartans?|barbarians?|paladins?|crusaders?|templars?|assassins?|musketeers?|excalibur|rapier|sabers?|sabres?|scimitars?|daggers?|knives|knife|blades?|elves|elf|dwarves|dwarf|amazons?|achilles|king arthur|conan|zorro|jedi|sith|warriors?|centurions?|legion(?:s|naires?)?|swashbucklers?|shogun|ronin)\b/, { 'weapon_swing.blade': 3, 'metal_impact.blade_clash': 3, 'metal_impact.shield': 0.8, 'voice.grunt_male': 0.8 }],
    ['heavy', /\b(axes?|greatswords?|war ?hammers?|hammers?|maces?|clubs?|barbarians?|ogres?|trolls?|juggernauts?|thor|hercules|minotaurs?|orcs?|berserkers?|executioners?)\b/, { 'weapon_swing.heavy_blade': 2.5, 'physical_impact.heavy_hit': 1.5, 'metal_impact.shield': 0.6 }],
    ['shield', /\b(shields?|knights?|spartans?|paladins?|crusaders?|templars?|captain america|legion(?:s|naires?)?|centurions?)\b/, { 'metal_impact.shield': 2 }],
    ['unarmed', /\b(boxers?|boxing|martial arts?|martial artists?|karate|kung ?fu|judo|jiu ?jitsu|taekwondo|muay thai|wrestlers?|wrestling|brawlers?|mma|monks?|kickboxers?|bruce lee|chuck norris|rocky|ali|tyson|ryu|ken|goku|street fighters?|bare[- ]?knuckle|pugilists?|sumo|fists?|punch(?:er|ers)?|bouncers?|bodybuilders?|hulk|gorillas?|apes?|king kong)\b/, { 'physical_impact.punch': 3, 'physical_impact.kick': 2, 'physical_impact.heavy_hit': 1, 'voice.grunt_male': 1 }],
    ['archer', /\b(archers?|bow|bows|bowmen|bowman|crossbows?|robin hood|legolas|hawkeye|katniss|artemis|cupid|rangers?|hunters?|slingers?|longbow|marksm[ae]n|apollo|arrows?)\b/, { 'projectile.arrow': 4, 'weapon_swing.blade': 0.6, 'voice.grunt_male': 0.4 }],
    ['magic', /\b(wizards?|warlocks?|witch(?:es)?|sorcer(?:er|ers|ess|esses)|mages?|necromancers?|liches?|lich|genies?|djinn|fairy|fairies|elementals?|ghosts?|spectres?|wraiths?|phoenix|medusa|loki|odin|merlin|gandalf|dumbledore|harry potter|doctor strange|magicians?|druids?|shamans?|demons?|angels?|spells?|magic|magical|mystic|enchant\w*|sorcery|zeus|poseidon|hades|vampires?|sailor moon|elsa)\b/, { 'magic.arcane': 3, 'magic.elemental': 2, 'voice.yell': 0.4 }],
    ['elemental', /\b(fire|flames?|flaming|lava|volcano|inferno|lightning|thunder|storm|electric|electricity|pyro|blaze|ember|solar|sun|wind|tornado|hurricane|earthquake|earth|stone|rock|golem|thor|zeus)\b/, { 'magic.elemental': 3 }],
    ['ice', /\b(ice|icy|frost|frozen|snow|blizzard|glacier|winter|cold|elsa|freeze|yeti|snowman|iceman|sub-zero|polar)\b/, { 'magic.ice': 3.5 }],
    ['dragon', /\b(dragons?|wyrms?|wyverns?|drakes?|hydras?|basilisks?|leviathans?|godzilla|dinosaurs?|t-?rex|tyrannosaurus|raptors?|kaiju|kraken|balrog|smaug|charizard)\b/, { 'creature.roar': 4, 'magic.elemental': 1.4, 'physical_impact.heavy_hit': 1, 'explosion.blast': 0.5 }],
    ['beast', /\b(wolf|wolves|werewolf|werewolves|werebears?|bears?|lions?|tigers?|panthers?|boars?|dogs?|cats?|cows?|bulls?|horses?|snakes?|serpents?|spiders?|griffins?|gryphons?|manticores?|chimeras?|sharks?|crocodiles?|alligators?|gators?|hounds?|beasts?|monsters?|gremlins?|goblins?|rats?|rabbits?|bigfoot|sasquatch|cerberus|animals?|creatures?|hippos?|rhinos?|elephants?|mammoths?|pikachu|aliens?|zombies?|predators?|xenomorphs?)\b/, { 'creature.growl': 3.5, 'creature.roar': 1, 'physical_impact.heavy_hit': 1, 'physical_impact.punch': 0.5 }],
    ['robot', /\b(robots?|androids?|cyborgs?|mechs?|mechas?|terminators?|droids?|machines?|ai|automaton|transformers?|optimus prime|megatron|iron man|robocop|wall-?e|daleks?|cybermen|gundam|exosuits?|bots?|mechanical|steampunk|clockwork|sentinels?|ultron|skynet|r2-?d2|c-?3po)\b/, { 'mechanical.servo': 3, 'mechanical.machinery': 2, 'energy_weapon.blaster': 1.5, 'energy_weapon.beam': 1.2 }],
    ['scifi', /\b(lasers?|blasters?|plasma|space|spaceships?|starships?|sci-?fi|stormtroopers?|darth vader|vader|samus|master chief|halo|cyber\w*|futuristic|astronauts?|aliens?|saiyan|ray ?guns?|photon|star wars|star trek|superman|cosmic|galactic|energy|force)\b/, { 'energy_weapon.blaster': 2.5, 'energy_weapon.beam': 2, 'energy_weapon.plasma': 1.5, 'energy_weapon.energy_gun': 1.5 }],
    ['gun', /\b(soldiers?|seals?|navy|marines?|army|commandos?|delta|snipers?|cowboys?|gunslingers?|gunmen|gunman|police|cops?|swat|special forces|rambo|john wick|mercenar(?:y|ies)|gangsters?|mobsters?|outlaws?|sheriffs?|pistols?|guns?|rifles?|machine guns?|militia|infantry|troops?|squad|platoon|battalion|spies?|james bond|agents?|bounty hunters?|punisher|deadpool|terrorists?|military|gi joe|fbi|cia|green berets?|paratroopers?|assault|shooters?)\b/, { 'gunfire.auto': 2.5, 'gunfire.rifle': 2, 'gunfire.pistol': 2, 'voice.war_cry': 0.8, 'voice.grunt_male': 0.8 }],
    ['explosive', /\b(tanks?|bombs?|bombers?|grenades?|rockets?|nukes?|nuclear|missiles?|dynamite|artillery|cannons?|explosi\w+|bazookas?|landmines?|demolition|warship|battleship|helicopters?|fighter jets?|jets?|tnt)\b/, { 'explosion.blast': 3, 'gunfire.auto': 1 }],
    ['female', /\b(woman|women|female|girls?|queens?|princess(?:es)?|amazons?|valkyrie|valkyries|witch(?:es)?|goddess(?:es)?|lady|ladies|wonder woman|xena|cleopatra|joan of arc|boudica|lara croft|heroine|empress|maiden|sorceress|huntress)\b/, { 'voice.grunt_female': 2.5 }],
    ['group', /\b(squad|army|armies|horde|hordes|legion|legions|platoon|battalion|crowd|mob|team|troops?|soldiers|warriors|knights|vikings|pirates|samurai|ninjas|gladiators|spartans|barbarians|orcs|goblins|zombies|marines|commandos|\d{2,}|dozens?|hundreds?|thousands?|swarm|pack|regiment|brigade|gang|clan|tribe)\b/, { 'voice.war_cry': 2 }],
  ];
  // Tags that only add flavor on top of a real fighting style (they never count as "recognized").
  const FLAVOR_TAGS = new Set(['female', 'group', 'shield', 'elemental', 'ice']);
  const FALLBACK_PALETTE = { 'weapon_swing.blade': 1.5, 'physical_impact.punch': 2, 'physical_impact.kick': 1, 'physical_impact.heavy_hit': 1, 'metal_impact.blade_clash': 1, 'voice.grunt_male': 1, 'voice.yell': 0.8, 'explosion.blast': 0.3 };
  const LOUD_KEYS = new Set(['explosion.blast', 'creature.roar', 'gunfire.auto', 'gunfire.rifle', 'gunfire.pistol', 'magic.elemental', 'magic.arcane', 'energy_weapon.plasma', 'physical_impact.heavy_hit', 'weapon_swing.heavy_blade', 'voice.war_cry']);

  // Weights for one fighter, scaled so every fighter contributes the same total (a balanced mix
  // when two different palettes meet). Also returns the matched tag names.
  function paletteFor(name) {
    const n = String(name || '').toLowerCase();
    const w = {};
    const tags = [];
    for (const [tag, re, weights] of PALETTE_RULES) {
      if (!re.test(n)) continue;
      tags.push(tag);
      for (const [k, v] of Object.entries(weights)) w[k] = (w[k] || 0) + v;
    }
    if (!tags.some((t) => !FLAVOR_TAGS.has(t))) {
      // nothing recognizable: generic brawl (half strength if some flavor tag matched)
      for (const [k, v] of Object.entries(FALLBACK_PALETTE)) w[k] = (w[k] || 0) + v * (tags.length ? 0.5 : 1);
      tags.push('generic');
    }
    const total = Object.values(w).reduce((s, v) => s + v, 0) || 1;
    for (const k of Object.keys(w)) w[k] = (w[k] / total) * 10;
    return { weights: w, tags };
  }

  function combatPalette(a, b) {
    const pa = paletteFor(a);
    const pb = paletteFor(b);
    const weights = {};
    for (const p of [pa, pb]) for (const [k, v] of Object.entries(p.weights)) weights[k] = (weights[k] || 0) + v;
    const text = `${a || ''} ${b || ''}`.toLowerCase();
    const ambience = /\b(army|armies|war|battalion|legion|legions|platoon|regiment|troops?|soldiers|navy|marines)\b/.test(text) ? 'warfield' : /\b(crowd|mob|horde|hordes|gang|clan|tribe|pack|swarm|\d{2,})\b/.test(text) ? 'crowd' : 'skirmish';
    return { weights, tags: [...new Set([...pa.tags, ...pb.tags])], ambience, fighters: [pa.tags, pb.tags] };
  }

  function pickWeighted(weights, skip) {
    const entries = Object.entries(weights).filter(([k, v]) => v > 0 && !skip(k));
    if (!entries.length) return null;
    let r = Math.random() * entries.reduce((s, [, v]) => s + v, 0);
    for (const [k, v] of entries) {
      r -= v;
      if (r <= 0) return k;
    }
    return entries[entries.length - 1][0];
  }

  // ---------- Judging soundscape: runs only while the loading ("battle") scene is up ----------
  // One timer chain: a first hit after ~0.9 s, then cues at varied intervals (1.1-2.8 s) with a
  // longer lull every 5-7 cues. It never repeats the previous effect, keeps two loud effects at least
  // 2.4 s apart, and honors the concurrency limit and per-effect cooldown in fireOneShot().
  // It runs for as long as judging does, however long, and stopCombat() ends it at once.
  const COMBAT_LOUD_GAP_MS = 2400;
  function startCombat() {
    if (combat || !combatPossible() || !(fighterNames[0] || fighterNames[1])) return;
    const pal = combatPalette(fighterNames[0], fighterNames[1]);
    const c = newCombatSession('judging', pal);
    // Decode the three most likely effects (all variants) before they are needed.
    Object.entries(pal.weights).sort((x, y) => y[1] - x[1]).slice(0, 3).forEach(([k]) => (COMBAT_SOUNDS[k] || []).forEach(loadClip));
    startAmbience(c, { type: 'ambience', subtype: pal.ambience });
    let untilLull = 5 + Math.floor(Math.random() * 3);
    const step = () => {
      const now = performance.now();
      const loudOk = now - c.lastLoud >= COMBAT_LOUD_GAP_MS;
      const key = pickWeighted(pal.weights, (k) => k === c.lastKey || (c.count < 2 && !(COMBAT_SOUNDS[k] || []).some((x) => !BIG_FILES.has(x.file))) || (!loudOk && LOUD_KEYS.has(k)) || (c.last[k] !== undefined && now - c.last[k] < COMBAT_COOLDOWN_MS));
      if (key) {
        const [type, subtype] = key.split('.');
        fireOneShot(c, { type, subtype, light: c.count < 2 }, now);
        c.lastKey = key;
        c.count++;
        if (LOUD_KEYS.has(key)) c.lastLoud = now;
      }
      untilLull--;
      let wait = rand(1100, 2800);
      if (untilLull <= 0) {
        wait = rand(3000, 4500);
        untilLull = 5 + Math.floor(Math.random() * 3);
      }
      combatLater(c, step, wait);
    };
    combatLater(c, step, 900);
  }

  // ---------- scene control ----------
  function stopMusic(fade) {
    mp3Halt(fade);
    musicScene = null;
  }

  // Which track (if any) this scene should use right now.
  function trackForScene(scene) {
    const key = MUSIC_CONFIG.sceneTrack[scene];
    if (!key || !mp3Supported()) return null;
    const t = mp3.els[key];
    return t && t.failed ? null : key;
  }

  // The same track is never restarted (e.g. battle -> victory keeps the Taiko playing).
  function startMusic(scene) {
    const key = trackForScene(scene);
    if (!key) {
      stopMusic(0.4); // no usable track for this scene (failed MP3): silence, never synthesized music
      return;
    }
    musicScene = scene;
    mp3Play(key);
  }

  // Bring actual playback in line with the wanted scene, mode and permissions.
  function applyScene() {
    const scene = wantedScene;
    const canMusic = musicOn() && running();
    if (!canMusic || scene === 'silent') {
      stopMusic(0.5);
      stopSfx();
      stopCombat(0.2);
      currentScene = null;
      return;
    }
    if (scene === currentScene) return; // already there: never restart
    const previous = currentScene;
    currentScene = scene;
    if (scene !== 'battle') stopCombat(scene === 'victory' ? 0.35 : 0.2); // combat sounds belong to the judging screen only
    if (scene === 'battle') {
      startMusic('battle');
      startSfxSession();
      startCombat();
    } else if (scene === 'victory') {
      stopSfx(); // battle cries, roars and weapon effects stop before the fanfare
      startMusic('victory'); // Taiko continues under the fanfare
      if (previous === 'battle' || previous === null) playFanfare();
    } else {
      stopSfx();
      startMusic(scene);
    }
  }

  function setScene(scene) {
    wantedScene = scene;
    if (running()) applyScene();
    else currentScene = null;
  }

  // ---------- voice ----------
  function duck(on) {
    if (!ctx || !mp3Bus) return;
    const now = ctx.currentTime;
    mp3Bus.gain.cancelScheduledValues(now);
    mp3Bus.gain.setTargetAtTime(on ? MUSIC_CONFIG.duckFactor : 1, now, 0.15); // smooth in both directions
    if (combatBus) {
      combatBus.gain.cancelScheduledValues(now);
      combatBus.gain.setTargetAtTime(on ? COMBAT_LEVEL * COMBAT_DUCK : COMBAT_LEVEL, now, 0.1); // effects never bury the voice
    }
  }

  function activated() {
    return userActive || (navigator.userActivation && navigator.userActivation.hasBeenActive);
  }

  function makeUtterance(text) {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    u.pitch = 0.85;
    u.onstart = () => {
      speaking++;
      duck(true);
    };
    const done = () => {
      speaking = Math.max(0, speaking - 1);
      if (speaking === 0) duck(false);
    };
    u.onend = done;
    u.onerror = done;
    return u;
  }

  // On-demand narration (the verdict button). Only one narration at a time; cb(state) is
  // called once with 'end' (finished), 'error' or 'stopped' (cancelled by anything else).
  let narration = null; // { id, cb }
  let narrationSeq = 0;

  const canNarrate = () => voiceOn() && speechSupported();

  function finishNarration(state) {
    const n = narration;
    narration = null;
    if (n && n.cb) {
      try {
        n.cb(state);
      } catch {
        // UI callback failed: ignore
      }
    }
  }

  function cancelSpeech() {
    clearTimeout(speechTimer);
    speechTimer = null;
    if (speechSupported()) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
    speaking = 0;
    duck(false);
    finishNarration('stopped');
  }

  // Read text aloud on request. Split into sentences: some browsers cut off one long utterance.
  // Replaces any speech already queued (no overlap). Returns false if narration is unavailable.
  function narrate(text, cb) {
    cancelSpeech();
    if (!canNarrate()) return false;
    const parts = (String(text).match(/[^.!?]+[.!?]*/g) || [String(text)]).map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return false;
    const id = ++narrationSeq;
    narration = { id, cb };
    const live = () => narration && narration.id === id;
    try {
      parts.forEach((p, i) => {
        const u = makeUtterance(p);
        const onend = u.onend;
        const onerror = u.onerror;
        u.onend = () => {
          onend();
          if (live() && i === parts.length - 1) finishNarration('end');
        };
        u.onerror = () => {
          onerror();
          if (live()) {
            finishNarration('error');
            try {
              window.speechSynthesis.cancel(); // drop the rest of the queue
            } catch {
              // ignore
            }
          }
        };
        window.speechSynthesis.speak(u);
      });
    } catch {
      finishNarration('error');
      return false;
    }
    return true;
  }

  // Speak one or more lines, replacing anything already queued. delayMs waits (for a fanfare).
  function sayQueue(lines, delayMs) {
    cancelSpeech();
    if (!voiceOn() || !speechSupported() || !activated()) return;
    const go = () => {
      if (!voiceOn()) return;
      try {
        lines.forEach((l) => window.speechSynthesis.speak(makeUtterance(l)));
      } catch {
        // speech failed: silently ignore, gameplay is unaffected
      }
    };
    if (delayMs) speechTimer = setTimeout(go, delayMs);
    else go();
  }

  const say = (text, delayMs) => sayQueue([text], delayMs);

  // Delay speech until the fanfare has finished (only when the fanfare will actually play).
  function victoryDelay() {
    return musicOn() && running() ? FANFARE_MS : 0;
  }

  // ---------- lifecycle ----------
  let lastMode = mode();
  BGSettings.onChange(() => {
    applyMusicVolume(); // slider: live level change, never a restart
    const modeChanged = mode() !== lastMode;
    lastMode = mode();
    if (!modeChanged) return;
    if (!voiceOn()) cancelSpeech();
    if (musicOn()) {
      if (!running()) {
        if (!ctx) attachGestures();
        else if (activated()) ctx.resume().then(applyScene, () => {});
      }
      currentScene = null; // force re-evaluation after a mode change
      applyScene();
    } else {
      stopMusic(0.4);
      stopSfx();
      stopCombat(0.2);
      currentScene = null;
    }
    if (!running() && mode() !== 'mute') attachGestures();
  });

  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) {
      cancelSpeech();
      stopSfx(); // timers would keep queuing effects while the context is suspended
      stopCombat(0.05);
      mp3PauseForHidden();
      ctx.suspend().catch(() => {});
    } else if (musicOn() && activated()) {
      ctx.resume().then(() => {
        mp3ResumeAfterHidden();
        applyScene();
        if (wantedScene === 'battle' && musicOn()) {
          startSfxSession();
          startCombat();
        }
      }, () => {});
    }
  });

  window.addEventListener('pagehide', () => {
    cancelSpeech();
    stopSfx();
    stopCombat(0.05);
    stopMusic(0.1);
  });

  if (mode() !== 'mute') attachGestures();

  return {
    config: MUSIC_CONFIG, // editable at runtime (tests / future settings)
    FANFARE_MS,
    setScene,
    setFighters,
    classify,
    say,
    sayQueue,
    cancelSpeech,
    narrate,
    combatPalette,
    canNarrate,
    victoryDelay,
    // Read-only snapshot for tests / diagnostics.
    debug: () => ({
      ctxState: ctx ? ctx.state : 'none',
      wantedScene,
      currentScene,
      music: musicScene,
      track: mp3.key,
      mp3State: mp3.state,
      mp3Time: mp3.key && mp3.els[mp3.key] ? mp3.els[mp3.key].el.currentTime : null,
      mp3Duration: mp3.key && mp3.els[mp3.key] ? mp3.els[mp3.key].el.duration : null,
      mp3Gain: mp3.key && mp3.els[mp3.key] ? mp3.els[mp3.key].gain.gain.value : null,
      busDuck: mp3Bus ? mp3Bus.gain.value : null,
      playing: Object.entries(mp3.els).filter(([, t]) => !t.el.paused).map(([k]) => k),
      failed: Object.entries(mp3.els).filter(([, t]) => t.failed).map(([k]) => k),
      musicVolume: BGSettings.get().musicVolume,
      sfxActive: !!sfxSession,
      voiceSeq,
      speaking,
      mode: mode(),
      tags: [...fighterTags],
      played: { ...played },
      weights: effectWeights(),
      combat: {
        mode: combat ? combat.mode : null,
        tags: combat ? combat.palette.tags : [],
        ambienceKind: combat ? combat.palette.ambience : null,
        active: combat ? combat.active : 0,
        ambience: combat && combat.ambience ? combat.ambience.key : null,
        played: [...combatStats.played],
        skipped: combatStats.skipped,
        missing: combatStats.missing,
        maxActive: combatStats.maxActive,
        sessions: combatStats.sessions,
        busLevel: combatBus ? combatBus.gain.value : null,
      },
    }),
  };
})();
