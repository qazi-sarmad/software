import React, {createContext,useCallback,useContext,useEffect,useRef,useState} from 'react';
import {auditData,auth} from '../lib/data';
import type {AuditCommand,AuditSnapshot} from '../lib/data/contracts';
const empty: AuditSnapshot={cases:[],entities:[],memberships:[],issued:[]};
function useAuditStore() {
  const [userId,setUserId]=useState<string|null>(null);
  const [snapshot,setSnapshot]=useState(empty);
  const [ready,setReady]=useState(false);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const generation=useRef(0);
  const queryOrder=useRef(0);
  const identity=useRef<string|null>(null);
  const writing=useRef(false);
  const retry=useRef<AuditCommand|null>(null);
  const [retryAvailable,setRetryAvailable]=useState(false);
  useEffect(()=>{
    let active=true;
    try {
      const sub=auth.subscribe(id=>{
        if(!active) return;
        setReady(true);
        if (identity.current===id) return;
        identity.current=id;
        generation.current++;
        setUserId(id); setSnapshot(empty); retry.current=null; setRetryAvailable(false);
      });
      // Supabase emits INITIAL_SESSION; avoid a second getSession response racing sign-out.
      return ()=>{active=false;sub.unsubscribe();generation.current++;};
    } catch(e) {setError((e as Error).message);setReady(true);}
  },[]);
  const refresh=useCallback(async()=>{
    const epoch=generation.current;
    const query=++queryOrder.current;
    if(!userId) return;
    try {const next=await auditData.snapshot();if(epoch===generation.current && query===queryOrder.current){setSnapshot(next);setError('');}}
    catch(e){if(epoch===generation.current && query===queryOrder.current){setSnapshot(empty);setError((e as Error).message);}}
  },[userId]);
  useEffect(()=>{void refresh();},[refresh]);
  const send=async(command: AuditCommand)=>{
    if(writing.current) throw new Error('A command is already pending.');
    if(retry.current && retry.current.key!==command.key) throw new Error('Retry the unresolved command before submitting new changes.');
    writing.current=true;setBusy(true);setError('');
    const epoch=generation.current;
    try {
      await auditData.command(command);
      if(epoch!==generation.current) return;
      retry.current=null;setRetryAvailable(false);
      await refresh();
    } catch(e) {
      if(epoch===generation.current){
        // Unknown network outcomes retry the identical request ID and expected version.
        const rejected = e instanceof Error && 'definitivelyRejected' in e && e.definitivelyRejected === true;
        retry.current=rejected ? null : command;setRetryAvailable(!rejected);setError((e as Error).message);
      }
      throw e;
    } finally {writing.current=false;setBusy(false);}
  };
  return {userId,ready,snapshot,error,busy,refresh,send,retryAvailable,
    retry:async()=>{if(retry.current) await send(retry.current);},
    signIn:auth.signIn,signOut:async()=>{await auth.signOut();setSnapshot(empty);setUserId(null);},
    exportCase:async(id:string)=>{
      const events=await auditData.events(id);
      const last=events.at(-1);
      if(!last) throw new Error('No committed audit history.');
      const state=JSON.parse(last.committed_text).state;
      const evidence=await Promise.all(state.evidence.map((e:{id:string})=>auditData.evidence(e.id)));
      return {format:'provio-export-v1',caseId:id,head:{seq:last.seq,hash:last.hash},events,evidence};
    },
  };
}
const AuditDataContext=createContext<ReturnType<typeof useAuditStore>|null>(null);
export function AuditDataProvider({children}:{children:React.ReactNode}) {
  const store=useAuditStore(); return <AuditDataContext.Provider value={store}>{children}</AuditDataContext.Provider>;
}
export function useAuditData(){const value=useContext(AuditDataContext);if(!value)throw new Error('AuditDataProvider required');return value;}
