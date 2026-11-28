// Frontend configuration (Lab 5 and Lab 7 pattern). This is the ONLY file to
// edit when the API moves. Nothing here is secret: every visitor can read this
// file, so never put DATABASE_URL, JWT_SECRET or the Turnstile secret key in it.

// Our API Gateway address on Floci. infra/floci/deploy.sh fills it in.
const FLOCI_API = 'http://9b895461a9.execute-api.localhost.floci.io:4566';

// The address the page was loaded from decides which API it calls:
//   localhost:4566 -> Floci (S3 website, API Gateway + Lambda)
//   localhost:8080 -> the API on your PC (npm run dev)
//   anything else  -> the Vercel deployment
const onFloci = window.location.port === '4566';
const isLocal = !onFloci && ['localhost', '127.0.0.1'].includes(window.location.hostname);

let API_BASE_URL = 'https://collection-manager-api.vercel.app/api';
if (onFloci) API_BASE_URL = `${FLOCI_API}/api`;
if (isLocal) API_BASE_URL = 'http://localhost:3000/api';

// External API: Cloudflare Turnstile site key (public, meant to be visible).
// On the PC Cloudflare's TEST key is used: its widget always passes.
// On Floci and Vercel the real site key is used (localhost is an allowed
// hostname of our widget). The SECRET key never goes in frontend code.
const TURNSTILE_SITE_KEY = isLocal
  ? '1x00000000000000000000AA'
  : '0x4AAAAAAGNZLFadxem13QkL';
