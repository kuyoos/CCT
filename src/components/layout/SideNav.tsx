import { Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Page } from '../../types/navigation';
import { CodexIcon } from '../icons/CodexIcon';

interface SideNavProps {
  page: Page;
  setPage: (page: Page) => void;
}

interface NavItem {
  id: Page;
  label: string;
  icon: ReactNode;
}

export function SideNav({ page, setPage }: SideNavProps) {
  const { t } = useTranslation();

  const items: NavItem[] = [
    {
      id: 'codex',
      label: 'Codex',
      icon: <CodexIcon size={20} />,
    },
    {
      id: 'codex-api-service',
      label: t('codex.apiService.title', 'Codex API Service'),
      icon: <CodexIcon size={20} />,
    },
    {
      id: 'settings',
      label: t('nav.settings', '设置'),
      icon: <Settings size={20} />,
    },
  ];

  return (
    <aside className="side-nav side-nav-classic side-nav-codex-only">
      <div className="nav-brand">
        <div className="side-nav-brand-main">
          <button
            type="button"
            className="brand-logo"
            onClick={() => setPage('codex')}
            aria-label="Cockpit Codex"
          >
            <CodexIcon size={22} />
          </button>
          <div className="side-nav-brand-title">Cockpit Codex</div>
        </div>
      </div>

      <nav className="nav-items nav-items-no-scroll" aria-label={t('nav.main', '主导航')}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-item ${page === item.id ? 'active' : ''}`}
            onClick={() => setPage(item.id)}
          >
            <span className="nav-item-icon">{item.icon}</span>
            <span className="nav-item-text">{item.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}