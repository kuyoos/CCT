import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings, RefreshCw, Zap, X } from 'lucide-react';
import * as codexService from '../services/codexService';
import {
  loadCurrentAccountRefreshMinutesMap,
  saveCurrentAccountRefreshMinutesMap,
} from '../utils/currentAccountRefresh';
import './QuickSettingsPopover.css';

export type QuickSettingsType = 'codex';

interface QuickSettingsPopoverProps {
  type: QuickSettingsType;
}

interface GeneralConfig {
  codex_auto_refresh_minutes: number;
  codex_launch_on_switch?: boolean;
}

function normalizeMinutes(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

export function QuickSettingsPopover({ type }: QuickSettingsPopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoRefreshMinutes, setAutoRefreshMinutes] = useState('0');
  const [currentRefreshMinutes, setCurrentRefreshMinutes] = useState('1');
  const [speed, setSpeed] = useState<'standard' | 'fast'>('standard');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || type !== 'codex') return;

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [generalConfig, speedConfig] = await Promise.all([
          invoke<GeneralConfig>('get_general_config'),
          codexService.getCodexAppSpeedConfig(),
        ]);
        if (cancelled) return;
        setAutoRefreshMinutes(String(generalConfig?.codex_auto_refresh_minutes ?? 0));
        setCurrentRefreshMinutes(String(loadCurrentAccountRefreshMinutesMap().codex));
        setSpeed(speedConfig.speed ?? 'standard');
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, type]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await invoke('update_general_config', {
        config: {
          codex_auto_refresh_minutes: normalizeMinutes(autoRefreshMinutes),
        },
      });
      saveCurrentAccountRefreshMinutesMap({
        codex: normalizeMinutes(currentRefreshMinutes) || 1,
      });
      await codexService.saveCodexAppSpeed(speed);
      setOpen(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="quick-settings-popover">
      <button
        type="button"
        className="quick-settings-trigger"
        onClick={() => setOpen((value) => !value)}
        title={t('quickSettings.title', '快速设置')}
      >
        <Settings size={16} />
      </button>

      {open && (
        <div className="quick-settings-panel">
          <div className="quick-settings-header">
            <div className="quick-settings-title">
              <Zap size={16} />
              <span>{t('quickSettings.codex.title', 'Codex 快速设置')}</span>
            </div>
            <button type="button" className="icon-button" onClick={() => setOpen(false)}>
              <X size={16} />
            </button>
          </div>

          {loading ? (
            <div className="quick-settings-loading">
              <RefreshCw size={16} className="spin" />
              <span>{t('common.loading', '加载中...')}</span>
            </div>
          ) : (
            <div className="quick-settings-content">
              <label className="quick-settings-field">
                <span>{t('settings.general.codexAutoRefreshMinutes', 'Codex 自动刷新间隔（分钟）')}</span>
                <input
                  type="number"
                  min="0"
                  value={autoRefreshMinutes}
                  onChange={(event) => setAutoRefreshMinutes(event.target.value)}
                />
              </label>

              <label className="quick-settings-field">
                <span>{t('settings.general.codexCurrentRefreshMinutes', '当前账号刷新间隔（分钟）')}</span>
                <input
                  type="number"
                  min="1"
                  value={currentRefreshMinutes}
                  onChange={(event) => setCurrentRefreshMinutes(event.target.value)}
                />
              </label>

              <label className="quick-settings-field">
                <span>{t('codex.appSpeed.title', 'Codex 启动速度')}</span>
                <select value={speed} onChange={(event) => setSpeed(event.target.value as typeof speed)}>
                  <option value="standard">{t('common.default', '默认')}</option>
                  <option value="fast">{t('codex.appSpeed.fast', '快速')}</option>
                </select>
              </label>

              {error && <div className="quick-settings-error">{error}</div>}

              <div className="quick-settings-actions">
                <button type="button" className="secondary-button" onClick={() => setOpen(false)}>
                  {t('common.cancel', '取消')}
                </button>
                <button type="button" className="primary-button" onClick={save} disabled={saving}>
                  {saving ? t('common.saving', '保存中...') : t('common.save', '保存')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}