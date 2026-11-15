/* Michael Yoto Maker — sidebar, dialogs */
(function (YM) {
  'use strict';

  const UI = (YM.UI = {});
  const $ = YM.$;
  const $$ = YM.$$;
  const esc = YM.esc;

  const fmt = (n, d = 1) => {
    if (n == null || isNaN(n)) return '';
    const v = Math.round(n * Math.pow(10, d)) / Math.pow(10, d);
    return String(v);
  };
  const pct = (v, min, max) => YM.clamp(((v - min) / (max - min)) * 100, 0, 100).toFixed(1) + '%';

  function state() { return YM.App.S; }
  function project() { return YM.App.S.project; }
  function selected() { return YM.App.getSel(); }
  function layer() { const s = selected(); return s ? s.layer : null; }

  /* ------------------------------------------------------------------ */
  /* card navigator                                                     */
  /* ------------------------------------------------------------------ */

  UI.buildCardNav = function () {
    const el = $('#cardNav');
    if (!el || !project()) return;
    const L = YM.getLayout(project());
    el.style.gridTemplateColumns = `repeat(${L.cols}, minmax(0,1fr))`;
    let html = '';
    for (let i = 0; i < project().cards.length; i++) {
      const card = project().cards[i];
      const active = state().selectedCard === i;
      html += `<button class="card-chip ${active ? 'active' : ''} ${YM.hasContent(card) ? 'has-content' : ''}" data-card="${i}" title="Card ${i + 1}${YM.hasContent(card) ? ' — has a design' : ' — empty'}">${i + 1}</button>`;
    }
    el.innerHTML = html;
    const count = $('#cardCount');
    if (count) count.textContent = `${project().cards.length} · ${L.cols}×${L.rows}`;
  };

  $('#cardNav') && document.addEventListener('click', (e) => {
    const chip = e.target.closest('.card-chip');
    if (!chip) return;
    const i = Number(chip.dataset.card);
    if (isNaN(i)) return;
    YM.App.selectCard(i);
    YM.App.ensureCardVisible(i);
  });

  /* ------------------------------------------------------------------ */
  /* inspector building                                                 */
  /* ------------------------------------------------------------------ */

  function typeIcon(type) {
    if (type === 'text') return YM.icon('text', 14);
    if (type === 'image') return YM.icon('image', 14);
    return YM.icon('shape', 14);
  }

  function layerListHTML(card) {
    if (!card || !card.layers.length) {
      return `<div class="insp-empty" style="padding:8px 6px 10px">No layers yet. Drop an image, paste one, or add text.</div>`;
    }
    let html = '<div class="layer-list" id="layerListItems">';
    for (let i = card.layers.length - 1; i >= 0; i--) {
      const l = card.layers[i];
      const active = l.id === state().selectedLayerId;
      const hidden = l.visible === false;
      const thumb =
        l.type === 'image' && l.src
          ? `<img src="${esc(l.src)}" alt="">`
          : typeIcon(l.type);
      html += `<div class="layer-item ${active ? 'selected' : ''} ${hidden ? 'hidden-layer' : ''}" data-layer-id="${esc(l.id)}" title="${esc(YM.layerLabel(l))}">
        <div class="thumb">${thumb}</div>
        <div class="lname"><span class="type">${l.type === 'text' ? 'Text' : l.type === 'image' ? 'Image' : 'Shape'}</span><span class="txt">${esc(YM.layerLabel(l))}</span></div>
        <div class="lbtns">
          <button data-act="layer-vis" title="${hidden ? 'Show layer' : 'Hide layer'}">${hidden ? YM.icon('eyeOff', 13) : YM.icon('eye', 13)}</button>
          <button data-act="layer-up" title="Bring forward">${YM.icon('up', 13)}</button>
          <button data-act="layer-down" title="Send backward">${YM.icon('down', 13)}</button>
          <button data-act="layer-del" title="Delete layer">${YM.icon('trash', 13)}</button>
        </div>
      </div>`;
    }
    html += '</div>';
    return html;
  }

  function sectionTitle(t) {
    return `<div class="section"><div class="section-title">${t}</div></div>`;
  }

  function colorField({ field, value, fallback, allowClear, label }) {
    const isEmpty = !YM.normHex(value);
    const v = YM.normHex(value) || fallback || '#ffffff';
    return `<div class="color-field ${isEmpty && allowClear ? 'is-none' : ''}">
      <input type="color" data-field="${field}" value="${v}" aria-label="${esc(label || field)}">
      <span class="cv">${esc(label || '')}</span>
      ${allowClear ? `<button class="clear" data-act="clear-${field}" title="Remove">${YM.icon('close', 12)}</button>` : ''}
    </div>`;
  }

  function sliderRow({ field, label, value, min, max, step, unit, dec, filter, crop, prop }) {
    const p = pct(value, min, max);
    const data = filter ? `data-filter="${filter}"` : crop ? `data-crop="${crop}"` : `data-field="${field}"`;
    return `<div class="slider-row">
      <div class="slider-head"><span>${label}</span><span class="val">${fmt(value, dec == null ? 0 : dec)}${unit || ''}</span></div>
      <input type="range" ${data} min="${min}" max="${max}" step="${step}" value="${value}" style="--p:${p}">
    </div>`;
  }

  function numField({ field, label, value, step = 0.5, min, max, filter, crop, prop, width }) {
    const data = filter ? `data-filter="${filter}"` : crop ? `data-crop="${crop}"` : `data-field="${field}"`;
    return `<div class="field" style="${width ? 'width:' + width + 'px' : ''}"><label>${label}</label><input type="number" ${data} value="${fmt(value, 2)}" step="${step}" ${min != null ? `min="${min}"` : ''} ${max != null ? `max="${max}"` : ''}></div>`;
  }

  function textPanel(l) {
    const fonts = YM.FONTS.map((f) => `<option value="${esc(f)}" ${f === l.font ? 'selected' : ''}>${esc(f)}</option>`).join('');
    return `
      <div class="section">
        <div class="section-title">Text</div>
        <textarea class="textarea" data-field="text" rows="2" spellcheck="false">${esc(l.text)}</textarea>
        <div class="row" style="margin-top:8px">
          <div class="field grow" style="min-width:0">
            <select data-field="font" title="Font">${fonts}</select>
          </div>
          <button class="chip" data-act="add-font" title="Load a font file">+ Font</button>
        </div>
        <div class="row">
          ${numField({ field: 'size', label: 'Size', value: l.size, step: 0.25, min: 0.5, max: 400 })}
          <div class="seg tight" style="flex:1">
            <button data-act="text-bold" class="${l.bold ? 'on' : ''}" title="Bold"><b>B</b></button>
            <button data-act="text-italic" class="${l.italic ? 'on' : ''}" title="Italic"><i>I</i></button>
            <button data-act="text-underline" class="${l.underline ? 'on' : ''}" title="Underline"><u>U</u></button>
            <button data-act="text-upper" class="${l.uppercase ? 'on' : ''}" title="Uppercase">AA</button>
          </div>
        </div>
        <div class="row">
          <div class="seg" style="flex:1">
            <button data-act="align-left" class="${l.align === 'left' ? 'on' : ''}" title="Align left">
              <svg viewBox="0 0 24 24"><path d="M4 6h16M4 10h10M4 14h16M4 18h8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>
            </button>
            <button data-act="align-center" class="${l.align === 'center' ? 'on' : ''}" title="Align center">
              <svg viewBox="0 0 24 24"><path d="M4 6h16M7 10h10M4 14h16M8 18h8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>
            </button>
            <button data-act="align-right" class="${l.align === 'right' ? 'on' : ''}" title="Align right">
              <svg viewBox="0 0 24 24"><path d="M4 6h16M10 10h10M4 14h16M12 18h8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>
            </button>
          </div>
          <div class="field" style="width:76px"><label>W</label><input type="number" data-field="w" value="${fmt(l.w, 1)}" step="0.5" min="4"><span class="muted" style="font-size:9px">mm</span></div>
        </div>
        <div class="row">
          ${colorField({ field: 'color', value: l.color, fallback: '#ffffff', label: 'Fill' })}
          ${colorField({ field: 'strokeColor', value: l.strokeColor, fallback: '#000000', label: 'Outline' })}
        </div>
        <div class="row">
          ${colorField({ field: 'bgColor', value: l.bgColor, fallback: '#000000', label: 'Box', allowClear: true })}
        </div>
        ${sliderRow({ field: 'strokeWidth', label: 'Outline thickness', value: l.strokeWidth, min: 0, max: 4, step: 0.05, unit: ' mm', dec: 2 })}
        ${l.bgColor ? sliderRow({ field: 'bgPadding', label: 'Box padding', value: l.bgPadding, min: 0, max: 8, step: 0.1, unit: ' mm', dec: 1 }) : ''}
        ${l.bgColor ? sliderRow({ field: 'bgRadius', label: 'Box corner radius', value: l.bgRadius, min: 0, max: 12, step: 0.1, unit: ' mm', dec: 1 }) : ''}
        ${sliderRow({ field: 'lineHeight', label: 'Line spacing', value: l.lineHeight, min: 0.7, max: 2.2, step: 0.02, unit: '', dec: 2 })}
        ${sliderRow({ field: 'letterSpacing', label: 'Letter spacing', value: l.letterSpacing, min: -1.5, max: 4, step: 0.02, unit: ' mm', dec: 2 })}
        <div class="row" style="margin-top:4px">
          <button class="chip ${l.shadow ? 'accent' : ''}" data-act="text-shadow">Shadow</button>
          <button class="chip" data-act="duplicate-layer">Duplicate</button>
          <button class="chip" data-act="delete-layer">Delete</button>
        </div>
      </div>`;
  }

  function imagePanel(l) {
    const f = l.filters || (l.filters = { brightness: 100, contrast: 100, saturate: 100, hue: 0, blur: 0, grayscale: 0, sepia: 0 });
    const cw = l.crop ? l.crop.z : 1;
    const frameAspect = l.w / l.h;
    const imgAspect = (l.imgW || 1) / (l.imgH || 1);
    const coverZ = Math.min(1, frameAspect / imgAspect);
    const zoomPct = YM.clamp((coverZ / cw) * 100, 100, 800);
    const ch = (cw * l.imgW * l.h) / (l.imgH * l.w);
    const cx = l.crop ? l.crop.cx : 0.5;
    const cy = l.crop ? l.crop.cy : 0.5;
    const panX = cw >= 1 ? 50 : ((cx - cw / 2) / (1 - cw)) * 100;
    const panY = ch >= 1 ? 50 : ((cy - ch / 2) / (1 - ch)) * 100;
    const effDpi = Math.round(((l.crop ? l.crop.z : 1) * (l.imgW || 0)) / (l.w / 25.4));
    const dpiClass = effDpi >= 240 ? 'good' : effDpi >= 150 ? '' : 'warn';
    const dpiColor = effDpi >= 240 ? 'var(--good)' : effDpi >= 150 ? '#e8c76a' : 'var(--danger)';

    return `
      <div class="section">
        <div class="section-title">Image</div>
        <div class="row">
          <button class="chip" data-act="replace-image" title="Choose a different picture for this layer">Replace</button>
          <button class="chip ${state().cropMode ? 'accent' : ''}" data-act="crop-toggle" title="Crop and zoom this picture">${state().cropMode ? 'Done' : 'Crop'}</button>
          <button class="chip" data-act="fit-fill" title="Stretch the picture edge to edge">Fill</button>
          <button class="chip" data-act="fit-contain" title="Show the whole picture, letterboxed">Fit</button>
        </div>
        <div class="hint" style="margin-bottom:6px">${l.imgW} × ${l.imgH} px · about <b style="color:${dpiColor}">${effDpi} DPI</b> at this size${effDpi < 150 ? ' — may look soft in print' : ''}</div>
        ${state().cropMode ? `
          <div class="card-note" style="margin-bottom:10px">Drag the picture to reposition, scroll to zoom, or use the sliders. Drag the frame handles to change the shape.</div>
          ${sliderRow({ crop: 'zoom', label: 'Crop zoom', value: Math.round(zoomPct), min: 100, max: 500, step: 1, unit: '%', dec: 0 })}
          ${sliderRow({ crop: 'panx', label: 'Move horizontally', value: Math.round(panX), min: 0, max: 100, step: 1, unit: '%', dec: 0 })}
          ${sliderRow({ crop: 'pany', label: 'Move vertically', value: Math.round(panY), min: 0, max: 100, step: 1, unit: '%', dec: 0 })}
          <div class="row">
            <button class="chip" data-act="crop-reset">Reset crop</button>
            <button class="chip" data-act="flip-h">Flip H</button>
            <button class="chip" data-act="flip-v">Flip V</button>
          </div>
        ` : `<div class="row"><button class="chip" data-act="crop-reset">Reset crop</button><button class="chip" data-act="flip-h">Flip H</button><button class="chip" data-act="flip-v">Flip V</button></div>`}

        <details class="fold">
          <summary>Photo adjustments <span class="muted">${adjustCount(f) ? '· adjusted' : ''}</span></summary>
          <div style="padding-top:6px">
            ${sliderRow({ filter: 'brightness', label: 'Brightness', value: f.brightness, min: 20, max: 200, step: 1, unit: '%', dec: 0 })}
            ${sliderRow({ filter: 'contrast', label: 'Contrast', value: f.contrast, min: 20, max: 200, step: 1, unit: '%', dec: 0 })}
            ${sliderRow({ filter: 'saturate', label: 'Saturation', value: f.saturate, min: 0, max: 220, step: 1, unit: '%', dec: 0 })}
            ${sliderRow({ filter: 'hue', label: 'Hue', value: f.hue, min: -180, max: 180, step: 1, unit: '°', dec: 0 })}
            ${sliderRow({ filter: 'blur', label: 'Blur', value: f.blur, min: 0, max: 3, step: 0.05, unit: ' mm', dec: 2 })}
            ${sliderRow({ filter: 'grayscale', label: 'Black & white', value: f.grayscale, min: 0, max: 100, step: 1, unit: '%', dec: 0 })}
            ${sliderRow({ filter: 'sepia', label: 'Sepia', value: f.sepia, min: 0, max: 100, step: 1, unit: '%', dec: 0 })}
            <button class="chip" data-act="reset-filters">Reset adjustments</button>
          </div>
        </details>
      </div>`;
  }

  function adjustCount(f) {
    if (!f) return 0;
    return (
      (f.brightness !== 100) + (f.contrast !== 100) + (f.saturate !== 100) +
      (f.hue !== 0) + (f.blur !== 0) + (f.grayscale !== 0) + (f.sepia !== 0)
    );
  }

  function shapePanel(l) {
    return `
      <div class="section">
        <div class="section-title">Shape</div>
        <div class="row">
          <div class="seg" style="flex:1">
            <button data-act="shape-rect" class="${l.shape !== 'ellipse' ? 'on' : ''}">Rectangle</button>
            <button data-act="shape-ellipse" class="${l.shape === 'ellipse' ? 'on' : ''}">Ellipse</button>
          </div>
        </div>
        <div class="row">
          ${colorField({ field: 'fill', value: l.fill, fallback: '#ffb020', label: 'Fill' })}
          ${colorField({ field: 'strokeColor', value: l.strokeColor, fallback: '#000000', label: 'Stroke', allowClear: true })}
        </div>
        ${sliderRow({ field: 'strokeWidth', label: 'Stroke width', value: l.strokeWidth, min: 0, max: 5, step: 0.05, unit: ' mm', dec: 2 })}
        ${l.shape !== 'ellipse' ? sliderRow({ field: 'radius', label: 'Corner radius', value: l.radius, min: 0, max: 30, step: 0.2, unit: ' mm', dec: 1 }) : ''}
        <div class="row">
          <button class="chip" data-act="duplicate-layer">Duplicate</button>
          <button class="chip" data-act="delete-layer">Delete</button>
        </div>
      </div>`;
  }

  function transformPanel(l) {
    const isText = l.type === 'text';
    return `
      <div class="section">
        <div class="section-title">Position &amp; size</div>
        <div class="row">
          ${numField({ field: 'x', label: 'X', value: l.x, step: 0.5 })}
          ${numField({ field: 'y', label: 'Y', value: l.y, step: 0.5 })}
        </div>
        <div class="row">
          ${isText
            ? `<div class="field" style="flex:1"><label>W</label><input type="number" data-field="w" value="${fmt(l.w, 1)}" step="0.5" min="4"><span class="muted" style="font-size:9px">mm</span></div>`
            : `${numField({ field: 'w', label: 'W', value: l.w, step: 0.5, min: 1 })}${numField({ field: 'h', label: 'H', value: l.h, step: 0.5, min: 1 })}`}
          ${numField({ field: 'rot', label: '°', value: l.rot, step: 1 })}
        </div>
        ${sliderRow({ field: 'opacity', label: 'Opacity', value: Math.round((l.opacity == null ? 1 : l.opacity) * 100), min: 0, max: 100, step: 1, unit: '%', dec: 0 })}
        <div class="row">
          <div class="seg tight" style="flex:1">
            <button data-act="order-back" title="Send to back">${YM.icon('bottom', 15)}</button>
            <button data-act="order-down" title="Send backward">${YM.icon('down', 15)}</button>
            <button data-act="order-up" title="Bring forward">${YM.icon('up', 15)}</button>
            <button data-act="order-front" title="Bring to front">${YM.icon('top', 15)}</button>
          </div>
          <button class="chip ${l.locked ? 'accent' : ''}" data-act="lock-layer" title="Lock layer">${YM.icon(l.locked ? 'lock' : 'unlock', 14)}</button>
        </div>
      </div>`;
  }

  function cardPanel(s) {
    const L = project()._layout;
    const card = s.card;
    return `
      <div class="card-note" style="margin-bottom:10px">
        <b>Card ${s.cardIndex + 1}</b> of ${project().cards.length} · ${fmt(project().card.width, 2)} × ${fmt(project().card.height, 2)} mm
      </div>
      <div class="section">
        <div class="section-title">Card background</div>
        <div class="row">${colorField({ field: 'cardBg', value: card.bg, fallback: '#ffffff', label: 'Fill', allowClear: true })}</div>
      </div>
      <div class="section">
        <div class="section-title">Design tools</div>
        <div class="chip-row">
          <button class="chip" data-act="add-text">${YM.icon('plus', 13)} Text</button>
          <button class="chip" data-act="add-image">${YM.icon('plus', 13)} Image</button>
          <button class="chip" data-act="add-shape">${YM.icon('plus', 13)} Shape</button>
        </div>
        <div class="chip-row" style="margin-top:7px">
          <button class="chip" data-act="copy-card">Copy design</button>
          <button class="chip" data-act="paste-card" ${state().clipboardCard ? '' : 'disabled style="opacity:.45"'}>Paste design</button>
          <button class="chip" data-act="next-empty">Copy to next empty</button>
          <button class="chip" data-act="apply-empty">Fill empty cards</button>
          <button class="chip" data-act="clear-card">Clear card</button>
        </div>
        <div class="hint" style="margin-top:8px">Drop or paste images anywhere on a card — each card clips its own artwork, so nothing touches the neighbours.</div>
      </div>`;
  }

  function pagePanel() {
    const p = project();
    const L = YM.getLayout(p);
    return `
      <div class="card-note" style="margin-bottom:10px">
        <b>${p.cards.length}</b> cards on this sheet · ${fmt(p.page.width, 1)} × ${fmt(p.page.height, 1)} mm<br>
        Card size ${fmt(p.card.width, 2)} × ${fmt(p.card.height, 2)} mm · ${L.cols} columns × ${L.rows} rows
      </div>
      <div class="section">
        <div class="section-title">Sheet</div>
        <div class="chip-row">
          <button class="chip accent" data-act="page-setup">Change page &amp; card size…</button>
          <button class="chip" data-act="fit-view">Reset zoom</button>
        </div>
        <div class="hint" style="margin-top:10px">Click any card on the sheet to start working on it.</div>
      </div>`;
  }

  UI.buildInspector = function () {
    const insp = $('#inspector');
    const title = $('#inspectorTitle');
    if (!insp || !project()) return;
    const scroll = insp.scrollTop;
    const s = selected();
    const l = s ? s.layer : null;

    if (!s) {
      if (title) title.textContent = 'Sheet';
      insp.innerHTML = pagePanel();
      return;
    }

    if (title) title.textContent = l ? (l.type === 'text' ? 'Text' : l.type === 'image' ? 'Image' : 'Shape') : `Card ${s.cardIndex + 1}`;

    let html = '';
    if (!l) {
      html += cardPanel(s);
      html += `<div class="section"><div class="section-title">Layers</div>${layerListHTML(s.card)}</div>`;
      if (!s.card.layers.length) {
        html += `<div class="hint" style="margin-top:10px">Tip: press <span class="kbd">T</span> to add text, or <span class="kbd">Ctrl</span>+<span class="kbd">V</span> to paste an image.</div>`;
      }
    } else {
      html += `<div class="section"><div class="section-title">Layers</div>${layerListHTML(s.card)}</div>`;
      if (l.type === 'text') html += textPanel(l);
      else if (l.type === 'image') html += imagePanel(l);
      else html += shapePanel(l);
      html += transformPanel(l);
    }
    insp.innerHTML = html;
    insp.scrollTop = scroll;
    updateSliderFills(insp);
  };

  UI.updateLayerList = function () {
    const s = selected();
    if (!s) return;
    const list = $('#inspector').querySelector('#layerListItems');
    if (!list) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = layerListHTML(s.card);
    const fresh = wrap.firstElementChild;
    if (fresh) list.replaceWith(fresh);
  };

  UI.updateInspectorNumbers = function () {
    const s = selected();
    if (!s || !s.layer) return;
    const insp = $('#inspector');
    if (!insp) return;
    const l = s.layer;
    const set = (field, v) => {
      const el = insp.querySelector(`[data-field="${field}"]`);
      if (el && document.activeElement !== el) el.value = fmt(v, 2);
    };
    set('x', l.x);
    set('y', l.y);
    if (l.type !== 'text') { set('w', l.w); set('h', l.h); }
    else set('w', l.w);
    set('rot', l.rot);
    // crop readouts
    if (l.type === 'image') {
      const cw = l.crop.z;
      const frameAspect = l.w / l.h;
      const imgAspect = l.imgW / l.imgH;
      const coverZ = Math.min(1, frameAspect / imgAspect);
      const zoomEl = insp.querySelector('[data-crop="zoom"]');
      if (zoomEl) {
        const z = YM.clamp((coverZ / cw) * 100, 100, 500);
        zoomEl.value = z;
        zoomEl.style.setProperty('--p', pct(z, 100, 500));
        const head = zoomEl.closest('.slider-row').querySelector('.val');
        if (head) head.textContent = Math.round(z) + '%';
      }
    }
  };

  function updateSliderFills(root) {
    $$('input[type=range]', root || document).forEach((r) => {
      const min = Number(r.min), max = Number(r.max), val = Number(r.value);
      r.style.setProperty('--p', pct(val, min, max));
    });
  }

  /* ------------------------------------------------------------------ */
  /* inspector events                                                   */
  /* ------------------------------------------------------------------ */

  function bindInspectorEvents() {
    const insp = $('#inspector');
    if (!insp) return;

    insp.addEventListener('click', (e) => {
      const actEl = e.target.closest('[data-act]');
      if (actEl) {
        e.preventDefault();
        e.stopPropagation();
        handleAction(actEl.dataset.act, actEl);
        return;
      }
      const item = e.target.closest('.layer-item');
      if (item) {
        YM.App.selectLayer(item.dataset.layerId);
      }
    });

    insp.addEventListener('input', (e) => {
      const t = e.target;
      if (t.type === 'range') {
        updateSliderFills(t.parentElement);
        handleRange(t);
        return;
      }
      if (t.tagName === 'TEXTAREA') {
        handleField(t, true);
        return;
      }
      if (t.type === 'color') {
        handleField(t);
      }
    });

    insp.addEventListener('change', (e) => {
      const t = e.target;
      if (t.type === 'range') return;
      if (t.tagName === 'SELECT' || t.type === 'number' || t.type === 'color') {
        handleField(t);
        // Turning the text highlight box on/off reveals extra controls.
        if (t.dataset && t.dataset.field === 'bgColor') setTimeout(() => UI.buildInspector(), 0);
      }
    });
  }

  function handleRange(t) {
    const v = Number(t.value);
    if (t.dataset.filter) {
      YM.App.setFilter(t.dataset.filter, v);
      const val = t.closest('.slider-row') && t.closest('.slider-row').querySelector('.val');
      if (val) val.textContent = fmt(v, decFor(t.dataset.filter)) + unitFor(t.dataset.filter);
      return;
    }
    if (t.dataset.crop) {
      const shown = YM.App.setCrop(t.dataset.crop, v);
      const val = t.closest('.slider-row') && t.closest('.slider-row').querySelector('.val');
      if (val && shown) val.textContent = shown;
      return;
    }
    const field = t.dataset.field;
    if (field === 'opacity') {
      YM.App.setLayerProp('opacity', v / 100, { tag: 'opacity', noList: true });
    } else {
      YM.App.setLayerProp(field, v, { tag: 'slider:' + field, noList: true });
    }
    const val = t.closest('.slider-row') && t.closest('.slider-row').querySelector('.val');
    if (val) {
      if (field === 'strokeWidth') val.textContent = fmt(v, 2) + ' mm';
      else if (field === 'lineHeight') val.textContent = fmt(v, 2);
      else if (field === 'letterSpacing') val.textContent = fmt(v, 2) + ' mm';
      else if (field === 'size') val.textContent = fmt(v, 2) + ' mm';
      else val.textContent = fmt(v, 0) + '%';
    }
  }

  const FILTER_DEC = { brightness: 0, contrast: 0, saturate: 0, hue: 0, blur: 2, grayscale: 0, sepia: 0 };
  const FILTER_UNIT = { brightness: '%', contrast: '%', saturate: '%', hue: '°', blur: ' mm', grayscale: '%', sepia: '%' };
  const decFor = (k) => (FILTER_DEC[k] == null ? 0 : FILTER_DEC[k]);
  const unitFor = (k) => FILTER_UNIT[k] || '';

  function handleField(t, live) {
    const s = selected();
    if (!s) return;
    const l = s.layer;
    const key = t.dataset.field;
    if (!key) return;

    if (key === 'cardBg') {
      YM.App.setCardBg(t.value === '#ffffff' ? null : t.value);
      return;
    }
    if (!l) return;

    let value;
    if (t.type === 'number') {
      value = Number(t.value);
      if (isNaN(value)) return;
      if (key === 'w') value = Math.max(4, value);
      if (key === 'h') value = Math.max(1, value);
    } else {
      value = t.value;
    }

    if (key === 'text') {
      YM.App.setLayerProp('text', value, { noList: !live, tag: 'text' });
      if (live) YM.UI.updateLayerList();
      return;
    }
    if (key === 'opacity') {
      YM.App.setLayerProp('opacity', Number(value) / 100, { tag: 'opacity' });
      return;
    }
    if (key === 'size') {
      YM.App.setLayerProp('size', YM.clamp(Number(value), 0.5, 400), { tag: 'size', noList: true });
      return;
    }
    if (key === 'bgColor' || key === 'color' || key === 'strokeColor' || key === 'fill') {
      YM.App.setLayerProp(key, value, { tag: 'color:' + key, noList: true });
      return;
    }
    if (t.tagName === 'SELECT') {
      YM.App.setLayerProp(key, value, { noList: true });
      return;
    }
    YM.App.setLayerProp(key, Number(value), { tag: 'field:' + key, noList: true });
  }

  function handleAction(act, el) {
    const App = YM.App;
    const s = selected();
    const l = s ? s.layer : null;
    switch (act) {
      case 'layer-vis': {
        const item = el.closest('.layer-item');
        if (item) App.toggleLayerVisible(item.dataset.layerId);
        break;
      }
      case 'layer-up': App.orderLayer('up'); break;
      case 'layer-down': App.orderLayer('down'); break;
      case 'layer-del': App.deleteLayer(); break;
      case 'order-front': App.orderLayer('front'); break;
      case 'order-back': App.orderLayer('back'); break;
      case 'order-up': App.orderLayer('up'); break;
      case 'order-down': App.orderLayer('down'); break;
      case 'duplicate-layer': App.duplicateLayer(); break;
      case 'delete-layer': App.deleteLayer(); break;
      case 'lock-layer': if (l) App.toggleLayerLock(l.id); break;
      case 'text-bold': if (l) App.setLayerProp('bold', !l.bold, { noList: true }); App.buildInspector(); break;
      case 'text-italic': if (l) App.setLayerProp('italic', !l.italic, { noList: true }); App.buildInspector(); break;
      case 'text-underline': if (l) App.setLayerProp('underline', !l.underline, { noList: true }); App.buildInspector(); break;
      case 'text-upper': if (l) App.setLayerProp('uppercase', !l.uppercase, { noList: true }); App.buildInspector(); break;
      case 'text-shadow': if (l) App.setLayerProp('shadow', !l.shadow, { noList: true, tag: 'shadow' }); App.buildInspector(); break;
      case 'align-left': if (l) App.setLayerProp('align', 'left', { noList: true }); App.buildInspector(); break;
      case 'align-center': if (l) App.setLayerProp('align', 'center', { noList: true }); App.buildInspector(); break;
      case 'align-right': if (l) App.setLayerProp('align', 'right', { noList: true }); App.buildInspector(); break;
      case 'clear-color': break;
      case 'clear-bgColor': App.setLayerProp('bgColor', null, { tag: 'bgColor' }); App.buildInspector(); break;
      case 'clear-strokeColor': App.setLayerProp('strokeColor', null, { tag: 'strokeColor' }); App.buildInspector(); break;
      case 'clear-fill': App.setLayerProp('fill', null, { tag: 'fill' }); App.buildInspector(); break;
      case 'clear-cardBg': App.setCardBg(null); App.buildInspector(); break;
      case 'add-font': document.getElementById('fileFont').click(); break;
      case 'replace-image': App.replaceImage(); break;
      case 'crop-toggle': state().cropMode ? App.exitCrop() : App.enterCrop(); break;
      case 'crop-reset': App.resetCrop(); break;
      case 'fit-fill': App.fitLayer('fill'); break;
      case 'fit-contain': App.fitLayer('contain'); break;
      case 'fit-cover': App.fitLayer('cover'); break;
      case 'flip-h': if (l) { App.setLayerProp('flipH', !l.flipH, { tag: 'flipH', noList: true }); App.buildInspector(); } break;
      case 'flip-v': if (l) { App.setLayerProp('flipV', !l.flipV, { tag: 'flipV', noList: true }); App.buildInspector(); } break;
      case 'reset-filters':
        if (l) {
          App.pushHistory();
          l.filters = { brightness: 100, contrast: 100, saturate: 100, hue: 0, blur: 0, grayscale: 0, sepia: 0 };
          App.commit();
          App.buildInspector();
        }
        break;
      case 'shape-rect': if (l) { App.setLayerProp('shape', 'rect', { tag: 'shape', noList: true }); App.buildInspector(); } break;
      case 'shape-ellipse': if (l) { App.setLayerProp('shape', 'ellipse', { tag: 'shape', noList: true }); App.buildInspector(); } break;
      case 'add-text': App.addTextLayer(); break;
      case 'add-image': App.pickImage(state().selectedCard); break;
      case 'add-shape': App.addShapeLayer('rect'); break;
      case 'copy-card': App.copyCard(); break;
      case 'paste-card': App.pasteCard(); break;
      case 'apply-empty': App.applyToEmptyCards(); break;
      case 'next-empty': App.duplicateToNextEmpty(); break;
      case 'clear-card': App.clearCard(); break;
      case 'page-setup': UI.openPageSetup(); break;
      case 'fit-view': YM.App.zoomFit(); break;
      default: break;
    }
  }

  /* ------------------------------------------------------------------ */
  /* misc UI sync                                                       */
  /* ------------------------------------------------------------------ */

  UI.setTool = function (tool) {
    $$('#toolbar .tool[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
  };

  UI.syncToggles = function () {
    const s = state();
    $('#btnGuides').classList.toggle('on', !!s.showGuides);
    $('#btnNumbers').classList.toggle('on', !!s.showNumbers);
  };

  UI.updateHistoryButtons = function () {
    const s = state();
    const u = $('#btnUndo');
    const r = $('#btnRedo');
    if (u) u.disabled = !s.history.length;
    if (r) r.disabled = !s.redoStack.length;
  };

  UI.setProjectName = function (name) {
    const el = $('#projectName');
    if (el) el.value = name || 'Untitled sheet';
    document.title = (name || 'Untitled sheet') + ' — Michael Yoto Maker';
  };

  const TOOL_HINTS = {
    select: 'Drag a layer to move · corner handles resize · double-click text to edit · wheel zooms',
    text: 'Click a card to place a text box',
    image: 'Click a card to choose an image — or drag & drop / paste onto any card',
    shape: 'Click a card to place a shape',
  };

  UI.updateStatus = function () {
    const s = state();
    const hint = $('#statusHint');
    const right = $('#statusRight');
    if (!hint || !right) return;
    if (s.editingText) hint.textContent = 'Editing text — Esc or click away when finished';
    else if (s.cropMode) hint.textContent = 'Crop mode · drag the image to reposition · scroll to zoom · click Done cropping';
    else if (!s.tool || s.tool === 'select') hint.textContent = TOOL_HINTS.select;
    else hint.textContent = TOOL_HINTS[s.tool] || TOOL_HINTS.select;

    if (!project()) { right.innerHTML = ''; return; }
    const sel = selected();
    const bits = [];
    bits.push(`<span>${fmt(project().page.width, 1)} × ${fmt(project().page.height, 1)} mm</span>`);
    bits.push(`<span>Card <b>${fmt(project().card.width, 2)} × ${fmt(project().card.height, 2)} mm</b></span>`);
    if (sel) bits.push(`<span>Card <b>${sel.cardIndex + 1}</b>/${project().cards.length}</span>`);
    bits.push(`<span><b>${Math.round(state().view.zoom * 100)}%</b></span>`);
    right.innerHTML = bits.join('');
  };

  /* ------------------------------------------------------------------ */
  /* modal helpers                                                      */
  /* ------------------------------------------------------------------ */

  UI.modal = function (opts) {
    const root = $('#modalRoot');
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const box = document.createElement('div');
    box.className = 'modal' + (opts.wide ? ' wide' : '');
    box.innerHTML = `
      <div class="modal-head">
        <div>
          <h2>${esc(opts.title)}</h2>
          ${opts.subtitle ? `<p>${opts.subtitle}</p>` : ''}
        </div>
        <button class="close" data-close aria-label="Close">
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="modal-body">${opts.body || ''}</div>
      <div class="modal-foot">${opts.footer || ''}</div>`;
    backdrop.appendChild(box);
    root.appendChild(backdrop);
    const close = () => {
      document.removeEventListener('keydown', onEsc);
      backdrop.remove();
    };
    const onEsc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onEsc);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop && opts.dismissable !== false) close();
    });
    $$('[data-close]', box).forEach((b) => b.addEventListener('click', close));
    requestAnimationFrame(() => {
      const first = box.querySelector('input, select, textarea, button.primary');
      if (first) try { first.focus(); } catch (e) { /* ignore */ }
    });
    return { root: box, close, backdrop };
  };

  /* ------------------------------------------------------------------ */
  /* page setup                                                         */
  /* ------------------------------------------------------------------ */

  UI.openPageSetup = function (mode) {
    const isNew = mode === 'new';
    const p = project();
    const pagePreset = isNew ? 'letter' : Object.keys(YM.PAGE_PRESETS).find((k) => YM.PAGE_PRESETS[k].w === p.page.width && YM.PAGE_PRESETS[k].h === p.page.height) || 'custom';
    const cardPreset = isNew ? 'yoto' : Object.keys(YM.CARD_PRESETS).find((k) => YM.CARD_PRESETS[k].w === p.card.width && YM.CARD_PRESETS[k].h === p.card.height) || 'custom';
    const val = {
      pw: isNew ? 215.9 : p.page.width,
      ph: isNew ? 279.4 : p.page.height,
      margin: isNew ? 8 : p.page.margin,
      gap: isNew ? 3 : p.page.gap,
      cw: isNew ? 53.98 : p.card.width,
      ch: isNew ? 85.6 : p.card.height,
      radius: isNew ? 3.18 : p.card.radius,
      auto: isNew ? true : !!p.layout.auto,
      cols: isNew ? 3 : p.layout.cols,
      rows: isNew ? 3 : p.layout.rows,
    };
    const pageOpts = Object.keys(YM.PAGE_PRESETS).map((k) => `<option value="${k}" ${k === pagePreset ? 'selected' : ''}>${esc(YM.PAGE_PRESETS[k].label)}</option>`).join('');
    const cardOpts = Object.keys(YM.CARD_PRESETS).map((k) => `<option value="${k}" ${k === cardPreset ? 'selected' : ''}>${esc(YM.CARD_PRESETS[k].label)}</option>`).join('');

    const body = `
      <div class="form-grid">
        <div class="full">
          <label class="form-label">Paper size</label>
          <select class="select" id="psPagePreset">${pageOpts}</select>
        </div>
        <div>
          <label class="form-label">Paper width (mm)</label>
          <input class="input" id="psPageW" type="number" step="0.1" min="20" value="${fmt(val.pw, 2)}">
        </div>
        <div>
          <label class="form-label">Paper height (mm)</label>
          <input class="input" id="psPageH" type="number" step="0.1" min="20" value="${fmt(val.ph, 2)}">
        </div>
        <div class="full">
          <label class="form-label">Card / sticker size</label>
          <select class="select" id="psCardPreset">${cardOpts}</select>
        </div>
        <div>
          <label class="form-label">Card width (mm)</label>
          <input class="input" id="psCardW" type="number" step="0.1" min="10" value="${fmt(val.cw, 2)}">
        </div>
        <div>
          <label class="form-label">Card height (mm)</label>
          <input class="input" id="psCardH" type="number" step="0.1" min="10" value="${fmt(val.ch, 2)}">
        </div>
        <div>
          <label class="form-label">Corner radius (mm)</label>
          <input class="input" id="psRadius" type="number" step="0.1" min="0" max="20" value="${fmt(val.radius, 2)}">
        </div>
        <div>
          <label class="form-label">Gap between cards (mm)</label>
          <input class="input" id="psGap" type="number" step="0.5" min="0" value="${fmt(val.gap, 1)}">
        </div>
        <div class="full">
          <label class="form-label">Minimum space from paper edge (mm)</label>
          <input class="input" id="psMargin" type="number" step="0.5" min="0" value="${fmt(val.margin, 1)}">
        </div>
        <div class="full">
          <div class="opt-row">
            <div>
              <div class="olabel">Automatically fit as many cards as possible</div>
              <div class="odesc" id="psFitNote">Calculating…</div>
            </div>
            <div class="switch ${val.auto ? 'on' : ''}" id="psAuto" role="switch"></div>
          </div>
        </div>
        <div id="psManual" class="${val.auto ? 'hidden' : ''}" style="display:contents">
          <div>
            <label class="form-label">Columns</label>
            <input class="input" id="psCols" type="number" step="1" min="1" value="${val.cols}">
          </div>
          <div>
            <label class="form-label">Rows</label>
            <input class="input" id="psRows" type="number" step="1" min="1" value="${val.rows}">
          </div>
        </div>
      </div>
      <div class="help-note" id="psWarning" style="display:none"></div>
      <div class="help-note" id="psSafeNote" style="display:none"></div>
      <div class="help-note" style="margin-top:12px">
        <b>Printing:</b> export a PDF and print at <b>100% / Actual size</b>. Turn off “Fit to page” in the print dialog so cards come out exactly ${fmt(val.cw, 2)} × ${fmt(val.ch, 2)} mm with ${fmt(val.radius, 2)} mm rounded corners.
      </div>`;

    const m = UI.modal({
      title: isNew ? 'New sheet' : 'Page setup',
      subtitle: isNew ? 'Choose the paper and the card/sticker size. Cards are packed as tightly as the paper allows.' : 'Change the paper, card size, spacing, or grid.',
      body,
      wide: false,
      footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="psApply">${isNew ? 'Create sheet' : 'Apply layout'}</button>`,
    });

    const $r = (id) => m.root.querySelector('#' + id);
    const autoSwitch = $r('psAuto');
    let auto = val.auto;

    const refresh = () => {
      const pw = Number($r('psPageW').value) || 0;
      const ph = Number($r('psPageH').value) || 0;
      const cw = Number($r('psCardW').value) || 1;
      const ch = Number($r('psCardH').value) || 1;
      const margin = Number($r('psMargin').value) || 0;
      const gap = Number($r('psGap').value) || 0;
      const tmp = {
        page: { width: pw, height: ph, margin, gap },
        card: { width: cw, height: ch },
        layout: { auto, cols: Number($r('psCols').value) || 1, rows: Number($r('psRows').value) || 1 },
      };
      const g = YM.computeGrid(tmp);
      const usedW = g.cols * cw + (g.cols - 1) * gap;
      const usedH = g.rows * ch + (g.rows - 1) * gap;
      const edge = Math.min((pw - usedW) / 2, (ph - usedH) / 2);
      const edgeNote = edge < 6
        ? ` · <b style="color:#ffb020">closest card is only ${fmt(edge, 1)} mm from the paper edge</b>`
        : ` · closest card is ${fmt(edge, 1)} mm from the paper edge`;
      $r('psFitNote').innerHTML = `Fits <b>${g.cols} × ${g.rows} = ${g.cols * g.rows} cards</b>${edgeNote}.`;
      const safe = $r('psSafeNote');
      if (safe) {
        safe.style.display = edge < 6 ? 'block' : 'none';
        if (edge < 6) safe.innerHTML = `<b>Printer margin warning:</b> most inkjet and laser printers cannot print within about 6 mm of the paper edge. Increase the sheet margin or gap if cards come out clipped.`;
      }
      if (!isNew) {
        const total = g.cols * g.rows;
        const used = project().cards.filter((c) => YM.hasContent(c)).length;
        const warn = $r('psWarning');
        if (total < used) {
          warn.style.display = 'block';
          warn.innerHTML = `Heads up: the new layout holds <b>${total}</b> cards but <b>${used}</b> already have designs. ${used - total} design(s) at the end will be removed.`;
        } else {
          warn.style.display = 'none';
        }
      }
    };

    $r('psAuto').addEventListener('click', () => {
      auto = !auto;
      autoSwitch.classList.toggle('on', auto);
      $r('psManual').style.display = auto ? 'none' : 'contents';
      if (auto) {
        // fill manual fields with the auto result so nothing jumps when toggled off
        const g = YM.computeGrid({
          page: { width: Number($r('psPageW').value), height: Number($r('psPageH').value), margin: Number($r('psMargin').value), gap: Number($r('psGap').value) },
          card: { width: Number($r('psCardW').value), height: Number($r('psCardH').value) },
          layout: { auto: true },
        });
        $r('psCols').value = g.cols;
        $r('psRows').value = g.rows;
      }
      refresh();
    });

    $r('psPagePreset').addEventListener('change', () => {
      const k = $r('psPagePreset').value;
      if (k !== 'custom') {
        const pr = YM.PAGE_PRESETS[k];
        $r('psPageW').value = fmt(pr.w, 2);
        $r('psPageH').value = fmt(pr.h, 2);
        refresh();
      }
    });
    $r('psCardPreset').addEventListener('change', () => {
      const k = $r('psCardPreset').value;
      if (k !== 'custom') {
        const pr = YM.CARD_PRESETS[k];
        $r('psCardW').value = fmt(pr.w, 2);
        $r('psCardH').value = fmt(pr.h, 2);
        $r('psRadius').value = fmt(pr.r, 2);
        refresh();
      }
    });
    ['psPageW', 'psPageH', 'psCardW', 'psCardH', 'psMargin', 'psGap', 'psCols', 'psRows'].forEach((id) => {
      $r(id).addEventListener('input', refresh);
    });
    refresh();

    $r('psApply').addEventListener('click', () => {
      const pw = Number($r('psPageW').value);
      const ph = Number($r('psPageH').value);
      const cw = Number($r('psCardW').value);
      const ch = Number($r('psCardH').value);
      const margin = Number($r('psMargin').value);
      const gap = Number($r('psGap').value);
      const radius = Number($r('psRadius').value);
      if (!(pw >= 20 && ph >= 20 && cw >= 10 && ch >= 10)) {
        YM.toast('Please use valid paper and card sizes', 'err');
        return;
      }
      if (margin < 0 || gap < 0) {
        YM.toast('Margin and gap cannot be negative', 'err');
        return;
      }
      if (cw + margin * 2 > pw + 0.01 || ch + margin * 2 > ph + 0.01) {
        YM.toast('The card is larger than the printable area of that paper', 'err', 3400);
        return;
      }
      const g = YM.computeGrid({
        page: { width: pw, height: ph, margin, gap },
        card: { width: cw, height: ch },
        layout: { auto, cols: Number($r('psCols').value) || 1, rows: Number($r('psRows').value) || 1 },
      });
      if (!isNew) {
        const total = g.cols * g.rows;
        const used = project().cards.filter((c) => YM.hasContent(c)).length;
        if (total < used && !confirm(`This layout only holds ${total} cards and will remove ${used - total} designed card(s). Continue?`)) return;
      }
      const cfg = {
        pagePreset: $r('psPagePreset').value,
        pageWidth: pw,
        pageHeight: ph,
        margin,
        gap,
        cardPreset: $r('psCardPreset').value,
        cardWidth: cw,
        cardHeight: ch,
        radius,
        auto,
        cols: g.cols,
        rows: g.rows,
      };
      m.close();
      if (isNew) {
        YM.App.newProject({
          pagePreset: cfg.pagePreset,
          cardPreset: cfg.cardPreset,
          margin,
          gap,
          width: pw,
          height: ph,
          cardWidth: cw,
          cardHeight: ch,
          radius,
        });
      } else {
        YM.App.applyPageSetup(cfg);
      }
    });
  };

  /* ------------------------------------------------------------------ */
  /* export                                                             */
  /* ------------------------------------------------------------------ */

  UI.openExport = function () {
    const p = project();
    const cur = state().selectedCard == null ? 0 : state().selectedCard;
    const body = `
      <div class="form-grid">
        <div class="full">
          <label class="form-label">What to export</label>
          <div class="seg-lg" id="exScope">
            <button data-scope="sheet" class="on">Whole sheet (${p.cards.length} cards)</button>
            <button data-scope="card">Just card ${cur + 1}</button>
          </div>
        </div>
        <div class="full">
          <label class="form-label">File format</label>
          <div class="seg-lg" id="exFormat">
            <button data-format="pdf" class="on">PDF (print)</button>
            <button data-format="png">PNG</button>
            <button data-format="jpg">JPG</button>
          </div>
        </div>
        <div class="full">
          <label class="form-label">Resolution</label>
          <div class="seg-lg" id="exDpi">
            <button data-dpi="150">150 DPI</button>
            <button data-dpi="300" class="on">300 DPI</button>
            <button data-dpi="600">600 DPI</button>
          </div>
        </div>
        <div class="full">
          <div class="opt-row">
            <div>
              <div class="olabel">Add thin cut guides</div>
              <div class="odesc">Light grey card outlines for cutting. Off by default — your artwork is exported without the black editing outlines.</div>
            </div>
            <div class="switch" id="exGuides" role="switch"></div>
          </div>
        </div>
      </div>
      <div class="card-note" id="exSummary" style="margin-top:12px"></div>
      <div class="help-note">
        <b>Printing tip:</b> open the PDF and print at <b>100% / Actual size</b> (turn off “Fit to page”). Each card is exactly ${fmt(p.card.width, 2)} × ${fmt(p.card.height, 2)} mm, on a ${fmt(p.page.width, 1)} × ${fmt(p.page.height, 1)} mm sheet.
      </div>`;

    const m = UI.modal({
      title: 'Export print file',
      subtitle: 'Full-resolution print output.',
      body,
      footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="exGo">Export</button>`,
    });
    const $r = (id) => m.root.querySelector('#' + id);
    let format = 'pdf';
    let dpi = 300;
    let cutGuides = false;
    let scope = 'sheet';

    const summary = () => {
      const wmm = scope === 'card' ? p.card.width : p.page.width;
      const hmm = scope === 'card' ? p.card.height : p.page.height;
      const w = Math.round((wmm / 25.4) * dpi);
      const h = Math.round((hmm / 25.4) * dpi);
      const what = scope === 'card' ? `card ${cur + 1} only` : `${p.cards.length} cards`;
      $r('exSummary').innerHTML = `<b>${w} × ${h} px</b> · ${dpi} DPI · ${format === 'pdf' ? 'exact-size PDF' : format.toUpperCase()} · ${what}`;
    };
    summary();

    $r('exScope').addEventListener('click', (e) => {
      const b = e.target.closest('[data-scope]');
      if (!b) return;
      scope = b.dataset.scope;
      $$('#exScope button', m.root).forEach((x) => x.classList.toggle('on', x === b));
      summary();
    });
    $r('exFormat').addEventListener('click', (e) => {
      const b = e.target.closest('[data-format]');
      if (!b) return;
      format = b.dataset.format;
      $$('#exFormat button', m.root).forEach((x) => x.classList.toggle('on', x === b));
      summary();
    });
    $r('exDpi').addEventListener('click', (e) => {
      const b = e.target.closest('[data-dpi]');
      if (!b) return;
      dpi = Number(b.dataset.dpi);
      $$('#exDpi button', m.root).forEach((x) => x.classList.toggle('on', x === b));
      summary();
    });
    $r('exGuides').addEventListener('click', () => {
      cutGuides = !cutGuides;
      $r('exGuides').classList.toggle('on', cutGuides);
    });

    $r('exGo').addEventListener('click', async () => {
      const btn = $r('exGo');
      btn.disabled = true;
      btn.textContent = 'Rendering…';
      try {
        await YM.App.flushAutosave();
        const opts = { cutGuides, cardIndex: scope === 'card' ? cur : null };
        if (format === 'pdf') {
          const res = await YM.Export.exportPDF(p, dpi, opts);
          YM.toast(`PDF exported · ${(res.size / 1048576).toFixed(1)} MB`, 'good', 3200);
        } else if (format === 'png') {
          await YM.Export.exportPNG(p, dpi, opts);
          YM.toast(scope === 'card' ? `Card ${cur + 1} exported` : 'PNG exported', 'good');
        } else {
          await YM.Export.exportJPEG(p, dpi, opts);
          YM.toast(scope === 'card' ? `Card ${cur + 1} exported` : 'JPG exported', 'good');
        }
        m.close();
      } catch (err) {
        console.error(err);
        YM.toast('Export failed: ' + (err && err.message ? err.message : 'unknown error'), 'err', 4200);
        btn.disabled = false;
        btn.textContent = 'Export';
      }
    });
  };

  /* ------------------------------------------------------------------ */
  /* new sheet                                                          */
  /* ------------------------------------------------------------------ */

  UI.openNew = function () {
    UI.openPageSetup('new');
  };

  /* ------------------------------------------------------------------ */
  /* help                                                               */
  /* ------------------------------------------------------------------ */

  UI.openHelp = function () {
    const body = `
      <div class="shortcut-grid">
        <div class="sc"><span>Select / move</span><span class="kbd">V</span></div>
        <div class="sc"><span>Add text</span><span class="kbd">T</span></div>
        <div class="sc"><span>Add image</span><span class="kbd">I</span></div>
        <div class="sc"><span>Add shape</span><span class="kbd">R</span></div>
        <div class="sc"><span>Crop image</span><span class="kbd">C</span></div>
        <div class="sc"><span>Undo / redo</span><span><span class="kbd">Ctrl Z</span> <span class="kbd">Ctrl Y</span></span></div>
        <div class="sc"><span>Duplicate layer</span><span class="kbd">Ctrl D</span></div>
        <div class="sc"><span>Paste image</span><span class="kbd">Ctrl V</span></div>
        <div class="sc"><span>Save project</span><span class="kbd">Ctrl S</span></div>
        <div class="sc"><span>Fit sheet</span><span class="kbd">Ctrl 0</span></div>
        <div class="sc"><span>Toggle card outlines</span><span class="kbd">G</span></div>
        <div class="sc"><span>Toggle card numbers</span><span class="kbd">N</span></div>
        <div class="sc"><span>Nudge layer</span><span class="kbd">Arrows</span></div>
        <div class="sc"><span>Pan the sheet</span><span><span class="kbd">Space</span> + drag</span></div>
        <div class="sc"><span>Delete layer</span><span class="kbd">Del</span></div>
        <div class="sc"><span>Finish text / crop</span><span class="kbd">Esc</span></div>
      </div>
      <div class="help-note">
        <b>Cards are isolated.</b> Every card clips its own layers, so a big image or text box can be dragged past the card edge without touching the card next to it. The black outlines are guides only and never appear in exported files.
      </div>
      <div class="help-note">
        <b>Fast workflow.</b> Drop one or many images on the sheet — the first fills the card you dropped on, the rest go to the next empty cards, one per card. <span class="kbd">Ctrl</span>+<span class="kbd">V</span> pastes into the selected card. “Copy to next empty” duplicates a finished design so you can swap just the picture.
      </div>
      <div class="help-note">
        <b>Layer order.</b> Use the layer list arrows or the back / forward buttons in Position &amp; size, just like Photoshop. Double-click any text to edit it directly on the card.
      </div>
      <div class="help-note">
        <b>Print quality.</b> Export at 300 DPI (or 600 for tiny text) and print at 100% / Actual size with “Fit to page” turned off. Yoto and CR80 RFID cards are 53.98 × 85.6 mm with 3.18 mm rounded corners — a US Letter or A4 sheet fits 9 of them.
      </div>`;
    UI.modal({ title: 'How to use Michael Yoto Maker', subtitle: 'Everything is local in your browser — your designs never leave this computer.', body, wide: true, footer: `<button class="btn primary" data-close>Got it</button>` });
  };

  /* keyboard listener for card chips is global; set up once */
  bindInspectorEvents();
})(window.YM);
