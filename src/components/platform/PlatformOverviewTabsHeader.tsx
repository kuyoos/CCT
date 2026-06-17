import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock3, FolderOpen, Layers, Server } from 'lucide-react';
import { CodexIcon } from '../icons/CodexIcon';
import { ManualHelpIconButton } from '../ManualHelpIconButton';
import { TopCenterPromoBanner } from '../TopCenterPromoBanner';
import { PlatformGroupSwitcher } from './PlatformGroupSwitcher';

export type PlatformOverviewTab = 'overview' | 'wakeup' | 'instances' | 'sessions' | 'providers';
export type PlatformOverviewHeaderId = 'codex';

interface PlatformOverviewTabsHeaderProps {
  platform: PlatformOverviewHeaderId;
  active: PlatformOverviewTab;
  onTabChange?: (tab: PlatformOverviewTab) => void;
  tabs?: PlatformOverviewTab[];
}

interface TabSpec {
  key: PlatformOverviewTab;
  label: string;
  icon: ReactNode;
}

export function PlatformOverviewTabsHeader({
  active,
  onTabChange,
  tabs,
}: PlatformOverviewTabsHeaderProps) {
  const { t } = useTranslation();
  const tabOrder: PlatformOverviewTab[] =
    tabs && tabs.length > 0 ? tabs : ['overview', 'instances'];
  const tabLabels: Record<PlatformOverviewTab, TabSpec> = {
    overview: {
      key: 'overview',
      label: t('overview.title', '账号总览'),
      icon: <CodexIcon className="tab-icon" />,
    },
    wakeup: {
      key: 'wakeup',
      label: t('codex.wakeup.tab', '唤醒任务'),
      icon: <Clock3 className="tab-icon" />,
    },
    instances: {
      key: 'instances',
      label: t('instances.title', '多开实例'),
      icon: <Layers className="tab-icon" />,
    },
    sessions: {
      key: 'sessions',
      label: t('codex.sessionManager.title', '会话管理'),
      icon: <FolderOpen className="tab-icon" />,
    },
    providers: {
      key: 'providers',
      label: t('codex.modelProviders.tab', '模型供应商'),
      icon: <Server className="tab-icon" />,
    },
  };
  const tabSpecs = tabOrder.map((tab) => tabLabels[tab]);

  return (
    <>
      <div className="page-top-strip">
        <div className="page-top-strip-left">
          <span className="page-top-strip-label">
            {t('settings.general.account', '账号')}
          </span>
          <ManualHelpIconButton className="platform-header-help" />
        </div>
        <TopCenterPromoBanner />
        <div className="page-top-strip-right-placeholder" aria-hidden="true" />
      </div>
      <div className="page-tabs-row page-tabs-center page-tabs-row-with-leading">
        <div className="page-tabs-leading">
          <PlatformGroupSwitcher
            currentPlatformId="codex"
            currentLabel="Codex"
            options={[{ platformId: 'codex', label: 'Codex' }]}
            currentGroupId={null}
            extraOptions={[
              {
                id: 'codex-api-service',
                label: t('codex.apiService.navTitle', 'Codex API 服务'),
                page: 'codex-api-service',
                icon: <CodexIcon size={18} />,
              },
            ]}
          />
        </div>
        <div className="page-tabs filter-tabs">
          {tabSpecs.map((tab) => (
            <button
              key={tab.key}
              className={`filter-tab${active === tab.key ? ' active' : ''}`}
              onClick={() => onTabChange?.(tab.key)}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}