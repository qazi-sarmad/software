// Offline verifier: node scripts/verify-audit-export.mjs export.json [trusted-head-hash]
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const file=process.argv[2];
if(!file)throw new Error('Usage: node scripts/verify-audit-export.mjs export.json [trusted-head-hash]');
const bundle=JSON.parse(fs.readFileSync(file,'utf8'));
if(bundle.format!=='provio-export-v1'||!Array.isArray(bundle.events)||!bundle.events.length)throw new Error('Invalid export');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
let previous='0'.repeat(64);
for(const [i,event] of bundle.events.entries()){
 const data=JSON.parse(event.committed_text);
 if(event.seq!==i+1||event.case_id!==bundle.caseId||data.caseId!==bundle.caseId||data.seq!==i+1||data.prevHash!==previous||event.prev_hash!==previous||event.actor_id!==data.actorId||event.request_id!==data.requestId||digest(event.committed_text)!==event.hash)throw new Error(`Broken event ${i+1}`);
 previous=event.hash;
}
if(bundle.head.seq!==bundle.events.length||bundle.head.hash!==previous)throw new Error('Export head mismatch');
if(process.argv[3]&&process.argv[3]!==previous)throw new Error('Trusted head mismatch');
const expected=JSON.parse(bundle.events.at(-1).committed_text).state.evidence;
if(bundle.evidence.length!==expected.length||new Set(bundle.evidence.map(e=>e.id)).size!==expected.length)throw new Error('Incomplete evidence');
for(const file of bundle.evidence){
 const metadata=expected.find(e=>e.id===file.id);const bytes=Buffer.from(file.base64,'base64');
 if(!metadata||file.name!==metadata.name||file.sha256!==metadata.sha256||digest(bytes)!==metadata.sha256||bytes.length!==metadata.size)throw new Error('Evidence integrity failure');
}
console.log(`Verified ${bundle.events.length} events and ${bundle.evidence.length} evidence files. ${process.argv[3]?'Trusted head matched.':'No independent head supplied; tail deletion cannot be excluded.'}`);
