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
        method TEXT NOT NULL CHECK (method IN ('email', 'phone')),
        email TEXT UNIQUE,
        phone TEXT UNIQUE,
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
if (userColumns.includes("recovery_hash")) database.exec("ALTER TABLE users DROP COLUMN recovery_hash");

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
            const maxAge = Number(sessionData.cookie?.maxAge) || 7 * 24 * 60 * 60 * 1000;
            const expiresAt = sessionData.cookie?.expires
                ? new Date(sessionData.cookie.expires).getTime()
                : Date.now() + maxAge;
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
            const maxAge = Number(sessionData.cookie?.maxAge) || 7 * 24 * 60 * 60 * 1000;
            const expiresAt = sessionData.cookie?.expires
                ? new Date(sessionData.cookie.expires).getTime()
                : Date.now() + maxAge;
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
        sameSite: "strict",
        maxAge: 7 * 24 * 60 * 60 * 1000
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

function normalizePhone(value) {
    const digits = value.replace(/\D/g, "");
    return `${value.trim().startsWith("+") ? "+" : ""}${digits}`;
}

function normalizeIdentity(method, value) {
    return method === "email" ? value.trim().toLowerCase() : normalizePhone(value);
}

function validIdentity(method, value) {
    if (method === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    if (method === "phone") return /^\+?[1-9]\d{6,14}$/.test(value);
    return false;
}

function publicUser(row) {
    return {
        id: row.id,
        name: row.name,
        method: row.method,
        identity: row.method === "email" ? row.email : row.phone
    };
}

function publicFamily(user) {
    const family = database.prepare("SELECT id, invite_code FROM families WHERE id = ?").get(user.family_id);
    const members = database.prepare(`
        SELECT id, name, method, email, phone FROM users WHERE family_id = ? ORDER BY created_at, name
    `).all(user.family_id).map(publicUser);
    return { id: family.id, inviteCode: family.invite_code, members };
}

function sendAuthenticated(req, res, user, status = 200, extra = {}) {
    req.session.regenerate(error => {
        if (error) return res.status(500).json({ error: "Could not start a secure session." });
        req.session.userId = user.id;
        req.session.save(saveError => {
            if (saveError) return res.status(500).json({ error: "Could not save your session." });
            res.status(status).json({ user: publicUser(user), family: publicFamily(user), ...extra });
        });
    });
}

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.post("/api/auth/register", requireSameOrigin, authLimiter, async (req, res, next) => {
    try {
        const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
        const method = req.body.method;
        const rawIdentity = typeof req.body.identity === "string" ? req.body.identity : "";
        const identity = normalizeIdentity(method, rawIdentity);
        const password = typeof req.body.password === "string" ? req.body.password : "";
        const inviteCode = typeof req.body.familyCode === "string" ? req.body.familyCode.trim().toUpperCase() : "";

        if (name.length < 2 || name.length > 80) return res.status(400).json({ error: "Enter a name between 2 and 80 characters." });
        if (!validIdentity(method, identity)) return res.status(400).json({ error: method === "phone" ? "Enter a valid international phone number." : "Enter a valid email address." });
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
                INSERT INTO users (id, family_id, name, method, email, phone, password_hash, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(userId, family.id, name, method, method === "email" ? identity : null, method === "phone" ? identity : null, passwordHash, createdAt);
            user = database.prepare("SELECT * FROM users WHERE id = ?").get(userId);
            database.exec("COMMIT");
        } catch (error) {
            database.exec("ROLLBACK");
            throw error;
        }
        sendAuthenticated(req, res, user, 201);
    } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE" || /UNIQUE constraint failed/.test(error.message)) {
            return res.status(409).json({ error: "That email or phone number already has an account." });
        }
        if (error.status) return res.status(error.status).json({ error: error.message });
        next(error);
    }
});

app.post("/api/auth/login", requireSameOrigin, authLimiter, async (req, res, next) => {
    try {
        const method = req.body.method;
        const rawIdentity = typeof req.body.identity === "string" ? req.body.identity : "";
        const identity = normalizeIdentity(method, rawIdentity);
        const password = typeof req.body.password === "string" ? req.body.password : "";
        if (!validIdentity(method, identity) || !password) return res.status(400).json({ error: "Enter your registered email or phone and password." });

        const user = method === "email"
            ? database.prepare("SELECT * FROM users WHERE email = ?").get(identity)
            : database.prepare("SELECT * FROM users WHERE phone = ?").get(identity);
        const matches = user ? await bcrypt.compare(password, user.password_hash) : false;
        if (!matches) return res.status(401).json({ error: "Email/phone or password is incorrect." });
        sendAuthenticated(req, res, user);
    } catch (error) {
        next(error);
    }
});

app.post("/api/auth/reset-password", requireSameOrigin, authLimiter, async (req, res, next) => {
    try {
        const method = req.body.method;
        const rawIdentity = typeof req.body.identity === "string" ? req.body.identity : "";
        const identity = normalizeIdentity(method, rawIdentity);
        const recoveryCode = typeof req.body.recoveryCode === "string" ? req.body.recoveryCode.trim().toUpperCase() : "";
        const password = typeof req.body.password === "string" ? req.body.password : "";
        if (!validIdentity(method, identity) || !/^[A-F0-9]{24}$/.test(recoveryCode)) {
            return res.status(400).json({ error: "Enter the account contact and a valid recovery code." });
        }
        if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
            return res.status(400).json({ error: "Password must be at least 8 characters and no more than 72 bytes." });
        }

        const user = method === "email"
            ? database.prepare("SELECT * FROM users WHERE email = ?").get(identity)
            : database.prepare("SELECT * FROM users WHERE phone = ?").get(identity);
        const suppliedHash = hashRecoveryCode(recoveryCode);
        const storedHash = user?.recovery_hash ? Buffer.from(user.recovery_hash, "hex") : Buffer.alloc(suppliedHash.length);
        const validCode = user?.recovery_hash && storedHash.length === suppliedHash.length && crypto.timingSafeEqual(storedHash, suppliedHash);
        if (!validCode) return res.status(400).json({ error: "Contact or recovery code is incorrect." });

        const passwordHash = await bcrypt.hash(password, 12);
        const nextRecoveryCode = crypto.randomBytes(12).toString("hex").toUpperCase();
        const nextRecoveryHash = hashRecoveryCode(nextRecoveryCode).toString("hex");
        database.prepare("UPDATE users SET password_hash = ?, recovery_hash = ? WHERE id = ?").run(passwordHash, nextRecoveryHash, user.id);

        const sessions = database.prepare("SELECT sid, session_json FROM sessions").all();
        const removeSession = database.prepare("DELETE FROM sessions WHERE sid = ?");
        for (const record of sessions) {
            try {
                if (JSON.parse(record.session_json).userId === user.id) removeSession.run(record.sid);
            } catch {
                removeSession.run(record.sid);
            }
        }

        res.json({ status: "ok", recoveryCode: nextRecoveryCode });
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