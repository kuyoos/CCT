import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Pin, PinOff, RefreshCw, X } from 'lucide-react';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { TauriEvent, listen } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import { buildCodexAccountPresentation, type UnifiedAccountPresentation } from '../presentation/platformAccountPresentation';
import {
  getFloatingCardContext,
  hideCurrentFloatingCardWindow,
  hideFloatingCardWindow,
  saveFloatingCardPosition,
  setCurrentFloatingCardWindowAlwaysOnTop,
  setFloatingCardAlwaysOnTop,
  showMainWindowAndNavigate,
} from '../services/floatingCardService';
import { useCodexAccountStore } from '../stores/useCodexAccountStore';
import { useCodexInstanceStore } from '../stores/useCodexInstanceStore';
import type { InstanceProfile } from '../types/instance';
import { maskSensitiveValue } from '../utils/privacy';
import { getRecommendedCodexAccount, resolveCurrentOrMostRecentAccount } from '../utils/floatingCardSelectors';
import { changeLanguage, normalizeLanguage } from '../i18n';
import './FloatingCardWindow.css';

const windowInstance = getCurrentWindow();
const FLOATING_CARD_WINDOW_LABEL = 'floating-card';
const INSTANCE_FLOATING_CARD_WINDOW_LABEL_PREFIX = 'instance-floating-card-';
const FLOATING_CARD_BASE_HEIGHT = 290;
const FLOATING_CARD_MAX_HEIGHT = 520;

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

function findInstanceById(instances: InstanceProfile[], instanceId: string): InstanceProfile | null {
  return instances.find((instance) => instance.id === instanceId) ?? null;
}

export function FloatingCardWindow() {
  const { t } = useTranslation();
  const currentWindowLabel = windowInstance.label;
  const isPrimaryFloatingCardWindow = currentWindowLabel === FLOATING_CARD_WINDOW_LABEL;
  const isInstanceFloatingCardWindow = currentWindowLabel.startsWith(
    INSTANCE_FLOATING_CARD_WINDOW_LABEL_PREFIX,
  );

  const { accounts, currentAccount, fetchAccounts, fetchCurrentAccount, switchAccount, refreshQuota } = useCodexAccountStore();
  const { instances, refreshInstances, updateInstance, startInstance } = useCodexInstanceStore();
  const [instanceContext, setInstanceContext] = useState<Awaited<ReturnType<typeof getFloatingCardContext>>>(null);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [privacyModeEnabled, setPrivacyModeEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      setLoading(true);
      try {
        await Promise.all([fetchAccounts(), fetchCurrentAccount(), refreshInstances()]);
        if (isInstanceFloatingCardWindow) {
          const context = await getFloatingCardContext(currentWindowLabel);
          if (!cancelled) setInstanceContext(context);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [currentWindowLabel, fetchAccounts, fetchCurrentAccount, isInstanceFloatingCardWindow, refreshInstances]);

  const boundInstance = useMemo(() => {
    if (!instanceContext) return null;
    return findInstanceById(instances, instanceContext.instanceId);
  }, [instanceContext, instances]);

  const viewedAccount = useMemo(() => {
    if (instanceContext?.boundAccountId) {
      return accounts.find((account) => account.id === instanceContext.boundAccountId) ?? null;
    }
    return resolveCurrentOrMostRecentAccount(accounts, currentAccount?.id);
  }, [accounts, currentAccount?.id, instanceContext?.boundAccountId]);

  const presentation = useMemo<UnifiedAccountPresentation | null>(() => {
    return viewedAccount ? buildCodexAccountPresentation(viewedAccount, t) : null;
  }, [t, viewedAccount]);

  const recommendedAccount = useMemo(() => {
    return getRecommendedCodexAccount(accounts, viewedAccount?.id ?? currentAccount?.id);
  }, [accounts, currentAccount?.id, viewedAccount?.id]);

  const canSwitch = Boolean(selectedAccountId && selectedAccountId !== viewedAccount?.id);

  const updateHeight = useCallback(async () => {
    const quotaCount = presentation?.quotaItems.length ?? 0;
    const nextHeight = Math.min(FLOATING_CARD_MAX_HEIGHT, FLOATING_CARD_BASE_HEIGHT + quotaCount * 34);
    try {
      await windowInstance.setSize(new LogicalSize(360, nextHeight));
    } catch {}
  }, [presentation?.quotaItems.length]);

  useEffect(() => {
    void updateHeight();
  }, [updateHeight]);

  const mask = useCallback(
    (value?: string | null) => (privacyModeEnabled ? maskSensitiveValue(value || '') : value || ''),
    [privacyModeEnabled],
  );

  const handleRefresh = async () => {
    if (!viewedAccount) return;
    setLoading(true);
    setMessage(null);
    try {
      await refreshQuota(viewedAccount.id);
      await fetchAccounts();
      setMessage(t('common.refreshSuccess', '刷新成功'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleSwitch = async (accountId: string) => {
    setLoading(true);
    setMessage(null);
    try {
      if (instanceContext?.instanceId && boundInstance) {
        await updateInstance({ instanceId: instanceContext.instanceId, bindAccountId: accountId });
      } else {
        await switchAccount(accountId);
      }
      await fetchCurrentAccount();
      await refreshInstances();
      setSelectedAccountId(null);
      setMessage(t('common.switchSuccess', '切换成功'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleStartInstance = async () => {
    if (!instanceContext?.instanceId) return;
    setLoading(true);
    try {
      await startInstance(instanceContext.instanceId);
      setMessage(t('instances.status.running', '已启动'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleAlwaysOnTop = async () => {
    const next = !alwaysOnTop;
    setAlwaysOnTop(next);
    try {
      if (isPrimaryFloatingCardWindow) {
        await setFloatingCardAlwaysOnTop(next);
      } else {
        await setCurrentFloatingCardWindowAlwaysOnTop(next);
      }
    } catch {}
  };

  const handleClose = async () => {
    if (isPrimaryFloatingCardWindow) {
      await hideFloatingCardWindow();
    } else {
      await hideCurrentFloatingCardWindow();
    }
  };

  const goMain = async () => {
    await showMainWindowAndNavigate('codex');
    await handleClose();
  };

  return (
    <div className="floating-card-window">
      <div className="floating-card-titlebar" data-tauri-drag-region>
        <div className="floating-card-title" data-tauri-drag-region>
          <span>{isInstanceFloatingCardWindow ? instanceContext?.instanceName || 'Codex Instance' : 'Codex'}</span>
        </div>
        <div className="floating-card-window-actions">
          <button type="button" onClick={() => setPrivacyModeEnabled((value) => !value)}>
            {privacyModeEnabled ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
          <button type="button" onClick={handleAlwaysOnTop}>
            {alwaysOnTop ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
          <button type="button" onClick={handleClose}><X size={14} /></button>
        </div>
      </div>

      <div className="floating-card-body">
        {presentation ? (
          <>
            <div className="floating-card-account">
              <div>
                <div className="floating-card-account-name">{mask(presentation.displayName)}</div>
                <div className={`floating-card-plan ${presentation.planClass}`}>{presentation.planLabel}</div>
              </div>
              <button type="button" className="floating-card-icon-button" onClick={handleRefresh} disabled={loading}>
                <RefreshCw size={15} className={loading ? 'loading-spinner' : ''} />
              </button>
            </div>

            <div className="floating-card-quotas">
              {presentation.quotaItems.length > 0 ? presentation.quotaItems.map((item) => (
                <div key={item.key} className="floating-card-quota-row" title={item.hintText || item.resetText || ''}>
                  <span>{item.label}</span>
                  <strong className={item.quotaClass}>{item.valueText}</strong>
                </div>
              )) : (
                <div className="floating-card-empty">{t('instances.quota.empty', '暂无配额缓存')}</div>
              )}
            </div>

            {accounts.length > 1 && (
              <div className="floating-card-switcher">
                <select
                  value={selectedAccountId ?? viewedAccount?.id ?? ''}
                  onChange={(event) => setSelectedAccountId(event.target.value)}
                >
                  {accounts.map((account) => {
                    const item = buildCodexAccountPresentation(account, t);
                    return <option key={account.id} value={account.id}>{item.displayName}</option>;
                  })}
                </select>
                <button type="button" onClick={() => selectedAccountId && handleSwitch(selectedAccountId)} disabled={!canSwitch || loading}>
                  {t('common.shared.switchAccount', '切换账号')}
                </button>
              </div>
            )}

            {recommendedAccount && (
              <button type="button" className="floating-card-secondary-action" onClick={() => handleSwitch(recommendedAccount.id)} disabled={loading}>
                {t('floatingCard.switchRecommended', '切换到推荐账号')}
              </button>
            )}

            {isInstanceFloatingCardWindow && (
              <button type="button" className="floating-card-secondary-action" onClick={handleStartInstance} disabled={loading}>
                {t('instances.actions.start', '启动实例')}
              </button>
            )}
          </>
        ) : (
          <div className="floating-card-empty">
            {loading ? t('common.loading', '加载中...') : t('codex.noAccounts', '暂无 Codex 账号')}
          </div>
        )}

        {message && <div className="floating-card-message">{message}</div>}
      </div>

      <div className="floating-card-footer">
        <button type="button" onClick={goMain}>{t('common.openMainWindow', '打开主窗口')}</button>
      </div>
    </div>
  );
}