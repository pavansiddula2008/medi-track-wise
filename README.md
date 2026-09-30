# Med Track Wise

## Run locally

Requires Node.js 22.13 or newer.

```powershell
npm install
npm start
```

Open `http://localhost:3000`. The tracker opens directly; no account or sign-in is required. The server creates `data/med-track-wise.sqlite` automatically.

## Data storage

- Patient profiles, medication schedules, photos, and health readings are saved in this browser's local storage.
- Data is not synchronized between devices. Use the app's export option to keep a backup.

## Deployment

Set `NODE_ENV=production`, configure a long random `SESSION_SECRET`, and serve over HTTPS. Keep the SQLite `data/` directory private and backed up.