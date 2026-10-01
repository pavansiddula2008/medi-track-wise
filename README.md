# Med Track Wise

## Run locally

Requires Node.js 22.13 or newer.

```powershell
npm install
npm start
```

Open `http://localhost:3000`. The tracker opens directly; no account or sign-in is required. The server creates `data/med-track-wise.sqlite` automatically.

## Gemini assistant

The assistant sends the question, recent chat, and current medicine schedule to Google Gemini after the user checks the consent box. Create a replacement API key in Google AI Studio, copy `.env.example` to `.env`, and set `GEMINI_API_KEY` there. The default model is `gemini-3.5-flash-lite`; change `GEMINI_MODEL` if needed. Never put the key in browser code or commit `.env`. Restart the server after changing environment variables.

Gemini replies can be inaccurate and are not medical advice. The assistant must not be used for diagnosis, dose changes, or emergencies.

## Data storage

- Patient profiles, medication schedules, photos, and health readings are saved in this browser's local storage.
- Data is not synchronized between devices. Use the app's export option to keep a backup.

## Deployment

Set `NODE_ENV=production`, configure a long random `SESSION_SECRET`, and serve over HTTPS. Keep the SQLite `data/` directory private and backed up.