import type { Branch } from '@/types/models';

export type BranchFilter = 'all' | 'active' | 'inactive' | 'main';

export const BRANCH_FILTER_CHOICES: Array<{ label: string; value: BranchFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Inactive', value: 'inactive' },
  { label: 'Main', value: 'main' },
];

export function matchesBranchFilter(branch: Branch, filter: BranchFilter): boolean {
  switch (filter) {
    case 'active':
      return branch.is_active;
    case 'inactive':
      return !branch.is_active;
    case 'main':
      return branch.is_main_branch;
    default:
      return true;
  }
}

export function branchFilterEmptyMessage(
  filter: BranchFilter,
  hasSearch: boolean
): { title: string; message: string } {
  if (hasSearch) {
    return { title: 'No matches', message: 'Try another branch name or code.' };
  }
  switch (filter) {
    case 'active':
      return { title: 'No active branches', message: 'Activate a branch or switch to All.' };
    case 'inactive':
      return { title: 'No inactive branches', message: 'Inactive branches remain for history.' };
    case 'main':
      return { title: 'No Main Branch', message: 'Mark one branch as the Main Branch.' };
    default:
      return { title: 'No branches yet', message: 'Create the Main Branch to get started.' };
  }
}
