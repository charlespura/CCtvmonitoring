<div align="center">

# 📹 CCTV Monitoring with People Counting

**A real-time CCTV dashboard that streams an RTSP camera to your browser and counts people walking in and out using OpenCV.**

Built for the TP-Link **Tapo TC70**, and it works with any camera that has an RTSP stream.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.8%2B-3776AB?logo=python&logoColor=white)
![OpenCV](https://img.shields.io/badge/OpenCV-4.x-5C3EE8?logo=opencv&logoColor=white)
![FFmpeg](https://img.shields.io/badge/FFmpeg-required-007808?logo=ffmpeg&logoColor=white)
![License](https://img.shields.io/badge/license-ISC-blue)

<img src="docs/screenshot.png" alt="CCTV Monitor dashboard showing a live camera view with enter and exit zones, people counters and an activity feed" width="100%">

<sub>Dashboard preview using a synthetic demo frame</sub>

</div>

---

## ✨ Features

- **Live view in the browser.** The RTSP stream is relayed over WebSocket, so no plugins or VLC are needed.
- **People counting.** OpenCV HOG person detection with **Enter** (green) and **Exit** (red) zones.
- **Live counters.** Shows who is currently inside, total entered, total exited, and people in view right now.
- **Activity feed.** Enter and exit events are pushed instantly to every open dashboard, with *All / In / Out* filters.
- **Status you can act on.** Clear states for *connecting*, *live*, *stalled*, *no signal* and *offline*. Each comes with a plain-English fix (for example, "Camera rejected the login: check rtsp-config.json").
- **Snapshots, fullscreen and a legend toggle**, with keyboard shortcuts.
- **Dark and light themes.** Follows your OS setting and remembers a manual choice.
- **Responsive.** Works on phones, tablets and wall-mounted monitors.
- **Auto-recovery.** The browser reconnects with backoff, and the server restarts FFmpeg if the camera drops.
- **Saves resources.** The camera pipeline only runs while someone is watching.

## 🧠 How it works

```mermaid
flowchart LR
    CAM["📷 IP camera<br/>(RTSP)"] -->|H.264| FF["FFmpeg<br/>2 fps · 640px MJPEG"]
    FF -->|JPEG frames| NODE["Node.js<br/>stream-server.js"]
    NODE -->|"frame + zones (stdin)"| PY["Python + OpenCV<br/>people_detector.py"]
    PY -->|"annotated frame + detections (stdout)"| NODE
    NODE -->|WebSocket| UI["🖥️ Browser dashboard<br/>public/"]
    UI -->|REST API| NODE
```

1. **FFmpeg** pulls the RTSP stream and outputs downscaled JPEG frames at 2 fps.
2. **Node.js** splits the byte stream into frames and pipes each one, along with the current zones, to the Python worker.
3. **Python/OpenCV** detects people, draws the zones and bounding boxes, and returns the annotated frame and the detections.
4. **Node.js** follows each person from frame to frame. A person moving *into* the enter zone counts as **ENTER**, and moving *into* the exit zone counts as **EXIT**. Node then broadcasts the frame, counts and events to every connected browser.

## 📋 Requirements

| Tool | Version | Install (macOS) |
| --- | --- | --- |
| Node.js | 18+ | `brew install node` |
| Python | 3.8+ | `brew install python` |
| FFmpeg | any recent | `brew install ffmpeg` |
| OpenCV + NumPy | 4.x | `pip3 install -r requirements.txt` |

On Windows or Linux, install the same tools with your package manager. FFmpeg must be on your `PATH`.

## 📷 Tapo camera setup (do this first)

Tapo cameras keep RTSP **turned off** until you enable it in the Tapo app:

1. **Turn on Third-Party Compatibility.** In the Tapo app, go to **Me** → **Tapo Lab** → **Third-Party Compatibility** and turn it **On**. Newer firmware needs this before RTSP will work.
2. **Create a Camera Account.** Open the camera → ⚙️ **Settings** → **Advanced Settings** → **Camera Account**, then set a username and password. These are your `rtsp_username` and `rtsp_password`.
3. **Find the camera's IP address.** In the camera's settings, open **Device Info** → **IP Address**. Use it as `camera_ip`.
4. **Turn off Privacy Mode** on the camera, or the stream will be blank.

> 💡 **Tip:** In your router settings, reserve a fixed IP address for the camera (a "DHCP reservation"). Otherwise the IP can change after a restart and the dashboard will show *Camera is unreachable*.

Check that RTSP is open (replace the IP with your camera's):

```bash
nc -z -G 3 192.168.1.100 554 && echo "RTSP is open" || echo "RTSP is closed. Repeat steps 1–2"
```

## 🚀 Quick start

```bash
# 1. Clone
git clone https://github.com/charlespura/CCtvmonitoring.git
cd CCtvmonitoring

# 2. Install dependencies
npm install
pip3 install -r requirements.txt

# 3. Add your camera credentials (this file is git-ignored)
cp rtsp-config.example.json rtsp-config.json
#    then edit rtsp-config.json

# 4. Start
npm start
```

Open **http://localhost:3000**. To view from another device on your network, use `http://<your-computer-ip>:3000`.

### Using XAMPP

If the project lives in `htdocs`, you can also open
`http://localhost/<path-to-project>/cctvmonitoring.php`.
That page forwards you to the dashboard when the Node server is running. If it isn't running, the page shows a short setup checklist.

## ⚙️ Configuration

### Camera: `rtsp-config.json`

```json
{
  "camera_ip": "192.168.1.100",
  "rtsp_port": 554,
  "rtsp_username": "your-camera-account-username",
  "rtsp_password": "your-camera-account-password",
  "stream_quality": "stream1"
}
```

| Key | Description |
| --- | --- |
| `camera_ip` | Local IP of the camera (find it in your router or the Tapo app) |
| `rtsp_port` | Usually `554` |
| `rtsp_username` / `rtsp_password` | For Tapo, this is the **Camera Account** (Tapo app → camera → ⚙️ → *Advanced Settings* → *Camera Account*), **not** your TP-Link login |
| `stream_quality` | `stream1` = 1080p (high), `stream2` = 360p (low) |
| `camera_name` | *(optional)* Display name shown on the dashboard |
| `rtsp_transport` | *(optional)* `tcp` (default) or `udp` |

### Environment variables

Environment variables override `rtsp-config.json`. They are useful for Docker or services.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP and WebSocket port |
| `RTSP_URL` | — | Full RTSP URL; overrides every other camera setting |
| `RTSP_HOST`, `RTSP_PORT`, `RTSP_USERNAME`, `RTSP_PASSWORD`, `RTSP_PATH` | — | Individual camera settings |
| `RTSP_TRANSPORT` | `tcp` | `tcp` or `udp` |
| `CAMERA_NAME` | `Tapo TC70` | Name shown in the UI |
| `STREAM_SCALE_WIDTH` | `640` | Width that frames are resized to before detection |
| `PYTHON_BIN` | `python3` | Python interpreter to use (for example, a virtualenv) |

```bash
RTSP_URL="rtsp://user:pass@192.168.1.50:554/stream2" PORT=8080 npm start
```

### Calibrating the detection zones

Zones are rectangles in pixel coordinates of the **scaled frame** (640px wide by default). For your camera, place them so people walking **in** cross the green zone and people walking **out** cross the red zone. Then apply them live, without a restart:

```bash
curl -X POST http://localhost:3000/api/calibrate-zones \
  -H "Content-Type: application/json" \
  -d '{"enter":{"x1":0,"y1":150,"x2":320,"y2":350},"exit":{"x1":320,"y1":150,"x2":640,"y2":350}}'
```

To make them permanent, edit `ZONES` in [`stream-server.js`](stream-server.js).

## 🔌 API

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/status` | Stream health, camera info (credentials masked), counts, uptime |
| `GET` | `/api/counts` | `{ current, enter, exit, tracked, timestamp }` |
| `GET` | `/api/history?limit=50` | Recent enter and exit events |
| `POST` | `/api/reset-counts` | Reset all counters and history (broadcast to all viewers) |
| `GET` | `/api/zones` | Current enter and exit zones |
| `POST` | `/api/calibrate-zones` | Update zones (`{ enter, exit }`) |
| `GET` | `/api/test-connection` | Try to open the RTSP stream for 2 seconds |

**WebSocket** messages sent by the server (`ws://host:3000`): `frame`, `counts`, `history`, `event`, `ffmpeg_error`, `pong`.

## ⌨️ Keyboard shortcuts

| Key | Action |
| --- | --- |
| <kbd>S</kbd> | Save snapshot (PNG) |
| <kbd>F</kbd> | Toggle fullscreen |
| <kbd>L</kbd> | Show or hide the overlay legend |
| <kbd>R</kbd> | Reconnect stream |
| <kbd>T</kbd> | Toggle dark or light theme |

## 🛠️ Troubleshooting

| Symptom | Fix |
| --- | --- |
| **"Camera rejected the login"** / `401 Unauthorized` | Use the Tapo **Camera Account** credentials, not your TP-Link cloud account |
| **"Camera is unreachable"** / timed out | Check `camera_ip`, make sure the camera is on the same network, and try `"rtsp_transport": "udp"` |
| **"FFmpeg is not installed"** | Install FFmpeg and make sure `ffmpeg -version` works in a terminal |
| Video works but no one is counted | Calibrate the zones (see above). HOG detection works best with full-body views from a moderate height |
| `ModuleNotFoundError: cv2` | Run `pip3 install -r requirements.txt` with the same Python that `python3` (or `PYTHON_BIN`) points to |
| Port 3000 already in use | `PORT=3001 npm start` |

Quick connection test without the dashboard:

```bash
curl http://localhost:3000/api/test-connection
```

## 📁 Project structure

```
CCtvmonitoring/
├── public/                    # Dashboard (served by Node)
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── docs/screenshot.png
├── stream-server.js           # Express + WebSocket server, FFmpeg pipeline, people tracking
├── people_detector.py         # OpenCV HOG detector worker (stdin/stdout JSON)
├── cctvmonitoring.php         # XAMPP entry point → forwards to the dashboard
├── rtsp-config.example.json   # Copy to rtsp-config.json (git-ignored)
├── requirements.txt           # Python dependencies
└── package.json
```

## 🔒 Security notes

- `rtsp-config.json` and `.env` are **git-ignored**. Never commit real camera credentials.
- The server only serves the `public/` folder, and `/api/status` masks credentials in the RTSP URL.
- The dashboard has **no authentication** and is meant for a trusted local network. Do not expose port 3000 to the internet without a reverse proxy with authentication (for example, Nginx with basic auth, or a VPN such as Tailscale).

## 📄 License

[ISC](LICENSE) © Charles Pura
