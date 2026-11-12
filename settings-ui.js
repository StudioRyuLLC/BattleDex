// Stage 8 settings control: floating speaker button (bottom-left) + accessible dialog.
(function () {
  const AUDIO_OPTIONS = [
    ['all', 'All audio', 'Music, combat sounds, victory fanfare and spoken announcements'],
    ['voice', 'Voice only', 'Spoken announcements, no music or sound effects'],
    ['music', 'Music & effects only', 'No spoken announcements'],
    ['mute', 'Mute all', 'No sound at all'],
  ];
  const MOTION_OPTIONS = [
    ['animated', 'Animated fighter', 'Character animation when available, otherwise cinematic effects'],
    ['css', 'Cinematic effects', 'Glow, embers and dramatic reveals on the fighter art'],
    ['none', 'No victory animation', 'Static artwork, no nonessential motion'],
  ];

  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'settings-fab';
  fab.setAttribute('aria-label', 'Sound and animation settings');
  fab.setAttribute('aria-haspopup', 'dialog');
  document.body.append(fab);

  function refreshFab() {
    const muted = BGSettings.get().audio === 'mute';
    fab.replaceChildren(makeIcon(muted ? 'volume-x' : 'volume-2'));
    fab.title = muted ? 'Sound: muted' : 'Sound settings';
  }

  function radioGroup(name, legend, options, current) {
    const set = document.createElement('fieldset');
    set.className = 'settings-group';
    const lg = document.createElement('legend');
    lg.textContent = legend;
    set.append(lg);
    options.forEach(([value, label, hint]) => {
      const row = document.createElement('label');
      row.className = 'settings-option';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = name;
      input.value = value;
      input.checked = value === current;
      const text = document.createElement('span');
      const strong = document.createElement('strong');
      strong.textContent = label;
      const small = document.createElement('small');
      small.textContent = hint;
      text.append(strong, small);
      row.append(input, text);
      set.append(row);
    });
    return set;
  }

  const dialog = document.createElement('div');
  dialog.className = 'confirm';
  dialog.id = 'settings-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'settings-title');
  dialog.hidden = true;
  document.body.append(dialog);

  const backgroundEls = () => [
    document.querySelector('.site-header'),
    document.querySelector('main'),
    document.querySelector('.version-switch'),
    document.querySelector('.foot'),
  ];

  function build() {
    const s = BGSettings.get();
    const box = document.createElement('div');
    box.className = 'confirm-box settings-box';
    const title = document.createElement('h2');
    title.id = 'settings-title';
    title.className = 'confirm-title';
    title.textContent = 'Arena settings';
    const note = document.createElement('p');
    note.className = 'settings-note';
    note.textContent = 'Sound starts after your first tap or key press, as browsers require.';
    const audio = radioGroup('audio', 'Sound', AUDIO_OPTIONS, s.audio);
    const motion = radioGroup('animation', 'Victory animation', MOTION_OPTIONS, BGSettings.motion());
    const reduced = document.createElement('p');
    reduced.className = 'settings-note';
    reduced.textContent =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'Your device asks for reduced motion, so animation starts off. Choose an option to override it.'
        : '';
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'primary';
    done.id = 'settings-done';
    done.textContent = 'Done';
    box.append(title, note, audio, motion, reduced, done);
    dialog.replaceChildren(box);
    audio.addEventListener('change', (e) => BGSettings.set({ audio: e.target.value }));
    motion.addEventListener('change', (e) => BGSettings.set({ animation: e.target.value }));
    done.addEventListener('click', close);
  }

  function open() {
    build();
    backgroundEls().forEach((el) => el && (el.inert = true));
    document.body.classList.add('modal-open');
    dialog.hidden = false;
    dialog.querySelector('input:checked').focus();
  }

  function close() {
    dialog.hidden = true;
    backgroundEls().forEach((el) => el && (el.inert = false));
    document.body.classList.remove('modal-open');
    fab.focus({ preventScroll: true });
  }

  fab.addEventListener('click', open);
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll('input, button')].filter((el) => !el.disabled);
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  BGSettings.onChange(refreshFab);
  refreshFab();
})();
