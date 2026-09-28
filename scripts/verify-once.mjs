#!/usr/bin/env node
// Run inherited checks once per declared stable input context, or audit receipts.
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, withFileLock } from './lib/gates.mjs';
import { context, inspectReceipt, ledger, ledgerKey, readStore, saveStore, storePath } from './lib/verification.mjs';

const help=`verify-once.mjs run|audit --root DIR [--inputs src,tests,package.json --closed] [--env NAME,NAME] [--approve] [--reviewed] ledger ...
run: parent-owned official checks through gate-check --reverify; --approve retains its existing inspected-command boundary.
--closed attests complete deterministic inputs, declared environment, and no concurrent writers. Without it every run is fresh and audit refuses reuse.
audit: read-only current-evidence check; no execution, approval, or mutation. Existing CHECK approval is never inferred from a receipt.
Use explicit inputs including called test scripts/configuration. Do not include the ledger or verification metadata in inputs.
Exit 0 accepted/current; 1 unmet/stale; 2 invalid/infrastructure. Native launches and writer-stop observations remain host duties.`;
try {
  const args=process.argv.slice(2);
  if(args.includes('--help')){console.log(help);process.exit(0);}
  const mode=args.shift(),options={},files=[];
  if(!['run','audit'].includes(mode))throw Error('run or audit required');
  for(let i=0;i<args.length;i++){
    const a=args[i];
    if(['--root','--inputs','--env'].includes(a)){
      if(Object.hasOwn(options,a)||!args[i+1]||args[i+1].startsWith('--'))throw Error('invalid option '+a);
      options[a]=args[++i];
    }else if(['--closed','--approve','--reviewed'].includes(a)){
      if(options[a])throw Error('duplicate option '+a);options[a]=true;
    }else if(a.startsWith('-'))throw Error('unknown option '+a);
    else files.push(a);
  }
  if(!files.length || new Set(files).size!==files.length)throw Error('unique explicit ledgers required');
  const root=resolve(options['--root']||'.');
  const names=files.map(f=>ledgerKey(root,f));
  if(new Set(names).size!==names.length)throw Error('duplicate ledger identity');
  if(mode==='audit'){
    if(Object.keys(options).some(k=>k!=='--root'))throw Error('audit accepts only --root and ledgers');
    const results=names.map(f=>inspectReceipt(root,f));
    console.log(JSON.stringify({status:results.every(r=>r.current)?'CURRENT_EVIDENCE':'STALE_EVIDENCE',results}));
    process.exit(results.every(r=>r.current)?0:1);
  }
  if(!options['--inputs'])throw Error('--inputs required; include artifacts, checks and their dependencies');
  const policy={inputs:[...new Set(options['--inputs'].split(','))].sort(),env:[...new Set((options['--env']||'').split(',').filter(Boolean))].sort(),closed:!!options['--closed']};
  const checker=join(dirname(fileURLToPath(import.meta.url)),'gate-check.mjs');
  let failed=false;
  // Per-ledger locking avoids deadlock when a branch CHECK audits its children.
  for(const file of names) await withFileLock(root,storePath(root)+'-'+sha256(file),async()=>{
    const old=inspectReceipt(root,file,{expectedPolicy:policy});
    if(old.current){console.log(JSON.stringify({status:'CURRENT_EVIDENCE',ledger:file,executed:0}));return;}
    const initial=ledger(root,file);
    if(initial.doc.gates.some(g=>!g.check) && !options['--reviewed']) {
      failed=true;console.error(JSON.stringify({status:'MANUAL_REVIEW_REQUIRED',ledger:file}));return;
    }
    const before=context(root,file,policy);
    // Pending is durable before execution; a crash never leaves the previous receipt valid.
    await withFileLock(root,storePath(root),async()=>{const s=readStore(root);s.receipts[file]={status:'pending',policy};saveStore(root,s);});
    const command=[checker,'--root',root,'--cwd',root,'--reverify',...(options['--approve']?['--approve']:[]),join(root,file)];
    const child=spawnSync(process.execPath,command,{cwd:root,encoding:'utf8',maxBuffer:2*1024*1024,windowsHide:true});
    const after=context(root,file,policy), l=ledger(root,file);
    const accepted=child.status===0 && !child.error && l.met && before===after;
    await withFileLock(root,storePath(root),async()=>{const s=readStore(root);s.receipts[file]=accepted?
      {status:'accepted',policy,context:after,ledgerHash:sha256(l.text)}:{status:'rejected',policy};saveStore(root,s);});
    if(!accepted){failed=true;console.error(JSON.stringify({status:'REVIEW_OR_REPAIR',ledger:file,exit:child.status,
      reason:before!==after?'inputs-changed-during-check':'check-not-accepted',diagnostic:String(child.stderr||child.stdout||child.error||'').slice(-3500)}));}
    else console.log(JSON.stringify({status:'ACCEPTED',ledger:file,executed:1,reusable:policy.closed}));
  });
  process.exit(failed?1:0);
}catch(error){console.error(JSON.stringify({status:'INVALID',reason:error.message}));process.exit(2);}
