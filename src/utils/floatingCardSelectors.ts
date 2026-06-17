import type { CodexAccount } from '../types/codex';

export function resolveCurrentOrMostRecentAccount<T extends { id: string; last_used?: number | null; created_at?: number | null }>(
  accounts: T[],
  currentId: string | null | undefined,
): T | null {
  if (accounts.length === 0) return null;
  if (currentId) {
    const current = accounts.find((account) => account.id === currentId);
    if (current) return current;
  }
  return accounts.reduce((prev, curr) => {
    const prevScore = prev.last_used || prev.created_at || 0;
    const currScore = curr.last_used || curr.created_at || 0;
    return currScore > prevScore ? curr : prev;
  });
}

export function getRecommendedCodexAccount(
  accounts: CodexAccount[],
  currentId: string | null | undefined,
): CodexAccount | null {
  const candidates = accounts.filter((account) => account.id !== currentId);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, candidate) => {
    const bestScore = best.last_used || best.created_at || 0;
    const candidateScore = candidate.last_used || candidate.created_at || 0;
    return candidateScore > bestScore ? candidate : best;
  });
}