// External API: Cloudflare Turnstile bot check (Lab 5, Part O1 pattern).
// Protects catalogue item creation (POST /api/items).
//
// How it works:
//   1. The Turnstile widget on the Catalogue form proves a real browser is
//      filling it in and produces a one-time token.
//   2. The page sends the token in the X-Turnstile-Token header.
//   3. This middleware sends the token and the SECRET key to Cloudflare's
//      siteverify API. Only the server knows the secret key.
//   4. Only if Cloudflare answers success: true does the request continue to
//      the controller. Otherwise the API answers 403 BOT_CHECK_FAILED and
//      nothing is saved.
//
// The widget alone protects nothing: a script could skip the page and call the
// API directly. The protection is this server-side check (trust boundary).

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function sendBotError(res, message) {
  return res.status(403).json({ error: { code: 'BOT_CHECK_FAILED', message } });
}

async function verifyTurnstile(req, res, next) {
  try {
    const token = req.get('X-Turnstile-Token');
    if (!token) {
      console.warn(`SECURITY_ALERT BOT_CHECK_MISSING path=${req.originalUrl}`);
      return sendBotError(res, 'Bot check token is missing. Please complete the check and try again.');
    }

    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret) {
      // Fail closed: a missing secret is a server misconfiguration (answered
      // as 500 by the central error handler) and nobody gets through.
      throw new Error('TURNSTILE_SECRET_KEY is not set');
    }

    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token }),
      // A slow answer from Cloudflare must not hang the API.
      signal: AbortSignal.timeout(5000)
    });
    const result = await response.json();

    if (!result.success) {
      console.warn(`SECURITY_ALERT BOT_CHECK_FAILED codes=${(result['error-codes'] || []).join(',')}`);
      return sendBotError(res, 'Bot check failed or expired. Please try again.');
    }
    next();
  } catch (error) {
    // Cloudflare unreachable or timed out: refuse safely instead of saving.
    if (error.name === 'TimeoutError' || error.name === 'TypeError') {
      console.error('Turnstile verification unavailable:', error.name);
      return res.status(503).json({
        error: { code: 'BOT_CHECK_UNAVAILABLE', message: 'The bot check service is unavailable. Please try again shortly.' }
      });
    }
    next(error);
  }
}

module.exports = verifyTurnstile;
