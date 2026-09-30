import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useFilterStore } from '../../context/FilterStore';
import { AuditIssue } from '../../types';
import { HoverPreview } from '../common/HoverPreview';

interface SunburstProps {
  deptMap: Record<string, { total: number; issues: AuditIssue[] }>;
}

interface SunburstNode {
  name: string;
  department?: string;
  severity?: string;
  value?: number;
  children?: SunburstNode[];
  color?: string;
}

export const D3Sunburst: React.FC<SunburstProps> = ({ deptMap }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const filter = useFilterStore();
  const [hoveredNode, setHoveredNode] = useState<{
    title: string;
    subtitle?: string;
    category?: string;
    status?: string;
    statusType?: 'verdigris' | 'cinnabar' | 'amber' | 'neutral';
    owner?: string;
    dueDate?: string;
    exceptionsCount?: number;
    metrics?: { label: string; value: string | number }[];
  } | null>(null);

  // Build hierarchical data
  const rootData: SunburstNode = {
    name: 'Audit Scope',
    children: Object.entries(deptMap).map(([dept, data]) => {
      const severityCounts: Record<string, number> = {};
      data.issues.forEach((iss) => {
        severityCounts[iss.severity] = (severityCounts[iss.severity] || 0) + 1;
      });

      return {
        name: dept,
        department: dept,
        children: Object.entries(severityCounts).map(([sev, count]) => ({
          name: `${dept} - ${sev.toUpperCase()}`,
          department: dept,
          severity: sev,
          value: count,
        })),
      };
    }),
  };

  useEffect(() => {
    if (!svgRef.current) return;

    const width = 320;
    const height = 320;
    const radius = width / 2;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg
      .append('g')
      .attr('transform', `translate(${radius},${radius})`);

    const partition = (data: SunburstNode) => {
      const root = d3
        .hierarchy(data)
        .sum((d) => d.value || (d.children ? 0 : 1))
        .sort((a, b) => (b.value || 0) - (a.value || 0));
      return d3.partition<SunburstNode>().size([2 * Math.PI, radius])(root);
    };

    const root = partition(rootData);

    const arc = d3
      .arc<d3.HierarchyRectangularNode<SunburstNode>>()
      .startAngle((d) => d.x0)
      .endAngle((d) => d.x1)
      .padAngle((d) => Math.min((d.x1 - d.x0) / 2, 0.015))
      .padRadius(radius / 2)
      .innerRadius((d) => d.y0)
      .outerRadius((d) => Math.max(d.y0, d.y1 - 2));

    // Department colors mapped via Apple design token variables
    const getFill = (d: d3.HierarchyRectangularNode<SunburstNode>) => {
      if (d.depth === 0) return 'transparent';
      const isSelected = filter.department && d.data.department === filter.department;
      if (d.depth === 1) {
        // Inner ring: department
        return isSelected
          ? 'var(--accent-primary)'
          : 'var(--surface-elevated)';
      }
      // Outer ring: severity
      if (d.data.severity === 'critical') return 'var(--accent-cinnabar)';
      if (d.data.severity === 'high') return 'var(--accent-amber)';
      if (d.data.severity === 'medium') return 'var(--text-secondary)';
      return 'var(--accent-verdigris)';
    };

    const path = g
      .append('g')
      .selectAll('path')
      .data(root.descendants().filter((d) => d.depth > 0))
      .join('path')
      .attr('fill', (d) => getFill(d))
      .attr('fill-opacity', (d) => {
        if (filter.department) {
          return d.data.department === filter.department ? 0.95 : 0.25;
        }
        return d.depth === 1 ? 0.85 : 0.75;
      })
      .attr('stroke', 'var(--border-hairline)')
      .attr('stroke-width', 1)
      .attr('d', arc as any)
      .style('cursor', 'pointer')
      .style('transition', 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)');

    path
      .on('mouseenter', (event: MouseEvent, d) => {
        d3.select(event.currentTarget as SVGPathElement)
          .attr('fill-opacity', 1)
          .attr('stroke', 'var(--accent-primary)')
          .attr('stroke-width', 2);

        if (d.depth === 1) {
          const deptData = deptMap[d.data.name];
          setHoveredNode({
            title: d.data.name,
            category: 'Department Breakdown',
            subtitle: `${deptData?.issues.length || 0} Open Findings across ${deptData?.total || 0} Entities`,
            status: filter.department === d.data.name ? 'Active Filter' : 'Click to Filter',
            statusType: filter.department === d.data.name ? 'verdigris' : 'neutral',
            exceptionsCount: deptData?.issues.length || 0,
          });
        } else {
          setHoveredNode({
            title: `${d.data.department} • ${d.data.severity?.toUpperCase()} Issues`,
            category: 'Severity Slice',
            subtitle: `${d.value} Issue(s) identified`,
            status: d.data.severity?.toUpperCase(),
            statusType:
              d.data.severity === 'critical'
                ? 'cinnabar'
                : d.data.severity === 'high'
                ? 'amber'
                : 'verdigris',
            exceptionsCount: d.value,
          });
        }
      })
      .on('mouseleave', (event: MouseEvent, d) => {
        d3.select(event.currentTarget as SVGPathElement)
          .attr('fill-opacity', filter.department ? (d.data.department === filter.department ? 0.95 : 0.25) : d.depth === 1 ? 0.85 : 0.75)
          .attr('stroke', 'var(--border-hairline)')
          .attr('stroke-width', 1);
        setHoveredNode(null);
      })
      .on('click', (event, d) => {
        event.stopPropagation();
        if (d.data.department) {
          if (filter.department === d.data.department) {
            filter.setDepartment(null);
          } else {
            filter.setDepartment(d.data.department);
          }
        }
      });

    // Center circular badge
    const centerGroup = g.append('g').style('pointer-events', 'none');
    centerGroup
      .append('circle')
      .attr('r', radius * 0.32)
      .attr('fill', 'var(--surface)')
      .attr('stroke', 'var(--border-hairline)');

    centerGroup
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '-0.2em')
      .attr('class', 'text-apple-11 font-medium fill-current text-secondary')
      .text(filter.department ? 'Filtered by' : 'Total Issues');

    centerGroup
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '1em')
      .attr('class', 'text-apple-15 font-bold fill-current text-primary')
      .text(
        filter.department
          ? filter.department.substring(0, 8)
          : Object.values(deptMap).reduce((acc, v) => acc + v.issues.length, 0)
      );
  }, [deptMap, filter.department]);

  return (
    <div className="flex flex-col items-center">
      <HoverPreview content={hoveredNode}>
        <div className="relative cursor-pointer">
          <svg
            ref={svgRef}
            width={320}
            height={320}
            className="overflow-visible select-none"
          />
        </div>
      </HoverPreview>
      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-apple-11 text-secondary">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-cinnabar" /> Critical
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber" /> High
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-surface-elevated border border-hairline" /> Inner: Department
        </span>
      </div>
    </div>
  );
};
