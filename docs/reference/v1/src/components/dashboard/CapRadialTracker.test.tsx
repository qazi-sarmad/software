import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CapRadialTracker } from './CapRadialTracker';
import { AppProvider } from '../../context/AppContext';
import { ThemeProvider } from '../../context/ThemeContext';
import { AuditCapItem } from '../../types';

describe('§ 3.4 CAP Radial Tracker & Legend Rail', () => {
  const mockCapDeptMap = {
    Treasury: {
      department: 'Treasury',
      total: 5,
      overdueCount: 1,
      caps: [
        {
          id: 'CAP-001',
          title: 'Cash Pipeline STP',
          action: 'Deploy automated SWIFT parser',
          owner: 'David Miller',
          department: 'Treasury',
          severity: 'critical' as const,
          dueDate: '2026-09-15',
          agingDays: 45,
          status: 'Overdue' as const,
          retestStatus: 'Not tested' as const,
          approvalStatus: 'Approved by CIA' as const,
          originatingReport: 'Q3 Report',
          engagementId: 'eng-1',
          entityId: 'ent-1',
          universeId: 'u-1',
        },
      ],
      severityCounts: { critical: 1, high: 2, medium: 2, low: 0 },
    },
    Trading: {
      department: 'Trading',
      total: 3,
      overdueCount: 0,
      caps: [],
      severityCounts: { critical: 0, high: 2, medium: 1, low: 0 },
    },
  };

  it('renders radial tracker SVG and center hub statistics', () => {
    render(
      <ThemeProvider>
        <AppProvider>
          <CapRadialTracker
            capDeptMap={mockCapDeptMap}
            totalCapCount={8}
            openCapCount={7}
            overdueCapCount={1}
          />
        </AppProvider>
      </ThemeProvider>
    );

    // Assert Center Hub values
    expect(screen.getByText('8')).toBeDefined();
    expect(screen.getByText('7 open CAPs')).toBeDefined();
    expect(screen.getByText('1 overdue')).toBeDefined();

    // Assert Legend Rail items
    expect(screen.getByText('Treasury')).toBeDefined();
    expect(screen.getByText('Trading')).toBeDefined();
  });
});
