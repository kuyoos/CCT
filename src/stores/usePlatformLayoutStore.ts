import { create } from 'zustand';
import { type PlatformId } from '../types/platform';

export const API_RELAY_LAYOUT_ENTRY_ID = 'feature:api-relay' as const;

export type PlatformLayoutEntryId = `platform:${PlatformId}` | `group:${string}`;
export type ApiRelayLayoutEntryId = typeof API_RELAY_LAYOUT_ENTRY_ID;
export type PlatformGroupIconKind = 'platform' | 'custom';

export interface PlatformLayoutGroupChildConfig {
  platformId: PlatformId;
  name?: string;
  iconKind?: PlatformGroupIconKind;
  iconPlatformId?: PlatformId;
  iconCustomDataUrl?: string;
}

export interface PlatformLayoutGroup {
  id: string;
  name: string;
  platformIds: PlatformId[];
  defaultPlatformId: PlatformId;
  iconKind: PlatformGroupIconKind;
  iconPlatformId?: PlatformId;
  iconCustomDataUrl?: string;
  childConfigs?: PlatformLayoutGroupChildConfig[];
}

interface PlatformLayoutState {
  orderedPlatformIds: PlatformId[];
  hiddenPlatformIds: PlatformId[];
  sidebarPlatformIds: PlatformId[];
  trayPlatformIds: PlatformId[];
  traySortMode: 'auto' | 'manual';
  platformGroups: PlatformLayoutGroup[];
  orderedEntryIds: PlatformLayoutEntryId[];
  hiddenEntryIds: PlatformLayoutEntryId[];
  sidebarEntryIds: PlatformLayoutEntryId[];
  antigravityGroupFirstMigrated: boolean;
  apiRelaySidebarVisible: boolean;
  apiRelayDashboardVisible: boolean;
  apiRelayEntryOrder: number;
  movePlatform: (fromIndex: number, toIndex: number) => void;
  toggleHiddenPlatform: (id: PlatformId) => void;
  setHiddenPlatform: (id: PlatformId, hidden: boolean) => void;
  toggleSidebarPlatform: (id: PlatformId) => void;
  setSidebarPlatform: (id: PlatformId, enabled: boolean) => void;
  moveEntry: (fromIndex: number, toIndex: number) => void;
  setLayoutEntryOrder: (entryIds: PlatformLayoutEntryId[], apiRelayEntryOrder: number) => void;
  reorderGroupPlatforms: (groupId: string, fromIndex: number, toIndex: number) => void;
  toggleHiddenEntry: (id: PlatformLayoutEntryId) => void;
  setHiddenEntry: (id: PlatformLayoutEntryId, hidden: boolean) => void;
  toggleSidebarEntry: (id: PlatformLayoutEntryId) => void;
  setSidebarEntry: (id: PlatformLayoutEntryId, enabled: boolean) => void;
  syncSidebarEntriesFromDashboard: () => void;
  setApiRelaySidebarVisible: (visible: boolean) => void;
  setApiRelayDashboardVisible: (visible: boolean) => void;
  setApiRelayEntryOrder: (order: number) => void;
  upsertPlatformGroup: (group: PlatformLayoutGroup) => void;
  removePlatformGroup: (groupId: string) => void;
  toggleTrayPlatform: (id: PlatformId) => void;
  setTrayPlatform: (id: PlatformId, enabled: boolean) => void;
  syncTrayLayout: () => void;
  resetPlatformLayout: () => void;
}

const CODEX_ENTRY_ID: PlatformLayoutEntryId = 'platform:codex';

export function makePlatformEntryId(platformId: PlatformId): PlatformLayoutEntryId {
  return `platform:${platformId}`;
}

export function makeGroupEntryId(groupId: string): PlatformLayoutEntryId {
  return `group:${groupId}`;
}

export function parsePlatformEntryId(entryId: string): PlatformId | null {
  return entryId === CODEX_ENTRY_ID ? 'codex' : null;
}

export function parseGroupEntryId(entryId: string): string | null {
  if (!entryId.startsWith('group:')) return null;
  return entryId.slice('group:'.length).trim() || null;
}

export function findGroupByPlatform(groups: PlatformLayoutGroup[], platformId: PlatformId): PlatformLayoutGroup | null {
  return groups.find((group) => group.platformIds.includes(platformId)) ?? null;
}

export function getGroupChildConfig(
  group: PlatformLayoutGroup,
  platformId: PlatformId,
): PlatformLayoutGroupChildConfig | null {
  return group.childConfigs?.find((item) => item.platformId === platformId) ?? null;
}

export function resolveGroupChildName(
  group: PlatformLayoutGroup,
  platformId: PlatformId,
  fallbackName: string,
): string {
  return getGroupChildConfig(group, platformId)?.name?.trim() || fallbackName;
}

export function resolveGroupChildIcon(
  group: PlatformLayoutGroup,
  platformId: PlatformId,
): {
  iconKind: PlatformGroupIconKind;
  iconPlatformId: PlatformId;
  iconCustomDataUrl?: string;
} {
  const config = getGroupChildConfig(group, platformId);
  return {
    iconKind: config?.iconKind === 'custom' && config.iconCustomDataUrl ? 'custom' : 'platform',
    iconPlatformId: 'codex',
    iconCustomDataUrl: config?.iconCustomDataUrl,
  };
}

export function resolveEntryIdForPlatform(platformId: PlatformId): PlatformLayoutEntryId {
  return makePlatformEntryId(platformId);
}

export function resolveEntryDefaultPlatformId(entryId: PlatformLayoutEntryId): PlatformId | null {
  return parsePlatformEntryId(entryId);
}

export function resolveEntryPlatformIds(entryId: PlatformLayoutEntryId): PlatformId[] {
  return parsePlatformEntryId(entryId) ? ['codex'] : [];
}

const noop = () => undefined;

export const usePlatformLayoutStore = create<PlatformLayoutState>((set) => ({
  orderedPlatformIds: ['codex'],
  hiddenPlatformIds: [],
  sidebarPlatformIds: ['codex'],
  trayPlatformIds: ['codex'],
  traySortMode: 'auto',
  platformGroups: [],
  orderedEntryIds: [CODEX_ENTRY_ID],
  hiddenEntryIds: [],
  sidebarEntryIds: [CODEX_ENTRY_ID],
  antigravityGroupFirstMigrated: true,
  apiRelaySidebarVisible: true,
  apiRelayDashboardVisible: true,
  apiRelayEntryOrder: 1,
  movePlatform: noop,
  toggleHiddenPlatform: noop,
  setHiddenPlatform: noop,
  toggleSidebarPlatform: noop,
  setSidebarPlatform: noop,
  moveEntry: noop,
  setLayoutEntryOrder: (entryIds, apiRelayEntryOrder) => {
    set({ orderedEntryIds: entryIds.length ? entryIds : [CODEX_ENTRY_ID], apiRelayEntryOrder });
  },
  reorderGroupPlatforms: noop,
  toggleHiddenEntry: noop,
  setHiddenEntry: noop,
  toggleSidebarEntry: noop,
  setSidebarEntry: noop,
  syncSidebarEntriesFromDashboard: noop,
  setApiRelaySidebarVisible: (apiRelaySidebarVisible) => set({ apiRelaySidebarVisible }),
  setApiRelayDashboardVisible: (apiRelayDashboardVisible) => set({ apiRelayDashboardVisible }),
  setApiRelayEntryOrder: (apiRelayEntryOrder) => set({ apiRelayEntryOrder }),
  upsertPlatformGroup: noop,
  removePlatformGroup: noop,
  toggleTrayPlatform: noop,
  setTrayPlatform: noop,
  syncTrayLayout: noop,
  resetPlatformLayout: () => set({
    orderedPlatformIds: ['codex'],
    hiddenPlatformIds: [],
    sidebarPlatformIds: ['codex'],
    trayPlatformIds: ['codex'],
    platformGroups: [],
    orderedEntryIds: [CODEX_ENTRY_ID],
    hiddenEntryIds: [],
    sidebarEntryIds: [CODEX_ENTRY_ID],
  }),
}));