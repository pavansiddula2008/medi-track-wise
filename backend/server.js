const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const bcrypt = require("bcryptjs");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
require("dotenv").config();

const app = express();
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(48).toString("hex");
const databasePath = path.resolve(process.env.MEDTRACK_DB_PATH || path.join(__dirname, "data", "med-track-wise.sqlite"));

if (isProduction && !process.env.SESSION_SECRET) {
    throw new Error("Set SESSION_SECRET before starting in production.");
}

fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const database = new DatabaseSync(databasePath);
database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
database.exec(`
    CREATE TABLE IF NOT EXISTS families (
        id TEXT PRIMARY KEY,
        invite_code TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS users_family_id_idx ON users(family_id);

    CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        session_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
`);

const userColumns = database.prepare("PRAGMA table_info(users)").all().map(column => column.name);
if (!userColumns.includes("username")) {
    database.exec(`
        CREATE TABLE users_new (
            id TEXT PRIMARY KEY,
            family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        INSERT INTO users_new (id, family_id, name, username, password_hash, created_at)
        SELECT id, family_id, name,
            lower(COALESCE(email, phone, replace(name, ' ', '.') || '.' || substr(id, 1, 6))),
            password_hash, created_at
        FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
        CREATE INDEX IF NOT EXISTS users_family_id_idx ON users(family_id);
    `);
} else if (userColumns.includes("recovery_hash")) {
    database.exec("ALTER TABLE users DROP COLUMN recovery_hash");
}

class SQLiteSessionStore extends session.Store {
    get(sessionId, callback) {
        try {
            const record = database.prepare("SELECT session_json, expires_at FROM sessions WHERE sid = ?").get(sessionId);
            if (!record) return callback(null, null);
            if (record.expires_at <= Date.now()) {
                database.prepare("DELETE FROM sessions WHERE sid = ?").run(sessionId);
                return callback(null, null);
            }
            callback(null, JSON.parse(record.session_json));
        } catch (error) {
            callback(error);
        }
    }

    set(sessionId, sessionData, callback = () => {}) {
        try {
            const expiresAt = sessionData.cookie?.expires
                ? new Date(sessionData.cookie.expires).getTime()
                : Date.now() + 24 * 60 * 60 * 1000;
            database.prepare(`
                INSERT INTO sessions (sid, session_json, expires_at) VALUES (?, ?, ?)
                ON CONFLICT(sid) DO UPDATE SET session_json = excluded.session_json, expires_at = excluded.expires_at
            `).run(sessionId, JSON.stringify(sessionData), expiresAt);
            callback(null);
        } catch (error) {
            callback(error);
        }
    }

    touch(sessionId, sessionData, callback = () => {}) {
        try {
            const expiresAt = sessionData.cookie?.expires
                ? new Date(sessionData.cookie.expires).getTime()
                : Date.now() + 24 * 60 * 60 * 1000;
            database.prepare("UPDATE sessions SET expires_at = ? WHERE sid = ?").run(expiresAt, sessionId);
            callback(null);
        } catch (error) {
            callback(error);
        }
    }

    destroy(sessionId, callback = () => {}) {
        try {
            database.prepare("DELETE FROM sessions WHERE sid = ?").run(sessionId);
            callback(null);
        } catch (error) {
            callback(error);
        }
    }
}

app.disable("x-powered-by");
if (isProduction) app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: "32kb" }));
app.use(session({
    name: "medtrack.sid",
    secret: sessionSecret,
    store: new SQLiteSessionStore(),
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: isProduction,
        sameSite: "strict"
    }
}));

function requireSameOrigin(req, res, next) {
    if (req.get("sec-fetch-site") === "cross-site") {
        return res.status(403).json({ error: "Cross-site requests are not allowed." });
    }

    const origin = req.get("origin");
    if (origin) {
        try {
            if (new URL(origin).host !== req.get("host")) {
                return res.status(403).json({ error: "Cross-origin requests are not allowed." });
            }
        } catch {
            return res.status(403).json({ error: "Invalid request origin." });
        }
    }

    next();
}

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 12,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many attempts. Please wait and try again." }
});

function normalizeUsername(value) {
    return value.trim().toLowerCase();
}

function validUsername(value) {
    return /^[a-z0-9][a-z0-9._@+-]{2,79}$/.test(value) ||
        /^\+?[1-9]\d{6,14}$/.test(value) ||
        (value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

function publicUser(row) {
    return {
        id: row.id,
        name: row.name,
        username: row.username
    };
}

function publicFamily(user) {
    const family = database.prepare("SELECT id, invite_code FROM families WHERE id = ?").get(user.family_id);
    const members = database.prepare(`
        SELECT id, name, username FROM users WHERE family_id = ? ORDER BY created_at, name
    `).all(user.family_id).map(publicUser);
    return { id: family.id, inviteCode: family.invite_code, members };
}

function sendAuthenticated(req, res, user, status = 200, rememberMe = false) {
    req.session.regenerate(error => {
        if (error) return res.status(500).json({ error: "Could not start a secure session." });
        req.session.userId = user.id;
        if (rememberMe) req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
        else req.session.cookie.expires = false;
        req.session.save(saveError => {
            if (saveError) return res.status(500).json({ error: "Could not save your session." });
            res.status(status).json({ user: publicUser(user), family: publicFamily(user) });
        });
    });
}

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.post("/api/auth/register", requireSameOrigin, authLimiter, async (req, res, next) => {
    try {
        const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
        const rawUsername = typeof req.body.username === "string" ? req.body.username : "";
        const username = normalizeUsername(rawUsername);
        const password = typeof req.body.password === "string" ? req.body.password : "";
        const inviteCode = typeof req.body.familyCode === "string" ? req.body.familyCode.trim().toUpperCase() : "";

        if (name.length < 2 || name.length > 80) return res.status(400).json({ error: "Enter a name between 2 and 80 characters." });
        if (!validUsername(username)) return res.status(400).json({ error: "Username must be 3 to 80 characters: letters, numbers, dot, underscore, dash, plus, or @." });
        if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) return res.status(400).json({ error: "Password must be at least 8 characters and no more than 72 bytes." });
        if (inviteCode && !/^[A-Z0-9]{6,16}$/.test(inviteCode)) return res.status(400).json({ error: "Family invite codes use 6 to 16 letters or numbers." });

        const passwordHash = await bcrypt.hash(password, 12);
        const userId = crypto.randomUUID();
        const createdAt = new Date().toISOString();
        let user;
        database.exec("BEGIN IMMEDIATE");
        try {
            let family;
            if (inviteCode) {
                family = database.prepare("SELECT id, invite_code FROM families WHERE invite_code = ?").get(inviteCode);
                if (!family) throw Object.assign(new Error("Family invite code not found."), { status: 400 });
            } else {
                family = { id: crypto.randomUUID(), invite_code: crypto.randomBytes(5).toString("hex").toUpperCase() };
                database.prepare("INSERT INTO families (id, invite_code, created_at) VALUES (?, ?, ?)").run(family.id, family.invite_code, createdAt);
            }

            const memberCount = database.prepare("SELECT COUNT(*) AS count FROM users WHERE family_id = ?").get(family.id).count;
            if (memberCount >= 3) throw Object.assign(new Error("This family already has three patient accounts."), { status: 409 });

            database.prepare(`
                INSERT INTO users (id, family_id, name, username, password_hash, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(userId, family.id, name, username, passwordHash, createdAt);
            user = database.prepare("SELECT * FROM users WHERE id = ?").get(userId);
            database.exec("COMMIT");
        } catch (error) {
            database.exec("ROLLBACK");
            throw error;
        }
        sendAuthenticated(req, res, user, 201, Boolean(req.body.rememberMe));
    } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE" || /UNIQUE constraint failed/.test(error.message)) {
            return res.status(409).json({ error: "That username is already in use." });
        }
        if (error.status) return res.status(error.status).json({ error: error.message });
        next(error);
    }
});

app.post("/api/auth/login", requireSameOrigin, authLimiter, async (req, res, next) => {
    try {
        const rawUsername = typeof req.body.username === "string" ? req.body.username : "";
        const username = normalizeUsername(rawUsername);
        const password = typeof req.body.password === "string" ? req.body.password : "";
        if (!validUsername(username) || !password) return res.status(400).json({ error: "Enter your username and password." });

        const user = database.prepare("SELECT * FROM users WHERE username = ?").get(username);
        const matches = user ? await bcrypt.compare(password, user.password_hash) : false;
        if (!matches) return res.status(401).json({ error: "Username or password is incorrect." });
        sendAuthenticated(req, res, user, 200, Boolean(req.body.rememberMe));
    } catch (error) {
        next(error);
    }
});

app.get("/api/auth/session", (req, res) => {
    if (!req.session.userId) return res.json({ authenticated: false });
    const user = database.prepare("SELECT * FROM users WHERE id = ?").get(req.session.userId);
    if (!user) {
        return req.session.destroy(() => res.status(401).json({ error: "Session expired." }));
    }
    res.json({ authenticated: true, user: publicUser(user), family: publicFamily(user) });
});

app.post("/api/auth/logout", requireSameOrigin, (req, res) => {
    req.session.destroy(error => {
        if (error) return res.status(500).json({ error: "Could not sign out." });
        res.clearCookie("medtrack.sid", { httpOnly: true, sameSite: "strict", secure: isProduction });
        res.json({ status: "ok" });
    });
});

app.use((req, res, next) => {
    const publicPaths = new Set(["/", "/index.html", "/style.css", "/script.js", "/manifest.webmanifest", "/service-worker.js"]);
    if (publicPaths.has(req.path)) return next();
    res.sendStatus(404);
});
app.use(express.static(__dirname, { dotfiles: "ignore", index: "index.html" }));

app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ error: "The server could not complete that request." });
});

database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
app.listen(port, () => {
    if (!process.env.SESSION_SECRET && !isProduction) console.warn("Using a temporary development session secret; sessions reset when the server restarts.");
    console.log(`Med Track Wise server running at http://localhost:${port}`);
});