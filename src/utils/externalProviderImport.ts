export const EXTERNAL_PROVIDER_IMPORT_EVENT = 'app:provider-import';

export type ExternalProviderImportPayload = {
  providerId: 'codex';
  page: 'codex';
  token: string;
  importUrl?: string | null;
  apiBaseUrl?: string | null;
  minAppVersion?: string | null;
  autoImport: boolean;
  activate: boolean;
  source?: string | null;
  rawUrl?: string | null;
};

type RawExternalProviderImportPayload = {
  providerId?: unknown;
  provider?: unknown;
  platform?: unknown;
  target?: unknown;
  token?: unknown;
  importToken?: unknown;
  payload?: unknown;
  importPayload?: unknown;
  importUrl?: unknown;
  import_url?: unknown;
  apiBaseUrl?: unknown;
  api_base_url?: unknown;
  baseUrl?: unknown;
  base_url?: unknown;
  minAppVersion?: unknown;
  min_app_version?: unknown;
  autoImport?: unknown;
  autoSubmit?: unknown;
  activate?: unknown;
  autoActivate?: unknown;
  source?: unknown;
  rawUrl?: unknown;
  url?: unknown;
};

let pendingExternalProviderImport: ExternalProviderImportPayload | null = null;

function normalizeAliasKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function resolveProviderId(raw: unknown): 'codex' | null {
  if (typeof raw !== 'string') return null;
  return normalizeAliasKey(raw) === 'codex' ? 'codex' : null;
}

function parseBooleanLike(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function readString(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

export function normalizeAntigravityExternalImportToken(rawToken: string): string {
  return rawToken.trim();
}

export function normalizeExternalProviderImportPayload(
  raw: unknown,
): ExternalProviderImportPayload | null {
  if (!raw || typeof raw !== 'object') return null;

  const payload = raw as RawExternalProviderImportPayload;
  const providerId = resolveProviderId(
    payload.providerId ?? payload.provider ?? payload.platform ?? payload.target,
  );
  if (!providerId) return null;

  const token =
    readString(
      payload.token ?? payload.importToken ?? payload.payload ?? payload.importPayload,
    ) ?? '';
  const importUrl = readString(payload.importUrl ?? payload.import_url);
  const apiBaseUrl = readString(
    payload.apiBaseUrl ?? payload.api_base_url ?? payload.baseUrl ?? payload.base_url,
  );
  if (!token && !importUrl) return null;

  return {
    providerId,
    page: 'codex',
    token,
    importUrl,
    apiBaseUrl,
    minAppVersion:
      readString(payload.minAppVersion ?? payload.min_app_version)?.replace(/^v/i, '') ?? null,
    autoImport: parseBooleanLike(payload.autoImport ?? payload.autoSubmit),
    activate: parseBooleanLike(payload.activate ?? payload.autoActivate),
    source: readString(payload.source),
    rawUrl: readString(payload.rawUrl ?? payload.url),
  };
}

export function queueExternalProviderImport(payload: ExternalProviderImportPayload): void {
  pendingExternalProviderImport = payload;
}

export function consumeQueuedExternalProviderImportForPlatform(
  platformId: 'codex',
): ExternalProviderImportPayload | null {
  if (!pendingExternalProviderImport || pendingExternalProviderImport.providerId !== platformId) {
    return null;
  }
  const payload = pendingExternalProviderImport;
  pendingExternalProviderImport = null;
  return payload;
}

export function dispatchExternalProviderImportEvent(payload: ExternalProviderImportPayload): void {
  queueExternalProviderImport(payload);
  window.dispatchEvent(
    new CustomEvent<ExternalProviderImportPayload>(EXTERNAL_PROVIDER_IMPORT_EVENT, {
      detail: payload,
    }),
  );
}