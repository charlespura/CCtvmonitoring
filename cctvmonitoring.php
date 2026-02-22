<?php
// CCTV Monitoring Page for Tapo TC70
session_start();

// Configuration (can be overridden by rtsp-config.json)
$config = [
    'camera_ip' => '192.168.1.100',
    'rtsp_port' => 554,
    'rtsp_username' => '',
    'rtsp_password' => '',
    'stream_quality' => 'stream1'
];

$config_path = __DIR__ . '/rtsp-config.json';
if (file_exists($config_path)) {
    $file_config = json_decode(file_get_contents($config_path), true);
    if (is_array($file_config)) {
        $config = array_merge($config, $file_config);
    }
}

$camera_ip = $config['camera_ip'];
$rtsp_username = $config['rtsp_username'];
$rtsp_password = $config['rtsp_password'];
$stream_quality = $config['stream_quality'];
$rtsp_port = $config['rtsp_port'];

// Construct RTSP URL with authentication
$rtsp_url = "rtsp://{$rtsp_username}:{$rtsp_password}@{$camera_ip}:{$rtsp_port}/{$stream_quality}";
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CCTV Monitoring with People Counter - Tapo TC70</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        
        .header {
            background: white;
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .header h1 {
            color: #333;
            margin-bottom: 10px;
            font-size: 24px;
        }
        
        .header .status {
            display: inline-block;
            padding: 5px 15px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: bold;
        }
        
        .status.online {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }
        
        .status.offline {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        
        .stats-container {
            background: white;
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 15px;
            text-align: center;
        }
        
        .stat-card {
            background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
            padding: 20px;
            border-radius: 10px;
            transition: transform 0.3s ease;
        }
        
        .stat-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 5px 20px rgba(0,0,0,0.2);
        }
        
        .stat-card.primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        
        .stat-card.success {
            background: linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%);
        }
        
        .stat-card.warning {
            background: linear-gradient(135deg, #fad0c4 0%, #ffd1ff 100%);
        }
        
        .stat-card.danger {
            background: linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%);
        }
        
        .stat-label {
            font-size: 14px;
            color: #666;
            margin-bottom: 5px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .stat-value {
            font-size: 48px;
            font-weight: bold;
            color: #333;
            line-height: 1.2;
        }
        
        .stat-card.primary .stat-label,
        .stat-card.primary .stat-value {
            color: white;
        }
        
        .video-container {
            background: #000;
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            margin-bottom: 20px;
            position: relative;
            min-height: 500px;
        }
        
        #videoCanvas {
            width: 100%;
            height: auto;
            display: block;
            background: #1a1a1a;
        }
        
        .connection-status {
            position: absolute;
            top: 10px;
            right: 10px;
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 8px 15px;
            border-radius: 20px;
            font-size: 12px;
            z-index: 10;
        }
        
        .zone-legend {
            position: absolute;
            top: 10px;
            left: 10px;
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 10px;
            border-radius: 5px;
            font-size: 12px;
            z-index: 10;
        }
        
        .zone-item {
            display: flex;
            align-items: center;
            margin: 5px 0;
        }
        
        .zone-color {
            width: 20px;
            height: 20px;
            margin-right: 8px;
            border-radius: 3px;
        }
        
        .zone-color.enter { background: rgba(0, 255, 0, 0.5); border: 2px solid #00ff00; }
        .zone-color.exit { background: rgba(255, 0, 0, 0.5); border: 2px solid #ff0000; }
        .zone-color.person { background: rgba(255, 255, 0, 0.5); border: 2px solid #ffff00; }
        
        .controls {
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
        }
        
        .control-btn {
            padding: 12px 24px;
            border: none;
            border-radius: 5px;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s ease;
            background: #f0f0f0;
            color: #333;
        }
        
        .control-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        }
        
        .control-btn.primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        
        .control-btn.success {
            background: #28a745;
            color: white;
        }
        
        .control-btn.warning {
            background: #ffc107;
            color: #333;
        }
        
        .control-btn.danger {
            background: #dc3545;
            color: white;
        }
        
        .info-panel {
            background: white;
            padding: 20px;
            border-radius: 10px;
            margin-top: 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        }
        
        .info-panel h3 {
            color: #333;
            margin-bottom: 15px;
        }
        
        .info-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 15px;
        }
        
        .info-item {
            padding: 10px;
            background: #f8f9fa;
            border-radius: 5px;
            border-left: 4px solid #667eea;
        }
        
        .info-item strong {
            display: block;
            color: #666;
            font-size: 12px;
            margin-bottom: 5px;
        }
        
        .info-item span {
            color: #333;
            font-size: 14px;
            word-break: break-all;
        }
        
        .history-log {
            margin-top: 20px;
            max-height: 200px;
            overflow-y: auto;
            background: #f8f9fa;
            padding: 10px;
            border-radius: 5px;
        }
        
        .history-item {
            padding: 8px;
            border-bottom: 1px solid #dee2e6;
            font-size: 14px;
        }
        
        .history-item.enter { color: #28a745; }
        .history-item.exit { color: #dc3545; }
        
        .loading {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid #f3f3f3;
            border-top: 3px solid #667eea;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div>
                <h1>Tapo TC70 CCTV Monitoring with People Counter</h1>
                <div class="status online" id="status-indicator">
                    ● Camera Online
                </div>
            </div>
            <div class="last-updated" id="last-updated">
                Last updated: --
            </div>
        </div>
        
        <!-- People Counter Stats -->
        <div class="stats-container">
            <div class="stats-grid">
                <div class="stat-card primary">
                    <div class="stat-label">Current in Office</div>
                    <div class="stat-value" id="current-count">0</div>
                </div>
                <div class="stat-card success">
                    <div class="stat-label">Total Entered</div>
                    <div class="stat-value" id="enter-count">0</div>
                </div>
                <div class="stat-card warning">
                    <div class="stat-label">Total Exited</div>
                    <div class="stat-value" id="exit-count">0</div>
                </div>
                <div class="stat-card danger">
                    <div class="stat-label">Detection Rate</div>
                    <div class="stat-value" id="detection-rate">0</div>
                </div>
            </div>
        </div>
        
        <div class="video-container">
            <canvas id="videoCanvas"></canvas>
            <div class="connection-status" id="connection-status">Connecting to stream...</div>
            <div class="zone-legend">
                <div class="zone-item">
                    <div class="zone-color enter"></div>
                    <span>Enter Zone</span>
                </div>
                <div class="zone-item">
                    <div class="zone-color exit"></div>
                    <span>Exit Zone</span>
                </div>
                <div class="zone-item">
                    <div class="zone-color person"></div>
                    <span>Detected Person</span>
                </div>
            </div>
        </div>
        
        <div class="controls">
            <button class="control-btn primary" onclick="takeSnapshot()">📸 Take Snapshot</button>
            <button class="control-btn" onclick="toggleFullscreen()">🖥️ Fullscreen</button>
            <button class="control-btn" onclick="toggleAudio()">🔊 Toggle Audio</button>
            <button class="control-btn" onclick="reconnectStream()">🔄 Reconnect</button>
            <button class="control-btn success" onclick="showHistory()">📋 Show History</button>
            <button class="control-btn warning" onclick="resetCounts()">🔄 Reset Counts</button>
        </div>
        
        <div class="info-panel">
            <h3>Camera Information</h3>
            <div class="info-grid">
                <div class="info-item">
                    <strong>Camera Model</strong>
                    <span>Tapo TC70</span>
                </div>
                <div class="info-item">
                    <strong>IP Address</strong>
                    <span><?php echo htmlspecialchars($camera_ip); ?></span>
                </div>
                <div class="info-item">
                    <strong>RTSP URL</strong>
                    <span>rtsp://[username]:[password]@<?php echo htmlspecialchars($camera_ip); ?>:<?php echo htmlspecialchars($rtsp_port); ?>/<?php echo $stream_quality; ?></span>
                </div>
                <div class="info-item">
                    <strong>Stream Quality</strong>
                    <span><?php echo $stream_quality === 'stream1' ? 'High (1080P)' : 'Low (360P)'; ?></span>
                </div>
                <div class="info-item">
                    <strong>RTSP Port</strong>
                    <span>554</span>
                </div>
                <div class="info-item">
                    <strong>Username</strong>
                    <span><?php echo htmlspecialchars($rtsp_username); ?></span>
                </div>
                <div class="info-item">
                    <strong>Stream Server</strong>
                    <span>Running on port 3000</span>
                </div>
            </div>
            
            <!-- People Detection History -->
            <h3 style="margin-top: 20px;">Recent Detection History</h3>
            <div class="history-log" id="history-log">
                <div class="history-item">No events yet</div>
            </div>
        </div>
    </div>
    
<script>
    let ws = null;
    let canvas = document.getElementById('videoCanvas');
    let ctx = canvas.getContext('2d');
    let connectionStatus = document.getElementById('connection-status');
    let statusIndicator = document.getElementById('status-indicator');
    let isConnected = false;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    let pingInterval = null;
    let detectionRate = 0;
    let frameCount = 0;
    let lastRateUpdate = Date.now();
    let reconnectTimer = null;
    let manualClose = false;
    
    // Set canvas size
    canvas.width = 640;
    canvas.height = 480;
    
    function connectWebSocket() {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            return;
        }
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        manualClose = false;
        connectionStatus.textContent = 'Connecting to stream...';
        connectionStatus.style.backgroundColor = 'rgba(255, 165, 0, 0.7)';
        
        const wsHost = window.location.hostname || 'localhost';
        ws = new WebSocket(`ws://${wsHost}:3000`);
        
        ws.onopen = function() {
            console.log('Connected to stream server');
            connectionStatus.textContent = 'Stream connected - People Counting Active';
            connectionStatus.style.backgroundColor = 'rgba(0, 128, 0, 0.7)';
            statusIndicator.className = 'status online';
            statusIndicator.innerHTML = '● Camera Online';
            isConnected = true;
            reconnectAttempts = 0;
            
            // Send ping every 30 seconds
            pingInterval = setInterval(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'ping' }));
                }
            }, 30000);
        };
        
        ws.onmessage = function(event) {
            try {
                const data = JSON.parse(event.data);
                
                if (data.type === 'frame' && data.data) {
                    // Update counts if available
                    if (data.counts) {
                        document.getElementById('current-count').textContent = data.counts.current;
                        document.getElementById('enter-count').textContent = data.counts.enter;
                        document.getElementById('exit-count').textContent = data.counts.exit;
                        document.getElementById('last-updated').textContent = 
                            'Last updated: ' + new Date(data.counts.timestamp).toLocaleTimeString();
                        
                        // Calculate detection rate
                        frameCount++;
                        const now = Date.now();
                        if (now - lastRateUpdate > 1000) {
                            detectionRate = frameCount;
                            document.getElementById('detection-rate').textContent = detectionRate + ' fps';
                            frameCount = 0;
                            lastRateUpdate = now;
                        }
                    }
                    
                    // Add to history if people detected
                    if (data.people && data.people.length > 0) {
                        addToHistory(`Detected ${data.people.length} people`, 'info');
                    }
                    
                    // Display frame
                    const img = new Image();
                    img.onload = function() {
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    };
                    img.src = 'data:image/jpeg;base64,' + data.data;
                    
                } else if (data.type === 'counts') {
                    // Initial counts
                    document.getElementById('current-count').textContent = data.data.current;
                    document.getElementById('enter-count').textContent = data.data.enter;
                    document.getElementById('exit-count').textContent = data.data.exit;
                    
                } else if (data.type === 'history') {
                    displayHistory(data.data);
                    
                } else if (data.type === 'ffmpeg_error') {
                    connectionStatus.textContent = 'Stream error: ' + data.data;
                    connectionStatus.style.backgroundColor = 'rgba(255, 0, 0, 0.7)';
                    statusIndicator.className = 'status offline';
                    statusIndicator.innerHTML = '○ Camera Offline';

                } else if (data.type === 'pong') {
                    console.log('Connection alive');
                }
            } catch (e) {
                console.error('Error processing frame:', e);
            }
        };
        
        ws.onerror = function(error) {
            console.error('WebSocket error:', error);
            connectionStatus.textContent = 'Connection error';
            connectionStatus.style.backgroundColor = 'rgba(255, 0, 0, 0.7)';
            statusIndicator.className = 'status offline';
            statusIndicator.innerHTML = '○ Camera Offline';
            isConnected = false;
        };
        
        ws.onclose = function() {
            console.log('Disconnected from stream server');
            connectionStatus.textContent = 'Disconnected';
            connectionStatus.style.backgroundColor = 'rgba(255, 0, 0, 0.7)';
            statusIndicator.className = 'status offline';
            statusIndicator.innerHTML = '○ Camera Offline';
            isConnected = false;
            
            if (pingInterval) {
                clearInterval(pingInterval);
                pingInterval = null;
            }
            
            // Try to reconnect
            if (!manualClose) {
                if (reconnectAttempts < maxReconnectAttempts) {
                    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
                    reconnectAttempts++;
                    connectionStatus.textContent = `Reconnecting in ${delay/1000}s... (Attempt ${reconnectAttempts}/${maxReconnectAttempts})`;
                    reconnectTimer = setTimeout(connectWebSocket, delay);
                } else {
                    connectionStatus.textContent = 'Failed to connect. Please refresh the page.';
                }
            }
        };
    }
    
    // Add to history log
    function addToHistory(message, type = 'info') {
        const historyLog = document.getElementById('history-log');
        const time = new Date().toLocaleTimeString();
        const item = document.createElement('div');
        item.className = `history-item ${type}`;
        item.textContent = `[${time}] ${message}`;
        historyLog.insertBefore(item, historyLog.firstChild);
        
        // Limit history to 50 items
        while (historyLog.children.length > 50) {
            historyLog.removeChild(historyLog.lastChild);
        }
    }
    
    // Display full history
    function displayHistory(history) {
        const historyLog = document.getElementById('history-log');
        historyLog.innerHTML = '';
        history.forEach(event => {
            const item = document.createElement('div');
            item.className = `history-item ${event.type.toLowerCase()}`;
            item.textContent = `[${new Date(event.time).toLocaleTimeString()}] ${event.type}: Person detected`;
            historyLog.appendChild(item);
        });
    }
    
    // Show history
    function showHistory() {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'get_history' }));
        } else {
            alert('Not connected to server');
        }
    }
    
    // Reset counts
    function resetCounts() {
        if (confirm('Are you sure you want to reset all counters?')) {
            fetch('http://localhost:3000/api/reset-counts', {
                method: 'POST'
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    document.getElementById('current-count').textContent = '0';
                    document.getElementById('enter-count').textContent = '0';
                    document.getElementById('exit-count').textContent = '0';
                    addToHistory('Counters reset', 'info');
                }
            })
            .catch(err => console.error('Error resetting counts:', err));
        }
    }
    
    // Start connection
    connectWebSocket();
    
    function takeSnapshot() {
        if (!isConnected) {
            alert('No stream available');
            return;
        }
        
        try {
            const link = document.createElement('a');
            link.download = `snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            addToHistory('Snapshot taken', 'info');
        } catch (e) {
            console.error('Error taking snapshot:', e);
            alert('Error taking snapshot');
        }
    }
    
    function toggleFullscreen() {
        const container = document.querySelector('.video-container');
        if (!document.fullscreenElement) {
            if (container.requestFullscreen) {
                container.requestFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    }
    
    function toggleAudio() {
        alert('Audio is not available in this stream mode. The camera audio is disabled for stability.');
    }
    
    function reconnectStream() {
        reconnectAttempts = 0;
        if (ws) {
            manualClose = true;
            ws.close();
        } else {
            connectWebSocket();
        }
    }
    
    // Handle page visibility change
    document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
            return;
        } else {
            if (!ws || ws.readyState === WebSocket.CLOSED) {
                reconnectAttempts = 0;
                connectWebSocket();
            }
        }
    });
</script>
</body>
</html>
