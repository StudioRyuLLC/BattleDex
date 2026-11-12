// Stage 8 Audio Manager. Everything is synthesized with the Web Audio API (no audio
// files, so nothing to license) plus the browser's speechSynthesis for voice.
//
// Scenes: 'home' (war-drum ambience), 'dex' (quieter, same identity), 'battle' (drums +
// skirmish effects), 'victory' (ceremonial fanfare, then quiet ambience), 'quiet', 'silent'.
// Nothing plays until the browser allows it: the AudioContext is created on the first
// user gesture only, and the gesture listeners detach once audio is running.
const BGAudio = (function () {
  const MUSIC_LEVEL = 0.2;
  const DUCKED_LEVEL = 0.07;
  const SFX_LEVEL = 0.5;
  const FANFARE_MS = 2900;
  const MAX_SFX_EVENTS = 6; // simultaneous combat sounds, so it never becomes a wall of noise

  let ctx = null;
  let master = null;
  let musicBus = null;
  let sfxBus = null;
  let noiseBuffer = null;
  let wantedScene = 'silent';
  let currentScene = null;
  let musicVoice = null; // { stop(fade), scene }
  let sfxSession = null; // { stop() } active only during battle
  let fanfareTimer = null;
  let speaking = 0;
  let speechTimer = null;
  let userActive = false;
  let voiceSeq = 0; // increments whenever a new music voice starts (restart detection in tests)
  let fighterTags = new Set();

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
    musicBus = ctx.createGain();
    musicBus.gain.value = MUSIC_LEVEL;
    musicBus.connect(master);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = SFX_LEVEL;
    sfxBus.connect(master);
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

  // ---------- music voices ----------
  // Each voice returns { stop(fadeSeconds) }; its nodes are all disconnected on stop.
  function makeVoice(build) {
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.connect(musicBus);
    const timers = [];
    const nodes = [];
    const api = {
      out,
      timers,
      nodes,
      stopped: false,
      fadeIn(sec, level) {
        out.gain.cancelScheduledValues(ctx.currentTime);
        out.gain.setValueAtTime(0.0001, ctx.currentTime);
        out.gain.linearRampToValueAtTime(level || 1, ctx.currentTime + sec);
      },
      stop(sec) {
        if (api.stopped) return;
        api.stopped = true;
        timers.forEach((t) => {
          clearTimeout(t);
          clearInterval(t);
        });
        const now = ctx.currentTime;
        out.gain.cancelScheduledValues(now);
        out.gain.setValueAtTime(Math.max(out.gain.value, 0.0001), now);
        out.gain.linearRampToValueAtTime(0.0001, now + sec);
        setTimeout(() => {
          nodes.forEach((n) => {
            try {
              n.stop();
            } catch {
              // already stopped
            }
          });
          try {
            out.disconnect();
          } catch {
            // ignore
          }
        }, sec * 1000 + 80);
      },
    };
    build(api);
    return api;
  }

  function drone(api, root, cutoff, level) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    lp.Q.value = 0.7;
    lp.connect(api.out);
    const mk = (type, freq, gain, detune) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune || 0;
      const g = ctx.createGain();
      g.gain.value = gain * level;
      o.connect(g).connect(lp);
      o.start();
      api.nodes.push(o);
    };
    mk('sawtooth', root, 0.5, -6);
    mk('sawtooth', root, 0.45, 7);
    mk('sine', root * 1.5, 0.4, 0); // fifth
    mk('sine', root / 2, 0.9, 0); // sub
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = cutoff * 0.35;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start();
    api.nodes.push(lfo);
  }

  // A distant war horn: slow swell, falling answer, softened and echoed so it sounds far away.
  function distantHorn(api, root, level) {
    const t = ctx.currentTime + 0.05;
    const send = ctx.createGain();
    send.gain.value = level;
    const far = ctx.createBiquadFilter();
    far.type = 'lowpass';
    far.frequency.value = 900;
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    delay.connect(fb).connect(delay);
    send.connect(far);
    far.connect(api.out);
    far.connect(delay);
    delay.connect(api.out);
    played.horn = (played.horn || 0) + 1;
    const f = root * 2; // e.g. 110 Hz
    brass(send, t, f, 2.4, 0.5, 0.9);
    brass(send, t + 1.7, f * 0.89, 2.2, 0.4, 0.8);
    setTimeout(() => {
      try {
        send.disconnect();
        far.disconnect();
        delay.disconnect();
      } catch {
        // ignore
      }
    }, 7000);
  }

  // Foreboding war-drum ambience. Variation: velocity, timing jitter, skipped and ghost
  // hits, occasional fills, and a distant horn every so often.
  function warDrumVoice(p) {
    return makeVoice((api) => {
      drone(api, p.root, p.cutoff, p.droneLevel);
      const beat = 60 / p.bpm; // one drum pulse
      let next = ctx.currentTime + 0.3;
      let i = 0;
      // 8-pulse phrase: strong, weak, medium, rest, strong, weak, medium, answer
      const phrase = [1, 0.5, 0.75, 0, 1, 0.45, 0.7, 0.3];
      const tick = () => {
        if (api.stopped) return;
        while (next < ctx.currentTime + 0.25) {
          const s = i % phrase.length;
          const v = phrase[s];
          const skip = v > 0 && v < 0.6 && Math.random() < 0.25;
          if (v > 0 && !skip) warDrum(api.out, next + rand(-0.012, 0.012), p.drum * v * rand(0.82, 1.12), rand(-0.15, 0.15));
          if (v === 0 && Math.random() < 0.22) warDrum(api.out, next + beat * 0.5, p.drum * 0.28, rand(-0.3, 0.3)); // ghost hit
          if (s === 7 && i % 32 === 31 && !p.noFill) {
            [0, 0.18, 0.34].forEach((o, k) => tom(api.out, next + beat * 0.55 + o, p.drum * (0.5 + k * 0.12), 150 - k * 14, rand(-0.4, 0.4)));
          }
          next += beat;
          i++;
        }
      };
      api.timers.push(setInterval(tick, 50));
      tick();
      if (p.hornEvery) {
        const horn = () => {
          if (api.stopped) return;
          distantHorn(api, p.root, p.horn);
          api.timers.push(setTimeout(horn, rand(p.hornEvery[0], p.hornEvery[1]) * 1000));
        };
        api.timers.push(setTimeout(horn, rand(7, 12) * 1000));
      }
    });
  }

  function battleVoice() {
    return makeVoice((api) => {
      drone(api, 65.4, 560, 0.7);
      const bpm = 132;
      const step = 60 / bpm / 4; // 16th notes
      let next = ctx.currentTime + 0.1;
      let i = 0;
      const kick = [0, 3, 4, 8, 10, 12];
      const tomHits = [6, 14];
      const tick = () => {
        if (api.stopped) return;
        while (next < ctx.currentTime + 0.18) {
          const s = i % 16;
          if (kick.includes(s)) warDrum(api.out, next + rand(-0.006, 0.006), (s === 0 ? 1 : 0.7) * rand(0.85, 1.1), rand(-0.2, 0.2));
          if (tomHits.includes(s)) tom(api.out, next, rand(0.6, 0.85), 175 - (s === 14 ? 25 : 0), rand(-0.5, 0.5));
          if (s % 2 === 1 && Math.random() < 0.3) tom(api.out, next, 0.3, 210, rand(-0.5, 0.5));
          if (s === 15 && i % 64 === 63) [0, 1, 2, 3].forEach((k) => tom(api.out, next + k * step * 0.5, 0.55 + k * 0.1, 200 - k * 20, rand(-0.5, 0.5)));
          if (i % 32 === 0) [65.4, 77.8, 98].forEach((f) => brass(api.out, next, f * 2, 0.9, 0.09, 0.12)); // dark brass stab
          next += step;
          i++;
        }
      };
      api.timers.push(setInterval(tick, 40));
      tick();
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

  // ---------- scene control ----------
  function stopMusic(fade) {
    if (musicVoice) {
      musicVoice.stop(fade);
      musicVoice = null;
    }
  }

  const HOME = { root: 55, bpm: 54, drum: 1, cutoff: 260, droneLevel: 0.5, hornEvery: [18, 34], horn: 0.5 };
  const DEX = { root: 49, bpm: 46, drum: 0.55, cutoff: 200, droneLevel: 0.45, hornEvery: [40, 70], horn: 0.3, noFill: true };

  function startMusic(scene, fadeIn) {
    stopMusic(0.6);
    let v = null;
    let level = 1;
    if (scene === 'home') v = warDrumVoice(HOME);
    else if (scene === 'dex') v = warDrumVoice(DEX);
    else if (scene === 'battle') v = battleVoice();
    else if (scene === 'quiet') {
      v = warDrumVoice({ ...HOME, drum: 0.6, hornEvery: null });
      level = 0.6;
    }
    if (!v) return;
    v.scene = scene;
    voiceSeq++;
    v.fadeIn(fadeIn, level);
    musicVoice = v;
  }

  // Bring actual playback in line with the wanted scene, mode and permissions.
  function applyScene() {
    clearTimeout(fanfareTimer);
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
      startMusic('battle', 1.2);
      startSfxSession();
    } else if (scene === 'victory') {
      stopSfx(); // battle cries, roars and weapon effects stop before the fanfare
      stopMusic(0.7); // battle music fades out
      if (previous === 'battle' || previous === null) playFanfare();
      fanfareTimer = setTimeout(() => {
        if (wantedScene === 'victory' && running() && musicOn()) startMusic('quiet', 2.5);
      }, FANFARE_MS);
    } else {
      stopSfx();
      startMusic(scene, 2.2);
    }
  }

  function setScene(scene) {
    wantedScene = scene;
    if (running()) applyScene();
    else currentScene = null;
  }

  // ---------- voice ----------
  function duck(on) {
    if (!ctx || !musicBus) return;
    const now = ctx.currentTime;
    musicBus.gain.cancelScheduledValues(now);
    musicBus.gain.setTargetAtTime(on ? DUCKED_LEVEL : MUSIC_LEVEL, now, 0.15);
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
  BGSettings.onChange(() => {
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
      ctx.suspend().catch(() => {});
    } else if (musicOn() && activated()) {
      ctx.resume().then(() => {
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
      music: musicVoice ? musicVoice.scene : null,
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
