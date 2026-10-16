import { OFFICE_SCREEN_CONFIG } from './officeConfigs.js';
import { OfficeWorkspaceScreen } from './OfficeWorkspaceScreen.js';

export function AdviserDetailScreen(props) {
  return <OfficeWorkspaceScreen {...props} config={OFFICE_SCREEN_CONFIG.ADVISER} />;
}
