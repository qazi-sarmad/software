import React from 'react';
import {it,expect} from 'vitest';
import {renderHook,act,waitFor} from '@testing-library/react';
import {AppProvider,useApp} from './AppContext';
import {useScopedData} from '../hooks/useScopedData';
import {createGlassBoxTokenRecord,validateGlassBoxToken} from '../lib/glassbox';
it('rejects evidence on a sealed demo paper without changing its inventory',async()=>{
 const h=renderHook(()=>useApp(),{wrapper:AppProvider});
 await waitFor(()=>expect(h.result.current.ledger.length).toBeGreaterThan(0));
 const wp=h.result.current.rawWorkpapers.find(w=>w.sealed)!;
 await act(async()=>{await expect(h.result.current.attachEvidenceToWorkpaper(wp.id,{name:'forbidden.pdf',sizeBytes:10,sha256:'a'.repeat(64)},'QA')).rejects.toThrow('sealed');});
 expect(h.result.current.rawWorkpapers.find(w=>w.id===wp.id)?.evidenceItems).toEqual(wp.evidenceItems);
 h.unmount();
});
it('restricts CIA CAP projection to the selected universe',()=>{
 const h=renderHook(()=>useScopedData(),{wrapper:AppProvider});
 const entities=new Set(h.result.current.scopedEntities.map(e=>e.id));
 expect(h.result.current.scopedCapItems.every(c=>entities.has(c.entityId))).toBe(true);h.unmount();
});
it('expires evidence requests exactly at expiry',async()=>{
 const {rawToken,record}=await createGlassBoxTokenRecord({orgId:'o',entityId:'e',workpaperId:'w'});
 expect((await validateGlassBoxToken(rawToken,'o',[record],new Date(record.expiresAt))).valid).toBe(false);
});
it('rejects a finding whose entity differs from its validated paper',async()=>{
 const h=renderHook(()=>useApp(),{wrapper:AppProvider});
 const wp=h.result.current.rawWorkpapers.find(w=>!w.sealed)!;
 const base=h.result.current.rawObservations[0];
 await act(async()=>{await expect(h.result.current.addObservation({...base,workpaperId:wp.id,entityId:'foreign-entity'})).rejects.toThrow('scope');});
 h.unmount();
});
it('binds demo evidence attribution to the current authorized actor',async()=>{
 const h=renderHook(()=>useApp(),{wrapper:AppProvider});
 await waitFor(()=>expect(h.result.current.ledger.length).toBeGreaterThan(0));
 const wp=h.result.current.rawWorkpapers.find(w=>!w.sealed&&!h.result.current.rawEngagements.find(e=>e.id===w.engagementId)?.isLocked)!;
 await act(async()=>{await h.result.current.attachEvidenceToWorkpaper(wp.id,{name:'test.txt',sha256:'a'.repeat(64),sizeBytes:1},'Forged actor');});
 expect(h.result.current.ledger.at(-1)).toMatchObject({actorName:h.result.current.currentUser.name,actorRole:h.result.current.currentUser.role});
 expect(h.result.current.rawWorkpapers.find(w=>w.id===wp.id)?.evidenceItems.at(-1)?.uploadedBy).toBe(h.result.current.currentUser.name);
 h.unmount();
});
