// Stage 8 Settings Manager: audio mode + victory-animation preference.
// Loaded in <head> so the motion attribute is set before first paint.
// audio:     'all' | 'voice' | 'music' (music & effects only) | 'mute'
// animation: 'auto' (follow the OS) | 'animated' | 'css' | 'none'
const BGSettings = (function () {
  const KEY = 'battleground-settings';
  const AUDIO_MODES = ['all', 'voice', 'music', 'mute'];
  const ANIMATION_MODES = ['animated', 'css', 'none'];
  const listeners = new Set();
  let state = { audio: 'all', animation: 'auto' };

  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && AUDIO_MODES.includes(saved.audio)) state.audio = saved.audio;
    if (saved && ANIMATION_MODES.includes(saved.animation)) state.animation = saved.animation;
  } catch {
    // Storage blocked or corrupt: defaults apply.
  }

  const reducedQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  // The player's explicit choice wins. Otherwise the OS setting gives a safe default.
  function motion() {
    if (state.animation !== 'auto') return state.animation;
    return reducedQuery && reducedQuery.matches ? 'none' : 'animated';
  }

  function applyMotion() {
    const root = document.documentElement;
    root.dataset.motion = motion();
    if (state.animation !== 'auto') root.dataset.motionSet = '1';
    else delete root.dataset.motionSet;
  }

  function emit() {
    applyMotion();
    listeners.forEach((fn) => {
      try {
        fn({ ...state });
      } catch {
        // A listener must never break settings.
      }
    });
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // Not persisted; still applies for this page.
    }
  }

  if (reducedQuery && reducedQuery.addEventListener) reducedQuery.addEventListener('change', emit);
  // Keep other open tabs/pages in sync.
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    try {
      const saved = JSON.parse(e.newValue);
      if (saved && AUDIO_MODES.includes(saved.audio)) state.audio = saved.audio;
      if (saved && (ANIMATION_MODES.includes(saved.animation) || saved.animation === 'auto')) state.animation = saved.animation;
      emit();
    } catch {
      // ignore
    }
  });

  applyMotion();

  return {
    AUDIO_MODES,
    ANIMATION_MODES,
    get: () => ({ ...state }),
    motion,
    set(patch) {
      if (patch.audio && AUDIO_MODES.includes(patch.audio)) state.audio = patch.audio;
      if (patch.animation && ANIMATION_MODES.includes(patch.animation)) state.animation = patch.animation;
      persist();
      emit();
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
})();
