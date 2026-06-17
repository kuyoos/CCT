import { Page } from './navigation';

export type PlatformId = 'codex';

export const ALL_PLATFORM_IDS: PlatformId[] = ['codex'];

export const MENU_HIDDEN_PLATFORM_IDS: PlatformId[] = [];

export const MENU_VISIBLE_PLATFORM_IDS: PlatformId[] = ALL_PLATFORM_IDS;

export function isMenuVisiblePlatform(platformId: PlatformId): boolean {
  return MENU_VISIBLE_PLATFORM_IDS.includes(platformId);
}

export const PLATFORM_PAGE_MAP: Record<PlatformId, Page> = {
  codex: 'codex',
};
