export type Payment = { id: string; invoice: string; vendor: string; date: string; amountMinor: number; createdBy: string; approvedBy: string; taxId: string };
export type Evidence = { id: string; name: string; sha256: string; size: number };
export type Finding = { id: string; rowId: string; condition: string; criteria: string; cause: string; impact: string; recommendation: string; severity: 'low' | 'medium' | 'high' | 'critical' };
export type Retest = { by: string; at: string; outcome: 'pass' | 'fail'; note: string; evidenceId: string };
export type Issue = Finding & { status: 'open' | 'pending_validation' | 'retest_failed' | 'validated' | 'closed'; remediation?: { by: string; note: string; evidenceId: string }; retests: Retest[]; closedAt?: string };
export type Population = { sourceSha256: string; rowsSha256: string; currency: string; controlTotalMinor: number; count: number; method: 'census-v1'; floor: number; rulesVersion: 'procurement-v1'; approvalLimitMinor: number };
export type Report = { id: string; template: 'procurement-v1'; title: string; population: Population; findings: Finding[]; conclusion: string; reviewedBy: string; issuedBy: string; issuedAt: string; sourceVersion: number };
export type AuditState = { title: string; stage: 'planning' | 'testing' | 'conclusion'; status: 'draft' | 'submitted' | 'sealed' | 'issued'; preparer: string; rows: Payment[]; results: Record<string,{ outcome: 'pass' | 'exception'; note: string; evidenceId: string; testedBy: string }>; population?: Population; flags?: {rowId:string; rules:string[]}[]; findings: Finding[]; issues: Issue[]; evidence: Evidence[]; returnNote?: string; conclusion?: string; report?: Report };
export type AuditCase = { id: string; org_id: string; entity_id: string; version: number; state: AuditState };
export type AuditEntity = { id: string; org_id: string; name: string };
export type Membership = { org_id: string; role: string; user_id: string };
export type AuditEvent = { case_id: string; seq: number; actor_id: string; request_id: string; committed_text: string; prev_hash: string; hash: string };
export type IssuedAudit = { id: string; report: Report; issues: Issue[] };
export type CommandAction = 'create' | 'import_population' | 'attach_evidence' | 'test_row' | 'finding' | 'submit' | 'return' | 'seal' | 'issue' | 'remediate' | 'retest' | 'close_issue';
export type AuditCommand = { caseId: string; expectedVersion: number; key: string; action: CommandAction; data: Record<string,unknown> };
export type AuditSnapshot = { cases: AuditCase[]; entities: AuditEntity[]; memberships: Membership[]; issued: IssuedAudit[] };
export interface ProvioDataPort {
  snapshot(): Promise<AuditSnapshot>;
  command(command: AuditCommand): Promise<AuditCase>;
  events(caseId: string): Promise<AuditEvent[]>;
  evidence(id: string): Promise<{id:string; name:string; mediaType:string; sha256:string; base64:string}>;
}
