import { type ReactNode } from 'react';
import type { Page } from '../../types/navigation';
import type { PlatformId } from '../../types/platform';
import { renderPlatformIcon } from '../../utils/platformMeta';

export interface PlatformGroupSwitcherOption {
  platformId: PlatformId;
  label: string;
}

interface PlatformGroupSwitcherProps {
  currentPlatformId: PlatformId;
  currentLabel: string;
  options: PlatformGroupSwitcherOption[];
  currentGroupId?: string | null;
  activePlatformId?: PlatformId | null;
  extraOptions?: Array<{
    id: string;
    label: string;
    page: Page;
    icon?: ReactNode;
    active?: boolean;
  }>;
}

export function PlatformGroupSwitcher({ currentPlatformId, currentLabel }: PlatformGroupSwitcherProps) {
  return (
    <div className="platform-group-switcher platform-group-switcher-codex-only">
      <span className="platform-group-switcher-trigger is-static">
        <span className="platform-group-switcher-trigger-icon">
          {renderPlatformIcon(currentPlatformId, 16)}
        </span>
        <span className="platform-group-switcher-trigger-label">{currentLabel}</span>
      </span>
    </div>
  );
}