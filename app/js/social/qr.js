// QR code for my friend code, built as DOM SVG (no innerHTML). Colours come from social.css.
import qrcode from '../../vendor/qrcode.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MARGIN = 2;

/**
 * @param {string} text
 * @param {{label?: string}} [opts]
 * @returns {SVGSVGElement}
 */
export function qrSvg(text, { label = 'QR code' } = {}) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = n + MARGIN * 2;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'cm-qr');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('shape-rendering', 'crispEdges');
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('class', 'cm-qr-bg');
  bg.setAttribute('width', String(size));
  bg.setAttribute('height', String(size));
  const parts = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) parts.push(`M${c + MARGIN} ${r + MARGIN}h1v1h-1z`);
  }
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('class', 'cm-qr-fg');
  path.setAttribute('d', parts.join(''));
  svg.append(bg, path);
  return svg;
}
