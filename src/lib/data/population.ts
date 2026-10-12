import type {Payment} from './contracts';
const columns=['id','invoice','vendor','date','amountMinor','createdBy','approvedBy','taxId'];
/** Restricted RFC4180 CSV. Currency is supplied separately; amountMinor is integer cents. */
export function parsePaymentsCsv(text:string):Payment[] {
  if(new TextEncoder().encode(text).length>2_000_000)throw new Error('Population CSV exceeds 2 MB.');
  const records:string[][]=[];let row:string[]=[];let cell='';let quoted=false;let ended=false;
  const source=text.replace(/^\uFEFF/,'');
  for(let i=0;i<source.length;i++) {
    const c=source[i];
    if(quoted){if(c==='"'){if(source[i+1]==='"'){cell+='"';i++;}else{quoted=false;ended=true;}}else cell+=c;}
    else if(c==='"'){if(cell||ended)throw new Error('Invalid CSV quote');quoted=true;}
    else if(c===',' || c==='\n' || c==='\r'){
      row.push(cell);cell='';ended=false;
      if(c!==','){records.push(row);row=[];if(c==='\r'&&source[i+1]==='\n')i++;}
    } else {if(ended)throw new Error('Unexpected characters after CSV quote');cell+=c;}
  }
  if(quoted)throw new Error('Unclosed CSV quote');
  if(cell||row.length||ended){row.push(cell);records.push(row);}
  if(JSON.stringify(records.shift())!==JSON.stringify(columns))throw new Error(`Expected header: ${columns.join(',')}`);
  if(records.length<1||records.length>1000)throw new Error('Import between 1 and 1000 payment rows.');
  const ids=new Set<string>();
  return records.map((r,index)=>{
    if(r.length!==columns.length || !/^[0-9]{1,12}$/.test(r[4]) || Number(r[4])<=0 || !r[0].trim() || ids.has(r[0]))throw new Error(`Invalid or duplicate row ${index+2}`);
    ids.add(r[0]);return {id:r[0],invoice:r[1],vendor:r[2],date:r[3],amountMinor:Number(r[4]),createdBy:r[5],approvedBy:r[6],taxId:r[7]};
  });
}
export function moneyToMinor(value:string):number {
  if(!/^\d{1,12}(\.\d{1,2})?$/.test(value))throw new Error('Enter a non-negative control total with at most two decimals.');
  const [whole,fraction='']=value.split('.');return Number(whole)*100+Number(fraction.padEnd(2,'0'));
}
export async function fileBase64(file:File):Promise<string> {
  if(file.size<1||file.size>10485760)throw new Error('Evidence must be between 1 byte and 10 MB.');
  const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
  for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(binary);
}
