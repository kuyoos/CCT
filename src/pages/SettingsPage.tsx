import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { changeLanguage, getCurrentLanguage, normalizeLanguage } from '../i18n';
import './settings/Settings.css';

type GeneralConfig = {
  language?: string;
  theme?: string;
  codex_app_path?: string;
  codex_launch_on_switch?: boolean;
};

export function SettingsPage() {
  const { t } = useTranslation();
  const [version, setVersion] = useState('');
  const [config, setConfig] = useState<GeneralConfig>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    void getVersion().then(setVersion).catch(() => setVersion(''));
    void invoke<GeneralConfig>('get_general_config')
      .then((value) => setConfig(value ?? {}))
      .catch((err) => setError(String(err)));
  }, []);

  const saveConfig = async (nextConfig: GeneralConfig) => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await invoke('save_general_config', { config: nextConfig });
      setConfig(nextConfig);
      if (nextConfig.language) {
        await changeLanguage(nextConfig.language);
      }
      setNotice(t('common.saved', '已保存'));
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const language = normalizeLanguage(config.language || getCurrentLanguage());
  const codexAppPath = config.codex_app_path || '';
  const codexLaunchOnSwitch = config.codex_launch_on_switch !== false;

  return (
    <div className="page-container settings-page">
      <div className="page-header">
        <div>
          <h1>{t('nav.settings', '设置')}</h1>
          <p>{t('settings.codexOnlySubtitle', '仅保留 Codex 与 Codex API Service 相关设置。')}</p>
        </div>
      </div>

      <div className="settings-section">
        <h2>{t('settings.general.title', '通用')}</h2>
        <div className="settings-row">
          <label>{t('settings.general.language', '语言')}</label>
          <select
            value={language}
            disabled={saving}
            onChange={(event) => void saveConfig({ ...config, language: event.target.value })}
          >
            <option value="zh-cn">简体中文</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>

      <div className="settings-section">
        <h2>Codex</h2>
        <div className="settings-row settings-row-stacked">
          <label>{t('settings.general.codexAppPath', 'Codex 启动路径')}</label>
          <input
            value={codexAppPath}
            disabled={saving}
            placeholder={t('settings.general.codexAppPathPlaceholder', '默认路径')}
            onChange={(event) => setConfig({ ...config, codex_app_path: event.target.value })}
            onBlur={() => void saveConfig({ ...config, codex_app_path: codexAppPath })}
          />
        </div>
        <div className="settings-row">
          <label>{t('settings.general.codexLaunchOnSwitch', '切换 Codex 时自动启动 Codex App')}</label>
          <input
            type="checkbox"
            checked={codexLaunchOnSwitch}
            disabled={saving}
            onChange={(event) => void saveConfig({
              ...config,
              codex_launch_on_switch: event.target.checked,
            })}
          />
        </div>
      </div>

      <div className="settings-section">
        <h2>{t('settings.about.title', '关于')}</h2>
        <div className="settings-row">
          <span>{t('settings.about.version', '版本')}</span>
          <strong>{version || '-'}</strong>
        </div>
      </div>

      {notice ? <div className="settings-notice success">{notice}</div> : null}
      {error ? <div className="settings-notice error">{error}</div> : null}
    </div>
  );
}