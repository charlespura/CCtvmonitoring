/**
 * Optional password protection for the dashboard.
 *
 * Enabled when a dashboard password is configured (DASHBOARD_PASSWORD or
 * "dashboard_password" in rtsp-config.json). Sessions are stateless signed
 * cookies, so they survive server restarts; changing the password logs
 * everyone out.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const COOKIE = 'cctv_session';
const SESSION_DAYS = 30;
const MAX_ATTEMPTS = 10;               // failed logins per IP…
const ATTEMPT_WINDOW_MS = 15 * 60e3;   // …per 15 minutes

// Pages and files the login screen needs before you are signed in
const PUBLIC_PATHS = new Set(['/login.html', '/css/style.css', '/js/login.js', '/api/login', '/api/session']);

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();

function loadSecret(dataDir) {
    const file = path.join(dataDir, 'session-secret');
    try {
        const secret = fs.readFileSync(file, 'utf8').trim();
        if (secret.length >= 32) return secret;
    } catch { /* create below */ }
    const secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
}

function parseCookies(header = '') {
    const out = {};
    header.split(';').forEach((part) => {
        const i = part.indexOf('=');
        if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    });
    return out;
}

function createAuth({ password, dataDir }) {
    const enabled = Boolean(password);
    // Key depends on the password, so changing it invalidates old sessions
    const key = enabled ? crypto.createHmac('sha256', loadSecret(dataDir)).update(password).digest() : null;
    const attempts = new Map();

    const sign = (value) => crypto.createHmac('sha256', key).update(value).digest('base64url');

    function issueToken() {
        const expires = Date.now() + SESSION_DAYS * 86400e3;
        return `${expires}.${sign(String(expires))}`;
    }

    function verifyToken(token) {
        if (!token || typeof token !== 'string') return false;
        const [expires, signature] = token.split('.');
        if (!expires || !signature || Number(expires) < Date.now()) return false;
        const expected = Buffer.from(sign(expires));
        const given = Buffer.from(signature);
        return given.length === expected.length && crypto.timingSafeEqual(given, expected);
    }

    function isAuthenticated(req) {
        return !enabled || verifyToken(parseCookies(req.headers.cookie)[COOKIE]);
    }

    function checkPassword(input) {
        return crypto.timingSafeEqual(sha256(input), sha256(password));
    }

    function rateLimited(ip) {
        const now = Date.now();
        const entry = attempts.get(ip);
        if (!entry || entry.resetAt < now) return false;
        return entry.count >= MAX_ATTEMPTS;
    }

    function recordFailure(ip) {
        const now = Date.now();
        const entry = attempts.get(ip);
        if (!entry || entry.resetAt < now) {
            attempts.set(ip, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
        } else {
            entry.count++;
        }
    }

    function cookie(req, value, maxAgeSeconds) {
        const secure = req.secure ? '; Secure' : '';
        return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`;
    }

    /** Express middleware: lets public paths through, otherwise requires a session. */
    function middleware(req, res, next) {
        if (!enabled || PUBLIC_PATHS.has(req.path) || isAuthenticated(req)) return next();
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ success: false, message: 'Login required' });
        }
        if (req.method === 'GET' && (req.path === '/' || req.path.endsWith('.html'))) {
            return res.redirect(302, '/login.html');
        }
        return res.status(401).type('text').send('Login required');
    }

    function register(app) {
        app.get('/api/session', (req, res) => {
            res.json({ authEnabled: enabled, authenticated: isAuthenticated(req) });
        });

        app.post('/api/login', (req, res) => {
            if (!enabled) return res.json({ success: true });
            const ip = req.socket.remoteAddress;
            if (rateLimited(ip)) {
                return res.status(429).json({ success: false, message: 'Too many attempts. Try again in 15 minutes.' });
            }
            const input = req.body && typeof req.body.password === 'string' ? req.body.password : '';
            if (!input || !checkPassword(input)) {
                recordFailure(ip);
                return res.status(401).json({ success: false, message: 'Incorrect password' });
            }
            attempts.delete(ip);
            res.set('Set-Cookie', cookie(req, issueToken(), SESSION_DAYS * 86400));
            res.json({ success: true });
        });

        app.post('/api/logout', (req, res) => {
            res.set('Set-Cookie', cookie(req, '', 0));
            res.json({ success: true });
        });
    }

    return { enabled, isAuthenticated, middleware, register };
}

module.exports = { createAuth };
