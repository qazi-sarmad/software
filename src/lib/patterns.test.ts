import { describe, expect, it } from 'vitest';
import {
  buildVectors, clusterFindings, findingText, heatMap, layoutGraph, pairSimilarity, similarityMatrix,
  type PatternFinding, type PatternSettings,
} from './patterns';

const settings: PatternSettings = {
  similarityThreshold: 0.40, minClusterSize: 2, yearsBack: 5, severities: [], visibilityRight: 'view_insights',
};

function finding(over: Partial<PatternFinding> & { findingId: string }): PatternFinding {
  return {
    entityId: 'e1', entityName: 'Entity one', year: 2026, severity: 'High', title: 'Access control',
    conditionText: '', riskText: '', effectText: '', controlTags: [], riskTags: [], categoryTags: [],
    entityType: 'application', ...over,
  };
}

describe('findingText', () => {
  it('joins the four text fields and the tags', () => {
    const t = findingText(finding({ findingId: 'f1', controlTags: ['Access Control'], riskTags: ['Fraud'] }));
    expect(t).toContain('Access control');
    expect(t).toContain('Access Control');
    expect(t).toContain('Fraud');
  });
  it('drops empty fields', () => {
    expect(findingText(finding({ findingId: 'f1', title: 'T', conditionText: '', riskText: '', effectText: '' })))
      .toBe('T application');
  });
});

describe('buildVectors', () => {
  it('produces one vector per finding', () => {
    const v = buildVectors([finding({ findingId: 'f1' }), finding({ findingId: 'f2' })]);
    expect(v.size).toBe(2);
    expect(v.get('f1')).toBeInstanceOf(Map);
  });
});

describe('similarityMatrix / pairSimilarity', () => {
  const findings = [
    finding({ findingId: 'f1', title: 'Weak access control in payments', conditionText: 'access control is weak' }),
    finding({ findingId: 'f2', title: 'Access control weakness', conditionText: 'access control in payments is weak' }),
    finding({ findingId: 'f3', title: 'Segregation of duties', conditionText: 'duties are not segregated' }),
  ];

  it('is symmetric and order-independent', () => {
    const m = similarityMatrix(findings);
    expect(pairSimilarity(m, 'f1', 'f2')).toBeCloseTo(pairSimilarity(m, 'f2', 'f1'), 10);
  });
  it('scores similar findings higher than dissimilar ones', () => {
    const m = similarityMatrix(findings);
    expect(pairSimilarity(m, 'f1', 'f2')).toBeGreaterThan(pairSimilarity(m, 'f1', 'f3'));
  });
  it('a finding with itself is 1', () => {
    expect(pairSimilarity(similarityMatrix(findings), 'f1', 'f1')).toBe(1);
  });
  it('an unknown pair is 0', () => {
    expect(pairSimilarity(similarityMatrix(findings), 'f1', 'zz')).toBe(0);
  });
});

describe('clusterFindings', () => {
  const findings = [
    finding({ findingId: 'f1', title: 'Weak access control in payments', conditionText: 'access control weak' }),
    finding({ findingId: 'f2', title: 'Access control weakness payments', conditionText: 'access control weak' }),
    finding({ findingId: 'f3', title: 'Segregation of duties failing', conditionText: 'duties not segregated' }),
  ];

  it('groups the two similar findings and leaves the third alone', () => {
    const clusters = clusterFindings(findings, settings);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].findingIds).toEqual(['f1', 'f2']);
    expect(clusters[0].leadFindingId).toBe('f1');
    expect(clusters[0].id).toBe('c1');
  });

  it('drops a cluster below the minimum size', () => {
    const clusters = clusterFindings(findings, { ...settings, minClusterSize: 3 });
    expect(clusters).toHaveLength(0);
  });

  it('is deterministic across runs', () => {
    const a = clusterFindings(findings, settings);
    const b = clusterFindings(findings, settings);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('a higher threshold splits the cluster', () => {
    const clusters = clusterFindings(findings, { ...settings, similarityThreshold: 0.95 });
    expect(clusters).toHaveLength(0);
  });

  it('reports the cluster severities and entities in a stable order', () => {
    const two = [
      finding({ findingId: 'f1', severity: 'High', entityId: 'e1', title: 'weak access control' }),
      finding({ findingId: 'f2', severity: 'Low', entityId: 'e2', title: 'weak access control' }),
    ];
    const clusters = clusterFindings(two, settings);
    expect(clusters[0].severities).toEqual(['High', 'Low']);
    expect(clusters[0].entityIds).toEqual(['e1', 'e2']);
  });

  it('never depends on Math.random', () => {
    const src = clusterFindings.toString();
    expect(src).not.toContain('Math.random');
  });
});

describe('layoutGraph', () => {
  const findings = [
    finding({ findingId: 'f1', title: 'A' }),
    finding({ findingId: 'f2', title: 'B' }),
  ];

  it('places one node per finding and is deterministic', () => {
    const clusters = clusterFindings(findings, settings);
    const g1 = layoutGraph(findings, clusters);
    const g2 = layoutGraph(findings, clusters);
    expect(g1.nodes).toHaveLength(2);
    expect(JSON.stringify(g1)).toBe(JSON.stringify(g2));
  });

  it('adds an edge per cluster pair', () => {
    const two = [
      finding({ findingId: 'f1', title: 'weak access control' }),
      finding({ findingId: 'f2', title: 'weak access control' }),
    ];
    const clusters = clusterFindings(two, settings);
    const g = layoutGraph(two, clusters);
    expect(g.edges).toHaveLength(1);
  });
});

describe('heatMap', () => {
  const findings = [
    finding({ findingId: 'f1', entityId: 'e1', entityName: 'One', year: 2025 }),
    finding({ findingId: 'f2', entityId: 'e1', entityName: 'One', year: 2025 }),
    finding({ findingId: 'f3', entityId: 'e2', entityName: 'Two', year: 2026 }),
  ];

  it('counts findings by entity and year', () => {
    const cells = heatMap(findings, 'year');
    expect(cells.find((c) => c.entityId === 'e1' && c.bucket === '2025')?.count).toBe(2);
    expect(cells.find((c) => c.entityId === 'e2' && c.bucket === '2026')?.count).toBe(1);
  });

  it('uses the first category tag as the bucket when asked', () => {
    const cells = heatMap([finding({ findingId: 'f1', categoryTags: ['Payments'] })], 'category');
    expect(cells[0].bucket).toBe('Payments');
  });

  it('buckets an untagged finding as Untagged', () => {
    const cells = heatMap([finding({ findingId: 'f1', categoryTags: [] })], 'category');
    expect(cells[0].bucket).toBe('Untagged');
  });
});
