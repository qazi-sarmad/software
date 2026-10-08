import React from 'react';
import {render,screen,act,cleanup,renderHook} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
const mock=vi.hoisted(()=>({listener:(_id:string|null)=>{},snapshot:vi.fn(),command:vi.fn()}));
vi.mock('../lib/data',()=>({
 auth:{subscribe:(fn:(id:string|null)=>void)=>{mock.listener=fn;return {unsubscribe:()=>{}};},signIn:vi.fn(),signOut:vi.fn()},
 auditData:{snapshot:mock.snapshot,command:mock.command},
}));
import {AuditDataProvider,useAuditData} from './AuditDataContext';
function View(){const s=useAuditData();return <div>{s.ready?'ready':'loading'}:{s.userId}:{s.snapshot.entities.map(e=>e.name).join(',')}</div>;}
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('preserves scoped records on token refresh and clears them on sign-out',async()=>{
 mock.snapshot.mockResolvedValue({cases:[],memberships:[],issued:[],entities:[{id:'e',org_id:'o',name:'Assigned entity'}]});
 render(<AuditDataProvider><View/></AuditDataProvider>);
 await act(async()=>mock.listener('u'));
 expect(screen.getByText('ready:u:Assigned entity')).toBeTruthy();
 await act(async()=>mock.listener('u'));
 expect(screen.getByText('ready:u:Assigned entity')).toBeTruthy();expect(mock.snapshot).toHaveBeenCalledTimes(1);
 await act(async()=>mock.listener(null));expect(screen.getByText('ready::')).toBeTruthy();
});
it('discards a late query from an identity that signed out',async()=>{
 let resolve:(v:unknown)=>void=()=>{};
 mock.snapshot.mockImplementation(()=>new Promise(r=>{resolve=r;}));
 render(<AuditDataProvider><View/></AuditDataProvider>);
 await act(async()=>mock.listener('u'));
 await act(async()=>mock.listener(null));
 await act(async()=>resolve({cases:[],memberships:[],issued:[],entities:[{id:'e',org_id:'o',name:'Old private entity'}]}));
 expect(screen.queryByText(/Old private entity/)).toBeNull();
});

it('retries an uncertain command with its original key and blocks duplicate new commands',async()=>{
 mock.snapshot.mockResolvedValue({cases:[],memberships:[],issued:[],entities:[]});
 mock.command.mockRejectedValueOnce(new Error('Network interrupted')).mockResolvedValue({});
 const h=renderHook(()=>useAuditData(),{wrapper:AuditDataProvider});
 await act(async()=>mock.listener('u'));
 const command={caseId:'c',expectedVersion:1,key:'original',action:'submit' as const,data:{}};
 await act(async()=>{await expect(h.result.current.send(command)).rejects.toThrow('Network');});
 expect(h.result.current.retryAvailable).toBe(true);
 await act(async()=>{await expect(h.result.current.send({...command,key:'new'})).rejects.toThrow('unresolved');});
 await act(async()=>{await h.result.current.retry();});
 expect(mock.command.mock.calls.map(c=>c[0].key)).toEqual(['original','original']);
 expect(h.result.current.retryAvailable).toBe(false);
});
it('keeps the post-commit refresh after a concurrent manual refresh',async()=>{
 mock.snapshot.mockResolvedValue({cases:[],memberships:[],issued:[],entities:[]});
 let resolve:()=>void=()=>{};mock.command.mockImplementation(()=>new Promise<void>(r=>{resolve=r;}));
 const h=renderHook(()=>useAuditData(),{wrapper:AuditDataProvider});await act(async()=>mock.listener('u'));
 let send:Promise<void>;
 await act(async()=>{send=h.result.current.send({caseId:'c',expectedVersion:1,key:'k',action:'submit',data:{}});});
 await act(async()=>{await h.result.current.refresh();});
 await act(async()=>{resolve();await send;});
 expect(mock.snapshot).toHaveBeenCalledTimes(3);
});
it('allows corrected commands after a definite database rejection',async()=>{
 mock.snapshot.mockResolvedValue({cases:[],memberships:[],issued:[],entities:[]});
 mock.command.mockRejectedValueOnce(Object.assign(new Error('UNTESTED_ROWS'),{definitivelyRejected:true}));
 const h=renderHook(()=>useAuditData(),{wrapper:AuditDataProvider});await act(async()=>mock.listener('u'));
 await act(async()=>{await expect(h.result.current.send({caseId:'c',expectedVersion:1,key:'k',action:'submit',data:{}})).rejects.toThrow('UNTESTED_ROWS');});
 expect(h.result.current.retryAvailable).toBe(false);
});
