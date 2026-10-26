# Connectors and continuous monitoring (WRITE-1, W11)

The connector framework pulls a tenant's own data into that tenant's own database, read-only. A
connector never pushes a tenant's data to a third party. Everything a connector delivers lands in a
staging table with its source hash, its run id and the fetch time argument. Nothing becomes an
observation, a claim or a finding without an auditor's review and approval (W3).

## Live-verification status

Every adapter is **fixture-verified, live-verified: NO**. No live third-party system was called: the
owner has not yet supplied credentials, and a credential must never be put in the repository. Each
adapter has a fixture suite and a contract test against a local mock server, and its catalogue entry
carries `liveVerified: false`.

The catalogue holds 22 adapters. `src/lib/writing/connectorCatalogue.ts` is the single source; the
table below is generated from it.

| Id | Label | Kind | Auth | Live-verified |
|---|---|---|---|---|
| `file-drop` | File drop (CSV, XLSX, JSON) | file_drop | none | NO |
| `sftp-pickup` | SFTP-style pickup | sftp_pickup | basic | NO |
| `signed-webhook` | Signed webhook receiver | signed_webhook | signed_hmac | NO |
| `http-rest` | HTTP REST pull | http_rest | api_key | NO |
| `database-view` | Read-only database view | database_view | database | NO |
| `sap-odata` | SAP (OData) | erp | oauth2 | NO |
| `oracle-erp` | Oracle ERP | erp | basic | NO |
| `dynamics-365` | Microsoft Dynamics 365 | erp | oauth2 | NO |
| `netsuite` | NetSuite | erp | oauth2 | NO |
| `quickbooks-online` | QuickBooks Online | erp | oauth2 | NO |
| `xero` | Xero | erp | oauth2 | NO |
| `entra-id` | Microsoft Entra ID | identity | oauth2 | NO |
| `okta` | Okta | identity | api_key | NO |
| `scim-read` | Generic SCIM read | identity | api_key | NO |
| `servicenow` | ServiceNow | itsm | basic | NO |
| `jira` | Jira | itsm | api_key | NO |
| `splunk` | Splunk | security_monitoring | api_key | NO |
| `sentinel` | Microsoft Sentinel | security_monitoring | oauth2 | NO |
| `syslog-cef` | Generic syslog / CEF receiver | security_monitoring | signed_hmac | NO |
| `datadog-events` | Datadog events | security_monitoring | api_key | NO |
| `microsoft-graph` | Microsoft Graph | productivity | oauth2 | NO |
| `google-workspace` | Google Workspace audit logs | productivity | oauth2 | NO |

## Framework

- **Interface:** `Connector` — id, version, kind, capabilities, config schema, auth kind,
  `fetch(cursor)`, health check, mapping. `src/lib/writing/connectors.ts`.
- **Instances** are per organisation. Credentials are a stored reference through the existing secret
  store (`secrets-put`); the client never sees a stored secret.
- **Egress:** a per-tenant allow-list; the SSRF and DNS-rebinding guard from `hosting-test` is reused,
  connecting to the address that passed the check with the original host as the TLS name.
- **Read-only:** the transport refuses any write method (tested).
- **Reliability:** timeouts, retry with backoff, rate limits, a cursor/checkpoint per instance,
  idempotent ingestion keyed by content hash, dedupe.
- **Mapping** is configured through dropdowns, never raw JSON.
- **Run history** records row counts and errors; health shows on the screen; failure notifications go
  through the automation engine; retention is per organisation.

## Staging and lineage

A staged record carries its source id, the fetch time argument, the source hash and the run id. It is
verifiable and drillable, and can be promoted to a population (L3 applies: no test without a verified
population). Lineage from a staged record to a figure (W4) and to a claim is queryable.

## Continuous monitoring

Monitors are rules as data: threshold, rate over a window, sequence, set membership,
missing-expected-event, and cross-source reconciliation. Each is evaluated by a pure function with the
window and the time as arguments. A triggered alert is a hash-chained record with its rule id and
version, its source records and their hashes, and a lineage. Alert triage: dismiss with a required
reason, snooze with an expiry, escalate to a DRAFT observation pre-filled through guided intake. An
alert becomes report content only through an observation that passed final approval.

Rules ship as drafts with fixtures; release requires a qualified human (the same lifecycle as
phrases). The generic `watcher.signal` catalogue key now has a real emitter.

## Owner steps to live-verify an adapter

For each adapter the owner wants live:

1. Supply a **read-only** credential with the scope named in the adapter's config schema, entered in
   the platform wizard's connector setup, never in chat and never in the repository.
2. Confirm the host is on the tenant egress allow-list.
3. Run the connector once; check the run history row count and health.
4. Confirm the staged records match the source, then promote a population and run a monitor.
