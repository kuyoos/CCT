import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useCodexAccountStore } from '../stores/useCodexAccountStore';
import {
  loadCurrentAccountRefreshMinutesMap,
  getAccountRefreshMinutes,
  type CurrentAccountRefreshPlatform,
} from '../utils/currentAccountRefresh';
import {
  createAutoRefreshScheduler,
  type AutoRefreshSchedulerHandle,
  type AutoRefreshSchedulerTask,
} from '../utils/autoRefreshScheduler';

interface GeneralConfig {
  codex_auto_refresh_minutes: number;
}

interface PlatformRefreshDescriptor {
  key: CurrentAccountRefreshPlatform;
  label: string;
  intervalMinutes: number;
  currentMinutes: number;
  fullRefreshingRef: MutableRefObject<boolean>;
  currentRefreshingRef: MutableRefObject<boolean>;
  runFullRefresh: () => Promise<void>;
  runCurrentRefresh: () => Promise<void>;
}

const STARTUP_AUTO_REFRESH_SETUP_DELAY_MS = 2500;
const AUTO_REFRESH_TICK_MS = 5_000;
const AUTO_REFRESH_MAX_CONCURRENT = 1;

function minutesToMs(minutes: number): number {
  return minutes * 60 * 1000;
}

function buildEnabledPlatformsSummary(descriptors: PlatformRefreshDescriptor[]): string {
  return descriptors
    .filter((descriptor) => descriptor.intervalMinutes > 0)
    .map((descriptor) => `${descriptor.key}=${descriptor.intervalMinutes},current=${descriptor.currentMinutes}`)
    .join(', ');
}

function getCurrentCodexEmail(): string | null {
  return useCodexAccountStore.getState().currentAccount?.email ?? null;
}

export function useAutoRefresh() {
  const refreshAllCodexQuotas = useCodexAccountStore((state) => state.refreshAllQuotas);
  const fetchCodexAccounts = useCodexAccountStore((state) => state.fetchAccounts);
  const fetchCurrentCodexAccount = useCodexAccountStore((state) => state.fetchCurrentAccount);

  const codexRefreshingRef = useRef(false);
  const codexCurrentRefreshingRef = useRef(false);
  const schedulerRef = useRef<AutoRefreshSchedulerHandle | null>(null);

  const runProviderCurrentRefresh = useCallback(
    async (
      fetchCurrent: () => Promise<void>,
      refreshCurrent: () => Promise<void>,
    ) => {
      await fetchCurrent();
      await refreshCurrent();
      await fetchCurrent();
    },
    [],
  );

  const buildRefreshDescriptors = useCallback((config: GeneralConfig): PlatformRefreshDescriptor[] => {
    const currentDefaults = loadCurrentAccountRefreshMinutesMap();
    const codexEmail = getCurrentCodexEmail();
    const codexCurrentMinutes = codexEmail
      ? getAccountRefreshMinutes('codex', codexEmail, currentDefaults.codex)
      : currentDefaults.codex;

    return [
      {
        key: 'codex',
        label: 'Codex',
        intervalMinutes: config.codex_auto_refresh_minutes,
        currentMinutes: codexCurrentMinutes,
        fullRefreshingRef: codexRefreshingRef,
        currentRefreshingRef: codexCurrentRefreshingRef,
        runFullRefresh: async () => {
          await refreshAllCodexQuotas();
        },
        runCurrentRefresh: async () => {
          await runProviderCurrentRefresh(fetchCurrentCodexAccount, async () => {
            const current = useCodexAccountStore.getState().currentAccount;
            if (current?.id) {
              await useCodexAccountStore.getState().refreshQuota(current.id);
            }
          });
        },
      },
    ];
  }, [fetchCurrentCodexAccount, refreshAllCodexQuotas, runProviderCurrentRefresh]);

  const buildTasks = useCallback((descriptors: PlatformRefreshDescriptor[]): AutoRefreshSchedulerTask[] => {
    const tasks: AutoRefreshSchedulerTask[] = [];

    for (const descriptor of descriptors) {
      if (descriptor.intervalMinutes > 0) {
        tasks.push({
          key: `${descriptor.key}:full`,
          label: `${descriptor.label} full refresh`,
          intervalMs: minutesToMs(descriptor.intervalMinutes),
          shouldSkip: () => descriptor.fullRefreshingRef.current,
          run: async () => {
            if (descriptor.fullRefreshingRef.current) return;
            descriptor.fullRefreshingRef.current = true;
            try {
              console.info(`[AutoRefresh] ${descriptor.label} full refresh started`);
              await descriptor.runFullRefresh();
              console.info(`[AutoRefresh] ${descriptor.label} full refresh finished`);
            } catch (error) {
              console.warn(`[AutoRefresh] ${descriptor.label} full refresh failed`, error);
            } finally {
              descriptor.fullRefreshingRef.current = false;
            }
          },
        });
      }

      if (descriptor.currentMinutes > 0) {
        tasks.push({
          key: `${descriptor.key}:current`,
          label: `${descriptor.label} current refresh`,
          intervalMs: minutesToMs(descriptor.currentMinutes),
          shouldSkip: () => descriptor.currentRefreshingRef.current,
          run: async () => {
            if (descriptor.currentRefreshingRef.current) return;
            descriptor.currentRefreshingRef.current = true;
            try {
              console.info(`[AutoRefresh] ${descriptor.label} current refresh started`);
              await descriptor.runCurrentRefresh();
              console.info(`[AutoRefresh] ${descriptor.label} current refresh finished`);
            } catch (error) {
              console.warn(`[AutoRefresh] ${descriptor.label} current refresh failed`, error);
            } finally {
              descriptor.currentRefreshingRef.current = false;
            }
          },
        });
      }
    }

    return tasks;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let setupTimer: number | null = null;

    const startScheduler = async () => {
      try {
        const config = await invoke<GeneralConfig>('get_general_config');
        if (cancelled) return;

        await fetchCodexAccounts();
        await fetchCurrentCodexAccount();

        const descriptors = buildRefreshDescriptors(config);
        const tasks = buildTasks(descriptors);
        schedulerRef.current?.stop();
        schedulerRef.current = createAutoRefreshScheduler(tasks, {
          tickMs: AUTO_REFRESH_TICK_MS,
          maxConcurrent: AUTO_REFRESH_MAX_CONCURRENT,
        });
        schedulerRef.current.start();

        const summary = buildEnabledPlatformsSummary(descriptors);
        console.info(`[AutoRefresh] scheduler started: ${summary || 'disabled'}`);
      } catch (error) {
        console.warn('[AutoRefresh] failed to start scheduler', error);
      }
    };

    setupTimer = window.setTimeout(() => {
      void startScheduler();
    }, STARTUP_AUTO_REFRESH_SETUP_DELAY_MS);

    return () => {
      cancelled = true;
      if (setupTimer !== null) {
        window.clearTimeout(setupTimer);
      }
      schedulerRef.current?.stop();
      schedulerRef.current = null;
    };
  }, [buildRefreshDescriptors, buildTasks, fetchCodexAccounts, fetchCurrentCodexAccount]);
}