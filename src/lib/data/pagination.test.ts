import {it,expect,vi} from 'vitest';
const mock=vi.hoisted(()=>({ranges:[] as {table:string;start:number;end:number}[]}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({
 from:(table:string)=>({select:()=>({order:()=>({range:async(start:number,end:number)=>{
   mock.ranges.push({table,start,end});
   const total=table==='memberships'?1:501;
   return {data:Array.from({length:Math.max(0,Math.min(end+1,total)-start)},(_,i)=>({id:`${table}-${start+i}`})),error:null};
 }})})}),rpc:async()=>({data:[],error:null}),
})}));
import {auditData} from './index';
it('includes records beyond the first 500 in scoped snapshots',async()=>{
 vi.stubEnv('VITE_SUPABASE_URL','http://localhost:8000');vi.stubEnv('VITE_SUPABASE_ANON_KEY','synthetic');
 try {const s=await auditData.snapshot();expect(s.cases).toHaveLength(501);expect(s.entities).toHaveLength(501);expect(s.memberships).toHaveLength(1);expect(mock.ranges.some(r=>r.table==='audit_cases'&&r.start===500)).toBe(true);}finally{vi.unstubAllEnvs();}
});
