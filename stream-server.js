const express = require('express');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const http = require('http');
const cors = require('cors');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = parseInt(process.env.PORT || '3000', 10);
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
const STARTED_AT = Date.now();

// ========== CAMERA CONFIGURATION ==========
// Priority: environment variables > rtsp-config.json > defaults below.
// rtsp-config.json is git-ignored — copy rtsp-config.example.json to create it.
const RTSP_CONFIG_PATH = path.join(__dirname, 'rtsp-config.json');
const DEFAULT_RTSP_CONFIG = {
    camera_name: 'Tapo TC70',
    camera_ip: '192.168.1.100',
    rtsp_port: 554,
    rtsp_username: '',
    rtsp_password: '',
    stream_quality: 'stream1',
    rtsp_transport: 'tcp',
    rtsp_timeout_ms: 5000
};

function loadRtspConfig() {
    let config = { ...DEFAULT_RTSP_CONFIG };
    if (fs.existsSync(RTSP_CONFIG_PATH)) {
        try {
            const fileConfig = JSON.parse(fs.readFileSync(RTSP_CONFIG_PATH, 'utf8'));
            if (fileConfig && typeof fileConfig === 'object') {
                config = { ...config, ...fileConfig };
            }
        } catch (err) {
            console.warn('⚠️  Failed to read rtsp-config.json, using defaults:', err.message);
        }
    } else if (!process.env.RTSP_URL && !process.env.RTSP_USERNAME) {
        console.warn('⚠️  rtsp-config.json not found. Copy rtsp-config.example.json to rtsp-config.json and add your camera credentials.');
    }

    config.camera_name = process.env.CAMERA_NAME || config.camera_name;
    config.camera_ip = process.env.RTSP_HOST || config.camera_ip;
    config.rtsp_port = process.env.RTSP_PORT || config.rtsp_port;
    config.rtsp_username = process.env.RTSP_USERNAME || config.rtsp_username;
    config.rtsp_password = process.env.RTSP_PASSWORD || config.rtsp_password;
    config.stream_quality = process.env.RTSP_PATH || config.stream_quality;
    config.rtsp_transport = process.env.RTSP_TRANSPORT || config.rtsp_transport;
    config.rtsp_timeout_ms = parseInt(process.env.RTSP_TIMEOUT_MS || config.rtsp_timeout_ms, 10);

    return config;
}

function buildRtspUrl(config) {
    if (process.env.RTSP_URL) {
        return process.env.RTSP_URL;
    }
    const username = encodeURIComponent(config.rtsp_username || '');
    const password = encodeURIComponent(config.rtsp_password || '');
    const auth = username || password ? `${username}:${password}@` : '';
    return `rtsp://${auth}${config.camera_ip}:${config.rtsp_port}/${config.stream_quality}`;
}

function maskRtspUrl(text) {
    return String(text).replace(/(rtsps?:\/\/)[^/@\s]+@/gi, '$1****:****@');
}

const rtspConfig = loadRtspConfig();
const RTSP_URL = buildRtspUrl(rtspConfig);

// ========== DETECTION CONFIGURATION ==========
const CONFIG = {
    FRAME_RATE: 2,              // Frames per second sent through detection
    PERSON_TIMEOUT: 3000,       // Forget a tracked person after this many ms unseen
    MOVEMENT_THRESHOLD: 100,    // Max pixels a person can move between frames to be matched
    DETECTION_CONFIDENCE: 0.3,  // Minimum HOG confidence
    STREAM_SCALE_WIDTH: parseInt(process.env.STREAM_SCALE_WIDTH || '640', 10),
    ZONE_BUFFER: 20,            // Buffer around zones to prevent boundary flicker
    HISTORY_LIMIT: 500          // Events kept in memory
};

// Detection zones in scaled-frame pixel coordinates (width = STREAM_SCALE_WIDTH).
// Calibrate these for your camera view, or POST new ones to /api/calibrate-zones.
const ZONES = {
    ENTER: { x1: 0, y1: 150, x2: 320, y2: 350 },
    EXIT: { x1: 320, y1: 150, x2: 640, y2: 350 }
};

const pythonScriptPath = path.join(__dirname, 'people_detector.py');

// ========== HTTP ==========
app.use(cors());
app.use(express.json());
// Only the public/ folder is served — never the project root (it holds credentials).
app.use(express.static(path.join(__dirname, 'public')));

// ========== STATE ==========
let ffmpegProcess = null;
let pythonProcess = null;
let ffmpegStopTimer = null;
let lastFfmpegError = null;
let restartDelay = 3000;
const clients = new Set();

let enterCount = 0;
let exitCount = 0;
let peopleHistory = [];
let trackedPeople = new Map();
let nextPersonId = 0;
let lastFrameAt = null;

const FFMPEG_ERROR_HINTS = [
    'error', '401', 'unauthorized', 'connection', 'invalid data',
    'failed', 'not permitted', 'denied', 'timed out'
];

function currentOccupancy() {
    return Math.max(0, enterCount - exitCount);
}

function countsPayload() {
    return {
        current: currentOccupancy(),
        enter: enterCount,
        exit: exitCount,
        tracked: trackedPeople.size,
        timestamp: Date.now()
    };
}

function broadcast(payload) {
    const message = JSON.stringify(payload);
    clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// ========== PEOPLE COUNTING ==========
function recordEvent(type, det) {
    if (type === 'ENTER') enterCount++;
    if (type === 'EXIT') exitCount++;

    const event = {
        type,
        time: new Date().toISOString(),
        position: { x: det.x, y: det.y }
    };
    peopleHistory.push(event);
    if (peopleHistory.length > CONFIG.HISTORY_LIMIT) {
        peopleHistory = peopleHistory.slice(-CONFIG.HISTORY_LIMIT);
    }

    console.log(`${type === 'ENTER' ? '✅ ENTER' : '👋 EXIT '} | entered ${enterCount} · exited ${exitCount} · inside ${currentOccupancy()}`);
    broadcast({ type: 'event', data: event, counts: countsPayload() });
}

function updatePeopleCount(detections) {
    const now = Date.now();
    const unmatched = new Map(trackedPeople);
    const updated = new Map();

    detections.forEach((det) => {
        // Match to the nearest tracked person within the movement threshold
        let bestId = null;
        let bestDistance = Infinity;
        for (const [id, person] of unmatched) {
            const distance = Math.hypot(det.x - person.lastPosition.x, det.y - person.lastPosition.y);
            if (distance < CONFIG.MOVEMENT_THRESHOLD && distance < bestDistance) {
                bestId = id;
                bestDistance = distance;
            }
        }

        const state = {
            lastPosition: { x: det.x, y: det.y },
            lastSeen: now,
            inEnterZone: det.in_enter_zone,
            inExitZone: det.in_exit_zone
        };

        if (bestId !== null) {
            const person = unmatched.get(bestId);
            unmatched.delete(bestId);
            // A zone transition on a known person is what counts as an event
            if (!person.inEnterZone && det.in_enter_zone) recordEvent('ENTER', det);
            if (!person.inExitZone && det.in_exit_zone) recordEvent('EXIT', det);
            updated.set(bestId, state);
        } else if (det.in_enter_zone || det.in_exit_zone) {
            updated.set(nextPersonId++, state);
        }
    });

    // Keep people we didn't see this frame until they time out
    for (const [id, person] of unmatched) {
        if (now - person.lastSeen <= CONFIG.PERSON_TIMEOUT) {
            updated.set(id, person);
        }
    }

    trackedPeople = updated;
}

// ========== STREAM PIPELINE (FFmpeg -> Python -> WebSocket) ==========
function startPython() {
    const detectorConfig = JSON.stringify({
        DETECTION_CONFIDENCE: CONFIG.DETECTION_CONFIDENCE,
        STREAM_SCALE_WIDTH: CONFIG.STREAM_SCALE_WIDTH,
        ZONE_BUFFER: CONFIG.ZONE_BUFFER
    });
    const proc = spawn(PYTHON_BIN, [pythonScriptPath, detectorConfig]);
    proc.alive = true;
    proc.backpressure = false;

    proc.on('close', () => { proc.alive = false; });
    proc.on('error', (err) => {
        proc.alive = false;
        console.error(`❌ Could not start ${PYTHON_BIN}:`, err.message);
    });
    proc.stdin.on('error', (err) => {
        if (err.code !== 'EPIPE') console.error('Python stdin error:', err);
    });

    let outputBuffer = '';
    proc.stdout.on('data', (data) => {
        outputBuffer += data.toString();
        let newlineIndex;
        while ((newlineIndex = outputBuffer.indexOf('\n')) !== -1) {
            const line = outputBuffer.slice(0, newlineIndex).trim();
            outputBuffer = outputBuffer.slice(newlineIndex + 1);
            if (!line) continue;

            try {
                const result = JSON.parse(line);
                if (result.error) {
                    console.error('Detector error:', result.error);
                    continue;
                }
                if (result.people) updatePeopleCount(result.people);
                if (result.frame && clients.size > 0) {
                    lastFrameAt = Date.now();
                    restartDelay = 3000;
                    broadcast({
                        type: 'frame',
                        data: result.frame,
                        counts: countsPayload(),
                        people: result.people || []
                    });
                }
            } catch (e) {
                console.error('Python JSON parse error:', e.message);
            }
        }
    });

    proc.stderr.on('data', (data) => {
        const output = data.toString().trim();
        if (output) console.error('Python stderr:', output);
    });

    return proc;
}

function sendFrameToDetector(jpg) {
    const proc = pythonProcess;
    if (!proc || !proc.alive || proc.backpressure || !proc.stdin.writable || clients.size === 0) {
        return;
    }
    const wrote = proc.stdin.write(JSON.stringify({ frame: jpg.toString('base64'), zones: ZONES }) + '\n');
    if (!wrote) {
        proc.backpressure = true;
        proc.stdin.once('drain', () => { proc.backpressure = false; });
    }
}

function startFFmpegStream() {
    if (ffmpegProcess) {
        ffmpegProcess.kill('SIGTERM');
    }
    if (pythonProcess) {
        pythonProcess.kill();
    }

    console.log('🎥 Starting FFmpeg stream with people detection...');
    lastFfmpegError = null;
    pythonProcess = startPython();

    const scaleArgs = Number.isFinite(CONFIG.STREAM_SCALE_WIDTH) && CONFIG.STREAM_SCALE_WIDTH > 0
        ? ['-vf', `scale=${CONFIG.STREAM_SCALE_WIDTH}:-2`]
        : [];

    const ffmpeg = spawn('ffmpeg', [
        '-loglevel', 'error',
        '-rtsp_transport', rtspConfig.rtsp_transport || 'tcp',
        '-fflags', '+nobuffer+discardcorrupt',
        '-flags', 'low_delay',
        '-err_detect', 'ignore_err',
        '-i', RTSP_URL,
        ...scaleArgs,
        '-f', 'image2pipe',
        '-pix_fmt', 'yuvj420p',
        '-vcodec', 'mjpeg',
        '-r', String(CONFIG.FRAME_RATE),
        '-q:v', '5',
        '-'
    ]);

    // Split the MJPEG byte stream into individual JPEG frames
    const SOI = Buffer.from([0xff, 0xd8]);
    const EOI = Buffer.from([0xff, 0xd9]);
    let frameBuffer = Buffer.alloc(0);

    ffmpeg.stdout.on('data', (chunk) => {
        frameBuffer = Buffer.concat([frameBuffer, chunk]);
        let start = frameBuffer.indexOf(SOI);
        let end = start === -1 ? -1 : frameBuffer.indexOf(EOI, start + 2);

        while (start !== -1 && end !== -1) {
            sendFrameToDetector(frameBuffer.subarray(start, end + 2));
            frameBuffer = frameBuffer.subarray(end + 2);
            start = frameBuffer.indexOf(SOI);
            end = start === -1 ? -1 : frameBuffer.indexOf(EOI, start + 2);
        }
    });

    ffmpeg.stderr.on('data', (data) => {
        // FFmpeg echoes the input URL in errors — mask credentials before logging/broadcasting
        maskRtspUrl(data.toString()).split('\n').forEach((line) => {
            const output = line.trim();
            const lower = output.toLowerCase();
            if (!output || lower.includes('deprecated pixel format')) return;
            if (!FFMPEG_ERROR_HINTS.some((hint) => lower.includes(hint))) return;

            console.log(`FFmpeg: ${output}`);
            lastFfmpegError = output;
            broadcast({ type: 'ffmpeg_error', data: lastFfmpegError });
        });
    });

    ffmpeg.on('close', (code) => {
        console.log(`FFmpeg process closed with code ${code}`);
        if (code && code !== 0) {
            lastFfmpegError = lastFfmpegError || `FFmpeg exited with code ${code}`;
        }
        if (ffmpegProcess === ffmpeg) {
            ffmpegProcess = null;
            if (pythonProcess) {
                pythonProcess.kill();
                pythonProcess = null;
            }
            if (clients.size > 0) {
                // Back off while the camera stays unreachable (3s → 6s → … → 30s)
                const delay = restartDelay;
                restartDelay = Math.min(restartDelay * 2, 30000);
                console.log(`Restarting FFmpeg in ${delay / 1000} seconds...`);
                setTimeout(() => {
                    if (clients.size > 0 && !ffmpegProcess) startFFmpegStream();
                }, delay);
            }
        }
    });

    ffmpeg.on('error', (err) => {
        console.error('❌ Could not start ffmpeg:', err.message);
        lastFfmpegError = `ffmpeg not available: ${err.message}`;
        broadcast({ type: 'ffmpeg_error', data: lastFfmpegError });
        if (ffmpegProcess === ffmpeg) ffmpegProcess = null;
    });

    ffmpegProcess = ffmpeg;
}

function stopStream() {
    if (ffmpegProcess) {
        const proc = ffmpegProcess;
        ffmpegProcess = null;
        proc.kill('SIGTERM');
    }
    if (pythonProcess) {
        pythonProcess.kill();
        pythonProcess = null;
    }
}

// ========== WEBSOCKET ==========
const wsPingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 20000);

wss.on('close', () => clearInterval(wsPingInterval));

wss.on('connection', (ws) => {
    console.log('📱 Client connected');
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    clients.add(ws);

    if (ffmpegStopTimer) {
        clearTimeout(ffmpegStopTimer);
        ffmpegStopTimer = null;
    }

    ws.send(JSON.stringify({ type: 'counts', data: countsPayload() }));
    ws.send(JSON.stringify({ type: 'history', data: peopleHistory.slice(-100) }));
    if (lastFfmpegError) {
        ws.send(JSON.stringify({ type: 'ffmpeg_error', data: lastFfmpegError }));
    }

    if (!ffmpegProcess) {
        startFFmpegStream();
    }

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
            } else if (data.type === 'get_history') {
                ws.send(JSON.stringify({ type: 'history', data: peopleHistory.slice(-100) }));
            }
        } catch (e) {
            console.error('Error parsing message:', e.message);
        }
    });

    ws.on('close', (code) => {
        console.log(`📱 Client disconnected [code ${code}]`);
        clients.delete(ws);

        // Stop the camera pipeline shortly after the last viewer leaves
        if (clients.size === 0 && ffmpegProcess && !ffmpegStopTimer) {
            ffmpegStopTimer = setTimeout(() => {
                if (clients.size === 0) {
                    console.log('No clients connected, stopping FFmpeg');
                    stopStream();
                }
                ffmpegStopTimer = null;
            }, 5000);
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error.message);
        clients.delete(ws);
    });
});

// ========== API ==========
app.get('/api/status', (req, res) => {
    res.json({
        online: Boolean(ffmpegProcess) && !lastFfmpegError,
        streaming: Boolean(ffmpegProcess),
        lastFrameAt,
        lastError: lastFfmpegError,
        clients: clients.size,
        uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
        people: countsPayload(),
        camera: {
            name: rtspConfig.camera_name,
            ip: rtspConfig.camera_ip,
            port: rtspConfig.rtsp_port,
            stream: rtspConfig.stream_quality,
            transport: rtspConfig.rtsp_transport,
            url: maskRtspUrl(RTSP_URL)
        },
        detection: {
            frameRate: CONFIG.FRAME_RATE,
            scaleWidth: CONFIG.STREAM_SCALE_WIDTH,
            confidence: CONFIG.DETECTION_CONFIDENCE
        }
    });
});

app.get('/api/counts', (req, res) => {
    res.json(countsPayload());
});

app.post('/api/reset-counts', (req, res) => {
    enterCount = 0;
    exitCount = 0;
    peopleHistory = [];
    trackedPeople.clear();
    broadcast({ type: 'counts', data: countsPayload() });
    broadcast({ type: 'history', data: [] });
    res.json({ success: true, message: 'Counts reset successfully' });
});

app.get('/api/history', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, CONFIG.HISTORY_LIMIT);
    res.json(peopleHistory.slice(-limit));
});

function isValidZone(zone) {
    return zone && ['x1', 'y1', 'x2', 'y2'].every((k) => Number.isFinite(zone[k]))
        && zone.x2 > zone.x1 && zone.y2 > zone.y1;
}

app.get('/api/zones', (req, res) => {
    res.json({ enter: ZONES.ENTER, exit: ZONES.EXIT });
});

app.post('/api/calibrate-zones', (req, res) => {
    const { enter, exit } = req.body || {};
    if (!isValidZone(enter) || !isValidZone(exit)) {
        return res.status(400).json({
            success: false,
            message: 'Expected { enter: {x1,y1,x2,y2}, exit: {x1,y1,x2,y2} } with x2 > x1 and y2 > y1'
        });
    }
    // Zones are sent with every frame, so the detector picks them up immediately
    ZONES.ENTER = { x1: enter.x1, y1: enter.y1, x2: enter.x2, y2: enter.y2 };
    ZONES.EXIT = { x1: exit.x1, y1: exit.y1, x2: exit.x2, y2: exit.y2 };
    trackedPeople.clear();
    res.json({ success: true, message: 'Zones calibrated successfully', zones: { enter: ZONES.ENTER, exit: ZONES.EXIT } });
});

app.get('/api/test-connection', (req, res) => {
    let lastError = null;
    let responded = false;
    const respondOnce = (payload) => {
        if (responded || res.headersSent) return;
        responded = true;
        res.json(payload);
    };

    const testProcess = spawn('ffmpeg', [
        '-loglevel', 'error',
        '-rtsp_transport', rtspConfig.rtsp_transport || 'tcp',
        '-i', RTSP_URL,
        '-t', '2',
        '-f', 'null',
        '-'
    ]);

    const timeout = setTimeout(() => {
        testProcess.kill('SIGTERM');
        respondOnce({ success: false, message: 'Connection timeout' });
    }, rtspConfig.rtsp_timeout_ms || 5000);

    testProcess.stderr.on('data', (data) => {
        const output = maskRtspUrl(data.toString()).trim();
        if (output) lastError = output;
    });
    testProcess.on('close', (code) => {
        clearTimeout(timeout);
        respondOnce(code === 0
            ? { success: true, message: 'Camera is reachable' }
            : { success: false, message: lastError || `FFmpeg exited with code ${code}` });
    });
    testProcess.on('error', (err) => {
        clearTimeout(timeout);
        respondOnce({ success: false, message: err.message });
    });
});

// ========== START ==========
server.listen(PORT, '0.0.0.0', () => {
    console.log('\n=================================');
    console.log('🚀 CCTV Monitor running');
    console.log(`📍 Dashboard:  http://localhost:${PORT}`);
    console.log(`📡 WebSocket:  ws://localhost:${PORT}`);
    console.log(`🎥 RTSP:       ${maskRtspUrl(RTSP_URL)}`);
    console.log('=================================');
    console.log(`📊 Enter zone: ${JSON.stringify(ZONES.ENTER)}`);
    console.log(`📊 Exit zone:  ${JSON.stringify(ZONES.EXIT)}`);
    console.log('   People walking in should cross the GREEN zone,');
    console.log('   people leaving should cross the RED zone.');
    console.log('=================================\n');
});

function shutdown() {
    console.log('\n🛑 Shutting down gracefully...');
    stopStream();
    wss.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
