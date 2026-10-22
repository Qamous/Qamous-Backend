import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {PublicCacheRevision,PUBLIC_MUTATION_LEASE_MS,validPublicCacheSelector} from '../src/public-cache-revision.ts';
import {PublicCacheState} from '../src/public-cache-state.ts';
import {ReadBudgetLedger} from '../src/read-budget-ledger.ts';

function fixture(legacyRevision=1) {
  const db=new DatabaseSync(':memory:'),statements=[];
  if(legacyRevision!==1)db.exec(`CREATE TABLE public_cache_revision(id INTEGER PRIMARY KEY,revision INTEGER NOT NULL);INSERT INTO public_cache_revision VALUES(1,${legacyRevision});`);
  const store={sql:{exec(sql,...args){statements.push(sql);const rows=db.prepare(sql).all(...args);return {toArray:()=>rows,one:()=>{assert.equal(rows.length,1);return rows[0];}};}},transactionSync(fn){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}}};
  return {db,store,statements,revision:new PublicCacheRevision(store)};
}

test('mutation barriers persist across restart and advance the generation before and after a write',()=>{
  const db=new DatabaseSync(':memory:');
  const store={sql:{exec(sql,...args){const rows=db.prepare(sql).all(...args);return {toArray:()=>rows,one:()=>rows[0]};}},transactionSync(fn){db.exec('BEGIN');try{const value=fn();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}}};
  const revision=new PublicCacheRevision(store);
  assert.deepEqual(revision.current(1000),{revision:1,pending:0});
  revision.begin('mutation-123',1000);
  assert.deepEqual(new PublicCacheRevision(store).current(1001),{revision:2,pending:1});
  revision.finish('mutation-123');assert.deepEqual(revision.current(1002),{revision:3,pending:0});
  revision.finish('mutation-123');assert.equal(revision.current(1003).revision,3);
  revision.begin('mutation-456',2000);
  assert.deepEqual(revision.current(2000+PUBLIC_MUTATION_LEASE_MS),{revision:5,pending:0});
  assert.throws(()=>revision.begin('x',3000),/identifier/);db.close();
});

test('scoped moderation leaves unrelated seeded pages usable while public reads are already at 4.6m',async()=>{
  const f=fixture(),now=Date.parse('2026-10-22T12:00:00Z');
  try {
    const budget=new ReadBudgetLedger(f.store,{day:'2026-10-22',rows:4_600_000},()=>{});
    const values=new Map(),cache=new PublicCacheState({async get(k){return values.get(k);},async put(k,v){values.set(k,v);},async delete(k){return values.delete(k);}},()=>now);
    await cache.prime(1,{word:'unrelated seeded word'},60_000,86400_000);
    f.revision.beginScoped('mutation-123',['word:1','cards:0','feed:0','explore:*'],now);
    assert.equal(budget.reserve({id:'read-denied-123',rows:50_000,tier:'public',route:'/word/2'},now).allowed,false);
    const pending=f.revision.snapshot(['word:1','word:2','cards:0','feed:0','feed:1','countries','explore:q=other'],now);
    assert.deepEqual(pending.versions,[2,1,2,2,1,1,2]);
    assert.deepEqual(pending.pending,[true,false,true,true,false,false,true]);
    assert.equal(pending.anyPending,true);
    assert.equal((await cache.get(pending.versions[1],60_000,86400_000,()=>{throw Error('D1 must remain untouched');})).state,'hit');
    f.revision.finishScoped('mutation-123');
    const after=f.revision.snapshot(['word:1','word:2'],now+1);
    assert.deepEqual(after,{revision:3,versions:[3,1],pending:[false,false],anyPending:false});
    assert.equal((await cache.get(after.versions[1],60_000,86400_000,()=>{throw Error('D1');})).value.word,'unrelated seeded word');
    assert.equal(f.revision.current(now+1).revision,1,'legacy seeded generation is not globally advanced');
  } finally {f.db.close();}
});

test('overlapping exact and family selectors merge, renew and finish without clearing another ticket',()=>{
  const f=fixture();try {
    const keys=['related:EG:ar','related:EG:franco','related:LB:ar','seo-browse:en:','seo-browse:ar:','explore:q=hello','word:9'];
    f.revision.beginScoped('country-edit',['related:EG:*','seo-browse:en:*'],1000);
    f.revision.beginScoped('word-edit-12',['related:EG:ar','explore:*'],1001);
    const first=f.revision.snapshot(keys,1002);
    assert.deepEqual(first.versions,[3,2,1,2,1,3,1]);assert.deepEqual(first.pending,[true,true,false,true,false,true,false]);
    f.revision.beginScoped('country-edit',['word:9'],2000);
    const extended=f.revision.snapshot(keys,2001);
    assert.deepEqual(extended.versions,[4,4,1,4,1,3,4]);assert.deepEqual(extended.pending,[true,true,false,true,false,true,true]);
    f.revision.finishScoped('country-edit');
    const finished=f.revision.snapshot(keys,2002);
    assert.deepEqual(finished.pending,[true,false,false,false,false,true,false]);
    assert.deepEqual(finished.versions,[5,5,1,5,1,3,5]);
    f.revision.finishScoped('country-edit');assert.equal(f.revision.snapshot([],2003).revision,5,'replayed completion does not invalidate again');
    f.revision.finishScoped('word-edit-12');assert.equal(f.revision.snapshot([],2004).anyPending,false);
  } finally {f.db.close();}
});

test('scoped expiry and restart invalidate only expired dependencies and retain the later overlapping lease',()=>{
  const f=fixture(7);try {
    f.revision.beginScoped('first-edit',['word:1','feed:*'],1000);
    f.revision.beginScoped('later-edit',['word:1','cards:8'],2000);
    const restarted=new PublicCacheRevision(f.store);
    assert.deepEqual(restarted.snapshot(['word:1','word:2','feed:0','cards:8'],1000+PUBLIC_MUTATION_LEASE_MS),
      {revision:10,versions:[10,7,10,9],pending:[true,false,false,true],anyPending:true});
    const expired=restarted.snapshot(['word:1','word:2','feed:1','cards:8'],2000+PUBLIC_MUTATION_LEASE_MS);
    assert.deepEqual(expired,{revision:11,versions:[11,7,10,11],pending:[false,false,false,false],anyPending:false});
    assert.equal(restarted.current(2001+PUBLIC_MUTATION_LEASE_MS).revision,7);
  } finally {f.db.close();}
});

test('legacy global tickets remain global across upgrade and share the monotonic scoped clock',()=>{
  const f=fixture(20);try {
    // Simulate a pending ticket written by the previous deployed version.
    f.db.prepare('INSERT INTO public_cache_mutations VALUES(?,?)').run('legacy-ticket',5000);
    const revision=new PublicCacheRevision(f.store);
    assert.deepEqual(revision.snapshot(['word:1','countries'],1000),{revision:20,versions:[20,20],pending:[true,true],anyPending:true});
    revision.beginScoped('scoped-ticket',['word:1'],1001);
    revision.finish('legacy-ticket');
    assert.deepEqual(revision.snapshot(['word:1','countries'],1002),{revision:22,versions:[22,22],pending:[true,false],anyPending:true});
    revision.finishScoped('scoped-ticket');assert.equal(revision.snapshot(['word:1'],1003).versions[0],23);
    revision.invalidate();
    assert.deepEqual(revision.snapshot(['word:1','countries'],1004),{revision:24,versions:[24,24],pending:[false,false],anyPending:false});
    revision.begin('legacy-expiry',2000);assert.equal(revision.snapshot([],2001).revision,25);
    assert.deepEqual(revision.snapshot(['word:99'],2000+PUBLIC_MUTATION_LEASE_MS),{revision:26,versions:[26],pending:[false],anyPending:false});
  } finally {f.db.close();}
});

test('ordinary snapshots perform indexed reads and no writes while still reporting pending export state',()=>{
  const f=fixture();try {
    f.revision.beginScoped('mutation-123',['word:1'],1000);
    const changes=f.db.prepare('SELECT total_changes() AS n').get().n;
    f.statements.length=0;
    for(let i=0;i<100;i++) {
      const result=f.revision.snapshot(['word:2','cards:2','related:LB:ar'],1001+i);
      assert.deepEqual(result.versions,[1,1,1]);assert.ok(result.pending.every(p=>!p));assert.equal(result.anyPending,true);
    }
    assert.equal(f.db.prepare('SELECT total_changes() AS n').get().n,changes);
    assert.ok(f.statements.every(sql=>!/^\s*(?:INSERT|DELETE|UPDATE|REPLACE|CREATE|ALTER)/i.test(sql)));
    assert.ok(f.db.prepare('EXPLAIN QUERY PLAN SELECT selector FROM public_cache_mutation_scopes WHERE selector IN (?,?)').all('word:1','word:*').some(row=>row.detail.includes('public_cache_mutation_scopes_selector')));
  } finally {f.db.close();}
});

test('selector and key validation prevents a broad wildcard or malformed scope from changing the clock',()=>{
  const f=fixture();try {
    for(const selector of ['word:*','cards:*','feed:*','explore:*','related:*','related:EG:*','seo-shard:*','seo-browse:*','seo-browse:en:*','seo-browse:ar:*','seo-dialect:*','word:12','countries','posts']) assert.equal(validPublicCacheSelector(selector),true,selector);
    for(const selector of ['*','word:1*','related:EG*','related:USA:*','seo-browse:fr:*','users:*','passwords','']) {
      assert.equal(validPublicCacheSelector(selector),false,selector);
      assert.throws(()=>f.revision.beginScoped('valid-ticket',[selector],1000),/selectors/);
    }
    assert.throws(()=>f.revision.beginScoped('short', ['word:1'],1000),/identifier/);
    assert.throws(()=>f.revision.beginScoped('valid-ticket',[],1000),/selectors/);
    assert.throws(()=>f.revision.snapshot(['word:*'],1000),/keys/);
    assert.throws(()=>f.revision.snapshot(Array.from({length:4097},()=> 'word:1'),1000),/keys/);
    assert.throws(()=>f.revision.beginScoped('valid-ticket',Array.from({length:4097},(_,i)=>'word:'+(i+1)),1000),/selectors/);
    assert.deepEqual(f.revision.snapshot(['word:1'],1000),{revision:1,versions:[1],pending:[false],anyPending:false});
  } finally {f.db.close();}
});

test('large snapshots batch their indexed lookups and preserve key order and duplicates',()=>{
  const f=fixture();try {
    const keys=Array.from({length:250},(_,i)=>'word:'+(i+1));
    f.revision.beginScoped('large-ticket',keys.filter((_,i)=>i%3===0),1000);
    const requested=[...keys,'word:1','countries'],result=f.revision.snapshot(requested,1001);
    assert.deepEqual(result.versions,requested.map(key=>key==='countries'?1:((Number(key.slice(5))-1)%3===0?2:1)));
    assert.deepEqual(result.pending,result.versions.map(version=>version===2));
    assert.equal(result.anyPending,true);
    f.revision.finishScoped('large-ticket');
    assert.ok(f.revision.snapshot(requested,1002).pending.every(value=>!value));
  } finally {f.db.close();}
});

test('exclusive word claims reject overlapping edits without durable changes and allow shared discovery selectors',()=>{
  const f=fixture();try {
    assert.equal(f.revision.claimScoped('first-word-edit',['word:1','word:2','feed:*','explore:*'],1000),true);
    const before=f.revision.snapshot(['word:1','word:2','word:3'],1001),changes=f.db.prepare('SELECT total_changes() AS n').get().n;
    f.statements.length=0;
    assert.equal(f.revision.claimScoped('overlapping-edit',['word:2','word:3','feed:*'],1002),false);
    assert.equal(f.db.prepare('SELECT total_changes() AS n').get().n,changes);
    assert.ok(f.statements.every(sql=>!/^\s*(?:INSERT|DELETE|UPDATE|REPLACE)/i.test(sql)));
    assert.deepEqual(f.revision.snapshot(['word:1','word:2','word:3'],1003),before);
    assert.equal(f.revision.claimScoped('unrelated-edit',['word:3','feed:*','explore:*'],1004),true);
    assert.deepEqual(f.revision.snapshot(['word:1','word:2','word:3','word:4'],1005).pending,[true,true,true,false]);
    assert.equal(f.revision.claimScoped('first-word-edit',['word:1','word:4'],1006),true,'same ticket may renew and extend');
    assert.equal(f.revision.claimScoped('unrelated-edit',['word:4'],1007),false,'extension cannot acquire another ticket\'s word');
    f.revision.finishScoped('first-word-edit');
    assert.equal(f.revision.claimScoped('unrelated-edit',['word:4'],1008),true);
  } finally {f.db.close();}
});

test('word claim conflicts survive restart and expiry releases only the expired lock',()=>{
  const f=fixture();try {
    assert.equal(f.revision.claimScoped('expired-word-edit',['word:1','feed:*'],1000),true);
    assert.equal(f.revision.claimScoped('later-word-edit',['word:2','feed:*'],2000),true);
    const restarted=new PublicCacheRevision(f.store),changes=f.db.prepare('SELECT total_changes() AS n').get().n;
    assert.equal(restarted.claimScoped('blocked-word-edit',['word:2'],1000+PUBLIC_MUTATION_LEASE_MS),false);
    assert.equal(f.db.prepare('SELECT total_changes() AS n').get().n,changes,'conflict does not even expire an unrelated ticket');
    assert.equal(restarted.claimScoped('replacement-edit',['word:1','feed:*'],1000+PUBLIC_MUTATION_LEASE_MS),true);
    assert.equal(restarted.claimScoped('blocked-word-edit',['word:2'],1001+PUBLIC_MUTATION_LEASE_MS),false);
    assert.equal(restarted.claimScoped('released-word-edit',['word:2'],2000+PUBLIC_MUTATION_LEASE_MS),true);
  } finally {f.db.close();}
});

test('legacy pending and broad word tickets block claims, while beginScoped retains its overlap compatibility',()=>{
  const f=fixture();try {
    f.revision.begin('legacy-mutation',1000);
    const changes=f.db.prepare('SELECT total_changes() AS n').get().n;
    assert.equal(f.revision.claimScoped('legacy-blocked',['posts'],1001),false);
    assert.equal(f.db.prepare('SELECT total_changes() AS n').get().n,changes);
    f.revision.finish('legacy-mutation');
    f.revision.beginScoped('broad-word-edit',['word:*'],1002);
    assert.equal(f.revision.claimScoped('specific-word-edit',['word:9001'],1003),false);
    assert.equal(f.revision.claimScoped('post-only-edit',['posts'],1003),true);
    f.revision.finishScoped('broad-word-edit');
    assert.equal(f.revision.claimScoped('specific-word-edit',['word:9001'],1004),true);
    assert.equal(f.revision.claimScoped('broad-word-claim',['word:*'],1005),false);
    f.revision.beginScoped('compatible-overlap',['word:9001'],1006);
    assert.equal(f.revision.snapshot(['word:9001'],1007).pending[0],true);
  } finally {f.db.close();}
});
