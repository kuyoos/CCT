import { Pin, PinOff, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { TauriEvent, listen } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import {
  getCodexLocalAccessState,
  queryCodexLocalAccessRequestLogs,
} from '../services/codexLocalAccessService';
import {
  hideCurrentFloatingCardWindow,
  hideFloatingCardWindow,
  saveFloatingCardPosition,
  setCurrentFloatingCardWindowAlwaysOnTop,
  setFloatingCardAlwaysOnTop,
} from '../services/floatingCardService';
import {
  CodexLocalAccessState,
  CodexLocalAccessUsageEvent,
} from '../types/codexLocalAccess';
import type { CodexAccount } from '../types/codex';
import { getCodexEffectiveQuotaPercentages } from '../types/codex';
import { useCodexAccountStore } from '../stores/useCodexAccountStore';
import { changeLanguage, normalizeLanguage } from '../i18n';
import './FloatingCardWindow.css';

const windowInstance = getCurrentWindow();
const FLOATING_CARD_WIDTH = 720;
const FLOATING_CARD_HEIGHT = 210;
const ACCOUNT_ESTIMATED_TOTAL_TOKENS = 5_000_000;
const REFRESH_INTERVAL_MS = 5_000;

type FloatingCardGeneralConfig = {
  language: string;
  theme: string;
  floating_card_always_on_top?: boolean;
};

function resolveAppliedTheme(theme: string): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme === 'dark' ? 'dark' : 'light';
}

function formatCompactCount(value: number | null | undefined): string {
  const normalized = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
  if (normalized >= 1_000_000_000) return `${Number((normalized / 1_000_000_000).toFixed(1))}b`;
  if (normalized >= 1_000_000) return `${Number((normalized / 1_000_000).toFixed(1))}m`;
  if (normalized >= 1_000) return `${Number((normalized / 1_000).toFixed(1))}k`;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(normalized);
}

function formatCompactTokenCount(value: number | null | undefined): string {
  const normalized = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
  if (normalized >= 1_000_000) return `${Number((normalized / 1_000_000).toFixed(2))}m`;
  if (normalized >= 1_000) return `${Number((normalized / 1_000).toFixed(1))}k`;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(normalized);
}

function formatLogTime(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value) || value <= 0) return '--';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function formatLatency(value: number | null | undefined): string {
  const normalized = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
  if (normalized >= 1000) return `${(normalized / 1000).toFixed(1)}s`;
  return `${Math.round(normalized)}ms`;
}

function resolveRemainingTokens(accounts: CodexAccount[], state: CodexLocalAccessState | null): number {
  const memberIds = state?.collection?.accountIds ?? [];
  const memberIdSet = new Set(memberIds);
  const memberAccounts = accounts.filter((account) => memberIdSet.has(account.id));
  return memberAccounts.reduce((sum, account) => {
    const percentages = getCodexEffectiveQuotaPercentages(account.quota);
    const remainingPercent = Math.max(0, Math.min(95, percentages.weekly ?? percentages.hourly ?? 0));
    return sum + Math.round((remainingPercent / 95) * ACCOUNT_ESTIMATED_TOTAL_TOKENS);
  }, 0);
}

export function FloatingCardWindow() {
  const { t } = useTranslation();
  const { accounts, fetchAccounts } = useCodexAccountStore();
  const [state, setState] = useState<CodexLocalAccessState | null>(null);
  const [recentLogs, setRecentLogs] = useState<CodexLocalAccessUsageEvent[]>([]);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadConfig = async () => {
      try {
        const config = await invoke<FloatingCardGeneralConfig>('get_general_config');
        if (cancelled) return;
        setAlwaysOnTop(Boolean(config.floating_card_always_on_top));
        const language = normalizeLanguage(config.language);
        await changeLanguage(language);
        document.documentElement.setAttribute('data-theme', resolveAppliedTheme(config.theme));
      } catch (error) {
        console.warn('[FloatingCard] failed to load config', error);
      }
    };
    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen(TauriEvent.WINDOW_MOVED, async () => {
      try {
        const position = await windowInstance.outerPosition();
        await saveFloatingCardPosition(position.x, position.y);
      } catch {}
    }).then((handler) => {
      unlisten = handler;
    });
    return () => unlisten?.();
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const [nextState, logPage] = await Promise.all([
        getCodexLocalAccessState(),
        queryCodexLocalAccessRequestLogs({ page: 1, pageSize: 3 }),
        fetchAccounts(),
      ]);
      setState(nextState);
      setRecentLogs(logPage.events.slice(0, 3));
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [fetchAccounts]);

  useEffect(() => {
    void windowInstance.setSize(new LogicalSize(FLOATING_CARD_WIDTH, FLOATING_CARD_HEIGHT));
    void loadStats();
    const timer = window.setInterval(() => void loadStats(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loadStats]);

  const handleAlwaysOnTop = async () => {
    const next = !alwaysOnTop;
    setAlwaysOnTop(next);
    try {
      if (windowInstance.label === 'floating-card') {
        await setFloatingCardAlwaysOnTop(next);
      } else {
        await setCurrentFloatingCardWindowAlwaysOnTop(next);
      }
    } catch {}
  };

  const handleClose = async () => {
    if (windowInstance.label === 'floating-card') {
      await hideFloatingCardWindow();
    } else {
      await hideCurrentFloatingCardWindow();
    }
  };

  const summary = useMemo(() => {
    const totals = state?.stats.totals;
    return {
      requestCount: totals?.requestCount ?? 0,
      totalTokens: totals?.totalTokens ?? 0,
      remainingTokens: resolveRemainingTokens(accounts, state),
      avgLatencyMs:
        totals && totals.requestCount > 0 ? totals.totalLatencyMs / totals.requestCount : 0,
    };
  }, [state, accounts]);

  return (
    <div className="floating-card-window" data-tauri-drag-region>
      <div className="floating-card-panel" data-tauri-drag-region>
        <div className="floating-card-header" data-tauri-drag-region>
          <div className="floating-card-heading">
            <div className="floating-card-kicker">API Service</div>
            <div className="floating-card-title">{t('floatingCard.apiStatsTitle', '请求统计')}</div>
          </div>
          <div className="floating-card-header-right">
            <div className={`floating-card-status ${state?.running ? 'is-running' : 'is-stopped'}`}>
              {state?.running ? t('common.running', '运行中') : t('common.stopped', '未运行')}
            </div>
            <div className="floating-card-actions">
              <button type="button" onClick={handleAlwaysOnTop} aria-label={t('floatingCard.pin', '置顶')}>
                {alwaysOnTop ? <PinOff size={14} /> : <Pin size={14} />}
              </button>
              <button type="button" onClick={handleClose} aria-label={t('common.close', '关闭')}>
                <X size={14} />
              </button>
            </div>
          </div>
        </div>

        <div className="floating-card-content">
          <div className="floating-card-metrics">
            <div className="floating-card-metric">
              <span>{t('codex.localAccess.stats.requests', '总请求数')}</span>
              <strong>{formatCompactCount(summary.requestCount)}</strong>
            </div>
            <div className="floating-card-metric">
              <span>{t('codex.localAccess.stats.tokens', '总 Token 数')}</span>
              <strong>{formatCompactTokenCount(summary.totalTokens)}</strong>
            </div>
            <div className="floating-card-metric">
              <span>{t('codex.apiService.accountStats.remainingAllTitle', '全部账号预估剩余')}</span>
              <strong>{formatCompactTokenCount(summary.remainingTokens)}</strong>
            </div>
            <div className="floating-card-metric">
              <span>{t('codex.localAccess.stats.avgLatency', '平均延迟')}</span>
              <strong>{formatLatency(summary.avgLatencyMs)}</strong>
            </div>
          </div>

          <div className="floating-card-log-section">
            <div className="floating-card-section-title">
              {t('floatingCard.latestRequests', '最新三条模型请求')}
            </div>
            <div className="floating-card-log-list">
              {recentLogs.length > 0 ? (
                recentLogs.map((log) => (
                  <div key={log.requestId || `${log.timestamp}-${log.modelId}`} className="floating-card-log-row">
                    <span className="floating-card-model" title={log.modelId || '-'}>{log.modelId || '-'}</span>
                    <span className={log.success ? 'floating-card-success' : 'floating-card-failure'}>
                      {log.success ? t('common.success', '成功') : t('common.failed', '失败')}
                    </span>
                    <span className="floating-card-account" title={log.email || log.accountId || '-'}>{log.email || log.accountId || '-'}</span>
                    <span>{formatCompactTokenCount(log.totalTokens)} token</span>
                    <span>{formatLogTime(log.timestamp)}</span>
                    <span>{formatLatency(log.latencyMs)}</span>
                  </div>
                ))
              ) : (
                <div className="floating-card-empty">
                  {loading ? t('common.loading', '加载中...') : t('floatingCard.noRequestLogs', '暂无请求日志')}
                </div>
              )}
            </div>
          </div>
        </div>

        {error && <div className="floating-card-error">{error}</div>}
      </div>
    </div>
  );
}