import React from 'react';
import { SetupWizard } from '../common/SetupWizard';

/**
 * SA-01 platform setup wizard (F17). A thin wrapper over the shared wizard frame with the
 * super_admin step registry. Later slices register their own step bodies; the frame already
 * persists state, shows the tutorial drawer and the resume banner. Non-blocking.
 */
export const SuperAdminSetup: React.FC = () => (
  <div data-testid="sa-setup">
    <SetupWizard scope="super_admin" />
  </div>
);
