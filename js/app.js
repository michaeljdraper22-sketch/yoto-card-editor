/* Michael Yoto Maker — application core */
(function (YM) {
  'use strict';

  const R = YM.Render;
  const UI = () => YM.UI;

  const S = {
    project: null,
    selectedCard: 0,
    selectedLayerId: null,
    tool: 'select',
    cropMode: false,
    hoverCard: null,
    hoverLayerId: null,
    view: { zoom: 1, panX: 0, panY: 0, ppmm: 4, offsetX: 0, offsetY: 0, fitScale: 4 },
    history: [],
    redoStack: [],
    hi: -1,
    editingText: null,
    showGuides: true,
    showNumbers: false,
    spaceDown: false,
    drag: null,
    pointer: { x: 0, y: 0, inside: false },
    clipboardLayer: null,
    clipboardCard: null,
    replaceLayerId: null,
    saveTimer: null,
    saveState: 'saved',
    initialized: false,
    lastPointerDown: null,
    shapeKind: 'rect',
    pinch: null,
    hasAutosaved: false,
  };

  const App = (YM.App = { S });
  let canvas = null;
  let ctx = null;
  let wrap = null;
  let saveStateEl = null;
  let renderQueued = false;
  let historyOnceTag = null;
  let historyOnceTime = 0;

  /* ------------------------------------------------------------------ */
  /* small helpers                                                      */
  /* ------------------------------------------------------------------ */

  function project() { return S.project; }

  function sel() {
    if (S.selectedCard == null || !S.project.cards[S.selectedCard]) return null;
    const card = S.project.cards[S.selectedCard];
    const layer = S.selectedLayerId ? card.layers.find((l) => l.id === S.selectedLayerId) : null;
    return { card, cardIndex: S.selectedCard, layer: layer || null };
  }

  function activeLayer() {
    const s = sel();
    return s ? s.layer : null;
  }

  function cardRect(i) { return YM.cardRect(S.project, i); }

  function pageRect() { return YM.pageRect(S.project); }

  function ensureSelection() {
    if (S.selectedCard == null || S.selectedCard >= S.project.cards.length) S.selectedCard = 0;
    if (S.selectedLayerId) {
      const found = YM.findLayer(S.project, S.selectedLayerId);
      if (!found) S.selectedLayerId = null;
    }
  }

  function setSaveState(text, kind) {
    S.saveState = kind || text;
    if (saveStateEl) {
      saveStateEl.textContent = text;
      saveStateEl.className = 'save-state ' + (kind || '');
    }
  }

  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  function pushHistory() {
    if (!S.project) return;
    // Store the state *before* the coming change. The live state is not in
    // the stack; undo/redo move states between `history` and `redoStack`.
    S.history.push(YM.clone(S.project));
    S.redoStack = [];
    if (S.history.length > 80) S.history.shift();
    S.hi = S.history.length - 1;
    if (YM.UI) YM.UI.updateHistoryButtons();
  }

  function historyOnce(tag) {
    const now = Date.now();
    if (tag !== historyOnceTag || now - historyOnceTime > 900) {
      pushHistory();
      historyOnceTag = tag;
    }
    historyOnceTime = now;
  }

  function scheduleAutosave() {
    if (S.saveTimer) clearTimeout(S.saveTimer);
    setSaveState('Saving…', 'saving');
    S.saveTimer = setTimeout(flushAutosave, 1200);
  }

  async function flushAutosave() {
    S.saveTimer = null;
    try {
      const res = await YM.Storage.save('autosave', { savedAt: new Date().toISOString(), project: S.project });
      if (res) {
        S.hasAutosaved = true;
        setSaveState('Saved', '');
      } else {
        setSaveState('Save file to keep work', '');
      }
    } catch (e) {
      setSaveState('Save file to keep work', '');
    }
  }

  function commit(opts = {}) {
    S.project.updatedAt = new Date().toISOString();
    scheduleAutosave();
    requestRender();
    if (!opts.noStatus && YM.UI) YM.UI.updateStatus();
  }

  /* ------------------------------------------------------------------ */
  /* selection                                                          */
  /* ------------------------------------------------------------------ */

  function selectCard(i, opts = {}) {
    if (S.editingText) {
      const keep = i != null && S.editingText.cardIndex === i;
      if (!keep) { S.editingText = null; requestRender(); }
    }
    if (i == null || i < 0 || i >= S.project.cards.length) {
      S.selectedCard = null;
      S.selectedLayerId = null;
      S.cropMode = false;
    } else {
      S.selectedCard = i;
      if (!opts.keepLayer) S.selectedLayerId = null;
      S.cropMode = false;
    }
    if (!opts.silent) {
      if (YM.UI) {
        YM.UI.buildCardNav();
        YM.UI.buildInspector();
        YM.UI.updateStatus();
      }
    }
    requestRender();
  }

  function selectLayer(id, opts = {}) {
    if (S.editingText && S.editingText.layerId !== id) {
      S.editingText = null;
      requestRender();
    }
    S.selectedLayerId = id || null;
    S.cropMode = false;
    if (!opts.silent) {
      if (YM.UI) YM.UI.buildInspector();
      if (YM.UI) YM.UI.updateStatus();
    }
    requestRender();
  }

  function ensureCardVisible(i) {
    const r = cardRect(i);
    const pg = pageRect();
    const viewW = wrap.clientWidth;
    const viewH = wrap.clientHeight;
    const ppmm = S.view.ppmm;
    const cx = S.view.offsetX + (r.x + r.w / 2) * ppmm;
    const cy = S.view.offsetY + (r.y + r.h / 2) * ppmm;
    const m = 80;
    if (cx < m) S.view.panX += m - cx;
    if (cx > viewW - m) S.view.panX -= cx - (viewW - m);
    if (cy < m) S.view.panY += m - cy;
    if (cy > viewH - m) S.view.panY -= cy - (viewH - m);
    requestRender();
  }

  /* ------------------------------------------------------------------ */
  /* coordinate helpers                                                 */
  /* ------------------------------------------------------------------ */

  function pagePoint(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left - S.view.offsetX) / S.view.ppmm,
      y: (clientY - r.top - S.view.offsetY) / S.view.ppmm,
    };
  }

  function cardAt(p) {
    if (p.x < 0 || p.y < 0 || p.x > S.project.page.width || p.y > S.project.page.height) return null;
    for (let i = 0; i < S.project.cards.length; i++) {
      const r = cardRect(i);
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return i;
    }
    return null;
  }

  function layerAt(cardIndex, p) {
    const r = cardRect(cardIndex);
    const card = S.project.cards[cardIndex];
    const lp = { x: p.x - r.x, y: p.y - r.y };
    for (let i = card.layers.length - 1; i >= 0; i--) {
      const l = card.layers[i];
      if (l.visible === false) continue;
      if (R.hitLayer(l, lp.x, lp.y)) return l;
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* rendering                                                          */
  /* ------------------------------------------------------------------ */

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, wrap.clientWidth);
    const h = Math.max(1, wrap.clientHeight);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
    }
    return { w, h, dpr };
  }

  function render() {
    if (!S.project) return;
    const { w, h, dpr } = resizeCanvas();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pw = S.project.page.width;
    const ph = S.project.page.height;
    const fit = Math.min((w - 96) / pw, (h - 84) / ph);
    S.view.fitScale = fit;
    const ppmm = fit * S.view.zoom;
    S.view.ppmm = ppmm;
    const ox = (w - pw * ppmm) / 2 + S.view.panX;
    const oy = (h - ph * ppmm) / 2 + S.view.panY;
    S.view.offsetX = ox;
    S.view.offsetY = oy;

    // page shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.55)';
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(ox, oy, pw * ppmm, ph * ppmm);
    ctx.restore();

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(ppmm, ppmm);
    ctx._ppmm = ppmm;
    R.drawPage(ctx, S.project, {
      ppmm,
      showGuides: S.showGuides,
      showNumbers: S.showNumbers,
      hideLayerId: S.editingText ? S.editingText.layerId : null,
      selectedCard: S.selectedCard,
      hoverCard: S.hoverCard,
    });
    if (S.selectedCard != null) {
      R.drawSelection(ctx, S.project, {
        selectedCard: S.selectedCard,
        selectedLayerId: S.selectedLayerId,
        hoverCard: S.hoverCard,
        cropMode: S.cropMode,
      }, ppmm);
    }
    ctx.restore();

    syncTextEditor();
    updateZoomLabel();
  }

  function updateZoomLabel() {
    const el = document.getElementById('zoomLabel');
    if (el) el.textContent = Math.round(S.view.zoom * 100) + '%';
  }

  function zoomFit() {
    S.view.zoom = 1;
    S.view.panX = 0;
    S.view.panY = 0;
    requestRender();
  }

  function zoomAt(newZoom, clientX, clientY) {
    const z = YM.clamp(newZoom, 0.3, 8);
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const before = pagePoint(clientX, clientY);
    const px = clientX - r.left;
    const py = clientY - r.top;
    const fit = S.view.fitScale;
    const ppmm = fit * z;
    const baseOx = (r.width - S.project.page.width * ppmm) / 2;
    const baseOy = (r.height - S.project.page.height * ppmm) / 2;
    // keep the point under the cursor fixed
    S.view.panX = px - baseOx - before.x * ppmm;
    S.view.panY = py - baseOy - before.y * ppmm;
    S.view.zoom = z;
    requestRender();
  }

  /* ------------------------------------------------------------------ */
  /* text editing overlay                                               */
  /* ------------------------------------------------------------------ */

  function syncTextEditor() {
    const wrapEl = document.getElementById('textEditorWrap');
    const ta = document.getElementById('textEditor');
    if (!wrapEl || !ta) return;
    if (!S.editingText) {
      wrapEl.classList.add('hidden');
      return;
    }
    const found = YM.findLayer(S.project, S.editingText.layerId);
    if (!found) {
      S.editingText = null;
      wrapEl.classList.add('hidden');
      return;
    }
    const layer = found.layer;
    const b = R.mediaBox(layer);
    const cr = cardRect(found.cardIndex);
    const ppmm = S.view.ppmm;
    const cx = S.view.offsetX + (cr.x + b.x + b.w / 2) * ppmm;
    const cy = S.view.offsetY + (cr.y + b.y + b.h / 2) * ppmm;
    const w = b.w * ppmm;
    const h = Math.max(8, b.h * ppmm);
    wrapEl.classList.remove('hidden');
    wrapEl.style.left = '0px';
    wrapEl.style.top = '0px';
    wrapEl.style.width = w + 'px';
    wrapEl.style.height = h + 'px';
    wrapEl.style.transform = `translate(${cx - w / 2}px, ${cy - h / 2}px) rotate(${layer.rot || 0}deg)`;
    wrapEl.style.transformOrigin = 'center center';

    const pad = (layer.bgPadding || 0) * ppmm;
    ta.style.width = w + 'px';
    ta.style.height = h + 'px';
    ta.style.padding = pad + 'px';
    ta.style.fontFamily = `"${layer.font}", "${layer.font}", sans-serif`;
    ta.style.fontSize = layer.size * ppmm + 'px';
    ta.style.fontWeight = layer.bold ? '800' : '400';
    ta.style.fontStyle = layer.italic ? 'italic' : 'normal';
    ta.style.lineHeight = String(layer.lineHeight || 1.1);
    ta.style.letterSpacing = (layer.letterSpacing || 0) * ppmm + 'px';
    ta.style.textAlign = layer.align || 'center';
    ta.style.textTransform = layer.uppercase ? 'uppercase' : 'none';
    ta.style.textDecoration = layer.underline ? 'underline' : 'none';
    ta.style.color = layer.color || '#fff';
    ta.style.background = layer.bgColor || 'rgba(8,10,15,.10)';
    const sw = layer.strokeWidth > 0 && layer.strokeColor ? layer.strokeWidth * ppmm : 0;
    ta.style.webkitTextStroke = sw ? `${sw}px ${layer.strokeColor}` : '0';
    ta.style.textShadow = layer.shadow
      ? `${(layer.shadowX || 0) * ppmm}px ${(layer.shadowY || 0.5) * ppmm}px ${(layer.shadowBlur || 1) * ppmm}px ${layer.shadowColor || '#000'}`
      : 'none';
    ta.style.transformOrigin = 'center center';
  }

  function startTextEdit(layerId, opts = {}) {
    const found = YM.findLayer(S.project, layerId);
    if (!found) return;
    S.editingText = { layerId, cardIndex: found.cardIndex };
    selectLayer(layerId, { silent: true });
    if (found.cardIndex !== S.selectedCard) S.selectedCard = found.cardIndex;
    const ta = document.getElementById('textEditor');
    R.layoutText(ctx, found.layer);
    requestRender();
    if (YM.UI) YM.UI.buildInspector();
    ta.value = found.layer.text || '';
    // Un-hide and position the overlay before focusing: a display:none
    // textarea cannot take focus.
    syncTextEditor();
    if (YM.UI) YM.UI.updateStatus();
    const focusEditor = () => {
      if (!S.editingText || S.editingText.layerId !== layerId) return;
      ta.focus({ preventScroll: true });
      if (opts.selectAll) ta.select();
      else {
        const n = ta.value.length;
        ta.setSelectionRange(n, n);
      }
    };
    focusEditor();
    // Clicking the canvas can move focus to the document just after we focus
    // the overlay, so make sure the editor keeps the caret.
    requestAnimationFrame(focusEditor);
    setTimeout(focusEditor, 60);
  }

  function endTextEdit() {
    if (!S.editingText) return;
    S.editingText = null;
    const ta = document.getElementById('textEditor');
    if (ta) ta.blur();
    requestRender();
    if (YM.UI) { YM.UI.buildInspector(); YM.UI.updateStatus(); }
  }

  function onTextInput() {
    if (!S.editingText) return;
    const found = YM.findLayer(S.project, S.editingText.layerId);
    if (!found) return;
    const ta = document.getElementById('textEditor');
    found.layer.text = ta.value;
    found.layer.name = (ta.value || 'Text').slice(0, 28);
    historyOnce('text-edit');
    R.layoutText(ctx, found.layer);
    requestRender();
    scheduleAutosave();
    const side = document.querySelector('#inspector [data-field="text"]');
    if (side && document.activeElement !== side) side.value = ta.value;
    if (YM.UI) YM.UI.updateLayerList();
  }

  /* ------------------------------------------------------------------ */
  /* layer operations                                                   */
  /* ------------------------------------------------------------------ */

  function addTextLayer(opts = {}) {
    const s = sel();
    if (!s) return;
    pushHistory();
    const layer = YM.newTextLayer(s.card, S.project, opts.text || 'Your text');
    // place near the vertical centre
    R.layoutText(ctx, layer);
    layer.y = (S.project.card.height - layer.h) / 2;
    s.card.layers.push(layer);
    S.selectedCard = s.cardIndex;
    S.selectedLayerId = layer.id;
    S.tool = 'select';
    if (YM.UI) YM.UI.setTool('select');
    commit();
    if (YM.UI) { YM.UI.buildInspector(); YM.UI.buildCardNav(); }
    startTextEdit(layer.id, { selectAll: true });
  }

  function addShapeLayer(shape) {
    const s = sel();
    if (!s) {
      YM.toast('Click a card first', 'err');
      return;
    }
    pushHistory();
    const layer = YM.newShapeLayer(S.project, shape || 'rect');
    s.card.layers.push(layer);
    S.selectedLayerId = layer.id;
    S.tool = 'select';
    if (YM.UI) YM.UI.setTool('select');
    commit();
    if (YM.UI) { YM.UI.buildInspector(); YM.UI.buildCardNav(); }
  }

  function deleteLayer() {
    const s = sel();
    if (!s || !s.layer) return;
    pushHistory();
    s.card.layers = s.card.layers.filter((l) => l.id !== s.layer.id);
    S.selectedLayerId = null;
    S.cropMode = false;
    commit();
    if (YM.UI) { YM.UI.buildInspector(); YM.UI.buildCardNav(); }
    YM.toast('Layer deleted');
  }

  function duplicateLayer() {
    const s = sel();
    if (!s || !s.layer) return;
    pushHistory();
    const copy = YM.clone(s.layer);
    copy.id = YM.uid(copy.type === 'text' ? 'txt' : copy.type === 'image' ? 'img' : 'shp');
    copy.x += 2;
    copy.y += 2;
    if (copy.type === 'text') copy.name = copy.text.slice(0, 28);
    s.card.layers.push(copy);
    S.selectedLayerId = copy.id;
    commit();
    if (YM.UI) { YM.UI.buildInspector(); YM.UI.buildCardNav(); }
  }

  function orderLayer(dir) {
    const s = sel();
    if (!s || !s.layer) return;
    const arr = s.card.layers;
    const i = arr.findIndex((l) => l.id === s.layer.id);
    if (i < 0) return;
    let j = i;
    if (dir === 'front') j = arr.length - 1;
    else if (dir === 'back') j = 0;
    else if (dir === 'up') j = Math.min(arr.length - 1, i + 1);
    else if (dir === 'down') j = Math.max(0, i - 1);
    if (j === i) return;
    pushHistory();
    arr.splice(i, 1);
    arr.splice(j, 0, s.layer);
    commit();
    if (YM.UI) YM.UI.buildInspector();
  }

  function toggleLayerVisible(id) {
    const found = YM.findLayer(S.project, id);
    if (!found) return;
    pushHistory();
    found.layer.visible = found.layer.visible === false;
    commit();
    if (YM.UI) YM.UI.buildInspector();
  }

  function toggleLayerLock(id) {
    const found = YM.findLayer(S.project, id);
    if (!found) return;
    pushHistory();
    found.layer.locked = !found.layer.locked;
    commit();
    if (YM.UI) YM.UI.buildInspector();
  }

  function setLayerProp(key, value, opts = {}) {
    const layer = activeLayer();
    if (!layer) return;
    if (opts.history !== false) historyOnce(opts.tag || 'prop:' + key);
    layer[key] = value;
    if (key === 'text') {
      layer.name = String(value || 'Text').slice(0, 28);
      if (S.editingText && S.editingText.layerId === layer.id) {
        const ta = document.getElementById('textEditor');
        if (ta && document.activeElement !== ta) ta.value = value;
      }
    }
    if (layer.type === 'text') {
      if (key === 'size' || key === 'font' || key === 'bold' || key === 'italic' || key === 'lineHeight' ||
          key === 'letterSpacing' || key === 'uppercase' || key === 'text' || key === 'w') {
        R.layoutText(ctx, layer);
      }
    }
    if (layer.type === 'image' && (key === 'w' || key === 'h')) YM.clampCrop(layer);
    commit();
    if (YM.UI && !opts.noList) YM.UI.updateLayerList();
  }

  function setLayerProps(obj, opts = {}) {
    const layer = activeLayer();
    if (!layer) return;
    if (opts.history !== false) historyOnce(opts.tag || 'props');
    Object.assign(layer, obj);
    if (layer.type === 'text') R.layoutText(ctx, layer);
    commit();
    if (YM.UI && !opts.noList) YM.UI.updateLayerList();
  }

  function setFilter(key, value) {
    const layer = activeLayer();
    if (!layer || layer.type !== 'image') return;
    if (!layer.filters) layer.filters = { brightness: 100, contrast: 100, saturate: 100, hue: 0, blur: 0, grayscale: 0, sepia: 0 };
    historyOnce('filter:' + key);
    layer.filters[key] = value;
    commit();
  }

  function coverZFor(layer) {
    const imgAspect = (layer.imgW || 1) / (layer.imgH || 1);
    const frameAspect = layer.w / Math.max(0.001, layer.h);
    return Math.min(1, frameAspect / imgAspect);
  }

  /** Crop sliders: kind = 'zoom' | 'panx' | 'pany'. Returns the label to show. */
  function setCrop(kind, value) {
    const s = sel();
    if (!s || !s.layer || s.layer.type !== 'image') return '';
    const layer = s.layer;
    historyOnce('crop:' + kind);
    YM.clampCrop(layer);
    if (kind === 'zoom') {
      const cover = coverZFor(layer);
      const f = YM.clamp(value / 100, 1, 8);
      layer.crop.z = YM.clamp(cover / f, 0.02, cover);
      YM.clampCrop(layer);
      commit();
      return Math.round((cover / layer.crop.z) * 100) + '%';
    }
    const cw = layer.crop.z;
    const ch = (cw * layer.imgW * layer.h) / (layer.imgH * layer.w);
    const v = YM.clamp(value / 100, 0, 1);
    if (kind === 'panx') layer.crop.cx = cw / 2 + v * (1 - cw);
    if (kind === 'pany') layer.crop.cy = ch / 2 + v * (1 - ch);
    YM.clampCrop(layer);
    commit();
    return Math.round(v * 100) + '%';
  }

  /* ------------------------------------------------------------------ */
  /* card operations                                                    */
  /* ------------------------------------------------------------------ */

  function setCardBg(hex) {
    const s = sel();
    if (!s) return;
    historyOnce('card-bg');
    s.card.bg = hex || null;
    commit();
    if (YM.UI) YM.UI.buildCardNav();
  }

  function clearCard() {
    const s = sel();
    if (!s) return;
    if (!s.card.layers.length && !s.card.bg) return;
    pushHistory();
    s.card.layers = [];
    s.card.bg = null;
    S.selectedLayerId = null;
    commit();
    if (YM.UI) { YM.UI.buildInspector(); YM.UI.buildCardNav(); }
    YM.toast('Card cleared');
  }

  function copyCard() {
    const s = sel();
    if (!s) return;
    S.clipboardCard = YM.clone(s.card);
    if (YM.UI) YM.UI.buildInspector();
    YM.toast('Card design copied');
  }

  function pasteCard() {
    const s = sel();
    if (!s || !S.clipboardCard) return;
    pushHistory();
    s.card.bg = S.clipboardCard.bg;
    s.card.layers = S.clipboardCard.layers.map((l) => {
      const c = YM.clone(l);
      c.id = YM.uid(c.type === 'text' ? 'txt' : c.type === 'image' ? 'img' : 'shp');
      return c;
    });
    S.selectedLayerId = null;
    commit();
    if (YM.UI) { YM.UI.buildInspector(); YM.UI.buildCardNav(); }
    YM.toast('Design pasted');
  }

  function applyToEmptyCards() {
    const s = sel();
    if (!s) return;
    const empties = S.project.cards
      .map((c, i) => ({ c, i }))
      .filter((x) => x.i !== s.cardIndex && !YM.hasContent(x.c));
    if (!empties.length) {
      YM.toast('No empty cards to fill');
      return;
    }
    if (!confirm(`Copy this card design into ${empties.length} empty card${empties.length === 1 ? '' : 's'}?`)) return;
    pushHistory();
    for (const { c } of empties) {
      c.bg = s.card.bg;
      c.layers = s.card.layers.map((l) => {
        const copy = YM.clone(l);
        copy.id = YM.uid(copy.type === 'text' ? 'txt' : copy.type === 'image' ? 'img' : 'shp');
        return copy;
      });
    }
    commit();
    if (YM.UI) { YM.UI.buildCardNav(); YM.UI.buildInspector(); }
    YM.toast(`Filled ${empties.length} card${empties.length === 1 ? '' : 's'}`);
  }

  function duplicateToNextEmpty() {
    const s = sel();
    if (!s) return;
    let target = -1;
    for (let k = 1; k <= S.project.cards.length; k++) {
      const idx = (s.cardIndex + k) % S.project.cards.length;
      if (!YM.hasContent(S.project.cards[idx])) { target = idx; break; }
    }
    if (target < 0) {
      YM.toast('Every card already has a design');
      return;
    }
    pushHistory();
    const dest = S.project.cards[target];
    dest.bg = s.card.bg;
    dest.layers = s.card.layers.map((l) => {
      const copy = YM.clone(l);
      copy.id = YM.uid(copy.type === 'text' ? 'txt' : copy.type === 'image' ? 'img' : 'shp');
      return copy;
    });
    selectCard(target);
    commit();
    if (YM.UI) { YM.UI.buildCardNav(); YM.UI.buildInspector(); }
    YM.toast('Copied to next empty card');
  }

  /* ------------------------------------------------------------------ */
  /* images                                                             */
  /* ------------------------------------------------------------------ */

  async function prepareImageFile(file) {
    const raw = await YM.readFileAsDataURL(file);
    const img = await YM.ensureImage(raw);
    const maxDim = 3000;
    const longest = Math.max(img.naturalWidth, img.naturalHeight);
    if (longest <= maxDim) return { src: raw, img };
    const scale = maxDim / longest;
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    const cc = c.getContext('2d');
    cc.imageSmoothingQuality = 'high';
    cc.drawImage(img, 0, 0, c.width, c.height);
    let src;
    try {
      src = file.type === 'image/png' ? c.toDataURL('image/png') : c.toDataURL('image/webp', 0.94);
    } catch (e) {
      src = c.toDataURL('image/jpeg', 0.94);
    }
    const img2 = await YM.ensureImage(src);
    return { src, img: img2 };
  }

  async function addImages(files, cardIndex) {
    if (!files || !files.length) return;
    const list = Array.from(files).filter((f) => f && /^image\//.test(f.type));
    if (!list.length) {
      YM.toast('Those files are not images', 'err');
      return;
    }
    const start = cardIndex == null ? (S.selectedCard == null ? 0 : S.selectedCard) : cardIndex;
    const prepared = [];
    for (const file of list) {
      try {
        prepared.push({ file, ...(await prepareImageFile(file)) });
      } catch (e) {
        YM.toast('Could not load ' + file.name, 'err');
      }
    }
    if (!prepared.length) return;
    pushHistory();
    // First image goes on the card you dropped it on; the rest prefer empty
    // cards after it, then any remaining cards.
    const total = S.project.cards.length;
    const others = [];
    for (let k = 1; k < total; k++) others.push((start + k) % total);
    const order = [start]
      .concat(others.filter((i) => !YM.hasContent(S.project.cards[i])))
      .concat(others.filter((i) => YM.hasContent(S.project.cards[i])));
    let added = 0;
    for (let i = 0; i < prepared.length; i++) {
      const item = prepared[i];
      const idx = order[i % order.length];
      const card = S.project.cards[idx];
      const layer = YM.newImageLayer({
        src: item.src,
        imgW: item.img.naturalWidth,
        imgH: item.img.naturalHeight,
        project: S.project,
        name: item.file.name ? item.file.name.replace(/\.[^.]+$/, '').slice(0, 30) : 'Image',
      });
      card.layers.push(layer);
      S.selectedCard = idx;
      S.selectedLayerId = layer.id;
      S.cropMode = false;
      added++;
    }
    commit();
    if (YM.UI) { YM.UI.buildCardNav(); YM.UI.buildInspector(); }
    YM.toast(`Added ${added} image${added === 1 ? '' : 's'}`);
    requestRender();
  }

  function pickImage(cardIndex) {
    const input = document.getElementById('fileImage');
    input.dataset.card = cardIndex == null ? S.selectedCard : cardIndex;
    input.value = '';
    input.click();
  }

  function replaceImage() {
    const layer = activeLayer();
    if (!layer || layer.type !== 'image' || layer.locked) return;
    S.replaceLayerId = layer.id;
    pickImage(S.selectedCard);
  }

  async function finishReplace(file) {
    const targetId = S.replaceLayerId;
    S.replaceLayerId = null;
    const found = YM.findLayer(S.project, targetId);
    if (!found || !file || !/^image\//.test(file.type)) return;
    let prepared;
    try {
      prepared = await prepareImageFile(file);
    } catch (e) {
      YM.toast('Could not load that image', 'err');
      return;
    }
    pushHistory();
    const layer = found.layer;
    layer.src = prepared.src;
    layer.imgW = prepared.img.naturalWidth;
    layer.imgH = prepared.img.naturalHeight;
    layer.name = file.name ? file.name.replace(/\.[^.]+$/, '').slice(0, 30) : layer.name;
    YM.fitCover(layer);
    commit();
    if (YM.UI) { YM.UI.buildInspector(); YM.UI.updateLayerList(); }
    YM.toast('Image replaced', 'good');
  }

  function enterCrop() {
    const layer = activeLayer();
    if (!layer || layer.type !== 'image' || layer.locked) return;
    S.cropMode = true;
    S.tool = 'select';
    if (YM.UI) { YM.UI.setTool('select'); YM.UI.buildInspector(); YM.UI.updateStatus(); }
    requestRender();
  }

  function exitCrop() {
    S.cropMode = false;
    if (YM.UI) { YM.UI.buildInspector(); YM.UI.updateStatus(); }
    requestRender();
  }

  function fitLayer(mode) {
    const s = sel();
    if (!s || !s.layer || s.layer.type !== 'image') return;
    pushHistory();
    if (mode === 'fill') YM.fillCard(s.layer, S.project.card);
    else if (mode === 'contain') YM.fitContain(s.layer, S.project.card);
    else YM.fitCover(s.layer);
    commit();
    if (YM.UI) YM.UI.buildInspector();
  }

  function resetCrop() {
    const layer = activeLayer();
    if (!layer || layer.type !== 'image') return;
    historyOnce('crop-reset');
    YM.fitCover(layer);
    commit();
    if (YM.UI) YM.UI.buildInspector();
  }

  /* ------------------------------------------------------------------ */
  /* pointer interactions                                               */
  /* ------------------------------------------------------------------ */

  function beginPan(e) {
    S.drag = {
      mode: 'pan',
      startX: e.clientX,
      startY: e.clientY,
      panX: S.view.panX,
      panY: S.view.panY,
    };
    canvas.classList.add('grabbing');
  }

  function startMove(e, cardIndex, layer) {
    const p = pagePoint(e.clientX, e.clientY);
    const cr = cardRect(cardIndex);
    S.drag = {
      mode: 'move',
      cardIndex,
      layer,
      start: { x: p.x, y: p.y, lx: layer.x, ly: layer.y },
      moved: false,
      locked: !!layer.locked,
    };
  }

  function startResize(e, handle, cardIndex, layer) {
    const p = pagePoint(e.clientX, e.clientY);
    const cr = cardRect(cardIndex);
    const b = R.mediaBox(layer);
    S.drag = {
      mode: 'resize',
      handle,
      cardIndex,
      layer,
      box: {
        x: layer.x, y: layer.y, w: b.w, h: b.h,
        size: layer.size, rot: layer.rot || 0,
      },
      start: { x: p.x, y: p.y },
      pushed: false,
    };
  }

  function startRotate(e, cardIndex, layer) {
    S.drag = {
      mode: 'rotate',
      cardIndex,
      layer,
      startRot: layer.rot || 0,
      pushed: false,
    };
  }

  function startCropPan(e, cardIndex, layer) {
    YM.clampCrop(layer);
    S.drag = {
      mode: 'crop',
      cardIndex,
      layer,
      start: { x: e.clientX, y: e.clientY },
      crop: { z: layer.crop.z, cx: layer.crop.cx, cy: layer.crop.cy },
      pushed: false,
    };
  }

  function onPointerDown(e) {
    if (e.button === 1 || S.spaceDown || S.tool === 'hand') {
      e.preventDefault();
      beginPan(e);
      return;
    }
    if (e.button !== 0) return;
    if (S.editingText) {
      endTextEdit();
      // continue with normal selection below
    }
    const p = pagePoint(e.clientX, e.clientY);
    const cardIndex = cardAt(p);

    if (S.tool === 'text') {
      if (cardIndex != null) {
        selectCard(cardIndex);
        addTextLayer();
      } else {
        YM.toast('Click a card to place text');
      }
      return;
    }
    if (S.tool === 'shape') {
      if (cardIndex != null) {
        selectCard(cardIndex);
        addShapeLayer(S.shapeKind || 'rect');
      } else YM.toast('Click a card to place a shape');
      return;
    }
    if (S.tool === 'image') {
      pickImage(cardIndex);
      return;
    }

    const s = sel();
    // handles first
    if (s && s.layer && !s.layer.locked && S.selectedCard === cardIndex) {
      const h = R.hitHandle(S.project, { selectedCard: S.selectedCard, cropMode: S.cropMode }, s.layer, p.x, p.y, S.view.ppmm);
      if (h) {
        canvas.setPointerCapture(e.pointerId);
        if (h === 'rot') startRotate(e, cardIndex, s.layer);
        else startResize(e, h, cardIndex, s.layer);
        return;
      }
    }

    if (cardIndex != null) {
      const hit = layerAt(cardIndex, p);
      if (hit) {
        if (S.selectedCard !== cardIndex) {
          selectCard(cardIndex, { keepLayer: true, silent: true });
        }
        if (S.selectedLayerId !== hit.id) selectLayer(hit.id, { silent: true });
        if (YM.UI) { YM.UI.buildCardNav(); YM.UI.buildInspector(); YM.UI.updateStatus(); }
        canvas.setPointerCapture(e.pointerId);
        if (S.cropMode && hit.type === 'image' && S.selectedLayerId === hit.id) {
          startCropPan(e, cardIndex, hit);
        } else {
          startMove(e, cardIndex, hit);
        }
        return;
      }
      // empty part of the card
      selectCard(cardIndex);
      return;
    }
    // outside cards: deselect and allow panning
    if (S.selectedCard != null || S.selectedLayerId) selectCard(null);
    beginPan(e);
  }

  function onPointerMove(e) {
    const p = pagePoint(e.clientX, e.clientY);
    S.pointer = { x: p.x, y: p.y, inside: true };

    if (S.drag) {
      const d = S.drag;
      if (d.mode === 'pan') {
        S.view.panX = d.panX + (e.clientX - d.startX);
        S.view.panY = d.panY + (e.clientY - d.startY);
        requestRender();
        return;
      }
      if (d.mode === 'move') {
        const dx = p.x - d.start.x;
        const dy = p.y - d.start.y;
        if (!d.moved && Math.hypot(dx * S.view.ppmm, dy * S.view.ppmm) > 2.5) {
          d.moved = true;
          if (!d.locked) pushHistory();
        }
        if (d.moved && !d.locked) {
          let mx = dx, my = dy;
          if (e.shiftKey) {
            if (Math.abs(dx) > Math.abs(dy)) my = 0; else mx = 0;
          }
          d.layer.x = d.start.lx + mx;
          d.layer.y = d.start.ly + my;
          scheduleAutosave();
          requestRender();
        }
        return;
      }
      if (d.mode === 'resize') {
        if (!d.pushed) { pushHistory(); d.pushed = true; }
        applyResize(d, p);
        scheduleAutosave();
        requestRender();
        return;
      }
      if (d.mode === 'rotate') {
        if (!d.pushed) { pushHistory(); d.pushed = true; }
        const cr = cardRect(d.cardIndex);
        const b = R.mediaBox(d.layer);
        const cx = cr.x + d.layer.x + b.w / 2;
        const cy = cr.y + d.layer.y + b.h / 2;
        let ang = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
        if (e.shiftKey) ang = Math.round(ang / 15) * 15;
        d.layer.rot = Math.round(ang * 10) / 10;
        scheduleAutosave();
        requestRender();
        return;
      }
      if (d.mode === 'crop') {
        if (!d.pushed) { pushHistory(); d.pushed = true; }
        const dxpx = (e.clientX - d.start.x) / S.view.ppmm;
        const dypx = (e.clientY - d.start.y) / S.view.ppmm;
        const layer = d.layer;
        YM.clampCrop(layer);
        layer.crop.z = d.crop.z;
        const cw = layer.crop.z;
        const ch = (cw * layer.imgW * layer.h) / (layer.imgH * layer.w);
        layer.crop.cx = d.crop.cx - (dxpx / layer.w) * cw;
        layer.crop.cy = d.crop.cy - (dypx / layer.h) * ch;
        YM.clampCrop(layer);
        scheduleAutosave();
        requestRender();
        return;
      }
    }

    // hover feedback
    const ci = cardAt(p);
    let hl = null;
    if (ci != null) {
      const hit = layerAt(ci, p);
      if (hit) hl = hit.id;
    }
    if (ci !== S.hoverCard || hl !== S.hoverLayerId) {
      S.hoverCard = ci;
      S.hoverLayerId = hl;
      requestRender();
    }
    updateCursor(e, ci, p);
  }

  function updateCursor(e, ci, p) {
    if (!canvas) return;
    if (S.spaceDown || S.drag) return;
    let cursor = 'default';
    if (ci != null) {
      cursor = 'pointer';
      const s = sel();
      if (s && s.layer && ci === S.selectedCard) {
        const h = R.hitHandle(S.project, { selectedCard: S.selectedCard, cropMode: S.cropMode }, s.layer, p.x, p.y, S.view.ppmm);
        if (h === 'rot') cursor = 'grab';
        else if (h === 'nw' || h === 'se') cursor = 'nwse-resize';
        else if (h === 'ne' || h === 'sw') cursor = 'nesw-resize';
        else if (h === 'n' || h === 's') cursor = 'ns-resize';
        else if (h === 'e' || h === 'w') cursor = 'ew-resize';
      }
      if (S.tool === 'text') cursor = 'text';
    } else {
      cursor = S.tool === 'select' ? 'grab' : 'default';
    }
    canvas.style.cursor = cursor;
  }

  function applyResize(d, p) {
    const cr = cardRect(d.cardIndex);
    const layer = d.layer;
    const b = d.box;
    const sx = d.handle.includes('w') ? -1 : d.handle.includes('e') ? 1 : 0;
    const sy = d.handle.includes('n') ? -1 : d.handle.includes('s') ? 1 : 0;
    const lp = { x: p.x - cr.x, y: p.y - cr.y };
    const cx0 = b.x + b.w / 2;
    const cy0 = b.y + b.h / 2;
    const a = (b.rot * Math.PI) / 180;
    const cos = Math.cos(a), sin = Math.sin(a);
    const dx = lp.x - cx0;
    const dy = lp.y - cy0;
    const px = dx * cos + dy * sin;
    const py = -dx * sin + dy * cos;

    const fx = sx ? (-sx * b.w) / 2 : 0;
    const fy = sy ? (-sy * b.h) / 2 : 0;
    let nw = b.w;
    let nh = b.h;
    if (sx) nw = Math.max(3, sx * (px - fx));
    if (sy) nh = Math.max(3, sy * (py - fy));

    if (e2Shift(d)) {
      if (sx && sy) {
        const f = Math.max(nw / b.w, nh / b.h);
        nw = b.w * f;
        nh = b.h * f;
      }
    }

    if (layer.type === 'text') {
      const startW = b.w;
      const startH = b.h;
      if (sx && sy) {
        const f = Math.max(nw / startW, nh / startH);
        layer.size = YM.clamp((b.size || layer.size) * f, 1, 400);
        layer.w = YM.clamp(startW * f, 6, S.project.card.width * 4);
      } else if (sx) {
        layer.w = YM.clamp(nw, 6, S.project.card.width * 4);
      } else {
        layer.size = YM.clamp((b.size || layer.size) * (nh / startH), 1, 400);
      }
      R.layoutText(ctx, layer);
      nh = layer.h;
      nw = layer.w;
    } else {
      layer.w = nw;
      layer.h = nh;
      if (layer.type === 'image') YM.clampCrop(layer);
    }

    const fixX = cx0 + (fx * cos - fy * sin);
    const fixY = cy0 + (fx * sin + fy * cos);
    const ncx = fixX + ((sx * nw) / 2) * cos - ((sy * nh) / 2) * sin;
    const ncy = fixY + ((sx * nw) / 2) * sin + ((sy * nh) / 2) * cos;
    layer.x = ncx - nw / 2;
    layer.y = ncy - nh / 2;
  }

  function e2Shift(d) {
    // the last pointer event's shift state is stored on the drag by onPointerMove
    return !!d.shift;
  }

  function onPointerUp(e) {
    if (S.drag) {
      const d = S.drag;
      S.drag = null;
      canvas.classList.remove('grabbing');
      const changed =
        d.mode === 'move' ? d.moved :
        d.mode === 'resize' || d.mode === 'rotate' || d.mode === 'crop' ? d.pushed : false;
      if (changed) {
        commit();
        if (YM.UI) YM.UI.buildInspector();
      }
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
  }

  /* ------------------------------------------------------------------ */
  /* keyboard                                                           */
  /* ------------------------------------------------------------------ */

  function isTypingTarget(t) {
    if (!t) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }

  function onKeyDown(e) {
    if (document.querySelector('.modal-backdrop')) return;
    if (menuEl && e.key === 'Escape') {
      e.preventDefault();
      closeContextMenu();
      return;
    }
    const typing = isTypingTarget(e.target);
    if (S.editingText) {
      if (e.key === 'Escape') {
        e.preventDefault();
        endTextEdit();
        return;
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        endTextEdit();
        return;
      }
      return;
    }
    if (typing) {
      if (e.key === 'Escape') {
        if (S.editingText) endTextEdit();
        e.target.blur();
      }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;

    if (e.code === 'Space') {
      if (!S.spaceDown) {
        S.spaceDown = true;
        if (canvas) canvas.style.cursor = 'grab';
      }
      e.preventDefault();
      return;
    }

    if (mod) {
      const k = e.key.toLowerCase();
      if (k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (k === 'y') { e.preventDefault(); redo(); return; }
      if (k === 's') { e.preventDefault(); saveFile(); return; }
      if (k === 'd') { e.preventDefault(); duplicateLayer(); return; }
      if (k === 'c') { e.preventDefault(); copySelected(); return; }
      if (k === 'v') { /* let the paste event handle images */ return; }
      if (k === '0') { e.preventDefault(); zoomFit(); return; }
      if (k === '=' || k === '+') { e.preventDefault(); zoomAt(S.view.zoom * 1.25, wrap.clientWidth / 2 + wrap.getBoundingClientRect().left, wrap.clientHeight / 2 + wrap.getBoundingClientRect().top); return; }
      if (k === '-') { e.preventDefault(); zoomAt(S.view.zoom / 1.25, wrap.clientWidth / 2 + wrap.getBoundingClientRect().left, wrap.clientHeight / 2 + wrap.getBoundingClientRect().top); return; }
      return;
    }

    switch (e.key) {
      case 'v': case 'V': setTool('select'); break;
      case 't': case 'T': setTool('text'); break;
      case 'i': case 'I': setTool('image'); break;
      case 'r': case 'R': S.shapeKind = 'rect'; setTool('shape'); break;
      case 'o': case 'O': S.shapeKind = 'ellipse'; setTool('shape'); break;
      case 'g': case 'G': toggleGuides(); break;
      case 'n': case 'N': toggleNumbers(); break;
      case 'Delete': case 'Backspace':
        if (S.selectedLayerId) { e.preventDefault(); deleteLayer(); }
        break;
      case 'Escape':
        if (S.cropMode) exitCrop();
        else if (S.selectedLayerId) selectLayer(null);
        else selectCard(null);
        break;
      case 'Enter':
        if (activeLayer() && activeLayer().type === 'text') {
          e.preventDefault();
          startTextEdit(activeLayer().id);
        }
        break;
      case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight': {
        const layer = activeLayer();
        if (!layer) break;
        e.preventDefault();
        const step = e.shiftKey ? 2 : 0.2;
        historyOnce('nudge');
        if (e.key === 'ArrowUp') layer.y -= step;
        if (e.key === 'ArrowDown') layer.y += step;
        if (e.key === 'ArrowLeft') layer.x -= step;
        if (e.key === 'ArrowRight') layer.x += step;
        commit();
        if (YM.UI) YM.UI.updateInspectorNumbers();
        break;
      }
      case 'c': case 'C':
        if (activeLayer() && activeLayer().type === 'image') enterCrop();
        break;
      case 'b': case 'B':
        if (activeLayer() && activeLayer().type === 'text') setLayerProp('bold', !activeLayer().bold, { noList: true });
        break;
      default:
        if ((e.key === '+' || e.key === '=') && !mod) zoomAt(S.view.zoom * 1.25, S.view.offsetX + 20, S.view.offsetY + 20);
    }
  }

  function onKeyUp(e) {
    if (e.code === 'Space') {
      S.spaceDown = false;
      if (canvas && !S.drag) canvas.style.cursor = 'default';
    }
  }

  function copySelected() {
    const layer = activeLayer();
    if (!layer) return;
    S.clipboardLayer = YM.clone(layer);
    YM.toast('Layer copied');
  }

  function pasteLayer() {
    if (!S.clipboardLayer) return;
    const s = sel();
    if (!s) return;
    pushHistory();
    const copy = YM.clone(S.clipboardLayer);
    copy.id = YM.uid(copy.type === 'text' ? 'txt' : copy.type === 'image' ? 'img' : 'shp');
    copy.x += 3;
    copy.y += 3;
    // keep inside the card
    copy.x = YM.clamp(copy.x, -copy.w / 2, S.project.card.width - copy.w / 2);
    copy.y = YM.clamp(copy.y, -copy.h / 2, S.project.card.height - copy.h / 2);
    s.card.layers.push(copy);
    S.selectedLayerId = copy.id;
    commit();
    if (YM.UI) { YM.UI.buildInspector(); YM.UI.buildCardNav(); }
  }

  /* ------------------------------------------------------------------ */
  /* history                                                            */
  /* ------------------------------------------------------------------ */

  function undo() {
    if (S.drag || !S.history.length) return;
    if (S.editingText) endTextEdit();
    S.redoStack.push(YM.clone(S.project));
    const snap = S.history.pop();
    S.hi = S.history.length - 1;
    restoreHistory(snap);
    YM.toast('Undo');
  }

  function redo() {
    if (S.drag || !S.redoStack.length) return;
    if (S.editingText) endTextEdit();
    S.history.push(YM.clone(S.project));
    const snap = S.redoStack.pop();
    S.hi = S.history.length - 1;
    restoreHistory(snap);
  }

  function restoreHistory(snap) {
    S.project = YM.clone(snap);
    YM.applyLayout(S.project);
    ensureSelection();
    commit({ noStatus: true });
    if (YM.UI) {
      YM.UI.buildInspector();
      YM.UI.buildCardNav();
      YM.UI.updateHistoryButtons();
      YM.UI.updateStatus();
    }
    requestRender();
  }

  /* ------------------------------------------------------------------ */
  /* tools / toggles                                                    */
  /* ------------------------------------------------------------------ */

  function setTool(t) {
    if (S.editingText) endTextEdit();
    S.tool = t;
    if (t !== 'select') S.cropMode = false;
    if (YM.UI) { YM.UI.setTool(t); YM.UI.updateStatus(); }
    if (canvas) {
      canvas.style.cursor = t === 'text' ? 'text' : t === 'image' ? 'copy' : t === 'shape' ? 'crosshair' : 'default';
    }
    requestRender();
  }

  function toggleGuides() {
    S.showGuides = !S.showGuides;
    YM.Prefs.set('guides', S.showGuides);
    if (YM.UI) YM.UI.syncToggles();
    requestRender();
  }

  function toggleNumbers() {
    S.showNumbers = !S.showNumbers;
    YM.Prefs.set('numbers', S.showNumbers);
    if (YM.UI) YM.UI.syncToggles();
    requestRender();
  }

  /* ------------------------------------------------------------------ */
  /* project I/O                                                        */
  /* ------------------------------------------------------------------ */

  function saveFile() {
    const payload = {
      app: 'michael-yoto-maker',
      version: 1,
      savedAt: new Date().toISOString(),
      project: S.project,
    };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    YM.download(YM.Export.safeName(S.project.name) + '.mym', blob);
    YM.toast('Project saved', 'good');
    flushAutosave();
  }

  function normalizeProject(data) {
    if (!data || typeof data !== 'object') throw new Error('Not a project');
    const p = data;
    if (!p.page || !p.card || !Array.isArray(p.cards)) throw new Error('Not a Michael Yoto Maker project');
    p.page.width = Number(p.page.width) || 215.9;
    p.page.height = Number(p.page.height) || 279.4;
    p.page.margin = p.page.margin == null ? 8 : Number(p.page.margin);
    p.page.gap = p.page.gap == null ? 3 : Number(p.page.gap);
    p.card.width = Number(p.card.width) || 54;
    p.card.height = Number(p.card.height) || 85.6;
    p.card.radius = p.card.radius == null ? 3 : Number(p.card.radius);
    if (!p.layout) p.layout = { auto: true, cols: 3, rows: 3 };
    p.cards = p.cards.map((c) => {
      const card = c && typeof c === 'object' ? c : {};
      card.id = card.id || YM.uid('card');
      card.bg = card.bg || null;
      card.layers = Array.isArray(card.layers) ? card.layers : [];
      card.layers = card.layers.filter(Boolean).map((l) => {
        l.id = l.id || YM.uid('l');
        if (l.type === 'text') {
          for (const k in YM.TEXT_DEFAULTS) if (l[k] === undefined) l[k] = YM.TEXT_DEFAULTS[k];
        }
        if (l.type === 'image' && !l.crop) l.crop = { z: 1, cx: 0.5, cy: 0.5 };
        return l;
      });
      return card;
    });
    p.name = p.name || 'Untitled sheet';
    YM.applyLayout(p);
    return p;
  }

  function loadProjectObj(data, opts = {}) {
    let p;
    try {
      p = normalizeProject(data);
    } catch (e) {
      YM.toast('That file is not a Michael Yoto Maker project', 'err');
      return false;
    }
    S.project = p;
    S.selectedCard = 0;
    S.selectedLayerId = null;
    S.cropMode = false;
    S.editingText = null;
    S.history = [];
    S.redoStack = [];
    S.hi = -1;
    S.view.zoom = 1;
    S.view.panX = 0;
    S.view.panY = 0;
    if (YM.UI) {
      YM.UI.setProjectName(p.name);
      YM.UI.buildCardNav();
      YM.UI.buildInspector();
      YM.UI.updateHistoryButtons();
      YM.UI.updateStatus();
    }
    commit();
    requestRender();
    if (!opts.silentToast) YM.toast('Project loaded', 'good');
    return true;
  }

  async function openProjectFile(file) {
    try {
      const text = await YM.readFileAsText(file);
      const data = JSON.parse(text);
      const projectData = data && data.project ? data.project : data;
      loadProjectObj(projectData);
    } catch (e) {
      YM.toast('Could not open that file', 'err');
    }
  }

  function newProject(patch = {}) {
    if (S.project && S.project.cards.some((c) => YM.hasContent(c))) {
      if (!confirm('Start a new sheet? Any unsaved changes in the current sheet will be lost (your autosave will be replaced).')) return false;
    }
    const base = YM.newProject({
      pagePreset: patch.pagePreset || (S.project ? S.project.page.preset : 'letter'),
      cardPreset: patch.cardPreset || (S.project ? S.project.card.preset : 'yoto'),
      margin: patch.margin != null ? patch.margin : S.project ? S.project.page.margin : 8,
      gap: patch.gap != null ? patch.gap : S.project ? S.project.page.gap : 3,
      name: patch.name || 'Untitled sheet',
    });
    if (patch.width) base.page.width = patch.width;
    if (patch.height) base.page.height = patch.height;
    if (patch.cardWidth) base.card.width = patch.cardWidth;
    if (patch.cardHeight) base.card.height = patch.cardHeight;
    if (patch.radius != null) base.card.radius = patch.radius;
    base.layout.auto = true;
    base.layout.cols = 1;
    base.layout.rows = 1;
    YM.applyLayout(base);
    loadProjectObj(base, { silentToast: true });
    YM.toast('New sheet created');
    return true;
  }

  function applyPageSetup(cfg) {
    pushHistory();
    const p = S.project;
    p.page.preset = cfg.pagePreset;
    p.page.width = cfg.pageWidth;
    p.page.height = cfg.pageHeight;
    p.page.margin = cfg.margin;
    p.page.gap = cfg.gap;
    p.card.preset = cfg.cardPreset;
    p.card.width = cfg.cardWidth;
    p.card.height = cfg.cardHeight;
    p.card.radius = cfg.radius;
    p.layout.auto = !!cfg.auto;
    if (!cfg.auto) {
      p.layout.cols = cfg.cols;
      p.layout.rows = cfg.rows;
    }
    YM.applyLayout(p);
    ensureSelection();
    commit();
    if (YM.UI) {
      YM.UI.buildCardNav();
      YM.UI.buildInspector();
      YM.UI.updateStatus();
    }
    YM.toast('Layout updated');
  }

  /* ------------------------------------------------------------------ */
  /* fonts                                                              */
  /* ------------------------------------------------------------------ */

  const customFonts = new Set();

  async function registerFont(name, src, persist) {
    try {
      const ff = new FontFace(name, src);
      await ff.load();
      document.fonts.add(ff);
      if (!YM.FONTS.includes(name)) YM.FONTS.push(name);
      customFonts.add(name);
      if (persist) {
        const saved = (await YM.Storage.load('fonts')) || [];
        saved.push({ name, src });
        await YM.Storage.save('fonts', saved);
      }
      return true;
    } catch (e) {
      YM.toast('Could not load that font', 'err');
      return false;
    }
  }

  async function loadSavedFonts() {
    try {
      const saved = (await YM.Storage.load('fonts')) || [];
      for (const f of saved) if (f && f.name && f.src) await registerFont(f.name, f.src, false);
    } catch (e) { /* ignore */ }
  }

  async function addFontFile(file) {
    if (!file) return;
    const name = file.name.replace(/\.[^.]+$/, '').replace(/[^\w\- ]+/g, ' ').trim() || 'Custom font';
    const dataUrl = await YM.readFileAsDataURL(file);
    const ok = await registerFont(name, `url(${dataUrl})`, true);
    if (ok) {
      YM.toast('Font added: ' + name, 'good');
      if (YM.UI) YM.UI.buildInspector();
    }
  }

  /* ------------------------------------------------------------------ */
  /* right-click menu                                                   */
  /* ------------------------------------------------------------------ */

  let menuEl = null;

  function closeContextMenu() {
    if (!menuEl) return;
    menuEl.remove();
    menuEl = null;
  }

  function ctxItem(label, hint, onPick, opts = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ctx-item' + (opts.danger ? ' danger' : '');
    b.setAttribute('role', 'menuitem');
    b.disabled = !!opts.disabled;
    const name = document.createElement('span');
    name.textContent = label;
    b.appendChild(name);
    if (hint) {
      const k = document.createElement('span');
      k.className = 'ctx-hint';
      k.textContent = hint;
      b.appendChild(k);
    }
    b.addEventListener('click', () => {
      closeContextMenu();
      onPick();
    });
    return b;
  }

  function ctxSep() {
    const d = document.createElement('div');
    d.className = 'ctx-sep';
    return d;
  }

  // Right-click paste goes through the async Clipboard API: a canvas is not an
  // editable field, so Chrome's native menu offers no Paste entry. Ctrl+V keeps
  // working through the normal `paste` event below.
  async function pasteFromClipboard() {
    const s = sel();
    if (!s) {
      YM.toast('Click a card first', 'err');
      return;
    }
    if (!navigator.clipboard || !navigator.clipboard.read) {
      YM.toast('This browser cannot read the clipboard — press Ctrl+V instead', 'err');
      return;
    }
    let items = null;
    try {
      items = await navigator.clipboard.read();
    } catch (err) {
      YM.toast('Clipboard access blocked — press Ctrl+V instead', 'err');
      return;
    }
    const files = [];
    for (const item of items || []) {
      const type = (item.types || []).find((t) => /^image\//.test(t));
      if (!type) continue;
      try {
        const blob = await item.getType(type);
        const ext = (type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '');
        files.push(new File([blob], 'Pasted image.' + ext, { type }));
      } catch (err) { /* skip unreadable item */ }
    }
    if (files.length) {
      await addImages(files, s.cardIndex);
      return;
    }
    if (S.clipboardLayer) {
      pasteLayer();
      return;
    }
    YM.toast('No image on the clipboard', 'err');
  }

  function openContextMenu(e) {
    closeContextMenu();
    const p = pagePoint(e.clientX, e.clientY);
    const ci = cardAt(p);
    const hit = ci == null ? null : layerAt(ci, p);

    // Right-clicking a card selects it (and the layer under the cursor) so the
    // menu always acts on what the user pointed at.
    if (ci != null) {
      if (hit) selectCard(ci, { keepLayer: true, silent: true });
      else selectCard(ci, { silent: true });
      if (hit && S.selectedLayerId !== hit.id) selectLayer(hit.id, { silent: true });
      if (YM.UI) { YM.UI.buildCardNav(); YM.UI.buildInspector(); YM.UI.updateStatus(); }
    }

    const s = sel();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.setAttribute('role', 'menu');

    menu.appendChild(ctxItem('Paste', 'Ctrl+V', pasteFromClipboard, { disabled: !s }));
    if (s && S.clipboardCard) {
      menu.appendChild(ctxItem('Paste card design', '', pasteCard));
    }
    menu.appendChild(ctxSep());

    if (s && s.layer) {
      const layer = s.layer;
      menu.appendChild(ctxItem('Copy layer', 'Ctrl+C', copySelected));
      menu.appendChild(ctxItem('Duplicate', 'Ctrl+D', duplicateLayer));
      if (layer.type === 'text') {
        menu.appendChild(ctxItem('Edit text', 'Double-click', () => startTextEdit(layer.id)));
      }
      if (layer.type === 'image') {
        menu.appendChild(ctxItem('Fit image', '', fitLayer));
        menu.appendChild(ctxItem('Crop image', 'C', enterCrop));
        menu.appendChild(ctxItem('Replace image…', '', replaceImage));
      }
      menu.appendChild(ctxSep());
      menu.appendChild(ctxItem('Bring to front', '', () => orderLayer('front')));
      menu.appendChild(ctxItem('Send to back', '', () => orderLayer('back')));
      menu.appendChild(ctxSep());
      menu.appendChild(ctxItem('Delete layer', 'Del', deleteLayer, { danger: true }));
    } else if (s) {
      menu.appendChild(ctxItem('Add text', 'T', addTextLayer));
      menu.appendChild(ctxItem('Add image…', 'I', () => pickImage(s.cardIndex)));
      if (s.card.layers.length || s.card.bg) {
        menu.appendChild(ctxItem('Clear card', '', clearCard));
      }
    } else {
      const note = document.createElement('div');
      note.className = 'ctx-note';
      note.textContent = 'Right-click a card to see options';
      menu.appendChild(note);
    }

    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(e.clientX, window.innerWidth - r.width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(e.clientY, window.innerHeight - r.height - 8)) + 'px';
    menuEl = menu;
  }

  /* ------------------------------------------------------------------ */
  /* event wiring                                                       */
  /* ------------------------------------------------------------------ */

  function bind() {
    canvas = document.getElementById('stage');
    ctx = canvas.getContext('2d');
    wrap = document.getElementById('stagewrap');
    saveStateEl = document.getElementById('saveState');

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      onPointerDown(e);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (S.drag) S.drag.shift = e.shiftKey;
      onPointerMove(e);
    });
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', () => {
      if (!S.drag) {
        S.hoverCard = null;
        S.hoverLayerId = null;
        S.pointer.inside = false;
        requestRender();
      }
    });
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (document.querySelector('.modal-backdrop')) return;
      openContextMenu(e);
    });
    // Close the menu on any outside click, scroll, resize or tab switch.
    document.addEventListener('pointerdown', (e) => {
      if (menuEl && !menuEl.contains(e.target)) closeContextMenu();
    }, true);
    window.addEventListener('blur', closeContextMenu);
    window.addEventListener('resize', closeContextMenu);
    document.addEventListener('scroll', closeContextMenu, true);

    canvas.addEventListener('dblclick', (e) => {
      const p = pagePoint(e.clientX, e.clientY);
      const ci = cardAt(p);
      if (ci == null) return;
      const hit = layerAt(ci, p);
      if (!hit) return;
      if (hit.locked) {
        selectCard(ci, { keepLayer: true, silent: true });
        selectLayer(hit.id, { silent: true });
        return;
      }
      if (hit.type === 'text') {
        startTextEdit(hit.id);
      } else if (hit.type === 'image') {
        selectCard(ci, { keepLayer: true, silent: true });
        selectLayer(hit.id, { silent: true });
        enterCrop();
      }
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (S.cropMode) {
        const layer = activeLayer();
        if (layer) {
          const s = sel();
          const cr = cardRect(s.cardIndex);
          const p = pagePoint(e.clientX, e.clientY);
          const local = { x: p.x - cr.x, y: p.y - cr.y };
          if (local.x >= layer.x && local.y >= layer.y && local.x <= layer.x + layer.w && local.y <= layer.y + layer.h) {
            historyOnce('crop-wheel');
            YM.clampCrop(layer);
            const factor = Math.exp(-e.deltaY * 0.0018);
            layer.crop.z = YM.clamp(layer.crop.z * factor, 0.03, 1);
            // zoom toward the cursor
            const fx = (local.x - layer.x) / layer.w;
            const fy = (local.y - layer.y) / layer.h;
            const cw0 = layer.crop.z / factor;
            const ch0 = (cw0 * layer.imgW * layer.h) / (layer.imgH * layer.w);
            const ch1 = (layer.crop.z * layer.imgW * layer.h) / (layer.imgH * layer.w);
            layer.crop.cx += (fx - 0.5) * (cw0 - layer.crop.z);
            layer.crop.cy += (fy - 0.5) * (ch0 - ch1);
            YM.clampCrop(layer);
            commit();
            if (YM.UI) YM.UI.updateInspectorNumbers();
            return;
          }
        }
      }
      if (e.shiftKey) {
        S.view.panX -= e.deltaY;
        requestRender();
        return;
      }
      const factor = Math.exp(-e.deltaY * 0.0016);
      zoomAt(S.view.zoom * factor, e.clientX, e.clientY);
    }, { passive: false });

    // toolbar tools
    document.getElementById('toolbar').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tool]');
      if (btn) {
        if (btn.dataset.tool === 'shape') S.shapeKind = 'rect';
        setTool(btn.dataset.tool);
      }
    });
    document.getElementById('btnGuides').addEventListener('click', toggleGuides);
    document.getElementById('btnNumbers').addEventListener('click', toggleNumbers);

    // top bar
    document.getElementById('btnUndo').addEventListener('click', undo);
    document.getElementById('btnRedo').addEventListener('click', redo);
    document.getElementById('btnZoomIn').addEventListener('click', () => {
      const r = wrap.getBoundingClientRect();
      zoomAt(S.view.zoom * 1.25, r.left + r.width / 2, r.top + r.height / 2);
    });
    document.getElementById('btnZoomOut').addEventListener('click', () => {
      const r = wrap.getBoundingClientRect();
      zoomAt(S.view.zoom / 1.25, r.left + r.width / 2, r.top + r.height / 2);
    });
    document.getElementById('btnZoomFit').addEventListener('click', zoomFit);
    document.getElementById('zoomLabel').addEventListener('click', zoomFit);
    document.getElementById('btnHelp').addEventListener('click', () => YM.UI.openHelp());
    document.getElementById('btnPageSetup').addEventListener('click', () => YM.UI.openPageSetup());
    document.getElementById('btnNew').addEventListener('click', () => YM.UI.openNew());
    document.getElementById('btnOpen').addEventListener('click', () => document.getElementById('fileProject').click());
    document.getElementById('btnSave').addEventListener('click', saveFile);
    document.getElementById('btnExport').addEventListener('click', () => YM.UI.openExport());

    const nameInput = document.getElementById('projectName');
    nameInput.addEventListener('change', () => {
      pushHistory();
      S.project.name = nameInput.value.trim() || 'Untitled sheet';
      nameInput.value = S.project.name;
      document.title = S.project.name + ' — Michael Yoto Maker';
      commit();
    });
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameInput.blur(); });

    document.getElementById('fileImage').addEventListener('change', async (e) => {
      const input = e.target;
      const file = input.files && input.files[0];
      const cardIdx = input.dataset.card !== '' && input.dataset.card != null ? Number(input.dataset.card) : S.selectedCard;
      if (S.replaceLayerId) await finishReplace(file);
      else await addImages(input.files, cardIdx);
      input.value = '';
    });
    document.getElementById('fileProject').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (f) await openProjectFile(f);
      e.target.value = '';
    });
    document.getElementById('fileFont').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (f) await addFontFile(f);
      e.target.value = '';
    });

    const ta = document.getElementById('textEditor');
    ta.addEventListener('input', onTextInput);
    // Text editing ends on Escape, on clicking the sheet, or when switching
    // tools — not on blur, because the canvas click that starts editing can
    // briefly move focus to the page.

    // keyboard
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // paste
    window.addEventListener('paste', (e) => {
      if (document.querySelector('.modal-backdrop')) return;
      if (S.editingText || isTypingTarget(document.activeElement)) return;
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      const files = [];
      for (const item of items) {
        if (item.kind === 'file' && /^image\//.test(item.type)) {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        e.preventDefault();
        addImages(files, S.selectedCard);
      } else if (S.clipboardLayer) {
        pasteLayer();
      }
    });

    // drag & drop image files
    let dragDepth = 0;
    const dropHint = document.getElementById('dropHint');
    wrap.addEventListener('dragenter', (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
        e.preventDefault();
        dragDepth++;
        dropHint.classList.remove('hidden');
      }
    });
    wrap.addEventListener('dragover', (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        const p = pagePoint(e.clientX, e.clientY);
        const ci = cardAt(p);
        if (ci !== S.hoverCard) {
          S.hoverCard = ci;
          requestRender();
        }
      }
    });
    wrap.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        dropHint.classList.add('hidden');
        S.hoverCard = null;
        requestRender();
      }
    });
    wrap.addEventListener('drop', async (e) => {
      e.preventDefault();
      dragDepth = 0;
      dropHint.classList.add('hidden');
      const files = e.dataTransfer ? Array.from(e.dataTransfer.files || []) : [];
      const p = pagePoint(e.clientX, e.clientY);
      const ci = cardAt(p);
      const projectFile = files.find((f) => /\.(mym|json)$/i.test(f.name));
      if (projectFile) {
        await openProjectFile(projectFile);
        return;
      }
      if (files.length) {
        await addImages(files, ci == null ? S.selectedCard : ci);
      } else {
        S.hoverCard = null;
        requestRender();
      }
    });

    window.addEventListener('resize', () => requestRender());

    window.addEventListener('beforeunload', () => {
      if (S.saveTimer) {
        clearTimeout(S.saveTimer);
        YM.Storage.save('autosave', { savedAt: new Date().toISOString(), project: S.project });
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* init                                                               */
  /* ------------------------------------------------------------------ */

  App.init = async function () {
    bind();
    const guidePref = YM.Prefs.get('guides', true);
    S.showGuides = guidePref !== false;
    S.showNumbers = YM.Prefs.get('numbers', false) === true;

    await loadSavedFonts();
    let restored = null;
    try {
      const saved = await YM.Storage.load('autosave');
      if (saved && saved.project) restored = saved.project;
    } catch (e) { /* ignore */ }

    if (restored) {
      try {
        S.project = normalizeProject(restored);
        YM.UI.setProjectName(S.project.name);
      } catch (e) {
        S.project = YM.newProject();
      }
    } else {
      S.project = YM.newProject();
    }

    S.selectedCard = 0;
    S.history = [];
    S.redoStack = [];
    S.hi = -1;
    S.initialized = true;
    if (YM.UI) {
      YM.UI.syncToggles();
      YM.UI.buildCardNav();
      YM.UI.buildInspector();
      YM.UI.updateHistoryButtons();
      YM.UI.updateStatus();
    }
    render();
    if (restored) YM.toast('Restored your last sheet', 'good', 1600);
  };

  App.commit = commit;
  App.requestRender = requestRender;
  App.pushHistory = pushHistory;
  App.historyOnce = historyOnce;
  App.selectCard = selectCard;
  App.selectLayer = selectLayer;
  App.getSel = sel;
  App.setLayerProp = setLayerProp;
  App.setLayerProps = setLayerProps;
  App.setFilter = setFilter;
  App.setCrop = setCrop;
  App.buildInspector = () => YM.UI.buildInspector();
  App.addTextLayer = addTextLayer;
  App.addShapeLayer = addShapeLayer;
  App.deleteLayer = deleteLayer;
  App.duplicateLayer = duplicateLayer;
  App.orderLayer = orderLayer;
  App.toggleLayerVisible = toggleLayerVisible;
  App.toggleLayerLock = toggleLayerLock;
  App.setCardBg = setCardBg;
  App.clearCard = clearCard;
  App.copyCard = copyCard;
  App.pasteCard = pasteCard;
  App.applyToEmptyCards = applyToEmptyCards;
  App.duplicateToNextEmpty = duplicateToNextEmpty;
  App.addImages = addImages;
  App.pickImage = pickImage;
  App.replaceImage = replaceImage;
  App.enterCrop = enterCrop;
  App.exitCrop = exitCrop;
  App.fitLayer = fitLayer;
  App.resetCrop = resetCrop;
  App.startTextEdit = startTextEdit;
  App.endTextEdit = endTextEdit;
  App.setTool = setTool;
  App.toggleGuides = toggleGuides;
  App.toggleNumbers = toggleNumbers;
  App.undo = undo;
  App.redo = redo;
  App.zoomFit = zoomFit;
  App.zoomAt = zoomAt;
  App.saveFile = saveFile;
  App.openProjectFile = openProjectFile;
  App.loadProjectObj = loadProjectObj;
  App.newProject = newProject;
  App.applyPageSetup = applyPageSetup;
  App.loadSavedFonts = loadSavedFonts;
  App.ensureCardVisible = ensureCardVisible;
  App.flushAutosave = flushAutosave;
  App.registerFont = registerFont;
  App.addFontFile = addFontFile;
  App.S = S;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => App.init());
  } else {
    App.init();
  }
})(window.YM);
