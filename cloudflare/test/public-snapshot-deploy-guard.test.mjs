import test from 'node:test';
import assert from 'node:assert/strict';
import { readLivePublicSettings, validatePublicSnapshotSettings, verifyPublicSnapshotUnpause } from '../scripts/public-snapshot-deploy-guard.mjs';

const active = { vars: { PUBLIC_READ_ONLY: 'false' } };
const settings = bindings => ({ success: true, result: { bindings } });

test('a pause deployment needs no authentication or Cloudflare request', async () => {
  let calls = 0;
  assert.deepEqual(await verifyPublicSnapshotUnpause({ vars: { PUBLIC_READ_ONLY: 'true' } }, {
    readSettings: async () => { calls++; throw new Error('must not run'); },
  }), { paused: true });
  assert.equal(calls, 0);
});

test('resuming writes requires verified live settings with snapshot binding removed', async () => {
  let calls = 0;
  assert.deepEqual(await verifyPublicSnapshotUnpause(active, {
    readSettings: async () => { calls++; return settings([{ name: 'OTHER', type: 'plain_text', text: 'ok' }]); },
  }), { paused: false, snapshotActive: false });
  assert.equal(calls, 1);
  for (const binding of [
    { name: 'PUBLIC_SNAPSHOT_ID', type: 'plain_text', text: 'snapshot' },
    { name: 'PUBLIC_SNAPSHOT_ID', type: 'plain_text', text: '' },
    { name: 'PUBLIC_SNAPSHOT_ID', type: 'secret_text' },
  ]) await assert.rejects(verifyPublicSnapshotUnpause(active, {
    readSettings: async () => settings([binding]),
  }), /still serves a frozen public snapshot/);
});

test('missing pause, malformed settings, provider failures, and transport failures refuse unpause', async () => {
  for (const config of [{}, { vars: {} }, { vars: { PUBLIC_READ_ONLY: false } }]) {
    await assert.rejects(verifyPublicSnapshotUnpause(config, { readSettings: async () => assert.fail('not called') }), /explicit/);
  }
  for (const body of [null, {}, { success: false }, { result: { bindings: [] } },
    { success: true, result: {} }, settings([null]), settings([{}]), settings([{ name: '' }])]) {
    assert.throws(() => validatePublicSnapshotSettings(body), /could not be verified/);
  }
  await assert.rejects(verifyPublicSnapshotUnpause(active, { readSettings: async () => { throw new Error('network unavailable'); } }), /network unavailable/);
});

test('live inspection sends the credential only through curl stdin to the fixed approved Worker', async () => {
  const calls = [], token = 'private_test_token';
  const body = await readLivePublicSettings({ run(command, args, options) {
    calls.push({ command, args, options });
    return calls.length === 1
      ? { status: 0, stdout: JSON.stringify({ token }) }
      : { status: 0, stdout: JSON.stringify(settings([])) };
  } });
  assert.equal(validatePublicSnapshotSettings(body), true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args.slice(-3), ['auth', 'token', '--json']);
  assert.match(calls[1].options.input, /accounts\/39292a971f28b413619657e9f2c77003\/workers\/scripts\/qamous-web\/settings/);
  assert.match(calls[1].options.input, new RegExp('Authorization: Bearer ' + token));
  assert.ok(calls.every(call => !JSON.stringify([call.command, call.args]).includes(token)));
  assert.ok(calls.every(call => call.options.stdio !== 'inherit' && call.options.windowsHide === true));
});

test('authentication and provider error details cannot leak through deployment errors', async () => {
  const secret = 'private_test_token';
  for (const authResponse of [
    { status: 1, stderr: secret },
    { status: 0, stdout: secret },
    { status: 0, stdout: JSON.stringify({ token: secret + '\nheader = bad' }) },
  ]) await assert.rejects(readLivePublicSettings({ run: () => authResponse }), error => {
    assert.match(error.message, /Deployment refused/); assert.ok(!error.message.includes(secret)); return true;
  });
  for (const response of [{ status: 1, stderr: secret }, { status: 0, stdout: secret }]) {
    let calls = 0;
    await assert.rejects(readLivePublicSettings({ run: () => ++calls === 1
      ? { status: 0, stdout: JSON.stringify({ token: secret }) } : response }), error => {
      assert.match(error.message, /Deployment refused/); assert.ok(!error.message.includes(secret)); return true;
    });
  }
});

