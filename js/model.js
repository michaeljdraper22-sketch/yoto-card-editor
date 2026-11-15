/* Michael Yoto Maker — document model */
(function (YM) {
  'use strict';

  YM.PAGE_PRESETS = {
    letter: { label: 'US Letter — 8.5 × 11 in', w: 215.9, h: 279.4 },
    a4: { label: 'A4 — 210 × 297 mm', w: 210, h: 297 },
    legal: { label: 'US Legal — 8.5 × 14 in', w: 215.9, h: 355.6 },
    a5: { label: 'A5 — 148 × 210 mm', w: 148, h: 210 },
    tabloid: { label: 'Tabloid — 11 × 17 in', w: 279.4, h: 431.8 },
    custom: { label: 'Custom size', w: 215.9, h: 279.4 },
  };

  // Popular sticker / label sizes. Yoto cards and the ABC RFID blanks are both
  // ISO/IEC 7810 ID-1 (CR80) cards: 85.60 × 53.98 mm, 3.18 mm corner radius.
  YM.CARD_PRESETS = {
    cr80: { label: 'CR80 card — 53.98 × 85.6 mm (Yoto / RFID blanks)', w: 53.98, h: 85.6, r: 3.18 },
    yoto: { label: 'Yoto / CR80 card — 53.98 × 85.6 mm', w: 53.98, h: 85.6, r: 3.18 },
    yoto_tight: { label: 'Yoto sticker — 50 × 82 mm', w: 50, h: 82, r: 2.5 },
    avery94237: { label: 'Avery 94237 — 2 × 3 in', w: 50.8, h: 76.2, r: 2.5 },
    avery94238: { label: 'Avery 94238 — 2 × 3.5 in', w: 50.8, h: 88.9, r: 2.5 },
    card: { label: 'Business card — 54 × 85.6 mm', w: 54, h: 85.6, r: 3 },
    square: { label: 'Square — 60 × 60 mm', w: 60, h: 60, r: 3 },
    custom: { label: 'Custom size', w: 53.98, h: 85.6, r: 3.18 },
  };

  YM.FONTS = [
    'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara',
    'Century Gothic', 'Comic Sans MS', 'Consolas', 'Courier New',
    'Franklin Gothic Medium', 'Georgia', 'Impact', 'Lucida Console',
    'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Segoe UI', 'Sitka Text',
    'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana',
  ];

  YM.LAYER_DEFAULTS = {
    opacity: 1,
    rot: 0,
    visible: true,
    locked: false,
    flipH: false,
    flipV: false,
  };

  YM.TEXT_DEFAULTS = {
    font: 'Arial',
    size: 6,
    bold: true,
    italic: false,
    underline: false,
    uppercase: false,
    align: 'center',
    lineHeight: 1.08,
    letterSpacing: 0,
    color: '#ffffff',
    strokeColor: '#000000',
    strokeWidth: 0.45,
    bgColor: null,
    bgPadding: 1.2,
    bgRadius: 1.4,
    shadow: true,
    shadowColor: '#000000',
    shadowBlur: 1.2,
    shadowX: 0,
    shadowY: 0.5,
  };

  YM.newCard = () => ({ id: YM.uid('card'), bg: null, layers: [] });

  YM.newTextLayer = (card, project, text) => {
    const t = YM.clone(YM.TEXT_DEFAULTS);
    const layer = Object.assign(
      {
        id: YM.uid('txt'),
        type: 'text',
        name: 'Text',
        x: project.card.width * 0.1,
        y: project.card.height * 0.38,
        w: project.card.width * 0.8,
        h: project.card.height * 0.2,
        rot: 0,
        ...YM.LAYER_DEFAULTS,
      },
      t
    );
    layer.text = text || 'Your text';
    layer.name = layer.text.slice(0, 28);
    return layer;
  };

  YM.newShapeLayer = (project, shape) => {
    const w = project.card.width * 0.62;
    const h = project.card.height * 0.24;
    return Object.assign(
      {
        id: YM.uid('shp'),
        type: 'shape',
        shape: shape || 'rect',
        name: shape === 'ellipse' ? 'Ellipse' : 'Rectangle',
        x: (project.card.width - w) / 2,
        y: (project.card.height - h) / 2,
        w,
        h,
        rot: 0,
        fill: '#ffb020',
        strokeColor: null,
        strokeWidth: 0,
        radius: 2,
        ...YM.LAYER_DEFAULTS,
      },
      {}
    );
  };

  YM.newImageLayer = ({ src, imgW, imgH, project, name }) => {
    // Start edge-to-edge: a pasted image becomes instant card art. "Fit image"
    // in the inspector switches to a contained picture instead.
    const layer = {
      id: YM.uid('img'),
      type: 'image',
      name: name || 'Image',
      x: 0,
      y: 0,
      w: project.card.width,
      h: project.card.height,
      rot: 0,
      ...YM.LAYER_DEFAULTS,
      src,
      imgW,
      imgH,
      crop: { z: 1, cx: 0.5, cy: 0.5 },
      filters: { brightness: 100, contrast: 100, saturate: 100, hue: 0, blur: 0, grayscale: 0, sepia: 0 },
    };
    YM.fitCover(layer);
    return layer;
  };

  /** Clamp the crop rectangle so it stays inside the image. Mutates layer.crop. */
  YM.clampCrop = (layer) => {
    const c = layer.crop || (layer.crop = { z: 1, cx: 0.5, cy: 0.5 });
    const iw = layer.imgW || 1;
    const ih = layer.imgH || 1;
    const frameAspect = layer.w / Math.max(0.001, layer.h);
    let cw = YM.clamp(c.z || 1, 0.02, 1);
    let ch = (cw * iw * layer.h) / (ih * layer.w); // aspect-matched
    if (ch > 1) {
      ch = 1;
      cw = (ch * ih * layer.w) / (iw * layer.h);
    }
    // Guard against degenerate frames
    if (!isFinite(cw) || cw <= 0) cw = 1;
    if (!isFinite(ch) || ch <= 0) ch = 1;
    c.z = cw;
    c.cx = YM.clamp(c.cx == null ? 0.5 : c.cx, cw / 2, 1 - cw / 2);
    c.cy = YM.clamp(c.cy == null ? 0.5 : c.cy, ch / 2, 1 - ch / 2);
    layer.crop = c;
    return { cw, ch, x: c.cx - cw / 2, y: c.cy - ch / 2 };
  };

  /** Crop rectangle in normalized source coords. */
  YM.cropRect = (layer) => YM.clampCrop(layer);

  /** Make the current crop cover the frame exactly (fills from edge to edge at zoom 1). */
  YM.fitCover = (layer) => {
    const iw = layer.imgW || 1;
    const ih = layer.imgH || 1;
    const imgAspect = iw / ih;
    const frameAspect = layer.w / Math.max(0.001, layer.h);
    let cw, ch;
    if (imgAspect >= frameAspect) {
      ch = 1;
      cw = frameAspect / imgAspect;
    } else {
      cw = 1;
      ch = imgAspect / frameAspect;
    }
    layer.crop = { z: cw, cx: 0.5, cy: 0.5 };
    YM.clampCrop(layer);
    return { cw, ch };
  };

  /** Fit the layer frame to the image aspect inside the card (letterbox). */
  YM.fitContain = (layer, card) => {
    const iw = layer.imgW || 1;
    const ih = layer.imgH || 1;
    const aspect = iw / ih;
    const maxW = card.width * 0.92;
    const maxH = card.height * 0.92;
    let w = maxW;
    let h = w / aspect;
    if (h > maxH) {
      h = maxH;
      w = h * aspect;
    }
    layer.w = w;
    layer.h = h;
    layer.x = (card.width - w) / 2;
    layer.y = (card.height - h) / 2;
    layer.crop = { z: 1, cx: 0.5, cy: 0.5 };
    YM.clampCrop(layer);
  };

  /** Stretch the frame to the full card and cover it. */
  YM.fillCard = (layer, card) => {
    layer.w = card.width;
    layer.h = card.height;
    layer.x = 0;
    layer.y = 0;
    YM.fitCover(layer);
  };

  YM.newProject = (opts = {}) => {
    const page = YM.PAGE_PRESETS[opts.pagePreset || 'letter'];
    const card = YM.CARD_PRESETS[opts.cardPreset || 'yoto'];
    const project = {
      version: 1,
      name: opts.name || 'Untitled sheet',
      page: {
        preset: opts.pagePreset || 'letter',
        width: page.w,
        height: page.h,
        margin: opts.margin != null ? opts.margin : 8,
        gap: opts.gap != null ? opts.gap : 3,
      },
      card: {
        preset: opts.cardPreset || 'yoto',
        width: card.w,
        height: card.h,
        radius: card.r,
      },
      layout: { cols: 3, rows: 3, auto: true },
      cards: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    YM.applyLayout(project);
    return project;
  };

  /** Compute columns/rows that fit the page (or honor manual values). */
  YM.computeGrid = (project, overrides) => {
    const page = project.page;
    const card = project.card;
    const margin = Math.max(0, page.margin);
    const gap = Math.max(0, page.gap);
    const availW = page.width - margin * 2;
    const availH = page.height - margin * 2;
    const maxCols = Math.max(1, Math.floor((availW + gap) / (card.width + gap)));
    const maxRows = Math.max(1, Math.floor((availH + gap) / (card.height + gap)));
    let cols = overrides && overrides.cols != null ? overrides.cols : project.layout.cols;
    let rows = overrides && overrides.rows != null ? overrides.rows : project.layout.rows;
    if (project.layout.auto || cols == null || rows == null) {
      cols = maxCols;
      rows = maxRows;
    }
    // Never allow a manual grid that can't fit on the page.
    cols = YM.clamp(Math.round(cols), 1, Math.max(1, maxCols));
    rows = YM.clamp(Math.round(rows), 1, Math.max(1, maxRows));
    return { cols, rows, maxCols, maxRows };
  };

  /** Recompute layout and grow/shrink the card list. */
  YM.applyLayout = (project, opts = {}) => {
    const grid = YM.computeGrid(project, opts);
    project.layout.cols = grid.cols;
    project.layout.rows = grid.rows;
    project.layout.auto = opts.auto != null ? opts.auto : project.layout.auto;
    const cardW = project.card.width;
    const cardH = project.card.height;
    const gap = Math.max(0, project.page.gap);
    const usedW = grid.cols * cardW + (grid.cols - 1) * gap;
    const usedH = grid.rows * cardH + (grid.rows - 1) * gap;
    const originX = Math.max(0, (project.page.width - usedW) / 2);
    const originY = Math.max(0, (project.page.height - usedH) / 2);
    project._layout = { ...grid, originX, originY, usedW, usedH };
    const total = grid.cols * grid.rows;
    while (project.cards.length < total) project.cards.push(YM.newCard());
    if (project.cards.length > total) project.cards.length = total;
    return project._layout;
  };

  YM.getLayout = (project) => project._layout || YM.applyLayout(project);

  /** Distance from each sheet edge to the nearest card edge (mm). */
  YM.sheetMargins = (project) => {
    const L = YM.getLayout(project);
    const left = L.originX;
    const right = project.page.width - (L.originX + L.usedW);
    const top = L.originY;
    const bottom = project.page.height - (L.originY + L.usedH);
    return {
      left,
      right,
      top,
      bottom,
      smallest: Math.min(left, right, top, bottom),
    };
  };

  YM.cardRect = (project, index) => {
    const L = YM.getLayout(project);
    const col = index % L.cols;
    const row = Math.floor(index / L.cols);
    return {
      x: L.originX + col * (project.card.width + project.page.gap),
      y: L.originY + row * (project.card.height + project.page.gap),
      w: project.card.width,
      h: project.card.height,
      r: project.card.radius,
      col,
      row,
    };
  };

  YM.pageRect = (project) => ({ x: 0, y: 0, w: project.page.width, h: project.page.height });

  YM.emptyCard = () => YM.newCard();

  YM.hasContent = (card) => !!(card && ((card.layers && card.layers.length) || card.bg));

  YM.findLayer = (project, layerId) => {
    for (let i = 0; i < project.cards.length; i++) {
      const card = project.cards[i];
      for (let j = 0; j < card.layers.length; j++) {
        if (card.layers[j].id === layerId) return { card, cardIndex: i, layer: card.layers[j], index: j };
      }
    }
    return null;
  };

  YM.layerLabel = (layer) => {
    if (!layer) return '';
    if (layer.type === 'text') return (layer.text || 'Text').replace(/\s+/g, ' ').slice(0, 32) || 'Text';
    return layer.name || (layer.type === 'image' ? 'Image' : 'Shape');
  };
})(window.YM);
