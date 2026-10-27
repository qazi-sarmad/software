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
import { DEFAULT_FORMAT_LAYOUT, applyFormat, toContentsSpec, toPdfTypography, type AppliedFormat, type FormatLayout, type RegisterChoice, type ReportFormat } from './reportFormat';
import { sha256Hex } from '../population';
import { planReport, type PlannedReport } from './planner';
import { composedText, type ComposedReport } from './compose';
import { registerKey } from './registers';
import { modelById } from './models';
import type { Claim, ClaimGraph, Register } from './types';

export interface IssueInput {
  composed: ComposedReport;
  graph: ClaimGraph;
  /** The report title, as shown on the cover. */
  title: string;
  /** The fixed timestamp: the issuance time, passed in, never read from a clock. */
  issuedAt: string;
  branding?: BrandingSpec;
  /** The report format's print layout (WP-C3). Its resolved typography decides the PDF's printed
   *  sizes and line height, so the issued PDF matches the live canvas. Absent means the defaults. */
  layout?: FormatLayout;
  /**
   * The report format itself (WP-C4). When present its order, its hidden sections, its heading labels
   * and its contents design are applied to the issued report, so a published format genuinely changes
   * the document — not only the preview. It changes presentation only: the graph root is unaffected
   * and every claim is still present unless the format hides its section.
   */
  format?: ReportFormat;
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
  const byKey = new Map(planned.bySection.map((e) => [e.section.id, e]));
  const applied = applyIssuedFormat(input.format, planned.bySection, model.defaultRegister);

  // WP-C4: the format decides the document's section order and which sections are hidden. A hidden
  // section is dropped from the file and recorded, exactly as the canvas shows it.
  const sections: DocumentSection[] = applied.blocks
    .map((b) => byKey.get(b.key))
    .filter((e): e is NonNullable<typeof e> => Boolean(e) && e!.claims.length > 0)
    .map((entry) => ({
      heading: applied.blocks.find((b) => b.key === entry.section.id)?.label || entry.section.heading,
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

  const layout = input.layout ?? input.format?.layout ?? DEFAULT_FORMAT_LAYOUT;
  const document: DocumentModel = {
    title: input.title,
    subtitle: `${model.title} · ${registerKey(input.graph.register, input.graph.locale)}`,
    sections: [...sections, { heading: 'Document control', blocks: [{ kind: 'paragraph', text: reportFooterLine(metadata) }] }],
    typography: toPdfTypography(layout),
    contents: toContentsSpec(layout),
  };
  return { document, metadata };
}

function blocksForClaim(claim: Claim, text: string): DocumentSection['blocks'] {
  if (claim.kind === 'auditor') {
    return [{ kind: 'paragraph', text: `[Auditor text, ${claim.auditorAuthor ?? 'unknown'}] ${text}` }];
  }
  return [{ kind: 'paragraph', text }];
}

/**
 * Apply a published format to the planned sections (WP-C4). The format's order and its hidden set
 * decide the document's sections and their order; a format's heading label replaces the model's
 * heading. A section the format never mentions is kept in plan order, exactly as `applyFormat` does
 * for the canvas, so a format never silently loses content. Presentation only: the claims themselves
 * are unchanged, so the graph root is unaffected. Pure.
 */
export function applyIssuedFormat(
  format: ReportFormat | undefined,
  bySection: PlannedReport['bySection'],
  modelDefault: Register,
): AppliedFormat {
  const plan = bySection.map((e) => ({ key: e.section.id, role: e.section.role, label: e.section.heading }));
  const defaultRegister: RegisterChoice = {
    formality: modelDefault.formality,
    tone: modelDefault.tone,
    voice: modelDefault.voice,
  };
  if (!format) {
    return {
      blocks: plan.map((p) => ({ key: p.key, label: p.label, role: p.role, register: defaultRegister })),
      hidden: [],
      untouched: plan.map((p) => p.key),
    };
  }
  return applyFormat(format, plan, defaultRegister);
}

/** Render the issued report to PDF bytes. The issuance time pins the PDF's own metadata, so the
 *  bytes are reproducible (W7.1) and no clock is read. The optional layout (WP-C3) decides the
 *  printed typography so the frozen PDF matches the live canvas. */
export async function issuePdf(issued: IssuedReport, branding?: BrandingSpec, layout?: FormatLayout): Promise<Uint8Array> {
  const spec = branding ?? { ...DEFAULT_BRANDING, orgId: 'org' };
  return renderPdf(spec, toPdfModel(issued.document, issued.metadata.issuedAt, toPdfTypography(layout ?? DEFAULT_FORMAT_LAYOUT)));
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
