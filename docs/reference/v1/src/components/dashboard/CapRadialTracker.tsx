import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useFilterStore } from '../../context/FilterStore';
import { useApp } from '../../context/AppContext';
import { AuditCapItem, Severity } from '../../types';
import { AlertCircle, Filter, RotateCcw } from '../common/Icons';

interface CapDeptData {
  department: string;
  total: number;
  overdueCount: number;
  caps: AuditCapItem[];
  severityCounts: Record<string, number>;
}

interface CapRadialTrackerProps {
  capDeptMap: Record<string, CapDeptData>;
  totalCapCount: number;
  openCapCount: number;
  overdueCapCount: number;
}

export const CapRadialTracker: React.FC<CapRadialTrackerProps> = ({
  capDeptMap,
  totalCapCount,
  openCapCount,
  overdueCapCount,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const filter = useFilterStore();
  const { openInspector } = useApp();
  const [hoveredDept, setHoveredDept] = useState<string | null>(null);

  // Department colors mapped to harmonic palette tokens
  const deptColorPalette: Record<string, string> = {
    Treasury: 'var(--accent-primary)',
    Trading: 'var(--accent-verdigris)',
    'Credit Risk': 'var(--accent-amber)',
    Operations: 'var(--text-secondary)',
    Technology: 'var(--accent-primary)',
    Compliance: 'var(--accent-verdigris)',
  };

  const getDeptColor = (dept: string, index: number): string => {
    if (deptColorPalette[dept]) return deptColorPalette[dept];
    const fallback = ['var(--accent-primary)', 'var(--accent-verdigris)', 'var(--accent-amber)'];
    return fallback[index % fallback.length];
  };

  // Outer ring severity colors
  const severityColors: Record<Severity, string> = {
    critical: 'var(--accent-cinnabar)',
    high: 'var(--accent-amber)',
    medium: 'var(--accent-verdigris)',
    low: 'var(--text-tertiary)',
  };

  const departments = Object.values(capDeptMap).filter((d) => d.total > 0);

  useEffect(() => {
    if (!svgRef.current || departments.length === 0) return;

    const width = 340;
    const height = 340;
    const radius = Math.min(width, height) / 2;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg
      .attr('viewBox', `0 0 ${width} ${height}`)
      .append('g')
      .attr('transform', `translate(${width / 2},${height / 2})`);

    // Dimensions
    const innerRadiusHub = 62;
    const innerRadiusDept = 66;
    const outerRadiusDept = 104;
    const innerRadiusCap = 108;
    const outerRadiusCap = 146;
    const overdueArcInner = 149;
    const overdueArcOuter = 153;

    // D3 Pie layout for inner ring (departments)
    const pie = d3
      .pie<CapDeptData>()
      .value((d) => d.total)
      .sort(null)
      .padAngle(0.035);

    const pieData = pie(departments);

    // Inner Arc generator
    const arcDept = d3
      .arc<d3.PieArcDatum<CapDeptData>>()
      .innerRadius(innerRadiusDept)
      .outerRadius(outerRadiusDept)
      .cornerRadius(4);

    // Outer Arc generator for CAP severities
    const arcCap = d3
      .arc<{ startAngle: number; endAngle: number; padAngle: number }>()
      .innerRadius(innerRadiusCap)
      .outerRadius(outerRadiusCap)
      .cornerRadius(2);

    // Overdue outer rim arc generator
    const arcOverdue = d3
      .arc<{ startAngle: number; endAngle: number }>()
      .innerRadius(overdueArcInner)
      .outerRadius(overdueArcOuter)
      .cornerRadius(1.5);

    // Draw Inner Ring (Departments) with draw-on animation and stagger
    const deptGroups = g
      .selectAll('.dept-slice')
      .data(pieData)
      .enter()
      .append('g')
      .attr('class', 'dept-slice cursor-pointer')
      .style('transition', 'transform 260ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms ease')
      .on('mouseenter', (event, d) => {
        setHoveredDept(d.data.department);
      })
      .on('mouseleave', () => {
        setHoveredDept(null);
      })
      .on('click', (event, d) => {
        // Toggle department filter and open inspector
        const nextDept = filter.department === d.data.department ? null : d.data.department;
        filter.setDepartment(nextDept);
        openInspector('cap_inspector', { department: d.data.department, caps: d.data.caps });
      });

    // Inner slice paths
    deptGroups
      .append('path')
      .attr('fill', (d, i) => getDeptColor(d.data.department, i))
      .attr('fill-opacity', (d) => {
        if (filter.department && filter.department !== d.data.department) return 0.25;
        if (hoveredDept && hoveredDept !== d.data.department) return 0.35;
        return 0.85;
      })
      .attr('stroke', 'var(--canvas)')
      .attr('stroke-width', 2)
      .transition()
      .duration(750)
      .delay((d, i) => i * 90)
      .attrTween('d', function (d) {
        const interpolate = d3.interpolate({ startAngle: 0, endAngle: 0 }, d);
        return function (t) {
          return arcDept(interpolate(t) as any) || '';
        };
      });

    // Draw Outer Ring (CAPs grouped by severity within each department slice)
    pieData.forEach((deptArc, i) => {
      const dept = deptArc.data;
      const deptSpan = deptArc.endAngle - deptArc.startAngle;
      let currentAngle = deptArc.startAngle;

      const severities: Severity[] = ['critical', 'high', 'medium', 'low'];
      severities.forEach((sev) => {
        const count = dept.severityCounts[sev] || 0;
        if (count === 0) return;

        const fraction = count / dept.total;
        const sevSpan = fraction * deptSpan;
        const start = currentAngle;
        const end = currentAngle + sevSpan;
        currentAngle = end;

        const capPath = g
          .append('path')
          .attr('class', 'cap-slice cursor-pointer')
          .attr('fill', severityColors[sev])
          .attr('fill-opacity', () => {
            if (filter.department && filter.department !== dept.department) return 0.25;
            if (hoveredDept && hoveredDept !== dept.department) return 0.35;
            return 0.95;
          })
          .attr('stroke', 'var(--canvas)')
          .attr('stroke-width', 1.5)
          .on('mouseenter', () => setHoveredDept(dept.department))
          .on('mouseleave', () => setHoveredDept(null))
          .on('click', () => {
            filter.setDepartment(dept.department);
            filter.setSeverity(sev);
            openInspector('cap_inspector', { department: dept.department, severity: sev, caps: dept.caps });
          });

        capPath
          .transition()
          .duration(750)
          .delay(i * 90 + 150)
          .attrTween('d', function () {
            const interpolate = d3.interpolate(
              { startAngle: deptArc.startAngle, endAngle: deptArc.startAngle, padAngle: 0.02 },
              { startAngle: start, endAngle: end, padAngle: 0.02 }
            );
            return function (t) {
              return arcCap(interpolate(t)) || '';
            };
          });
      });

      // Overdue outer arc: thin cinnabar outer arc for departments with overdue items (§ 3.4)
      if (dept.overdueCount > 0) {
        g.append('path')
          .attr('class', 'overdue-arc')
          .attr('fill', 'var(--accent-cinnabar)')
          .attr('fill-opacity', 0.9)
          .transition()
          .duration(800)
          .delay(i * 90 + 300)
          .attrTween('d', function () {
            const interpolate = d3.interpolate(
              { startAngle: deptArc.startAngle, endAngle: deptArc.startAngle },
              { startAngle: deptArc.startAngle, endAngle: deptArc.endAngle }
            );
            return function (t) {
              return arcOverdue(interpolate(t)) || '';
            };
          });
      }
    });

    // Center hub circle
    g.append('circle')
      .attr('r', innerRadiusHub)
      .attr('fill', 'var(--surface-elevated)')
      .attr('stroke', 'var(--border-hairline)')
      .attr('stroke-width', 1)
      .attr('class', 'shadow-xs');
  }, [departments, filter.department, hoveredDept]);

  // Center display data
  const currentDeptData = hoveredDept
    ? capDeptMap[hoveredDept]
    : filter.department
    ? capDeptMap[filter.department]
    : null;

  const displayCount = currentDeptData ? currentDeptData.total : totalCapCount;
  const displayOpen = currentDeptData
    ? currentDeptData.caps.filter((c) => c.status !== 'Closed').length
    : openCapCount;
  const displayOverdue = currentDeptData
    ? currentDeptData.overdueCount
    : overdueCapCount;

  return (
    <div className="w-full bg-surface border border-hairline rounded-2xl p-6 shadow-apple space-y-6">
      {/* Header and Filter Reset */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-apple-11 font-semibold text-accent uppercase tracking-wider">
              Assurance Remediation Radar
            </span>
            {filter.hasActiveFilters() && (
              <span className="px-2 py-0.5 rounded-full text-apple-11 font-medium bg-accent-subtle text-accent border border-accent">
                Cross-Filtered
              </span>
            )}
          </div>
          <h3 className="text-apple-17 font-bold text-primary mt-1">
            Corrective Action Plan (CAP) Radial Tracker
          </h3>
          <p className="text-apple-12 text-secondary mt-0.5">
            Inner ring: Departments • Outer ring: Actions by severity • Red arc: Overdue remediation
          </p>
        </div>

        {filter.hasActiveFilters() && (
          <button
            onClick={() => filter.clearFilters()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-elevated hover:bg-surface-hover border border-hairline text-apple-12 font-medium text-secondary hover:text-primary transition-colors shadow-xs"
          >
            <RotateCcw className="w-3.5 h-3.5 stroke-[1.5]" />
            <span>Clear filters</span>
          </button>
        )}
      </div>

      {/* Main Grid: D3 Radial Chart + Side Legend Rail */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
        {/* Radial SVG Container with Center Hub */}
        <div className="md:col-span-7 flex justify-center relative select-none">
          <svg
            ref={svgRef}
            className="w-[320px] h-[320px] max-w-full drop-shadow-xs"
            role="img"
            aria-label="CAP Radial Remediation Distribution"
          />

          {/* HTML Overlay for Center Hub Typography (crisp text, never blurred SVG text) */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
            <span className="text-apple-11 font-medium text-secondary truncate max-w-[100px]">
              {currentDeptData ? currentDeptData.department : 'Total Portfolio'}
            </span>
            <span className="font-serif-numeral text-apple-32 font-bold text-primary tabular-nums leading-none my-0.5">
              {displayCount}
            </span>
            <span className="text-apple-11 text-secondary">
              {displayOpen} open CAPs
            </span>
            {displayOverdue > 0 && (
              <span className="text-apple-11 font-bold text-cinnabar flex items-center gap-1 mt-0.5">
                <AlertCircle className="w-3 h-3 stroke-[2]" />
                <span>{displayOverdue} overdue</span>
              </span>
            )}
          </div>
        </div>

        {/* Legend Rail beside chart (§ 3.4 requirement) */}
        <div className="md:col-span-5 space-y-2 border-l border-hairline pl-4">
          <div className="text-apple-11 text-tertiary uppercase font-semibold tracking-wider pb-1">
            Remediation by Business Unit
          </div>
          <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
            {departments.map((dept, idx) => {
              const isSelected = filter.department === dept.department;
              const isHovered = hoveredDept === dept.department;
              const color = getDeptColor(dept.department, idx);

              return (
                <button
                  key={dept.department}
                  onClick={() => {
                    const next = isSelected ? null : dept.department;
                    filter.setDepartment(next);
                    openInspector('cap_inspector', { department: dept.department, caps: dept.caps });
                  }}
                  onMouseEnter={() => setHoveredDept(dept.department)}
                  onMouseLeave={() => setHoveredDept(null)}
                  className={`w-full text-left p-2.5 rounded-xl transition-colors flex items-center justify-between border ${
                    isSelected
                      ? 'bg-accent-subtle border-accent text-accent'
                      : isHovered
                      ? 'bg-surface-hover border-hairline text-primary'
                      : 'bg-surface-elevated border-hairline text-secondary hover:text-primary'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="w-3 h-3 rounded-full shrink-0 shadow-xs"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-apple-12 font-medium truncate">
                      {dept.department}
                    </span>
                    {dept.overdueCount > 0 && (
                      <span
                        className="w-2 h-2 rounded-full bg-cinnabar shrink-0 animate-pulse"
                        title={`${dept.overdueCount} overdue actions`}
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {dept.overdueCount > 0 && (
                      <span className="text-apple-11 font-semibold text-cinnabar tabular-nums">
                        {dept.overdueCount} ovd
                      </span>
                    )}
                    <span className="text-apple-12 font-semibold text-primary tabular-nums">
                      {dept.total}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Severity Swatches Guide */}
          <div className="pt-3 border-t border-hairline flex items-center justify-between text-apple-11 text-secondary">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-cinnabar" /> Critical
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber" /> High
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-verdigris" /> Medium
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-surface-sunken border border-hairline" /> Low
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
