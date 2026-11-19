/* Slate mockup runtime. Loaded at the end of <body> on every screen.

   What it does
   - Icons: injects one SVG sprite. Use <svg class="i" width="20" height="20" aria-hidden="true"><use href="#i-name"/></svg>.
   - Shell: fills <div class="bar" data-bar></div> and <nav class="nav" data-nav></nav> from attributes on <body>:
       data-shell="story | library | flow | bare"   which navigation the screen belongs to
       data-page="people"                            the current navigation item
       data-title="People"                           the title shown in the top bar on a phone
       data-sub="..."                                optional second line on a phone
       data-back="people.html"                       show a back arrow to this screen instead of the menu
       data-cost                                     show the cost of this turn in the bar (story screen only)
   - States: ?state=name in the URL sets body[data-state]. An element with data-show="a b" is visible only in
     states a and b. A control with data-go="name" switches state. Other URL parameters become body[data-key].
   - Choices: data-set="key=value" on a control sets body[data-key]; data-when="key=value" shows an element
     only while that holds. The control that matches gets .is-on and aria-pressed="true".
   - Modals: data-open="name" opens <div class="modal" data-modal="name">; data-close closes; ?open=name opens on load.
   - Small behaviours: theme (?theme=light, [data-theme-toggle]), dice ([data-die]), steppers (.stepper),
     switches (.switch), segmented controls (.seg), single-choice chips (.chips[data-single]).
*/
(function () {
  'use strict';
  var d = document, root = d.documentElement, body = d.body;
  var params = new URLSearchParams(window.__SEARCH__ != null ? window.__SEARCH__ : location.search);
  function each(sel, fn, scope) { [].forEach.call((scope || d).querySelectorAll(sel), fn); }
  function icon(name, size, cls) {
    return '<svg class="i' + (cls ? ' ' + cls : '') + '" width="' + (size || 20) + '" height="' + (size || 20) + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  }

  /* ---------- Theme ---------- */
  if (params.get('theme') === 'light') root.classList.add('theme-light');

  /* ---------- Icons ---------- */
  var F = ' fill="currentColor" stroke="none"';
  var ICONS = {
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    left: '<path d="m15 6-6 6 6 6"/>',
    right: '<path d="m9 6 6 6-6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    send: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
    more: '<circle cx="5.5" cy="12" r="1.4"' + F + '/><circle cx="12" cy="12" r="1.4"' + F + '/><circle cx="18.5" cy="12" r="1.4"' + F + '/>',
    story: '<path d="M12 6.5C10.4 5.3 8.2 4.7 5.5 4.7H4v13h1.5c2.7 0 4.9.6 6.5 1.8 1.6-1.2 3.8-1.8 6.5-1.8H20v-13h-1.5c-2.7 0-4.9.6-6.5 1.8ZM12 6.5v13"/>',
    people: '<circle cx="9.5" cy="8.2" r="3.2"/><path d="M3.5 19v-.8a4.2 4.2 0 0 1 4.2-4.2h3.6a4.2 4.2 0 0 1 4.2 4.2v.8M15.5 5.2a3.2 3.2 0 0 1 0 6M17.5 14.3a4.2 4.2 0 0 1 3 4V19"/>',
    person: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5.5 19.5v-.7a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v.7"/>',
    sheet: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10.6" r="1.9"/><path d="M6 16c.5-1.5 1.6-2.3 3-2.3s2.5.8 3 2.3M14.8 10h3M14.8 13.5h3"/>',
    journal: '<rect x="5" y="3.5" width="14" height="17" rx="2.2"/><path d="M9 3.5v17M12.5 8.2H16M12.5 11.8H16"/>',
    map: '<path d="m9 4.5-5 2v13l5-2 6 2 5-2v-13l-5 2-6-2ZM9 4.5v13M15 6.5v13"/>',
    home: '<path d="M4 10.5 12 4l8 6.5V20h-5.5v-5.5h-5V20H4v-9.5Z"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.9 5.2 3.9 8.5s-1.3 6.1-3.9 8.5c-2.6-2.4-3.9-5.2-3.9-8.5s1.3-6.1 3.9-8.5Z"/>',
    chart: '<path d="M4.5 19.5h15M7.5 16v-5M12 16V6.5M16.5 16v-8"/>',
    sliders: '<path d="M4 7.5h9M18 7.5h2M4 16.5h3M12 16.5h8"/><circle cx="15.5" cy="7.5" r="2.3"/><circle cx="9.5" cy="16.5" r="2.3"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z"/>',
    bolt: '<path d="M13 3 5.5 13.5h5.8L10.5 21l8-11h-5.8L13 3Z"/>',
    gem: '<path d="M12 3.2 19.6 12 12 20.8 4.4 12Z"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>',
    spark: '<path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3Z"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r="1.2"' + F + '/><circle cx="15" cy="15" r="1.2"' + F + '/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
    chat: '<path d="M20 12a7.6 7.6 0 0 1-11.3 6.6L4.5 19.5l1-3.9A7.6 7.6 0 1 1 20 12Z"/>',
    sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18"/>',
    moon: '<path d="M19.5 14.2A7.8 7.8 0 0 1 9.8 4.5a7.8 7.8 0 1 0 9.7 9.7Z"/>',
    dusk: '<path d="M3 17h18M7.5 20.5h9M6.5 17a5.5 5.5 0 0 1 11 0M12 6v2.2M4.6 10.2l1.6 1.4M19.4 10.2l-1.6 1.4"/>',
    pin: '<path d="M12 20.5s6.3-5.4 6.3-10.2a6.3 6.3 0 1 0-12.6 0c0 4.8 6.3 10.2 6.3 10.2Z"/><circle cx="12" cy="10.2" r="2.2"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.2"/><circle cx="12" cy="12" r="1"' + F + '/>',
    flag: '<path d="M6 21V4M6 5h11l-2.2 3.5L17 12H6"/>',
    compass: '<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/>',
    key: '<circle cx="8" cy="15" r="3.8"/><path d="m10.8 12.2 8.2-8.2M16 7l2.5 2.5M13.8 9.2l2 2"/>',
    lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2.2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    eye: '<path d="M2.8 12S6.2 6 12 6s9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6Z"/><circle cx="12" cy="12" r="2.8"/>',
    'eye-off': '<path d="M4 4l16 16M9.9 6.3A9 9 0 0 1 12 6c5.800 0 9.2 6 9.2 6a15 15 0 0 1-2.9 3.5M6.2 8.100A15 15 0 0 0 2.8 12S6.2 18 12 18c1.300 0 2.500-.3 3.600-.8M9.900 10a2.800 2.800 0 0 0 4 4"/>',
    edit: '<path d="M4.5 19.5h4l10-10-4-4-10 10v4ZM13 7l4 4"/>',
    trash: '<path d="M5 7h14M9.5 7V4.8h5V7M7 7l.8 12.2h8.4L17 7M10 10.5v5.5M14 10.5v5.5"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M5.5 15.5h-.3a1.700 1.700 0 0 1-1.700-1.700V5.200a1.700 1.700 0 0 1 1.700-1.700h8.600a1.700 1.700 0 0 1 1.700 1.700v.3"/>',
    download: '<path d="M12 4v11M7.5 10.5 12 15l4.500-4.500M5 19.500h14"/>',
    upload: '<path d="M12 15V4M7.500 8.500 12 4l4.500 4.500M5 19.500h14"/>',
    refresh: '<path d="M19 12a7 7 0 1 1-2.100-5M19 5v4.200h-4.200"/>',
    undo: '<path d="M8 7 4 11l4 4M4 11h10a5 5 0 0 1 0 10h-3"/>',
    play: '<path d="M8 5.500v13l10.500-6.500L8 5.500Z"/>',
    filter: '<path d="M4 6h16l-6.200 7.200v5.300l-3.600-1.800v-3.500L4 6Z"/>',
    doc: '<path d="M7 3.500h7l4 4.500V20a.500.500 0 0 1-.500.500h-11A.500.500 0 0 1 6 20V4.500a1 1 0 0 1 1-1ZM14 3.500V8h4M9.500 12.500h5M9.500 16h5"/>',
    info: '<circle cx="12" cy="12" r="8.500"/><path d="M12 11v5.500M12 7.800v.2"/>',
    warn: '<path d="M12 4.200 20.500 19h-17L12 4.200ZM12 10v4.200M12 16.600v.2"/>',
    'ok-circle': '<circle cx="12" cy="12" r="8.500"/><path d="m8.200 12.300 2.700 2.700 5-5.500"/>',
    'x-circle': '<circle cx="12" cy="12" r="8.500"/><path d="m9 9 6 6M15 9l-6 6"/>',
    offline: '<path d="M4 4l16 16M3.500 9.500a13 13 0 0 1 3.600-2.400M10.500 5.600A13 13 0 0 1 20.500 9.500M6.800 13a8 8 0 0 1 2.400-1.600M14.800 11.400c.9.400 1.700 1 2.400 1.600M12 18.200v.2"/>',
    coins: '<ellipse cx="12" cy="7.500" rx="6.500" ry="3"/><path d="M5.500 7.500V12c0 1.700 2.900 3 6.500 3s6.500-1.300 6.500-3V7.500M5.500 12v4.500c0 1.700 2.900 3 6.500 3s6.500-1.300 6.500-3V12"/>',
    sword: '<path d="M19.500 4.500h-4l-8.500 8.500 4 4 8.500-8.500v-4ZM5.500 12.500l6 6M4.500 19.500l3-3"/>',
    shield: '<path d="M12 3.500 5 6.200v5.300c0 4.200 2.900 7.300 7 9 4.100-1.700 7-4.800 7-9V6.200l-7-2.700Z"/>',
    flask: '<path d="M9.500 3.500h5M10.500 3.500V9l-5.300 9a1.700 1.700 0 0 0 1.500 2.500h10.600a1.700 1.700 0 0 0 1.500-2.500L13.500 9V3.500M7.800 14.500h8.400"/>',
    bag: '<path d="M8.500 7V5.800a3.500 3.500 0 0 1 7 0V7M6.500 7h11a2 2 0 0 1 2 2v9.500a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2ZM9 13h6"/>'
  };
  var sprite = '<svg width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute"><defs>';
  Object.keys(ICONS).forEach(function (k) { sprite += '<symbol id="i-' + k + '" viewBox="0 0 24 24">' + ICONS[k] + '</symbol>'; });
  body.insertAdjacentHTML('afterbegin', sprite + '</defs></svg>');

  /* ---------- Shell: top bar and navigation ---------- */
  var STORY = { title: 'The Glass Road', chapter: 'Chapter 2 · “Borrowed Seals” · Scene 4', place: 'Lantern Market', time: 'Dusk', day: 'Day 12', turn: '$0.006', session: '$0.21', narrator: 'Sonnet 5.5' };
  var NAV = {
    story: [['story', 'Story', 'play.html', 'story'], ['people', 'People', 'people.html', 'people'], ['character', 'Character', 'character.html', 'sheet'], ['journal', 'Journal', 'journal.html', 'journal'], ['map', 'Map', 'map.html', 'map'], ['settings', 'Settings', 'settings.html', 'sliders', 'tab-set']],
    library: [['stories', 'Stories', 'home.html', 'home'], ['worlds', 'Worlds', 'worlds.html', 'globe'], ['usage', 'Usage', 'usage.html', 'chart'], ['settings', 'Settings', 'settings.html', 'sliders']]
  };
  var shell = body.getAttribute('data-shell') || 'library';
  var page = body.getAttribute('data-page') || '';
  var title = body.getAttribute('data-title') || '';
  var sub = body.getAttribute('data-sub');
  var back = body.getAttribute('data-back');
  var themeBtn = '<button class="ib" data-theme-toggle aria-label="Switch between dark and light theme">' + icon('sun', 20, 't-sun') + icon('moon', 20, 't-moon') + '</button>';
  var brand = '<a class="brand" href="home.html"><span class="logo" aria-hidden="true">' + icon('spark', 16, 'i-f') + '</span><span>Bitor Quest</span></a>';

  each('[data-bar]', function (bar) {
    var html = '';
    if (shell === 'story') {
      html += back
        ? '<a class="ib menu" href="' + back + '" aria-label="Back">' + icon('left', 22) + '</a>'
        : '<a class="ib menu" href="home.html" aria-label="Menu: back to your stories">' + icon('menu', 22) + '</a>';
      html += brand + '<div class="bar-mid"><div class="titles">'
        + '<h1 class="story-title"><span class="world" aria-hidden="true"></span><span class="only-phone">' + title + '</span><span class="only-desktop">' + STORY.title + '</span></h1>'
        + '<p class="sub sub-place">' + (sub != null ? '<span>' + sub + '</span>' : icon('dusk', 14, 'i-s') + '<span>' + STORY.place + ' · ' + STORY.time + ' · ' + STORY.day + '</span>') + '</p>'
        + '<p class="sub sub-chapter">' + STORY.chapter + '</p></div>'
        + '<p class="place">' + icon('pin', 16) + STORY.place + ' <span class="dot" aria-hidden="true">·</span> ' + icon('dusk', 16) + STORY.time + ' <span class="dot" aria-hidden="true">·</span> ' + STORY.day + '</p></div>'
        + '<div class="bar-end">'
        + (body.hasAttribute('data-cost') ? '<div class="cost-chip" title="Cost of this turn"><span class="cost-k">Turn</span>' + STORY.turn + '</div>' : '')
        + '<dl class="cost" aria-label="Cost meter"><div><dt>This turn</dt><dd>' + STORY.turn + '</dd></div><div><dt>Session</dt><dd>' + STORY.session + '</dd></div><div><dt>Narrator</dt><dd>' + STORY.narrator + '</dd></div></dl>'
        + themeBtn + '</div>';
    } else if (shell === 'library') {
      html += (back ? '<a class="ib menu" href="' + back + '" aria-label="Back">' + icon('left', 22) + '</a>' : '<span class="logo only-phone" aria-hidden="true">' + icon('spark', 16, 'i-f') + '</span>')
        + brand + '<div class="bar-mid"><div class="titles"><h1 class="story-title"><span>' + title + '</span></h1>'
        + (sub != null ? '<p class="sub"><span>' + sub + '</span></p>' : '') + '</div></div>'
        + '<div class="bar-end">' + themeBtn + '</div>';
    } else { /* flow */
      html += '<a class="ib" href="' + (back || 'home.html') + '" aria-label="' + (body.getAttribute('data-back-label') || 'Close') + '">' + icon(body.hasAttribute('data-back-arrow') ? 'left' : 'x', 22) + '</a>'
        + '<div class="bar-mid"><div class="titles"><h1 class="story-title"><span>' + title + '</span></h1>'
        + (sub != null ? '<p class="sub"><span>' + sub + '</span></p>' : '') + '</div></div>'
        + '<div class="bar-end">' + themeBtn + '</div>';
    }
    bar.innerHTML = html;
  });

  each('[data-nav]', function (nav) {
    var items = NAV[shell];
    if (!items) return;
    nav.setAttribute('aria-label', 'Primary');
    nav.innerHTML = items.map(function (it) {
      return '<a class="tab' + (it[4] ? ' ' + it[4] : '') + '" href="' + it[2] + '" data-nav-item="' + it[0] + '"' + (it[0] === page ? ' aria-current="page"' : '') + '>'
        + '<span class="tab-i">' + icon(it[3], 22) + '</span>' + it[1] + '</a>';
    }).join('');
  });

  /* ---------- States and choices ---------- */
  // An element is shown when its state (data-show) and its choice (data-when) both allow it.
  // The hidden attribute is used, not the property, so that this also works on SVG elements.
  function reveal() {
    var s = body.getAttribute('data-state') || '';
    each('[data-show],[data-when]', function (el) {
      var show = el.getAttribute('data-show'), when = el.getAttribute('data-when'), ok = true;
      if (show != null) ok = show.split(/\s+/).indexOf(s) >= 0;
      if (ok && when != null) { var kv = when.split('='); ok = body.getAttribute('data-' + kv[0]) === kv[1]; }
      el.toggleAttribute('hidden', !ok);
    });
  }
  function setState(s) {
    body.setAttribute('data-state', s);
    reveal();
    each('[data-go]', function (el) {
      var on = el.getAttribute('data-go') === s;
      if (el.closest('.tabs')) el.setAttribute('aria-selected', on);
      if (el.closest('.seg')) el.setAttribute('aria-pressed', on);
    });
    try { window.dispatchEvent(new CustomEvent('slate:state', { detail: s })); } catch (e) {}
  }
  function applyChoices() {
    reveal();
    each('[data-set]', function (el) {
      var kv = el.getAttribute('data-set').split('=');
      var on = body.getAttribute('data-' + kv[0]) === kv[1];
      el.classList.toggle('is-on', on);
      el.setAttribute('aria-pressed', on);
    });
  }
  params.forEach(function (v, k) { if (k !== 'state' && k !== 'theme' && k !== 'open') body.setAttribute('data-' + k, v); });
  var state = params.get('state') || body.getAttribute('data-state') || '';
  if (d.querySelector('[data-show]') || d.querySelector('[data-go]')) setState(state);
  else if (state && !body.hasAttribute('data-state')) body.setAttribute('data-state', state);
  applyChoices();

  /* ---------- Modals ---------- */
  function modal(name, open) {
    each('.modal', function (m) { m.classList.toggle('is-open', !!open && m.getAttribute('data-modal') === name); });
    each('.modal-scrim', function (s) { s.classList.toggle('is-open', !!open); });
  }
  if (params.get('open')) modal(params.get('open'), true);

  /* ---------- Dice ---------- */
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function roll(die) {
    if (!die || die._rolling || reduced) return;
    var card = die.closest('.check'), face = die.getAttribute('data-face'), n = 0;
    if (card) card.classList.add('is-rolling');
    die.classList.remove('tumble'); void die.offsetWidth; die.classList.add('tumble');
    die._rolling = setInterval(function () {
      n += 1;
      if (n < 8) { die.setAttribute('data-face', 1 + Math.floor(Math.random() * 6)); return; }
      clearInterval(die._rolling); die._rolling = null;
      die.setAttribute('data-face', face);
      if (card) { card.classList.remove('is-rolling'); card.classList.add('is-landed'); }
      setTimeout(function () { if (card) card.classList.remove('is-landed'); die.classList.remove('tumble'); }, 400);
    }, 85);
  }
  setTimeout(function () { each('[data-die][data-autoroll]', roll); }, 1400);

  /* ---------- Clicks ---------- */
  d.addEventListener('click', function (e) {
    var t = e.target, el;
    if (t.closest('[data-theme-toggle]')) root.classList.toggle('theme-light');
    if ((el = t.closest('[data-die]'))) roll(el);
    if ((el = t.closest('[data-go]'))) {
      e.preventDefault();
      setState(el.getAttribute('data-go'));
      if (!el.closest('.tabs')) each('.page', function (p) { p.scrollTop = 0; });
    }
    if ((el = t.closest('[data-set]'))) {
      var kv = el.getAttribute('data-set').split('=');
      body.setAttribute('data-' + kv[0], kv[1]);
      applyChoices();
    }
    if ((el = t.closest('[data-open]'))) { e.preventDefault(); modal(el.getAttribute('data-open'), true); }
    else if (t.closest('[data-close]') || t.classList.contains('modal-scrim')) modal('', false);
    if ((el = t.closest('.switch'))) el.setAttribute('aria-checked', el.getAttribute('aria-checked') !== 'true');
    if ((el = t.closest('.seg button')) && !el.hasAttribute('data-set')) {
      each('button', function (b) { b.setAttribute('aria-pressed', b === el); }, el.parentNode);
    }
    if ((el = t.closest('.chips[data-single] .chip'))) {
      each('.chip', function (c) { c.setAttribute('aria-pressed', c === el); }, el.parentNode);
    }
    if ((el = t.closest('.stepper button'))) {
      var box = el.closest('.stepper'), out = box.querySelector('b');
      var min = Number(box.getAttribute('data-min') || 0), max = Number(box.getAttribute('data-max') || 5);
      var v = Math.max(min, Math.min(max, Number(out.textContent) + Number(el.getAttribute('data-step') || 0)));
      out.textContent = v;
      each('button', function (b) { var s = Number(b.getAttribute('data-step')); b.disabled = (s < 0 && v <= min) || (s > 0 && v >= max); }, box);
      try { box.dispatchEvent(new CustomEvent('slate:step', { bubbles: true, detail: v })); } catch (err) {}
    }
  });
  d.addEventListener('keydown', function (e) { if (e.key === 'Escape') modal('', false); });

  window.Slate = { params: params, state: function () { return body.getAttribute('data-state') || ''; }, setState: setState, icon: icon, roll: roll, modal: modal };
})();
