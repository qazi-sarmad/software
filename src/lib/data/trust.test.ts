import {describe,it,expect,vi} from 'vitest';
import {canonicalJson,computeSha256,generateInitialLedger,verifyChain} from '../ledger';
import {parsePaymentsCsv,moneyToMinor} from './population';
import {resolveDataMode} from './mode';
import {minimizeReportCounts,validateReportRelease,transmitReportDraft} from '../reporting/aiRelease';
import {sha256Bytes,verifyAuditExport,verifyEvidenceInventory} from '../reporting/export';
import fs from 'node:fs';
import path from 'node:path';
describe('trust contracts',()=>{
 it('fails closed outside explicit demo or configured Supabase modes',()=>{
  expect(resolveDataMode({PROD:true})).toBe('unconfigured');expect(resolveDataMode({DEV:true})).toBe('demo');
  expect(resolveDataMode({DEV:true,VITE_DATA_MODE:'typo'})).toBe('unconfigured');expect(resolveDataMode({VITE_DATA_MODE:'supabase'})).toBe('supabase');
 });
 it('canonicalizes key order, rejects ambiguous values and fails without secure crypto',async()=>{
  expect(canonicalJson({b:2,a:1})).toBe('{"a":1,"b":2}');
  for(const bad of [NaN,Infinity,undefined,{a:undefined},new Date(),[undefined]])expect(()=>canonicalJson(bad)).toThrow();
  const cycle:{self?:unknown}={};cycle.self=cycle;expect(()=>canonicalJson(cycle)).toThrow();
  vi.stubGlobal('crypto',{});await expect(computeSha256('a')).rejects.toThrow('unavailable');vi.unstubAllGlobals();
 });
 it('commits displayed summaries, actor names and record types',async()=>{
  const chain=await generateInitialLedger();
  for(const change of [{payloadSummary:'Fake finding'},{actorName:'Impersonated'},{recordType:'cap_item'}]){
   const altered=chain.map((e,i)=>i===0?{...e,...change}:e);
   expect((await verifyChain(altered as typeof chain)).valid).toBe(false);
  }
 });
 it('parses quotes/CRLF and preserves exact cents, rejecting duplicate keys',()=>{
  const header='id,invoice,vendor,date,amountMinor,createdBy,approvedBy,taxId\r\n';
  const row='p1,"INV,1","Vendor ""Q""",2026-10-01,101,a,b,T';
  expect(parsePaymentsCsv('\uFEFF'+header+row+'\r\n')[0]).toMatchObject({invoice:'INV,1',vendor:'Vendor "Q"',amountMinor:101});
  expect(()=>parsePaymentsCsv(header+row+'\n'+row)).toThrow('duplicate');
  expect(()=>parsePaymentsCsv(header+'p1,i,v,2026-01-01,1.5,a,b,t')).toThrow();
  expect(()=>parsePaymentsCsv(header+'"bad')).toThrow('Unclosed');
  expect(moneyToMinor('123.45')).toBe(12345);expect(()=>moneyToMinor('1e3')).toThrow();expect(()=>moneyToMinor('0.001')).toThrow();
 });
 it('suppresses entire small partitions and independently rejects additional fields',async()=>{
  expect(minimizeReportCounts({tested:100,passed:99,exceptions:1}).groups).toEqual([]);
  const payload=minimizeReportCounts({tested:100,passed:90,exceptions:10});expect(validateReportRelease(payload)).toEqual(payload);
  for(const bad of [{...payload,name:'Alice'},{...payload,groups:[{label:'Alice',count:100}]},{...payload,groups:payload.groups.map((g,i)=>i===2?{...g,count:1}:g)},{...payload,groups:payload.groups.map(g=>({...g,note:'private'}))}])expect(()=>validateReportRelease(bad)).toThrow();
  const fetchSpy=vi.spyOn(globalThis,'fetch');await expect(transmitReportDraft()).rejects.toThrow('disabled');expect(fetchSpy).not.toHaveBeenCalled();fetchSpy.mockRestore();
 });
 it('hashes exact bytes, detects modified and truncated exported chains',async()=>{
  expect(await sha256Bytes(new TextEncoder().encode('hello'))).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  const event={case_id:'c',seq:1,actor_id:'a',request_id:'r',committed_text:'',prev_hash:'0'.repeat(64),hash:''};
  event.committed_text=JSON.stringify({caseId:'c',seq:1,actorId:'a',requestId:'r',prevHash:event.prev_hash,state:{}});event.hash=await sha256Bytes(new TextEncoder().encode(event.committed_text));
  await expect(verifyAuditExport([event],{seq:1,hash:event.hash})).resolves.toBeUndefined();
  await expect(verifyAuditExport([],{seq:1,hash:event.hash})).rejects.toThrow();
  await expect(verifyAuditExport([{...event,committed_text:event.committed_text+' '}],{seq:1,hash:event.hash})).rejects.toThrow();
 });
 it('keeps SDK access in one module and report assistance outside BI/gates',()=>{
  const assertSdkBoundary=(file:string,source:string)=>{
   if(/\b(?:from|import|require)\s*(?:\(\s*)?['"]@supabase\/supabase-js['"]/.test(source) && file!=='src/lib/data/index.ts') throw new Error('SDK outside data boundary');
  };
  for (const quote of ["'", '"']) {
   const bad = `import { createClient } from ${quote}@supabase/supabase-js${quote};`;
   expect(()=>assertSdkBoundary('src/components/Forbidden.tsx',bad)).toThrow('outside data boundary');
  }
  const walk=(dir:string):string[]=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
  for(const file of walk('src').filter(f=>/\.tsx?$/.test(f)&&!f.endsWith('.test.ts'))){
   const source=fs.readFileSync(file,'utf8');
   assertSdkBoundary(file,source);
   if(/auditEngines|analytics|sampling|gate|\/bi\//i.test(file))expect(source).not.toMatch(/from .*aiRelease/);
  }
 });
});

it('checks evidence bytes and names before browser export',async()=>{
 const metadata={id:'e',name:'invoice.txt',size:5,sha256:await sha256Bytes(new TextEncoder().encode('hello'))};
 const file={...metadata,base64:btoa('hello')};
 await expect(verifyEvidenceInventory([file],[metadata])).resolves.toBeUndefined();
 await expect(verifyEvidenceInventory([{...file,base64:btoa('wrong')}],[metadata])).rejects.toThrow('integrity');
 await expect(verifyEvidenceInventory([{...file,name:'forged.txt'}],[metadata])).rejects.toThrow('integrity');
 await expect(verifyEvidenceInventory([],[metadata])).rejects.toThrow('inventory');
});
