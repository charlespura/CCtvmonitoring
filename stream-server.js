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

// Camera configuration (can be overridden by rtsp-config.json or env vars)
const RTSP_CONFIG_PATH = path.join(__dirname, 'rtsp-config.json');
const DEFAULT_RTSP_CONFIG = {
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
            console.warn('⚠️ Failed to read rtsp-config.json, using defaults:', err.message);
        }
    }

    // Env vars override file/defaults
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

const rtspConfig = loadRtspConfig();
const RTSP_URL = buildRtspUrl(rtspConfig);

function maskRtspUrl(url) {
    return url.replace(/\/\/([^/]+):([^@]+)@/, '//****:****@');
}

function buildFfmpegInputArgs(config) {
    const transport = config.rtsp_transport || 'tcp';
    return [
        '-rtsp_transport',
        transport,
        '-fflags',
        '+nobuffer+discardcorrupt',
        '-flags',
        'low_delay',
        '-err_detect',
        'ignore_err'
    ];
}

function buildFfmpegFilterArgs() {
    const width = parseInt(process.env.STREAM_SCALE_WIDTH || CONFIG.STREAM_SCALE_WIDTH, 10);
    if (!Number.isFinite(width) || width <= 0) {
        return [];
    }
    return ['-vf', `scale=${width}:-2`];
}

// Enable CORS
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Keep track of FFmpeg processes and clients
let ffmpegProcess = null;
let clients = new Set();
let lastFfmpegError = null;
let ffmpegStopTimer = null;
const FFMPEG_ERROR_HINTS = [
    'error',
    '401',
    'unauthorized',
    'connection',
    'invalid data',
    'failed',
    'not permitted',
    'denied',
    'timed out'
];

function heartbeat() {
    this.isAlive = true;
}

const wsPingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 20000);

wss.on('close', () => {
    clearInterval(wsPingInterval);
});

// ========== PEOPLE COUNTING SYSTEM ==========
let peopleCount = 0;
let enterCount = 0;
let exitCount = 0;
let peopleHistory = [];

// Define detection zones - ADJUST THESE BASED ON YOUR CAMERA VIEW
// These are just starting points - you'll need to calibrate them
const ZONES = {
    // Left side of screen for ENTER (green zone)
    ENTER: { x1: 0, y1: 150, x2: 320, y2: 350 },
    // Right side of screen for EXIT (red zone)
    EXIT: { x1: 320, y1: 150, x2: 640, y2: 350 }
};

// Track people across frames
let trackedPeople = new Map();
let nextPersonId = 0;

// Configuration
const CONFIG = {
    FRAME_RATE: 2, // Process 2 frames per second for detection
    PERSON_TIMEOUT: 3000, // Remove person after 3 seconds not seen
    MOVEMENT_THRESHOLD: 100, // Max pixels movement to consider same person (increased for better tracking)
    DETECTION_CONFIDENCE: 0.3, // Lowered confidence for better detection
    STREAM_SCALE_WIDTH: 640, // Resize frames to reduce lag/CPU
    ZONE_BUFFER: 20 // Buffer zone to prevent false triggers at boundaries
};

// Create Python script for people detection
const pythonScript = `
import cv2
import sys
import numpy as np
import json
import base64
from datetime import datetime

# Load pre-trained HOG descriptor for people detection
hog = cv2.HOGDescriptor()
hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())

# Zone definitions
enter_zone = ${JSON.stringify(ZONES.ENTER)}
exit_zone = ${JSON.stringify(ZONES.EXIT)}
config = ${JSON.stringify(CONFIG)}

def draw_zones(frame):
    # Draw enter zone (green) - semi-transparent
    overlay = frame.copy()
    cv2.rectangle(overlay, 
                  (enter_zone['x1'], enter_zone['y1']), 
                  (enter_zone['x2'], enter_zone['y2']), 
                  (0, 255, 0), -1)
    cv2.addWeighted(overlay, 0.2, frame, 0.8, 0, frame)
    
    cv2.rectangle(frame, 
                  (enter_zone['x1'], enter_zone['y1']), 
                  (enter_zone['x2'], enter_zone['y2']), 
                  (0, 255, 0), 2)
    cv2.putText(frame, 'ENTER ZONE', 
                (enter_zone['x1'], enter_zone['y1'] - 10),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
    
    # Draw exit zone (red) - semi-transparent
    overlay = frame.copy()
    cv2.rectangle(overlay, 
                  (exit_zone['x1'], exit_zone['y1']), 
                  (exit_zone['x2'], exit_zone['y2']), 
                  (0, 0, 255), -1)
    cv2.addWeighted(overlay, 0.2, frame, 0.8, 0, frame)
    
    cv2.rectangle(frame, 
                  (exit_zone['x1'], exit_zone['y1']), 
                  (exit_zone['x2'], exit_zone['y2']), 
                  (0, 0, 255), 2)
    cv2.putText(frame, 'EXIT ZONE', 
                (exit_zone['x1'], exit_zone['y1'] - 10),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 2)
    
    return frame

def detect_people(frame_data):
    try:
        # Convert base64 to image
        img_data = base64.b64decode(frame_data)
        nparr = np.frombuffer(img_data, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if frame is None:
            return {'error': 'Could not decode image'}
        
        # Resize frame for faster processing
        height, width = frame.shape[:2]
        target_width = config.get('STREAM_SCALE_WIDTH', 640)
        scale = target_width / width
        new_width = target_width
        new_height = int(height * scale)
        frame = cv2.resize(frame, (new_width, new_height))
        
        # Draw zones on frame
        frame_with_zones = draw_zones(frame.copy())
        
        # Detect people
        (rects, weights) = hog.detectMultiScale(
            frame, 
            winStride=(4, 4),
            padding=(8, 8), 
            scale=1.05
        )
        
        people = []
        zone_buffer = config.get('ZONE_BUFFER', 20)
        
        for i, (x, y, w, h) in enumerate(rects):
            if weights[i] < config['DETECTION_CONFIDENCE']:
                continue
                
            center_x = x + w // 2
            center_y = y + h // 2
            
            # Check if in zones with buffer
            in_enter = (enter_zone['x1'] - zone_buffer <= center_x <= enter_zone['x2'] + zone_buffer and 
                       enter_zone['y1'] - zone_buffer <= center_y <= enter_zone['y2'] + zone_buffer)
            in_exit = (exit_zone['x1'] - zone_buffer <= center_x <= exit_zone['x2'] + zone_buffer and 
                      exit_zone['y1'] - zone_buffer <= center_y <= exit_zone['y2'] + zone_buffer)
            
            # Draw rectangle around person
            if in_enter:
                color = (0, 255, 0)  # Green for enter zone
            elif in_exit:
                color = (0, 0, 255)  # Red for exit zone
            else:
                color = (255, 255, 0)  # Yellow for elsewhere
            
            cv2.rectangle(frame_with_zones, (x, y), (x + w, y + h), color, 2)
            cv2.putText(frame_with_zones, f'P{i} ({weights[i]:.2f})', (x, y - 5),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)
            
            people.append({
                'id': i,
                'x': center_x,
                'y': center_y,
                'width': w,
                'height': h,
                'confidence': float(weights[i]),
                'in_enter_zone': in_enter,
                'in_exit_zone': in_exit
            })
        
        # Convert frame back to base64 for sending to client
        _, buffer = cv2.imencode('.jpg', frame_with_zones)
        frame_base64 = base64.b64encode(buffer).decode('utf-8')
        
        return {
            'people': people,
            'frame': frame_base64,
            'count': len(people),
            'timestamp': datetime.now().isoformat()
        }
        
    except Exception as e:
        return {'error': str(e)}

# Main loop
while True:
    try:
        line = sys.stdin.readline()
        if not line:
            break
            
        data = json.loads(line)
        result = detect_people(data['frame'])
        print(json.dumps(result))
        sys.stdout.flush()
        
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.stdout.flush()
`;

// Save Python script
const pythonScriptPath = path.join(__dirname, 'people_detector.py');
fs.writeFileSync(pythonScriptPath, pythonScript);
console.log('✅ Python detection script created');

// Function to update people count based on detections
function updatePeopleCount(detections) {
    const currentTime = Date.now();
    const currentPositions = new Map();
    
    console.log(`Detected ${detections.length} people in frame`);
    
    detections.forEach(det => {
        let matched = false;
        
        // Try to match with existing tracked person
        for (let [id, person] of trackedPeople.entries()) {
            const distance = Math.sqrt(
                Math.pow(det.x - person.lastPosition.x, 2) + 
                Math.pow(det.y - person.lastPosition.y, 2)
            );
            
            if (distance < CONFIG.MOVEMENT_THRESHOLD) {
                // Check for zone transitions - person entering
                if (!person.inEnterZone && det.in_enter_zone) {
                    enterCount++;
                    peopleCount++; // Increment current count
                    console.log(`✅ Person ENTERED! Total enters: ${enterCount}, Current in office: ${peopleCount}`);
                    
                    peopleHistory.push({
                        type: 'ENTER',
                        time: new Date().toISOString(),
                        position: { x: det.x, y: det.y }
                    });
                }
                
                // Check for zone transitions - person exiting
                if (!person.inExitZone && det.in_exit_zone && peopleCount > 0) {
                    exitCount++;
                    peopleCount = Math.max(0, peopleCount - 1); // Decrement but not below 0
                    console.log(`👋 Person EXITED! Total exits: ${exitCount}, Current in office: ${peopleCount}`);
                    
                    peopleHistory.push({
                        type: 'EXIT',
                        time: new Date().toISOString(),
                        position: { x: det.x, y: det.y }
                    });
                }
                
                // Update position
                currentPositions.set(id, {
                    lastPosition: { x: det.x, y: det.y },
                    lastSeen: currentTime,
                    inEnterZone: det.in_enter_zone,
                    inExitZone: det.in_exit_zone
                });
                matched = true;
                break;
            }
        }
        
        // New person detected
        if (!matched) {
            // Only count if they're in one of the zones (to avoid counting people outside)
            if (det.in_enter_zone || det.in_exit_zone) {
                currentPositions.set(nextPersonId++, {
                    lastPosition: { x: det.x, y: det.y },
                    lastSeen: currentTime,
                    inEnterZone: det.in_enter_zone,
                    inExitZone: det.in_exit_zone
                });
                console.log(`🆕 New person detected in zone`);
            }
        }
    });
    
    // Remove people not seen recently
    for (let [id, person] of trackedPeople.entries()) {
        if (currentTime - person.lastSeen > CONFIG.PERSON_TIMEOUT) {
            trackedPeople.delete(id);
            console.log(`⏱️ Person ${id} timed out`);
        }
    }
    
    // Update tracked people
    trackedPeople = currentPositions;
    // Update peopleCount based on tracked people
    peopleCount = trackedPeople.size;
    
    console.log(`Current tracked people: ${peopleCount}`);
}

// Function to start FFmpeg stream with people detection
function startFFmpegStream() {
    if (ffmpegProcess) {
        ffmpegProcess.kill('SIGTERM');
    }

    console.log('🎥 Starting FFmpeg stream with people detection...');
    lastFfmpegError = null;
    
    // Start Python process for people detection
    const pythonProcess = spawn('python3', [pythonScriptPath]);
    let pythonAlive = true;
    pythonProcess.on('close', () => {
        pythonAlive = false;
    });
    pythonProcess.stdin.on('error', (err) => {
        if (err.code !== 'EPIPE') {
            console.error('Python stdin error:', err);
        }
    });
    
    // FFmpeg command for video capture
    const ffmpeg = spawn('ffmpeg', [
        '-loglevel', 'error',
        ...buildFfmpegInputArgs(rtspConfig),
        '-i', RTSP_URL,
        ...buildFfmpegFilterArgs(),
        '-f', 'image2pipe',
        '-pix_fmt', 'yuv420p',
        '-vcodec', 'mjpeg',
        '-r', CONFIG.FRAME_RATE.toString(),
        '-q:v', '5',
        '-'
    ]);

    // Buffer for JPEG frames
    let frameBuffer = Buffer.alloc(0);
    let pythonBackpressure = false;
    
    ffmpeg.stdout.on('data', (chunk) => {
        frameBuffer = Buffer.concat([frameBuffer, chunk]);

        let start = frameBuffer.indexOf(Buffer.from([0xff, 0xd8]));
        let end = frameBuffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);

        while (start !== -1 && end !== -1) {
            const jpg = frameBuffer.slice(start, end + 2);
            frameBuffer = frameBuffer.slice(end + 2);

            // Send frame to Python for detection
            if (
                clients.size > 0 &&
                pythonAlive &&
                pythonProcess.stdin.writable &&
                !pythonProcess.stdin.destroyed &&
                !pythonBackpressure
            ) {
                const frameData = {
                    frame: jpg.toString('base64'),
                    timestamp: Date.now()
                };
                const wrote = pythonProcess.stdin.write(JSON.stringify(frameData) + '\n');
                if (!wrote) {
                    pythonBackpressure = true;
                    pythonProcess.stdin.once('drain', () => {
                        pythonBackpressure = false;
                    });
                }
            }

            start = frameBuffer.indexOf(Buffer.from([0xff, 0xd8]));
            end = frameBuffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
        }
    });

    // Handle Python detection results (line-delimited JSON)
    let pythonOutputBuffer = '';
    pythonProcess.stdout.on('data', (data) => {
        pythonOutputBuffer += data.toString();
        let newlineIndex = pythonOutputBuffer.indexOf('\n');
        while (newlineIndex !== -1) {
            const line = pythonOutputBuffer.slice(0, newlineIndex).trim();
            pythonOutputBuffer = pythonOutputBuffer.slice(newlineIndex + 1);

            if (line) {
                try {
                    const result = JSON.parse(line);

                    if (!result.error) {
                        // Update people count
                        if (result.people) {
                            updatePeopleCount(result.people);
                        }

                        // Send frame with annotations to all clients
                        if (result.frame && clients.size > 0) {
                            const message = JSON.stringify({
                                type: 'frame',
                                data: result.frame,
                                counts: {
                                    current: peopleCount,
                                    enter: enterCount,
                                    exit: exitCount,
                                    timestamp: Date.now()
                                },
                                people: result.people || []
                            });

                            clients.forEach((client) => {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(message);
                                }
                            });
                        }
                    }
                } catch (e) {
                    console.error('Python JSON parse error:', e.message);
                }
            }

            newlineIndex = pythonOutputBuffer.indexOf('\n');
        }
    });

    pythonProcess.stderr.on('data', (data) => {
        const output = data.toString().trim();
        if (output) {
            console.error('Python stderr:', output);
        }
    });

    ffmpeg.stderr.on('data', (data) => {
        const lines = data.toString().split('\n');
        lines.forEach((line) => {
            const output = line.trim();
            if (!output) {
                return;
            }
            if (output.toLowerCase().includes('deprecated pixel format')) {
                return;
            }

            const isError = FFMPEG_ERROR_HINTS.some((hint) =>
                output.toLowerCase().includes(hint)
            );
            if (!isError) {
                return;
            }

            console.log(`FFmpeg: ${output}`);
            lastFfmpegError = output;
            if (clients.size > 0) {
                const message = JSON.stringify({
                    type: 'ffmpeg_error',
                    data: lastFfmpegError
                });
                clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(message);
                    }
                });
            }
        });
    });

    ffmpeg.on('close', (code) => {
        console.log(`FFmpeg process closed with code ${code}`);
        if (code && code !== 0) {
            lastFfmpegError = lastFfmpegError || `FFmpeg exited with code ${code}`;
        }
        ffmpegProcess = null;
        pythonProcess.kill();
        
        if (clients.size > 0) {
            console.log('Restarting FFmpeg in 3 seconds...');
            setTimeout(startFFmpegStream, 3000);
        }
    });

    ffmpeg.on('error', (err) => {
        console.error('FFmpeg process error:', err);
        ffmpegProcess = null;
    });

    ffmpegProcess = ffmpeg;
}

// ========== WEB SOCKET HANDLING ==========
wss.on('connection', (ws) => {
    console.log('📱 Client connected');
    ws.isAlive = true;
    ws.on('pong', heartbeat);
    clients.add(ws);
    if (ffmpegStopTimer) {
        clearTimeout(ffmpegStopTimer);
        ffmpegStopTimer = null;
    }

    // Send initial counts
    ws.send(JSON.stringify({
        type: 'counts',
        data: {
            current: peopleCount,
            enter: enterCount,
            exit: exitCount,
            history: peopleHistory.slice(-50) // Last 50 events
        }
    }));
    if (lastFfmpegError) {
        ws.send(JSON.stringify({
            type: 'ffmpeg_error',
            data: lastFfmpegError
        }));
    }

    // Start FFmpeg if this is the first client
    if (clients.size === 1) {
        startFFmpegStream();
    }

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
            } else if (data.type === 'get_history') {
                ws.send(JSON.stringify({
                    type: 'history',
                    data: peopleHistory.slice(-100)
                }));
            }
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    });

    ws.on('close', (code, reason) => {
        const details = reason ? ` (${reason.toString()})` : '';
        console.log(`📱 Client disconnected [code ${code}]${details}`);
        clients.delete(ws);

        if (clients.size === 0 && ffmpegProcess && !ffmpegStopTimer) {
            ffmpegStopTimer = setTimeout(() => {
                if (clients.size === 0 && ffmpegProcess) {
                    console.log('No clients connected, stopping FFmpeg');
                    ffmpegProcess.kill('SIGTERM');
                    ffmpegProcess = null;
                }
                ffmpegStopTimer = null;
            }, 5000);
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clients.delete(ws);
    });
});

// ========== API ENDPOINTS ==========
app.get('/api/status', (req, res) => {
    res.json({ 
        online: clients.size > 0,
        clients: clients.size,
        people: {
            current: peopleCount,
            enter: enterCount,
            exit: exitCount
        },
        camera: 'Tapo TC70',
        ip: rtspConfig.camera_ip
    });
});

app.get('/api/counts', (req, res) => {
    res.json({
        current: peopleCount,
        enter: enterCount,
        exit: exitCount,
        timestamp: Date.now()
    });
});

app.post('/api/reset-counts', (req, res) => {
    enterCount = 0;
    exitCount = 0;
    peopleCount = 0;
    peopleHistory = [];
    trackedPeople.clear();
    
    res.json({ 
        success: true, 
        message: 'Counts reset successfully' 
    });
});

app.get('/api/history', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    res.json(peopleHistory.slice(-limit));
});

app.post('/api/calibrate-zones', (req, res) => {
    try {
        const { enter, exit } = req.body;
        if (enter && exit) {
            ZONES.ENTER = enter;
            ZONES.EXIT = exit;
            
            // Update Python script with new zones
            const updatedScript = pythonScript.replace(
                /enter_zone = {[^}]+}/,
                `enter_zone = ${JSON.stringify(enter)}`
            ).replace(
                /exit_zone = {[^}]+}/,
                `exit_zone = ${JSON.stringify(exit)}`
            );
            
            fs.writeFileSync(pythonScriptPath, updatedScript);
            
            res.json({ 
                success: true, 
                message: 'Zones calibrated successfully',
                zones: { enter, exit }
            });
        } else {
            res.status(400).json({ success: false, message: 'Invalid zone data' });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/zones', (req, res) => {
    res.json({
        enter: ZONES.ENTER,
        exit: ZONES.EXIT
    });
});

app.get('/api/test-connection', async (req, res) => {
    let lastError = null;
    let responded = false;
    const respondOnce = (payload) => {
        if (responded || res.headersSent) {
            return;
        }
        responded = true;
        res.json(payload);
    };
    const testProcess = spawn('ffmpeg', [
        '-loglevel', 'error',
        ...buildFfmpegInputArgs(rtspConfig),
        '-i', RTSP_URL,
        '-t', '2',
        '-f', 'null',
        '-'
    ]);

    let timeout = setTimeout(() => {
        testProcess.kill('SIGTERM');
        respondOnce({ success: false, message: 'Connection timeout' });
    }, 5000);

    testProcess.stderr.on('data', (data) => {
        const output = data.toString().trim();
        if (output) {
            lastError = output;
        }
        if (output.includes('Connection timed out')) {
            clearTimeout(timeout);
            testProcess.kill('SIGTERM');
            respondOnce({ success: false, message: 'Connection timed out' });
        }
    });

    testProcess.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
            respondOnce({ success: true, message: 'Camera is reachable' });
        } else {
            respondOnce({ success: false, message: lastError || `FFmpeg exited with code ${code}` });
        }
    });
    testProcess.on('error', (err) => {
        clearTimeout(timeout);
        respondOnce({ success: false, message: err.message });
    });
});

// ========== START SERVER ==========
const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('\n=================================');
    console.log(`🚀 Server running at:`);
    console.log(`📍 http://localhost:${PORT}`);
    console.log(`📍 http://YOUR_IP:${PORT}`);
    console.log(`📡 WebSocket: ws://localhost:${PORT}`);
    console.log(`🎥 RTSP Stream: ${maskRtspUrl(RTSP_URL)}`);
    console.log('=================================\n');
    console.log('👥 People Counting System Active');
    console.log('📊 Detection Zones:');
    console.log(`   - Enter Zone: ${JSON.stringify(ZONES.ENTER)}`);
    console.log(`   - Exit Zone: ${JSON.stringify(ZONES.EXIT)}`);
    console.log('=================================\n');
    console.log('⚠️  IMPORTANT: If people are not being counted, calibrate the zones:');
    console.log('   Make sure people walking into the office pass through the GREEN zone');
    console.log('   and people leaving pass through the RED zone');
    console.log('=================================\n');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down gracefully...');
    if (ffmpegProcess) {
        ffmpegProcess.kill('SIGTERM');
    }
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});