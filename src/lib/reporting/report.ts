import type { Report } from '../data/contracts';
export function renderReport(report: Report): string {
  return [
    report.title, `Report ${report.id} · ${report.template}`,
    `Issued ${report.issuedAt} by ${report.issuedBy}`,
    `Independent reviewer: ${report.reviewedBy}`,
    `Scope: ${report.population.count} payments; ${report.population.currency} ${(report.population.controlTotalMinor/100).toFixed(2)}.`,
    'Method: census, all imported rows tested. No statistical extrapolation.',
    `Rules: ${report.population.rulesVersion}; split-payment candidate threshold: ${report.population.approvalLimitMinor} minor units, per vendor/day.`,
    `Source file SHA-256 (preparer attestation): ${report.population.sourceSha256}`,
    `Committed parsed rows SHA-256: ${report.population.rowsSha256}`,
    'Conclusion',report.conclusion,
    ...report.findings.flatMap((f,i)=>[`${i+1}. ${f.severity.toUpperCase()} · source row ${f.rowId}`,`Condition: ${f.condition}`,`Criteria: ${f.criteria}`,`Cause: ${f.cause}`,`Impact: ${f.impact}`,`Recommendation: ${f.recommendation}`]),
    'Hashes establish byte integrity. They do not establish source truth or control effectiveness.',
  ].join('\n\n');
}
