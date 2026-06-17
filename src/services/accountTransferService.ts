import { CodexAccount } from '../types/codex';
import * as codexService from './codexService';

export const ACCOUNT_TRANSFER_SCHEMA = 'cockpit-tools.codex-account-transfer';
export const ACCOUNT_TRANSFER_VERSION = 1;

export interface AccountTransferImportProgressDetail {
  platform: 'codex';
  imported_count: number;
  skipped: boolean;
  error?: string;
}

export interface AccountTransferImportProgress {
  current: number;
  total: number;
  platform: 'codex';
  status: 'importing' | 'success' | 'error';
  detail?: AccountTransferImportProgressDetail;
}

export interface AccountTransferImportResult {
  imported_count: number;
  platform_success_count: number;
  platform_failed_count: number;
  platform_skipped_count: number;
  details: AccountTransferImportProgressDetail[];
}

export interface AccountTransferBundle {
  schema: typeof ACCOUNT_TRANSFER_SCHEMA;
  version: typeof ACCOUNT_TRANSFER_VERSION;
  exported_at: string;
  platforms: {
    codex: {
      exported_at: string;
      accounts: unknown;
      count: number;
    };
  };
}

function parseJson(value: string, errorCode: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(errorCode);
  }
}

function countCodexAccounts(exportedJson: string): number {
  const parsed = parseJson(exportedJson, 'invalid_codex_account_json');
  if (Array.isArray(parsed)) return parsed.length;
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.accounts)) return record.accounts.length;
    if (Array.isArray(record.codex_accounts)) return record.codex_accounts.length;
  }
  return 0;
}

export async function buildAccountTransferBundle(): Promise<AccountTransferBundle> {
  const accounts = await codexService.listCodexAccounts();
  const accountIds = accounts.map((account) => account.id);
  const exported = await codexService.exportCodexAccounts(accountIds);

  return {
    schema: ACCOUNT_TRANSFER_SCHEMA,
    version: ACCOUNT_TRANSFER_VERSION,
    exported_at: new Date().toISOString(),
    platforms: {
      codex: {
        exported_at: new Date().toISOString(),
        accounts: parseJson(exported, 'invalid_codex_account_json'),
        count: accounts.length,
      },
    },
  };
}

function readCodexImportPayload(parsed: unknown): string {
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    if (record.schema === ACCOUNT_TRANSFER_SCHEMA) {
      return JSON.stringify(record.platforms && typeof record.platforms === 'object'
        ? (record.platforms as Record<string, unknown>).codex && typeof (record.platforms as Record<string, unknown>).codex === 'object'
          ? ((record.platforms as Record<string, Record<string, unknown>>).codex.accounts ?? [])
          : []
        : []);
    }
  }
  return JSON.stringify(parsed);
}

export async function importAllAccountsFromTransferJson(
  jsonContent: string,
  options?: { onProgress?: (progress: AccountTransferImportProgress) => void },
): Promise<AccountTransferImportResult> {
  const parsed = parseJson(jsonContent, 'invalid_json');
  const payload = readCodexImportPayload(parsed);
  const total = countCodexAccounts(payload);

  options?.onProgress?.({
    current: 0,
    total,
    platform: 'codex',
    status: 'importing',
  });

  try {
    const imported = await codexService.importCodexFromJson(payload);
    const importedCount = Array.isArray(imported) ? imported.length : 0;
    const detail: AccountTransferImportProgressDetail = {
      platform: 'codex',
      imported_count: importedCount,
      skipped: false,
    };
    options?.onProgress?.({
      current: 1,
      total: 1,
      platform: 'codex',
      status: 'success',
      detail,
    });
    return {
      imported_count: importedCount,
      platform_success_count: 1,
      platform_failed_count: 0,
      platform_skipped_count: 0,
      details: [detail],
    };
  } catch (error) {
    const detail: AccountTransferImportProgressDetail = {
      platform: 'codex',
      imported_count: 0,
      skipped: false,
      error: String(error).replace(/^Error:\s*/, ''),
    };
    options?.onProgress?.({
      current: 1,
      total: 1,
      platform: 'codex',
      status: 'error',
      detail,
    });
    return {
      imported_count: 0,
      platform_success_count: 0,
      platform_failed_count: 1,
      platform_skipped_count: 0,
      details: [detail],
    };
  }
}