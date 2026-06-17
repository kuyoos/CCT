import type { Page } from '../types/navigation';

export const APIKEY_FUN_PREFILL_EVENT = 'app:apikey-fun-prefill';

export type ApiKeyFunPrefillTarget = 'codex';

export interface ApiKeyFunPrefillPayload {
  target: ApiKeyFunPrefillTarget;
  apiKey: string;
  apiKeyName?: string | null;
  providerName?: string | null;
  baseUrl?: string | null;
  sourceTag?: string | null;
  modelCatalog?: string[] | null;
}

let pendingPrefill: ApiKeyFunPrefillPayload | null = null;

export function getApiKeyFunPrefillPage(_target: ApiKeyFunPrefillTarget): Page {
  return 'codex';
}

export function dispatchApiKeyFunPrefillEvent(payload: ApiKeyFunPrefillPayload): void {
  pendingPrefill = payload;
  window.dispatchEvent(
    new CustomEvent<ApiKeyFunPrefillPayload>(APIKEY_FUN_PREFILL_EVENT, {
      detail: payload,
    }),
  );
}

export function consumeApiKeyFunPrefill(
  target: ApiKeyFunPrefillTarget,
): ApiKeyFunPrefillPayload | null {
  if (!pendingPrefill || pendingPrefill.target !== target) {
    return null;
  }
  const payload = pendingPrefill;
  pendingPrefill = null;
  return payload;
}
