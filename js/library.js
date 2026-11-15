/* Michael Yoto Maker — Find audio panel.
 *
 * Search public-domain catalogues (LibriVox, Internet Archive), check what your
 * library has on Libby, download + prepare + publish. Library loans are
 * search-and-open only: the panel deep-links into Libby, and any file you
 * already have on disk goes in through "Add my own files".
 */
(function (YM) {
  'use strict';

  const $ = YM.$;
  const esc = YM.esc;
  const S = {
    open: false,
    query: '',
    filter: 'all',
    results: null,
    hoopla: undefined,
    loading: false,
    error: '',
    jobs: [],
    config: null,
    expanded: {},
    pollTimer: null,
    note: '',
    busy: {},
    saved: [],
    queueFolded: false,
  };

  const SRC_LABEL = {
    librivox: 'LibriVox',
    archive: 'Internet Archive',
    abb: 'AudioBookBay',
    mam: 'MyAnonamouse',
    overdrive: 'Libby',
    local: 'My files',
  };

  // Sources that need a debrid account: their rows live in their own
  // section and make a card through the torrent → provider path.
  const ACCOUNT_SOURCES = ['abb', 'mam'];

  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

  // Ported from the audiobook player: off / end of chapter / N minutes.
  const SLEEP_CHOICES = [
    { value: 0, label: 'Sleep: off' },
    { value: -1, label: 'Sleep: end of chapter' },
    { value: 15, label: 'Sleep: 15 min' },
    { value: 30, label: 'Sleep: 30 min' },
    { value: 45, label: 'Sleep: 45 min' },
    { value: 60, label: 'Sleep: 60 min' },
  ];

  const HOOPLA_KIND = {
    audiobook: 'Audiobook',
    ebook: 'Ebook',
    comic: 'Comic',
    music: 'Music',
    video: 'Video',
  };

  const PROVIDER_LABEL = {
    torbox: 'TorBox',
    premiumize: 'Premiumize',
  };

  /* hoopla's audiobooks only play in hoopla's own player, so they can never
   * feed this app's <audio> element. Libby's player is just a page and does run
   * inside the panel. So when a hoopla title also lives at the user's library,
   * the card leads with the Libby copy — that is the one that actually plays
   * in here. */

  function titleKey(text) {
    return String(text || '')
      .toLowerCase()
      .split(':')[0]
      .replace(/\(.*?\)/g, ' ')
      .replace(/\b(a novel|unabridged|audiobook)\b/g, ' ')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^(the|a|an)\s+/, '');
  }

  function authorKey(text) {
    const words = String(text || '')
      .toLowerCase()
      .replace(/[^a-z ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);
    return words.sort((a, b) => b.length - a.length)[0] || '';
  }

  /** The Libby result for a hoopla title, when the library has the audiobook. */
  function libbyTwin(item) {
    const library = (S.results && S.results.library) || [];
    if (!library.length || (item.mediaType || '') !== 'audiobook') return null;
    const key = titleKey(item.title);
    if (!key) return null;
    const same = library.filter(
      (r) => (r.mediaType || '') === 'audiobook' && titleKey(r.title) === key
    );
    if (!same.length) return null;
    const who = authorKey(item.author);
    const byAuthor = who ? same.filter((r) => authorKey(r.author) === who) : [];
    return (byAuthor.length ? byAuthor : same)[0];
  }

  function api(path, opts) {
    return fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts))
      .then(async (res) => {
        const text = await res.text();
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { error: text.slice(0, 200) }; }
        if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
        return data;
      });
  }

  function fmtDur(seconds) {
    const s = Math.round(Number(seconds) || 0);
    if (!s) return '';
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
  }

  function fmtSize(bytes) {
    const n = Number(bytes) || 0;
    if (!n) return '';
    if (n > 1024 * 1024 * 1024) return (n / 1073741824).toFixed(1) + ' GB';
    return Math.max(1, Math.round(n / 1048576)) + ' MB';
  }

  /* ------------------------------------------------------------------ */
  /* shell                                                              */
  /* ------------------------------------------------------------------ */

  function build() {
    if ($('#libPanel')) return;
    const panel = document.createElement('div');
    panel.id = 'libPanel';
    panel.className = 'lib-panel hidden';
    panel.innerHTML = `
      <div class="lib-inner">
        <header class="lib-head">
          <div class="lib-title">
            <h1>Build a card from an audiobook</h1>
            <p>Search free catalogues, check your library, then download, split, tag and publish.</p>
          </div>
          <div class="lib-head-actions">
            <button class="btn" id="libImport" title="Add audio files you already have on this PC">
              <svg viewBox="0 0 24 24" width="15" height="15"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Add my own files
            </button>
            <button class="iconbtn" id="libSettings" title="Settings" aria-label="Settings">
              <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            </button>
            <button class="iconbtn" id="libClose" title="Close (Esc)" aria-label="Close">
              <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>
            </button>
          </div>
        </header>

        <div class="lib-searchbar">
          <svg class="lib-searchicon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.4" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16 16 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <input id="libQuery" type="search" spellcheck="false" autocomplete="off"
                 placeholder="Title or author — e.g. The Wind in the Willows">
          <button class="btn primary" id="libGo">Search</button>
        </div>

        <div class="lib-filters" id="libFilters">
          <button class="chip on" data-filter="all">All sources</button>
          <button class="chip" data-filter="own">Free downloads</button>
          <button class="chip" data-filter="accounts">Your accounts</button>
          <button class="chip" data-filter="saved" id="libSavedChip">Saved</button>
          <button class="chip" data-filter="library">My library</button>
          <span class="lib-hint" id="libHint"></span>
        </div>

        <div class="lib-columns" id="libColumns">
          <section class="lib-results" id="libResults"></section>
          <button class="queue-arrow" id="libQueueArrow" title="Hide the queue" aria-label="Hide the queue">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5.5 15.5 12 9 18.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <aside class="lib-queue" id="libQueue">
            <div class="lib-queue-head">
              <span>Queue</span>
              <span class="muted" id="libQueueCount"></span>
            </div>
            <div id="libJobs" class="lib-jobs"></div>
          </aside>
        </div>

        <div class="lib-embed hidden" id="libEmbed">
          <div class="lib-embed-bar">
            <strong id="libEmbedTitle">Library</strong>
            <span class="lib-embed-note">Search, borrow and listen without leaving this app</span>
            <span class="lib-embed-spacer"></span>
            <button class="btn small" id="libEmbedBack">Back</button>
            <button class="btn small" id="libEmbedExternal">Pop out</button>
            <button class="iconbtn" id="libEmbedClose" title="Close (Esc)" aria-label="Close">
              <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>
            </button>
          </div>
          <iframe id="libEmbedFrame" class="lib-embed-frame" src="about:blank"
                  allow="autoplay; encrypted-media; fullscreen; clipboard-write"
                  referrerpolicy="no-referrer"></iframe>
        </div>

        <div class="player hidden" id="libPlayer">
          <div class="pl-controls">
            <button class="pl-btn" id="plPrev" title="Previous track" aria-label="Previous track">
              <svg viewBox="0 0 24 24"><path d="M18 6v12L9 12l9-6ZM6 5v14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"/></svg>
            </button>
            <button class="pl-btn play" id="plToggle" title="Play / pause" aria-label="Play">
              <svg viewBox="0 0 24 24" class="ic-play"><path d="M8 5.5v13l10-6.5-10-6.5Z" fill="currentColor"/></svg>
              <svg viewBox="0 0 24 24" class="ic-pause"><path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor"/></svg>
            </button>
            <button class="pl-btn" id="plNext" title="Next track" aria-label="Next track">
              <svg viewBox="0 0 24 24"><path d="M6 6v12l9-6-9-6ZM18 5v14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"/></svg>
            </button>
            <button class="pl-btn rec" id="plRec" title="Record what is playing" aria-label="Record what is playing">
              <svg viewBox="0 0 24 24" class="ic-rec"><circle cx="12" cy="12" r="6" fill="currentColor"/></svg>
              <svg viewBox="0 0 24 24" class="ic-stop"><rect x="7" y="7" width="10" height="10" rx="1.8" fill="currentColor"/></svg>
            </button>
            <button class="pl-btn" id="plChapters" title="Chapters / files (C)" aria-label="Chapters">
              <svg viewBox="0 0 24 24"><path d="M4 6.5h16M4 12h16M4 17.5h10" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>
            </button>
            <button class="pl-btn pl-rate" id="plSpeed" title="Playback speed" aria-label="Playback speed">1×</button>
            <button class="pl-btn" id="plSleep" title="Sleep timer" aria-label="Sleep timer">
              <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5V12l3 1.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            </button>
          </div>
          <div class="pl-menu hidden" id="plMenu" role="menu"></div>
          <div class="pl-meta">
            <div class="pl-title" id="plTitle">Nothing playing</div>
            <div class="pl-sub" id="plSub"></div>
          </div>
          <div class="pl-scrub">
            <input type="range" id="plSeek" min="0" max="1000" value="0" step="1" aria-label="Seek">
          </div>
          <div class="pl-recbadge" id="plRecBadge" title="Recording — press the red button to stop">
            <span class="dot" aria-hidden="true"></span><span id="plRecTime">0:00</span>
          </div>
          <div class="pl-time" id="plTime">0:00 / 0:00</div>
          <button class="pl-btn pl-close" id="plClose" title="Stop" aria-label="Stop and close player">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="pl-menu hidden" id="libMenu" role="menu"></div>
      </div>`;
    document.body.appendChild(panel);

    $('#libClose').addEventListener('click', () => close());
    $('#libEmbedClose').addEventListener('click', closeLibraryEmbed);
    $('#libEmbedExternal').addEventListener('click', () => {
      if (embedUrl) window.open(embedUrl, '_blank', 'noopener');
    });
    $('#libEmbedBack').addEventListener('click', () => {
      if (!embedHome) return;
      const frame = $('#libEmbedFrame');
      // Already home: Back means leave the library.
      if (frame.src === embedHome) { closeLibraryEmbed(); return; }
      frame.src = embedHome;
      embedUrl = embedHome;
    });
    $('#libGo').addEventListener('click', () => runSearch());
    $('#libQuery').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
      e.stopPropagation();
    });
    $('#libImport').addEventListener('click', importLocal);
    $('#libSettings').addEventListener('click', openSettings);
    $('#libFilters').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-filter]');
      if (!chip) return;
      S.filter = chip.dataset.filter;
      YM.$$('#libFilters .chip').forEach((c) => c.classList.toggle('on', c === chip));
      renderResults();
    });
    bindPlayer();
    const queueArrow = $('#libQueueArrow');
    if (queueArrow) queueArrow.addEventListener('click', () => toggleQueue());
  }

  function open() {
    build();
    const panel = $('#libPanel');
    panel.classList.remove('hidden');
    S.open = true;
    YM.App.exitCrop && YM.App.exitCrop();
    refreshConfig().then(() => {
      renderResults();
      renderHint();
    });
    refreshJobs();
    refreshSaved();
    startPolling();
    setTimeout(() => {
      const input = $('#libQuery');
      if (input && !input.value) input.focus();
    }, 40);
  }

  function close() {
    if (!S.open) return;
    const panel = $('#libPanel');
    if (panel) panel.classList.add('hidden');
    S.open = false;
    stopPolling();
    // Finish any take first: closing the panel hides the only stop button.
    if (R.recorder) stopRecording();
    // Pause rather than keep playing behind the editor, where there is no
    // visible control to stop it.
    if (P.audio && !P.audio.paused) P.audio.pause();
    // The embedded library player keeps its own audio; tearing the frame
    // down is the only way to stop it when the panel closes.
    closeLibraryEmbed();
  }

  /* ------------------------------------------------------------------ */
  /* in-app library browser (Libby / hoopla)                            */
  /* ------------------------------------------------------------------ */

  let embedUrl = '';
  let embedHome = '';

  // A framed library is a different origin, so its `history` is unreadable and
  // untouchable. "Back" therefore steps out to the provider's own landing
  // screen (and closes the embed when we are already there) rather than
  // silently doing nothing.
  function providerHome(url) {
    try {
      const parsed = new URL(url);
      if (/(^|\.)libbyapp\.com$/i.test(parsed.hostname)) {
        const slug = S.config && S.config.library && S.config.library.slug;
        return slug ? 'https://libbyapp.com/library/' + encodeURIComponent(slug) : 'https://libbyapp.com/';
      }
      if (/(^|\.)hoopladigital\.com$/i.test(parsed.hostname)) return 'https://www.hoopladigital.com/';
      return parsed.origin + '/';
    } catch (err) {
      return url;
    }
  }

  function openLibraryEmbed(url, label) {
    const box = $('#libEmbed');
    const frame = $('#libEmbedFrame');
    if (!box || !frame) return;
    // OverDrive media pages send `frame-ancestors 'self'`; Libby's web app
    // and hoopla's site do not, so route those through the framed app.
    let target = url;
    if (/\.overdrive\.com/i.test(target)) target = 'https://libbyapp.com/';
    embedUrl = target;
    embedHome = providerHome(target);
    const title = $('#libEmbedTitle');
    if (title) title.textContent = label || 'Library';
    frame.src = target;
    box.classList.remove('hidden');
    // Keep the keyboard here: keys pressed inside the frame never reach this
    // document, so Esc only works while the app itself has focus.
    const close = $('#libEmbedClose');
    if (close) close.focus({ preventScroll: true });
  }

  function closeLibraryEmbed() {
    const box = $('#libEmbed');
    const frame = $('#libEmbedFrame');
    if (!box || !frame) return;
    box.classList.add('hidden');
    frame.src = 'about:blank';
    embedUrl = '';
    embedHome = '';
  }

  function isEmbedOpen() {
    const box = $('#libEmbed');
    return !!box && !box.classList.contains('hidden');
  }

  // hoopla cannot be used inside the frame: its consent cookie and its session
  // cookies are SameSite=Lax/Strict, and a browser never sends those from a
  // third-party iframe — the banner can't be dismissed and a valid login
  // bounces straight back to signed-out. So the service opens hoopla as a
  // chromeless Chrome app window: top-level, so everything works, and still
  // no tabs or address bar.
  async function openHooplaWindow(url) {
    try {
      await api('/api/library/window', { method: 'POST', body: JSON.stringify({ url }) });
    } catch (err) {
      // Service missing or Chrome not found — a plain window is still usable.
      if (!window.open(url, 'yoto-hoopla', 'popup=yes,width=640,height=680')) {
        YM.toast('Allow pop-ups for this page to open hoopla', 'err', 3200);
      }
    }
  }

  function toggle() { S.open ? close() : open(); }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S.open) {
      if (isEmbedOpen()) { e.stopPropagation(); closeLibraryEmbed(); return; }
      const modal = $('#modalRoot .modal-backdrop');
      if (!modal) { e.stopPropagation(); close(); }
    }
  }, true);

  /* ------------------------------------------------------------------ */
  /* search                                                             */
  /* ------------------------------------------------------------------ */

  async function runSearch(forced) {
    const input = $('#libQuery');
    const q = (forced || (input && input.value) || '').trim();
    if (!q) {
      YM.toast('Type a title or author first', 'err', 2200);
      if (input) input.focus();
      return;
    }
    S.query = q;
    S.hoopla = undefined;
    S.loading = true;
    S.error = '';
    renderResults();
    try {
      const data = await api('/api/search?q=' + encodeURIComponent(q) + '&limit=24');
      S.results = data;
      if (data.errors && data.errors.length) S.error = data.errors.join(' · ');
    } catch (err) {
      S.results = null;
      S.error = err.message;
    } finally {
      S.loading = false;
      renderResults();
      renderHint();
      loadHoopla(q);  // their page has to be rendered, so it lands second
    }
  }

  // Hoopla's catalogue is rendered, not an API: the service drives a hidden
  // Chrome and hands back the cards. Slow enough to keep off the main search.
  async function loadHoopla(query) {
    try {
      const data = await api('/api/hoopla?q=' + encodeURIComponent(query) + '&limit=8');
      if (S.query !== query) return;
      S.hoopla = data.results || [];
      S.hooplaUnavailable = data.available === false;
    } catch (err) {
      if (S.query !== query) return;
      S.hoopla = null;
      S.hooplaUnavailable = false;
    }
    renderResults();
  }

  function renderHint() {
    const el = $('#libHint');
    if (!el) return;
    const cfg = S.config;
    if (!cfg) { el.textContent = ''; return; }
    const bits = [];
    if (!cfg.library.slug) bits.push('add your library in Settings to see what Libby has');
    if (!cfg.yoto.connected) bits.push('connect Yoto before publishing');
    if (cfg.debrid && !cfg.debrid.configured) bits.push('add a TorBox or Premiumize key to search torrent sources');
    el.textContent = bits.length ? bits[0] : '';
  }

  function resultCard(r, kind, twin) {
    const isLibrary = kind === 'library';
    const isHoopla = kind === 'hoopla';
    const isAccount = kind === 'account';
    const foreign = isLibrary || isHoopla;  // play in the provider, never ours
    const cover = r.cover
      ? `<img class="lib-cover" src="${esc(r.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'lib-cover blank',textContent:''}))">`
      : `<div class="lib-cover blank">${esc((r.title || '?').slice(0, 1))}</div>`;

    const meta = [];
    if (r.author) meta.push(esc(r.author));
    if (r.year) meta.push(esc(r.year));
    if (!foreign) {
      if (r.duration) meta.push(fmtDur(r.duration));
      if (r.chapters) meta.push(r.chapters + ' chapter' + (r.chapters === 1 ? '' : 's'));
      // Torrent rows carry format/size instead: durations are unknown until
      // the file is actually probed.
      if (isAccount) {
        if (r.narrator) meta.push('read by ' + esc(r.narrator));
      }
    } else {
      if (r.mediaType) {
        meta.push(isHoopla
          ? (HOOPLA_KIND[r.mediaType] || r.mediaType)
          : (r.mediaType === 'audiobook' ? 'Audiobook' : 'eBook'));
      }
      if (r.narrator) meta.push('read by ' + esc(r.narrator));
    }

    const tags = [];
    if (isLibrary) {
      const a = r.availability || {};
      if (a.available) tags.push('<span class="tag good">Available now</span>');
      else if (a.waitDays) tags.push(`<span class="tag warn">~${a.waitDays} day wait</span>`);
      else if (a.holds) tags.push(`<span class="tag warn">${a.holds} on hold</span>`);
      else tags.push('<span class="tag">Not available</span>');
      tags.push('<span class="tag">Libby</span>');
    } else if (isHoopla) {
      tags.push('<span class="tag src">hoopla</span>');
      if (twin) {
        const a = twin.availability || {};
        tags.push(
          a.available
            ? '<span class="tag good">Also at Libby — plays in this app</span>'
            : `<span class="tag">Also at Libby${a.waitDays ? ` · ~${a.waitDays} day wait` : ''}</span>`
        );
      }
      if (r.language && !/^english$/i.test(r.language)) {
        tags.push(`<span class="tag warn">${esc(r.language)}</span>`);
      }
    } else if (isAccount) {
      tags.push(`<span class="tag src">${esc(SRC_LABEL[r.source] || r.source)}</span>`);
      if (r.format) tags.push(`<span class="tag">${esc(r.format)}</span>`);
      if (r.size) tags.push(`<span class="tag">${esc(r.size)}</span>`);
      tags.push('<span class="tag">Debrid</span>');
    } else {
      tags.push(`<span class="tag src">${esc(SRC_LABEL[r.source] || r.source)}</span>`);
      if (r.license) tags.push(`<span class="tag">${esc(r.license)}</span>`);
    }

    const actions = isLibrary
      ? `<button class="btn small" data-act="libby" data-link="${esc(r.deepLink || r.webLink || '')}">Open in Libby</button>`
      : isHoopla
      ? (twin
        ? `<button class="btn primary small" data-act="libby" data-link="${esc(twin.deepLink || twin.webLink || '')}">Play in this app</button>
           <button class="btn small" data-act="hoopla" data-link="${esc(r.deepLink || '')}"
                   title="opens in hoopla's own window">Play in hoopla</button>`
        : `<button class="btn small" data-act="hoopla" data-link="${esc(r.deepLink || '')}">Play in hoopla</button>`)
      : isAccount
      ? `<button class="iconbtn tiny" data-act="preview" data-source="${esc(r.source)}" data-id="${esc(r.sourceId)}" title="Play the first chapter" aria-label="Preview first chapter">
           <svg viewBox="0 0 24 24" width="13" height="13"><path d="M8 5.5v13l10-6.5-10-6.5Z" fill="currentColor"/></svg>
         </button>
         <button class="btn small" data-act="links" data-source="${esc(r.source)}" data-id="${esc(r.sourceId)}"
                 title="See the debrid streams, file sizes and seeds">Links…</button>
         <button class="btn primary small" data-act="get" data-source="${esc(r.source)}" data-id="${esc(r.sourceId)}">Make this card</button>`
      : `<button class="iconbtn tiny" data-act="preview" data-source="${esc(r.source)}" data-id="${esc(r.sourceId)}" title="Play the first chapter" aria-label="Preview first chapter">
           <svg viewBox="0 0 24 24" width="13" height="13"><path d="M8 5.5v13l10-6.5-10-6.5Z" fill="currentColor"/></svg>
         </button>
         <button class="btn primary small" data-act="get" data-source="${esc(r.source)}" data-id="${esc(r.sourceId)}">Make this card</button>`;

    return `<article class="lib-result" data-key="${esc(r.id)}">
      ${cover}
      <div class="lib-result-main">
        <div class="lib-result-title">${esc(r.title)}${r.subtitle ? ` <span class="sub">— ${esc(r.subtitle)}</span>` : ''}</div>
        <div class="lib-result-meta">${meta.join(' · ')}</div>
        <div class="lib-result-tags">${tags.join('')}</div>
      </div>
      <div class="lib-result-actions">${actions}</div>
    </article>`;
  }

  function renderResults() {
    const box = $('#libResults');
    if (!box) return;

    if (S.loading) {
      box.innerHTML = `<div class="lib-empty"><div class="spinner"></div><p>Searching LibriVox, Internet Archive, AudioBookBay${S.config && S.config.library.slug ? ' and Libby' : ''}…</p></div>`;
      return;
    }
    if (!S.results) {
      box.innerHTML = savedSection() + `<div class="lib-empty">
        <h3>Find a book</h3>
        <p>Type a title or author above. Free downloads come from LibriVox and
           the Internet Archive; <b>Your accounts</b> searches AudioBookBay and
           MyAnonamouse and fetches through your TorBox or Premiumize account.</p>
        <p class="dim">Titles are matched literally by LibriVox, so hyphenation
           counts: try <b>Winnie-the-Pooh</b> rather than "Winnie the Pooh".</p>
      </div>`;
      return;
    }

    const own = S.results.own || [];
    const accounts = S.results.accounts || [];
    const library = S.results.library || [];
    const parts = [];

    if (S.filter === 'saved') {
      box.innerHTML = (S.error ? `<div class="lib-error">${esc(S.error)}</div>` : '')
        + savedSection();
      return;
    }

    if (S.error) {
      parts.push(`<div class="lib-error">${esc(S.error)}</div>`);
    }

    if (S.filter === 'all' || S.filter === 'own') {
      parts.push(`<div class="lib-section-head"><span>Free downloads</span><span class="muted">${own.length}</span></div>`);
      if (!own.length) {
        parts.push(`<div class="lib-empty small">
          <p>Nothing matched “${esc(S.query)}”.</p>
          <p class="dim">LibriVox matches titles literally, so hyphenation counts. Try
          <button class="linkbtn" data-try="Winnie the Pooh">Winnie the Pooh</button> or
          <button class="linkbtn" data-try="Alice in Wonderland">Alice in Wonderland</button>.</p>
        </div>`);
      } else {
        parts.push(own.map((r) => resultCard(r, 'own')).join(''));
      }
    }

    if (S.filter === 'all' || S.filter === 'accounts') {
      const debridReady = !!(S.config && S.config.debrid && S.config.debrid.configured);
      parts.push(`<div class="lib-section-head lib-section-accounts">
          <span>Your accounts</span>
          <span class="muted">${accounts.length ? accounts.length : (debridReady ? 'none found' : 'no debrid key set')}</span>
        </div>`);
      if (accounts.length) {
        parts.push(accounts.map((r) => resultCard(r, 'account')).join(''));
      } else {
        parts.push(`<div class="lib-empty small">
          <p>${debridReady
            ? 'AudioBookBay and MyAnonamouse had no matches.'
            : 'Add a TorBox or Premiumize key in Settings to search torrent sources.'}</p>
          <p class="dim">A book that is already cached on your account downloads
             straight away; one that is not gets queued on the provider and the
             job waits for it, then continues on its own.</p>
        </div>`);
      }
    }

    if (S.filter === 'all' || S.filter === 'library') {
      parts.push(`<div class="lib-section-head lib-section-lib">
          <span>At your library</span>
          <span class="muted">${library.length ? '' : (S.config && S.config.library.slug ? 'none found' : 'not configured')}</span>
        </div>`);
      if (library.length) {
        parts.push(library.map((r) => resultCard(r, 'library')).join(''));
      } else {
        parts.push(`<div class="lib-empty small">
          <p>${S.config && S.config.library.slug
            ? 'No Libby copies matched this search.'
            : 'Add your library card in Settings to see availability.'}</p>
          <p class="dim">Library loans play inside Libby. This app will not pull
             them down for you — but any file you already have goes in through
             <b>Add my own files</b>.</p>
        </div>`);
      }
      if (S.results.hoopla) {
        parts.push(`<div class="lib-section-head lib-section-lib">
            <span>Hoopla</span>
            <span class="muted">${S.hoopla === undefined ? 'searching…' : (S.hoopla === null ? 'unavailable' : (S.hoopla.length ? '' : 'none found'))}</span>
          </div>`);
        if (S.hoopla && S.hoopla.length) {
          parts.push(S.hoopla.map((r) => resultCard(r, 'hoopla', libbyTwin(r))).join(''));
        } else if (S.hoopla !== undefined) {
          parts.push(`<div class="lib-empty small">
            <p>${S.hooplaUnavailable
              ? 'Hoopla search needs Chrome and the websocket-client package.'
              : (S.hoopla === null
                ? 'Hoopla could not be searched just now.'
                : 'Nothing at Hoopla matched this search.')}</p>
            <p class="dim">Hoopla titles play in Hoopla's own window — this app
               looks them up and opens them there. When a title is also at your
               library, the card says <b>Play in this app</b>: Libby's player
               runs inside this panel, so that copy plays here.</p>
          </div>`);
        }
      }
    }

    box.innerHTML = parts.join('');
  }

  function onResultsClick(e) {
    const tryBtn = e.target.closest('[data-try]');
    if (tryBtn) {
      const input = $('#libQuery');
      if (input) input.value = tryBtn.dataset.try;
      runSearch(tryBtn.dataset.try);
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'libby' || btn.dataset.act === 'hoopla') {
      const link = btn.dataset.link;
      if (!link) { YM.toast('No link available for that title', 'err'); return; }
      if (btn.dataset.act === 'hoopla') { openHooplaWindow(link); return; }
      openLibraryEmbed(link, 'Libby');
      return;
    }
    if (btn.dataset.act === 'links') {
      openLinks(btn.dataset.source, btn.dataset.id, btn);
      return;
    }
    if (btn.dataset.act === 'play-saved') {
      playSaved(btn.dataset.key);
      return;
    }
    if (btn.dataset.act === 'remove-saved') {
      removeSaved(btn.dataset.key);
      return;
    }
    if (btn.dataset.act === 'preview') {
      previewResult(btn.dataset.source, btn.dataset.id, btn);
      return;
    }
    if (btn.dataset.act === 'get') {
      startJob(btn.dataset.source, btn.dataset.id, btn);
    }
  }

  /* ------------------------------------------------------------------ */
  /* jobs                                                               */
  /* ------------------------------------------------------------------ */

  async function startJob(source, id, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Starting…'; }
    try {
      const job = await api('/api/job', {
        method: 'POST',
        body: JSON.stringify({ source, id, options: S.config ? S.config.options : {} }),
      });
      YM.toast('Downloading “' + job.title + '”', 'good', 2600);
      await refreshJobs();
      openQueueFocus();
    } catch (err) {
      YM.toast(err.message, 'err', 4200);
      if (btn) { btn.disabled = false; btn.textContent = 'Make this card'; }
    }
  }

  async function importLocal() {
    const btn = $('#libImport');
    if (btn) btn.disabled = true;
    try {
      const job = await api('/api/import/pick', { method: 'POST', body: JSON.stringify({}) });
      if (job && job.cancelled) return;
      if (job && job.id) {
        YM.toast('Adding “' + job.title + '”', 'good', 2600);
        await refreshJobs();
        openQueueFocus();
      }
    } catch (err) {
      YM.toast(err.message, 'err', 4200);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function openQueueFocus() {
    const box = $('#libJobs');
    if (box) box.scrollTop = 0;
  }

  async function refreshJobs() {
    try {
      const data = await api('/api/jobs');
      const before = new Map(S.jobs.map((j) => [j.id, j.status]));
      S.jobs = data.jobs || [];
      for (const job of S.jobs) {
        const prev = before.get(job.id);
        if (prev && prev !== job.status) {
          if (job.status === 'ready') YM.toast('“' + job.title + '” is ready to publish', 'good', 3200);
          if (job.status === 'error') YM.toast(job.title + ': ' + (job.error || 'failed'), 'err', 5000);
          if (job.status === 'published') YM.toast('Published “' + job.title + '” to Yoto', 'good', 3600);
        }
      }
      renderJobs();
    } catch (err) { /* server restarting — polling continues */ }
  }

  function startPolling() {
    stopPolling();
    S.pollTimer = setInterval(() => {
      if (!S.open) return;
      refreshJobs();
    }, 1500);
  }

  function stopPolling() {
    if (S.pollTimer) clearInterval(S.pollTimer);
    S.pollTimer = null;
  }

  function statusLine(job) {
    if (job.status === 'error') return `<span class="job-err">${esc(job.error || 'Failed')}</span>`;
    if (job.status === 'paused') return '<span class="job-dim">Paused</span>';
    if (job.status === 'ready') {
      const cards = job.cards || [];
      const cardBit = cards.length > 1
        ? `${cards.length} cards · ` : '';
      return `<span class="job-dim">${cardBit}${fmtDur(job.duration)} · ${fmtSize(job.size)}</span>`;
    }
    if (job.status === 'published') {
      return '<span class="job-ok">In your Yoto library</span>';
    }
    return `<span class="job-dim">${esc(job.stage || '')}${job.message ? ' · ' + esc(job.message) : ''}</span>`;
  }

  function jobCard(job) {
    const active = ['queued', 'fetching', 'downloading', 'preparing', 'publishing'].includes(job.status);
    const pct = Math.round((Number(job.progress) || 0) * 100);
    const expanded = !!S.expanded[job.id];
    const cover = job.coverUrl
      ? `<img class="job-cover" src="${esc(job.coverUrl)}" alt="">`
      : `<div class="job-cover blank">${esc((job.title || '?').slice(0, 1))}</div>`;

    const actions = [];
    if (active) actions.push(`<button class="btn small" data-job="${esc(job.id)}" data-act="pause">Pause</button>`);
    if (job.status === 'paused' || (job.status === 'error' && job.error)) {
      actions.push(`<button class="btn small" data-job="${esc(job.id)}" data-act="resume">Resume</button>`);
    }
    if (job.status === 'ready' || job.status === 'published') {
      actions.push(`<button class="btn small" data-job="${esc(job.id)}" data-act="sheet">Add to sheet</button>`);
      if (job.tracks && job.tracks.length) {
        actions.push(`<button class="btn small" data-job="${esc(job.id)}" data-act="preview" title="Play — continues where you left off">▶</button>`);
      }
    }
    if (job.status === 'ready') {
      actions.push(`<button class="btn primary small" data-job="${esc(job.id)}" data-act="publish">Publish to Yoto</button>`);
    }
    if (job.status === 'published') {
      const ids = (job.yoto && job.yoto.contentIds) || [];
      actions.push(`<span class="job-badge">${ids.length} item${ids.length === 1 ? '' : 's'}</span>`);
    }
    actions.push(`<button class="iconbtn tiny" data-job="${esc(job.id)}" data-act="more" title="More">···</button>`);

    const detail = expanded ? renderJobDetail(job) : '';

    return `<article class="job ${active ? 'active' : ''} ${job.status}" data-id="${esc(job.id)}">
      <div class="job-top">
        ${cover}
        <div class="job-main">
          <div class="job-title" title="${esc(job.title)}">${esc(job.title)}</div>
          <div class="job-sub">${esc(SRC_LABEL[job.source] || job.source)}${job.author ? ' · ' + esc(job.author) : ''}</div>
        </div>
      </div>
      ${active || job.status === 'error' ? `<div class="job-bar"><i style="width:${pct}%"></i></div>` : ''}
      <div class="job-status">${statusLine(job)}</div>
      <div class="job-actions">${actions.join('')}</div>
      ${detail}
    </article>`;
  }

  function renderJobDetail(job) {
    const tracks = (job.tracks || []).slice(0, 60);
    const cards = job.cards || [];
    const rows = tracks.map((t) => `<li data-job="${esc(job.id)}" data-track="${t.number}" title="Play this track">
        <span>${t.number}</span>${esc(t.title)}<em>${fmtDur(t.duration)}</em></li>`).join('');
    const cardInfo = cards.length > 1
      ? `<p class="job-note">Splits across <b>${cards.length} cards</b> at chapter boundaries: ${cards.map((c) => 'Card ' + c.index + ' (' + c.tracks.length + ' tracks)').join(', ')}.</p>`
      : `<p class="job-note">Fits on one Yoto card${cards.length ? ' — ' + cards[0].tracks.length + ' tracks' : ''}.</p>`;
    const links = `<div class="job-links">
        <a href="/api/job/${encodeURIComponent(job.id)}/manifest" target="_blank" rel="noopener">manifest.json</a>
      </div>`;
    return `<div class="job-detail">${cardInfo}<ol class="job-tracks">${rows}</ol>${links}</div>`;
  }

  /* ------------------------------------------------------------------ */
  /* saved books (stream, no download)                                  */
  /* ------------------------------------------------------------------ */

  async function refreshSaved() {
    try {
      const data = await api('/api/library');
      S.saved = data.books || [];
    } catch (err) {
      S.saved = [];
    }
    updateSavedChip();
    if (!S.results || S.filter === 'saved') renderResults();
  }

  function toggleQueue(force) {
    S.queueFolded = force === undefined ? !S.queueFolded : !!force;
    const cols = $('#libColumns');
    if (cols) cols.classList.toggle('queue-folded', S.queueFolded);
    const arrow = $('#libQueueArrow');
    if (arrow) {
      const label = S.queueFolded ? 'Show the queue' : 'Hide the queue';
      arrow.title = label;
      arrow.setAttribute('aria-label', label);
    }
  }

  function updateSavedChip() {
    const chip = $('#libSavedChip');
    if (chip) chip.textContent = S.saved.length ? `Saved (${S.saved.length})` : 'Saved';
  }

  function savedCard(book) {
    const cover = book.cover
      ? `<img class="lib-cover" src="${esc(book.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : `<div class="lib-cover blank">${esc((book.title || '?').slice(0, 1))}</div>`;
    const chapters = (book.chapters || []).length;
    const meta = [book.author, `${chapters} chapter${chapters === 1 ? '' : 's'}`]
      .filter(Boolean).map(esc).join(' · ');
    return `<article class="lib-result" data-key="${esc(book.key)}">
      ${cover}
      <div class="lib-result-main">
        <div class="lib-result-title">${esc(book.title)}</div>
        <div class="lib-result-meta">${meta}</div>
        <div class="lib-result-tags">
          <span class="tag src">${esc(SRC_LABEL[book.source] || book.source)}</span>
          <span class="tag">${esc(PROVIDER_LABEL[book.provider] || book.provider || 'debrid')}</span>
          ${book.format ? `<span class="tag">${esc(book.format)}</span>` : ''}
        </div>
      </div>
      <div class="lib-result-actions">
        <button class="iconbtn tiny" data-act="play-saved" data-key="${esc(book.key)}" title="Play" aria-label="Play">
          <svg viewBox="0 0 24 24" width="13" height="13"><path d="M8 5.5v13l10-6.5-10-6.5Z" fill="currentColor"/></svg>
        </button>
        <button class="iconbtn tiny" data-act="remove-saved" data-key="${esc(book.key)}" title="Remove from saved" aria-label="Remove from saved">✕</button>
      </div>
    </article>`;
  }

  function savedSection() {
    if (!S.saved.length) {
      return `<div class="lib-section-head"><span>Saved books</span><span class="muted">none</span></div>
        <div class="lib-empty small">
          <p>Nothing saved yet.</p>
          <p class="dim">Open <b>Links…</b> on a result from your accounts and choose
             <b>Save to library</b> — saved books stream without downloading anything.</p>
        </div>`;
    }
    return `<div class="lib-section-head"><span>Saved books</span><span class="muted">${S.saved.length}</span></div>`
      + S.saved.map(savedCard).join('');
  }

  /** Play a saved book: each chapter resolves through the same-origin relay. */
  function playSaved(key) {
    const book = S.saved.find((b) => b.key === key);
    if (!book) { YM.toast('That saved book is gone', 'err', 2600); return; }
    playLibraryBook(book);
  }

  async function removeSaved(key) {
    try {
      await api(`/api/library/${encodeURIComponent(key)}`, { method: 'DELETE' });
      await refreshSaved();
      YM.toast('Removed from saved books', '', 2200);
    } catch (err) {
      YM.toast(err.message, 'err', 3600);
    }
  }

  /** Save a release for streaming (no download, no card). */
  async function saveRelease(source, id) {
    const book = await api('/api/library', {
      method: 'POST',
      body: JSON.stringify({ source, id }),
    });
    await refreshSaved();
    return book;
  }

  /* ------------------------------------------------------------------ */
  /* Links dialog — the debrid streams behind a release                 */
  /* ------------------------------------------------------------------ */

  async function openLinks(source, id, btn) {
    if (btn) btn.disabled = true;
    try {
      const data = await api(`/api/streams?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}`);
      renderLinks(data);
    } catch (err) {
      YM.toast(err.message, 'err', 4200);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function linkStateTag(row) {
    if (row.state === 'cached') return '<span class="tag good">Cached</span>';
    if (row.state === 'downloading') {
      return `<span class="tag warn">Downloading ${Math.round(row.progress || 0)}%</span>`;
    }
    if (row.state === 'stalled') return '<span class="tag warn">Stalled — no seeds</span>';
    if (row.state === 'paused') return '<span class="tag warn">Paused</span>';
    if (row.state === 'error') return '<span class="tag warn">Error</span>';
    if (row.state === 'queued') return '<span class="tag">Queued</span>';
    if (row.state === 'checking') return '<span class="tag">Checking…</span>';
    if (row.state === 'unconfigured') return '<span class="tag">No key</span>';
    return '<span class="tag">Not on your account</span>';
  }

  function linkFacts(row) {
    const bits = [];
    if (row.fileCount) bits.push(`${row.fileCount} file${row.fileCount === 1 ? '' : 's'}`);
    if (row.bytesTotal) bits.push(fmtSize(row.bytesTotal));
    if (row.seeds !== null && row.seeds !== undefined) {
      bits.push(`${row.seeds} seed${row.seeds === 1 ? '' : 's'}`);
    }
    if (row.peers !== null && row.peers !== undefined) {
      bits.push(`${row.peers} peer${row.peers === 1 ? '' : 's'}`);
    }
    return bits.join(' · ');
  }

  function linkRow(data, row) {
    const facts = linkFacts(row);
    const files = row.files || [];
    const fileList = files.length
      ? `<details class="fold link-files"><summary>Files (${row.fileCount})</summary><ol>
           ${files.map((f) => `<li><span class="ft">${esc(f.type || '')}</span>${esc(f.name)}<em>${fmtSize(f.size)}</em></li>`).join('')}
         </ol></details>`
      : '';
    let actions = '';
    if (row.cached) {
      actions = `<button class="btn primary small" data-link-act="play" data-provider="${esc(row.provider)}">Play</button>
                 <button class="btn small" data-link-act="save" data-provider="${esc(row.provider)}">Save to library</button>
                 <button class="btn small" data-link-act="card" data-provider="${esc(row.provider)}">Make card</button>`;
    } else if (row.configured) {
      actions = `<button class="btn small" data-link-act="check" data-provider="${esc(row.provider)}">Check availability</button>
                 <button class="btn small" data-link-act="card" data-provider="${esc(row.provider)}">Make card</button>`;
    }
    let note = '';
    if (row.error) note = `<p class="link-note warn">${esc(row.error)}</p>`;
    else if (row.state === 'stalled') {
      note = '<p class="link-note warn">Nobody is seeding this release — pick another one from the results.</p>';
    } else if (row.cached && !row.fileCount) {
      note = '<p class="link-note">Cached — it gets added to your account when you play or save it.</p>';
    }
    return `<div class="link-row" data-provider="${esc(row.provider)}">
      <div class="link-head">
        <strong>${esc(row.label)}</strong>
        ${linkStateTag(row)}
        <span class="link-facts">${esc(facts)}</span>
      </div>
      ${note}
      ${actions ? `<div class="link-actions">${actions}</div>` : ''}
      ${fileList}
    </div>`;
  }

  function renderLinks(data) {
    const subtitle = [data.format, data.sizeText, SRC_LABEL[data.source] || data.source]
      .filter(Boolean).join(' · ');
    const modal = YM.UI.modal({
      title: `Links — ${data.title}`,
      subtitle: esc(subtitle),
      wide: true,
      body: `<div class="links">${data.streams.map((row) => linkRow(data, row)).join('')}</div>`,
      footer: '<button class="btn" data-close>Close</button>',
    });

    YM.$$('[data-link-act]', modal.root).forEach((btn) => {
      btn.addEventListener('click', async () => {
        const kind = btn.dataset.linkAct;
        const provider = btn.dataset.provider || '';
        if (kind === 'card') {
          modal.close();
          startJob(data.source, data.sourceId, null);
          return;
        }
        if (kind === 'check') {
          btn.disabled = true;
          btn.textContent = 'Checking…';
          try {
            const fresh = await api('/api/streams/queue', {
              method: 'POST',
              body: JSON.stringify({ source: data.source, id: data.sourceId, provider }),
            });
            modal.close();
            renderLinks(fresh);
            const added = (fresh.streams || []).find((s) => s.provider === (fresh.queued || provider));
            if (added && added.state === 'stalled') {
              YM.toast('Added — but the provider reports no seeds', 'err', 4200);
            } else {
              YM.toast('Added to ' + (PROVIDER_LABEL[fresh.queued] || fresh.queued || provider), 'good', 3000);
            }
          } catch (err) {
            YM.toast(err.message, 'err', 4200);
            btn.disabled = false;
            btn.textContent = 'Check availability';
          }
          return;
        }
        // Play / Save resolve the release into the streaming library.
        btn.disabled = true;
        try {
          const book = await saveRelease(data.source, data.sourceId);
          modal.close();
          if (kind === 'play') playLibraryBook(book);
          else YM.toast('Saved to your library', 'good', 2400);
        } catch (err) {
          YM.toast(err.message, 'err', 4200);
          btn.disabled = false;
        }
      });
    });
  }

  function renderJobs() {
    const box = $('#libJobs');
    if (!box) return;
    const count = $('#libQueueCount');
    if (count) count.textContent = S.jobs.length ? String(S.jobs.length) : '';
    if (!S.jobs.length) {
      box.innerHTML = `<div class="lib-empty small"><p>Nothing queued yet.</p>
        <p class="dim">Pick a result and it lands here with progress.</p></div>`;
      return;
    }
    box.innerHTML = S.jobs.map(jobCard).join('');
  }

  async function onJobsClick(e) {
    const btn = e.target.closest('[data-job]');
    if (!btn) return;
    const id = btn.dataset.job;
    const act = btn.dataset.act;
    const job = S.jobs.find((j) => j.id === id);
    if (!job) return;

    if (btn.dataset.track) {
      playJob(job, Number(btn.dataset.track));
      return;
    }

    if (act === 'pause') {
      await api(`/api/job/${id}/cancel`, { method: 'POST', body: '{}' });
      refreshJobs();
    } else if (act === 'resume') {
      await api(`/api/job/${id}/resume`, { method: 'POST', body: '{}' });
      refreshJobs();
    } else if (act === 'sheet') {
      await addToSheet(job);
    } else if (act === 'preview') {
      // No explicit track: the card's ▶ means "keep listening", so playJob
      // consults the saved resume point. Chapter rows pass a number instead.
      playJob(job);
    } else if (act === 'publish') {
      await publishJob(job);
    } else if (act === 'more') {
      openJobMenu(job, btn);
    } else if (act === 'delete') {
      openDeleteConfirm(job);
    }
  }

  function openDeleteConfirm(job) {
    const meta = job.debrid || {};
    const torrent = meta.torrent || {};
    const provider = meta.provider || torrent.provider || '';
    const hasProviderCopy = !!provider && !!(torrent.transferId || meta.infoHash);
    const label = PROVIDER_LABEL[provider] || provider || 'your provider';
    const modal = YM.UI.modal({
      title: 'Remove this job?',
      subtitle: esc(job.title),
      body: `<p class="muted">The downloaded audio and manifest for this job are removed.
          Anything already published to Yoto stays in your library.</p>
        ${hasProviderCopy ? `<label class="check"><input type="checkbox" id="delTorrent">
          Also delete this torrent from ${esc(label)}</label>` : ''}`,
      footer: `<button class="btn danger" id="delYes">Remove job</button>
               <button class="btn" data-close>Cancel</button>`,
    });
    $('#delYes', modal.root).addEventListener('click', async () => {
      const also = $('#delTorrent', modal.root);
      // Default OFF: touching the provider is always a deliberate choice.
      const extra = also && also.checked ? '&torrent=1' : '';
      try {
        const res = await api(`/api/job/${encodeURIComponent(job.id)}?keep=0${extra}`,
          { method: 'DELETE' });
        modal.close();
        if (res && res.note) YM.toast(res.note, 'good', 3800);
        refreshJobs();
      } catch (err) {
        YM.toast(err.message, 'err', 4000);
      }
    });
  }

  async function publishJob(job) {
    if (!S.config || !S.config.yoto.connected) {
      const go = await confirmDialog({
        title: 'Connect Yoto first',
        body: '<p>Publishing needs a one-time sign-in to your Yoto account. It opens in a new tab and comes straight back here.</p>',
        confirm: 'Connect Yoto',
      });
      if (go) await connectYoto();
      return;
    }
    const cards = job.cards || [];
    if (cards.length > 1) {
      const go = await confirmDialog({
        title: `Publish all ${cards.length} cards?`,
        body: `<p>This book is too long for one card, so it was split at chapter boundaries.
          Each part becomes its own playlist in your Yoto library.</p>`,
        confirm: 'Publish all',
      });
      if (!go) return;
    }
    try {
      YM.toast('Uploading to Yoto…', '', 2400);
      await api(`/api/job/${job.id}/publish`, { method: 'POST', body: '{}' });
      refreshJobs();
    } catch (err) {
      YM.toast(err.message, 'err', 5000);
    }
  }

  async function connectYoto() {
    try {
      const data = await api('/api/yoto/connect', { method: 'POST', body: '{}' });
      window.open(data.url, '_blank', 'noopener');
      YM.toast('Finish signing in in the new tab', '', 4000);
      setTimeout(refreshConfig, 2500);
      setTimeout(refreshConfig, 8000);
    } catch (err) {
      YM.toast(err.message, 'err', 5000);
    }
  }

  /* ------------------------------------------------------------------ */
  /* card design → the sheet                                            */
  /* ------------------------------------------------------------------ */

  async function addToSheet(job) {
    let design;
    try {
      design = await api(`/api/job/${job.id}/design`);
    } catch (err) {
      YM.toast(err.message, 'err', 4000);
      return;
    }
    const designs = design.designs || [];
    if (!designs.length) {
      YM.toast('No design to place', 'err');
      return;
    }

    const app = YM.App;
    const project = app.S.project;
    if (!project) return;

    const needed = designs.reduce((n, d) => n + 1 + (d.back && d.back.length ? 1 : 0), 0);
    let targets = [];
    for (let i = 0; i < project.cards.length; i++) {
      if (!YM.hasContent(project.cards[i])) targets.push(i);
    }

    if (targets.length < needed) {
      const go = await confirmDialog({
        title: 'Not enough empty cards',
        body: `<p>This needs ${needed} cards but only ${targets.length} are empty on the sheet.
          Continue and overwrite the remaining cards from the end?</p>`,
        confirm: 'Overwrite',
      });
      if (!go) return;
      const all = project.cards.map((_, i) => i);
      targets = targets.concat(all.filter((i) => !targets.includes(i)).reverse());
    }

    // Inline the cover so the sheet stays self-contained once the job is gone.
    const coverCache = new Map();
    async function inlineCover(url) {
      if (coverCache.has(url)) return coverCache.get(url);
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        coverCache.set(url, dataUrl);
        return dataUrl;
      } catch (e) {
        return url;
      }
    }

    // Build every card first, then decode, then commit: the renderer skips
    // images that have not loaded yet, so assigning before decode paints a
    // blank card.
    const staged = [];
    for (const item of designs) {
      for (const side of [item.front, item.back]) {
        if (!side || !side.length) continue;
        const layers = [];
        for (const raw of side) {
          const layer = YM.clone(raw);
          layer.id = YM.uid(layer.type === 'text' ? 'txt' : layer.type === 'image' ? 'img' : 'shp');
          if (layer.type === 'image' && layer.src) {
            layer.src = await inlineCover(layer.src);
            layer.imgW = layer.imgW || 1000;
            layer.imgH = layer.imgH || 1000;
          }
          layers.push(layer);
        }
        staged.push(layers);
      }
    }

    const imageSources = new Set();
    staged.forEach((layers) => layers.forEach((l) => {
      if (l.type === 'image' && l.src) imageSources.add(l.src);
    }));
    await Promise.all(Array.from(imageSources).map(
      (src) => YM.ensureImage(src).catch(() => null)
    ));

    app.pushHistory();
    let cursor = 0;
    for (const layers of staged) {
      const index = targets[cursor++];
      if (index == null) break;
      const card = project.cards[index];
      card.layers = layers;
      card.bg = null;
    }

    if (job.title && project.name === 'Untitled sheet') {
      project.name = job.title;
      YM.UI.setProjectName(project.name);
    }

    app.commit();
    YM.toast('Card design added to your sheet', 'good', 2600);
    close();
    app.selectCard(targets[0] || 0);
    app.ensureCardVisible && app.ensureCardVisible(targets[0] || 0);
  }

  /* ------------------------------------------------------------------ */
  /* settings                                                           */
  /* ------------------------------------------------------------------ */

  async function refreshConfig() {
    try {
      S.config = await api('/api/config');
      const hint = $('#libHint');
      if (hint) renderHint();
      return S.config;
    } catch (err) {
      return null;
    }
  }

  function openSettings() {
    const cfg = S.config || { deepseek: {}, yoto: {}, library: {}, hoopla: {}, archive: {}, options: {}, torbox: {}, premiumize: {}, debrid: {}, abb: {}, mam: {} };
    const modal = YM.UI.modal({
      title: 'Settings',
      subtitle: 'Keys are stored outside the project folder and never shown again.',
      wide: true,
      body: `
        <div class="settings">
          <section>
            <h3>Yoto</h3>
            <div class="row">
              <label>Client ID</label>
              <input id="setYotoClient" value="${esc(cfg.yoto.clientId || '')}" spellcheck="false">
            </div>
            <div class="row">
              <label>Callback</label>
              <input id="setYotoCallback" value="${esc(cfg.yoto.callbackUrl || '')}" spellcheck="false">
            </div>
            <div class="row">
              <label>Account</label>
              <div class="inline">
                <span class="muted">${esc(cfg.yoto.email || 'not signed in')}</span>
                ${cfg.yoto.connected
                  ? '<span class="tag good">Connected</span><button class="linkbtn" id="setYotoOut">Disconnect</button>'
                  : '<span class="tag">Not connected</span><button class="linkbtn" id="setYotoIn">Connect</button>'}
              </div>
            </div>
          </section>

          <section>
            <h3>Library</h3>
            <div class="row">
              <label>System</label>
              <input id="setLibSystem" value="${esc(cfg.library.system || '')}" placeholder="Wake County Public Libraries">
            </div>
            <div class="row">
              <label>Libby slug</label>
              <input id="setLibSlug" value="${esc(cfg.library.slug || '')}" placeholder="wakegov" spellcheck="false">
            </div>
            <div class="row two">
              <div><label>Card number</label>
                <input id="setLibCard" value="" placeholder="${cfg.library.hasCard ? '•••• saved' : 'card number'}" spellcheck="false"></div>
              <div><label>PIN</label>
                <input id="setLibPin" type="password" value="" placeholder="PIN" spellcheck="false"></div>
            </div>
            <p class="dim">The slug is the word after <code>libbyapp.com/library/</code>. Used for availability search only.</p>
          </section>

          <section>
            <h3>Audio</h3>
            <div class="row two">
              <div><label>MP3 bitrate</label>
                <select id="setBitrate">
                  <option value="96k">96 kbps — smallest</option>
                  <option value="128k">128 kbps — recommended</option>
                  <option value="160k">160 kbps</option>
                  <option value="192k">192 kbps — largest</option>
                </select></div>
              <div><label>Loudness target</label>
                <select id="setLoud">
                  <option value="-16">-16 LUFS — Yoto-friendly</option>
                  <option value="-18">-18 LUFS — quieter</option>
                  <option value="-14">-14 LUFS — louder</option>
                </select></div>
            </div>
            <label class="check"><input type="checkbox" id="setNormalise" ${cfg.options.loudnorm ? 'checked' : ''}> Normalise volume while preparing</label>
            <label class="check"><input type="checkbox" id="setKeepRaw" ${cfg.options.keepRaw ? 'checked' : ''}> Keep original downloads (needs more disk)</label>
          </section>

          <section>
            <h3>Downloads</h3>
            <div class="row">
              <label>Job folder</label>
              <div class="inline">
                <input id="setJobsRoot" value="${esc(cfg.jobsRoot || '')}" readonly style="flex:1">
                <button class="btn small" id="setJobsPick">Choose…</button>
              </div>
            </div>
            <label class="check"><input type="checkbox" id="setJobsMove"> Move existing jobs into the new folder</label>
            <p class="dim">Applies after a restart. Audio never goes in the app
               folder or Program Files, so both copies keep one library.</p>
          </section>

          <section>
            <h3>Debrid</h3>
            <div class="row two">
              <div><label>TorBox API key</label>
                <input id="setTorbox" type="password" value="" spellcheck="false"
                       placeholder="${cfg.torbox && cfg.torbox.configured ? '•••• configured' : 'TorBox key'}"></div>
              <div><label>Premiumize API key</label>
                <input id="setPremiumize" type="password" value="" spellcheck="false"
                       placeholder="${cfg.premiumize && cfg.premiumize.configured ? '•••• configured' : 'Premiumize key'}"></div>
            </div>
            <div class="row">
              <label>Try first</label>
              <select id="setDebridOrder">
                <option value="torbox">TorBox, then Premiumize</option>
                <option value="premiumize">Premiumize, then TorBox</option>
              </select>
            </div>
            <div class="row">
              <label>Stremio</label>
              <div class="inline">
                <button class="linkbtn" id="setImportKeys">Import keys from Stremio</button>
                <span class="muted">reads your installed addon URLs, never writes</span>
              </div>
            </div>
            <p class="dim">A book already cached on your account downloads immediately.
               Anything else is queued on the provider and the job waits for it, then continues.</p>
          </section>

          <section>
            <h3>Torrent sites</h3>
            <div class="row two">
              <div><label>AudioBookBay user</label>
                <input id="setAbbUser" value="" spellcheck="false"
                       placeholder="${cfg.abb && cfg.abb.configured ? '•••• saved' : 'optional'}"></div>
              <div><label>Password</label>
                <input id="setAbbPass" type="password" value="" spellcheck="false"
                       placeholder="${cfg.abb && cfg.abb.configured ? '•••• saved' : 'optional'}"></div>
            </div>
            <div class="row">
              <label>ABB domain</label>
              <input id="setAbbDomain" value="${esc((cfg.abb && cfg.abb.domain) || '')}"
                     placeholder="auto — audiobookbay.lu" spellcheck="false">
            </div>
            <div class="row two">
              <div><label>MAM user</label>
                <input id="setMamUser" value="" spellcheck="false"
                       placeholder="${cfg.mam && cfg.mam.configured ? '•••• saved' : 'optional'}"></div>
              <div><label>Password</label>
                <input id="setMamPass" type="password" value="" spellcheck="false"
                       placeholder="${cfg.mam && cfg.mam.configured ? '•••• saved' : 'optional'}"></div>
            </div>
            <div class="row">
              <label>MAM PIN</label>
              <input id="setMamPin" type="password" value="" spellcheck="false"
                     placeholder="only if 2FA is on">
            </div>
            <p class="dim">Both optional: AudioBookBay searches without an account
               (members-only posts need the login); MyAnonamouse is member-only.</p>
          </section>

          <section>
            <h3>API keys</h3>
            <div class="row">
              <label>DeepSeek</label>
              <input id="setDeepseek" type="password" value="" spellcheck="false"
                     placeholder="${cfg.deepseek.configured ? '•••• configured' : 'sk-…'}">
            </div>
            <div class="row">
              <label>Contact email</label>
              <input id="setArchiveEmail" value="${esc(cfg.archive.contactEmail || '')}"
                     placeholder="used in the archive.org User-Agent" spellcheck="false">
            </div>
          </section>
        </div>`,
      footer: `<button class="btn primary" id="setSave">Save settings</button>
               <button class="btn" data-close>Cancel</button>`,
    });

    const bitrate = $('#setBitrate', modal.root);
    if (bitrate) bitrate.value = cfg.options.mp3Bitrate || '128k';
    const loud = $('#setLoud', modal.root);
    if (loud) loud.value = String(cfg.options.loudnormTarget || -16);
    const orderSel = $('#setDebridOrder', modal.root);
    const orderFirst = ((cfg.debrid && cfg.debrid.providerOrder) || ['torbox'])[0];
    if (orderSel) orderSel.value = orderFirst === 'premiumize' ? 'premiumize' : 'torbox';

    const pickFolder = $('#setJobsPick', modal.root);
    if (pickFolder) pickFolder.addEventListener('click', async () => {
      pickFolder.disabled = true;
      try {
        const picked = await api('/api/folder/pick', { method: 'POST', body: '{}' });
        if (!picked.cancelled && picked.path) {
          const out = await api('/api/jobs/root', {
            method: 'POST',
            body: JSON.stringify({
              path: picked.path,
              move: !!$('#setJobsMove', modal.root).checked,
            }),
          });
          $('#setJobsRoot', modal.root).value = out.jobsRoot;
          S.config = await api('/api/config');
          YM.toast(out.restart
            ? 'Folder saved — restart Michael Yoto Maker to use it'
            : 'Folder unchanged', 'good', 4000);
        }
      } catch (err) {
        YM.toast(err.message, 'err', 4200);
      } finally {
        pickFolder.disabled = false;
      }
    });

    const importBtn = $('#setImportKeys', modal.root);
    if (importBtn) importBtn.addEventListener('click', async () => {
      importBtn.disabled = true;
      importBtn.textContent = 'Looking…';
      try {
        S.config = await api('/api/keys/import', { method: 'POST', body: '{}' });
        const found = (S.config.discovered || []).join(', ');
        YM.toast(found ? 'Found debrid keys for ' + found : 'No debrid keys found in Stremio',
          found ? 'good' : '', 3600);
        modal.close();
        openSettings();
        if (S.results) runSearch(S.query);
      } catch (err) {
        YM.toast(err.message, 'err', 4200);
        importBtn.disabled = false;
        importBtn.textContent = 'Import keys from Stremio';
      }
    });

    const connectBtn = $('#setYotoIn', modal.root);
    if (connectBtn) connectBtn.addEventListener('click', async () => {
      modal.close();
      await connectYoto();
    });
    const outBtn = $('#setYotoOut', modal.root);
    if (outBtn) outBtn.addEventListener('click', async () => {
      await api('/api/yoto/disconnect', { method: 'POST', body: '{}' });
      modal.close();
      await refreshConfig();
      YM.toast('Yoto disconnected', '', 2200);
    });

    $('#setSave', modal.root).addEventListener('click', async () => {
      const patch = {
        yoto: {
          clientId: $('#setYotoClient', modal.root).value.trim(),
          callbackUrl: $('#setYotoCallback', modal.root).value.trim(),
        },
        library: {
          system: $('#setLibSystem', modal.root).value.trim(),
          slug: $('#setLibSlug', modal.root).value.trim(),
        },
        archive: { contactEmail: $('#setArchiveEmail', modal.root).value.trim() },
        options: {
          mp3Bitrate: $('#setBitrate', modal.root).value,
          loudnorm: $('#setNormalise', modal.root).checked,
          loudnormTarget: Number($('#setLoud', modal.root).value),
          keepRaw: $('#setKeepRaw', modal.root).checked,
        },
      };
      const card = $('#setLibCard', modal.root).value.trim();
      const pin = $('#setLibPin', modal.root).value.trim();
      if (card) patch.library.cardNumber = card;
      if (pin) patch.library.pin = pin;
      const key = $('#setDeepseek', modal.root).value.trim();
      if (key) patch.deepseek = { apiKey: key };

      // Debrid: only submit keys that were typed (a blank box means
      // "unchanged", never "erase the saved key").
      const torbox = $('#setTorbox', modal.root).value.trim();
      const premiumize = $('#setPremiumize', modal.root).value.trim();
      if (torbox) patch.torbox = { apiKey: torbox };
      if (premiumize) patch.premiumize = { apiKey: premiumize };
      patch.debrid = {
        providerOrder: $('#setDebridOrder', modal.root).value === 'premiumize'
          ? ['premiumize', 'torbox'] : ['torbox', 'premiumize'],
      };

      // Torrent-site accounts. Same rule: blanks are not changes.
      patch.abb = { domain: $('#setAbbDomain', modal.root).value.trim() };
      const abbUser = $('#setAbbUser', modal.root).value.trim();
      const abbPass = $('#setAbbPass', modal.root).value.trim();
      if (abbUser) patch.abb.username = abbUser;
      if (abbPass) patch.abb.password = abbPass;
      patch.mam = {};
      const mamUser = $('#setMamUser', modal.root).value.trim();
      const mamPass = $('#setMamPass', modal.root).value.trim();
      const mamPin = $('#setMamPin', modal.root).value.trim();
      if (mamUser) patch.mam.username = mamUser;
      if (mamPass) patch.mam.password = mamPass;
      if (mamPin) patch.mam.pin = mamPin;

      try {
        S.config = await api('/api/config', { method: 'POST', body: JSON.stringify(patch) });
        modal.close();
        renderHint();
        YM.toast('Settings saved', 'good', 2200);
        if (S.results) runSearch(S.query);
      } catch (err) {
        YM.toast(err.message, 'err', 4200);
      }
    });
  }

  function confirmDialog(opts) {
    return new Promise((resolve) => {
      let settled = false;
      const modal = YM.UI.modal({
        title: opts.title,
        body: opts.body || '',
        footer: `<button class="btn primary" id="cfYes">${esc(opts.confirm || 'Continue')}</button>
                 <button class="btn" data-close>Cancel</button>`,
      });
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
        modal.close();
      };
      $('#cfYes', modal.root).addEventListener('click', () => finish(true));
      YM.$$('[data-close]', modal.root).forEach((b) => b.addEventListener('click', () => finish(false)));
      modal.backdrop.addEventListener('click', (e) => { if (e.target === modal.backdrop) finish(false); });
    });
  }

  /* ------------------------------------------------------------------ */
  /* player                                                             */
  /* ------------------------------------------------------------------ */

  const P = {
    audio: null,
    list: [],
    index: 0,
    book: '',
    graph: null,   // Web Audio tap used by the recorder, created once per element
    rate: 1,
    lastSave: 0,
    resumePending: null,   // a position to seek to, not yet confirmed
    resumeDone: '',        // key+index already restored this load
  };

  // Sleep timer: mode 0 = off, -1 = end of chapter, N = minutes. The deadline
  // is wall-clock so a backgrounded tab still expires on time.
  const SLEEP = { mode: 0, deadline: 0, timer: 0 };

  const RATE_KEY = 'player.rate';
  const SLEEP_KEY = 'player.sleep';
  const RESUME_PREFIX = 'resume.job.';

  function prefsGet(key, fallback) {
    try { return YM.Prefs ? YM.Prefs.get(key, fallback) : fallback; } catch (err) { return fallback; }
  }

  function prefsSet(key, value) {
    try { if (YM.Prefs) YM.Prefs.set(key, value); } catch (err) { /* storage may be off */ }
  }

  // Recording state. The recorder watches the player's own output, so a clip
  // is whatever actually played — seeks, track changes and pauses included.
  const R = {
    recorder: null,
    chunks: [],
    timer: 0,
    startedAt: 0,
    item: null,
  };

  function ensureAudio() {
    if (P.audio) return P.audio;
    const a = new Audio();
    a.preload = 'metadata';
    // In the document (silently) so Chrome will expose it to Web Audio when
    // the recorder taps it.
    a.style.display = 'none';
    document.body.appendChild(a);
    a.addEventListener('loadedmetadata', () => {
      restoreResume(a, 'metadata');
      updateTransport();
    });
    // canplay is the reliable moment to seek: a seek issued during
    // loadedmetadata can be aborted by the browser, which used to leave the
    // point at 0:00 and then save that 0 over the good one.
    a.addEventListener('canplay', () => {
      restoreResume(a, 'canplay');
      updateTransport();
    });
    a.addEventListener('seeked', () => {
      const want = P.resumePending;
      if (want == null) return;
      if (Math.abs((a.currentTime || 0) - want) < 1.5) {
        P.resumePending = null;
        const item = P.list[P.index];
        P.resumeDone = `${resumeKey(item)}:${P.index}`;
      }
    });
    a.addEventListener('durationchange', updateTransport);
    a.addEventListener('timeupdate', () => {
      updateTransport();
      saveResume(false);
    });
    a.addEventListener('play', () => {
      if (P.graph && P.graph.ctx.state === 'suspended') P.graph.ctx.resume().catch(() => {});
      paintTransport();
    });
    a.addEventListener('pause', () => {
      saveResume(true);
      paintTransport();
    });
    a.addEventListener('ended', () => {
      // "Sleep at end of chapter" stops here instead of advancing.
      if (SLEEP.mode === -1) {
        setSleep(0);
        paintTransport();
        updateTransport();
        if (R.recorder && Date.now() - R.startedAt > 2000) stopRecording();
        return;
      }
      if (P.index < P.list.length - 1) {
        P.index++;
        loadCurrent();
      } else {
        clearResume();
        paintTransport();
        updateTransport();
        // End of the queue: finish the take instead of recording silence.
        // The 2 s guard stops a take that began right at the end of a track
        // from killing itself before it captured anything.
        if (R.recorder && Date.now() - R.startedAt > 2000) stopRecording();
      }
    });
    a.addEventListener('error', () => {
      if (!a.src) return;
      YM.toast('Could not play that audio', 'err', 3200);
      paintTransport();
    });
    P.audio = a;
    return a;
  }

  function mmss(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  }

  /* ------------------------------------------------------------------ */
  /* recording                                                          */
  /* ------------------------------------------------------------------ */

  function recSupported() {
    return typeof MediaRecorder !== 'undefined'
      && typeof (window.AudioContext || window.webkitAudioContext) === 'function';
  }

  function pickRecMime() {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
    if (!MediaRecorder.isTypeSupported) return '';
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
  }

  /** Tap the player's element once; later takes reuse the same graph. */
  function captureGraph(a) {
    if (P.graph) return P.graph;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const source = ctx.createMediaElementSource(a);
    const stream = ctx.createMediaStreamDestination();
    // Two destinations: the speakers (so you still hear it) and the recorder.
    source.connect(ctx.destination);
    source.connect(stream);
    P.graph = { ctx, source, stream };
    return P.graph;
  }

  function recTitle(item) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const clock = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const base = (item && item.title) || P.book || 'clip';
    return `Recording — ${String(base).slice(0, 90)} (${clock})`;
  }

  function startRecording() {
    if (!recSupported()) {
      YM.toast('This browser cannot capture audio', 'err', 3200);
      return;
    }
    const item = P.list[P.index];
    if (!item) {
      YM.toast('Play something first — the recorder captures the player', '', 2800);
      return;
    }
    const a = ensureAudio();
    let graph;
    try {
      graph = captureGraph(a);
    } catch (err) {
      YM.toast('Could not tap the player audio — reload the panel', 'err', 3600);
      return;
    }
    // The click is the gesture that lets the context run.
    if (graph.ctx.state === 'suspended') graph.ctx.resume().catch(() => {});

    const mime = pickRecMime();
    let recorder;
    try {
      recorder = new MediaRecorder(
        graph.stream.stream,
        mime ? { mimeType: mime, audioBitsPerSecond: 128000 } : {}
      );
    } catch (err) {
      YM.toast('The recorder could not start', 'err', 3200);
      return;
    }

    R.recorder = recorder;
    R.chunks = [];
    R.item = item;
    R.startedAt = Date.now();
    recorder.addEventListener('dataavailable', (e) => {
      if (e.data && e.data.size) R.chunks.push(e.data);
    });
    recorder.addEventListener('stop', finishRecording);
    recorder.start(1000);

    // Sitting at the end of a track looks like "paused", but play() would fire
    // `ended` a moment later and our end-of-queue handler would kill the take
    // before it captured anything. Rewind instead.
    const duration = Number(a.duration) || 0;
    if (a.ended || (duration && a.currentTime >= duration - 0.3)) {
      a.currentTime = 0;
    }
    if (a.paused) {
      a.play().catch((err) => {
        // Autoplay policy or a dead source: say so and drop the empty take
        // rather than saving a clip of silence.
        YM.toast('Press play, then record', 'err', 3200);
        stopRecording();
      });
    }
    paintRecording();
    R.timer = setInterval(paintRecording, 250);
  }

  function stopRecording() {
    if (!R.recorder) return;
    try {
      R.recorder.stop();
    } catch (err) {
      /* already stopped */
    }
  }

  async function finishRecording() {
    const recorder = R.recorder;
    const item = R.item;
    const chunks = R.chunks;
    const seconds = Math.max(0, Math.round((Date.now() - R.startedAt) / 1000));
    R.recorder = null;
    R.item = null;
    R.chunks = [];
    if (R.timer) clearInterval(R.timer);
    R.timer = 0;
    paintRecording();

    const type = (recorder && recorder.mimeType) || 'audio/webm';
    const blob = new Blob(chunks, { type });
    if (!blob.size) {
      YM.toast('Nothing was captured', '', 2600);
      return;
    }
    const title = recTitle(item);
    try {
      YM.toast(`Saving ${mmss(seconds)} of audio…`, '', 1600);
      const res = await fetch('/api/record?title=' + encodeURIComponent(title), {
        method: 'POST',
        headers: { 'Content-Type': type },
        body: blob,
      });
      const text = await res.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { error: text.slice(0, 200) }; }
      if (!res.ok) throw new Error(data.error || ('Could not save the recording (' + res.status + ')'));
      YM.toast('“' + (data.title || title) + '” added to the queue', 'good', 3400);
      S.expanded[data.id] = true;
      await refreshJobs();
    } catch (err) {
      YM.toast(err.message, 'err', 5200);
    }
  }

  function paintRecording() {
    const box = $('#libPlayer');
    const on = !!R.recorder;
    if (box) box.classList.toggle('recording', on);
    const btn = $('#plRec');
    if (btn) {
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-label', on ? 'Stop recording' : 'Record what is playing');
      btn.title = on ? 'Stop recording — saves to the queue' : 'Record what is playing';
    }
    const time = $('#plRecTime');
    if (time && on) time.textContent = mmss((Date.now() - R.startedAt) / 1000);
  }

  function showPlayer() {
    const el = $('#libPlayer');
    if (el) el.classList.remove('hidden');
  }

  function paintTransport() {
    const box = $('#libPlayer');
    if (!box) return;
    const a = P.audio;
    const playing = !!(a && !a.paused && !a.ended);
    box.classList.toggle('playing', playing);
    const toggle = $('#plToggle');
    if (toggle) {
      toggle.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      toggle.title = playing ? 'Pause' : 'Play';
    }
    const prev = $('#plPrev');
    const next = $('#plNext');
    if (prev) prev.disabled = P.index <= 0;
    if (next) next.disabled = P.index >= P.list.length - 1;
    const rec = $('#plRec');
    // Nothing loaded means nothing to tap: the recorder is not disabled while
    // a take is running, so the same button can stop it.
    if (rec) rec.disabled = !P.list.length && !R.recorder;
  }

  function updateTransport() {
    const a = P.audio;
    const item = P.list[P.index];
    const title = $('#plTitle');
    const sub = $('#plSub');
    const time = $('#plTime');
    const seek = $('#plSeek');
    if (title) title.textContent = item ? item.title || 'Track' : 'Nothing playing';
    if (sub) {
      const parts = [];
      if (P.book) parts.push(P.book);
      if (P.list.length > 1) parts.push(`track ${P.index + 1} of ${P.list.length}`);
      if (SLEEP.deadline) {
        parts.push('sleep ' + mmss(Math.max(0, Math.round((SLEEP.deadline - Date.now()) / 1000))));
      } else if (SLEEP.mode === -1) {
        parts.push('sleep at end of chapter');
      }
      sub.textContent = parts.join(' · ');
    }
    const duration = a && isFinite(a.duration) ? a.duration : (item && item.duration) || 0;
    const position = a ? a.currentTime || 0 : 0;
    if (time) time.textContent = `${mmss(position)} / ${mmss(duration)}`;
    if (seek) {
      if (document.activeElement !== seek) {
        const value = duration ? String(Math.round((position / duration) * 1000)) : '0';
        seek.value = value;
        // Paint the played portion explicitly; a custom range input has no
        // built-in fill, so the bar would otherwise look inert.
        seek.style.background =
          `linear-gradient(to right, var(--accent) ${Number(value) / 10}%, var(--panel-3) ${Number(value) / 10}%)`;
      }
    }
    // Highlight the row that is currently playing.
    YM.$$('#libJobs .job-tracks li').forEach((li) => {
      const on = item && item.jobId && li.dataset.job === item.jobId &&
        Number(li.dataset.track) === item.trackNumber;
      li.classList.toggle('on', !!on);
    });
    paintTransport();
  }

  function loadCurrent() {
    const item = P.list[P.index];
    if (!item) return;
    const a = ensureAudio();
    P.lastSave = 0;
    P.resumePending = null;
    P.resumeDone = '';
    a.src = item.url;
    applyRate();
    showPlayer();
    updateTransport();
    a.play().catch((err) => {
      // Autoplay can be refused; the transport is still there to press.
      if (err && err.name === 'NotAllowedError') {
        YM.toast('Press play to start', '', 1800);
      }
    });
  }

  function playList(tracks, index, book) {
    P.list = tracks || [];
    P.index = Math.max(0, Math.min(index || 0, P.list.length - 1));
    P.book = book || '';
    if (!P.list.length) return;
    loadCurrent();
  }

  function togglePlay() {
    const a = ensureAudio();
    if (!a.src) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }

  function step(delta) {
    const nextIndex = P.index + delta;
    if (nextIndex < 0 || nextIndex >= P.list.length) return;
    P.index = nextIndex;
    loadCurrent();
  }

  function stopPlayback() {
    // A take in flight is saved, not thrown away with the player.
    if (R.recorder) stopRecording();
    saveResume(true);
    closeMenu();
    const a = P.audio;
    if (a) {
      a.pause();
      a.removeAttribute('src');
      a.load();
    }
    P.list = [];
    P.index = 0;
    P.book = '';
    const box = $('#libPlayer');
    if (box) box.classList.add('hidden');
  }

  /** Play a saved (streamed) book — no download, links minted per chapter. */
  function playLibraryBook(book, trackNumber) {
    const chapters = book.chapters || [];
    if (!chapters.length) {
      YM.toast('That saved book has no chapters', '', 2400);
      return;
    }
    const key = `resume.lib.${book.key}`;
    const tracks = chapters.map((chapter) => ({
      url: `/api/library/${encodeURIComponent(book.key)}/track/${chapter.index}`,
      title: chapter.title,
      duration: chapter.duration || 0,
      resumeKey: key,
      trackNumber: chapter.index,
    }));
    let index = trackNumber === undefined
      ? 0
      : Math.max(0, tracks.findIndex((t) => t.trackNumber === trackNumber));
    if (trackNumber === undefined) {
      const saved = prefsGet(key, null);
      if (saved && typeof saved === 'object'
          && (!saved.count || saved.count === tracks.length)
          && Number.isInteger(saved.index)
          && saved.index >= 0 && saved.index < tracks.length) {
        index = saved.index;
      }
    }
    playList(tracks, index, book.title);
  }

  /** Play a job's prepared tracks. */
  function playJob(job, trackNumber) {
    const tracks = (job.tracks || []).map((t) => ({
      url: `/api/job/${encodeURIComponent(job.id)}/track/${t.number}`,
      title: t.title,
      duration: t.duration,
      jobId: job.id,
      trackNumber: t.number,
    }));
    if (!tracks.length) {
      YM.toast('Nothing prepared to play yet', '', 2200);
      return;
    }
    // The job card's ▶ means "keep listening" (resume point); a chapter row
    // passes an explicit track number and means "jump there".
    let index = trackNumber === undefined
      ? 0
      : Math.max(0, tracks.findIndex((t) => t.trackNumber === trackNumber));
    if (trackNumber === undefined) {
      const saved = prefsGet(RESUME_PREFIX + job.id, null);
      if (saved && typeof saved === 'object'
          && (!saved.count || saved.count === tracks.length)
          && Number.isInteger(saved.index)
          && saved.index >= 0 && saved.index < tracks.length) {
        index = saved.index;
      }
    }
    playList(tracks, index, job.title);
  }

  /** Audition a search result straight from the source. */
  async function previewResult(source, id, btn) {
    if (btn) { btn.disabled = true; btn.classList.add('busy'); }
    try {
      const data = await api(`/api/preview?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}`);
      playList(
        [{ url: data.url, title: data.title, duration: data.duration }],
        0,
        data.book
      );
    } catch (err) {
      YM.toast(err.message, 'err', 4200);
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove('busy'); }
    }
  }

  /* ------------------------------------------------------------------ */
  /* speed, sleep timer, chapters, resume                               */
  /* ------------------------------------------------------------------ */
  /* Ported from the audiobook player's surface: the same speed range,
   * the same sleep choices, a chapter list for multi-file books, and a
   * resume point per job. */

  function clampRate(value) {
    const rate = Number(value);
    return SPEEDS.includes(rate) ? rate : 1;
  }

  function applyRate() {
    const a = P.audio;
    if (a) {
      a.playbackRate = P.rate;
      // Keep voices natural at speed (Chrome defaults to on; be explicit).
      a.preservesPitch = true;
      a.webkitPreservesPitch = true;
      a.mozPreservesPitch = true;
    }
    const btn = $('#plSpeed');
    if (btn) {
      btn.textContent = `${P.rate}×`;
      btn.title = `Playback speed (${P.rate}×)`;
      btn.classList.toggle('on', P.rate !== 1);
    }
  }

  function resumeKey(item) {
    if (!item) return '';
    // Saved books carry their own key; prepared jobs use the job id.
    if (item.resumeKey) return item.resumeKey;
    return item.jobId ? RESUME_PREFIX + item.jobId : '';
  }

  function saveResume(force) {
    const item = P.list[P.index];
    const a = P.audio;
    const key = resumeKey(item);
    if (!key || !a || !a.duration || !isFinite(a.duration)) return;
    // A restore is in flight: its seek has not landed yet, so writing now
    // would store 0:00 over the very point being restored.
    if (P.resumePending != null) return;
    const now = Date.now();
    if (!force && now - P.lastSave < 2000) return;  // timeupdate fires ~4×/s
    P.lastSave = now;
    prefsSet(key, {
      index: P.index,
      position: a.currentTime || 0,
      count: P.list.length,
      at: now,
    });
  }

  function restoreResume(a, stage) {
    const item = P.list[P.index];
    const key = resumeKey(item);
    if (!key || !a || !a.duration || !isFinite(a.duration)) return;
    if (P.resumeDone === `${key}:${P.index}`) return;
    const saved = prefsGet(key, null);
    if (!saved || typeof saved !== 'object') return;
    if (saved.count && saved.count !== P.list.length) return;  // chapters changed
    if (saved.index !== P.index) return;                       // another track
    const position = Number(saved.position) || 0;
    // Too close to either edge is not a meaningful resume point.
    if (position < 5 || position > a.duration - 10) return;
    if (stage !== 'canplay' && a.readyState < 3) {
      // Not seekable yet; canplay retries with the media ready.
      P.resumePending = position;
      return;
    }
    P.resumePending = position;
    try { a.currentTime = position; } catch (err) { P.resumePending = null; }
  }

  function clearResume() {
    const item = P.list[P.index];
    const key = resumeKey(item);
    if (key) prefsSet(key, null);
    P.resumePending = null;
  }

  function paintSleep() {
    const btn = $('#plSleep');
    if (!btn) return;
    const choice = SLEEP_CHOICES.find((c) => c.value === SLEEP.mode) || SLEEP_CHOICES[0];
    btn.title = choice.label;
    btn.classList.toggle('on', SLEEP.mode !== 0);
  }

  function setSleep(value) {
    SLEEP.mode = Number(value) || 0;
    SLEEP.deadline = 0;
    if (SLEEP.timer) { clearInterval(SLEEP.timer); SLEEP.timer = 0; }
    if (SLEEP.mode > 0) {
      SLEEP.deadline = Date.now() + SLEEP.mode * 60000;
      SLEEP.timer = setInterval(checkSleep, 1000);
    }
    paintSleep();
    updateTransport();
  }

  function checkSleep() {
    if (!SLEEP.deadline) return;
    if (Date.now() < SLEEP.deadline) { updateTransport(); return; }
    SLEEP.deadline = 0;
    if (SLEEP.timer) { clearInterval(SLEEP.timer); SLEEP.timer = 0; }
    SLEEP.mode = 0;
    const a = P.audio;
    if (a && !a.paused) a.pause();
    paintSleep();
    paintTransport();
    YM.toast('Sleep timer — paused', '', 2400);
  }

  let openMenuKind = '';
  let openMenuEl = null;
  let openMenuAnchor = null;

  function closeMenu() {
    if (openMenuEl) {
      openMenuEl.classList.add('hidden');
      openMenuEl.innerHTML = '';
      openMenuEl.onclick = null;
    }
    openMenuKind = '';
    openMenuEl = null;
    openMenuAnchor = null;
  }

  /** One popup primitive for the player and for list menus (#libMenu). */
  function openMenu(kind, anchor, items, menuEl) {
    const menu = menuEl || $('#plMenu');
    if (!menu || !anchor || !items.length) return;
    if (openMenuKind === kind && openMenuEl === menu) { closeMenu(); return; }
    closeMenu();
    openMenuKind = kind;
    openMenuEl = menu;
    openMenuAnchor = anchor;
    menu.innerHTML = items.map((item, index) =>
      `<button type="button" role="menuitem" class="pl-menu-item${item.active ? ' on' : ''}${item.danger ? ' danger' : ''}" data-menu-index="${index}">${esc(item.label)}</button>`
    ).join('');
    menu.classList.remove('hidden');
    // Measured after unhiding; anchored above the button, flipped below when
    // there is no room above.
    const rect = anchor.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    let left = rect.left;
    if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
    let top = rect.top - height - 8;
    if (top < 8) top = rect.bottom + 8;
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${top}px`;
    menu.onclick = (event) => {
      const button = event.target.closest('[data-menu-index]');
      if (!button) return;
      const item = items[Number(button.dataset.menuIndex)];
      closeMenu();
      if (item && item.action) item.action();
    };
  }

  /** The ··· menu on a queue card. */
  function openJobMenu(job, anchor) {
    const expanded = !!S.expanded[job.id];
    openMenu(`job:${job.id}`, anchor, [
      {
        label: expanded ? 'Hide details' : 'Show details',
        action: () => { S.expanded[job.id] = !expanded; renderJobs(); },
      },
      {
        label: 'Remove from queue…',
        danger: true,
        action: () => openDeleteConfirm(job),
      },
    ], $('#libMenu'));
  }

  function openSpeedMenu() {
    openMenu('speed', $('#plSpeed'), SPEEDS.map((rate) => ({
      label: rate === 1 ? 'Normal — 1×' : `${rate}×`,
      active: rate === P.rate,
      action: () => { P.rate = rate; prefsSet(RATE_KEY, rate); applyRate(); },
    })));
  }

  function openSleepMenu() {
    openMenu('sleep', $('#plSleep'), SLEEP_CHOICES.map((choice) => ({
      label: choice.label,
      active: choice.value === SLEEP.mode,
      action: () => setSleep(choice.value),
    })));
  }

  function openChaptersMenu() {
    if (!P.list.length) { YM.toast('Nothing loaded yet', '', 2000); return; }
    openMenu('chapters', $('#plChapters'), P.list.map((item, index) => ({
      label: `${index + 1}. ${item.title || 'Track'}${item.duration ? ' — ' + mmss(item.duration) : ''}`,
      active: index === P.index,
      action: () => { P.index = index; loadCurrent(); },
    })));
  }

  function bindPlayer() {
    const toggle = $('#plToggle');
    if (toggle) toggle.addEventListener('click', togglePlay);
    const prev = $('#plPrev');
    if (prev) prev.addEventListener('click', () => step(-1));
    const next = $('#plNext');
    if (next) next.addEventListener('click', () => step(1));
    const rec = $('#plRec');
    if (rec) {
      if (!recSupported()) {
        rec.hidden = true;
      } else {
        rec.addEventListener('click', () => {
          if (R.recorder) stopRecording();
          else startRecording();
        });
      }
    }
    const closeBtn = $('#plClose');
    if (closeBtn) closeBtn.addEventListener('click', stopPlayback);
    const seek = $('#plSeek');
    if (seek) {
      seek.addEventListener('input', () => {
        const a = ensureAudio();
        if (!a.duration || !isFinite(a.duration)) return;
        // A manual seek wins over an in-flight restore.
        P.resumePending = null;
        a.currentTime = (Number(seek.value) / 1000) * a.duration;
        updateTransport();
      });
    }
    const chaptersBtn = $('#plChapters');
    if (chaptersBtn) chaptersBtn.addEventListener('click', openChaptersMenu);
    const speedBtn = $('#plSpeed');
    if (speedBtn) speedBtn.addEventListener('click', openSpeedMenu);
    const sleepBtn = $('#plSleep');
    if (sleepBtn) sleepBtn.addEventListener('click', openSleepMenu);
    // Any click outside an open menu closes it.
    document.addEventListener('click', (event) => {
      if (!openMenuKind) return;
      if (openMenuEl && openMenuEl.contains(event.target)) return;
      if (openMenuAnchor && openMenuAnchor.contains(event.target)) return;
      closeMenu();
    });

    // Keep the listening speed across sessions; the sleep timer is
    // deliberately per-session, so a relaunch never pauses unexpectedly.
    P.rate = clampRate(prefsGet(RATE_KEY, 1));
    applyRate();
    paintSleep();
    // Nothing is loaded yet: start with the record button correctly disabled.
    paintTransport();
  }

  /* ------------------------------------------------------------------ */
  /* wire up                                                            */
  /* ------------------------------------------------------------------ */

  function init() {
    build();
    const results = $('#libResults');
    if (results) results.addEventListener('click', onResultsClick);
    const jobsBox = $('#libJobs');
    if (jobsBox) jobsBox.addEventListener('click', onJobsClick);
    const btn = $('#btnFind');
    if (btn) {
      btn.addEventListener('click', toggle);
      // The audiobook pipeline needs the local Python service (server.py).
      // On a static host such as GitHub Pages there is no /api, so offer the
      // designer on its own rather than a button that cannot work.
      api('/api/config').catch(() => {
        btn.style.display = 'none';
        const gap = btn.nextElementSibling;
        if (gap && gap.classList.contains('divider')) gap.style.display = 'none';
      });
    }
    // C opens the chapter list, like the audiobook player (typing wins).
    document.addEventListener('keydown', (event) => {
      if (!S.open || (event.key !== 'c' && event.key !== 'C')) return;
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
      const player = $('#libPlayer');
      if (!player || player.classList.contains('hidden')) return;
      event.preventDefault();
      openChaptersMenu();
    });
  }

  YM.Library = { init, open, close, toggle, refreshJobs };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window.YM);
