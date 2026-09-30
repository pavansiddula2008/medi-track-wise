# Med Track Wise

## Run locally

Requires Node.js 22.13 or newer.

```powershell
npm install
npm start
```

Open `http://localhost:3000`. The server creates `data/med-track-wise.sqlite` automatically. Do not open `index.html` directly for sign-in; authentication requires the local server.

## Account behavior

- Accounts use an email address or international phone number plus a password.
- Passwords are hashed with bcrypt and are not stored in browser storage.
- The first account creates a family and gets an invite code. Other accounts can join with that code; a family is limited to three members.
- Login sessions use HTTP-only, SameSite cookies and are stored server-side in SQLite.
- Medication schedules, photos, and health readings remain in each browser's local storage; they are not synchronized between devices.

## Deployment

Copy `.env.example` to `.env`, set a long random `SESSION_SECRET`, set `NODE_ENV=production`, and serve over HTTPS. Keep the SQLite `data/` directory private and backed up. Email and phone ownership are not verified, and the app does not send OTPs.