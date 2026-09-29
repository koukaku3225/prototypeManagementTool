// Offline security review probes. All data and service responses are synthetic.
// Run from the repository root: node docs/reports/security-review-evidence.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
// Some restricted Windows accounts cannot resolve passwd information.
try { os.userInfo(); } catch { os.userInfo = () => ({ username: 'audit', homedir: os.tmpdir(), uid: 0, gid: 0, shell: null }); }
require('tsx/cjs/api').register();
const root = path.resolve(__dirname, '../..');
const app = p => require(path.join(root, p));
globalThis.fetch = async () => { throw new Error('Unexpected network access is blocked by this probe'); };
class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.get(k) ?? null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()][i] ?? null; }
}
globalThis.localStorage = new MemoryStorage();
const S = app('src/lib/storage.ts');
const { KEY, DEVICE_KEY } = S;
const profile = { updatedAt: '2026-09-14', lifePatterns: ['synthetic-private-A'], pastFailures: [], valuesAccumulated: [], communicationStyle: { avgResponseLength: 10, prefersConcrete: true } };
const evidence = [];
function record(id, value) { evidence.push({ id, ...value }); console.log(JSON.stringify(evidence.at(-1))); }
function reset() { S.setSyncHook(null); localStorage.map.clear(); localStorage.setItem(KEY.schemaVersion, String(S.SCHEMA_VERSION)); S.__resetMigrationFlagForTest(); }

if (process.argv.includes('--migration-child')) {
  console.log('MIGRATION_STARTED');
  S.importStateJson(JSON.stringify({ [KEY.schemaVersion]: '-1e20' }));
  console.log('MIGRATION_COMPLETED');
  process.exit(0);
}

async function main() {
  reset();
  localStorage.setItem(KEY.profile, JSON.stringify(profile));
  const accepted = S.importStateJson('{"unrelated":"not-an-app-backup"}');
  assert.equal(accepted, true);
  assert.equal(localStorage.getItem(KEY.profile), null);
  record('import-unrelated-json', { accepted, previousProfileRemoved: true });

  reset();
  localStorage.setItem(KEY.profile, JSON.stringify(profile));
  const notifications = [];
  S.setSyncHook((key, value) => notifications.push({ key, value }));
  assert.equal(S.restoreState({ [KEY.schemaVersion]: String(S.SCHEMA_VERSION), [KEY.profile]: JSON.stringify(profile) }), true);
  assert.ok(notifications.some(e => e.key === KEY.profile && e.value === null));
  assert.ok(!notifications.some(e => e.key === KEY.profile && e.value !== null));
  record('restore-notifies-delete-only', { profileLocalPresent: !!localStorage.getItem(KEY.profile), profileNotifications: notifications.filter(e => e.key === KEY.profile) });

  const { spawnSync } = require('node:child_process');
  const child = spawnSync(process.execPath, [__filename, '--migration-child'], { cwd: root, timeout: 2500, encoding: 'utf8', windowsHide: true });
  assert.match(child.stdout ?? '', /MIGRATION_STARTED/);
  assert.doesNotMatch(child.stdout ?? '', /MIGRATION_COMPLETED/);
  assert.equal(child.error?.code, 'ETIMEDOUT');
  assert.equal(-1e20 + 1, -1e20);
  record('migration-non-progress', { enteredMigration: true, killedAfterMs: 2500, incrementDoesNotChangeValue: true });

  // Replace only the DB boundary; execute the real sync/storage functions.
  let queryHandler = async () => ({ data: [], error: null, count: 0 });
  const dbWrites = [];
  const fakeDb = { from(table) {
    const q = { table, op: 'select', filters: [], single: false,
      select(...args) { this.selectArgs = args; return this; },
      eq(...args) { this.filters.push(args); return this; },
      in(...args) { this.filters.push(args); return this; },
      order() { return this; },
      maybeSingle() { this.single = true; return this; },
      upsert(rows) { this.op = 'upsert'; this.rows = rows; return this; },
      delete() { this.op = 'delete'; return this; },
      then(resolve, reject) { return Promise.resolve().then(() => queryHandler(this)).then(resolve, reject); }
    }; return q;
  } };
  const clientId = require.resolve(path.join(root, 'src/lib/supabase/client.ts'));
  require.cache[clientId] = { id: clientId, filename: clientId, loaded: true, exports: { supabaseBrowser: () => fakeDb } };
  const sync = app('src/lib/supabase/sync.ts');
  const tick = () => new Promise(resolve => setImmediate(resolve));

  reset();
  // Leave the initial-sync inventory request pending to isolate explicit pullAll.
  queryHandler = q => q.selectArgs?.[1]?.head ? new Promise(() => {}) : Promise.resolve({ data: q.single ? null : [], error: null });
  sync.setSyncUser('synthetic-A');
  await tick();
  let releasePull;
  const pullGate = new Promise(resolve => { releasePull = resolve; });
  queryHandler = async q => {
    await pullGate;
    return { data: q.table === 'user_profiles' ? { user_id: 'synthetic-A', updated_at: '2026-09-14', life_patterns: ['synthetic-private-A'], past_failures: [], values_accumulated: [], avg_response_length: 10, prefers_concrete: true } : q.single ? null : [], error: null };
  };
  const pull = sync.pullAll();
  await tick();
  sync.setSyncUser(null);
  localStorage.map.clear(); // Model a UI that cleared sensitive data at logout.
  releasePull();
  assert.equal(await pull, true);
  assert.match(localStorage.getItem(KEY.profile), /synthetic-private-A/);
  record('pull-after-logout', { oldAccountDataRestoredAfterLogout: true, syncState: sync.getSyncState().kind });

  reset();
  localStorage.setItem(KEY.profile, JSON.stringify(profile));
  localStorage.setItem(KEY.archive, '[]');
  localStorage.setItem(KEY.bigstory, 'null');
  queryHandler = q => q.selectArgs?.[1]?.head ? new Promise(() => {}) : Promise.resolve({ data: q.single ? null : [], error: null });
  sync.setSyncUser('synthetic-A');
  await tick();
  let switched = false;
  queryHandler = async q => {
    if (q.selectArgs?.[1]?.head) return new Promise(() => {});
    if (q.op !== 'select') dbWrites.push({ table: q.table, op: q.op, rows: q.rows });
    if (!switched && q.table === 'big_stories' && q.op === 'delete') { switched = true; sync.setSyncUser('synthetic-B'); }
    return { data: q.single ? null : [], error: null };
  };
  await sync.backfillAll();
  const crossed = dbWrites.find(w => w.table === 'user_profiles' && w.rows?.user_id === 'synthetic-B');
  assert.ok(crossed);
  assert.deepEqual(crossed.rows.life_patterns, profile.lifePatterns);
  record('backfill-account-switch', { sourceAccount: 'synthetic-A', destinationAccount: crossed.rows.user_id, previousAccountProfileSent: true });
  sync.setSyncUser(null);

  const { parseBody, CalendarSyncRequestSchema, McpEnvelopeSchema, MAX_BODY_BYTES } = app('src/lib/api-schema.ts');
  const { z } = require('zod');
  const spoof = await parseBody(new Request('http://audit.invalid/api', { method: 'POST', headers: { 'content-type': 'text/plain; note=application/json' }, body: '{}' }), z.object({}));
  assert.equal(spoof.ok, true);
  record('content-type-bypass', { accepted: spoof.ok });
  const body = JSON.stringify({ text: 'あ'.repeat(100000) });
  const bytes = Buffer.byteLength(body);
  assert.ok(bytes > MAX_BODY_BYTES);
  const result = await parseBody(new Request('http://audit.invalid/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body }), z.object({ text: z.string() }));
  assert.equal(result.ok, true);
  record('body-byte-limit', { declaredLimit: MAX_BODY_BYTES, actualBytes: bytes, accepted: result.ok });

  // No JWT secret or valid session is needed to trigger JWKS fetches.
  Object.assign(process.env, { MCP_ENABLED: 'true', MCP_RESOURCE_URL: 'https://audit.invalid/api/mcp', MCP_ISSUER: 'https://auth.audit.invalid/auth/v1', MCP_AUDIENCE: 'https://audit.invalid/api/mcp', MCP_ALLOWED_CLIENT_IDS: 'synthetic-client', NEXT_PUBLIC_SUPABASE_URL: 'https://auth.audit.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-key', MCP_CURSOR_SECRET: 'synthetic-secret-that-is-at-least-32-characters', MCP_JWKS_URL: 'https://auth.audit.invalid/jwks' });
  let jwksReads = 0;
  globalThis.fetch = async url => {
    assert.equal(String(url), process.env.MCP_JWKS_URL);
    jwksReads++;
    return Response.json({ keys: [] });
  };
  const { authenticateMcpRequest } = app('src/lib/mcp/auth.ts');
  const jwt = `${Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'nonexistent' })).toString('base64url')}.${Buffer.from('{}').toString('base64url')}.AA`;
  for (let i = 0; i < 3; i++) await assert.rejects(authenticateMcpRequest(new Request('https://audit.invalid/api/mcp', { headers: { authorization: `Bearer ${jwt}` } })));
  assert.equal(jwksReads, 3);
  record('jwks-unauthenticated-fetch', { rejectedRequests: 3, upstreamFetches: jwksReads });
  globalThis.fetch = async () => { throw new Error('Unexpected network access'); };

  const { WebStandardStreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js');
  const { createGoalCoachMcpServer } = app('src/lib/mcp/server.ts');
  let calls = 0;
  const server = createGoalCoachMcpServer({ getGoals: async () => { calls++; return { goals: [] }; }, getWeeklyActivity: async () => ({ items: [] }) });
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  const batch = Array.from({ length: 20 }, (_, id) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'get_goals', arguments: {} } }));
  const parsedBody = McpEnvelopeSchema.parse(batch);
  const batchResponse = await transport.handleRequest(new Request('https://audit.invalid/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(batch) }), { parsedBody });
  await batchResponse.text();
  assert.equal(calls, 20);
  record('mcp-batch-amplification', { httpRequests: 1, toolExecutions: calls, status: batchResponse.status });
  await server.close();

  const { runSync } = app('src/lib/calendar/engine.ts');
  const { today } = app('src/lib/date.ts');
  const boxes = Array.from({ length: 500 }, (_, i) => ({ id: `synthetic-${i}`, date: today(), start: '10:00', end: '11:00', title: 'Synthetic', hasNotes: false }));
  CalendarSyncRequestSchema.parse({ boxes });
  let creates = 0;
  const cal = await runSync(boxes, false, { loadLink: async () => ({ refreshToken: 'synthetic', calendarId: 'synthetic' }), updateLink: async () => {}, refreshAccessToken: async () => 'synthetic', listEvents: async () => ({ ok: true, events: [], nextSyncToken: null }), insertEvent: async () => `event-${++creates}`, patchEvent: async () => {}, deleteEvent: async () => {} });
  assert.equal(creates, 500);
  assert.equal(cal.ok, true);
  record('calendar-amplification', { acceptedBoxes: boxes.length, externalInsertCalls: creates, liveGoogleCalls: 0 });
  console.log('All offline probes completed. These assertions confirm weaknesses, not fixes.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
