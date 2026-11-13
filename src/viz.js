/**
 * Server-rendered SVG chart components.
 *
 * Every chart here follows the same fixed mark specs:
 *   - bars <= 24px thick, 4px rounded data-end, square at the baseline
 *   - lines 2px, round join/cap; markers r >= 4 with a 2px surface ring
 *   - area fills are a ~10% wash, never a saturated block
 *   - gridlines/axes are solid 1px hairlines, recessive
 *   - a 2px surface gap separates touching marks
 *
 * Colours come from CSS custom properties so light/dark swap in one place and
 * the markup is written against roles, not raw hex.
 *
 * Each chart also emits a table-view twin (see `tableView`) so no value is ever
 * reachable only by hovering.
 */

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const round = (n, d = 1) => Number(n).toFixed(d).replace(/\.0$/, '');

let uid = 0;
const nextId = () => `viz${++uid}`;

/** Attendance bands -> severity token. Shared by every surface that shows a rate. */
export function tone(pct) {
  if (pct >= 75) return 'good';
  if (pct >= 60) return 'warning';
  return 'critical';
}

/** Icon + label is mandatory for status colour: red/green alone fails CVD. */
export const STATUS_ICON = {
  Present: '✓',   // check
  Late:    '◔',   // quarter-filled circle
  Absent:  '✕',   // cross
};

const STATUS_TOKEN = { Present: 'good', Late: 'warning', Absent: 'critical' };

/* ------------------------------------------------------------------ meter */

/**
 * A single ratio against a limit. The unfilled track is a lighter step of the
 * same ramp so the state reads across the whole bar.
 */
export function meter(pct, { token = null, height = 8 } = {}) {
  const t = token ?? tone(pct);
  const w = Math.max(0, Math.min(100, pct));
  return `<div class="meter meter--${t}" style="--h:${height}px" role="presentation">` +
         `<span style="width:${round(w, 1)}%"></span></div>`;
}

/**
 * Several ratios, one per named row, each against its own whole.
 * A name, a bar and a figure per row, bars aligned.
 */
export function meterList(rows, { nameLabel = 'Name', valueLabel = 'Value' } = {}) {
  if (!rows.length) return '';
  const body = rows.map((r) => {
    const t = r.token ?? tone(r.pct);
    return `<div class="mlist__row">
      <div class="mlist__name">
        <span class="mlist__title">${esc(r.name)}</span>
        ${r.sub ? `<span class="mlist__sub">${esc(r.sub)}</span>` : ''}
      </div>
      <div class="mlist__bar">${meter(r.pct, { token: t })}</div>
      <div class="mlist__fig">
        <span class="mlist__pct">${round(r.pct, 1)}%</span>
        ${r.detail ? `<span class="mlist__detail">${esc(r.detail)}</span>` : ''}
      </div>
    </div>`;
  }).join('');

  const table = tableView(
    [nameLabel, valueLabel, 'Share'],
    rows.map((r) => [r.name, r.detail ?? '', `${round(r.pct, 1)}%`])
  );
  return `<div class="mlist">${body}</div>${table}`;
}

/* --------------------------------------------------- tall segmented bar */

/**
 * One whole split into <= 6 parts, read at a glance, standing alone.
 * 28px tall, 4px corners, a 2px surface gap between parts, the share printed
 * inside only where it genuinely fits, and a legend of names.
 */
export function segmentedBar(parts, { unit = '' } = {}) {
  const total = parts.reduce((s, p) => s + Number(p.value), 0);
  if (!total) return '';

  const visible = parts.filter((p) => Number(p.value) > 0);
  const id = nextId();

  const blocks = visible.map((p) => {
    const share = (Number(p.value) / total) * 100;
    const t = p.token ?? STATUS_TOKEN[p.name] ?? 'brand';
    const label = `${round(share, 0)}%`;
    // Only print the label when the block is wide enough to hold it with
    // padding - a clipped label is worse than no label.
    const fits = share >= 11;
    const icon = STATUS_ICON[p.name] ?? '';
    return `<div class="segbar__part segbar__part--${t}"
                 style="flex:${share} 0 0"
                 tabindex="0" role="listitem"
                 aria-label="${esc(p.name)}: ${esc(p.value)}${esc(unit)}, ${round(share, 1)} percent"
                 data-tip="${esc(p.name)} &middot; ${esc(p.value)}${esc(unit)} &middot; ${round(share, 1)}%">
              ${fits ? `<span class="segbar__label">${label}</span>` : ''}
            </div>`;
  }).join('');

  const legend = visible.map((p) => {
    const t = p.token ?? STATUS_TOKEN[p.name] ?? 'brand';
    return `<span class="legend__item">
              <span class="legend__swatch legend__swatch--${t}" aria-hidden="true"></span>
              <span class="legend__icon" aria-hidden="true">${STATUS_ICON[p.name] ?? ''}</span>
              ${esc(p.name)}
            </span>`;
  }).join('');

  const table = tableView(
    ['Status', 'Classes', 'Share'],
    visible.map((p) => [p.name, p.value, `${round((p.value / total) * 100, 1)}%`])
  );

  return `<div class="segbar" id="${id}">
            <div class="segbar__track" role="list">${blocks}</div>
            <div class="legend">${legend}</div>
          </div>${table}`;
}

/* ------------------------------------------------------------ line chart */

/**
 * Trend over time, single series. Area wash + 2px line + end marker, with a
 * crosshair/tooltip hover layer and generous hit bands.
 */
export function lineChart(points, {
  height = 230,
  width = 760,
  yMax = 100,
  yUnit = '%',
  valueLabel = 'Value',
  dateLabel = 'Date',
} = {}) {
  if (points.length === 0) return '';

  const P = { t: 16, r: 18, b: 30, l: 42 };
  const iw = width - P.l - P.r;
  const ih = height - P.t - P.b;

  // A single point has no line to draw - fall back to a stat-style note.
  const n = points.length;
  const x = (i) => (n === 1 ? P.l + iw / 2 : P.l + (i / (n - 1)) * iw);
  const y = (v) => P.t + ih - (Math.max(0, Math.min(yMax, v)) / yMax) * ih;

  const ticks = [0, 25, 50, 75, 100].filter((t) => t <= yMax);
  const grid = ticks.map((t) =>
    `<line class="viz-grid" x1="${P.l}" y1="${round(y(t), 2)}" x2="${P.l + iw}" y2="${round(y(t), 2)}"/>` +
    `<text class="viz-tick" x="${P.l - 8}" y="${round(y(t) + 4, 2)}" text-anchor="end">${t}${yUnit}</text>`
  ).join('');

  // The 75% requirement line - a real threshold, so it earns a distinct mark.
  // The label sits at the LEFT edge: at the right it collided with the end
  // marker, which lands exactly on 75% whenever a student is borderline.
  const threshold = yMax === 100
    ? `<line class="viz-threshold" x1="${P.l}" y1="${round(y(75), 2)}" x2="${P.l + iw}" y2="${round(y(75), 2)}"/>
       <text class="viz-threshold-label" x="${P.l + 6}" y="${round(y(75) - 5, 2)}" text-anchor="start">75% required</text>`
    : '';

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${round(x(i), 2)},${round(y(p.value), 2)}`).join(' ');
  const area = `${line} L${round(x(n - 1), 2)},${round(y(0), 2)} L${round(x(0), 2)},${round(y(0), 2)} Z`;

  // x labels: show at most 6, always first and last
  const step = Math.max(1, Math.ceil(n / 6));
  const xLabels = points.map((p, i) => {
    if (i !== 0 && i !== n - 1 && i % step !== 0) return '';
    const anchor = i === 0 ? 'start' : (i === n - 1 ? 'end' : 'middle');
    return `<text class="viz-tick" x="${round(x(i), 2)}" y="${height - 10}" text-anchor="${anchor}">${esc(p.label)}</text>`;
  }).join('');

  const dots = points.map((p, i) =>
    `<circle class="viz-dot" cx="${round(x(i), 2)}" cy="${round(y(p.value), 2)}" r="4"/>`
  ).join('');

  // Hover bands - wide hit targets, not pinpoint dots.
  const bandW = n === 1 ? iw : iw / (n - 1);
  const hits = points.map((p, i) =>
    `<rect class="viz-hit" x="${round(x(i) - bandW / 2, 2)}" y="${P.t}"
           width="${round(bandW, 2)}" height="${ih}"
           tabindex="0" role="img"
           aria-label="${esc(p.full ?? p.label)}: ${round(p.value, 1)}${yUnit}"
           data-cx="${round(x(i), 2)}" data-cy="${round(y(p.value), 2)}"
           data-tip="${esc(p.full ?? p.label)} &middot; ${round(p.value, 1)}${yUnit}"/>`
  ).join('');

  // Direct-label the final point only - never a number on every point.
  const last = points[n - 1];
  const lastX = x(n - 1), lastY = y(last.value);
  const endLabel = `<g class="viz-endlabel" transform="translate(${round(lastX, 2)},${round(lastY, 2)})">
      <circle class="viz-dot viz-dot--end" r="5"/>
    </g>`;

  const table = tableView(
    [dateLabel, valueLabel],
    points.map((p) => [p.full ?? p.label, `${round(p.value, 1)}${yUnit}`])
  );

  return `<div class="chart">
    <div class="chart__scroll">
      <svg class="viz" viewBox="0 0 ${width} ${height}" role="group"
           aria-label="${esc(valueLabel)} over time" preserveAspectRatio="xMidYMid meet">
        ${grid}
        <path class="viz-area" d="${area}"/>
        ${threshold}
        <path class="viz-line" d="${line}"/>
        ${dots}
        ${endLabel}
        <line class="viz-axis" x1="${P.l}" y1="${P.t + ih}" x2="${P.l + iw}" y2="${P.t + ih}"/>
        ${xLabels}
        <g class="viz-crosshair" hidden><line y1="${P.t}" y2="${P.t + ih}"/></g>
        ${hits}
      </svg>
    </div>
  </div>${table}`;
}

/* ------------------------------------------------------------ column chart */

/**
 * Magnitude across ordered bands. One hue - a ramp here would double-encode
 * the bar length and buy nothing.
 */
export function columnChart(bars, { height = 210, width = 760, yLabel = 'Students' } = {}) {
  if (!bars.length) return '';
  const P = { t: 16, r: 16, b: 44, l: 38 };
  const iw = width - P.l - P.r;
  const ih = height - P.t - P.b;

  const max = Math.max(1, ...bars.map((b) => b.value));
  const niceMax = Math.ceil(max / 5) * 5 || 5;
  const band = iw / bars.length;
  const barW = Math.min(24, band * 0.5);          // cap thickness; leftover is air

  const ticks = [0, niceMax / 2, niceMax];
  const y = (v) => P.t + ih - (v / niceMax) * ih;

  const grid = ticks.map((t) =>
    `<line class="viz-grid" x1="${P.l}" y1="${round(y(t), 2)}" x2="${P.l + iw}" y2="${round(y(t), 2)}"/>` +
    `<text class="viz-tick" x="${P.l - 8}" y="${round(y(t) + 4, 2)}" text-anchor="end">${Math.round(t)}</text>`
  ).join('');

  const cols = bars.map((b, i) => {
    const cx = P.l + band * i + band / 2;
    const h = b.value === 0 ? 0 : Math.max(2, (b.value / niceMax) * ih);
    const top = P.t + ih - h;
    const t = b.token ?? 'brand';
    // 4px rounded cap, square at the baseline
    const r = Math.min(4, h);
    const d = h === 0 ? '' :
      `M${round(cx - barW / 2, 2)},${round(P.t + ih, 2)}
       L${round(cx - barW / 2, 2)},${round(top + r, 2)}
       Q${round(cx - barW / 2, 2)},${round(top, 2)} ${round(cx - barW / 2 + r, 2)},${round(top, 2)}
       L${round(cx + barW / 2 - r, 2)},${round(top, 2)}
       Q${round(cx + barW / 2, 2)},${round(top, 2)} ${round(cx + barW / 2, 2)},${round(top + r, 2)}
       L${round(cx + barW / 2, 2)},${round(P.t + ih, 2)} Z`;
    return `${h ? `<path class="viz-bar viz-bar--${t}" d="${d}"/>` : ''}
      <rect class="viz-hit" x="${round(P.l + band * i, 2)}" y="${P.t}" width="${round(band, 2)}" height="${ih}"
            tabindex="0" role="img"
            aria-label="${esc(b.label)}: ${b.value} ${esc(yLabel.toLowerCase())}"
            data-tip="${esc(b.label)} &middot; ${b.value} ${esc(yLabel.toLowerCase())}"/>
      <text class="viz-tick" x="${round(cx, 2)}" y="${height - 24}" text-anchor="middle">${esc(b.label)}</text>
      ${b.caption ? `<text class="viz-tick viz-tick--sub" x="${round(cx, 2)}" y="${height - 10}" text-anchor="middle">${esc(b.caption)}</text>` : ''}`;
  }).join('');

  const table = tableView(['Band', yLabel], bars.map((b) => [b.label, b.value]));

  return `<div class="chart">
    <div class="chart__scroll">
      <svg class="viz" viewBox="0 0 ${width} ${height}" role="group"
           aria-label="${esc(yLabel)} by band" preserveAspectRatio="xMidYMid meet">
        ${grid}
        ${cols}
        <line class="viz-axis" x1="${P.l}" y1="${P.t + ih}" x2="${P.l + iw}" y2="${P.t + ih}"/>
      </svg>
    </div>
  </div>${table}`;
}

/* -------------------------------------------------------------- table view */

/** Every chart ships a table twin, so no value is reachable only by hover. */
export function tableView(headers, rows) {
  if (!rows.length) return '';
  const id = nextId();
  return `<details class="tableview">
    <summary aria-controls="${id}">Show data table</summary>
    <div class="table-wrap" id="${id}">
      <table>
        <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r) =>
          `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`
        ).join('')}</tbody>
      </table>
    </div>
  </details>`;
}
