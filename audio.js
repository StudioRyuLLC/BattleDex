// Stage 8 Audio Manager. Everything is synthesized with the Web Audio API (no audio
// files, so nothing to license) plus the browser's speechSynthesis for voice.
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
    timer = setTimeout(next, 600);

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
      currentScene = null;
      return;
    }
    if (scene === currentScene) return; // already there: never restart
    const previous = currentScene;
    currentScene = scene;
    if (scene === 'battle') {
      startMusic('battle');
      startSfxSession();
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
      currentScene = null;
    }
    if (!running() && mode() !== 'mute') attachGestures();
  });

  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) {
      cancelSpeech();
      stopSfx(); // timers would keep queuing effects while the context is suspended
      mp3PauseForHidden();
      ctx.suspend().catch(() => {});
    } else if (musicOn() && activated()) {
      ctx.resume().then(() => {
        mp3ResumeAfterHidden();
        applyScene();
        if (wantedScene === 'battle' && musicOn()) startSfxSession();
      }, () => {});
    }
  });

  window.addEventListener('pagehide', () => {
    cancelSpeech();
    stopSfx();
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
    }),
  };
})();
