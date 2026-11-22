<div align="center">

# 📹 CCTV Monitoring with People Counting

**Watch your Tapo (or any RTSP) security camera live in the browser and automatically count the people who walk in and out.**

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.8%2B-3776AB?logo=python&logoColor=white)
![OpenCV](https://img.shields.io/badge/OpenCV-4.x-5C3EE8?logo=opencv&logoColor=white)
![FFmpeg](https://img.shields.io/badge/FFmpeg-required-007808?logo=ffmpeg&logoColor=white)
![License](https://img.shields.io/badge/license-ISC-blue)

<img src="docs/screenshot.png" alt="CCTV Monitor dashboard showing a live camera view with enter and exit zones, people counters and an activity feed" width="100%">

<sub>Dashboard preview (synthetic demo frame)</sub>

</div>

---

## 📑 Contents

1. [What it does](#-what-it-does)
2. [What you need](#-what-you-need)
3. [Setup, step by step](#-setup-step-by-step)
4. [Using the dashboard](#-using-the-dashboard)
5. [Setting up the counting zones](#-setting-up-the-counting-zones)
6. [Capacity alerts, daily reset and notifications](#-capacity-alerts-daily-reset-and-notifications)
7. [Password protection](#-password-protection)
8. [Your data](#-your-data)
9. [Troubleshooting](#-troubleshooting)
10. [Configuration reference](#%EF%B8%8F-configuration-reference)
11. [API](#-api)
12. [How it works](#-how-it-works)
13. [Security](#-security)
14. [Project structure](#-project-structure)

---

## ✨ What it does

- 🎥 **Live video in any browser.** Works on a computer, phone or tablet, with no app or plugin.
- 👥 **People counting.** Counts people who cross the **ENTER** zone (aqua) or the **EXIT** zone (orange).
- 🖱️ **Visual zone editor.** Drag and resize the counting zones right on the video, and they apply instantly.
- 📊 **Traffic by hour.** A chart of people entering and leaving each hour, with the busiest hour, previous days and a table view.
- 🚨 **Capacity alerts.** Set a maximum number of people, and the dashboard shows a red alert (plus an optional sound or desktop notification) when it's exceeded.
- 🔐 **Optional password login**, so only people who know the password can watch the camera.
- 💾 **Nothing is lost on restart.** Counts, history, zones and settings are saved automatically.
- 🌙 **Daily auto-reset** at midnight (optional), and **CSV export** of the history for Excel or Google Sheets.
- 🕒 **Live activity feed** with In and Out filters.
- 📸 **Snapshots, fullscreen, dark and light themes**, and keyboard shortcuts.
- 🔁 **Auto-reconnect.** If the camera or Wi‑Fi drops, it recovers on its own.
- 💬 **Clear error messages.** For example, *"Camera rejected the login"* tells you exactly what to fix.
- ♿ **Colour-blind friendly.** Enter and exit use an aqua/orange pair that stays distinguishable for the most common types of colour blindness.

---

## 🧰 What you need

| | |
| --- | --- |
| **Camera** | A TP-Link **Tapo** camera (tested with the **TC70**), or any IP camera with an RTSP stream |
| **Computer** | macOS, Windows or Linux, on the **same Wi‑Fi/network** as the camera |
| **Software** | **Node.js 18+**, **Python 3.8+** and **FFmpeg**. Step 2 below shows how to install them |

---

## 🚀 Setup, step by step

> ⏱️ This takes about 10–15 minutes the first time.

### Step 1: Prepare your Tapo camera

Tapo cameras **block** third-party apps by default. Open the **Tapo app** on your phone:

1. **Turn on Third-Party Compatibility**
   Go to **Me** (bottom right) → **Tapo Lab** → **Third-Party Compatibility** and turn it **On**.
   > Without this, newer Tapo firmware keeps the RTSP port closed and you'll get *"Operation timed out"*.

2. **Create a Camera Account.** This is the username and password the dashboard uses.
   Tap your camera → ⚙️ **Settings** → **Advanced Settings** → **Camera Account**, then choose a username and password.
   > ⚠️ This is **not** your TP-Link/Tapo cloud login. It's a separate account just for the camera.

3. **Write down the camera's IP address**
   Tap your camera → ⚙️ **Settings** → **Device Info** → **IP Address** (for example `192.168.1.100`).

4. **Make sure Privacy Mode is off.** If it's on, the video will be blank.

> 💡 **Recommended:** In your router's settings, add a **DHCP reservation** (also called a *static lease*) for the camera, so its IP address never changes. If the IP changes, the dashboard will say *"Camera is unreachable"*.

### Step 2: Install the required software

<details open>
<summary><b>🍎 macOS</b> (using <a href="https://brew.sh">Homebrew</a>)</summary>

```bash
brew install node python ffmpeg
```
</details>

<details>
<summary><b>🪟 Windows</b> (PowerShell)</summary>

```powershell
winget install OpenJS.NodeJS.LTS
winget install Python.Python.3.12
winget install Gyan.FFmpeg
```
Close and reopen PowerShell afterwards so the new commands are found.
</details>

<details>
<summary><b>🐧 Linux</b> (Debian / Ubuntu)</summary>

```bash
sudo apt update
sudo apt install nodejs npm python3 python3-pip ffmpeg
```
</details>

Check that everything is installed. Each command should print a version number:

```bash
node -v        # v18 or newer
python3 --version   # Windows: python --version
ffmpeg -version
```

### Step 3: Download this project

```bash
git clone https://github.com/charlespura/CCtvmonitoring.git
cd CCtvmonitoring
```

No git? Click **Code → Download ZIP** on GitHub, unzip it, and open a terminal in that folder.

### Step 4: Install the project's dependencies

```bash
npm install
pip3 install -r requirements.txt     # Windows: pip install -r requirements.txt
```

### Step 5: Add your camera details

Make your own config file from the example:

```bash
cp rtsp-config.example.json rtsp-config.json      # Windows: copy rtsp-config.example.json rtsp-config.json
```

Open **`rtsp-config.json`** in any text editor and fill in your values from Step 1:

```json
{
  "camera_name": "Tapo TC70",
  "camera_ip": "192.168.1.100",
  "rtsp_port": 554,
  "rtsp_username": "your-camera-account-username",
  "rtsp_password": "your-camera-account-password",
  "stream_quality": "stream1",
  "dashboard_password": ""
}
```

- `stream1` = high quality (1080p); `stream2` = low quality (360p). Use `stream2` if your computer is slow.
- Type the password exactly as you set it. Special characters like `@` or `#` are fine, because the app handles them.
- `dashboard_password` is optional. Set it to require a login before anyone can view the dashboard (see [Password protection](#-password-protection)). Leave it `""` for no login.

> 🔒 `rtsp-config.json` is listed in `.gitignore`, so your password **stays on your computer** and is never uploaded to GitHub.

### Step 6: Test the camera connection (optional, but recommended)

**a) Is the camera reachable, and is RTSP turned on?** (use your camera's IP)

```bash
# macOS / Linux
nc -z -G 3 192.168.1.100 554 && echo "✅ RTSP is open" || echo "❌ RTSP is closed"
```
```powershell
# Windows
Test-NetConnection 192.168.1.100 -Port 554     # look for: TcpTestSucceeded : True
```

If it's closed, repeat **Step 1** (Third-Party Compatibility + Camera Account) and check the IP.

**b) Do the username and password work?**

```bash
ffprobe -v error -rtsp_transport tcp "rtsp://USERNAME:PASSWORD@192.168.1.100:554/stream1"
```

No output means it worked ✅. If you get `401 Unauthorized`, the username or password is wrong.
> In this test command only, write special characters in the password as codes: `@` → `%40`, `#` → `%23`, `:` → `%3A`.

### Step 7: Start the server

```bash
npm start
```

You should see:

```
🚀 CCTV Monitor running
📍 Dashboard:  http://localhost:3000
🎥 Source:     rtsp://****:****@192.168.1.100:554/stream1
🔐 Login:      off (set dashboard_password to enable)
💾 Data:       /path/to/CCtvmonitoring/data
```

Keep this terminal window open while you use the dashboard. To stop the server, press **Ctrl + C**.

> ✏️ The server reads `rtsp-config.json` only at startup. After editing it, stop the server (**Ctrl + C**) and run `npm start` again.

### Step 8: Open the dashboard

| From… | Open this address |
| --- | --- |
| The same computer | **http://localhost:3000** |
| A phone or tablet on the same Wi‑Fi | `http://<your-computer-ip>:3000` |
| XAMPP (if the project is in `htdocs`) | `http://localhost/<folder>/cctvmonitoring.php`. It forwards you to the dashboard |

To find your computer's IP address:
macOS: `ipconfig getifaddr en0` · Windows: `ipconfig` (look for *IPv4 Address*) · Linux: `hostname -I`

After a few seconds the status badge at the top turns green and shows **● Live**. 🎉

### Step 9: Set your counting zones

Click **Zones** (or press <kbd>Z</kbd>) and drag the boxes over your doorway. See [Setting up the counting zones](#-setting-up-the-counting-zones).

> 💡 **No camera yet?** You can try everything with any video file: `RTSP_URL=/path/to/video.mp4 npm start`. The video plays on a loop.

---

## 🖥️ Using the dashboard

| Area | What it shows |
| --- | --- |
| **Currently inside** | People who entered minus people who exited. With a capacity limit set, it also shows a progress bar like *3 of 25 max* |
| **Entered / Exited** | Totals since the last reset |
| **In view now** | People detected in the current frame, plus the frames processed per second |
| **Live view** | Camera video with the ENTER zone (aqua), EXIT zone (orange) and a box around each detected person |
| **Traffic by hour** | Entered (bars going **up**) and exited (bars going **down**) for each hour of the day. Hover over a bar for exact numbers, use **‹ ›** to see previous days, or switch to **Table** |
| **Activity** | Every enter and exit with its time. Filter with **All / In / Out**; **⬇** downloads everything as CSV |
| **Camera** | Model, IP, stream quality, number of viewers, server uptime |

**Buttons and keyboard shortcuts**

| Button | Key | What it does |
| --- | :---: | --- |
| 📷 Snapshot | <kbd>S</kbd> | Saves the current frame as a PNG |
| ⛶ Fullscreen | <kbd>F</kbd> | Shows the video in fullscreen |
| ▭▭ Zones | <kbd>Z</kbd> | Opens the zone editor |
| ☰ Legend | <kbd>L</kbd> | Shows or hides the zone legend |
| 🔄 Reconnect | <kbd>R</kbd> | Reconnects to the stream |
| 🌗 Theme | <kbd>T</kbd> | Switches between dark and light mode |
| ⚙️ Settings | <kbd>,</kbd> | Capacity limit, daily reset, sound, notifications |
| ↺ Reset counts | | Sets the counters to zero (asks for confirmation first). Hourly statistics are kept |

**Status badge:** 🟢 **Live** = working · 🔵 **Connecting / Waiting for video** = starting up · 🟡 **No signal / Stalled** = the camera has a problem (the message on the video tells you what) · 🔴 **Offline** = the server isn't running.

---

## 🎯 Setting up the counting zones

A person is counted when they **move into** a zone:

- Moving into the **ENTER** zone (aqua) counts as **+1 entered**
- Moving into the **EXIT** zone (orange) counts as **+1 exited**

By default, the left half of the picture is ENTER and the right half is EXIT. Every camera view is different, so adjust the zones to match how people walk through your doorway.

**To edit the zones:**

1. Click **Zones** under the video (or press <kbd>Z</kbd>).
2. **Drag a box** to move it. **Drag a corner** to resize it.
   With the keyboard: <kbd>Tab</kbd> selects a box, the arrow keys move it, and <kbd>Shift</kbd> + arrows resize it.
3. **Swap** exchanges ENTER and EXIT, which is useful if the counts come out reversed. **Defaults** restores the original layout.
4. Click **Save zones**. Counting uses the new zones immediately, and they are remembered after a restart.

**Tips for accurate counting**
- Mount the camera so people are seen **full-body** (head to feet), from a moderate height.
- Good, even lighting improves detection a lot.
- Place the two zones so people **cross from one into the other** as they walk through the door.
- If *Entered* goes up when people leave, click **Swap**.

---

## 🚨 Capacity alerts, daily reset and notifications

Open **⚙️ Settings** (top right, or press <kbd>,</kbd>).

**For everyone** (saved on the server and shared by every viewer):

| Setting | What it does |
| --- | --- |
| **Capacity limit** | The maximum number of people allowed inside. As the count approaches the limit, the meter turns amber at 80%. When the limit is exceeded, a red **Over capacity** banner appears for every viewer. Leave it empty to turn it off. |
| **Reset counters every night at midnight** | Entered, exited and occupancy start from zero each day. The hourly chart history is kept. |

**This browser only** (each person chooses for themselves):

| Setting | What it does |
| --- | --- |
| **Play a sound** | A short chime when someone enters (rising) or exits (falling), and a triple beep for capacity alerts |
| **Desktop notifications** | A system notification for capacity alerts, and for enters/exits while the tab is in the background. Your browser asks for permission the first time |

---

## 🔐 Password protection

By default, anyone on your network who opens the dashboard can watch the camera. To require a password, add it to `rtsp-config.json`:

```json
"dashboard_password": "choose-a-strong-password"
```

Restart the server (`npm start`). Everyone then sees a **sign-in page** first.

- A sign-in lasts 30 days on that device. **Sign out** with the ⎋ button in the top right.
- Changing the password signs everyone out.
- After 10 wrong passwords, that device is blocked for 15 minutes, which stops password guessing.
- This password is separate from your camera's password, and it stays on your computer because `rtsp-config.json` is git-ignored.

---

## 💾 Your data

Everything the dashboard remembers is saved in the **`data/`** folder next to the project:

| File | Contains |
| --- | --- |
| `data/state.json` | Counts, the last 5,000 events, hourly statistics (about 2 months), zones and shared settings |
| `data/session-secret` | Random key used to sign logins (do not share it) |

- The data is saved automatically, so it survives restarts and crashes.
- **Back up:** copy the `data/` folder. **Start fresh:** stop the server and delete `data/`.
- **Export:** the **⬇** button in Activity downloads `cctv-history-YYYY-MM-DD.csv`, which opens in Excel or Google Sheets.
- `data/` is git-ignored, so it is never uploaded to GitHub.

---

## 🛠️ Troubleshooting

| What you see | What to do |
| --- | --- |
| **"Camera is unreachable"** / `Operation timed out` in the terminal | 1. Check the camera's IP in the Tapo app (**Device Info**). It may have changed, so update `camera_ip`. 2. Turn on **Tapo Lab → Third-Party Compatibility**. 3. Make sure the computer and camera are on the same Wi‑Fi. 4. Run the test in [Step 6](#step-6-test-the-camera-connection-optional-but-recommended). |
| **"Camera rejected the login"** / `401 Unauthorized` | Use the **Camera Account** username and password (Step 1.2), not your TP-Link login. Restart the server after editing the config. |
| **"FFmpeg is not installed"** | Install FFmpeg (Step 2) and check that `ffmpeg -version` works. |
| Video is black or blank | Turn off **Privacy Mode** in the Tapo app. |
| **"Can't reach the stream server"** in the browser | The server isn't running. Run `npm start` and keep the terminal open. |
| Video works but nobody is counted | [Set up the zones](#-setting-up-the-counting-zones) with the **Zones** button. Make sure people are visible full-body. |
| Entered and Exited are reversed | Open **Zones**, click **Swap**, then **Save zones**. |
| Forgot the dashboard password | Change `dashboard_password` in `rtsp-config.json` and restart the server. |
| "Too many attempts" on the sign-in page | Wait 15 minutes, or restart the server. |
| Desktop notifications don't appear | Allow notifications for the site in your browser's settings (and in macOS/Windows notification settings). |
| `ModuleNotFoundError: No module named 'cv2'` | Run `pip3 install -r requirements.txt`. If you have several Pythons, start with `PYTHON_BIN=/path/to/python3 npm start`. |
| Windows: Python not found | Start with `$env:PYTHON_BIN="python"; npm start` in PowerShell. |
| `EADDRINUSE` / port 3000 already in use | Another program is using the port. Start on a different one: `PORT=3001 npm start` (Windows: `$env:PORT=3001; npm start`). |
| Video is laggy or the CPU is high | Set `"stream_quality": "stream2"` in `rtsp-config.json`. |
| Phone can't open the dashboard | Use the computer's IP rather than `localhost`, and allow Node.js through the computer's firewall. |

Check the camera connection from the command line:

```bash
curl http://localhost:3000/api/test-connection
```

---

## ⚙️ Configuration reference

### `rtsp-config.json`

| Key | Default | Description |
| --- | --- | --- |
| `camera_ip` | — | Camera's IP address on your network |
| `rtsp_port` | `554` | RTSP port |
| `rtsp_username` | — | Tapo **Camera Account** username |
| `rtsp_password` | — | Tapo **Camera Account** password |
| `stream_quality` | `stream1` | `stream1` = 1080p, `stream2` = 360p |
| `camera_name` | `Tapo TC70` | Name shown on the dashboard |
| `rtsp_transport` | `tcp` | `tcp` (most reliable) or `udp` |
| `dashboard_password` | `""` (off) | Password required to open the dashboard |

### Environment variables (optional)

These override `rtsp-config.json`. They are handy for services and Docker.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Port for the dashboard, API and WebSocket |
| `BIND_ADDRESS` | `0.0.0.0` | `127.0.0.1` = only this computer can open the dashboard; `0.0.0.0` = devices on your network can too |
| `RTSP_URL` | — | Full RTSP URL; overrides every camera setting. Can also be a **video file** for testing |
| `DASHBOARD_PASSWORD` | — | Same as `dashboard_password` |
| `DATA_DIR` | `./data` | Folder where counts, history, zones and settings are saved |
| `RTSP_HOST`, `RTSP_PORT`, `RTSP_USERNAME`, `RTSP_PASSWORD`, `RTSP_PATH` | — | Individual camera settings |
| `RTSP_TRANSPORT` | `tcp` | `tcp` or `udp` |
| `CAMERA_NAME` | `Tapo TC70` | Name shown on the dashboard |
| `STREAM_SCALE_WIDTH` | `640` | Width that frames are resized to before detection |
| `PYTHON_BIN` | `python3` | Python command to use (for example `python` on Windows, or a virtualenv path) |
| `ALLOWED_HOSTS` | — | Extra hostnames allowed to open the dashboard, comma-separated (for example `cctv.myhome.lan`) |
| `ALLOWED_ORIGINS` | — | Extra websites allowed to call the API, comma-separated (for example `http://localhost`) |

Example:

```bash
PORT=8080 CAMERA_NAME="Front Door" npm start
```

---

## 🔌 API

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/status` | Stream health, camera info (password hidden), counts, uptime |
| `GET` | `/api/counts` | `{ current, enter, exit, tracked, timestamp }` |
| `GET` | `/api/history?limit=50` | Recent enter and exit events (up to 5,000) |
| `GET` | `/api/history.csv` | All saved events as a CSV download |
| `GET` | `/api/stats?date=YYYY-MM-DD` | Hourly enter/exit counts, totals and busiest hour for a day (default: today) |
| `POST` | `/api/reset-counts` | Resets counters and the activity feed for every viewer (hourly stats are kept) |
| `GET` | `/api/zones` | Current and default ENTER/EXIT zones |
| `POST` | `/api/calibrate-zones` | Saves new zones: `{ "enter": {x1,y1,x2,y2}, "exit": {x1,y1,x2,y2} }` |
| `GET` / `POST` | `/api/settings` | Shared settings: `{ "capacity": 25, "dailyReset": true }` |
| `GET` | `/api/test-connection` | Tries to open the camera stream for 2 seconds |
| `GET` | `/api/session` | `{ authEnabled, authenticated }` |
| `POST` | `/api/login` / `/api/logout` | Sign in with `{ "password": "…" }` / sign out |

When a dashboard password is set, every endpoint except `session` and `login` requires the sign-in cookie. From the command line:

```bash
curl -c cookies.txt -H "Content-Type: application/json" -d '{"password":"your-password"}' http://localhost:3000/api/login
curl -b cookies.txt http://localhost:3000/api/stats
```

The server sends these **WebSocket** messages on `ws://<host>:3000`: `frame`, `counts`, `history`, `event`, `settings`, `zones`, `ffmpeg_error`, `pong`.

---

## 🧠 How it works

```mermaid
flowchart LR
    CAM["📷 Tapo camera<br/>(RTSP)"] -->|H.264 video| FF["FFmpeg<br/>2 fps · 640px JPEG"]
    FF -->|JPEG frames| NODE["Node.js<br/>stream-server.js"]
    NODE -->|"frame + zones"| PY["Python + OpenCV<br/>people_detector.py"]
    PY -->|"annotated frame + people"| NODE
    NODE -->|WebSocket| UI["🖥️ Browser dashboard"]
```

1. **FFmpeg** connects to the camera and outputs 2 small JPEG frames per second.
2. **Node.js** sends each frame to the **Python** detector.
3. **OpenCV** finds the people in the frame and draws the zones and boxes.
4. **Node.js** follows each person across frames. When someone moves into a zone, it counts them, saves the event to `data/state.json` and pushes the update to every open dashboard instantly.

The camera pipeline only runs while at least one dashboard is open, which saves CPU and network.

---

## 🔒 Security

**Safe to publish:** this repository contains **no passwords or personal camera details**. Your credentials live only in `rtsp-config.json`, and your counts, history and login key live only in `data/`. Git ignores both.

The server is built for a **home or office network**:

- ✅ Camera passwords are never sent to the browser and are hidden (`****`) in logs and error messages.
- ✅ Only the `public/` folder is served, so config and data files cannot be downloaded.
- ✅ Other websites open in your browser **cannot** connect to the dashboard or watch your camera. Cross-site requests and DNS-rebinding attempts are blocked.
- ✅ **Optional password login** ([how to enable](#-password-protection)). Sessions are HttpOnly, SameSite=Strict signed cookies, and repeated wrong passwords are rate-limited.
- ⚠️ **Without** a dashboard password, anyone on the **same Wi‑Fi** who knows your computer's IP can view the dashboard. Set `dashboard_password`, or keep it on this computer only with `BIND_ADDRESS=127.0.0.1 npm start`.
- ❌ **Do not** open port 3000 to the internet with router port forwarding, even with a password, because the connection is plain HTTP. For remote viewing, use a VPN such as [Tailscale](https://tailscale.com), which works out of the box, or an HTTPS reverse proxy.

**Before you commit:** run `git status` and make sure `rtsp-config.json` and `data/` are **not** listed.

---

## 📁 Project structure

```
CCtvmonitoring/
├── public/                    # The dashboard (HTML, CSS, JS)
│   ├── index.html             # Dashboard page
│   ├── login.html             # Sign-in page (used when a password is set)
│   ├── css/style.css
│   └── js/
│       ├── app.js             # Dashboard logic (stream, counters, settings, alerts)
│       ├── chart.js           # Traffic-by-hour chart
│       ├── zone-editor.js     # Drag-and-drop zone editor
│       └── login.js
├── lib/
│   ├── store.js               # Saves counts, history, hourly stats, zones, settings
│   └── auth.js                # Optional password login
├── data/                      # Created automatically: your saved data (git-ignored)
├── stream-server.js           # Web server, camera pipeline, people tracking, API
├── people_detector.py         # OpenCV person detector (run by the server)
├── cctvmonitoring.php         # Optional XAMPP entry page → forwards to the dashboard
├── rtsp-config.example.json   # Template: copy to rtsp-config.json (git-ignored)
├── requirements.txt           # Python packages
├── package.json               # Node.js packages and scripts
└── docs/screenshot.png
```

---

## 📄 License

[ISC](LICENSE) © Charles Pura
