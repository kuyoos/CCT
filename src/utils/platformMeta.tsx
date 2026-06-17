import { type ReactNode } from 'react';
import { TFunction } from 'i18next';
import { PlatformId } from '../types/platform';
import { CodexIcon } from '../components/icons/CodexIcon';

export function getPlatformLabel(platformId: PlatformId, _t: TFunction): string {
  return platformId === 'codex' ? 'Codex' : platformId;
}

export function renderPlatformIcon(platformId: PlatformId, size = 20): ReactNode {
  return platformId === 'codex' ? <CodexIcon size={size} /> : null;
}