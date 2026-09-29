// 2026-09-14 セキュリティレビューの再現手順（security-review-evidence.cjs）を、
// 修正後の期待値で走らせ直す。データ・外部サービスはすべて架空。通信は遮断する。
// 実行: node docs/reports/security-fix-verification.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
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
const { KEY } = S;
const profile = { updatedAt: '2026-09-14', lifePatterns: ['synthetic-private-A'], pastFailures: [], valuesAccumulated: [], communicationStyle: { avgResponseLength: 10, prefersConcrete: true } };
function reset() { S.setSyncHook(null); localStorage.map.clear(); localStorage.setItem(KEY.schemaVersion, String(S.SCHEMA_VERSION)); S.__resetMigrationFlagForTest(); }

if (process.argv.includes('--migration-child')) {
  console.log('MIGRATION_STARTED');
  const accepted = S.importStateJson(JSON.stringify({ [KEY.schemaVersion]: '-1e20' }));
  // 保存済みの版番号が壊れている場合も、有限回で終わるか
  localStorage.setItem(KEY.schemaVersion, '-1e20');
  S.__resetMigrationFlagForTest();
  S.loadCards();
  console.log(`MIGRATION_COMPLETED accepted=${accepted}`);
  process.exit(0);
}

const results = [];
async function probe(id, fn) {
  try {
    const detail = await fn();
    results.push({ id, fixed: true, ...detail });
  } catch (e) {
    results.push({ id, fixed: false, error: e.message });
  }
  console.log(JSON.stringify(results.at(-1)));
}

async function main() {
  await probe('9-import-unrelated-json', async () => {
    reset();
    localStorage.setItem(KEY.profile, JSON.stringify(profile));
    const accepted = S.importStateJson('{"unrelated":"not-an-app-backup"}');
    assert.equal(accepted, false);
    assert.match(localStorage.getItem(KEY.profile), /synthetic-private-A/);
    return { accepted, profileKept: true };
  });

  await probe('8-restore-notifies-restored-value', async () => {
    reset();
    localStorage.setItem(KEY.profile, JSON.stringify(profile));
    const notifications = [];
    S.setSyncHook((key, value) => notifications.push({ key, value }));
    assert.equal(S.restoreState({ [KEY.schemaVersion]: String(S.SCHEMA_VERSION), [KEY.profile]: JSON.stringify(profile) }), true);
    S.setSyncHook(null);
    const p = notifications.filter(e => e.key === KEY.profile);
    assert.ok(!p.some(e => e.value === null), 'null（削除）が通知された');
    assert.equal(p.length, 1);
    return { profileNotifications: p.map(e => (e.value === null ? 'null' : 'value')) };
  });

  await probe('9-migration-terminates', async () => {
    const { spawnSync } = require('node:child_process');
    const child = spawnSync(process.execPath, [__filename, '--migration-child'], { cwd: root, timeout: 20000, encoding: 'utf8', windowsHide: true });
    assert.match(child.stdout ?? '', /MIGRATION_COMPLETED accepted=false/);
    return { completed: true };
  });

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

  await probe('7-pull-after-logout', async () => {
    reset();
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
    localStorage.map.clear();
    releasePull();
    assert.equal(await pull, false);
    assert.equal(localStorage.getItem(KEY.profile), null);
    return { oldAccountDataRestoredAfterLogout: false };
  });

  await probe('7-backfill-account-switch', async () => {
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
    sync.setSyncUser(null);
    const crossed = dbWrites.find(w => w.table === 'user_profiles' && w.rows?.user_id === 'synthetic-B');
    assert.equal(crossed, undefined);
    return { previousAccountProfileSentToB: false, switched };
  });

  await probe('2-other-account-data-not-auto-pushed', async () => {
    const { decideSyncDirection } = app('src/lib/supabase/sync-decision.ts');
    const d = decideSyncDirection({ alreadySynced: false, localHasContent: true, cloudHasContent: false, localOwnedByOtherUser: true });
    assert.equal(d, 'conflict');
    return { decision: d };
  });

  const { parseBody, MAX_BODY_BYTES } = app('src/lib/api-schema.ts');
  const { z } = require('zod');

  await probe('3-content-type-bypass', async () => {
    const spoof = await parseBody(new Request('http://audit.invalid/api', { method: 'POST', headers: { 'content-type': 'text/plain; note=application/json' }, body: '{}' }), z.object({}));
    assert.equal(spoof.ok, false);
    assert.equal(spoof.status, 415);
    return { status: spoof.status };
  });

  await probe('3-cross-site-post', async () => {
    const r = await parseBody(new Request('http://audit.invalid/api', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: '{}' }), z.object({}));
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
    return { status: r.status };
  });

  await probe('supplement-body-byte-limit', async () => {
    const body = JSON.stringify({ text: 'あ'.repeat(100000) });
    const bytes = Buffer.byteLength(body);
    const result = await parseBody(new Request('http://audit.invalid/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body }), z.object({ text: z.string() }));
    assert.equal(result.ok, false);
    assert.equal(result.status, 413);
    return { declaredLimit: MAX_BODY_BYTES, actualBytes: bytes, status: result.status };
  });

  await probe('1-local-backup-guard', async () => {
    const route = app('src/app/api/local-backup/route.ts');
    const env = process.env.NODE_ENV;
    const statuses = {};
    const mk = (method, headers, body) => new Request('http://localhost:3111/api/local-backup', { method, headers, body });
    // 専用ヘッダなし（旧来の直アクセス）
    statuses.postNoHeader = (await route.POST(mk('POST', { host: 'localhost:3111', 'content-type': 'application/json' }, '{}'))).status;
    statuses.getNoHeader = (await route.GET(mk('GET', { host: 'localhost:3111' }))).status;
    // LAN から（Host が loopback でない）
    statuses.getFromLan = (await route.GET(mk('GET', { host: '192.168.10.106:3111', 'x-gc-local-backup': '1' }))).status;
    // 別サイトのページから
    statuses.postCrossSite = (await route.POST(mk('POST', { host: 'localhost:3111', 'x-gc-local-backup': '1', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' }, '{}'))).status;
    // 本番
    process.env.NODE_ENV = 'production';
    statuses.getInProduction = (await route.GET(mk('GET', { host: 'localhost:3111', 'x-gc-local-backup': '1' }))).status;
    process.env.NODE_ENV = env;
    assert.deepEqual(statuses, { postNoHeader: 403, getNoHeader: 403, getFromLan: 404, postCrossSite: 403, getInProduction: 404 });
    return { statuses };
  });

  await probe('10-jwks-fetch-reused', async () => {
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
    globalThis.fetch = async () => { throw new Error('Unexpected network access'); };
    assert.ok(jwksReads <= 1, `JWKS を ${jwksReads} 回取得した`);
    return { rejectedRequests: 3, upstreamFetches: jwksReads };
  });

  await probe('11-mcp-batch-costs-per-call', async () => {
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production'; // Upstash 未設定の本番 → 代替上限で数える
    const { checkRateLimit, __resetMemoryLimitForTest } = app('src/lib/rate-limit.ts');
    __resetMemoryLimitForTest();
    const origError = console.error;
    console.error = () => {};
    const res = await checkRateLimit('mcp:synthetic', 'mcp', 20);
    console.error = origError;
    process.env.NODE_ENV = env;
    assert.ok(res, '20件のバッチが1回として通った');
    assert.equal(res.status, 429);
    return { batchOf20Status: res.status };
  });

  await probe('4-no-unlimited-in-production-without-upstash', async () => {
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const { checkRateLimit, __resetMemoryLimitForTest } = app('src/lib/rate-limit.ts');
    __resetMemoryLimitForTest();
    const origError = console.error;
    console.error = () => {};
    let allowed = 0;
    for (let i = 0; i < 20; i++) if (!(await checkRateLimit('user:synthetic', 'structure'))) allowed++;
    console.error = origError;
    process.env.NODE_ENV = env;
    assert.ok(allowed < 20);
    return { allowedOf20: allowed };
  });

  await probe('12-calendar-amplification', async () => {
    const { runSync, MAX_WRITE_OPS } = app('src/lib/calendar/engine.ts');
    const { today } = app('src/lib/date.ts');
    const boxes = Array.from({ length: 500 }, (_, i) => ({ id: `synthetic-${i}`, date: today(), start: '10:00', end: '11:00', title: 'Synthetic', hasNotes: false }));
    let creates = 0;
    const cal = await runSync(boxes, false, { loadLink: async () => ({ refreshToken: 'synthetic', calendarId: 'synthetic' }), updateLink: async () => {}, refreshAccessToken: async () => 'synthetic', listEvents: async () => ({ ok: true, events: [], nextSyncToken: null }), insertEvent: async () => `event-${++creates}`, patchEvent: async () => {}, deleteEvent: async () => {} });
    assert.equal(cal.ok, true);
    assert.equal(creates, MAX_WRITE_OPS);
    return { acceptedBoxes: boxes.length, externalInsertCalls: creates, truncated: cal.result.truncated };
  });

  await probe('13-oauth-state-bound-to-user', async () => {
    const { encodeStateCookie, stateMatches } = app('src/lib/calendar/oauth-state.ts');
    const cookie = encodeStateCookie('state-1', 'synthetic-A');
    assert.equal(stateMatches(cookie, 'state-1', 'synthetic-B'), false);
    assert.equal(stateMatches(cookie, 'state-1', 'synthetic-A'), true);
    return { switchedAccountAccepted: false };
  });

  const bad = results.filter(r => !r.fixed);
  console.log(`\n${results.length - bad.length}/${results.length} probes show the fixed behavior.`);
  if (bad.length > 0) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
