// Report-writing preparation only. No provider SDK or transmission is configured.
// No input-derived labels or free text may enter this contract.
const labels = ['tested_payments','passed_payments','exception_payments'] as const;
type Label = typeof labels[number];
export type ReportRelease = { version: 'report-aggregates-v1'; groups: {label:Label; count:number}[] };
function exactKeys(value: object, keys: string[]) {
  const actual=Object.keys(value);return actual.length===keys.length && actual.every(k=>keys.includes(k));
}
export function minimizeReportCounts(counts: {tested:number; passed:number; exceptions:number}): ReportRelease {
  if(![counts.tested,counts.passed,counts.exceptions].every(n=>Number.isSafeInteger(n)&&n>=0) || counts.passed+counts.exceptions!==counts.tested) throw new Error('Invalid counts');
  // Complementary suppression: withhold the entire partition when a small cell exists.
  const suppressed=counts.tested<10 || counts.passed<10 || counts.exceptions<10;
  return {version:'report-aggregates-v1',groups:suppressed?[]:[{label:'tested_payments',count:counts.tested},{label:'passed_payments',count:counts.passed},{label:'exception_payments',count:counts.exceptions}]};
}
export function validateReportRelease(input: unknown): ReportRelease {
  if(!input || typeof input!=='object' || !exactKeys(input,['version','groups'])) throw new Error('Invalid release schema');
  const value=input as ReportRelease;
  if(value.version!=='report-aggregates-v1' || !Array.isArray(value.groups) || ![0,3].includes(value.groups.length)) throw new Error('Invalid release schema');
  if(value.groups.some((g,i)=>!g || typeof g!=='object' || !exactKeys(g,['label','count']) || g.label!==labels[i] || !Number.isSafeInteger(g.count) || g.count<10)) throw new Error('Prohibited release content');
  if(value.groups.length && value.groups[1].count+value.groups[2].count!==value.groups[0].count) throw new Error('Inconsistent counts');
  return structuredClone(value);
}
export function previewReportRelease(input:unknown):string {return JSON.stringify(validateReportRelease(input),null,2);}
export async function transmitReportDraft():Promise<never> {
  throw new Error('AI is disabled. Destination policy, tenant authorization, and a report-only provider adapter must be configured and verified before enabling transmission.');
}
