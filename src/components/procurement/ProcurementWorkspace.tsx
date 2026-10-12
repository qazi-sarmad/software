import React,{useState} from 'react';
import {useScopedAuditData} from '../../hooks/useScopedData';
import type {AuditCase,CommandAction,Finding} from '../../lib/data/contracts';
import {fileBase64,moneyToMinor,parsePaymentsCsv} from '../../lib/data/population';
import {sha256Bytes,verifyAuditExport,verifyEvidenceInventory} from '../../lib/reporting/export';
import {renderReport} from '../../lib/reporting/report';
import {minimizeReportCounts,previewReportRelease} from '../../lib/reporting/aiRelease';
const field='block w-full rounded-lg border border-hairline bg-surface p-2 text-primary';
const button='rounded-lg border border-hairline bg-surface px-3 py-2 text-primary disabled:opacity-50';
export function download(name:string,text:string,type='text/plain'){
  const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function ProcurementWorkspace(){
 const store=useScopedAuditData();const [selected,setSelected]=useState('');const [error,setError]=useState('');
 const run=async(work:()=>Promise<void>)=>{setError('');try{await work();}catch(e){setError((e as Error).message);}};
 const current=store.snapshot.cases.find(c=>c.id===selected);
 return <section className="space-y-5" aria-label="Procurement audit workspace">
  <h1 className="font-serif-title text-apple-28">Audit File</h1>
  <p>Procurement and payments assurance · Every conclusion links to a committed population, results and evidence.</p>
  {(error||store.error)&&<p role="alert" className="text-cinnabar">{error||store.error}</p>}
  <div className="flex flex-wrap gap-3"><label>Engagement<select className={field} value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Select an engagement</option>{store.snapshot.cases.map(c=><option key={c.id} value={c.id}>{c.state.title} · v{c.version}</option>)}</select></label><button className={button} onClick={()=>void store.refresh()}>Refresh records</button></div>
  <details className="rounded-xl border border-hairline p-4"><summary>Create procurement engagement</summary>
   <form className="mt-3 grid gap-3" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void run(async()=>{
    const entity=store.snapshot.entities.find(x=>x.id===f.get('entity'));if(!entity)throw new Error('Choose an assigned entity');
    const id=crypto.randomUUID();await store.send({caseId:id,expectedVersion:0,key:crypto.randomUUID(),action:'create',data:{orgId:entity.org_id,entityId:entity.id,title:f.get('title')}});setSelected(id);
   });}}>
   <label>Entity<select required name="entity" className={field}><option value="">Select</option>{store.snapshot.entities.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
   <label>Engagement title<input name="title" required minLength={3} maxLength={200} className={field}/></label><button disabled={store.busy || store.retryAvailable} className={button}>Create</button>
   </form>
  </details>
  {current&&<CaseWorkspace key={current.id} audit={current} run={run}/>}
 </section>;
}
function CaseWorkspace({audit,run}:{audit:AuditCase;run:(work:()=>Promise<void>)=>Promise<void>}){
 const store=useScopedAuditData();const s=audit.state;const [rowId,setRowId]=useState('');const [preview,setPreview]=useState('');
 const command=async(action:CommandAction,data:Record<string,unknown>={})=>store.send({caseId:audit.id,expectedVersion:audit.version,key:crypto.randomUUID(),action,data});
 const role=store.snapshot.memberships.find(m=>m.org_id===audit.org_id)?.role;
 const preparer=store.userId===s.preparer&&['preparer','audit_manager','cia'].includes(role??'');
 const reviewer=store.userId!==s.preparer&&['reviewer','audit_manager','cia'].includes(role??'');
 const evidenceOptions=s.evidence.map(e=><option key={e.id} value={e.id}>{e.name} · {e.sha256.slice(0,12)}</option>);
 const result=s.results[rowId];
 const upload=async(file:File)=>{await command('attach_evidence',{name:file.name,mediaType:file.type||'text/plain',base64:await fileBase64(file)});};
 return <div className="space-y-5">
  <header className="rounded-xl border border-hairline p-4"><h2 className="text-apple-20">{s.title}</h2><p>{s.stage} · {s.status} · version {audit.version}</p>{s.returnNote&&<p>Reviewer return: {s.returnNote}</p>}</header>
  <div className="flex flex-wrap gap-3"><button className={button} disabled={store.busy || store.retryAvailable} onClick={()=>void run(async()=>{const bundle=await store.exportCase(audit.id);await verifyAuditExport(bundle.events,bundle.head);await verifyEvidenceInventory(bundle.evidence,JSON.parse(bundle.events.at(-1)!.committed_text).state.evidence);download(`provio-${audit.id}.json`,JSON.stringify(bundle,null,2),'application/json');})}>Export verified history and evidence</button>
  {s.report&&<button className={button} onClick={()=>download(`report-${s.report!.id}.txt`,renderReport(s.report!))}>Download issued report</button>}</div>
  <p className="text-secondary">This pilot supports 1–1,000 positive payments in one currency with two decimal minor units. Method: census, all rows tested. Split-payment candidates use a disclosed 10,000.00 per-vendor, per-day limit; a flag requires human investigation.</p>
  {s.population&&<p>Reconciled: {s.population.count} rows · {s.population.currency} {(s.population.controlTotalMinor/100).toFixed(2)} · {Object.keys(s.results).length} tested. Parsed-row hash: <code className="break-all">{s.population.rowsSha256}</code></p>}
  {preparer&&s.status==='draft'&&<form className="space-y-3 rounded-xl border border-hairline p-4" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void run(async()=>{
   const file=f.get('population') as File;if(!file?.size)throw new Error('Select a CSV');
   if(file.size>2_000_000)throw new Error('Population CSV exceeds 2 MB');
   const bytes=new Uint8Array(await file.arrayBuffer());const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
   await command('import_population',{rows:parsePaymentsCsv(text),sourceSha256:await sha256Bytes(bytes),currency:f.get('currency'),controlTotalMinor:moneyToMinor(String(f.get('total')))});
  });}}><h3>Import and reconcile population</h3>
  <p>Replacing a population clears draft results and findings; earlier versions remain in history.</p>
  <code className="block overflow-x-auto">id,invoice,vendor,date,amountMinor,createdBy,approvedBy,taxId</code>
  <label>CSV file (UTF-8)<input name="population" type="file" accept=".csv" required className={field}/></label>
  <label>Currency (ISO code; two decimal minor units)<input name="currency" defaultValue="USD" pattern="[A-Z]{3}" required className={field}/></label>
  <label>Independent control total<input name="total" inputMode="decimal" required className={field}/></label>
  <button className={button} disabled={store.busy || store.retryAvailable}>Validate and commit population</button></form>}
  {['draft','issued'].includes(s.status)&&['preparer','audit_manager','cia'].includes(role??'')&&<label className="block rounded-xl border border-hairline p-4">Attach evidence (PDF, PNG, CSV or text, ≤10 MB)<input type="file" accept=".pdf,.png,.csv,.txt" disabled={store.busy || store.retryAvailable} className={field} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void run(()=>upload(file));}}/><span className="text-secondary">Files are stored privately and hashed by the database. Downloads are included in the audit export.</span></label>}
  <div className="overflow-x-auto"><table className="w-full text-left text-apple-13"><caption className="text-left">Population and deterministic flags</caption><thead><tr><th>Row</th><th>Invoice</th><th>Amount</th><th>Flags</th><th>Result</th></tr></thead><tbody>{s.rows.map(r=><tr key={r.id} className="border-t border-hairline"><td><button className={button} onClick={()=>setRowId(r.id)}>{r.id}</button></td><td>{r.invoice}</td><td>{(r.amountMinor/100).toFixed(2)}</td><td>{s.flags?.find(f=>f.rowId===r.id)?.rules.join(', ')||'None'}</td><td>{s.results[r.id]?.outcome||'Untested'}</td></tr>)}</tbody></table></div>
  {preparer&&s.status==='draft'&&rowId&&s.rows.some(r=>r.id===rowId)&&<div className="space-y-4">
   <form key={`${rowId}-${audit.version}`} className="space-y-3 rounded-xl border border-hairline p-4" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void run(()=>command('test_row',{rowId,outcome:f.get('outcome'),note:f.get('note'),evidenceId:f.get('evidence')}));}}>
    <h3>Test row {rowId}</h3><label>Outcome<select name="outcome" defaultValue={result?.outcome} className={field}><option value="pass">Pass</option><option value="exception">Exception</option></select></label>
    <label>Rationale, including disposition of each BI flag<textarea name="note" defaultValue={result?.note} minLength={10} maxLength={4000} required className={field}/></label>
    <label>Supporting evidence<select name="evidence" defaultValue={result?.evidenceId} required className={field}><option value="">Select</option>{evidenceOptions}</select></label><button className={button} disabled={store.busy || store.retryAvailable}>Save test result</button>
   </form>
   <form className="space-y-3 rounded-xl border border-hairline p-4" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void run(()=>command('finding',{...Object.fromEntries(f),rowId}));}}><h3>Finding for row {rowId}</h3>
    {(['condition','criteria','cause','impact','recommendation'] as (keyof Finding)[]).map(k=><label className="block capitalize" key={k}>{k}<textarea name={k} required minLength={10} maxLength={4000} className={field}/></label>)}
    <label>Severity<select name="severity" className={field}>{['low','medium','high','critical'].map(x=><option key={x}>{x}</option>)}</select></label><button disabled={store.busy || store.retryAvailable} className={button}>Save draft finding</button>
   </form>
  </div>}
  <section><h3>Findings ({s.findings.length})</h3>{s.findings.map(f=><p key={f.id}>{f.rowId} · {f.severity}: {f.condition}</p>)}</section>
  {preparer&&s.status==='draft'&&<button disabled={store.busy || store.retryAvailable} className={button} onClick={()=>void run(()=>command('submit'))}>Run pre-flight and submit for review</button>}
  {reviewer&&s.status==='submitted'&&<>
   <details><summary>Review the committed tests, evidence references and five-part findings</summary><pre className="whitespace-pre-wrap break-all text-apple-12">{JSON.stringify({results:s.results,evidence:s.evidence,findings:s.findings},null,2)}</pre></details>
   <form className="space-y-3" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);const action=f.get('action') as 'seal'|'return';void run(()=>command(action,{conclusion:f.get('note'),note:f.get('note')}));}}><label>Independent review conclusion / return reason<textarea name="note" minLength={10} maxLength={4000} required className={field}/></label><label>Decision<select name="action" className={field}><option value="return">Return for correction</option><option value="seal">Approve and seal</option></select></label><button disabled={store.busy || store.retryAvailable} className={button}>Commit review decision</button></form>
  </>}
  {role==='cia'&&s.status==='sealed'&&<button className={button} disabled={store.busy || store.retryAvailable} onClick={()=>void run(()=>command('issue'))}>Issue immutable template report and linked issues</button>}
  {s.report&&<pre className="whitespace-pre-wrap [overflow-wrap:anywhere] rounded-xl border border-hairline p-4">{renderReport(s.report)}</pre>}
  {s.issues.map(issue=><section className="rounded-xl border border-hairline p-4 space-y-3" key={issue.id}><h3>{issue.condition}</h3><p>Status: {issue.status} · {issue.retests.length} recorded retests</p>
   {issue.status!=='closed'&&<form className="space-y-3" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void run(()=>command(f.get('action') as CommandAction,{issueId:issue.id,note:f.get('note'),outcome:f.get('outcome'),evidenceId:f.get('evidence')}));}}>
    <label>Action<select name="action" className={field}><option value="remediate">Submit corrective action</option><option value="retest">Record independent retest</option><option value="close_issue">Close validated issue</option></select></label>
    <label>Retest outcome<select name="outcome" className={field}><option value="fail">Fail</option><option value="pass">Pass</option></select></label>
    <label>Action / retest rationale<textarea name="note" minLength={10} maxLength={4000} className={field}/></label>
    <label>Evidence<select name="evidence" className={field}><option value="">Select</option>{evidenceOptions}</select></label><button disabled={store.busy || store.retryAvailable} className={button}>Commit issue action</button>
   </form>}
   {issue.retests.map((r,i)=><p key={i}>{r.at} · {r.outcome} · {r.note}</p>)}
  </section>)}
  <details><summary>Optional AI report assistance — disabled</summary><p>Template reports work without inference. This preview contains only controlled aggregate labels. Small partitions are fully suppressed; this does not guarantee anonymity. No transmission destination is configured.</p><button className={button} onClick={()=>{const results=Object.values(s.results);setPreview(previewReportRelease(minimizeReportCounts({tested:results.length,passed:results.filter(r=>r.outcome==='pass').length,exceptions:results.filter(r=>r.outcome==='exception').length})));}}>Preview minimized release</button>{preview&&<pre>{preview}</pre>}</details>
 </div>;
}
