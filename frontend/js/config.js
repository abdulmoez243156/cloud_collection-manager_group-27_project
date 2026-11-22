// Frontend configuration (Lab 5 pattern). This is the ONLY file to edit when
// the API moves. Nothing here is secret: every visitor can read this file, so
// never put DATABASE_URL, JWT_SECRET or the Turnstile secret key in it.

// On your laptop (localhost) the pages call the local API.
// On Vercel they call the deployed API project.
const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);

// The domain of the deployed Vercel API project.
const API_BASE_URL = isLocal
  ? 'http://localhost:3000/api'
  : 'https://collection-manager-api.vercel.app/api';

// External API: Cloudflare Turnstile site key (public, meant to be visible).
// Locally Cloudflare's TEST key is used: its widget always passes.
// Deployment: replace YOUR-TURNSTILE-SITE-KEY with the real site key.
// The SECRET key never goes in frontend code: only in backend/.env and Vercel.
const TURNSTILE_SITE_KEY = isLocal
  ? '1x00000000000000000000AA'
  : 'YOUR-TURNSTILE-SITE-KEY';
