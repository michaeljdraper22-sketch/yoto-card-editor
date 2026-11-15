/* Michael Yoto Maker — utilities */
window.YM = window.YM || {};
(function (YM) {
  'use strict';

  YM.MM_PER_IN = 25.4;
  YM.cmToMm = 1;
  YM.mmToIn = (mm) => mm / 25.4;
  YM.mmToPt = (mm) => (mm / 25.4) * 72;
  YM.ptToMm = (pt) => (pt / 72) * 25.4;

  YM.clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  YM.lerp = (a, b, t) => a + (b - a) * t;
  YM.round = (v, d = 2) => {
    const f = Math.pow(10, d);
    return Math.round(v * f) / f;
  };
  YM.uid = (p = 'id') =>
    p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);

  /** Deep clone that keeps strings (image data) by reference. */
  YM.clone = function clone(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(clone);
    const out = {};
    for (const k in v) if (Object.prototype.hasOwnProperty.call(v, k)) out[k] = clone(v[k]);
    return out;
  };

  YM.esc = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  YM.debounce = (fn, ms) => {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  YM.throttle = (fn, ms) => {
    let last = 0;
    let timer = null;
    let lastArgs = null;
    return (...args) => {
      const now = Date.now();
      lastArgs = args;
      if (now - last >= ms) {
        last = now;
        fn(...args);
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          last = Date.now();
          fn(...lastArgs);
        }, ms - (now - last));
      }
    };
  };

  YM.download = (filename, blobOrBuffer, mime) => {
    const blob =
      blobOrBuffer instanceof Blob ? blobOrBuffer : new Blob([blobOrBuffer], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  YM.readFileAsDataURL = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('Could not read file'));
      r.readAsDataURL(file);
    });

  YM.readFileAsText = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('Could not read file'));
      r.readAsText(file);
    });

  /* ---------- image cache ---------- */
  const imageCache = new Map();
  YM.getImage = (src) => {
    if (!src) return null;
    let rec = imageCache.get(src);
    if (!rec) {
      const img = new Image();
      img.decoding = 'sync';
      img.src = src;
      rec = { img, ready: false, failed: false };
      img.onload = () => { rec.ready = true; };
      img.onerror = () => { rec.failed = true; };
      imageCache.set(src, rec);
    }
    return rec;
  };
  YM.ensureImage = (src) =>
    new Promise((resolve, reject) => {
      const rec = YM.getImage(src);
      if (!rec) return reject(new Error('No image'));
      if (rec.ready) return resolve(rec.img);
      if (rec.failed) return reject(new Error('Image failed to load'));
      rec.img.addEventListener('load', () => resolve(rec.img), { once: true });
      rec.img.addEventListener('error', () => reject(new Error('Image failed to load')), { once: true });
    });
  YM.imageReady = (src) => {
    const rec = YM.getImage(src);
    return !!(rec && rec.ready && !rec.failed);
  };
  YM.imageSize = (src) => {
    const rec = YM.getImage(src);
    return rec && rec.ready ? { w: rec.img.naturalWidth, h: rec.img.naturalHeight } : null;
  };

  /* ---------- canvas helpers ---------- */
  YM.roundRect = (ctx, x, y, w, h, r) => {
    const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, rr);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  };

  /* ---------- color ---------- */
  YM.normHex = (hex) => {
    if (!hex) return '#000000';
    let h = String(hex).trim().toLowerCase();
    if (h === 'transparent' || h === 'none') return null;
    if (h[0] !== '#') h = '#' + h;
    if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    return h;
  };
  YM.hexToRgb = (hex) => {
    const h = YM.normHex(hex) || '#000000';
    return {
      r: parseInt(h.slice(1, 3), 16),
      g: parseInt(h.slice(3, 5), 16),
      b: parseInt(h.slice(5, 7), 16),
    };
  };
  YM.hexToRgba = (hex, a) => {
    const c = YM.hexToRgb(hex);
    return `rgba(${c.r},${c.g},${c.b},${a})`;
  };
  YM.lighten = (hex, amt) => {
    const c = YM.hexToRgb(hex);
    const f = (v) => YM.clamp(Math.round(v + 255 * amt), 0, 255);
    return '#' + [f(c.r), f(c.g), f(c.b)].map((v) => v.toString(16).padStart(2, '0')).join('');
  };
  YM.contrastInk = (hex) => {
    const c = YM.hexToRgb(hex);
    const lum = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
    return lum > 0.62 ? '#141414' : '#ffffff';
  };

  /* ---------- DOM ---------- */
  YM.$ = (sel, root) => (root || document).querySelector(sel);
  YM.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  YM.el = (tag, attrs, children) => {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.startsWith('on') && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] != null && attrs[k] !== false) node.setAttribute(k, attrs[k]);
      }
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach((c) => {
        if (c == null || c === false) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  };
  YM.icon = (name, size) => {
    const paths = {
      eye: '<path d="M2.2 12S5.8 5.6 12 5.6 21.8 12 21.8 12 18.2 18.4 12 18.4 2.2 12 2.2 12Z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="2.9" fill="none" stroke="currentColor" stroke-width="1.7"/>',
      eyeOff: '<path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c6.2 0 9.8 6 9.8 6a17 17 0 0 1-3.2 3.8M6.2 7.5A17.5 17.5 0 0 0 2.2 12S5.8 18 12 18a9.7 9.7 0 0 0 3.6-.7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
      up: '<path d="M12 19V5M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
      down: '<path d="M12 5v14M6 13l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
      top: '<path d="M5 5h14M12 9v10M7 13l5-5 5 5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
      bottom: '<path d="M5 19h14M12 15V5M7 11l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
      trash: '<path d="M4 7h16M9 7V5h6v2M6.5 7l.8 12.2A1.8 1.8 0 0 0 9 21h6a1.8 1.8 0 0 0 1.8-1.8L17.5 7M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
      copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M15.5 5.5v-1a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h1" fill="none" stroke="currentColor" stroke-width="1.7"/>',
      text: '<path d="M4 6V4h16v2M12 4v16M8.5 20h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="9" cy="10" r="1.7" fill="currentColor"/><path d="m5 18 5-5 3.5 3.5L16.5 13l2.8 3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
      shape: '<rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/>',
      lock: '<rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" fill="none" stroke="currentColor" stroke-width="1.7"/>',
      unlock: '<rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8.5 10V7.5a3.5 3.5 0 0 1 6.9-.8" fill="none" stroke="currentColor" stroke-width="1.7"/>',
      close: '<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
      plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      duplicate: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M15.5 5.5v-1a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h1" fill="none" stroke="currentColor" stroke-width="1.7"/>',
    };
    return `<svg viewBox="0 0 24 24" width="${size || 16}" height="${size || 16}" aria-hidden="true">${paths[name] || ''}</svg>`;
  };

  YM.toast = (msg, kind, ms) => {
    const root = document.getElementById('toasts');
    if (!root) return;
    const t = YM.el('div', { class: 'toast ' + (kind || ''), text: msg });
    root.appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity .25s, transform .25s';
      t.style.opacity = '0';
      t.style.transform = 'translateY(6px)';
      setTimeout(() => t.remove(), 260);
    }, ms || 2300);
  };

  YM.formatMM = (v) => {
    const r = YM.round(v, 1);
    return (Math.abs(r - Math.round(r)) < 0.05 ? Math.round(r) : r) + ' mm';
  };

  YM.pxToMM = (px, dpi) => (px / dpi) * 25.4;
}) (window.YM);
