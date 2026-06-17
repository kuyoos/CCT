import { invoke } from '@tauri-apps/api/core';
import {
  ACCOUNT_TRANSFER_SCHEMA,
  AccountTransferBundle,
  AccountTransferImportProgress,
  AccountTransferImportResult,
  buildAccountTransferBundle,
  importAllAccountsFromTransferJson,
} from './accountTransferService';
import { PlatformId } from '../types/platform';
import { getGroupSettings, GroupSettings, saveGroupSettings } from './groupService';
import {
  CodexAccountGroup,
  getCodexAccountGroups,
  invalidateCodexGroupCache,
} from './codexAccountGroupService';
import {
  CodexModelProvider,
  invalidateCodexModelProviderCache,
  listCodexModelProviders,
} from './codexModelProviderService';
import {
  getCodexWakeupCliStatus,
  getCodexWakeupState,
  saveCodexWakeupState,
  updateCodexWakeupRuntimeConfig,
} from './codexWakeupService';
import { CodexWakeupModelPreset, CodexWakeupTask } from '../types/codexWakeup';
import {
  CurrentAccountRefreshMinutesMap,
  loadCurrentAccountRefreshMinutesMap,
  saveCurrentAccountRefreshMinutesMap,
} from '../utils/currentAccountRefresh';
import * as codexService from './codexService';
import type { InstanceLaunchMode } from '../types/instance';

const DATA_TRANSFER_SCHEMA = 'cockpit-tools.data-transfer';
const DATA_TRANSFER_VERSION = 1;

type InstancePlatform = 'codex';
type TransferAccountRecord = Record<string, unknown> & { id: string };
type LegacyFormat = 'data_bundle' | 'account_bundle' | 'legacy_account_json';
type DataTransferWarningCode = 'accounts_section_missing' | 'config_section_missing';

interface RawUserConfig extends Record<string, unknown> {
  codex_auto_switch_selected_account_ids?: string[];
  webdav_sync_password?: string;
}

interface ExportedUserConfig extends Omit<
  RawUserConfig,
  'codex_auto_switch_selected_account_ids' | 'webdav_sync_password'
> {
  codex_auto_switch_selected_account_refs: DataTransferAccountRef[];
}

interface RawInstanceProfile {
  id: string;
  name: string;
  userDataDir: string;
  workingDir?: string | null;
  extraArgs: string;
  bindAccountId?: string | null;
  launchMode?: InstanceLaunchMode;
  createdAt: number;
  lastLaunchedAt?: number | null;
  lastPid?: number | null;
}

interface RawDefaultInstanceSettings {
  bindAccountId?: string | null;
  extraArgs: string;
  launchMode?: InstanceLaunchMode;
  followLocalAccount?: boolean;
  lastPid?: number | null;
}

interface RawInstanceStore {
  instances: RawInstanceProfile[];
  defaultSettings: RawDefaultInstanceSettings;
}

interface ExportedInstanceProfile {
  id: string;
  name: string;
  userDataDir: string;
  workingDir?: string | null;
  extraArgs: string;
  bindAccountRef: DataTransferAccountRef | null;
  launchMode?: InstanceLaunchMode;
  createdAt: number;
}

interface ExportedDefaultInstanceSettings {
  bindAccountRef: DataTransferAccountRef | null;
  extraArgs: string;
  launchMode?: InstanceLaunchMode;
  followLocalAccount: boolean;
}

interface ExportedInstanceStore {
  defaultSettings: ExportedDefaultInstanceSettings;
  instances: ExportedInstanceProfile[];
}

type GenericRecord = Record<string, unknown>;

interface ExportedCodexWakeupTask extends Omit<CodexWakeupTask, 'account_ids'> {
  account_refs: DataTransferAccountRef[];
}

interface ExportedCodexWakeupState {
  enabled: boolean;
  tasks: ExportedCodexWakeupTask[];
  model_presets: CodexWakeupModelPreset[];
  runtime: {
    codex_cli_path?: string;
    node_path?: string;
  };
}

interface ExportedCodexAccountGroup extends Omit<CodexAccountGroup, 'accountIds'> {
  accountRefs: DataTransferAccountRef[];
}

export interface DataTransferAccountRef {
  platform: PlatformId;
  email?: string;
  userId?: string;
  accountId?: string;
  authId?: string;
  apiBaseUrl?: string;
  apiProviderId?: string;
  apiProviderName?: string;
}

export interface DataTransferSelection {
  includeAccounts: boolean;
  includeConfig: boolean;
}

export interface DataTransferConfigBundle {
  user_config: ExportedUserConfig;
  group_settings: GroupSettings;
  codex_account_groups: ExportedCodexAccountGroup[];
  codex_model_providers: CodexModelProvider[];
  instance_stores: Partial<Record<InstancePlatform, ExportedInstanceStore>>;
  codex_wakeup: ExportedCodexWakeupState;
  current_account_refresh_minutes: CurrentAccountRefreshMinutesMap;
  platform_layout_config?: unknown;
  platform_layout_custom_icons?: unknown;
  compact_group_order?: unknown;
  compact_group_colors?: unknown;
  compact_hidden_groups?: unknown;
  app_language?: string;
}

export interface DataTransferBundle {
  schema: typeof DATA_TRANSFER_SCHEMA;
  version: typeof DATA_TRANSFER_VERSION;
  exported_at: string;
  sections: {
    accounts: boolean;
    config: boolean;
  };
  accounts?: AccountTransferBundle;
  config?: DataTransferConfigBundle;
}

export interface DataTransferConfigImportResult {
  applied: boolean;
  unresolved_account_ref_count: number;
  disabled_task_count: number;
  needs_restart: boolean;
}

export interface DataTransferImportResult {
  detected_format: LegacyFormat;
  legacy_account_platform?: PlatformId | null;
  imported_account_count: number;
  account_result: AccountTransferImportResult | null;
  config_result: DataTransferConfigImportResult | null;
  warnings: DataTransferWarningCode[];
}

export interface DataTransferImportOptions extends DataTransferSelection {
  onAccountProgress?: (progress: AccountTransferImportProgress) => void;
}

interface AccountRegistry {
  byPlatform: Record<PlatformId, TransferAccountRecord[]>;
  byId: Record<PlatformId, Map<string, TransferAccountRecord>>;
}

function isRecord(value: unknown): value is GenericRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function parseJsonOrThrow(jsonContent: string, errorCode: string): unknown {
  try {
    return JSON.parse(jsonContent) as unknown;
  } catch {
    throw new Error(errorCode);
  }
}

function safeGetLocalStorageItem(key: string): unknown {
  const value = localStorage.getItem(key);
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function safeSetLocalStorageItem(key: string, value: unknown): void {
  if (value === null || value === undefined) {
    localStorage.removeItem(key);
  } else if (typeof value === 'string') {
    localStorage.setItem(key, value);
  } else {
    localStorage.setItem(key, JSON.stringify(value));
  }
}

function ensureSelection(selection: DataTransferSelection): void {
  if (!selection.includeAccounts && !selection.includeConfig) {
    throw new Error('transfer_selection_required');
  }
}

function isDataTransferBundle(value: unknown): value is DataTransferBundle {
  return isRecord(value) && value.schema === DATA_TRANSFER_SCHEMA;
}

function isAccountTransferBundleLike(value: unknown): boolean {
  return isRecord(value) && value.schema === ACCOUNT_TRANSFER_SCHEMA;
}

async function loadAccountRegistry(): Promise<AccountRegistry> {
  const accounts = (await codexService.listCodexAccounts()) as unknown as TransferAccountRecord[];
  const byId = new Map<string, TransferAccountRecord>();
  for (const account of accounts) {
    if (account.id) byId.set(account.id, account);
  }
  return {
    byPlatform: { codex: accounts },
    byId: { codex: byId },
  };
}

function buildAccountRef(platform: PlatformId, account: TransferAccountRecord): DataTransferAccountRef {
  return {
    platform,
    email: normalizeString(account.email) ?? undefined,
    userId: normalizeString(account.user_id ?? account.userId) ?? undefined,
    accountId: normalizeString(account.id) ?? undefined,
    authId: normalizeString(account.auth_id ?? account.authId) ?? undefined,
    apiBaseUrl: normalizeString(account.api_base_url ?? account.apiBaseUrl) ?? undefined,
    apiProviderId: normalizeString(account.api_provider_id ?? account.apiProviderId) ?? undefined,
    apiProviderName: normalizeString(account.api_provider_name ?? account.apiProviderName) ?? undefined,
  };
}

function mapAccountIdsToRefs(
  platform: PlatformId,
  ids: unknown,
  registry: AccountRegistry,
): DataTransferAccountRef[] {
  if (!Array.isArray(ids)) return [];
  return ids
    .map((id) => (typeof id === 'string' ? registry.byId[platform].get(id) : null))
    .filter((account): account is TransferAccountRecord => Boolean(account))
    .map((account) => buildAccountRef(platform, account));
}

function resolveAccountRef(ref: DataTransferAccountRef | null | undefined, registry: AccountRegistry): string | null {
  if (!ref || ref.platform !== 'codex') return null;
  const accounts = registry.byPlatform.codex;
  const byAccountId = ref.accountId ? registry.byId.codex.get(ref.accountId) : null;
  if (byAccountId) return byAccountId.id;
  const matched = accounts.find((account) => {
    if (ref.authId && normalizeString(account.auth_id ?? account.authId) === ref.authId) return true;
    if (ref.userId && normalizeString(account.user_id ?? account.userId) === ref.userId) return true;
    if (ref.email && normalizeString(account.email)?.toLowerCase() === ref.email.toLowerCase()) return true;
    return false;
  });
  return matched?.id ?? null;
}

function resolveAccountRefsToIds(
  refs: DataTransferAccountRef[] | undefined,
  registry: AccountRegistry,
): { ids: string[]; unresolved: number } {
  if (!Array.isArray(refs)) return { ids: [], unresolved: 0 };
  const seen = new Set<string>();
  const ids: string[] = [];
  let unresolved = 0;
  for (const ref of refs) {
    const id = resolveAccountRef(ref, registry);
    if (!id) {
      unresolved += 1;
      continue;
    }
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return { ids, unresolved };
}

function exportUserConfig(config: RawUserConfig, registry: AccountRegistry): ExportedUserConfig {
  const {
    codex_auto_switch_selected_account_ids,
    webdav_sync_password: _webdavSyncPassword,
    ...rest
  } = config;

  return {
    ...rest,
    codex_auto_switch_selected_account_refs: mapAccountIdsToRefs(
      'codex',
      codex_auto_switch_selected_account_ids,
      registry,
    ),
  };
}

function importUserConfig(
  config: ExportedUserConfig,
  registry: AccountRegistry,
): { config: RawUserConfig; unresolved: number } {
  const { codex_auto_switch_selected_account_refs, ...rest } = config;
  const codexResolved = resolveAccountRefsToIds(codex_auto_switch_selected_account_refs, registry);
  return {
    config: {
      ...rest,
      codex_auto_switch_selected_account_ids: codexResolved.ids,
    },
    unresolved: codexResolved.unresolved,
  };
}

function exportCodexAccountGroups(
  groups: CodexAccountGroup[],
  registry: AccountRegistry,
): ExportedCodexAccountGroup[] {
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    sortOrder: group.sortOrder,
    createdAt: group.createdAt,
    accountRefs: mapAccountIdsToRefs('codex', group.accountIds, registry),
  }));
}

function importCodexAccountGroups(
  groups: ExportedCodexAccountGroup[],
  registry: AccountRegistry,
): { groups: CodexAccountGroup[]; unresolved: number } {
  let unresolved = 0;
  const restored = (Array.isArray(groups) ? groups : []).map((group) => {
    const resolved = resolveAccountRefsToIds(group.accountRefs, registry);
    unresolved += resolved.unresolved;
    return {
      id: group.id,
      name: group.name,
      sortOrder: group.sortOrder,
      createdAt: group.createdAt,
      accountIds: resolved.ids,
    };
  });
  return { groups: restored, unresolved };
}

function exportInstanceStore(
  store: RawInstanceStore,
  registry: AccountRegistry,
): ExportedInstanceStore {
  return {
    defaultSettings: {
      bindAccountRef:
        store.defaultSettings.bindAccountId != null
          ? mapAccountIdsToRefs('codex', [store.defaultSettings.bindAccountId], registry)[0] ?? null
          : null,
      extraArgs: normalizeString(store.defaultSettings.extraArgs) ?? '',
      launchMode: store.defaultSettings.launchMode,
      followLocalAccount: normalizeBoolean(store.defaultSettings.followLocalAccount) ?? false,
    },
    instances: Array.isArray(store.instances)
      ? store.instances.map((instance) => ({
          id: instance.id,
          name: instance.name,
          userDataDir: instance.userDataDir,
          workingDir: instance.workingDir ?? null,
          extraArgs: normalizeString(instance.extraArgs) ?? '',
          bindAccountRef:
            instance.bindAccountId != null
              ? mapAccountIdsToRefs('codex', [instance.bindAccountId], registry)[0] ?? null
              : null,
          launchMode: instance.launchMode,
          createdAt: instance.createdAt,
        }))
      : [],
  };
}

function importInstanceStore(
  store: ExportedInstanceStore,
  registry: AccountRegistry,
): { store: RawInstanceStore; unresolved: number } {
  let unresolved = 0;
  const defaultResolved = resolveAccountRef(store.defaultSettings.bindAccountRef, registry);
  if (store.defaultSettings.bindAccountRef && !defaultResolved) unresolved += 1;

  const restoredInstances = Array.isArray(store.instances)
    ? store.instances.map((instance) => {
        const resolvedId = resolveAccountRef(instance.bindAccountRef, registry);
        if (instance.bindAccountRef && !resolvedId) unresolved += 1;
        return {
          id: instance.id,
          name: instance.name,
          userDataDir: instance.userDataDir,
          workingDir: instance.workingDir ?? null,
          extraArgs: normalizeString(instance.extraArgs) ?? '',
          bindAccountId: resolvedId,
          launchMode: instance.launchMode,
          createdAt: instance.createdAt,
          lastLaunchedAt: null,
          lastPid: null,
        } as RawInstanceProfile;
      })
    : [];

  return {
    store: {
      defaultSettings: {
        bindAccountId: defaultResolved,
        extraArgs: normalizeString(store.defaultSettings.extraArgs) ?? '',
        launchMode: store.defaultSettings.launchMode,
        followLocalAccount: normalizeBoolean(store.defaultSettings.followLocalAccount) ?? false,
        lastPid: null,
      },
      instances: restoredInstances,
    },
    unresolved,
  };
}

async function exportCodexWakeupState(
  registry: AccountRegistry,
): Promise<ExportedCodexWakeupState> {
  const state = await getCodexWakeupState();
  const runtime = await getCodexWakeupCliStatus();
  return {
    enabled: state.enabled,
    model_presets: Array.isArray(state.model_presets) ? state.model_presets : [],
    runtime: {
      codex_cli_path: runtime.configured_codex_cli_path,
      node_path: runtime.configured_node_path,
    },
    tasks: Array.isArray(state.tasks)
      ? state.tasks.map((task) => ({
          ...task,
          account_refs: mapAccountIdsToRefs('codex', task.account_ids, registry),
        }))
      : [],
  };
}

function importCodexWakeupState(
  state: ExportedCodexWakeupState,
  registry: AccountRegistry,
): { state: { enabled: boolean; tasks: CodexWakeupTask[]; model_presets: CodexWakeupModelPreset[]; runtime: { codex_cli_path?: string; node_path?: string } }; unresolved: number; disabledTasks: number } {
  let unresolved = 0;
  let disabledTasks = 0;
  const tasks = (Array.isArray(state.tasks) ? state.tasks : []).map((task) => {
    const { account_refs, ...rest } = task;
    const resolved = resolveAccountRefsToIds(account_refs, registry);
    unresolved += resolved.unresolved;
    const disabled = resolved.unresolved > 0;
    if (disabled) disabledTasks += 1;
    return {
      ...rest,
      enabled: disabled ? false : rest.enabled,
      account_ids: resolved.ids,
    } as CodexWakeupTask;
  });

  return {
    state: {
      enabled: Boolean(state.enabled),
      tasks,
      model_presets: Array.isArray(state.model_presets) ? state.model_presets : [],
      runtime: {
        codex_cli_path: state.runtime?.codex_cli_path,
        node_path: state.runtime?.node_path,
      },
    },
    unresolved,
    disabledTasks,
  };
}

async function exportConfigBundle(registry: AccountRegistry): Promise<DataTransferConfigBundle> {
  const userConfig = await invoke<RawUserConfig>('data_transfer_get_user_config');
  const groupSettings = await getGroupSettings();
  const codexAccountGroups = await getCodexAccountGroups();
  const codexModelProviders = await listCodexModelProviders();
  const codexInstanceStore = await invoke<RawInstanceStore>('data_transfer_get_instance_store', {
    platform: 'codex',
  });

  return {
    user_config: exportUserConfig(userConfig, registry),
    group_settings: groupSettings,
    codex_account_groups: exportCodexAccountGroups(codexAccountGroups, registry),
    codex_model_providers: codexModelProviders,
    instance_stores: {
      codex: exportInstanceStore(codexInstanceStore, registry),
    },
    codex_wakeup: await exportCodexWakeupState(registry),
    current_account_refresh_minutes: loadCurrentAccountRefreshMinutesMap(),
    platform_layout_config: safeGetLocalStorageItem('agtools.platform_layout.v1'),
    platform_layout_custom_icons: safeGetLocalStorageItem('agtools.platform_layout.custom_icons.v1'),
    compact_group_order: safeGetLocalStorageItem('compactGroupOrder'),
    compact_group_colors: safeGetLocalStorageItem('compactGroupColors'),
    compact_hidden_groups: safeGetLocalStorageItem('compactHiddenGroups'),
    app_language: localStorage.getItem('app-language') ?? undefined,
  };
}

async function importConfigBundle(bundle: DataTransferConfigBundle): Promise<DataTransferConfigImportResult> {
  const registry = await loadAccountRegistry();
  let unresolvedAccountRefs = 0;
  let disabledTaskCount = 0;

  const userConfigImport = importUserConfig(bundle.user_config, registry);
  unresolvedAccountRefs += userConfigImport.unresolved;
  const needsRestart = await invoke<boolean>('data_transfer_apply_user_config', {
    config: userConfigImport.config,
  });

  if (bundle.group_settings) {
    await saveGroupSettings(
      bundle.group_settings.groupMappings ?? {},
      bundle.group_settings.groupNames ?? {},
      bundle.group_settings.groupOrder ?? [],
    );
  }

  const codexAccountGroupsImport = importCodexAccountGroups(bundle.codex_account_groups ?? [], registry);
  unresolvedAccountRefs += codexAccountGroupsImport.unresolved;
  await invoke('save_codex_account_groups', {
    data: JSON.stringify(codexAccountGroupsImport.groups, null, 2),
  });
  invalidateCodexGroupCache();

  await invoke('save_codex_model_providers', {
    data: JSON.stringify(bundle.codex_model_providers ?? [], null, 2),
  });
  invalidateCodexModelProviderCache();

  const codexStore = bundle.instance_stores?.codex;
  if (codexStore) {
    const imported = importInstanceStore(codexStore, registry);
    unresolvedAccountRefs += imported.unresolved;
    await invoke('data_transfer_replace_instance_store', {
      platform: 'codex',
      store: imported.store,
    });
  }

  if (bundle.codex_wakeup) {
    const codexWakeupImport = importCodexWakeupState(bundle.codex_wakeup, registry);
    unresolvedAccountRefs += codexWakeupImport.unresolved;
    disabledTaskCount += codexWakeupImport.disabledTasks;
    await saveCodexWakeupState(
      codexWakeupImport.state.enabled,
      codexWakeupImport.state.tasks,
      codexWakeupImport.state.model_presets,
    );
    await updateCodexWakeupRuntimeConfig(
      normalizeString(codexWakeupImport.state.runtime.codex_cli_path) ?? undefined,
      normalizeString(codexWakeupImport.state.runtime.node_path) ?? undefined,
    );
  }

  if (bundle.platform_layout_config !== undefined) safeSetLocalStorageItem('agtools.platform_layout.v1', bundle.platform_layout_config);
  if (bundle.platform_layout_custom_icons !== undefined) safeSetLocalStorageItem('agtools.platform_layout.custom_icons.v1', bundle.platform_layout_custom_icons);
  if (bundle.compact_group_order !== undefined) safeSetLocalStorageItem('compactGroupOrder', bundle.compact_group_order);
  if (bundle.compact_group_colors !== undefined) safeSetLocalStorageItem('compactGroupColors', bundle.compact_group_colors);
  if (bundle.compact_hidden_groups !== undefined) safeSetLocalStorageItem('compactHiddenGroups', bundle.compact_hidden_groups);
  if (bundle.app_language !== undefined) localStorage.setItem('app-language', bundle.app_language);

  saveCurrentAccountRefreshMinutesMap(bundle.current_account_refresh_minutes ?? {});
  window.dispatchEvent(new Event('config-updated'));
  window.dispatchEvent(new Event('wakeup-tasks-updated'));

  return {
    applied: true,
    unresolved_account_ref_count: unresolvedAccountRefs,
    disabled_task_count: disabledTaskCount,
    needs_restart: needsRestart,
  };
}

function synthesizeAccountImportResult(importedCount: number): AccountTransferImportResult {
  return {
    imported_count: importedCount,
    platform_success_count: importedCount > 0 ? 1 : 0,
    platform_failed_count: importedCount > 0 ? 0 : 1,
    platform_skipped_count: 0,
    details: [
      {
        platform: 'codex',
        imported_count: importedCount,
        expected_count: importedCount,
        status: importedCount > 0 ? 'success' : 'failed',
        skipped: false,
      },
    ],
  };
}

function detectLegacyPlatform(value: unknown): PlatformId | null {
  const sample = Array.isArray(value)
    ? value.find((item) => isRecord(item))
    : isRecord(value)
      ? value
      : null;
  if (!sample) return null;
  if ('tokens' in sample || 'OPENAI_API_KEY' in sample || 'auth_mode' in sample || 'authMode' in sample) {
    return 'codex';
  }
  return null;
}

export function getDataTransferFileNameBase(selection: DataTransferSelection): string {
  if (selection.includeAccounts && selection.includeConfig) return 'cockpit_codex_data_backup';
  if (selection.includeAccounts) return 'cockpit_codex_accounts_backup';
  return 'cockpit_codex_config_backup';
}

export async function exportDataTransferJson(selection: DataTransferSelection): Promise<string> {
  ensureSelection(selection);
  const bundle: DataTransferBundle = {
    schema: DATA_TRANSFER_SCHEMA,
    version: DATA_TRANSFER_VERSION,
    exported_at: new Date().toISOString(),
    sections: {
      accounts: selection.includeAccounts,
      config: selection.includeConfig,
    },
  };

  if (selection.includeAccounts) {
    bundle.accounts = await buildAccountTransferBundle();
  }

  if (selection.includeConfig) {
    const registry = await loadAccountRegistry();
    bundle.config = await exportConfigBundle(registry);
  }

  return JSON.stringify(bundle, null, 2);
}

export async function importDataTransferJson(
  jsonContent: string,
  options: DataTransferImportOptions,
): Promise<DataTransferImportResult> {
  ensureSelection(options);
  const parsed = parseJsonOrThrow(jsonContent, 'invalid_json');

  if (isDataTransferBundle(parsed)) {
    if (parsed.version !== DATA_TRANSFER_VERSION) throw new Error('invalid_bundle_version');

    const warnings: DataTransferWarningCode[] = [];
    let accountResult: AccountTransferImportResult | null = null;
    let configResult: DataTransferConfigImportResult | null = null;

    if (options.includeAccounts) {
      if (parsed.accounts) {
        accountResult = await importAllAccountsFromTransferJson(JSON.stringify(parsed.accounts), {
          onProgress: options.onAccountProgress,
        });
      } else {
        warnings.push('accounts_section_missing');
      }
    }

    if (options.includeConfig) {
      if (parsed.config) {
        configResult = await importConfigBundle(parsed.config);
      } else {
        warnings.push('config_section_missing');
      }
    }

    if (!accountResult && !configResult) throw new Error('selected_sections_missing');

    return {
      detected_format: 'data_bundle',
      imported_account_count: accountResult?.imported_count ?? 0,
      account_result: accountResult,
      config_result: configResult,
      warnings,
    };
  }

  if (isAccountTransferBundleLike(parsed)) {
    if (!options.includeAccounts) throw new Error('accounts_section_not_selected');
    const accountResult = await importAllAccountsFromTransferJson(jsonContent, {
      onProgress: options.onAccountProgress,
    });
    return {
      detected_format: 'account_bundle',
      imported_account_count: accountResult.imported_count,
      account_result: accountResult,
      config_result: null,
      warnings: [],
    };
  }

  const legacyPlatform = detectLegacyPlatform(parsed);
  if (!legacyPlatform) throw new Error('unsupported_legacy_account_json');
  if (!options.includeAccounts) throw new Error('accounts_section_not_selected');

  const imported = await codexService.importCodexFromJson(jsonContent);
  const importedCount = Array.isArray(imported) ? imported.length : 0;
  const accountResult = synthesizeAccountImportResult(importedCount);
  options.onAccountProgress?.({
    current: 1,
    total: 1,
    platform: 'codex',
    status: 'success',
    current_platform: null,
    completed_platforms: 1,
    total_platforms: 1,
    processed_accounts: importedCount,
    total_accounts: importedCount,
    detail: accountResult.details[0],
    details: accountResult.details,
  });

  return {
    detected_format: 'legacy_account_json',
    legacy_account_platform: 'codex',
    imported_account_count: importedCount,
    account_result: accountResult,
    config_result: null,
    warnings: [],
  };
}