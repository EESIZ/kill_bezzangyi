// Current evidence for explicitly closed, quiescent verification inputs.
// A receipt is cooperative workflow evidence, not a security signature.
import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGates, gateState, readStableRegularFile, sha256, writeAtomic } from './gates.mjs';

const scripts = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const storePath = root => join(root, '.unlazy', 'verification-receipts.json');
const ensure = (ok, why) => { if (!ok) throw new Error(why); };
export const canonical = x => JSON.stringify(x);
export function localPath(root, name) {
  ensure(typeof name === 'string' && name.length && !/[\x00-\x1f*?\[\]]/.test(name), 'literal relative input paths required');
  ensure(!isAbsolute(name) && !name.replace(/\\/g,'/').split('/').includes('..'), 'input path escapes root');
  const file=resolve(root,name), rel=relative(resolve(root),file);
  ensure(!rel.startsWith('..') && !isAbsolute(rel), 'input path escapes root');
  let p=file;
  while(p!==resolve(root)) {
    if(existsSync(p)) ensure(!lstatSync(p).isSymbolicLink(), 'linked input is unsupported');
    p=dirname(p);
  }
  return file;
}
export function readStore(root) {
  const p=storePath(root);
  if(!existsSync(p)) return {schema:1,receipts:{}};
  const s=JSON.parse(readStableRegularFile(p,{root}));
  ensure(s.schema===1 && s.receipts && typeof s.receipts==='object' && !Array.isArray(s.receipts), 'invalid verification registry');
  return s;
}
export const saveStore = (root,s) => writeAtomic(storePath(root),JSON.stringify(s,null,2)+'\n',{root});
export const ledgerKey = (root,file) => relative(resolve(root),localPath(root,file)).replace(/\\/g,'/');
export function ledger(root,file) {
  const text=readStableRegularFile(localPath(root,file),{root});
  const doc=parseGates(text);
  ensure(!doc.errors.length && doc.gates.length, 'malformed or empty gate ledger');
  return {text,doc,met:doc.gates.every(g=>gateState(g,doc.abandoned)==='met')};
}
function inventory(root,names,{excluded=[]}={}) {
  const values=new Map(); let count=0,total=0;
  const walk=file=>{
    const rel=relative(root,file).replace(/\\/g,'/');
    if(excluded.some(e=>rel===e||rel.startsWith(e+'/'))) return;
    if(!existsSync(file)){ values.set(rel,'absent');return; }
    const stat=lstatSync(file);
    ensure(!stat.isSymbolicLink(),'linked snapshot input is unsupported');
    if(stat.isDirectory()) {
      values.set(rel,'directory');
      for(const n of readdirSync(file).sort()) walk(join(file,n));
    } else {
      ensure(stat.isFile() && stat.nlink===1,'snapshot inputs must be regular single-link files');
      ensure(++count<=10000,'snapshot exceeds 10000 files');total+=stat.size;
      ensure(total<=64*1024*1024,'snapshot exceeds 64 MiB');
      // Stable reader rejects file replacement and bounds each individual read.
      const text=readStableRegularFile(file,{root,maxBytes:8*1024*1024});
      // Restrict reusable snapshots to text; decoding arbitrary binary can alias.
      ensure(!text.includes('\uFFFD') && !text.includes('\0'),'binary snapshot input is unsupported; use fresh checks');
      values.set(rel,sha256(text));
    }
  };
  for(const name of names) walk(localPath(root,name));
  return [...values].sort(([a],[b])=>a.localeCompare(b,'en'));
}
export function context(root,file,policy) {
  ensure(policy && Array.isArray(policy.inputs) && policy.inputs.length,'verification inputs are required');
  ensure(Array.isArray(policy.env) && policy.env.every(n=>/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)), 'invalid environment input');
  const key=ledgerKey(root,file);
  for(const input of policy.inputs) {
    const rel=relative(root,localPath(root,input)).replace(/\\/g,'/');
    ensure(rel!=='.unlazy' && !rel.startsWith('.unlazy/verification') && rel!=='.', 'declare artifact inputs separately from verification metadata');
    ensure(rel!=='' && rel!==key && !key.startsWith(rel+'/'),'input must not contain its own ledger');
  }
  const l=ledger(root,file);
  const scoped=key.match(/^\.unlazy\/([^/]+)\//);
  let contractRevision=null;
  if(scoped) {
    const plan=join(root,'.unlazy',scoped[1],'PLAN.md');
    if(existsSync(plan)) {
      const matches=[...readStableRegularFile(plan,{root}).matchAll(/^Contract revision:\s*([1-9]\d*)(?:\.|\s|$)/gm)];
      ensure(matches.length===1,'scope PLAN needs one contract revision');
      contractRevision=matches[0][1];
    }
  }
  const definition=l.text.replace(/^- \[[ x]\]/gm,'- [ ]').replace(/^([ \t]+EVIDENCE:).*$/gm,'$1 pending');
  const env=[...new Set(['PATH','ComSpec','UNLAZY_SHELL','NODE_OPTIONS',...policy.env])].sort().map(k=>[k,process.env[k]??null]);
  return sha256(canonical({schema:1,key,definition,contractRevision,policy,
    input:inventory(root,policy.inputs),runtime:[process.execPath,process.version,process.platform,process.arch,env],
    verifier:inventory(scripts,['.'])}));
}
export function inspectReceipt(root,file,{store,expectedPolicy}={}) {
  const key=ledgerKey(root,file),s=store||readStore(root),r=s.receipts[key];
  if(!r) return {current:false,reason:'missing-receipt',key};
  if(r.status!=='accepted') return {current:false,reason:'unfinished-verification',key};
  if(!r.policy?.closed) return {current:false,reason:'fresh-observation-required',key};
  if(expectedPolicy && canonical(expectedPolicy)!==canonical(r.policy)) return {current:false,reason:'changed-policy',key};
  const l=ledger(root,file);
  if(!l.met || sha256(l.text)!==r.ledgerHash) return {current:false,reason:'changed-ledger-or-evidence',key};
  if(context(root,file,r.policy)!==r.context) return {current:false,reason:'changed-inputs-or-verifier',key};
  return {current:true,key};
}
// Existing scopes without this receipt stay on the inherited verification path.
// Once a ledger has opted in, stale receipts must block scheduling/structure checks.
export function managedEvidenceIssue(root,file) {
  const key=ledgerKey(root,file),s=readStore(root);
  if(!s.receipts[key])return null;
  // Non-reusable executions retain the inherited fresh-verification semantics;
  // they cannot satisfy receipt audits at a later integration boundary.
  const r=s.receipts[key];
  if(r.status==='accepted' && r.policy?.closed===false) {
    const l=ledger(root,file);
    return l.met && sha256(l.text)===r.ledgerHash ? null : 'changed-ledger-or-evidence';
  }
  const result=inspectReceipt(root,file,{store:s});
  return result.current?null:result.reason;
}
