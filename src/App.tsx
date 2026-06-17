import { Suspense, lazy, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTranslation } from 'react-i18next';
import './App.css';
import { SideNav } from './components/layout/SideNav';
import { changeLanguage } from './i18n';
import type { Page } from './types/navigation';

const CodexAccountsPage = lazy(() =>
  import('./pages/CodexAccountsPage').then((module) => ({ default: module.CodexAccountsPage })),
);
const CodexApiServicePage = lazy(() =>
  import('./pages/CodexApiServicePage').then((module) => ({ default: module.CodexApiServicePage })),
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })),
);
const FloatingCardWindow = lazy(() =>
  import('./pages/FloatingCardWindow').then((module) => ({ default: module.FloatingCardWindow })),
);

function MainApp() {
  const { t } = useTranslation();
  const [page, setPage] = useState<Page>('codex');

  useEffect(() => {
    let cancelled = false;
    void invoke<{ language?: string }>('get_general_config')
      .then((config) => {
        if (!cancelled && config?.language) {
          void changeLanguage(config.language);
        }
      })
      .catch(() => {
        // keep bootstrap language
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    listen<string>('tray:navigate', (event) => {
      const target = String(event.payload || '');
      if (target === 'codex' || target === 'codex-api-service' || target === 'settings') {
        setPage(target);
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const handleRequestNavigate = (event: Event) => {
      const custom = event as CustomEvent<Page>;
      if (custom.detail === 'codex' || custom.detail === 'codex-api-service' || custom.detail === 'settings') {
        setPage(custom.detail);
      }
    };

    window.addEventListener('app-request-navigate', handleRequestNavigate as EventListener);
    return () => {
      window.removeEventListener('app-request-navigate', handleRequestNavigate as EventListener);
    };
  }, []);

  const fallback = <div className="loading-state">{t('common.loading', '加载中...')}</div>;

  return (
    <div className="app-container app-container-side-nav-classic">
      <SideNav page={page} setPage={setPage} />
      <div className="main-wrapper">
        <Suspense fallback={fallback}>
          {page === 'codex' && <CodexAccountsPage />}
          {page === 'codex-api-service' && <CodexApiServicePage />}
          {page === 'settings' && <SettingsPage />}
        </Suspense>
      </div>
    </div>
  );
}

function App() {
  const windowLabel = getCurrentWindow().label;
  if (windowLabel === 'floating-card' || windowLabel.startsWith('instance-floating-card-')) {
    return (
      <Suspense fallback={null}>
        <FloatingCardWindow />
      </Suspense>
    );
  }

  return <MainApp />;
}

export default App;