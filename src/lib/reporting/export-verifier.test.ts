import {it,expect} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
it('offline verification rejects renamed evidence and tampered bytes',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'provio-export-test-'));
 try {
  const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
  const evidence={id:'e',name:'invoice.txt',sha256:hash('hello'),size:5};
  const event={case_id:'c',seq:1,actor_id:'a',request_id:'r',prev_hash:'0'.repeat(64),hash:'',committed_text:''};
  event.committed_text=JSON.stringify({caseId:'c',seq:1,actorId:'a',requestId:'r',prevHash:event.prev_hash,state:{evidence:[evidence]}});event.hash=hash(event.committed_text);
  const bundle={format:'provio-export-v1',caseId:'c',head:{seq:1,hash:event.hash},events:[event],evidence:[{...evidence,base64:Buffer.from('hello').toString('base64')}]};
  const file=path.join(dir,'export.json');
  const run=()=>{fs.writeFileSync(file,JSON.stringify(bundle));return spawnSync(process.execPath,['scripts/verify-audit-export.mjs',file,event.hash],{encoding:'utf8'}).status;};
  expect(run()).toBe(0);bundle.evidence[0].name='forged.txt';expect(run()).not.toBe(0);
  bundle.evidence[0].name='invoice.txt';bundle.evidence[0].base64=Buffer.from('wrong').toString('base64');expect(run()).not.toBe(0);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
