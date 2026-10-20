/**
 * Cross-engagement patterns (F15, S10).
 *
 * Deterministic (L1): TF-IDF cosine similarity over finding text plus shared tags, then a
 * deterministic agglomerative clustering and a deterministic seeded graph layout. There is no
 * randomness of any kind, no AI, and no network call anywhere in this module. The similarity maths reuses the
 * one TF-IDF engine the product already has (`supabase/functions/_shared/aiPrompt`), so a finding
 * cluster and a voice sample rank agree by construction.
 */
import {
  cosineSimilarity,
  inverseDocumentFrequency,
  termFrequency,
  tokenise,
} from '../../supabase/functions/_shared/aiPrompt';

/** One finding, as `pattern_findings` returns it (0068). */
export interface PatternFinding {
  findingId: string;
  entityId: string | null;
  entityName: string | null;
  year: number | null;
  severity: string | null;
  title: string;
  conditionText: string;
  riskText: string;
  effectText: string;
  controlTags: string[];
  riskTags: string[];
  categoryTags: string[];
  entityType: string;
}

export interface PatternSettings {
  similarityThreshold: number;
  minClusterSize: number;
  yearsBack: number;
  severities: string[];
  visibilityRight: string;
}

export interface PatternCluster {
  /** Deterministic cluster id: `c1`, `c2`, ... in order of the lowest member finding id. */
  id: string;
  /** The member finding ids, in ascending id order. */
  findingIds: string[];
  /** The finding whose id sorts first, used as the cluster's representative. */
  leadFindingId: string;
  /** The mean pairwise similarity within the cluster, rounded to 4 decimals. */
  cohesion: number;
  /** Every severity seen among the members, in a stable order. */
  severities: string[];
  /** Every entity id seen among the members, in ascending order. */
  entityIds: string[];
}

export interface PatternGraphNode {
  id: string;
  label: string;
  x: number;
  y: number;
  clusterId: string | null;
  severity: string | null;
}

export interface PatternGraphEdge {
  from: string;
  to: string;
  weight: number;
}

export interface PatternGraph {
  nodes: PatternGraphNode[];
  edges: PatternGraphEdge[];
}

export interface HeatCell {
  entityId: string | null;
  entityName: string;
  bucket: string;
  count: number;
}

/**
 * The text a finding contributes to similarity: its four text fields plus its shared tags. Tags are
 * tokenised the same way as prose, so "Access Control" and "access control" agree.
 */
export function findingText(f: PatternFinding): string {
  return [
    f.title, f.conditionText, f.riskText, f.effectText,
    ...(f.controlTags ?? []), ...(f.riskTags ?? []), ...(f.categoryTags ?? []),
    f.entityType ?? '',
  ].filter(Boolean).join(' ');
}

/** Build the TF-IDF vector for every finding, keyed by finding id. Deterministic. */
export function buildVectors(findings: PatternFinding[]): Map<string, Map<string, number>> {
  const docs = findings.map((f) => tokenise(findingText(f)));
  const idf = inverseDocumentFrequency(docs);
  const out = new Map<string, Map<string, number>>();
  findings.forEach((f, i) => {
    const tokens = docs[i];
    const tf = termFrequency(tokens);
    const vec = new Map<string, number>();
    const len = tokens.length || 1;
    for (const [term, count] of tf) vec.set(term, (count / len) * (idf.get(term) ?? 0));
    out.set(f.findingId, vec);
  });
  return out;
}

/** The full pairwise cosine similarity matrix, as a lookup `a|b` with `a < b` lexicographically. */
export function similarityMatrix(
  findings: PatternFinding[], vectors?: Map<string, Map<string, number>>
): Map<string, number> {
  const vec = vectors ?? buildVectors(findings);
  const out = new Map<string, number>();
  const ids = findings.map((f) => f.findingId).sort();
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = vec.get(ids[i]) ?? new Map<string, number>();
      const b = vec.get(ids[j]) ?? new Map<string, number>();
      out.set(`${ids[i]}|${ids[j]}`, cosineSimilarity(a, b));
    }
  }
  return out;
}

/** The similarity between two findings (order-independent). */
export function pairSimilarity(
  matrix: Map<string, number>, a: string, b: string
): number {
  if (a === b) return 1;
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  return matrix.get(key) ?? 0;
}

/**
 * Cluster the findings deterministically. Single-link agglomeration: two findings join when their
 * similarity is at or above the threshold. A cluster smaller than the minimum size is dropped.
 * Clusters are ordered by their lowest member id and numbered c1, c2, ... so the output is stable.
 */
export function clusterFindings(
  findings: PatternFinding[], settings: PatternSettings, vectors?: Map<string, Map<string, number>>
): PatternCluster[] {
  const threshold = settings.similarityThreshold;
  const minSize = Math.max(2, settings.minClusterSize);
  const ids = findings.map((f) => f.findingId).sort();
  const matrix = similarityMatrix(findings, vectors);

  // Union-find over the "at or above threshold" relation.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r) as string;
    return r;
  };
  const union = (x: string, y: string): void => {
    const rx = find(x);
    const ry = find(y);
    if (rx === ry) return;
    // Always attach the larger id under the smaller, so the representative is the smallest id.
    if (rx < ry) parent.set(ry, rx); else parent.set(rx, ry);
  };
  for (const id of ids) parent.set(id, id);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (pairSimilarity(matrix, ids[i], ids[j]) >= threshold) union(ids[i], ids[j]);
    }
  }

  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const root = find(id);
    const list = groups.get(root) ?? [];
    list.push(id);
    groups.set(root, list);
  }

  const byId = new Map(findings.map((f) => [f.findingId, f]));
  const clusters: PatternCluster[] = [];
  const roots = [...groups.keys()].sort();
  for (const root of roots) {
    const members = (groups.get(root) as string[]).slice().sort();
    if (members.length < minSize) continue;
    let sum = 0;
    let pairs = 0;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        sum += pairSimilarity(matrix, members[i], members[j]);
        pairs++;
      }
    }
    const severities = [...new Set(members.map((m) => byId.get(m)?.severity ?? 'Unknown'))].sort();
    const entityIds = [...new Set(members.map((m) => byId.get(m)?.entityId).filter((x): x is string => !!x))].sort();
    clusters.push({
      id: `c${clusters.length + 1}`,
      findingIds: members,
      leadFindingId: members[0],
      cohesion: pairs === 0 ? 0 : Math.round((sum / pairs) * 10000) / 10000,
      severities,
      entityIds,
    });
  }
  return clusters;
}

/**
 * A deterministic graph layout. Nodes are placed on a ring in ascending id order (an optional
 * cluster offset spreads a cluster's members into their own arc). No randomness: the same input
 * always yields the same coordinates.
 */
export function layoutGraph(
  findings: PatternFinding[], clusters: PatternCluster[], width = 800, height = 600
): PatternGraph {
  const clusterOf = new Map<string, string>();
  for (const c of clusters) for (const id of c.findingIds) clusterOf.set(id, c.id);
  const matrix = similarityMatrix(findings);

  const sorted = [...findings].sort((a, b) => (a.findingId < b.findingId ? -1 : a.findingId > b.findingId ? 1 : 0));
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2 - 40;

  // Cluster order gives each cluster a base angle; members spread around it.
  const clusterIds = [...new Set(sorted.map((f) => clusterOf.get(f.findingId)))]
    .filter((x): x is string => !!x).sort();
  const baseAngle = new Map<string, number>();
  clusterIds.forEach((cid, i) => baseAngle.set(cid, (2 * Math.PI * i) / Math.max(1, clusterIds.length)));

  const nodes: PatternGraphNode[] = sorted.map((f) => {
    const cid = clusterOf.get(f.findingId) ?? null;
    const angle = cid
      ? (baseAngle.get(cid) as number)
      : (2 * Math.PI * sorted.indexOf(f)) / Math.max(1, sorted.length);
    return {
      id: f.findingId,
      label: f.title,
      x: Math.round((cx + radius * Math.cos(angle)) * 100) / 100,
      y: Math.round((cy + radius * Math.sin(angle)) * 100) / 100,
      clusterId: cid,
      severity: f.severity,
    };
  });

  const edges: PatternGraphEdge[] = [];
  for (const c of clusters) {
    for (let i = 0; i < c.findingIds.length; i++) {
      for (let j = i + 1; j < c.findingIds.length; j++) {
        edges.push({
          from: c.findingIds[i],
          to: c.findingIds[j],
          weight: Math.round(pairSimilarity(matrix, c.findingIds[i], c.findingIds[j]) * 10000) / 10000,
        });
      }
    }
  }
  return { nodes, edges };
}

/**
 * The heat map: findings counted by entity and by bucket. The bucket is the year when `by` is
 * 'year', else the first category tag (or "Untagged"). Deterministic ordering.
 */
export function heatMap(findings: PatternFinding[], by: 'year' | 'category' = 'year'): HeatCell[] {
  const cells = new Map<string, HeatCell>();
  for (const f of findings) {
    const bucket = by === 'year'
      ? String(f.year ?? 'Unknown')
      : (f.categoryTags && f.categoryTags.length > 0 ? [...f.categoryTags].sort()[0] : 'Untagged');
    const key = `${f.entityId ?? ''}|${bucket}`;
    const existing = cells.get(key);
    if (existing) existing.count += 1;
    else cells.set(key, {
      entityId: f.entityId, entityName: f.entityName ?? 'Unknown entity', bucket, count: 1,
    });
  }
  return [...cells.values()].sort((a, b) =>
    (a.entityName < b.entityName ? -1 : a.entityName > b.entityName ? 1 : 0)
    || (a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0));
}
