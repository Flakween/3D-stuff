/**
 * CI helper: performs the Websim CLI device-login handshake against the Websim API.
 *
 * Why this exists:
 *   `websim-cli login` needs a browser to complete the challenge. GitHub Actions
 *   runners have no browser, but they *do* have unrestricted network egress, so we
 *   run the handshake here and hand the login URL back to a human.
 *
 * Security:
 *   The auth token never appears in plaintext in the job log. It is sealed with a
 *   one-time AES-256-GCM key, and that key is itself sealed with the caller's RSA
 *   public key (RSA-OAEP/SHA-256). Only the holder of the RSA private key can open
 *   the envelope.
 *
 * Usage:
 *   node websim-login.mjs --public-key <path-to-pub.pem> [--timeout-minutes 45]
 *
 * Output (stdout, machine readable):
 *   LOGIN_URL=<url>
 *   CHALLENGE_ID=<id>
 *   SEALED_TOKEN=<base64 envelope>
 */

import fs from 'node:fs';
import crypto from 'node:crypto';

const API_BASE = 'https://api.websim.com/api/v1';
const UA = 'websim-cli-bridge/1.0';

function parseArgs(argv) {
  const out = { publicKey: null, timeoutMinutes: 45 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--public-key') out.publicKey = argv[++i];
    else if (a === '--timeout-minutes') out.timeoutMinutes = Number(argv[++i]);
  }
  if (!out.publicKey) {
    console.error('Missing --public-key');
    process.exit(2);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const publicKeyPem = fs.readFileSync(args.publicKey, 'utf8');

async function apiInit() {
  const res = await fetch(`${API_BASE}/auth/cli/initiate`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`initiate failed ${res.status}: ${text}`);
  }
  return JSON.parse(text);
}

async function apiPoll(challengeId) {
  const res = await fetch(`${API_BASE}/auth/cli/poll?challengeId=${encodeURIComponent(challengeId)}`, {
    headers: { 'User-Agent': UA },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body };
}

/** Seal a secret with AES-256-GCM; wrap the AES key with RSA-OAEP(SHA-256). */
function seal(secret) {
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(secret, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();

  const wrappedKey = crypto.publicEncrypt(
    { key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    aesKey
  );

  // envelope = wrappedKey(256) | iv(12) | tag(16) | ciphertext
  return Buffer.concat([wrappedKey, iv, tag, ct]).toString('base64');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const init = await apiInit();
  const challengeId = init.challengeId;
  const loginUrl = String(init.loginUrl || '').replace('api.websim.com', 'websim.com');

  // Machine-readable lines first so the caller can scrape them from the log.
  console.log(`LOGIN_URL=${loginUrl}`);
  console.log(`CHALLENGE_ID=${challengeId}`);
  console.log('::group::Login challenge created — waiting for browser confirmation');

  const deadline = Date.now() + args.timeoutMinutes * 60_000;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    let poll;
    try {
      poll = await apiPoll(challengeId);
    } catch (err) {
      console.log(`poll error (attempt ${attempt}): ${err.message}`);
      await sleep(5000);
      continue;
    }

    if (poll.status === 200 && poll.body.status === 'completed') {
      const token = poll.body.authToken;
      if (!token) {
        throw new Error('completed but no authToken in response');
      }
      const sealed = seal(token);
      console.log(`SEALED_TOKEN=${sealed}`);
      console.log('::endgroup::');
      console.log('LOGIN_OK');
      return;
    }

    if (poll.body.status === 'expired' || poll.status === 410 || poll.status === 404) {
      console.log(`::endgroup::`);
      console.log(`CHALLENGE_EXPIRED at attempt ${attempt}: ${JSON.stringify(poll.body)}`);
      process.exit(3);
    }

    if (attempt % 6 === 0) {
      console.log(`still pending (${attempt} polls, status=${poll.status})`);
    }
    await sleep(5000);
  }

  console.log('::endgroup::');
  console.log('LOGIN_TIMEOUT');
  process.exit(4);
}

main().catch((err) => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
