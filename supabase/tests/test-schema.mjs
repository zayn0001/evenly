// Applies the migrations to PGlite (real Postgres) with stubs for Supabase's auth schema and
// roles, then checks the access rules as different users.
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// A migrations directory (applied in filename order) or a single .sql file.
const schemaPath = process.argv[2];
const sqlFiles = statSync(schemaPath).isDirectory()
  ? readdirSync(schemaPath).filter((f) => f.endsWith('.sql')).sort().map((f) => join(schemaPath, f))
  : [schemaPath];
const db = new PGlite();

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  -- Supabase projects auto-grant everything on new public objects to the API roles.
  -- Mirror that, or revokes look like they work when they don't.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`);
for (const file of sqlFiles) await db.exec(readFileSync(file, 'utf8'));
console.log(`schema applied (${sqlFiles.length} migration${sqlFiles.length === 1 ? '' : 's'})`);

const ANA = '00000000-0000-0000-0000-000000000001';
const BEN = '00000000-0000-0000-0000-000000000002';
await db.exec(`insert into auth.users values ('${ANA}', 'ana@example.com'), ('${BEN}', 'ben@example.com')`);

/** Runs SQL as a signed-in user (role authenticated + JWT sub) like PostgREST does, or as anon. */
async function as(uid, sql, params = []) {
  await db.exec(
    `set role ${uid ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`,
  );
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}
const fails = (uid, sql, params, pattern) => assert.rejects(() => as(uid, sql, params), pattern, sql);
const ok = (name) => console.log('  ✓', name);

const [{ create_group: trip }] = await as(ANA, `select evenly.create_group('Goa trip', 'Ana', array['Ben', ' Chitra ', ''])`);
{
  const members = await as(ANA, `select name, is_me from evenly.group_members where group_id = $1 order by created_at`, [trip]);
  assert.deepEqual(members.map((m) => m.name).sort(), ['Ana', 'Ben', 'Chitra']);
  assert.equal(members.filter((m) => m.is_me).length, 1);
  ok('create_group makes the group with you and the others, trimming names and skipping blanks');
}

const receipt = JSON.stringify({ items: [{ id: 'i1', name: 'Thali', qty: 1, total: 300 }], grand_total: 300 });
const [{ id: split }] = await as(
  ANA,
  `insert into evenly.splits (group_id, title, total, receipt, assignments, result) values ($1, 'Lunch', 300, $2, '{}', '{}') returning id`,
  [trip, receipt],
);
ok('you can save a split in your group');

{
  assert.equal((await as(BEN, `select * from evenly.groups`)).length, 0);
  assert.equal((await as(BEN, `select * from evenly.group_members`)).length, 0);
  assert.equal((await as(BEN, `select * from evenly.splits`)).length, 0);
  ok("another account sees none of your groups, people or splits");

  await fails(BEN, `insert into evenly.group_members (group_id, name) values ($1, 'Mallory')`, [trip], /row-level security/);
  await fails(
    BEN,
    `insert into evenly.splits (group_id, title, total, receipt, assignments, result) values ($1, 'x', 1, '{}', '{}', '{}')`,
    [trip],
    /row-level security/,
  );
  await fails(BEN, `insert into evenly.groups (name, owner) values ('Mine now', $1)`, [ANA], /row-level security/);
  ok("…and can't add people or splits to them, or make groups in your name");

  const changed = await as(BEN, `update evenly.splits set title = 'hacked' where id = $1 returning id`, [split]);
  const gone = await as(BEN, `delete from evenly.groups where id = $1 returning id`, [trip]);
  assert.equal(changed.length + gone.length, 0);
  ok("…and can't edit or delete them");

  const [{ id: bens }] = await as(BEN, `insert into evenly.groups (name) values ('Flat') returning id`);
  await fails(ANA, `update evenly.splits set group_id = $1 where id = $2`, [bens, split], /row-level security/);
  ok("you can't move a split into someone else's group");
}

{
  await fails(null, `select * from evenly.groups`, [], /permission denied/);
  await fails(null, `select evenly.create_group('x', 'y', array[]::text[])`, [], /permission denied/);
  await fails(null, `select evenly.use_ai('scan', 5)`, [], /permission denied/);
  ok('signed-out visitors get nothing');
}

{
  await fails(ANA, `insert into evenly.group_members (group_id, name, is_me) values ($1, 'Ana again', true)`, [trip], /group_members_one_me/);
  await fails(ANA, `insert into evenly.group_members (group_id, name) values ($1, '   ')`, [trip], /check constraint/);
  ok('one "me" per group, and names must not be blank');
}

{
  const tries = [];
  for (let i = 0; i < 4; i++) tries.push((await as(ANA, `select evenly.use_ai('scan', 3) as ok`))[0].ok);
  assert.deepEqual(tries, [true, true, true, false]);
  assert.equal((await as(BEN, `select evenly.use_ai('scan', 3) as ok`))[0].ok, true);
  await fails(ANA, `select * from evenly.ai_usage`, [], /permission denied/);
  ok('AI quota: allows the daily limit per user, then says no; the counts are private');
}

{
  const [{ updated_at: before }] = await as(ANA, `select updated_at from evenly.splits where id = $1`, [split]);
  await new Promise((r) => setTimeout(r, 5));
  await as(ANA, `update evenly.splits set title = 'Lunch at Annalakshmi' where id = $1`, [split]);
  const [{ updated_at: after }] = await as(ANA, `select updated_at from evenly.splits where id = $1`, [split]);
  assert.ok(after > before);
  await as(ANA, `delete from evenly.groups where id = $1`, [trip]);
  assert.equal((await db.query(`select count(*)::int as n from evenly.splits`)).rows[0].n, 0);
  ok('editing a split stamps updated_at; deleting a group deletes its people and splits');
}

{
  // Ben has one group; save 12 splits in it (plus Ana's, which must not count against him).
  const [{ id: flat }] = await as(BEN, `select id from evenly.groups where name = 'Flat'`);
  const [{ create_group: anas }] = await as(ANA, `select evenly.create_group('Ana only', 'Ana', array[]::text[])`);
  await as(ANA, `insert into evenly.splits (group_id, title, total, receipt, assignments, result) values ($1, 'Ana 1', 1, '{}', '{}', '{}')`, [anas]);
  for (let i = 1; i <= 12; i++) {
    await as(BEN, `insert into evenly.splits (group_id, title, total, receipt, assignments, result) values ($1, $2, 1, '{}', '{}', '{}')`, [flat, `Bill ${i}`]);
    await new Promise((r) => setTimeout(r, 2)); // distinct timestamps
  }
  const kept = (await as(BEN, `select title from evenly.splits order by updated_at`)).map((r) => r.title);
  assert.deepEqual(kept, Array.from({ length: 10 }, (_, i) => `Bill ${i + 3}`));
  assert.equal((await as(ANA, `select * from evenly.splits`)).length, 1);
  ok("each account keeps its 10 latest splits; saving more deletes its oldest, never someone else's");
}

{
  const leftovers = (await db.query(
    `select n.nspname || '.' || c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind = 'r' and n.nspname = 'public'
     union all select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
     union all select nspname from pg_namespace where nspname = 'private'`,
  )).rows.map((r) => r.name);
  assert.deepEqual(leftovers, []);
  ok("everything lives in the evenly schema; nothing is left in public or private");
}

console.log('ALL SCHEMA TESTS PASSED');
