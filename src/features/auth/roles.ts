import type { ProfileWithBranch } from '@/types/models';

export function isMainBranchManager(profile: ProfileWithBranch | null | undefined): boolean {
  return profile?.role === 'manager' && Boolean(profile.branch?.is_main_branch);
}

export function isSellingBranchManager(profile: ProfileWithBranch | null | undefined): boolean {
  return profile?.role === 'manager' && Boolean(profile.branch_id) && !profile.branch?.is_main_branch;
}

export function canChangeOwnEmail(profile: ProfileWithBranch | null | undefined): boolean {
  return profile?.role === 'owner' || isMainBranchManager(profile);
}
