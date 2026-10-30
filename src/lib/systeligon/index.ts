/**
 * Systeligon — the deterministic forensic rule engine (spec §4). Public surface.
 *
 * S1 provides the shell: the rule/definition vocabulary, the pure runner, append-only versioning, and
 * rule packs. The rule library (S6), extraction tiers (S7), the flows (S3/S4/S5/S12) and signed OTA
 * distribution (S10/S11) build on this and are not part of S1.
 */
export type {
  RuleKind, RuleTarget, RuleSeverity, RuleStatus, RuleRef,
  SysteligonRule, RuleInput, RuleContext, RuleFinding, RuleRunResult, RulePack,
  DocumentElement, ParsedDocument,
} from './types';
export { runRules, assertValidRule, assertValidPack, type RunOptions } from './runner';
export { systeligonPopulationRules } from './library';
export { RuleRegistry, ruleFingerprint, type RuleVersionRecord } from './versioning';
export { definePack, releasedRules, packRules } from './packs';
export { structuralRules, minutesRequiredElements, policyCoverage } from './rules/structural';
export {
  numericRules, duplicateRows, nearDuplicateRows, sequenceGaps, outliersZScore, outliersIqr,
  benfordFirstDigit, roundNumbers, weekendPostings, sameUserCreateApprove, missingAttributes,
} from './rules/numeric';
export { justBelowThreshold } from './rules/threshold';
export { parseDocumentStructure, hasSignature, FIELD_PARSERS, type StructuredExtraction } from './extract/structured';
export { needsOcr, runOcr, runOcrWithLanguages, type OcrEngine, type OcrText, type OcrOutcome, type ExtractionHint } from './extract/ocr';
export { bundledOcrEngine, type BundledOcrOptions } from './extract/ocrEngine';
export {
  OCR_LANGUAGES, OCR_ENGINE_CHOICES, DEFAULT_OCR_LANGUAGE,
  buildOcrEngineConfig, defaultOcrEngineConfig, ocrLanguage, packFontTables,
  type OcrLanguage, type OcrScript, type OcrDirection, type OcrFontTable, type OcrEngineConfig, type OcrEngineChoice,
} from './extract/ocrLanguages';
export { documentRules, contractSignature, approvalDate, dateAfterReport, absentFollowThrough } from './rules/documents';
export { patternRules, hardcodedCredentials, selectStar, externalCallNoErrorHandling, unboundedLoop, disabledCheck, hardcodedEnvironment } from './rules/patterns';
export { sequentialRules, actionItemRegister, policyComparison } from './rules/sequential';
export { buildActionRegister, itemHistory, type ActionAppearance, type ActionFinding, type ActionFindingKind } from './minutes';
export { compareDocuments, type MatchFinding, type ComparisonCoverage, type ComparisonResult, type MatchKind, type PassageRef } from './policydiff';
export {
  packContentHash, signPack, verifyPack, buildAdhocRule, runAdhocRule, packSigningInput,
  type SignedRulePack, type PackVerification, type PackRefusal, type AdhocRuleSpec,
} from './ota';
export {
  requiredRowsFromFindings, buildAcceptedTestingSet, applyFloor, parsePastedBlock,
  verifyCompleteness, verifyEvidence, verifyRows, carriedOverrides,
  type RowDecision, type RemarkClaim, type TestedRow, type RequiredRow, type PopulationRow,
  type EvidenceRecord, type RowVerification, type VerificationMode, type CarriedOverride,
} from './flows';
export {
  findingToClaim, findingsToClaims, type FindingClaim, type ProvenanceSet, type RefKind,
} from './provenance';
export {
  resolveReleasedRules, type ReleasedPack, type ReleasedPackRule,
} from './released';
export {
  assessDocType, docTypeMismatch, docTypeRules, DOC_KINDS, DOC_TYPE_MARKERS, ASSESSABLE_DOC_KINDS,
  type DocKind, type DocTypeVerdict, type DocTypeAssessment, type DocTypeSignal,
} from './extract/docType';
export {
  REVIEW_OPTIONS, REVIEW_OPTION_IDS, ALL_REVIEW_OPTIONS, reviewOption, resolveReviewOptions,
  rulesForOptions, type ReviewOption, type ReviewOptionId, type ReviewAnalysis,
} from './extract/reviewOptions';
