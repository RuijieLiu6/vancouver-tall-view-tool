/* Minimal PDF writer (no dependencies): A4 landscape pages, Helvetica text, JPEG images.
 * Used by the Site Explorer's one-button report. Text is limited to WinAnsi characters; others are
 * replaced. Produces a Blob. */
(function () {
'use strict';
const PT = { w: 841.89, h: 595.28 }; // A4 landscape in points
function latin1(s) { return String(s ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/—|–/g, '-').replace(/…/g, '...').replace(/·/g, '-').replace(/→/g, '->').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?'); }
function escapePdf(s) { return latin1(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
// Helvetica average widths (approximate per-character advance in 1/1000 em) for wrapping
const W = {}; 'abcdefghijklmnopqrstuvwxyz'.split('').forEach((c) => { W[c] = 520; }); 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((c) => { W[c] = 680; }); '0123456789'.split('').forEach((c) => { W[c] = 556; });
Object.assign(W, { ' ': 278, '.': 278, ',': 278, ':': 278, ';': 278, '-': 333, 'i': 222, 'l': 222, 'j': 222, 't': 278, 'f': 278, 'r': 333, 'm': 833, 'w': 722, 'I': 278, 'M': 833, 'W': 944, '(': 333, ')': 333, '/': 278, "'": 191, '"': 355 });
function textWidth(s, size) { let w = 0; for (const ch of latin1(s)) w += (W[ch] || 560); return w / 1000 * size; }
function wrap(text, size, maxWidth) { const out = []; for (const para of String(text ?? '').split('\n')) { const words = para.split(/\s+/).filter(Boolean); let line = '';
  for (const wd of words) { const cand = line ? line + ' ' + wd : wd; if (textWidth(cand, size) <= maxWidth || !line) line = cand; else { out.push(line); line = wd; } } out.push(line); } return out; }

class Doc {
  constructor() { this.pages = []; this.images = []; }
  page() { const p = { ops: [], imgs: [] }; this.pages.push(p); return p; }
  text(p, x, y, s, size, bold, color) { p.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${color || '0 0 0'} rg ${x.toFixed(2)} ${(PT.h - y).toFixed(2)} Td (${escapePdf(s)}) Tj ET`); }
  paragraph(p, x, y, text, size, maxWidth, opts) { const lines = wrap(text, size, maxWidth); const lh = size * 1.32; lines.forEach((ln, i) => this.text(p, x, y + i * lh, ln, size, opts && opts.bold, opts && opts.color)); return y + lines.length * lh; }
  rect(p, x, y, w, h, fill, stroke) { p.ops.push(`${fill ? fill + ' rg ' : ''}${stroke ? stroke + ' RG 0.6 w ' : ''}${x.toFixed(2)} ${(PT.h - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`); }
  line(p, x1, y1, x2, y2, stroke, width) { p.ops.push(`${stroke || '0.8 0.8 0.8'} RG ${width || 0.6} w ${x1.toFixed(2)} ${(PT.h - y1).toFixed(2)} m ${x2.toFixed(2)} ${(PT.h - y2).toFixed(2)} l S`); }
  image(p, jpegDataUrl, x, y, w, h) { const idx = this.images.length; this.images.push(jpegDataUrl); p.imgs.push(idx); p.ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${(PT.h - y - h).toFixed(2)} cm /Im${idx} Do Q`); }
  table(p, x, y, cols, rows, size, widths) { const lh = size * 1.5; this.text(p, x, y, '', size); let cx = x; cols.forEach((c, i) => { this.text(p, cx, y, c, size, true); cx += widths[i]; }); y += lh; this.line(p, x, y - size * 1.1, x + widths.reduce((a, b) => a + b, 0), y - size * 1.1);
    for (const r of rows) { cx = x; let maxLines = 1; const cells = r.map((c, i) => { const ls = wrap(c, size, widths[i] - 6); maxLines = Math.max(maxLines, ls.length); return ls; }); cells.forEach((ls, i) => { ls.forEach((ln, k) => this.text(p, cx, y + k * lh * 0.9, ln, size)); cx += widths[i]; }); y += lh * 0.9 * maxLines + size * 0.3; } return y; }
  build() { // objects: 1 catalog, 2 pages, 3 F1, 4 F2, then images, then per page: page + content
    const objs = []; const add = (s) => { objs.push(s); return objs.length; };
    add('<< /Type /Catalog /Pages 2 0 R >>'); add('PAGES'); add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'); add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const imgObj = []; const imgBytes = [];
    for (const dataUrl of this.images) { const m = /^data:image\/jpeg;base64,(.*)$/.exec(dataUrl); const bin = atob(m ? m[1] : ''); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dims = jpegSize(bytes); imgBytes.push(bytes); imgObj.push(add({ head: `<< /Type /XObject /Subtype /Image /Width ${dims.w} /Height ${dims.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>`, stream: bytes })); }
    const pageIds = [];
    for (const p of this.pages) { const content = latin1Bytes(p.ops.join('\n')); const cid = add({ head: `<< /Length ${content.length} >>`, stream: content });
      const xobj = p.imgs.map((i) => `/Im${i} ${imgObj[i]} 0 R`).join(' ');
      pageIds.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PT.w} ${PT.h}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ${xobj} >> >> /Contents ${cid} 0 R >>`)); }
    objs[1] = `<< /Type /Pages /Kids [${pageIds.map((i) => i + ' 0 R').join(' ')}] /Count ${pageIds.length} >>`;
    const enc = new TextEncoder(); const parts = [enc.encode('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')]; let offset = parts[0].length; const xref = [];
    objs.forEach((o, i) => { xref.push(offset); const head = enc.encode(`${i + 1} 0 obj\n`); parts.push(head); offset += head.length;
      if (typeof o === 'string') { const b = enc.encode(o + '\nendobj\n'); parts.push(b); offset += b.length; }
      else { const h = enc.encode(o.head + '\nstream\n'); parts.push(h); offset += h.length; parts.push(o.stream); offset += o.stream.length; const t = enc.encode('\nendstream\nendobj\n'); parts.push(t); offset += t.length; } });
    const xrefStart = offset; let xs = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`; for (const off of xref) xs += String(off).padStart(10, '0') + ' 00000 n \n'; xs += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`; parts.push(enc.encode(xs));
    return new Blob(parts, { type: 'application/pdf' }); }
}
function latin1Bytes(str) { const out = new Uint8Array(str.length); for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); out[i] = c < 256 ? c : 63; } return out; }
function jpegSize(b) { let i = 2; while (i < b.length) { if (b[i] !== 0xFF) { i++; continue; } const marker = b[i + 1]; if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] }; i += 2 + ((b[i + 2] << 8) | b[i + 3]); } return { w: 1, h: 1 }; }
window.MiniPdf = { Doc, PT, wrap, latin1, textWidth };
})();
