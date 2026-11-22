/* Traffic-by-hour chart.
 *
 * Mirrored bars: Entered rises above the centre line, Exited falls below it.
 * Position carries the series identity (colour is a second cue), so the chart
 * stays readable for colour-blind viewers and in print.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const pad = (n) => String(n).padStart(2, '0');
const hourLabel = (h) => `${pad(h)}:00`;

/** Round up to a "nice" even axis maximum so the half-way gridline is a whole number. */
function niceMax(value) {
    const v = Math.max(2, value);
    const p = 10 ** Math.floor(Math.log10(v));
    for (const s of [2, 4, 6, 8, 10]) {
        if (s * p >= v) return s * p;
    }
    return 20 * p;
}

/** Bar with a rounded data-end and a square end on the baseline. */
function barPath(x, w, base, end, radius) {
    const up = end < base;
    const h = Math.abs(base - end);
    const r = Math.min(radius, h, w / 2);
    if (up) {
        return `M${x},${base}V${end + r}Q${x},${end} ${x + r},${end}H${x + w - r}Q${x + w},${end} ${x + w},${end + r}V${base}Z`;
    }
    return `M${x},${base}V${end - r}Q${x},${end} ${x + r},${end}H${x + w - r}Q${x + w},${end} ${x + w},${end - r}V${base}Z`;
}

function el(name, attrs = {}, text) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text !== undefined) node.textContent = text;
    return node;
}

export function createTrafficChart({ container, tooltip, table }) {
    let data = null;
    let hover = -1;
    let geometry = null;

    const ro = new ResizeObserver(() => render());
    ro.observe(container);

    function render() {
        if (!data) return;
        const W = Math.max(280, container.clientWidth);
        const H = container.clientHeight || 220;
        const m = { top: 10, right: 6, bottom: 24, left: 40 };
        const iw = W - m.left - m.right;
        const ih = H - m.top - m.bottom;
        const mid = m.top + ih / 2;

        const peakValue = Math.max(...data.hours.map((h) => Math.max(h.enter, h.exit)));
        const top = niceMax(peakValue);
        const scale = (ih / 2) / top;
        const slot = iw / 24;
        const bw = Math.max(3, Math.min(16, slot * 0.6));
        const nowHour = data.isToday ? new Date().getHours() : -1;
        geometry = { m, slot, W };

        const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });

        // Current hour + hovered hour column highlights
        if (nowHour >= 0) {
            svg.appendChild(el('rect', { class: 'col-now', x: m.left + nowHour * slot, y: m.top, width: slot, height: ih, rx: 4 }));
        }
        if (hover >= 0) {
            svg.appendChild(el('rect', { class: 'col-hover', x: m.left + hover * slot, y: m.top, width: slot, height: ih, rx: 4 }));
        }

        // Recessive gridlines + y ticks (absolute values on both sides)
        for (const v of [top, top / 2]) {
            for (const sign of [-1, 1]) {
                const y = mid + sign * v * scale;
                svg.appendChild(el('line', { class: 'grid', x1: m.left, x2: W - m.right, y1: y, y2: y }));
                svg.appendChild(el('text', { class: 'tick', x: m.left - 8, y: y + 4, 'text-anchor': 'end' }, String(v)));
            }
        }
        svg.appendChild(el('text', { class: 'tick', x: m.left - 8, y: mid + 4, 'text-anchor': 'end' }, '0'));

        // Bars
        const r = 4;
        data.hours.forEach((h) => {
            const x = m.left + h.hour * slot + (slot - bw) / 2;
            if (h.enter > 0) svg.appendChild(el('path', { class: 'bar-enter', d: barPath(x, bw, mid - 1, mid - 1 - h.enter * scale, r) }));
            if (h.exit > 0) svg.appendChild(el('path', { class: 'bar-exit', d: barPath(x, bw, mid + 1, mid + 1 + h.exit * scale, r) }));
        });

        // Baseline drawn on top of the bar ends
        svg.appendChild(el('line', { class: 'baseline', x1: m.left, x2: W - m.right, y1: mid, y2: mid }));

        // Side labels name each half directly (identity is never colour-alone)
        svg.appendChild(el('text', { class: 'side-label', x: W - m.right, y: m.top + 10, 'text-anchor': 'end' }, 'Entered ↑'));
        svg.appendChild(el('text', { class: 'side-label', x: W - m.right, y: m.top + ih - 2, 'text-anchor': 'end' }, 'Exited ↓'));

        // X ticks
        const every = slot < 18 ? 6 : 3;
        for (let hr = 0; hr < 24; hr += every) {
            svg.appendChild(el('text', {
                class: `tick${hr === nowHour ? ' is-now' : ''}`,
                x: m.left + hr * slot + slot / 2,
                y: H - 6,
                'text-anchor': 'middle'
            }, pad(hr)));
        }

        // Full-height hit area for hover / tap
        svg.appendChild(el('rect', { class: 'hit', x: m.left, y: m.top, width: iw, height: ih }));

        container.replaceChildren(svg);
        container.setAttribute('aria-label', describe());
    }

    function describe() {
        const t = data.totals;
        const peak = data.peak ? ` Busiest hour ${hourLabel(data.peak.hour)} with ${data.peak.count} people.` : '';
        return `Traffic by hour for ${data.date}: ${t.enter} entered, ${t.exit} exited.${peak} Switch to Table for exact numbers.`;
    }

    function renderTable() {
        if (!data || !table) return;
        const peakHour = data.peak ? data.peak.hour : -1;
        const rows = data.hours.map((h) => {
            const cls = h.hour === peakHour ? 'is-peak' : h.enter + h.exit === 0 ? 'is-empty' : '';
            return `<tr class="${cls}"><td>${hourLabel(h.hour)}–${hourLabel((h.hour + 1) % 24)}</td><td>${h.enter}</td><td>${h.exit}</td><td>${h.enter + h.exit}</td></tr>`;
        }).join('');
        table.innerHTML = `<table><thead><tr><th scope="col">Hour</th><th scope="col">Entered</th><th scope="col">Exited</th><th scope="col">Total</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th scope="row">Total</th><td>${data.totals.enter}</td><td>${data.totals.exit}</td><td>${data.totals.enter + data.totals.exit}</td></tr></tfoot></table>`;
    }

    function showTooltip(hourIndex, clientX) {
        const h = data.hours[hourIndex];
        tooltip.innerHTML = '';
        const title = document.createElement('div');
        title.className = 'tt-title';
        title.textContent = `${hourLabel(h.hour)} – ${hourLabel((h.hour + 1) % 24)}`;
        tooltip.appendChild(title);
        for (const [label, value, key] of [['Entered', h.enter, 'enter'], ['Exited', h.exit, 'exit']]) {
            const row = document.createElement('div');
            row.className = 'tt-row';
            row.innerHTML = `<span class="key key--${key}"></span><span>${label}</span><strong>${value}</strong>`;
            tooltip.appendChild(row);
        }
        tooltip.hidden = false;

        const rect = container.getBoundingClientRect();
        const tw = tooltip.offsetWidth;
        let left = clientX - rect.left + 14;
        if (left + tw > rect.width) left = clientX - rect.left - tw - 14;
        tooltip.style.transform = `translate(${Math.max(0, left)}px, 8px)`;
    }

    function hourFromEvent(e) {
        if (!geometry) return -1;
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left - geometry.m.left;
        const idx = Math.floor(x / geometry.slot);
        return idx >= 0 && idx < 24 ? idx : -1;
    }

    container.addEventListener('pointermove', (e) => {
        if (!data) return;
        const idx = hourFromEvent(e);
        if (idx !== hover) {
            hover = idx;
            render();
        }
        if (idx >= 0) showTooltip(idx, e.clientX);
        else tooltip.hidden = true;
    });
    container.addEventListener('pointerleave', () => {
        hover = -1;
        tooltip.hidden = true;
        render();
    });

    return {
        setData(next) {
            data = next;
            render();
            renderTable();
        },
        /** Live-increment the current hour when an event arrives. */
        addEvent(type, date = new Date()) {
            if (!data || !data.isToday) return;
            const h = data.hours[date.getHours()];
            if (type === 'ENTER') { h.enter++; data.totals.enter++; }
            if (type === 'EXIT') { h.exit++; data.totals.exit++; }
            const busiest = data.hours.reduce((b, x) => (x.enter + x.exit > b.enter + b.exit ? x : b), data.hours[0]);
            data.peak = { hour: busiest.hour, count: busiest.enter + busiest.exit };
            render();
            renderTable();
        },
        get data() { return data; }
    };
}
