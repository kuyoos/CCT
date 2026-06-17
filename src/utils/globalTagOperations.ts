import { useCodexAccountStore } from '../stores/useCodexAccountStore';

export const globalRenameTag = async (oldTag: string, newTag: string) => {
  const state = useCodexAccountStore.getState();
  for (const account of state.accounts || []) {
    if (account.tags?.includes(oldTag)) {
      const updatedTags = account.tags.map((tag: string) => (tag === oldTag ? newTag : tag));
      const uniqueTags = Array.from(new Set(updatedTags));
      await state.updateAccountTags(account.id, uniqueTags);
    }
  }
};

export const globalDeleteTag = async (targetTag: string) => {
  const state = useCodexAccountStore.getState();
  for (const account of state.accounts || []) {
    if (account.tags?.includes(targetTag)) {
      const updatedTags = account.tags.filter((tag: string) => tag !== targetTag);
      await state.updateAccountTags(account.id, updatedTags);
    }
  }
};