// Stage 9.1: "How to Play & About" guide (help button in the header + accessible modal).
// Loaded on index.html and battledex.html after audio.js / settings.js / settings-ui.js.
//
// - The "?" button is static markup in both headers (#help-btn). It pulses until the guide is
//   opened once (localStorage flag); prefers-reduced-motion swaps the pulse for a static glow.
// - The dialog is built lazily on first open, so its portraits are not requested until needed.
// - "Read Guide Aloud" reuses BGAudio.narrate (no second speech system), so audio mode, music
//   ducking and "one narration at a time" all behave exactly like the verdict button.
(function () {
  const btn = document.getElementById('help-btn');
  if (!btn) return;

  // ===== Content that is meant to be edited =====
  // Music credits, one per game scene. Keep in sync with MUSIC_CONFIG.sceneTrack in audio.js.
  const PIXABAY = 'https://pixabay.com/';
  const MUSIC_CREDITS = [
    {
      scene: 'Home / Entry',
      artist: 'Ievgen Poltavskyi (HitsLab)',
      url: 'https://pixabay.com/users/hitslab-47305729/?utm_source=link-attribution&utm_medium=referral&utm_campaign=music&utm_content=489236',
    },
    {
      scene: 'BattleDex',
      artist: 'Yevhen Astafiev',
      url: 'https://pixabay.com/users/yevhenastafiev-52618283/?utm_source=link-attribution&utm_medium=referral&utm_campaign=music&utm_content=607250',
    },
    {
      scene: 'Judging / Victory',
      artist: 'Alec Koff',
      url: 'https://pixabay.com/users/alec_koff-54645061/?utm_source=link-attribution&utm_medium=referral&utm_campaign=music&utm_content=490663',
    },
  ];
  // Combat sound-effect credits (Stage 9.3). To register another contributor, add one entry:
  //   { scene: 'what it is used for', work: 'what they made', artist: 'Pixabay user name',
  //     url: 'optional profile link', source: 'Pixabay' }
  // They appear in the "Combat sound effects" list automatically. Rules: never invent a name, link or
  // license. The MP3s carry no embedded tags, so for now the artist is the Pixabay user name that
  // forms the start of each file name in assets/audio/ ("url" stays empty until the real Pixabay
  // profile link is confirmed; an entry without a url is shown as plain text).
  const SFX_CREDITS = [
    { scene: 'Blades and spells', work: 'sword slice, violent sword slice, sword clash hit, elemental spell impact (ice)', artist: 'dragon-studio', source: 'Pixabay' },
    { scene: 'Blades', work: 'swords', artist: 'magiaz', source: 'Pixabay' },
    { scene: 'Whooshes', work: 'whoosh and slash sounds, different pitches vol. 2', artist: 'ponjisk', source: 'Pixabay' },
    { scene: 'Blades, energy weapons and firearms', work: 'sword against sword; beam 8; sci-fi energy gun; M4 assault rifle long burst', artist: 'freesound_community', source: 'Pixabay' },
    { scene: 'Hand-to-hand and energy weapons', work: 'punch 03; sci-fi blaster shot', artist: 'universfield', source: 'Pixabay' },
    { scene: 'Energy weapons', work: 'short energy beam shot 3', artist: 'yodguard', source: 'Pixabay' },
    { scene: 'Energy weapons', work: 'plasma gun fire', artist: 'lordsonny', source: 'Pixabay' },
    { scene: 'Robots and machinery', work: 'sound design elements, robot mechanism 015 and 032', artist: 'audiopapkin', source: 'Pixabay' },
    { scene: 'Firearms', work: 'gun fire', artist: 'foisal72', source: 'Pixabay' },
    { scene: 'Firearms and explosions', work: 'auto gun shots; explosion FX', artist: 'soundreality', source: 'Pixabay' },
    { scene: 'Magic', work: 'magic boom FX', artist: 'asproductionmusic', source: 'Pixabay' },
    { scene: 'Creatures', work: 'edited dinosaur roars 15', artist: 'febixaj5', source: 'Pixabay' },
    { scene: 'Battle voices', work: 'hilarious yelling', artist: 'jimiwild', source: 'Pixabay' },
    { scene: 'Battle voices', work: 'army of soldiers battle cry', artist: 'jesuschristisgod', source: 'Pixabay' },
    { scene: 'Battle voices', work: 'male and female fighter voice attack grunts', artist: 'phatphrogstudio', source: 'Pixabay' },
    { scene: 'Battlefield ambience', work: 'angry mob loop', artist: 'freesound_community', source: 'Pixabay' },
    { scene: 'Battlefield ambience', work: 'brutal battle', artist: 'mavopix', source: 'Pixabay' },
    { scene: 'Battlefield ambience', work: 'WWII battle', artist: 'two_hats', source: 'Pixabay' },
  ];

  // What "Read Guide Aloud" says. Plain sentences, no URLs, symbols or ampersands, and no
  // periods inside abbreviations (the narrator splits on sentence punctuation). Keep this in
  // step with the visible text below when instructions change.
  const NARRATION = [
    'How to Play and About Battleground: Iron and Ember.',
    'Welcome to Battleground: Iron and Ember, an AI-powered fantasy combat game. You create the champions. The AI conducts and judges their battle.',
    'How to play.',
    'Step one, create a fighter. On the entry screen, type a name or a short description into each of the two fighter boxes, up to fifty characters each. A hero, a beast, a legend, or a whole group all count as one fighter. A trait or two, like armored elf archers, tells the Oracle more than a bare name. Original heroes, monsters, legends, historical figures and well-known characters are all welcome. Just use two different fighters.',
    'Step two, generate a portrait. You do not have to press anything extra. When a battle begins, AI paints a portrait for each fighter automatically, in a PG-13 comic-book style. If the portrait service declines a description, you are told which fighter and can reword it.',
    'Step three, enter the arena. Press Fight on the entry screen. Or open the BattleDex, choose two fighters, press Fight, and confirm.',
    'Step four, watch the battle. A battle scene plays while the Oracle weighs both fighters. You can cancel at any time. The arena allows five bouts per minute.',
    'Step five, receive the Oracle\'s Verdict. The Oracle always names one victor. The winner is crowned, the loser is marked Fallen, and a short written verdict explains why.',
    'Step six, build your BattleDex. Press Save to BattleDex under a portrait to keep that fighter in your browser, then reuse them in later battles. Two starter champions wait there on your first visit.',
    'Step seven, fight again. Choose Fight again for a fresh start, Rematch to replay the same two fighters, or tap a portrait to challenge that fighter with a new opponent.',
    'Audio controls.',
    'The speaker button in the bottom left corner opens the sound settings. Background music has its own volume slider, and it lowers itself while speech plays. Combat sound effects play while the Oracle deliberates, chosen to suit your fighters: blades for swordsmen, spells for wizards, roars for dragons, and so on. They stop when the verdict appears. Effects follow the sound mode: they are skipped in Voice only and Mute all. Spoken announcements and the Read verdict aloud button use your browser\'s voice.',
    'There are four audio modes: All audio, Voice only, Music and effects only, and Mute all. Speech works only in All audio or Voice only, and only in browsers that support speech. Sound begins after your first tap or key press, as browsers require.',
    'Technology behind the game.',
    'Battleground is built with HTML, CSS, and JavaScript, and was developed with the help of Claude Code. While you play, Anthropic\'s Claude judges the battles and tells their story, and OpenAI paints the fighter portraits. Your browser provides the sound effects, the narration voice, and the BattleDex storage. Vercel hosts the game, and Git and GitHub keep its version history.',
    'Creator credits.',
    'Created and developed by Studio Ryu, LLC. Studio Ryu provided the creative direction, interface design, front-end development, new features, AI-assisted development direction, testing, accessibility work, and production deployment. Battleground evolved from a free introductory Claude Code course project into an expanded, independently customized application.',
    'Music credits.',
    'Music by Ievgen Poltavskyi, also known as HitsLab, for the home screen. Music by Yevhen Astafiev for the BattleDex. Music by Alec Koff for judging and victory. All music is from Pixabay. Many combat sound effects are from Pixabay creators, listed in the credits section. The battle skirmish sounds and the victory fanfare are generated in your browser.',
    'That is the end of the guide. Close it any time to return to the arena.',
  ].join(' ');

  // ===== Small helpers =====
  const SEEN_KEY = 'battleground-guide-seen';
  const lsGet = () => {
    try {
      return localStorage.getItem(SEEN_KEY);
    } catch {
      return null;
    }
  };
  const lsSet = () => {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      // Not persisted (private mode / blocked storage): the pulse just stops for this page.
    }
  };

  const SVG_NS = 'http://www.w3.org/2000/svg';
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach((k) => k != null && el.append(k.nodeType ? k : document.createTextNode(k)));
    return el;
  }
  function icon(name, cls) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#' + name);
    svg.append(use);
    return svg;
  }
  function ext(href, text) {
    return h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text, h('span', { class: 'sr-only' }, ' (opens in a new tab)'));
  }
  const frame = (src, alt, extra) =>
    h('span', { class: 'mini-frame' + (extra ? ' ' + extra : '') }, h('img', { src, alt, width: '96', height: '96', loading: 'lazy', decoding: 'async' }));

  // ===== Pulse until first open =====
  if (!lsGet()) btn.classList.add('is-new');

  // Hover tooltip: WCAG 1.4.13, so Escape dismisses it without moving focus.
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') btn.classList.add('tip-off');
  });
  ['mouseleave', 'blur'].forEach((ev) => btn.addEventListener(ev, () => btn.classList.remove('tip-off')));

  // ===== Dialog =====
  let dialog = null;
  let scroller = null;
  let titleEl = null;
  let readBtn = null;
  let readNote = null;
  let readStatus = null;
  let reading = false;
  let inerted = [];

  // Illustrations: existing local assets and CSS/SVG only (no network, no image generation).
  const ART = {
    create: () =>
      h('div', { class: 'art art-form', 'aria-hidden': 'true' },
        h('span', { class: 'mini-input' }, 'A Red Dragon'),
        h('span', { class: 'mini-vs' }, 'VS'),
        h('span', { class: 'mini-input' }, 'Armored Elf Archers')),
    portrait: () =>
      h('div', { class: 'art' }, frame('assets/starters/red-dragon.webp', 'Example portrait of a fighter: a red dragon, painted by the AI', 'mini-frame-lg')),
    arena: () =>
      h('div', { class: 'art art-duel' },
        frame('assets/starters/red-dragon.webp', 'Portrait of A Red Dragon'),
        h('span', { class: 'mini-vs', 'aria-hidden': 'true' }, 'VS'),
        frame('assets/starters/navy-seals.webp', 'Portrait of A Squad of Navy SEALs')),
    watch: () => {
      const wrap = h('div', { class: 'art art-watch', 'aria-hidden': 'true' });
      wrap.innerHTML =
        '<svg viewBox="0 0 120 120" width="96" height="96" focusable="false"><circle cx="60" cy="60" r="56" fill="none" stroke="#8F7246" stroke-width="1.5"/><circle cx="60" cy="60" r="50" fill="none" stroke="#E2B65C" stroke-width="3" stroke-dasharray="2 8" stroke-linecap="round"/><circle cx="60" cy="60" r="38" fill="none" stroke="#E0714D" stroke-width="2.5" stroke-dasharray="8 6"/></svg>';
      wrap.append(icon('i-swords', 'art-watch-icon'));
      return wrap;
    },
    verdict: () =>
      h('div', { class: 'art art-verdict', 'aria-hidden': 'true' },
        h('span', { class: 'mini-crown' }, icon('i-crown')),
        frame('assets/starters/red-dragon.webp', ''),
        h('span', { class: 'mini-ribbon' }, 'Victor')),
    dex: () =>
      h('div', { class: 'art art-dex', 'aria-hidden': 'true' },
        frame('assets/starters/red-dragon.webp', '', 'mini-frame-sm'),
        frame('assets/starters/navy-seals.webp', '', 'mini-frame-sm'),
        h('span', { class: 'mini-save' }, icon('i-bookmark-plus'))),
    again: () =>
      h('div', { class: 'art art-again', 'aria-hidden': 'true' }, h('span', { class: 'mini-save' }, icon('i-rotate-ccw')), h('span', { class: 'mini-save' }, icon('i-swords'))),
  };

  const STEPS = [
    ['Create a fighter', 'create', 'On the entry screen, type a name or short description into each fighter box, Challenger I and Challenger II (up to 50 characters each). A hero, a beast, a legend or a whole group counts as one fighter. There are no separate stat fields, so the words you choose are everything the Oracle knows: “Armored Elf Archers” says more than “Elves”. Original heroes, monsters, legends, historical figures and well-known characters are all welcome. Just use two different fighters.'],
    ['Generate a portrait', 'portrait', 'There is nothing extra to press. When a battle begins, AI paints a portrait for each fighter automatically, so every bout gets fresh artwork. Portraits follow a PG-13 comic-book standard. If the portrait service declines a description, you are told which fighter and can reword it; nothing is swapped behind your back.'],
    ['Enter the arena', 'arena', 'Press Fight on the entry screen. Or open the BattleDex, choose two fighters and press Fight, then confirm “Sound the horn?”. The arena allows five bouts per minute.'],
    ['Watch the battle', 'watch', 'A battle scene plays while the Oracle weighs both fighters and writes the story of the clash. Press Cancel battle at any time to return to the entry screen with your names kept.'],
    ['Receive the Oracle’s Verdict', 'verdict', 'The Oracle always names exactly one victor, never a tie. The winner is crowned and marked Victor, the other is marked Fallen, and a short written verdict explains why.'],
    ['Build your BattleDex', 'dex', 'Press Save to BattleDex under a portrait to keep that fighter. Open the BattleDex from the header to search, preview, choose and delete saved fighters. Two starter champions wait there on your first visit. Saved fighters stay in this browser on this device.'],
    ['Fight again', 'again', 'Choose Fight again for a fresh start, Rematch to replay the same two fighters, or tap a portrait on the result screen to challenge that fighter with a new opponent.'],
  ];

  function section(id, title, ...content) {
    return h('section', { class: 'guide-section', 'aria-labelledby': id }, h('h3', { id, class: 'guide-h' }, title), content);
  }

  function techItem(name, what) {
    return h('li', null, h('strong', null, name), ' — ', what);
  }

  function build() {
    titleEl = h('h2', { id: 'guide-title', class: 'confirm-title', tabindex: '-1' }, 'How to Play & About');
    const closeTop = h('button', { type: 'button', class: 'guide-close', 'aria-label': 'Close guide' }, icon('i-x'), h('span', null, 'Close'));
    const top = h('div', { class: 'guide-top' }, titleEl, closeTop);

    readBtn = h('button', { type: 'button', class: 'guide-read', 'aria-describedby': 'guide-read-note' }, icon('i-volume-2'), h('span', { class: 'label' }, 'Read Guide Aloud'));
    readNote = h('p', { id: 'guide-read-note', class: 'guide-read-note', hidden: true });
    readStatus = h('p', { class: 'sr-only', role: 'status' });

    const steps = h('ol', { class: 'guide-steps', role: 'list' },
      STEPS.map(([title, art, text], i) =>
        h('li', { class: 'guide-step' },
          ART[art](),
          h('div', { class: 'step-text' },
            h('h4', { class: 'step-title' }, h('span', { class: 'step-num', 'aria-hidden': 'true' }, String(i + 1)), title),
            h('p', null, text)))));

    const audioList = h('ul', { class: 'guide-list' },
      h('li', null, h('strong', null, 'Settings. '), 'The round speaker button in the bottom-left corner opens the sound settings on every screen.'),
      h('li', null, h('strong', null, 'Background music. '), 'Each part of the game has its own theme. A “Background Music” slider (0–100%) sets its volume, and the music lowers itself while speech plays.'),
      h('li', null, h('strong', null, 'Combat sound effects. '), 'While the Oracle deliberates, battle sounds matched to your two fighters play: blades, punches, arrows, spells, roars, robots, gunfire and more. A fanfare sounds for the victor. The verdict is always written out in full, so nothing depends on hearing the sounds.'),
      h('li', null, h('strong', null, 'Speech narration. '), 'Announcements such as the start of a battle and the victor are spoken with your browser’s built-in voice.'),
      h('li', null, h('strong', null, 'Audio modes. '), h('em', null, 'All audio'), ' (everything), ', h('em', null, 'Voice only'), ' (speech, no music or effects), ', h('em', null, 'Music & effects only'), ' (no speech) and ', h('em', null, 'Mute all'), '.'),
      h('li', null, h('strong', null, 'Verdict narration. '), 'Under each verdict, ', h('em', null, 'Read verdict aloud'), ' reads the Oracle’s ruling on demand and can be stopped with the same button.'),
      h('li', null, h('strong', null, 'Good to know. '), 'Speech is only available in ', h('em', null, 'All audio'), ' or ', h('em', null, 'Voice only'), ' mode, and only in browsers that support speech synthesis. Sound starts after your first tap or key press, as browsers require.'));

    const tech = h('div', { class: 'tech-grid' },
      h('div', { class: 'tech-col' },
        h('h4', { class: 'guide-h2' }, 'Used to build the game'),
        h('ul', { class: 'guide-list' },
          techItem('HTML5, CSS3, JavaScript', 'frontend and interaction design'),
          techItem('Claude Code', 'AI-assisted development; it helped write the game but is not running while you play'),
          techItem('Git / GitHub', 'version control'))),
      h('div', { class: 'tech-col' },
        h('h4', { class: 'guide-h2' }, 'Running while you play'),
        h('ul', { class: 'guide-list' },
          techItem('Anthropic Claude API', 'AI combat judging and storytelling'),
          techItem('OpenAI API', 'AI-generated fighter portraits'),
          techItem('Web Audio API / Speech Synthesis', 'sound effects and narration, in your browser'),
          techItem('Browser localStorage', 'BattleDex persistence on your device'),
          techItem('Vercel / Node.js', 'hosting and server-side functions'))));

    const contributions = [
      'Original creative direction and game experience',
      'UI/UX design and visual customization',
      'Frontend development and integration',
      'Game functionality and feature expansion',
      'AI-assisted development direction and orchestration',
      'Testing, accessibility improvements and iterative refinement',
      'Production deployment',
    ];

    const musicList = h('ul', { class: 'credit-list' },
      MUSIC_CREDITS.map((c) =>
        h('li', null,
          h('span', { class: 'credit-scene' }, c.scene),
          h('span', { class: 'credit-line' }, 'Music by ', ext(c.url, c.artist), ' from ', ext(PIXABAY, 'Pixabay')))));

    const sfxBlock = SFX_CREDITS.length
      ? h('ul', { class: 'credit-list' },
          SFX_CREDITS.map((c) =>
            h('li', null,
              h('span', { class: 'credit-scene' }, c.scene || 'Sound effect'),
              h('span', { class: 'credit-line' }, (c.work ? c.work + ' by ' : 'By '), c.url ? ext(c.url, c.artist) : c.artist, c.source ? ' from ' + c.source : ''))))
      : h('p', null, 'The battle skirmish sounds and the victory fanfare are generated live in your browser with the Web Audio API, and narration uses your browser’s own voice.');

    const bodyEl = h('div', { class: 'guide-body' },
      h('div', { class: 'guide-read-row' }, readBtn, readNote, readStatus),
      section('guide-welcome', 'Welcome to Battleground: Iron & Ember',
        h('p', null, 'Battleground is an AI-powered fantasy combat game. You create the champions. The AI conducts their battle, judges it and tells the story, then paints a portrait of each side.')),
      section('guide-how', 'How to Play', steps),
      section('guide-audio', 'Audio Controls', audioList),
      section('guide-tech', 'Technology Behind the Game',
        h('p', null, 'Fighter names are sent to the AI services to judge the bout and paint the portraits. Saved fighters never leave your browser.'),
        tech),
      section('guide-creator', 'Creator Credits',
        h('p', { class: 'creator-line' }, 'Created and Developed by Studio-Ryu, LLC'),
        h('p', null, 'Studio-Ryu’s contributions:'),
        h('ul', { class: 'guide-list' }, contributions.map((c) => h('li', null, c))),
        h('p', null, 'Battleground evolved from a free introductory Claude Code course project into an expanded, independently customized application. The course starter was the foundation; the original starter project is not claimed as Studio-Ryu’s own work.')),
      section('guide-music', 'Music & Audio Credits',
        h('h4', { class: 'guide-h2' }, 'Background music'),
        musicList,
        h('h4', { class: 'guide-h2' }, 'Combat sound effects'),
        sfxBlock),
      h('div', { class: 'guide-foot' }, h('button', { type: 'button', class: 'primary guide-close guide-close-bottom' }, h('span', null, 'Close guide'))));

    const box = h('div', { class: 'confirm-box guide-box' }, top, bodyEl);
    scroller = box;
    dialog = h('div', { class: 'confirm guide-overlay', id: 'guide-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'guide-title', hidden: true }, box);
    document.body.append(dialog);

    dialog.querySelectorAll('.guide-close').forEach((b) => b.addEventListener('click', close));
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) close();
    });
    readBtn.addEventListener('click', onReadClick);
    syncRead();
  }

  function focusables() {
    return [...dialog.querySelectorAll('a[href], button:not([disabled])')].filter((el) => el.getClientRects().length > 0);
  }

  // Attached to the document only while the guide is open (added in open, removed in close), so
  // Escape and the Tab trap still work after a click on plain text leaves focus on <body>.
  function onKeydown(e) {
    if (!dialog || dialog.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusables();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === titleEl || !dialog.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  function open() {
    if (!dialog) build();
    lsSet();
    btn.classList.remove('is-new');
    // Everything outside the dialog becomes inert: no focus, clicks or screen-reader access.
    inerted = [...document.body.children].filter((el) => el !== dialog && el.tagName !== 'SCRIPT' && !el.inert);
    inerted.forEach((el) => (el.inert = true));
    document.body.classList.add('modal-open');
    readStatus.textContent = '';
    syncRead();
    dialog.hidden = false;
    document.addEventListener('keydown', onKeydown);
    scroller.scrollTop = 0;
    titleEl.focus({ preventScroll: true });
  }

  function close() {
    if (!dialog || dialog.hidden) return;
    if (reading) stopReading(); // never leave the guide talking after it is gone
    clearTimeout(announceTimer); // a pending "Stopped reading" must not surface after a reopen
    if (readStatus) readStatus.textContent = '';
    dialog.hidden = true;
    document.removeEventListener('keydown', onKeydown);
    inerted.forEach((el) => (el.inert = false));
    inerted = [];
    document.body.classList.remove('modal-open');
    btn.focus({ preventScroll: true });
  }

  btn.addEventListener('click', open);

  // ===== Read Guide Aloud =====
  const available = () => {
    try {
      return !!BGAudio.canNarrate();
    } catch {
      return false;
    }
  };
  const unavailableReason = () =>
    'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
      ? 'Narration is off in the current sound mode. Choose “All audio” or “Voice only” in the sound settings (speaker button) to hear the guide.'
      : 'Reading aloud is not supported in this browser.';

  let announceTimer = null;
  function announce(text) {
    if (!readStatus) return;
    readStatus.textContent = '';
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => {
      readStatus.textContent = text;
    }, 50); // re-set on the next tick so a repeated message is announced again
  }

  function syncRead() {
    if (!readBtn) return;
    const ok = available();
    if (!ok) reading = false;
    readBtn.setAttribute('aria-disabled', ok ? 'false' : 'true');
    readBtn.classList.toggle('is-unavailable', !ok);
    readBtn.classList.toggle('is-reading', reading);
    readBtn.querySelector('.label').textContent = reading ? 'Stop Reading Guide' : 'Read Guide Aloud';
    readBtn.querySelector('use').setAttribute('href', reading ? '#i-volume-x' : '#i-volume-2');
    readNote.textContent = ok ? '' : unavailableReason();
    readNote.hidden = ok;
  }

  function stopReading() {
    try {
      BGAudio.cancelSpeech(); // its callback resets the button
    } catch {
      reading = false;
      syncRead();
    }
  }

  function onReadClick() {
    if (reading) {
      stopReading();
      return;
    }
    if (!available()) {
      syncRead();
      announce(unavailableReason());
      return;
    }
    let started = false;
    try {
      started = BGAudio.narrate(NARRATION, (state) => {
        reading = false;
        syncRead();
        announce(
          state === 'end' ? 'Finished reading the guide.' : state === 'error' ? 'The guide could not be read aloud.' : 'Stopped reading the guide.'
        );
      });
    } catch {
      started = false;
    }
    if (!started) {
      syncRead();
      announce('The guide could not be read aloud.');
      return;
    }
    reading = true;
    syncRead();
    announce('Reading the guide aloud.');
  }

  BGSettings.onChange(syncRead);
})();
