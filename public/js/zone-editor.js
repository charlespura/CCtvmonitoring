/* Visual editor for the ENTER / EXIT counting zones.
 *
 * Zones are stored in frame pixels (the detector's scaled frame, e.g. 640×360)
 * and drawn as percentages of the stage so they line up with the video at any size.
 */

const MIN_SIZE = 24; // smallest zone, in frame pixels

export function createZoneEditor({ stage, layer, frameSize }) {
    const boxes = {
        enter: layer.querySelector('[data-zone="enter"]'),
        exit: layer.querySelector('[data-zone="exit"]')
    };
    let zones = null;
    let drag = null;
    let active = 'enter';

    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

    function render() {
        const { width: fw, height: fh } = frameSize();
        for (const key of ['enter', 'exit']) {
            const z = zones[key];
            const s = boxes[key].style;
            s.left = `${(z.x1 / fw) * 100}%`;
            s.top = `${(z.y1 / fh) * 100}%`;
            s.width = `${((z.x2 - z.x1) / fw) * 100}%`;
            s.height = `${((z.y2 - z.y1) / fh) * 100}%`;
            boxes[key].classList.toggle('is-active', key === active);
        }
    }

    /** Keep a zone inside the frame and at least MIN_SIZE big. */
    function fit(z) {
        const { width: fw, height: fh } = frameSize();
        const w = clamp(z.x2 - z.x1, MIN_SIZE, fw);
        const h = clamp(z.y2 - z.y1, MIN_SIZE, fh);
        const x1 = clamp(z.x1, 0, fw - w);
        const y1 = clamp(z.y1, 0, fh - h);
        return { x1, y1, x2: x1 + w, y2: y1 + h };
    }

    function onPointerDown(e) {
        const box = e.target.closest('.zone-box');
        if (!box || e.button > 0) return;
        e.preventDefault();
        active = box.dataset.zone;
        box.focus({ preventScroll: true });
        box.setPointerCapture(e.pointerId);
        drag = {
            key: active,
            handle: e.target.dataset.h || 'move',
            startX: e.clientX,
            startY: e.clientY,
            start: { ...zones[active] }
        };
        render();
    }

    function onPointerMove(e) {
        if (!drag) return;
        const rect = stage.getBoundingClientRect();
        const { width: fw, height: fh } = frameSize();
        const dx = ((e.clientX - drag.startX) / rect.width) * fw;
        const dy = ((e.clientY - drag.startY) / rect.height) * fh;
        const s = drag.start;
        let z;

        if (drag.handle === 'move') {
            const w = s.x2 - s.x1;
            const h = s.y2 - s.y1;
            const x1 = clamp(s.x1 + dx, 0, fw - w);
            const y1 = clamp(s.y1 + dy, 0, fh - h);
            z = { x1, y1, x2: x1 + w, y2: y1 + h };
        } else {
            z = { ...s };
            if (drag.handle.includes('w')) z.x1 = clamp(s.x1 + dx, 0, s.x2 - MIN_SIZE);
            if (drag.handle.includes('e')) z.x2 = clamp(s.x2 + dx, s.x1 + MIN_SIZE, fw);
            if (drag.handle.includes('n')) z.y1 = clamp(s.y1 + dy, 0, s.y2 - MIN_SIZE);
            if (drag.handle.includes('s')) z.y2 = clamp(s.y2 + dy, s.y1 + MIN_SIZE, fh);
        }
        zones[drag.key] = z;
        render();
    }

    function onPointerUp() {
        drag = null;
    }

    // Arrow keys move the focused zone; Shift+arrows resize it
    function onKeyDown(e) {
        const box = e.target.closest('.zone-box');
        if (!box) return;
        const step = e.altKey ? 1 : 8;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (!d) return;
        e.preventDefault();
        e.stopPropagation();
        active = box.dataset.zone;
        const z = { ...zones[active] };
        if (e.shiftKey) {
            z.x2 += d[0];
            z.y2 += d[1];
        } else {
            z.x1 += d[0]; z.x2 += d[0];
            z.y1 += d[1]; z.y2 += d[1];
        }
        zones[active] = fit(z);
        render();
    }

    layer.addEventListener('pointerdown', onPointerDown);
    layer.addEventListener('pointermove', onPointerMove);
    layer.addEventListener('pointerup', onPointerUp);
    layer.addEventListener('pointercancel', onPointerUp);
    layer.addEventListener('keydown', onKeyDown);
    const ro = new ResizeObserver(() => { if (zones) render(); });
    ro.observe(stage);

    return {
        get isOpen() { return !layer.hidden; },
        open(initial) {
            zones = { enter: fit(initial.enter), exit: fit(initial.exit) };
            active = 'enter';
            layer.hidden = false;
            stage.classList.add('is-editing');
            render();
            boxes.enter.focus({ preventScroll: true });
        },
        close() {
            layer.hidden = true;
            stage.classList.remove('is-editing');
            drag = null;
        },
        swap() {
            zones = { enter: zones.exit, exit: zones.enter };
            render();
        },
        set(next) {
            zones = { enter: fit(next.enter), exit: fit(next.exit) };
            render();
        },
        /** Current zones rounded to whole pixels, ready to save. */
        value() {
            const round = (z) => ({ x1: Math.round(z.x1), y1: Math.round(z.y1), x2: Math.round(z.x2), y2: Math.round(z.y2) });
            return { enter: round(zones.enter), exit: round(zones.exit) };
        }
    };
}
