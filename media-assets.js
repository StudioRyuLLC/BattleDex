// Stage 8 Media Asset Manager. Audio is synthesized (see audio.js), so this resolves only
// animated-fighter assets, via assets/animations/manifest.json:
//   { "enabled": true, "animations": { "red dragon": "red-dragon.webp" } }
// A missing/invalid manifest, a missing entry or enabled:false all mean "no animated asset",
// and the caller falls back to the CSS effects. Nothing here ever generates anything.
const BGMedia = (function () {
  const ANIMATED_FIGHTERS_ENABLED = true; // flip to false to roll the feature back independently
  const BASE = 'assets/animations/';
  let manifestPromise = null;

  function loadManifest() {
    if (!manifestPromise) {
      manifestPromise = fetch(BASE + 'manifest.json', { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}));
    }
    return manifestPromise;
  }

  function key(name) {
    return typeof normalizeName === 'function' ? normalizeName(name) : String(name || '').trim().toLowerCase();
  }

  // Resolves to { url, kind: 'video' | 'image' } or null. Never rejects.
  async function getAnimation(fighterName) {
    if (!ANIMATED_FIGHTERS_ENABLED) return null;
    try {
      const m = await loadManifest();
      if (!m || m.enabled === false || !m.animations) return null;
      const file = m.animations[key(fighterName)];
      if (typeof file !== 'string' || !/^[\w.\-]+$/.test(file)) return null;
      return { url: BASE + file, kind: /\.(mp4|webm)$/i.test(file) ? 'video' : 'image' };
    } catch {
      return null;
    }
  }

  return { getAnimation };
})();
