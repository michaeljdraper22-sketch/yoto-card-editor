/* Michael Yoto Maker — export: exact-size PDF (lossless) and PNG */
(function (YM) {
  'use strict';

  const E = (YM.Export = {});

  E.safeName = (name) =>
    (name || 'yoto-sheet')
      .replace(/[\\/:*?"<>|]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 70) || 'yoto-sheet';

  E.fileBase = (project, opts = {}) => {
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const card = opts.cardIndex != null ? ` card ${opts.cardIndex + 1}` : '';
    return `${E.safeName(project.name)}${card} ${stamp}`;
  };

  E.loadAllImages = async (project) => {
    const jobs = [];
    for (const card of project.cards) {
      for (const layer of card.layers) {
        if (layer.type === 'image' && layer.src) jobs.push(YM.ensureImage(layer.src).catch(() => null));
      }
    }
    await Promise.all(jobs);
    try { await document.fonts.ready; } catch (e) { /* ignore */ }
  };

  E.renderToCanvas = async (project, dpi, opts = {}) => {
    await E.loadAllImages(project);
    const ppmm = dpi / 25.4;
    const cardOnly = opts.cardIndex != null;
    const rect = cardOnly ? YM.cardRect(project, opts.cardIndex) : { x: 0, y: 0, w: project.page.width, h: project.page.height };
    const w = Math.max(1, Math.round(rect.w * ppmm));
    const h = Math.max(1, Math.round(rect.h * ppmm));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(w / rect.w, h / rect.h);
    ctx._ppmm = w / rect.w;
    if (cardOnly) {
      // Keep only this card's own artwork — the neighbouring cards must not
      // leak into an individual card export.
      YM.roundRect(ctx, 0, 0, rect.w, rect.h, project.card.radius);
      ctx.clip();
      ctx.translate(-rect.x, -rect.y);
    }
    YM.Render.drawPage(ctx, project, {
      ppmm: w / rect.w,
      forExport: true,
      cutGuides: cardOnly ? false : !!opts.cutGuides,
      cutGuideColor: opts.cutGuideColor || '#c2c2c2',
      pageColor: '#ffffff',
      showGuides: false,
    });
    ctx.restore();
    return canvas;
  };

  E.canvasToBlob = (canvas, type, quality) =>
    new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create image'))), type, quality);
    });

  E.exportPNG = async (project, dpi, opts = {}) => {
    const canvas = await E.renderToCanvas(project, dpi, opts);
    const blob = await E.canvasToBlob(canvas, 'image/png');
    YM.download(`${E.fileBase(project, opts)} ${dpi}dpi.png`, blob);
    return blob.size;
  };

  E.exportJPEG = async (project, dpi, opts = {}) => {
    const canvas = await E.renderToCanvas(project, dpi, opts);
    const blob = await E.canvasToBlob(canvas, 'image/jpeg', 0.95);
    YM.download(`${E.fileBase(project, opts)} ${dpi}dpi.jpg`, blob);
    return blob.size;
  };

  /* ---------------- minimal PDF writer ---------------- */

  const enc = new TextEncoder();
  const fmt = (n) => {
    const r = Math.round(n * 1000) / 1000;
    return String(r);
  };

  async function deflateBytes(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
      const buf = await new Response(stream).arrayBuffer();
      return new Uint8Array(buf);
    } catch (e) {
      return null;
    }
  }

  E.buildPDF = (pageWMM, pageHMM, rgbBytes, imgW, imgH, compressed, title) => {
    const wPt = YM.mmToPt(pageWMM);
    const hPt = YM.mmToPt(pageHMM);
    const parts = [];
    let length = 0;
    const offsets = new Array(6).fill(0);
    const push = (data) => {
      const b = typeof data === 'string' ? enc.encode(data) : data;
      parts.push(b);
      length += b.length;
    };
    const startObj = (n) => {
      offsets[n] = length;
      push(`${n} 0 obj\n`);
    };
    const endObj = () => push('endobj\n');

    // Binary-safe header
    push('%PDF-1.4\n');
    push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

    startObj(1);
    push('<< /Type /Catalog /Pages 2 0 R >>\n');
    endObj();

    startObj(2);
    push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n');
    endObj();

    startObj(3);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(wPt)} ${fmt(hPt)}] ` +
        `/Resources << /XObject << /Im0 5 0 R >> /ProcSet [/PDF /ImageC] >> ` +
        `/Contents 4 0 R >>\n`
    );
    endObj();

    const content = `q\n${fmt(wPt)} 0 0 ${fmt(hPt)} 0 0 cm\n/Im0 Do\nQ\n`;
    const contentBytes = enc.encode(content);
    startObj(4);
    push(`<< /Length ${contentBytes.length} >>\nstream\n`);
    push(contentBytes);
    push('endstream\n');
    endObj();

    startObj(5);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
        (compressed ? '/Filter /FlateDecode ' : '') +
        `/Length ${rgbBytes.length} >>\nstream\n`
    );
    push(rgbBytes);
    push('\nendstream\n');
    endObj();

    const xrefStart = length;
    let xref = 'xref\n0 6\n0000000000 65535 f \n';
    for (let i = 1; i <= 5; i++) {
      xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    }
    push(xref);
    const info = title
      ? ` /Info << /Title (${title.replace(/[()\\]/g, '')}) /Producer (Michael Yoto Maker) >>`
      : ` /Info << /Producer (Michael Yoto Maker) >>`;
    push(`trailer\n<< /Size 6 /Root 1 0 R${info} >>\nstartxref\n${xrefStart}\n%%EOF\n`);

    // concat
    const total = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  };

  E.exportPDF = async (project, dpi, opts = {}) => {
    const canvas = await E.renderToCanvas(project, dpi, opts);
    const w = canvas.width;
    const h = canvas.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const data = ctx.getImageData(0, 0, w, h).data;
    const rgb = new Uint8Array(w * h * 3);
    // Composite onto white: a single-card export has transparent rounded
    // corners, and PDF has no alpha channel.
    for (let i = 0, j = 0; i < data.length; i += 4) {
      const a = data[i + 3] / 255;
      rgb[j++] = Math.round(data[i] * a + 255 * (1 - a));
      rgb[j++] = Math.round(data[i + 1] * a + 255 * (1 - a));
      rgb[j++] = Math.round(data[i + 2] * a + 255 * (1 - a));
    }
    let compressed = await deflateBytes(rgb);
    let useCompressed = true;
    if (!compressed) {
      compressed = rgb;
      useCompressed = false;
    }
    const pageW = opts.cardIndex != null ? project.card.width : project.page.width;
    const pageH = opts.cardIndex != null ? project.card.height : project.page.height;
    const bytes = E.buildPDF(pageW, pageH, compressed, w, h, useCompressed, E.safeName(project.name));
    const blob = new Blob([bytes], { type: 'application/pdf' });
    YM.download(`${E.fileBase(project, opts)} ${dpi}dpi.pdf`, blob);
    return { size: blob.size, w, h };
  };
})(window.YM);
