import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ACCOUNT_ID } from './free-plan-guard.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const settingsUrl = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/qamous-web/settings`;

export function validatePublicSnapshotSettings(body) {
  if (body?.success !== true || !Array.isArray(body.result?.bindings)
    || body.result.bindings.some(binding => !binding || typeof binding.name !== 'string' || !binding.name)) {
    throw new Error('Deployment refused: live qamous-web settings could not be verified');
  }
  // Reject even an empty or secret binding: removing snapshot authority must be
  // an explicit frontend deployment before either writer can resume.
  if (body.result.bindings.some(binding => binding.name === 'PUBLIC_SNAPSHOT_ID')) {
    throw new Error('Deployment refused: qamous-web still serves a frozen public snapshot; remove PUBLIC_SNAPSHOT_ID before resuming writes');
  }
  return true;
}

export async function readLivePublicSettings({ run = spawnSync } = {}) {
  const authResult = run(process.execPath, [cli, 'auth', 'token', '--json'], {
    cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024,
  });
  if (authResult.status !== 0) throw new Error('Deployment refused: existing Wrangler authentication is unavailable');
  let auth;
  try { auth = JSON.parse(authResult.stdout); } catch {
    throw new Error('Deployment refused: existing Wrangler authentication is invalid');
  }
  if (typeof auth?.token !== 'string' || !/^[A-Za-z0-9._~+/-]+=*$/.test(auth.token)) {
    throw new Error('Deployment refused: existing Wrangler authentication is invalid');
  }
  // Keep credentials in memory and curl stdin, never process arguments, files,
  // inherited console output, or returned error messages.
  const response = run(process.platform === 'win32' ? 'curl.exe' : 'curl', [
    '--silent', '--show-error', '--fail', '--max-time', '30', '--config', '-',
  ], {
    input: `url = "${settingsUrl}"\nheader = "Authorization: Bearer ${auth.token}"\n`,
    encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024,
  });
  if (response.status !== 0) throw new Error('Deployment refused: live qamous-web settings request failed');
  try { return JSON.parse(response.stdout); } catch {
    throw new Error('Deployment refused: live qamous-web settings response is invalid');
  }
}

export async function verifyPublicSnapshotUnpause(config, { readSettings = readLivePublicSettings } = {}) {
  const pause = config?.vars?.PUBLIC_READ_ONLY;
  if (pause === 'true') return { paused: true };
  if (pause !== 'false') throw new Error('Deployment refused: explicit public snapshot pause setting is required');
  validatePublicSnapshotSettings(await readSettings());
  return { paused: false, snapshotActive: false };
}
