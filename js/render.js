/* Michael Yoto Maker — canvas renderer */
(function (YM) {
  'use strict';

  const R = (YM.Render = {});

  R.HANDLE_PX = 9;
  R.ROTATE_DIST_PX = 26;

  R.fontString = (layer) => {
    const style = layer.italic ? 'italic ' : '';
    const weight = layer.bold ? '800 ' : '400 ';
    return `${style}${weight}${layer.size}px "${layer.font}", "${layer.font}", sans-serif`;
  };

  R.applyTextState = (ctx, layer) => {
    ctx.font = R.fontString(layer);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    if ('letterSpacing' in ctx) {
      try {
        ctx.letterSpacing = (layer.letterSpacing || 0) + 'px';
      } catch (e) { /* older browsers */ }
    }
  };

  R.measure = (ctx, layer, str) => ctx.measureText(str).width;

  R.wrapText = (ctx, layer, text, maxW) => {
    const src = layer.uppercase ? String(text || '').toUpperCase() : String(text || '');
    const paragraphs = src.split('\n');
    const lines = [];
    for (const para of paragraphs) {
      if (!para) { lines.push(''); continue; }
      const words = para.split(/\s+/).filter((w) => w.length);
      let line = '';
      for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (R.measure(ctx, layer, test) <= maxW) {
          line = test;
        } else if (!line) {
          // A single word wider than the box: let it overflow instead of
          // chopping it in half. The card clip still keeps it contained.
          line = word;
        } else {
          lines.push(line);
          line = word;
        }
      }
      lines.push(line);
    }
    return lines.length ? lines : [''];
  };

  /** Compute and cache text metrics on the layer. Returns metrics. */
  R.layoutText = (ctx, layer) => {
    ctx.save();
    R.applyTextState(ctx, layer);
    const pad = Math.max(0, layer.bgPadding || 0);
    const innerW = Math.max(1, layer.w - pad * 2);
    const lines = R.wrapText(ctx, layer, layer.text, innerW);
    const lineH = layer.size * (layer.lineHeight || 1.1);
    const widths = lines.map((l) => R.measure(ctx, layer, l));
    const width = Math.max(...widths, 1);
    const height = pad * 2 + lineH * lines.length;
    ctx.restore();
    const m = { lines, widths, lineH, pad, innerW, textWidth: width, height, lineCount: lines.length };
    layer._metrics = m;
    layer.h = height;
    return m;
  };

  R.mediaBox = (layer) => {
    if (layer.type === 'text') {
      const m = layer._metrics || { height: layer.size * 1.2 + (layer.bgPadding || 0) * 2 };
      return { x: layer.x, y: layer.y, w: layer.w, h: m.height };
    }
    return { x: layer.x, y: layer.y, w: layer.w, h: layer.h };
  };

  R.layerCenter = (layer) => {
    const b = R.mediaBox(layer);
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  };

  R.toLocal = (layer, px, py) => {
    const b = R.mediaBox(layer);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const a = (-(layer.rot || 0) * Math.PI) / 180;
    const dx = px - cx;
    const dy = py - cy;
    return {
      x: dx * Math.cos(a) - dy * Math.sin(a) + b.w / 2,
      y: dx * Math.sin(a) + dy * Math.cos(a) + b.h / 2,
      w: b.w,
      h: b.h,
    };
  };

  R.hitLayer = (layer, px, py) => {
    const p = R.toLocal(layer, px, py);
    return p.x >= 0 && p.y >= 0 && p.x <= p.w && p.y <= p.h;
  };

  R.filterString = (f, ppmm) => {
    if (!f) return 'none';
    const parts = [];
    if (f.brightness !== 100) parts.push(`brightness(${f.brightness}%)`);
    if (f.contrast !== 100) parts.push(`contrast(${f.contrast}%)`);
    if (f.saturate !== 100) parts.push(`saturate(${f.saturate}%)`);
    if (f.hue) parts.push(`hue-rotate(${f.hue}deg)`);
    if (f.grayscale) parts.push(`grayscale(${f.grayscale}%)`);
    if (f.sepia) parts.push(`sepia(${f.sepia}%)`);
    if (f.blur) parts.push(`blur(${Math.max(0.05, f.blur * (ppmm || 4))}px)`);
    return parts.length ? parts.join(' ') : 'none';
  };

  /* ---------------- drawing primitives ---------------- */

  R.drawImageLayer = (ctx, layer) => {
    const rec = YM.getImage(layer.src);
    if (!rec || !rec.ready || !rec.img) return;
    const img = rec.img;
    const iw = layer.imgW || img.naturalWidth;
    const ih = layer.imgH || img.naturalHeight;
    YM.clampCrop(layer);
    const c = layer.crop;
    const cw = c.z;
    const ch = (cw * iw * layer.h) / (ih * layer.w);
    const sx = (c.cx - cw / 2) * iw;
    const sy = (c.cy - ch / 2) * ih;
    const sw = cw * iw;
    const sh = ch * ih;

    const cx = layer.x + layer.w / 2;
    const cy = layer.y + layer.h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(((layer.rot || 0) * Math.PI) / 180);
    ctx.scale(layer.flipH ? -1 : 1, layer.flipV ? -1 : 1);
    ctx.globalAlpha *= layer.opacity == null ? 1 : layer.opacity;
    const filter = R.filterString(layer.filters, ctx._ppmm || 4);
    if (filter !== 'none' && 'filter' in ctx) ctx.filter = filter;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, -layer.w / 2, -layer.h / 2, layer.w, layer.h);
    ctx.restore();
  };

  R.drawTextLayer = (ctx, layer) => {
    const m = R.layoutText(ctx, layer);
    const b = { x: layer.x, y: layer.y, w: layer.w, h: m.height };
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(((layer.rot || 0) * Math.PI) / 180);
    ctx.translate(-b.w / 2, -b.h / 2);
    ctx.globalAlpha *= layer.opacity == null ? 1 : layer.opacity;

    if (layer.bgColor) {
      ctx.save();
      ctx.fillStyle = layer.bgColor;
      YM.roundRect(ctx, 0, 0, b.w, b.h, layer.bgRadius || 0);
      ctx.fill();
      ctx.restore();
    }

    if (layer.shadow) {
      ctx.shadowColor = layer.shadowColor || '#000000';
      ctx.shadowBlur = (layer.shadowBlur || 0) * (ctx._ppmm || 4);
      ctx.shadowOffsetX = (layer.shadowX || 0) * (ctx._ppmm || 4);
      ctx.shadowOffsetY = (layer.shadowY || 0) * (ctx._ppmm || 4);
    }

    R.applyTextState(ctx, layer);
    ctx.textAlign = layer.align === 'left' ? 'left' : layer.align === 'right' ? 'right' : 'center';
    const tx = layer.align === 'left' ? m.pad : layer.align === 'right' ? b.w - m.pad : b.w / 2;
    const stroke = layer.strokeWidth > 0 && layer.strokeColor;
    if (stroke) {
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeStyle = layer.strokeColor;
      ctx.lineWidth = layer.strokeWidth;
    }
    ctx.fillStyle = layer.color || '#ffffff';
    for (let i = 0; i < m.lines.length; i++) {
      const line = m.lines[i];
      if (!line) continue;
      const y = m.pad + i * m.lineH;
      if (stroke) ctx.strokeText(line, tx, y);
      ctx.fillText(line, tx, y);
      if (layer.underline) {
        const w = m.widths[i];
        let ux = tx;
        if (ctx.textAlign === 'center') ux = tx - w / 2;
        else if (ctx.textAlign === 'right') ux = tx - w;
        ctx.save();
        ctx.fillRect(ux, y + layer.size * 1.02, w, Math.max(0.15, layer.size * 0.075));
        ctx.restore();
      }
    }
    ctx.restore();
  };

  R.drawShapeLayer = (ctx, layer) => {
    const cx = layer.x + layer.w / 2;
    const cy = layer.y + layer.h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(((layer.rot || 0) * Math.PI) / 180);
    ctx.globalAlpha *= layer.opacity == null ? 1 : layer.opacity;
    ctx.beginPath();
    if (layer.shape === 'ellipse') {
      ctx.ellipse(0, 0, layer.w / 2, layer.h / 2, 0, 0, Math.PI * 2);
    } else {
      const r = Math.min(layer.radius || 0, Math.min(layer.w, layer.h) / 2);
      if (r > 0) {
        // path centered at 0,0
        const x = -layer.w / 2, y = -layer.h / 2, w = layer.w, h = layer.h;
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
      } else {
        ctx.rect(-layer.w / 2, -layer.h / 2, layer.w, layer.h);
      }
    }
    if (layer.fill) {
      ctx.fillStyle = layer.fill;
      ctx.fill();
    }
    if (layer.strokeWidth > 0 && layer.strokeColor) {
      ctx.lineWidth = layer.strokeWidth;
      ctx.strokeStyle = layer.strokeColor;
      ctx.stroke();
    }
    ctx.restore();
  };

  R.drawLayer = (ctx, layer) => {
    if (!layer || layer.visible === false) return;
    if (layer.type === 'image') R.drawImageLayer(ctx, layer);
    else if (layer.type === 'text') R.drawTextLayer(ctx, layer);
    else if (layer.type === 'shape') R.drawShapeLayer(ctx, layer);
  };

  /* ---------------- page ---------------- */

  /**
   * Draw the whole sheet in millimetre coordinates. The caller is responsible
   * for scaling the context (1 unit == 1 mm) and for the ppmm hint used for
   * screen-space line widths and filter blur.
   */
  R.drawPage = (ctx, project, opts) => {
    const o = opts || {};
    const ppmm = o.ppmm || 4;
    ctx._ppmm = ppmm;
    const L = YM.getLayout(project);

    // page
    ctx.save();
    ctx.fillStyle = o.pageColor || '#ffffff';
    ctx.fillRect(0, 0, project.page.width, project.page.height);
    ctx.restore();

    for (let i = 0; i < project.cards.length; i++) {
      const rect = YM.cardRect(project, i);
      const card = project.cards[i];
      ctx.save();
      YM.roundRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.r);
      ctx.clip();
      ctx.fillStyle = card.bg || '#ffffff';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.translate(rect.x, rect.y);
      for (const layer of card.layers) {
        if (o.hideLayerId && layer.id === o.hideLayerId) {
          if (layer.type === 'text') R.layoutText(ctx, layer);
          continue;
        }
        R.drawLayer(ctx, layer);
      }
      ctx.restore();
    }

    if (o.forExport) {
      if (o.cutGuides) {
        ctx.save();
        ctx.strokeStyle = o.cutGuideColor || '#b9b9b9';
        ctx.lineWidth = Math.max(0.12, 0.25);
        for (let i = 0; i < project.cards.length; i++) {
          const rect = YM.cardRect(project, i);
          YM.roundRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.r);
          ctx.stroke();
        }
        ctx.restore();
      }
      ctx._ppmm = null;
      return;
    }

    // on-screen card outlines (never part of export)
    if (o.showGuides !== false) {
      ctx.save();
      ctx.strokeStyle = o.guideColor || 'rgba(10,12,16,0.72)';
      ctx.lineWidth = Math.max(1, 1.1) / ppmm;
      for (let i = 0; i < project.cards.length; i++) {
        const rect = YM.cardRect(project, i);
        YM.roundRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.r);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (o.showNumbers) {
      ctx.save();
      ctx.font = `${Math.max(2.4, 3)}px "Segoe UI", Arial, sans-serif`;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      for (let i = 0; i < project.cards.length; i++) {
        const rect = YM.cardRect(project, i);
        const txt = String(i + 1);
        const tw = ctx.measureText(txt).width;
        ctx.fillStyle = 'rgba(255,255,255,0.82)';
        YM.roundRect(ctx, rect.x + 1.4, rect.y + 1.4, tw + 2.6, 4.2, 1.4);
        ctx.fill();
        ctx.fillStyle = 'rgba(20,24,30,0.85)';
        ctx.fillText(txt, rect.x + 2.7, rect.y + 1.9);
      }
      ctx.restore();
    }
  };

  /* ---------------- selection overlay ---------------- */

  R.drawSelection = (ctx, project, state, ppmm) => {
    const sel = state.selectedCard;
    const layerId = state.selectedLayerId;
    const lineW = 1.5 / ppmm;
    const accent = '#ffb020';

    if (sel != null && project.cards[sel]) {
      const rect = YM.cardRect(project, sel);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,176,32,.95)';
      ctx.lineWidth = 2.2 / ppmm;
      YM.roundRect(ctx, rect.x - 0.6 / ppmm, rect.y - 0.6 / ppmm, rect.w + 1.2 / ppmm, rect.h + 1.2 / ppmm, rect.r + 0.6 / ppmm);
      ctx.stroke();
      ctx.restore();
    }

    if (state.hoverCard != null && state.hoverCard !== sel && project.cards[state.hoverCard]) {
      const rect = YM.cardRect(project, state.hoverCard);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,.55)';
      ctx.lineWidth = 1.4 / ppmm;
      YM.roundRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.r);
      ctx.stroke();
      ctx.restore();
    }

    if (sel == null || !layerId) return;
    const found = YM.findLayer(project, layerId);
    if (!found) return;
    const layer = found.layer;
    const cardRect = YM.cardRect(project, sel);
    const b = R.mediaBox(layer);

    ctx.save();
    // card-local -> page coords
    ctx.translate(cardRect.x + b.x + b.w / 2, cardRect.y + b.y + b.h / 2);
    ctx.rotate(((layer.rot || 0) * Math.PI) / 180);

    if (state.cropMode && layer.type === 'image') {
      // rule of thirds inside the frame
      ctx.strokeStyle = 'rgba(255,255,255,.55)';
      ctx.lineWidth = 0.8 / ppmm;
      for (let i = 1; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(-b.w / 2 + (b.w * i) / 3, -b.h / 2);
        ctx.lineTo(-b.w / 2 + (b.w * i) / 3, b.h / 2);
        ctx.moveTo(-b.w / 2, -b.h / 2 + (b.h * i) / 3);
        ctx.lineTo(b.w / 2, -b.h / 2 + (b.h * i) / 3);
        ctx.stroke();
      }
    }

    ctx.strokeStyle = accent;
    ctx.lineWidth = lineW;
    ctx.setLineDash([4 / ppmm, 3 / ppmm]);
    ctx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);
    ctx.setLineDash([]);

    const hs = R.HANDLE_PX / ppmm;
    const handles = R.handlePoints(b.w, b.h);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.3 / ppmm;
    for (const h of handles) {
      YM.roundRect(ctx, h.x - hs / 2, h.y - hs / 2, hs, hs, hs * 0.24);
      ctx.fill();
      ctx.stroke();
    }
    if (!state.cropMode && layer.type !== 'image') {
      // rotation handle
      const ry = -b.h / 2 - R.ROTATE_DIST_PX / ppmm;
      ctx.beginPath();
      ctx.moveTo(0, -b.h / 2);
      ctx.lineTo(0, ry);
      ctx.strokeStyle = 'rgba(255,176,32,.7)';
      ctx.lineWidth = 1 / ppmm;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, ry, hs * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.fill();
    }
    ctx.restore();
  };

  /** Handle positions relative to the layer centre, in mm. */
  R.handlePoints = (w, h) => [
    { id: 'nw', x: -w / 2, y: -h / 2 },
    { id: 'n', x: 0, y: -h / 2 },
    { id: 'ne', x: w / 2, y: -h / 2 },
    { id: 'e', x: w / 2, y: 0 },
    { id: 'se', x: w / 2, y: h / 2 },
    { id: 's', x: 0, y: h / 2 },
    { id: 'sw', x: -w / 2, y: h / 2 },
    { id: 'w', x: -w / 2, y: 0 },
  ];

  /** Screen-space handle hit test; x,y in page mm. Returns handle id or null. */
  R.hitHandle = (project, state, layer, px, py, ppmm) => {
    const sel = state.selectedCard;
    const rect = YM.cardRect(project, sel);
    const b = R.mediaBox(layer);
    const cx = rect.x + b.x + b.w / 2;
    const cy = rect.y + b.y + b.h / 2;
    const a = ((layer.rot || 0) * Math.PI) / 180;
    const dx = px - cx;
    const dy = py - cy;
    const lx = dx * Math.cos(-a) - dy * Math.sin(-a);
    const ly = dx * Math.sin(-a) + dy * Math.cos(-a);
    const tol = 7 / ppmm;
    for (const h of R.handlePoints(b.w, b.h)) {
      if (Math.abs(lx - h.x) <= tol && Math.abs(ly - h.y) <= tol) return h.id;
    }
    // rotation knob
    if (!state.cropMode) {
      const ry = -b.h / 2 - R.ROTATE_DIST_PX / ppmm;
      if (Math.hypot(lx, ly - ry) <= 9 / ppmm) return 'rot';
    }
    return null;
  };

  R.drawCardThumb = (ctx, project, index, w, h) => {
    // Reserved for future live thumbnails.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
  };
})(window.YM);
