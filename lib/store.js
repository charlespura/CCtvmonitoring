/**
 * Persistent state: counters, event history, hourly statistics, zones and
 * shared settings. Saved as JSON in DATA_DIR (git-ignored) so nothing is lost
 * when the server restarts.
 */
const fs = require('fs');
const path = require('path');

const HISTORY_LIMIT = 5000;   // events kept for the activity feed / CSV export
const DAYS_KEPT = 62;         // days of hourly statistics kept

const pad = (n) => String(n).padStart(2, '0');

/** Local calendar date, e.g. "2026-11-22". */
function dateKey(d = new Date()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function emptyDay() {
    return Array.from({ length: 24 }, () => [0, 0]); // [enter, exit] per hour
}

const DEFAULT_SETTINGS = {
    capacity: null,      // max people inside before an alert; null = off
    dailyReset: false    // reset counters at local midnight
};

class Store {
    constructor(dataDir) {
        this.file = path.join(dataDir, 'state.json');
        fs.mkdirSync(dataDir, { recursive: true });
        this.state = {
            version: 1,
            counts: { enter: 0, exit: 0 },
            history: [],
            hourly: {},
            zones: null,
            settings: { ...DEFAULT_SETTINGS },
            lastResetDate: dateKey()
        };
        this.saveTimer = null;
        this.load();
    }

    load() {
        try {
            const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            this.state = {
                ...this.state,
                ...saved,
                counts: { ...this.state.counts, ...saved.counts },
                settings: { ...DEFAULT_SETTINGS, ...saved.settings },
                history: Array.isArray(saved.history) ? saved.history.slice(-HISTORY_LIMIT) : [],
                hourly: saved.hourly && typeof saved.hourly === 'object' ? saved.hourly : {}
            };
            console.log(`💾 Loaded saved data (${this.state.history.length} events)`);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.warn(`⚠️  Could not read ${this.file}, starting fresh:`, err.message);
            }
        }
    }

    /** Debounced save — many events in a burst cause a single write. */
    save() {
        if (this.saveTimer) return;
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            this.saveNow();
        }, 1000);
    }

    saveNow() {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        try {
            const tmp = `${this.file}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify(this.state));
            fs.renameSync(tmp, this.file); // atomic replace: never leaves a half-written file
        } catch (err) {
            console.error('❌ Failed to save data:', err.message);
        }
    }

    get counts() {
        return this.state.counts;
    }

    get settings() {
        return this.state.settings;
    }

    get zones() {
        return this.state.zones;
    }

    recentHistory(limit) {
        return this.state.history.slice(-limit);
    }

    recordEvent(type, date = new Date()) {
        if (type === 'ENTER') this.state.counts.enter++;
        if (type === 'EXIT') this.state.counts.exit++;

        const event = { type, time: date.toISOString() };
        this.state.history.push(event);
        if (this.state.history.length > HISTORY_LIMIT) {
            this.state.history = this.state.history.slice(-HISTORY_LIMIT);
        }

        const key = dateKey(date);
        const day = this.state.hourly[key] || (this.state.hourly[key] = emptyDay());
        day[date.getHours()][type === 'ENTER' ? 0 : 1]++;
        this.pruneDays();

        this.save();
        return event;
    }

    pruneDays() {
        const keys = Object.keys(this.state.hourly).sort();
        while (keys.length > DAYS_KEPT) {
            delete this.state.hourly[keys.shift()];
        }
    }

    /** Clears counters and the activity feed. Hourly statistics are kept. */
    resetCounts() {
        this.state.counts = { enter: 0, exit: 0 };
        this.state.history = [];
        this.state.lastResetDate = dateKey();
        this.save();
    }

    /** Called periodically; returns true if a midnight reset happened. */
    checkDailyReset() {
        const today = dateKey();
        if (this.state.lastResetDate === today) return false;
        this.state.lastResetDate = today;
        if (this.state.settings.dailyReset) {
            this.state.counts = { enter: 0, exit: 0 };
            this.save();
            return true;
        }
        this.save();
        return false;
    }

    setZones(zones) {
        this.state.zones = zones;
        this.saveNow();
    }

    updateSettings(patch) {
        this.state.settings = { ...this.state.settings, ...patch };
        this.saveNow();
        return this.state.settings;
    }

    /** Hourly enter/exit numbers for one day, plus totals and the busiest hour. */
    stats(key = dateKey()) {
        const day = this.state.hourly[key] || emptyDay();
        const hours = day.map(([enter, exit], hour) => ({ hour, enter, exit }));
        const totals = hours.reduce((t, h) => ({ enter: t.enter + h.enter, exit: t.exit + h.exit }), { enter: 0, exit: 0 });
        const busiest = hours.reduce((best, h) => (h.enter + h.exit > best.enter + best.exit ? h : best), hours[0]);
        return {
            date: key,
            isToday: key === dateKey(),
            hours,
            totals,
            peak: busiest.enter + busiest.exit > 0 ? { hour: busiest.hour, count: busiest.enter + busiest.exit } : null,
            days: Object.keys(this.state.hourly).sort()
        };
    }

    historyCsv() {
        const rows = ['time_utc,local_date,local_time,event'];
        for (const e of this.state.history) {
            const d = new Date(e.time);
            rows.push(`${e.time},${dateKey(d)},${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())},${e.type}`);
        }
        return rows.join('\n') + '\n';
    }
}

module.exports = { Store, dateKey };
