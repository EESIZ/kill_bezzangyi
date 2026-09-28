import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { managedEvidenceIssue } from '../scripts/lib/verification.mjs';
import { schedule } from '../scripts/lib/schedule.mjs';
const script=resolve(dirname(fileURLToPath(import.meta.url)),'../scripts/verify-once.mjs');
const tests=[];const test=(name,fn)=>tests.push({name,fn});
function fixture(fn){return()=>{
  const base=mkdtempSync(join(tmpdir(),'kill-verify-test-')),root=join(base,'workspace'),approvals=join(base,'approvals');
  mkdirSync(root);mkdirSync(approvals,{mode:0o700});mkdirSync(join(root,'src'));mkdirSync(join(root,'tests'));
  const put=(f,s)=>{mkdirSync(dirname(join(root,f)),{recursive:true});writeFileSync(join(root,f),s)};
  put('src/value.txt','good');
  put('tests/check.mjs',`import fs from 'node:fs';import assert from 'node:assert/strict';
const n=fs.existsSync('counter')?Number(fs.readFileSync('counter','utf8')):0;fs.writeFileSync('counter',String(n+1));
assert.equal(fs.readFileSync('src/value.txt','utf8'),'good');console.log('REAL_OK');\n`);
  put('GATES.md','- [ ] G1: source matches expected value\n  CHECK: node tests/check.mjs\n  EXPECT: REAL_OK\n  EVIDENCE: pending\n');
  const run=(args=[],env={})=>spawnSync(process.execPath,[script,...args],{cwd:root,encoding:'utf8',env:{...process.env,UNLAZY_APPROVAL_DIR:approvals,...env},timeout:20000});
  const accept=(extra=[])=>run(['run','--inputs','src,tests','--closed','--approve',...extra,'GATES.md']);
  const audit=()=>run(['audit','GATES.md']);
  const count=()=>existsSync(join(root,'counter'))?Number(readFileSync(join(root,'counter'),'utf8')):0;
  try{fn({root,put,run,accept,audit,count});}finally{
    assert(resolve(base).startsWith(resolve(tmpdir())+sep));assert(base.includes('kill-verify-test-'));
    rmSync(base,{recursive:true,force:true});
  }
};}
const ok=r=>assert.equal(r.status,0,r.stdout+'\n'+r.stderr);
test('one actual independent run, subsequent process reuses, audit is read only',fixture(f=>{
  ok(f.accept());assert.equal(f.count(),1);ok(f.accept());ok(f.audit());assert.equal(f.count(),1);
}));
test('changed source invalidates and failed rerun never keeps prior success',fixture(f=>{
  ok(f.accept());f.put('src/value.txt','bad');assert.equal(f.audit().status,1);
  assert.equal(f.accept().status,1);assert.equal(f.audit().status,1);assert.equal(f.count(),2);
  f.put('src/value.txt','good');ok(f.accept());assert.equal(f.count(),3);
}));
test('called test script mutation invalidates',fixture(f=>{
  ok(f.accept());f.put('tests/check.mjs',"console.log('REAL_OK');\n");assert.equal(f.audit().status,1);
}));
test('new dependency file in declared directory invalidates',fixture(f=>{
  ok(f.accept());f.put('src/extra.txt','new');assert.equal(f.audit().status,1);
}));
test('changed definition invalidates even if old checkbox remains',fixture(f=>{
  ok(f.accept());f.put('GATES.md',readFileSync(join(f.root,'GATES.md'),'utf8').replace('source matches','updated source matches'));
  assert.equal(f.audit().status,1);
}));
test('manual obligation blocks acceptance until explicit evidence, then mutation invalidates',fixture(f=>{
  f.put('GATES.md',readFileSync(join(f.root,'GATES.md'),'utf8')+'\n- [ ] M1: reviewed behavior\n  EVIDENCE: pending\n');
  assert.equal(f.accept().status,1);
  f.put('GATES.md',readFileSync(join(f.root,'GATES.md'),'utf8').replace('- [ ] M1: reviewed behavior\n  EVIDENCE: pending','- [x] M1: reviewed behavior\n  EVIDENCE: parent inspected behavior'));
  assert.equal(f.accept().status,1);ok(f.accept(['--reviewed']));f.put('src/extra.txt','changed');assert.equal(f.audit().status,1);
  assert.equal(f.accept().status,1);
}));
test('without closed input attestation run is fresh and audit refuses reuse',fixture(f=>{
  const args=['run','--inputs','src,tests','--approve','GATES.md'];
  ok(f.run(args));ok(f.run(args));assert.equal(f.count(),2);assert.equal(f.audit().status,1);
}));
test('declared environment change invalidates',fixture(f=>{
  ok(f.run(['run','--inputs','src,tests','--closed','--env','VERIFY_TEST_ENV','--approve','GATES.md'],{VERIFY_TEST_ENV:'a'}));
  assert.equal(f.run(['audit','GATES.md'],{VERIFY_TEST_ENV:'b'}).status,1);
}));
test('unapproved oracle is not executed',fixture(f=>{
  assert.equal(f.run(['run','--inputs','src,tests','--closed','GATES.md']).status,1);assert.equal(f.count(),0);
}));
test('mutation during a passing check rejects reusable evidence',fixture(f=>{
  f.put('tests/check.mjs',"import fs from 'node:fs';fs.writeFileSync('src/value.txt','changed');console.log('REAL_OK');\n");
  assert.equal(f.accept().status,1);assert.equal(f.audit().status,1);
}));
test('pending crash record is not accepted evidence',fixture(f=>{
  ok(f.accept());const p=join(f.root,'.unlazy/verification-receipts.json');const s=JSON.parse(readFileSync(p,'utf8'));
  s.receipts['GATES.md'].status='pending';writeFileSync(p,JSON.stringify(s));assert.equal(f.audit().status,1);
  ok(f.accept());assert.equal(f.count(),2);
}));
test('path escape and own-ledger input are rejected',fixture(f=>{
  assert.equal(f.run(['run','--inputs','../outside','--closed','GATES.md']).status,2);
  assert.equal(f.run(['run','--inputs','GATES.md','--closed','GATES.md']).status,2);
}));
test('abandoned obligations cannot become accepted',fixture(f=>{
  f.put('GATES.md',readFileSync(join(f.root,'GATES.md'),'utf8')+'ABANDON: G1 impossible\n');
  assert.equal(f.accept().status,1);assert.equal(f.audit().status,1);
}));
test('managed stale leaf blocks ready successors in actual scheduler',fixture(f=>{
  f.put('.unlazy/p/gates/leaf-1.md','OWNS: src/**\n'+readFileSync(join(f.root,'GATES.md'),'utf8'));
  f.put('.unlazy/p/gates/leaf-2.md','OWNS: next/**\n- [ ] G1: next outcome\n  EVIDENCE: pending\n');
  f.put('.unlazy/p/PLAN.md','Contract revision: 1.\n| Leaf | Owns | Needs | Tier | Planned wave | State |\n|---|---|---|---|---|---|\n| 1 | src/** | - | mechanical | 1 | VERIFIED |\n| 2 | next/** | 1 | mechanical | 2 | WAITING |\n');
  f.put('.unlazy/p/ACCESS.json',JSON.stringify({schema:1,contractRevision:1,leaves:{1:{complete:true,reads:[],resourceReads:[],resourceWrites:[]},2:{complete:true,reads:[],resourceReads:[],resourceWrites:[]}}}));
  ok(f.run(['run','--inputs','src,tests','--closed','--approve','.unlazy/p/gates/leaf-1.md']));
  assert.deepEqual(schedule({root:f.root,scope:'p',slots:3}).launch,['2']);
  const plan=readFileSync(join(f.root,'.unlazy/p/PLAN.md'),'utf8');
  f.put('.unlazy/p/PLAN.md',plan.replace('revision: 1.','revision: 2.'));
  assert.equal(f.run(['audit','.unlazy/p/gates/leaf-1.md']).status,1);
  f.put('.unlazy/p/PLAN.md',plan);
  f.put('src/value.txt','bad');const r=schedule({root:f.root,scope:'p',slots:3});assert.equal(r.action,'review');assert.deepEqual(r.launch,[]);
}));
let passed=0;for(const t of tests){try{t.fn();passed++;console.log('ok '+t.name);}catch(e){console.error('FAIL '+t.name+'\n'+e.stack);process.exitCode=1;}}
console.log(`verification-tests ${passed}/${tests.length}`);
