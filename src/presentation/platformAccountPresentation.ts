import type { CodexAccount } from "../types/codex";
import {
  formatCodexResetTime,
  getCodexCodeReviewQuotaMetric,
  getCodexEffectiveQuotaPercentages,
  getCodexPlanBadgePresentation,
  getCodexQuotaClass,
  getCodexQuotaWindows,
  isCodexApiKeyAccount,
  isCodexChatCompletionsApiKeyAccount,
  isCodexNewApiAccount,
} from "../types/codex";

type Translate = {
  (key: string): string;
  (key: string, defaultValue: string): string;
  (key: string, options: Record<string, unknown>): string;
  (key: string, defaultValue: string, options: Record<string, unknown>): string;
};

export interface UnifiedQuotaMetric {
  key: string;
  label: string;
  percentage: number;
  quotaClass: string;
  valueText: string;
  resetText?: string;
  progressPercent?: number;
  showProgress?: boolean;
  resetAt?: string | number | null;
  used?: number;
  total?: number;
  left?: number;
  hintText?: string;
}

export interface UnifiedAccountPresentation {
  id: string;
  displayName: string;
  planLabel: string;
  planClass: string;
  quotaItems: UnifiedQuotaMetric[];
  cycleText?: string;
  sublineText?: string;
  sublineClass?: string;
}

export interface QuotaPreviewLine {
  key: string;
  label: string;
  percentage: number;
  quotaClass: string;
  text: string;
  title: string;
}

function toJsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNumber(
  value: Record<string, unknown> | null,
  key: string,
): number | null {
  const raw = value?.[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function readString(
  value: Record<string, unknown> | null,
  key: string,
): string {
  const raw = value?.[key];
  return typeof raw === "string" ? raw.trim() : "";
}

function readBoolean(
  value: Record<string, unknown> | null,
  key: string,
): boolean {
  return value?.[key] === true;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 100) return 100;
  return Math.round(value);
}

function normalizeUnixSeconds(value: number | null | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  if (value > 10_000_000_000) {
    return Math.floor(value / 1000);
  }
  return Math.floor(value);
}

function formatQuotaNumber(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "0";
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(
    Math.max(0, value),
  );
}

function formatMetricResetText(
  resetTime: number | null | undefined,
  t: Translate,
): string {
  const normalized = normalizeUnixSeconds(resetTime);
  return normalized ? formatCodexResetTime(normalized, t) : "";
}

function buildCodexNewApiQuotaItems(
  account: CodexAccount,
  t: Translate,
): UnifiedQuotaMetric[] {
  const raw = toJsonRecord(account.quota?.raw_data);
  const provider = readString(raw, "provider");
  if (provider !== "cockpit-api" && provider !== "new-api") {
    return [];
  }

  const profile = toJsonRecord(raw?.profile);
  const usage = toJsonRecord(raw?.usage) ?? toJsonRecord(profile?.usage);
  const total = readNumber(usage, "total_granted") ?? readNumber(raw, "total_granted") ?? 0;
  const used = readNumber(usage, "total_used") ?? readNumber(raw, "total_used") ?? 0;
  const available =
    readNumber(usage, "total_available") ?? readNumber(raw, "total_available") ?? 0;
  const unlimited = readBoolean(usage, "unlimited_quota") || readBoolean(raw, "unlimited_quota");
  const percentage = unlimited || total <= 0 ? (unlimited ? 100 : 0) : clampPercent((available / total) * 100);
  const expiresAt = readNumber(usage, "expires_at");
  const valueText = unlimited
    ? t("codex.newApi.quota.unlimited", "不限量")
    : readString(usage, "summary_display") || `${formatQuotaNumber(available)} / ${formatQuotaNumber(total)}`;

  return [
    {
      key: "new_api_quota",
      label: t("codex.newApi.quota.available", "额度"),
      percentage,
      quotaClass: getCodexQuotaClass(percentage),
      valueText,
      resetText: formatMetricResetText(expiresAt, t),
      resetAt: expiresAt,
      used,
      total,
      left: available,
      hintText: t("codex.newApi.quota.usedHint", {
        used: formatQuotaNumber(used),
        defaultValue: "已用 {{used}}",
      }),
    },
  ];
}

export function buildCodexAccountPresentation(
  account: CodexAccount,
  t: Translate,
): UnifiedAccountPresentation {
  const apiKeyDisplayName = account.account_name?.trim();
  const displayName =
    isCodexApiKeyAccount(account) && apiKeyDisplayName
      ? apiKeyDisplayName
      : isCodexNewApiAccount(account)
        ? "Codex API"
        : account.email;
  const effectiveQuota = getCodexEffectiveQuotaPercentages(account.quota);
  const weeklyBlocksHourlyHint = effectiveQuota.weeklyBlocksHourly
    ? t("codex.quota.weeklyBlocksHourly", "周额度为 0，5小时额度已不可用")
    : "";
  const newApiQuotaItems = isCodexNewApiAccount(account)
    ? buildCodexNewApiQuotaItems(account, t)
    : [];
  const quotaItems: UnifiedQuotaMetric[] = isCodexChatCompletionsApiKeyAccount(account)
    ? []
    : newApiQuotaItems.length > 0
      ? newApiQuotaItems
      : getCodexQuotaWindows(account.quota).map((window) => ({
          key: window.id,
          label: window.label,
          percentage: window.percentage,
          quotaClass: getCodexQuotaClass(window.percentage),
          valueText: `${window.percentage}%`,
          resetText: window.resetTime ? formatCodexResetTime(window.resetTime, t) : "",
          resetAt: window.resetTime,
          hintText:
            window.id === "primary" && weeklyBlocksHourlyHint
              ? weeklyBlocksHourlyHint
              : undefined,
        }));

  const codeReviewMetric = getCodexCodeReviewQuotaMetric(account.quota);
  if (codeReviewMetric) {
    quotaItems.push({
      key: "code_review",
      label: "Code Review",
      percentage: codeReviewMetric.percentage,
      quotaClass: getCodexQuotaClass(codeReviewMetric.percentage),
      valueText: `${codeReviewMetric.percentage}%`,
      resetText: codeReviewMetric.resetTime ? formatCodexResetTime(codeReviewMetric.resetTime, t) : "",
      resetAt: codeReviewMetric.resetTime,
    });
  }

  const planBadge = getCodexPlanBadgePresentation(account);
  return {
    id: account.id,
    displayName,
    planLabel: planBadge.label,
    planClass: planBadge.className,
    quotaItems,
  };
}

export function buildQuotaPreviewLines(
  quotaItems: UnifiedQuotaMetric[],
): QuotaPreviewLine[] {
  return quotaItems.map((item) => ({
    key: item.key,
    label: item.label,
    percentage: item.percentage,
    quotaClass: item.quotaClass,
    text: item.valueText,
    title: [item.label, item.valueText, item.resetText].filter(Boolean).join(" · "),
  }));
}