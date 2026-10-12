import React,{useState} from 'react';
import {AuditDataProvider} from '../../context/AuditDataContext';
import {useScopedAuditData} from '../../hooks/useScopedData';
import {ThemeProvider} from '../../context/ThemeContext';
import {ProcurementWorkspace,download} from './ProcurementWorkspace';
import {renderReport} from '../../lib/reporting/report';
const tabs=['Executive Summary','Pending Tasks','Audit Universe','Audit Plan','SIRA','Audit File','Issues Register'];
const button='rounded-lg border border-hairline bg-surface px-3 py-2 text-primary disabled:opacity-50';
function Shell(){
 const store=useScopedAuditData();const [tab,setTab]=useState('Audit File');const [error,setError]=useState('');const [signingIn,setSigningIn]=useState(false);
 if(!store.ready)return <main className="p-8">Checking session…</main>;
 if(!store.userId)return <main className="max-w-lg mx-auto p-8 space-y-4"><h1 className="font-serif-title text-apple-28">Provio</h1><p>Sign in to your assigned audit scope.</p>
  {(error||store.error)&&<p role="alert">{error||store.error}</p>}
  <form className="space-y-3" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);setError('');setSigningIn(true);store.signIn(String(f.get('email')),String(f.get('password'))).catch(e=>setError(e.message)).finally(()=>setSigningIn(false));}}>
   <label className="block">Email<input type="email" autoComplete="username" name="email" required className="block w-full p-2 bg-surface border border-hairline rounded-lg"/></label>
   <label className="block">Password<input type="password" autoComplete="current-password" name="password" required className="block w-full p-2 bg-surface border border-hairline rounded-lg"/></label>
   <button className={button} disabled={signingIn}>Sign in</button>
  </form><p className="text-secondary">Membership and entity assignments must be provisioned by your operator. Authentication errors never load demo data.</p></main>;
 const audits=store.snapshot.cases;const issued=store.snapshot.issued;
 return <div className="min-h-screen bg-canvas text-primary"><header className="border-b border-hairline p-4 flex flex-wrap justify-between gap-3"><span className="font-serif-title text-apple-24">Provio · Procurement pilot</span><button className={button} onClick={()=>store.signOut().catch(e=>setError(e.message))}>Sign out</button></header>
  <nav aria-label="Primary navigation" className="flex flex-wrap gap-2 p-4">{tabs.map(t=><button key={t} aria-current={t===tab?'page':undefined} className={`${button} ${t===tab?'font-bold':''}`} onClick={()=>setTab(t)}>{t}</button>)}</nav>
  <main className="max-w-7xl mx-auto p-6 space-y-5">
   {error&&<p role="alert">{error}</p>}{store.error&&tab!=='Audit File'&&<p role="alert">{store.error}</p>}
   {store.retryAvailable&&<div role="status"><p>The last command was not confirmed. An identical retry is safe; permission and validation failures must be corrected.</p><button disabled={store.busy} className={button} onClick={()=>store.retry().catch(()=>{})}>Retry last command</button></div>}
   {tab==='Audit File'&&<ProcurementWorkspace/>}
   {tab==='Executive Summary'&&<section className="space-y-3"><h1 className="font-serif-title text-apple-28">Executive Summary</h1><p>{issued.length} issued reports · {issued.flatMap(a=>a.issues).filter(i=>i.status!=='closed').length} unresolved issues · {issued.flatMap(a=>a.issues).filter(i=>i.status==='closed').length} independently validated closures</p><button className={button} onClick={()=>setTab('Issues Register')}>Review issued outcomes</button></section>}
   {tab==='Pending Tasks'&&<section><h1 className="font-serif-title text-apple-28">Pending Tasks</h1>{audits.filter(a=>a.state.status!=='issued').map(a=><p key={a.id}>{a.state.title}: {a.state.status==='submitted'?'Independent review required':a.state.status==='sealed'?'CIA issuance required':'Population, testing and pre-flight required'}</p>)}</section>}
   {tab==='Audit Universe'&&<section><h1 className="font-serif-title text-apple-28">Audit Universe</h1><p>Your assigned entities</p>{store.snapshot.entities.map(e=><p key={e.id}>{e.name}</p>)}</section>}
   {['Audit Plan','SIRA'].includes(tab)&&<section><h1 className="font-serif-title text-apple-28">{tab}</h1><p>This capability is not implemented in authenticated mode. The procurement pilot is available in Audit File; annual planning and SIRA remain separate acceptance gates.</p></section>}
   {tab==='Issues Register'&&<section className="space-y-4"><h1 className="font-serif-title text-apple-28">Issues Register</h1><p>Only issued reports contribute issues here.</p>{issued.map(a=><article key={a.id} className="rounded-xl border border-hairline p-4"><h2>{a.report.title}</h2><button className={button} onClick={()=>download(`report-${a.report.id}.txt`,renderReport(a.report))}>Download issued report</button>{a.issues.map(i=><p key={i.id}>{i.severity} · {i.condition} · {i.status}</p>)}</article>)}</section>}
  </main>
 </div>;
}
export default function AuthenticatedApp(){return <ThemeProvider><AuditDataProvider><Shell/></AuditDataProvider></ThemeProvider>;}
