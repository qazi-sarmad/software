import type {AuditEvent} from '../data/contracts';
export async function sha256Bytes(bytes: Uint8Array):Promise<string> {
  if(!globalThis.crypto?.subtle)throw new Error('Secure SHA-256 unavailable');
  const digest=await crypto.subtle.digest('SHA-256',new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function verifyAuditExport(events:AuditEvent[],head:{seq:number;hash:string}):Promise<void> {
  let prev='0'.repeat(64);
  for(const [index,event] of events.entries()) {
    const committed=JSON.parse(event.committed_text);
    if(event.seq!==index+1 || event.prev_hash!==prev || committed.prevHash!==prev || committed.seq!==event.seq || committed.caseId!==event.case_id || committed.actorId!==event.actor_id || committed.requestId!==event.request_id || event.case_id!==events[0].case_id || await sha256Bytes(new TextEncoder().encode(event.committed_text))!==event.hash) throw new Error(`Broken event ${index+1}`);
    prev=event.hash;
  }
  if(!events.length || head.seq!==events.length || head.hash!==prev)throw new Error('Trusted head mismatch or truncated export');
}

export async function verifyEvidenceInventory(
  files: {id:string; name:string; base64:string; sha256:string}[],
  expected: {id:string; name:string; size:number; sha256:string}[],
): Promise<void> {
  if(files.length!==expected.length || new Set(files.map(f=>f.id)).size!==expected.length) throw new Error('Incomplete evidence inventory');
  for(const file of files) {
    const committed=expected.find(e=>e.id===file.id);
    const bytes=Uint8Array.from(atob(file.base64),c=>c.charCodeAt(0));
    if(!committed || file.name!==committed.name || file.sha256!==committed.sha256 || bytes.length!==committed.size || await sha256Bytes(bytes)!==committed.sha256) throw new Error('Evidence integrity failure');
  }
}
