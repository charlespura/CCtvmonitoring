<?php
/**
 * XAMPP / Apache entry point.
 *
 * The dashboard itself (public/index.html) is served by the Node stream server
 * so that video, WebSocket and API all share one origin. This page simply
 * forwards you there, or explains how to start the server if it isn't running.
 */

$port = (int) (getenv('CCTV_PORT') ?: 3000);

// Hostname the browser used to reach Apache, without its port. Validated so the
// redirect can only point at a plain hostname / IPv4 address.
$requestHost = preg_replace('/:\d+$/', '', $_SERVER['HTTP_HOST'] ?? 'localhost');
if (!preg_match('/^[a-zA-Z0-9.-]+$/', $requestHost)) {
    $requestHost = 'localhost';
}
$dashboardUrl = "http://{$requestHost}:{$port}/";

$socket = @fsockopen('127.0.0.1', $port, $errno, $errstr, 0.5);
if ($socket) {
    fclose($socket);
    header('Location: ' . $dashboardUrl, true, 302);
    exit;
}

$hasConfig = file_exists(__DIR__ . '/rtsp-config.json');
$hasModules = is_dir(__DIR__ . '/node_modules');
$e = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="dark light">
    <title>CCTV Monitor · Server offline</title>
    <style>
        :root { --bg:#0a0e14; --surface:#111722; --border:#232e40; --text:#e6ecf4; --muted:#8b98ab; --accent:#4f8cff; --green:#22c55e; --amber:#fbbf24; --code:#0d121b; }
        @media (prefers-color-scheme: light) { :root { --bg:#f3f5f9; --surface:#fff; --border:#e3e8f0; --text:#0f172a; --muted:#5b6678; --accent:#2563eb; --green:#16a34a; --amber:#d97706; --code:#f5f7fb; } }
        * { box-sizing: border-box; }
        body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px 16px; background:var(--bg); color:var(--text); font:14px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
        .card { width:100%; max-width:560px; background:var(--surface); border:1px solid var(--border); border-radius:16px; padding:28px; box-shadow:0 8px 24px rgba(0,0,0,.2); }
        .badge { display:inline-flex; align-items:center; gap:8px; padding:5px 12px; border-radius:999px; font-size:12.5px; font-weight:600; color:var(--amber); background:color-mix(in srgb, var(--amber) 13%, transparent); }
        .badge::before { content:""; width:8px; height:8px; border-radius:50%; background:currentColor; }
        h1 { font-size:20px; margin:14px 0 6px; }
        p { color:var(--muted); margin:0 0 18px; }
        ol { margin:0; padding:0; list-style:none; counter-reset:s; display:flex; flex-direction:column; gap:14px; }
        li { counter-increment:s; display:grid; grid-template-columns:28px 1fr; gap:12px; }
        li::before { content:counter(s); display:grid; place-items:center; width:26px; height:26px; border-radius:50%; border:1px solid var(--border); font-weight:700; font-size:12px; color:var(--muted); }
        li.done::before { content:"✓"; color:var(--green); border-color:var(--green); }
        li > div { min-width:0; }
        code { display:block; margin-top:6px; padding:8px 12px; border-radius:8px; background:var(--code); border:1px solid var(--border); font:12.5px ui-monospace, "SF Mono", Menlo, monospace; overflow-x:auto; white-space:nowrap; }
        .actions { display:flex; gap:10px; margin-top:24px; flex-wrap:wrap; }
        a.btn { display:inline-flex; align-items:center; height:38px; padding:0 16px; border-radius:9px; font-weight:600; text-decoration:none; color:#fff; background:var(--accent); }
        a.btn.ghost { color:var(--text); background:transparent; border:1px solid var(--border); }
    </style>
</head>
<body>
    <main class="card">
        <span class="badge">Stream server not running</span>
        <h1>Start the CCTV stream server</h1>
        <p>The live dashboard runs on Node.js at port <?= $e($port) ?>. Open a terminal in this folder and finish these steps — this page will forward you automatically once it's up.</p>
        <ol>
            <li class="<?= $hasModules ? 'done' : '' ?>"><div>Install dependencies<code>npm install &amp;&amp; pip3 install -r requirements.txt</code></div></li>
            <li class="<?= $hasConfig ? 'done' : '' ?>"><div>Add your camera credentials<code>cp rtsp-config.example.json rtsp-config.json</code></div></li>
            <li><div>Start the server<code>npm start</code></div></li>
        </ol>
        <div class="actions">
            <a class="btn" href="">Check again</a>
            <a class="btn ghost" href="<?= $e($dashboardUrl) ?>">Open dashboard</a>
        </div>
    </main>
    <script>setTimeout(() => location.reload(), 5000);</script>
</body>
</html>
