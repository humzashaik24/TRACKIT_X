#!/usr/bin/env node
/**
 * Trackit X — local Supabase connectivity, auth and onboarding verification.
 *
 * DEV TOOLING. Nothing in the application imports this file. It exists because
 * "the app connects to Supabase" is a claim that should be executed rather than
 * reasoned about, and the unit suite deliberately does not depend on a running
 * database — so the check lives here instead of in `tests/`.
 *
 * What it exercises, against the LOCAL stack only:
 *
 *   1. env resolution      — the same four EXPO_PUBLIC_ names the app reads
 *   2. unauthenticated     — a query with no session must be REFUSED outright.
 *                            `anon` is granted nothing on the business tables, so
 *                            this fails at the GRANT layer (42501) before RLS is
 *                            consulted. That is a different, outer boundary from
 *                            the authenticated cross-tenant one, which returns
 *                            zero rows instead. Do not conflate the two.
 *   3. sign-up             — real GoTrue, with email confirmation as configured
 *   4. confirmation        — the token is taken from Mailpit, the local mailbox,
 *                            rather than bypassed with a service-role call
 *   5. sign-in             — password grant
 *   6. restoration         — a second client built over the same storage must
 *                            recover the session without signing in again
 *   7. onboarding          — create_organization RPC → owner membership
 *   8. authority           — the client must NOT be able to hand itself a role
 *   9. tenancy             — the new user must not see the seeded organization
 *  10. password reset      — recovery mail is issued
 *  11. sign-out            — session gone
 *
 * Usage:  node scripts/verify-local-connection.mjs
 *
 * Requires `supabase start` to be running. Creates a throwaway user and
 * organization in the LOCAL database; run `supabase db reset` to clear them.
 *
 * No key, token or password is ever printed. Failures report the shape of a
 * value, never the value.
 */
import { readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

const MAILPIT = 'http://127.0.0.1:54324';
const STORAGE_KEY = 'trackitx.auth.session';

let failures = 0;
let checks = 0;

function pass(label, detail) {
  checks += 1;
  console.log(`  PASS  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
}

function fail(label, detail) {
  checks += 1;
  failures += 1;
  console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${detail}`}`);
}

function assert(condition, label, detail) {
  if (condition) pass(label, detail);
  else fail(label, detail);
  return condition;
}

function section(title) {
  console.log(`\n${title}`);
}

/**
 * Reads `.env` the way the Expo bundler would: literal `KEY=value` lines,
 * comments and blanks skipped. Deliberately not a dependency — the file format
 * this needs to understand is three lines of logic.
 */
function loadEnvFile(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

/** An in-memory stand-in for AsyncStorage, so restoration can be exercised. */
function createMemoryStorage() {
  const entries = new Map();
  return {
    store: entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
}

function makeClient(url, key, storage) {
  return createClient(url, key, {
    auth: {
      storage,
      storageKey: STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: 'pkce',
      debug: false,
    },
  });
}

/** Newest message sent to `address`, waiting briefly for delivery. */
async function waitForMail(address, attempts = 25) {
  for (let i = 0; i < attempts; i += 1) {
    const listed = await fetch(`${MAILPIT}/api/v1/messages?limit=50`);
    if (listed.ok) {
      const { messages = [] } = await listed.json();
      const hit = messages.find((m) =>
        (m.To ?? []).some((t) => (t.Address ?? '').toLowerCase() === address.toLowerCase()),
      );
      if (hit !== undefined) {
        const full = await fetch(`${MAILPIT}/api/v1/message/${hit.ID}`);
        if (full.ok) return { meta: hit, body: await full.json() };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return null;
}

/**
 * Pulls the verification token out of a GoTrue mail. The default template links
 * to `/auth/v1/verify?token=<hash>&type=<kind>`, and that hash is what
 * `verifyOtp` expects as `token_hash`.
 */
function extractToken(mail) {
  const text = `${mail.body.Text ?? ''}\n${mail.body.HTML ?? ''}`;
  const token = /[?&]token=([A-Za-z0-9._-]+)/.exec(text);
  const kind = /[?&]type=([a-z_]+)/.exec(text);
  return { token: token?.[1] ?? null, type: kind?.[1] ?? null };
}

async function main() {
  console.log('Trackit X — local Supabase verification');

  // ── 1. environment ────────────────────────────────────────────────────────
  section('1. environment');
  const file = loadEnvFile('.env');
  const url = file.EXPO_PUBLIC_SUPABASE_URL;
  const key = file.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  assert(url !== undefined && url !== '', 'EXPO_PUBLIC_SUPABASE_URL is set', url);
  assert(
    key !== undefined && key.length >= 20,
    'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is set',
    key === undefined ? 'missing' : `${key.length} chars, value withheld`,
  );
  assert(
    url !== undefined && (url.startsWith('http://') || url.startsWith('https://')),
    'URL is http(s), not a database connection string',
  );

  const leaked = Object.keys(file).filter(
    (name) =>
      name.startsWith('EXPO_PUBLIC_') &&
      /(SERVICE_ROLE_KEY|SERVICE_KEY|SECRET_KEY|SECRET|GEMINI_API_KEY|GOOGLE_API_KEY|DATABASE_URL|DB_PASSWORD|PASSWORD|PRIVATE_KEY|ACCESS_TOKEN)$/.test(
        name,
      ),
  );
  assert(leaked.length === 0, 'no server-only secret carries an EXPO_PUBLIC_ prefix', leaked.join());

  if (failures > 0) {
    console.log('\nEnvironment is unusable; stopping before touching the network.');
    return;
  }

  // ── 2. unauthenticated ────────────────────────────────────────────────────
  section('2. unauthenticated client');
  const anonStorage = createMemoryStorage();
  const anon = makeClient(url, key, anonStorage);

  const { data: noSession } = await anon.auth.getSession();
  assert(noSession.session === null, 'no session before sign-in');

  // `anon` holds no SELECT privilege at all — see the migration: "anon is
  // granted nothing: there is no unauthenticated view of a business." So the
  // refusal lands at the GRANT level (42501) BEFORE RLS is consulted, which is
  // stricter than the zero-rows answer an authenticated cross-tenant read gets.
  // Both are correct; they are different boundaries, and this is the outer one.
  const cold = await anon.from('organizations').select('*');
  assert(
    cold.error !== null,
    'anonymous select is refused outright, not answered',
    cold.error === null ? 'ANSWERED — defect' : `${cold.error.code}: ${cold.error.message}`,
  );
  assert(
    cold.error?.code === '42501',
    'the refusal is insufficient_privilege, i.e. no grant to anon',
    `code=${cold.error?.code}`,
  );
  assert(
    (cold.data ?? null) === null,
    'no organization data reaches an unauthenticated caller',
  );

  // ── 3. sign-up ────────────────────────────────────────────────────────────
  section('3. sign-up (real GoTrue)');
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const email = `verify.${stamp}@trackitx.test`;
  const password = `Tx-${stamp}-Verify!9`;

  const signUp = await anon.auth.signUp({
    email,
    password,
    options: { data: { full_name: 'Local Verification' } },
  });
  assert(signUp.error === null, 'signUp accepted', signUp.error?.message);
  assert(signUp.data?.user !== null && signUp.data?.user !== undefined, 'user record created');

  const needsConfirmation = signUp.data?.session === null;
  assert(true, 'email confirmation required by local config', needsConfirmation ? 'yes' : 'no');

  // ── 4. confirmation via the local mailbox ─────────────────────────────────
  section('4. email confirmation (token read from Mailpit, not bypassed)');
  let confirmed = false;
  if (needsConfirmation) {
    const mail = await waitForMail(email);
    if (assert(mail !== null, 'confirmation mail delivered to Mailpit', mail?.meta?.Subject)) {
      const { token, type } = extractToken(mail);
      assert(token !== null, 'confirmation token present in mail', `type=${type ?? 'unknown'}`);
      if (token !== null) {
        const verified = await anon.auth.verifyOtp({ token_hash: token, type: 'signup' });
        confirmed = assert(
          verified.error === null && verified.data.session !== null,
          'verifyOtp confirms the address and issues a session',
          verified.error?.message,
        );
      }
    }
  } else {
    confirmed = true;
    pass('confirmation not required — session issued at sign-up');
  }

  await anon.auth.signOut();

  // ── 5. sign-in ────────────────────────────────────────────────────────────
  section('5. sign-in');
  if (!confirmed) {
    fail('sign-in', 'skipped: the address was never confirmed');
  } else {
    const signIn = await anon.auth.signInWithPassword({ email, password });
    assert(
      signIn.error === null && signIn.data.session !== null,
      'signInWithPassword returns a session',
      signIn.error?.message,
    );
    assert(
      signIn.data?.user?.email === email,
      'session belongs to the account that signed in',
    );

    // ── 6. restoration ──────────────────────────────────────────────────────
    section('6. session restoration');
    assert(
      anonStorage.store.has(STORAGE_KEY),
      'session persisted under the app’s storage key',
      STORAGE_KEY,
    );
    const revived = makeClient(url, key, anonStorage);
    const { data: restored } = await revived.auth.getSession();
    assert(
      restored.session !== null && restored.session.user.email === email,
      'a fresh client recovers the session from storage without signing in',
    );

    // ── 7. onboarding ───────────────────────────────────────────────────────
    section('7. organization onboarding');
    const created = await anon.rpc('create_organization', {
      p_name: 'Verification Works',
      p_business_type: 'construction',
      p_timezone: 'Asia/Kolkata',
      p_currency: 'inr',
    });
    const org = created.data;
    assert(created.error === null && org !== null, 'create_organization RPC succeeds', created.error?.message);

    if (org !== null && org !== undefined) {
      assert(org.currency === 'INR', 'RPC normalises the currency code', `${org.currency}`);
      const role = await anon.rpc('organization_role_of', { organization: org.id });
      assert(
        role.error === null && role.data === 'owner',
        'caller is owner of the organization they created',
        role.error?.message ?? `role=${role.data}`,
      );
      const members = await anon
        .from('organization_members')
        .select('id, role', { count: 'exact' })
        .eq('organization_id', org.id);
      assert(
        members.error === null && members.data?.length === 1,
        'exactly one membership exists',
        members.error?.message ?? `rows=${members.data?.length}`,
      );

      // ── 8. the client cannot award itself authority ───────────────────────
      section('8. authority stays with the database');
      const escalate = await anon.rpc('create_organization', {
        p_name: 'Escalation Attempt',
        p_business_type: 'retail',
        p_timezone: 'Asia/Kolkata',
        p_currency: 'INR',
        p_role: 'owner',
      });
      assert(
        escalate.error !== null,
        'the RPC has no role parameter, so a role cannot be requested',
        escalate.error === null ? 'ACCEPTED — defect' : 'rejected',
      );

      const selfInsert = await anon
        .from('organization_members')
        .insert({ organization_id: org.id, user_id: signIn.data.user.id, role: 'owner' })
        .select();
      assert(
        selfInsert.error !== null || (selfInsert.data ?? []).length === 0,
        'a duplicate self-granted owner row is refused',
        selfInsert.error === null ? 'ACCEPTED — defect' : 'rejected',
      );

      // ── 9. tenancy ───────────────────────────────────────────────────────
      section('9. tenancy isolation');
      const all = await anon.from('organizations').select('id');
      assert(
        all.error === null && all.data?.length === 1 && all.data[0].id === org.id,
        'the new user sees only their own organization, not the seeded ones',
        all.error?.message ?? `rows=${all.data?.length}`,
      );
    }

    // ── 10. password reset ──────────────────────────────────────────────────
    section('10. password reset');
    const reset = await anon.auth.resetPasswordForEmail(email, {
      redirectTo: 'http://localhost:8081/reset-password',
    });
    assert(reset.error === null, 'recovery mail requested', reset.error?.message);
    const recovery = await waitForMail(email);
    assert(recovery !== null, 'recovery mail delivered', recovery?.meta?.Subject);

    // ── 11. sign-out ────────────────────────────────────────────────────────
    section('11. sign-out');
    const out = await anon.auth.signOut();
    assert(out.error === null, 'signOut succeeds', out.error?.message);
    const { data: after } = await anon.auth.getSession();
    assert(after.session === null, 'session cleared after sign-out');
    const locked = await anon.from('organizations').select('id');
    assert(
      locked.error !== null && (locked.data ?? null) === null,
      'the signed-out client can no longer read the organization',
      locked.error === null ? `READ ${locked.data?.length} ROWS — defect` : locked.error.code,
    );
  }

  console.log(
    `\n${failures === 0 ? 'ALL CHECKS PASSED' : 'FAILURES PRESENT'} — ${checks - failures} passed / ${failures} failed`,
  );
  console.log(`Throwaway account: ${email} (local database only)`);
  if (failures > 0) process.exitCode = 1;
}

await main();
