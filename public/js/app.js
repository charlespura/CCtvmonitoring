/* CCTV Monitor — dashboard client
 * Connects to stream-server.js over WebSocket, renders annotated frames on a
 * canvas, and keeps counters, capacity, activity, the traffic chart, zones and
 * camera info in sync.
 */
import { createTrafficChart } from './chart.js';
import { createZoneEditor } from './zone-editor.js';

// ---------- Endpoints ----------
// Served by the Node server: use the same host. Opened as a file: assume localhost:3000.
const servedOverHttp = /^https?:$/.test(location.protocol) && location.host;
const HOST = servedOverHttp ? location.host : 'localhost:3000';
const SECURE = location.protocol === 'https:';
const API = `${SECURE ? 'https' : 'http'}://${HOST}`;
const WS_URL = `${SECURE ? 'wss' : 'ws'}://${HOST}`;

const STALL_AFTER_MS = 8000;
const MAX_RECONNECT_DELAY = 15000;
const MAX_EVENTS = 100;
const WARN_RATIO = 0.8; // capacity meter turns amber at 80 %

// ---------- Elements ----------
const $ = (sel) => document.querySelector(sel);
const el = {
    statusPill: $('#status-pill'),
    statusText: $('#status-text'),
    clock: $('#clock'),
    subtitle: $('#camera-subtitle'),
    stage: $('#stage'),
    canvas: $('#video-canvas'),
    frameTime: $('#frame-time'),
    legend: $('#legend'),
    overlay: $('#stage-overlay'),
    overlayTitle: $('#overlay-title'),
    overlayMessage: $('#overlay-message'),
    overlayRetry: $('#overlay-retry'),
    flash: $('#flash'),
    current: $('#current-count'),
    currentCard: $('#stat-current'),
    currentFoot: $('#current-foot'),
    capacity: $('#capacity'),
    capacityMeter: $('#capacity-meter'),
    capacityBar: $('#capacity-bar'),
    capacityBanner: $('#capacity-banner'),
    capacityBannerText: $('#capacity-banner-text'),
    enter: $('#enter-count'),
    exit: $('#exit-count'),
    inView: $('#inview-count'),
    fps: $('#fps'),
    eventList: $('#event-list'),
    eventEmpty: $('#event-empty'),
    filters: document.querySelectorAll('[data-filter]'),
    toolbar: $('#toolbar'),
    zoneBar: $('#zone-bar'),
    btnSnapshot: $('#btn-snapshot'),
    btnFullscreen: $('#btn-fullscreen'),
    btnZones: $('#btn-zones'),
    btnLegend: $('#btn-legend'),
    btnReconnect: $('#btn-reconnect'),
    btnReset: $('#btn-reset'),
    resetDialog: $('#reset-dialog'),
    settingsDialog: $('#settings-dialog'),
    settingsForm: $('#settings-form'),
    settingsError: $('#settings-error'),
    setCapacity: $('#set-capacity'),
    setDaily: $('#set-daily'),
    setSound: $('#set-sound'),
    setNotify: $('#set-notify'),
    notifyHint: $('#notify-hint'),
    themeToggle: $('#theme-toggle'),
    settingsOpen: $('#settings-open'),
    logout: $('#logout'),
    toasts: $('#toasts'),
    trafficDate: $('#traffic-date'),
    dayPrev: $('#day-prev'),
    dayNext: $('#day-next'),
    views: document.querySelectorAll('[data-view]'),
    chartWrap: $('#chart-wrap'),
    trafficTable: $('#traffic-table'),
    tEnter: $('#t-enter'),
    tExit: $('#t-exit'),
    tPeak: $('#t-peak'),
    info: {
        name: $('#info-name'),
        ip: $('#info-ip'),
        stream: $('#info-stream'),
        transport: $('#info-transport'),
        detection: $('#info-detection'),
        viewers: $('#info-viewers'),
        uptime: $('#info-uptime')
    }
};
const ctx = el.canvas.getContext('2d');

// ---------- State ----------
const state = {
    ws: null,
    mode: 'connecting',          // connecting | waiting | live | stalled | error | offline
    hasFrame: false,
    lastFrameAt: 0,
    decoding: false,
    framesThisSecond: 0,
    lastError: null,
    reconnectDelay: 1000,
    reconnectAt: 0,
    reconnectTimer: null,
    events: [],
    filter: 'all',
    counts: { current: 0, enter: 0, exit: 0 },
    settings: { capacity: null, dailyReset: false },
    prefs: loadPrefs(),
    wasOver: false,
    chartDate: null,             // null = today
    authEnabled: false
};

// ---------- Helpers ----------
const pad = (n) => String(n).padStart(2, '0');
const timeOf = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function loadPrefs() {
    try {
        return { sound: false, notify: false, ...JSON.parse(localStorage.getItem('cctv-prefs') || '{}') };
    } catch {
        return { sound: false, notify: false };
    }
}

function savePrefs() {
    try { localStorage.setItem('cctv-prefs', JSON.stringify(state.prefs)); } catch { /* ignore */ }
}

/** fetch() wrapper: JSON in/out, and back to the login page if the session expired. */
async function api(path, options = {}) {
    const res = await fetch(`${API}${path}`, {
        cache: 'no-store',
        ...options,
        headers: options.body ? { 'Content-Type': 'application/json', ...options.headers } : options.headers
    });
    if (res.status === 401 && state.authEnabled) {
        location.href = 'login.html';
        throw new Error('Login required');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || res.statusText);
    return data;
}

function relativeTime(iso) {
    const diff = Math.max(0, Date.now() - new Date(iso).getTime());
    const s = Math.round(diff / 1000);
    if (s < 10) return 'just now';
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return new Date(iso).toLocaleDateString();
}

function formatDuration(totalSeconds) {
    const d = Math.floor(totalSeconds / 86400);
    const h = Math.floor((totalSeconds % 86400) / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    return `${m}m ${totalSeconds % 60}s`;
}

function icon(id) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#${id}`);
    svg.appendChild(use);
    return svg;
}

function toast(message, kind = 'info', ms = 3200) {
    const t = document.createElement('div');
    t.className = `toast toast--${kind}`;
    t.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    t.textContent = message;
    el.toasts.appendChild(t);
    setTimeout(() => {
        t.classList.add('leaving');
        t.addEventListener('animationend', () => t.remove(), { once: true });
    }, ms);
}

// Translate raw FFmpeg errors into something actionable
function explainError(raw) {
    const msg = String(raw || '').toLowerCase();
    if (msg.includes('401') || msg.includes('unauthorized')) {
        return {
            title: 'Camera rejected the login',
            message: 'Check rtsp_username / rtsp_password in rtsp-config.json. For Tapo cameras, use the Camera Account set in the Tapo app (Advanced Settings → Camera Account).'
        };
    }
    if (msg.includes('timed out') || msg.includes('connection refused') || msg.includes('no route') || msg.includes('connection')) {
        return {
            title: 'Camera is unreachable',
            message: 'Check the camera IP in the Tapo app (Device Info), make sure Tapo Lab → Third-Party Compatibility is on, and that the camera is on the same network.'
        };
    }
    if (msg.includes('ffmpeg not available') || msg.includes('enoent')) {
        return {
            title: 'FFmpeg is not installed',
            message: 'Install FFmpeg on the server machine (e.g. brew install ffmpeg) and restart npm start.'
        };
    }
    return { title: 'Stream error', message: raw || 'The camera stream stopped unexpectedly.' };
}

// ---------- Sound & notifications ----------
let audioCtx = null;
function beep(notes) {
    if (!state.prefs.sound) return;
    try {
        audioCtx = audioCtx || new AudioContext();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        let t = audioCtx.currentTime;
        for (const [freq, dur] of notes) {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            osc.connect(gain).connect(audioCtx.destination);
            osc.start(t);
            osc.stop(t + dur + 0.02);
            t += dur * 0.9;
        }
    } catch { /* audio unavailable */ }
}
const SOUNDS = {
    ENTER: [[660, 0.12], [880, 0.16]],
    EXIT: [[700, 0.12], [520, 0.16]],
    ALERT: [[880, 0.15], [880, 0.15], [880, 0.25]]
};

function notify(title, body, { always = false } = {}) {
    if (!state.prefs.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
    if (!always && !document.hidden) return;
    try { new Notification(title, { body, tag: always ? 'cctv-capacity' : undefined }); } catch { /* ignore */ }
}

// ---------- Status / overlay ----------
const STATUS = {
    connecting: ['connecting', 'Connecting…'],
    waiting: ['connecting', 'Waiting for video'],
    live: ['live', 'Live'],
    stalled: ['warning', 'Stalled'],
    error: ['warning', 'No signal'],
    offline: ['offline', 'Offline']
};

function setMode(mode) {
    if (state.mode === mode) return;
    state.mode = mode;
    const [pill, text] = STATUS[mode];
    el.statusPill.dataset.state = pill;
    el.statusText.textContent = text;
    el.stage.classList.toggle('is-live', mode === 'live');
    if (mode === 'live') hideOverlay();
}

function showOverlay(kind, title, message, retry = false) {
    el.overlay.dataset.kind = kind;
    el.overlayTitle.textContent = title;
    el.overlayMessage.textContent = message;
    el.overlayRetry.hidden = !retry;
    el.overlay.hidden = false;
}

function hideOverlay() {
    el.overlay.hidden = true;
}

// ---------- Counters & capacity ----------
function setStat(node, value) {
    const text = String(value ?? 0);
    if (node.textContent === text) return;
    node.textContent = text;
    node.classList.remove('bump');
    void node.offsetWidth; // restart animation
    node.classList.add('bump');
}

function updateCounts(c) {
    if (!c) return;
    state.counts = c;
    setStat(el.current, c.current);
    setStat(el.enter, c.enter);
    setStat(el.exit, c.exit);
    renderCapacity();
}

function renderCapacity() {
    const cap = state.settings.capacity;
    const current = state.counts.current;
    const over = Boolean(cap) && current > cap;
    const warn = Boolean(cap) && !over && current >= cap * WARN_RATIO;

    el.capacity.hidden = !cap;
    el.currentCard.classList.toggle('is-over', over);
    el.currentCard.classList.toggle('is-warn', warn);
    el.capacityBanner.hidden = !over;

    if (cap) {
        const pct = Math.min(100, Math.round((current / cap) * 100));
        el.capacityBar.style.width = `${pct}%`;
        el.capacityMeter.setAttribute('aria-valuemax', String(cap));
        el.capacityMeter.setAttribute('aria-valuenow', String(current));
        el.currentFoot.textContent = over
            ? `⚠ Over capacity · ${current} / ${cap}`
            : `${current} of ${cap} max (${pct}%)`;
        el.capacityBannerText.textContent = `Over capacity: ${current} people inside (limit ${cap})`;
    } else {
        el.currentFoot.textContent = 'Entered minus exited';
    }

    document.title = `${over ? '⚠ ' : ''}(${current}) CCTV Monitor`;

    if (over && !state.wasOver) {
        toast(`Over capacity: ${current} people inside (limit ${cap})`, 'error', 6000);
        beep(SOUNDS.ALERT);
        notify('Over capacity', `${current} people inside — limit is ${cap}.`, { always: true });
    }
    state.wasOver = over;
}

// ---------- Video ----------
function drawFrame(b64) {
    if (state.decoding) return; // drop frames rather than queueing them
    state.decoding = true;
    const img = new Image();
    img.onload = () => {
        if (el.canvas.width !== img.naturalWidth || el.canvas.height !== img.naturalHeight) {
            el.canvas.width = img.naturalWidth;
            el.canvas.height = img.naturalHeight;
            el.stage.style.setProperty('--ar', `${img.naturalWidth} / ${img.naturalHeight}`);
        }
        ctx.drawImage(img, 0, 0);
        state.hasFrame = true;
        state.decoding = false;
    };
    img.onerror = () => { state.decoding = false; };
    img.src = `data:image/jpeg;base64,${b64}`;
}

// ---------- Activity ----------
const EVENT_META = {
    ENTER: { cls: 'enter', icon: 'i-in', title: 'Person entered' },
    EXIT: { cls: 'exit', icon: 'i-out', title: 'Person exited' },
    SYSTEM: { cls: 'system', icon: 'i-info', title: 'System' }
};

function eventNode(ev, isNew) {
    const meta = EVENT_META[ev.type] || EVENT_META.SYSTEM;
    const li = document.createElement('li');
    li.className = `event event--${meta.cls}${isNew ? ' is-new' : ''}`;

    const ic = document.createElement('span');
    ic.className = 'event-icon';
    ic.appendChild(icon(meta.icon));

    const body = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'event-title';
    title.textContent = ev.message || meta.title;
    const sub = document.createElement('div');
    sub.className = 'event-sub';
    sub.textContent = timeOf(new Date(ev.time));
    body.append(title, sub);

    const time = document.createElement('time');
    time.className = 'event-time';
    time.dateTime = ev.time;
    time.title = new Date(ev.time).toLocaleString();
    time.textContent = relativeTime(ev.time);

    li.append(ic, body, time);
    return li;
}

function visibleEvents() {
    return state.filter === 'all' ? state.events : state.events.filter((e) => e.type === state.filter);
}

function renderEvents() {
    const list = visibleEvents();
    el.eventList.replaceChildren(...list.map((ev) => eventNode(ev, false)));
    el.eventEmpty.hidden = list.length > 0;
}

function addEvent(ev) {
    state.events.unshift(ev);
    if (state.events.length > MAX_EVENTS) state.events.length = MAX_EVENTS;
    if (state.filter === 'all' || state.filter === ev.type) {
        el.eventList.prepend(eventNode(ev, true));
        while (el.eventList.children.length > MAX_EVENTS) el.eventList.lastChild.remove();
        el.eventEmpty.hidden = true;
    }
}

function systemEvent(message) {
    addEvent({ type: 'SYSTEM', time: new Date().toISOString(), message });
}

function refreshRelativeTimes() {
    el.eventList.querySelectorAll('time').forEach((t) => {
        t.textContent = relativeTime(t.dateTime);
    });
}

// ---------- Traffic chart ----------
const chart = createTrafficChart({
    container: $('#traffic-chart'),
    tooltip: $('#chart-tooltip'),
    table: el.trafficTable
});

function shiftDate(key, days) {
    const [y, m, d] = key.split('-').map(Number);
    return dateKey(new Date(y, m - 1, d + days));
}

function renderTrafficSummary(data) {
    const today = dateKey();
    const yesterday = shiftDate(today, -1);
    const label = data.date === today ? 'Today'
        : data.date === yesterday ? 'Yesterday'
            : new Date(`${data.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    el.trafficDate.textContent = label;
    el.tEnter.textContent = data.totals.enter;
    el.tExit.textContent = data.totals.exit;
    el.tPeak.textContent = data.peak ? `${pad(data.peak.hour)}:00 · ${data.peak.count}` : '—';
    el.dayNext.disabled = data.date >= today;
    el.dayPrev.disabled = !data.days.length || data.date <= data.days[0];
}

async function loadStats(date = state.chartDate) {
    try {
        const data = await api(`/api/stats${date ? `?date=${date}` : ''}`);
        state.chartDate = data.isToday ? null : data.date;
        chart.setData(data);
        renderTrafficSummary(data);
    } catch { /* offline — the status pill explains */ }
}

el.dayPrev.addEventListener('click', () => loadStats(shiftDate(chart.data?.date || dateKey(), -1)));
el.dayNext.addEventListener('click', () => loadStats(shiftDate(chart.data?.date || dateKey(), 1)));
el.views.forEach((btn) => {
    btn.addEventListener('click', () => {
        const table = btn.dataset.view === 'table';
        el.views.forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
        el.chartWrap.hidden = table;
        el.trafficTable.hidden = !table;
    });
});

// ---------- Camera info ----------
async function refreshStatus() {
    try {
        const s = await api('/api/status');
        const cam = s.camera || {};
        const streamLabel = { stream1: 'High · 1080p', stream2: 'Low · 360p' }[cam.stream] || cam.stream || '—';
        el.info.name.textContent = cam.name || '—';
        el.info.ip.textContent = cam.ip ? `${cam.ip}:${cam.port}` : '—';
        el.info.stream.textContent = streamLabel;
        el.info.transport.textContent = (cam.transport || '—').toUpperCase();
        el.info.detection.textContent = s.detection
            ? `${s.detection.frameRate} fps · ${s.detection.scaleWidth}px`
            : '—';
        el.info.viewers.textContent = String(s.clients ?? '—');
        el.info.uptime.textContent = Number.isFinite(s.uptimeSeconds) ? formatDuration(s.uptimeSeconds) : '—';
        el.subtitle.textContent = cam.name ? `${cam.name} · ${cam.ip}` : 'People counting dashboard';
    } catch {
        /* server unreachable — the connection state already explains it */
    }
}

// ---------- WebSocket ----------
function clearReconnect() {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
    state.reconnectAt = 0;
}

function connect() {
    clearReconnect();
    if (state.ws) {
        state.ws.onclose = null;
        state.ws.close();
    }

    setMode('connecting');
    showOverlay('loading', 'Connecting to stream server', `Opening ${WS_URL}…`);

    const ws = new WebSocket(WS_URL);
    state.ws = ws;

    ws.onopen = () => {
        state.reconnectDelay = 1000;
        state.lastError = null;
        state.lastFrameAt = 0;
        setMode('waiting');
        showOverlay('loading', 'Waiting for camera video', 'The server is opening the RTSP stream. This usually takes a few seconds.');
        refreshStatus();
        loadStats();
    };

    ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        handleMessage(msg);
    };

    ws.onclose = () => {
        if (state.ws !== ws) return;
        scheduleReconnect();
    };
}

async function scheduleReconnect() {
    // If a password is set and our session expired, go to the login page instead of retrying
    if (state.authEnabled) {
        try {
            const s = await (await fetch(`${API}/api/session`, { cache: 'no-store' })).json();
            if (s.authEnabled && !s.authenticated) {
                location.href = 'login.html';
                return;
            }
        } catch { /* server down — fall through to retry */ }
    }
    setMode('offline');
    const delay = state.reconnectDelay;
    state.reconnectDelay = Math.min(delay * 2, MAX_RECONNECT_DELAY);
    state.reconnectAt = Date.now() + delay;
    state.reconnectTimer = setTimeout(connect, delay);
    updateOfflineOverlay();
}

function updateOfflineOverlay() {
    if (state.mode !== 'offline' || !state.reconnectAt) return;
    const secs = Math.max(0, Math.ceil((state.reconnectAt - Date.now()) / 1000));
    showOverlay(
        'offline',
        "Can't reach the stream server",
        `Make sure the server is running (npm start) at ${HOST}. Retrying in ${secs}s…`,
        true
    );
}

function handleMessage(msg) {
    switch (msg.type) {
        case 'frame':
            drawFrame(msg.data);
            updateCounts(msg.counts);
            setStat(el.inView, (msg.people || []).length);
            state.lastFrameAt = Date.now();
            state.framesThisSecond++;
            state.lastError = null;
            setMode('live');
            break;
        case 'counts':
            updateCounts(msg.data);
            break;
        case 'history':
            state.events = (msg.data || []).slice().reverse().slice(0, MAX_EVENTS);
            renderEvents();
            break;
        case 'event': {
            addEvent(msg.data);
            updateCounts(msg.counts);
            chart.addEvent(msg.data.type, new Date(msg.data.time));
            if (chart.data?.isToday) renderTrafficSummary(chart.data);
            beep(SOUNDS[msg.data.type] || SOUNDS.ENTER);
            notify(msg.data.type === 'ENTER' ? 'Person entered' : 'Person exited',
                `${msg.counts.current} inside now`);
            break;
        }
        case 'settings':
            state.settings = msg.data;
            renderCapacity();
            break;
        case 'ffmpeg_error': {
            state.lastError = msg.data;
            if (state.mode === 'live' && Date.now() - state.lastFrameAt < 2000) break; // transient
            const { title, message } = explainError(msg.data);
            setMode('error');
            showOverlay('error', title, message, true);
            break;
        }
        default:
            break;
    }
}

// ---------- Actions ----------
function reconnect() {
    state.reconnectDelay = 1000;
    connect();
    toast('Reconnecting to stream…');
}

function snapshot() {
    if (!state.hasFrame) {
        toast('No video yet — nothing to capture', 'error');
        return;
    }
    el.canvas.toBlob((blob) => {
        if (!blob) {
            toast('Could not capture snapshot', 'error');
            return;
        }
        const d = new Date();
        const name = `snapshot-${dateKey(d)}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.png`;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);

        el.flash.classList.remove('go');
        void el.flash.offsetWidth;
        el.flash.classList.add('go');
        toast(`Saved ${name}`, 'success');
        systemEvent('Snapshot saved');
    }, 'image/png');
}

function toggleFullscreen() {
    if (zoneEditor.isOpen) return;
    if (document.fullscreenElement) {
        document.exitFullscreen?.();
    } else {
        el.stage.requestFullscreen?.().catch(() => toast('Fullscreen is not available', 'error'));
    }
}

function updateFullscreenButton() {
    const on = Boolean(document.fullscreenElement);
    el.btnFullscreen.querySelector('use').setAttribute('href', on ? '#i-shrink' : '#i-expand');
    el.btnFullscreen.querySelector('span').textContent = on ? 'Exit fullscreen' : 'Fullscreen';
}

function toggleLegend() {
    const hidden = el.legend.classList.toggle('is-hidden');
    el.btnLegend.setAttribute('aria-pressed', String(!hidden));
}

async function resetCounts() {
    el.btnReset.disabled = true;
    try {
        await api('/api/reset-counts', { method: 'POST' });
        updateCounts({ current: 0, enter: 0, exit: 0 });
        toast('Counters reset', 'success');
        // The server broadcasts an empty history; add the system note after it lands
        setTimeout(() => systemEvent('Counters reset'), 150);
    } catch (err) {
        toast(`Reset failed: ${err.message}`, 'error');
    } finally {
        el.btnReset.disabled = false;
    }
}

function toggleTheme() {
    const root = document.documentElement;
    const current = root.dataset.theme
        || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    const next = current === 'light' ? 'dark' : 'light';
    root.dataset.theme = next;
    try { localStorage.setItem('cctv-theme', next); } catch { /* ignore */ }
}

// ---------- Zone editor ----------
const zoneEditor = createZoneEditor({
    stage: el.stage,
    layer: $('#zone-editor'),
    frameSize: () => ({ width: el.canvas.width, height: el.canvas.height })
});
let zoneDefaults = null;

async function openZoneEditor() {
    if (zoneEditor.isOpen) return;
    try {
        if (document.fullscreenElement) await document.exitFullscreen();
        const z = await api('/api/zones');
        zoneDefaults = z.defaults;
        zoneEditor.open({ enter: z.enter, exit: z.exit });
        el.toolbar.hidden = true;
        el.zoneBar.hidden = false;
    } catch (err) {
        toast(`Could not load zones: ${err.message}`, 'error');
    }
}

function closeZoneEditor() {
    zoneEditor.close();
    el.zoneBar.hidden = true;
    el.toolbar.hidden = false;
    el.btnZones.focus({ preventScroll: true });
}

async function saveZones() {
    try {
        await api('/api/calibrate-zones', { method: 'POST', body: JSON.stringify(zoneEditor.value()) });
        closeZoneEditor();
        toast('Zones saved — counting uses them right away', 'success');
        systemEvent('Counting zones updated');
    } catch (err) {
        toast(`Could not save zones: ${err.message}`, 'error');
    }
}

el.btnZones.addEventListener('click', openZoneEditor);
$('#zone-cancel').addEventListener('click', closeZoneEditor);
$('#zone-save').addEventListener('click', saveZones);
$('#zone-swap').addEventListener('click', () => zoneEditor.swap());
$('#zone-defaults').addEventListener('click', () => zoneDefaults && zoneEditor.set(zoneDefaults));

// ---------- Settings ----------
function openSettings() {
    el.setCapacity.value = state.settings.capacity ?? '';
    el.setCapacity.removeAttribute('aria-invalid');
    el.setDaily.checked = Boolean(state.settings.dailyReset);
    el.setSound.checked = state.prefs.sound;
    el.setNotify.checked = state.prefs.notify && 'Notification' in window && Notification.permission === 'granted';
    el.setNotify.disabled = !('Notification' in window);
    el.settingsError.hidden = true;
    el.settingsDialog.showModal();
}

el.setNotify.addEventListener('change', async () => {
    if (!el.setNotify.checked || !('Notification' in window)) return;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        el.setNotify.checked = false;
        el.notifyHint.textContent = 'Notifications are blocked for this site. Allow them in your browser’s site settings.';
    }
});

el.settingsForm.addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'save') return; // Cancel closes the dialog normally
    e.preventDefault();

    const raw = el.setCapacity.value.trim();
    const capacity = raw === '' ? null : Number(raw);
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000)) {
        el.setCapacity.setAttribute('aria-invalid', 'true');
        el.settingsError.textContent = 'Capacity must be a whole number from 1 to 100000, or empty to turn it off.';
        el.settingsError.hidden = false;
        el.setCapacity.focus();
        return;
    }

    try {
        const res = await api('/api/settings', {
            method: 'POST',
            body: JSON.stringify({ capacity, dailyReset: el.setDaily.checked })
        });
        state.settings = res.settings;
        state.prefs = { sound: el.setSound.checked, notify: el.setNotify.checked };
        savePrefs();
        if (state.prefs.sound) beep(SOUNDS.ENTER); // confirms sound works (also unlocks audio)
        renderCapacity();
        el.settingsDialog.close();
        toast('Settings saved', 'success');
    } catch (err) {
        el.settingsError.textContent = err.message;
        el.settingsError.hidden = false;
    }
});

// ---------- Session ----------
async function initSession() {
    try {
        const s = await (await fetch(`${API}/api/session`, { cache: 'no-store' })).json();
        state.authEnabled = s.authEnabled;
        if (s.authEnabled && !s.authenticated) {
            location.href = 'login.html';
            return false;
        }
        el.logout.hidden = !s.authEnabled;
    } catch { /* server down — connect() shows the offline state */ }
    return true;
}

el.logout.addEventListener('click', async () => {
    try { await api('/api/logout', { method: 'POST' }); } catch { /* ignore */ }
    location.href = 'login.html';
});

// ---------- Wiring ----------
el.btnSnapshot.addEventListener('click', snapshot);
el.btnFullscreen.addEventListener('click', toggleFullscreen);
el.btnLegend.addEventListener('click', toggleLegend);
el.btnReconnect.addEventListener('click', reconnect);
el.overlayRetry.addEventListener('click', reconnect);
el.themeToggle.addEventListener('click', toggleTheme);
el.settingsOpen.addEventListener('click', openSettings);
document.addEventListener('fullscreenchange', updateFullscreenButton);

el.btnReset.addEventListener('click', () => {
    el.resetDialog.returnValue = '';
    el.resetDialog.showModal();
});
el.resetDialog.addEventListener('close', () => {
    if (el.resetDialog.returnValue === 'confirm') resetCounts();
});

el.filters.forEach((btn) => {
    btn.addEventListener('click', () => {
        state.filter = btn.dataset.filter;
        el.filters.forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
        renderEvents();
    });
});

document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    if (e.target.closest('input, textarea, select, [contenteditable], dialog[open]')) return;
    if (zoneEditor.isOpen) {
        if (e.key === 'Escape') closeZoneEditor();
        return;
    }
    const actions = {
        s: snapshot, f: toggleFullscreen, l: toggleLegend, r: reconnect,
        t: toggleTheme, z: openZoneEditor, ',': openSettings
    };
    const action = actions[e.key.toLowerCase()];
    if (action) {
        e.preventDefault();
        action();
    }
});

// Reconnect immediately when the tab becomes visible again
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.mode === 'offline') connect();
});

// 1-second heartbeat: clock, fps, stall detection, reconnect countdown
let lastDay = dateKey();
setInterval(() => {
    const now = new Date();
    el.clock.textContent = timeOf(now);
    if (state.mode === 'live') el.frameTime.textContent = timeOf(now);

    el.fps.textContent = String(state.framesThisSecond);
    state.framesThisSecond = 0;

    if (state.mode === 'live' && Date.now() - state.lastFrameAt > STALL_AFTER_MS) {
        setMode('stalled');
        showOverlay('error', 'Video stalled', 'No frames received for a few seconds. The server will restart the stream automatically.', true);
    }
    updateOfflineOverlay();

    // New day: roll the chart over to the new "today"
    if (dateKey(now) !== lastDay) {
        lastDay = dateKey(now);
        if (state.chartDate === null) loadStats(null);
    }
}, 1000);

setInterval(refreshRelativeTimes, 15000);
setInterval(() => { if (state.mode !== 'offline') refreshStatus(); }, 15000);

// ---------- Start ----------
el.clock.textContent = timeOf(new Date());
renderEvents();
if (await initSession()) connect();
