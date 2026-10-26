/**
 * W7: rendering and reproducibility.
 *
 * The same graph, model, register, locale, versions and fixed timestamp must produce byte-identical
 * files. This module turns a composed report into the shared DocumentModel the existing PDF and DOCX
 * renderers already take (C2.7), embeds the graph root, render hash and version identifiers in the
 * document metadata and in a visible footer line, and hashes the bytes. It reads no clock and no
 * random source: the timestamp is an argument.
 */

import { DEFAULT_BRANDING, type BrandingSpec } from '../render/branding';
import { renderPdf } from '../render/pdf';
import { renderDocx, documentPlainText } from '../render/docx';
import { toPdfModel, type DocumentModel, type DocumentSection } from '../render/document';
import { sha256Hex } from '../population';
import { planReport, type PlannedReport } from './planner';
import { composedText, type ComposedReport } from './compose';
import { registerKey } from './registers';
import { modelById } from './models';
import type { Claim, ClaimGraph } from './types';

export interface IssueInput {
  composed: ComposedReport;
  graph: ClaimGraph;
  /** The report title, as shown on the cover. */
  title: string;
  /** The fixed timestamp: the issuance time, passed in, never read from a clock. */
  issuedAt: string;
  branding?: BrandingSpec;
}

export interface IssuedReport {
  /** The one document model every renderer consumes, so the PDF and DOCX carry the same words. */
  document: DocumentModel;
  /** The metadata block embedded in every file and shown in the footer line. */
  metadata: ReportMetadata;
}

export interface ReportMetadata {
  graphRoot: string;
  renderHash: string;
  engineVersion: string;
  templateVersion: string;
  phraseLibraryVersion: string;
  modelId: string;
  formality: number;
  tone: number;
  voice: string;
  locale: string;
  issuedAt: string;
}

/** The footer line the issued report carries: the hashes and versions, in plain words. */
export function reportFooterLine(metadata: ReportMetadata): string {
  return `Graph root ${metadata.graphRoot.slice(0, 16)} · Render hash ${metadata.renderHash.slice(0, 16)} `
    + `· Engine ${metadata.engineVersion} · Template ${metadata.templateVersion} `
    + `· Phrases ${metadata.phraseLibraryVersion} · ${metadata.modelId} ${metadata.locale} `
    + `F${metadata.formality}/T${metadata.tone}/${metadata.voice} · Issued ${metadata.issuedAt}`;
}

/**
 * Build the one document model from a composed report and its graph. The sections come from the
 * document plan, so the file order matches the plan; each rendered claim is one paragraph, and
 * auditor text is labelled (W5.4).
 */
export function issueDocument(input: IssueInput): IssuedReport {
  const model = modelById(input.graph.modelId);
  if (!model) throw new Error(`unknown model: ${input.graph.modelId}`);
  const planned: PlannedReport = planReport({
    modelId: input.graph.modelId,
    register: input.graph.register,
    locale: input.graph.locale,
    claims: input.graph.claims,
    versions: input.graph.versions,
  });

  const renderedByClaim = new Map(input.composed.rendered.map((r) => [r.claimId, r]));
  const sections: DocumentSection[] = planned.bySection
    .filter((entry) => entry.claims.length > 0)
    .map((entry) => ({
      heading: entry.section.heading,
      blocks: entry.claims.flatMap((claim) => blocksForClaim(claim, renderedByClaim.get(claim.id)?.text ?? '')),
    }));

  const metadata: ReportMetadata = {
    graphRoot: input.composed.hashes.graphRoot,
    renderHash: input.composed.renderHash,
    engineVersion: input.graph.versions.engine,
    templateVersion: input.graph.versions.template,
    phraseLibraryVersion: input.graph.versions.phraseLibrary,
    modelId: input.graph.modelId,
    formality: input.graph.register.formality,
    tone: input.graph.register.tone,
    voice: input.graph.register.voice,
    locale: input.graph.locale,
    issuedAt: input.issuedAt,
  };

  const document: DocumentModel = {
    title: input.title,
    subtitle: `${model.title} · ${registerKey(input.graph.register, input.graph.locale)}`,
    sections: [...sections, { heading: 'Document control', blocks: [{ kind: 'paragraph', text: reportFooterLine(metadata) }] }],
  };
  return { document, metadata };
}

function blocksForClaim(claim: Claim, text: string): DocumentSection['blocks'] {
  if (claim.kind === 'auditor') {
    return [{ kind: 'paragraph', text: `[Auditor text, ${claim.auditorAuthor ?? 'unknown'}] ${text}` }];
  }
  return [{ kind: 'paragraph', text }];
}

/** Render the issued report to PDF bytes. */
export async function issuePdf(issued: IssuedReport, branding?: BrandingSpec): Promise<Uint8Array> {
  const spec = branding ?? { ...DEFAULT_BRANDING, orgId: 'org' };
  return renderPdf(spec, toPdfModel(issued.document));
}

/** Render the issued report to DOCX bytes. */
export async function issueDocx(issued: IssuedReport): Promise<Uint8Array> {
  return renderDocx(issued.document);
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return sha256Hex(buf);
}

export interface RenderedIssue {
  pdf: Uint8Array;
  docx: Uint8Array;
  pdfHash: string;
  docxHash: string;
}

/** Render both formats and hash the bytes. */
export async function renderIssue(issued: IssuedReport, branding?: BrandingSpec): Promise<RenderedIssue> {
  const pdf = await issuePdf(issued, branding);
  const docx = await issueDocx(issued);
  return { pdf, docx, pdfHash: await hashBytes(pdf), docxHash: await hashBytes(docx) };
}

export { composedText, documentPlainText };
