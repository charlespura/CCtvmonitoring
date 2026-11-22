/* Login page for password-protected dashboards. */
(() => {
    'use strict';
    const form = document.getElementById('login-form');
    const input = document.getElementById('password');
    const error = document.getElementById('login-error');
    const submit = document.getElementById('login-submit');
    const toggle = document.getElementById('toggle-password');

    // Already signed in, or no password configured? Go straight to the dashboard.
    fetch('api/session', { cache: 'no-store' })
        .then((r) => r.json())
        .then((s) => { if (!s.authEnabled || s.authenticated) location.replace('./'); })
        .catch(() => {});

    toggle.addEventListener('click', () => {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        toggle.setAttribute('aria-pressed', String(show));
        toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        input.focus();
    });

    function showError(message) {
        error.textContent = message;
        error.hidden = false;
        input.setAttribute('aria-invalid', 'true');
        input.select();
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!input.value) {
            showError('Enter the password.');
            return;
        }
        submit.disabled = true;
        submit.textContent = 'Signing in…';
        try {
            const res = await fetch('api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: input.value })
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.success) {
                location.replace('./');
                return;
            }
            showError(data.message || 'Sign in failed.');
        } catch {
            showError('Cannot reach the server. Is it running?');
        } finally {
            submit.disabled = false;
            submit.textContent = 'Sign in';
        }
    });
})();
