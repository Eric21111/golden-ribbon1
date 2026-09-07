import type { Href } from 'expo-router';

import type { UserRole } from '@/types/models';

export const roleHome: Record<UserRole, Href> = {
  owner: '/owner/dashboard',
  manager: '/manager/dashboard',
  cashier: '/cashier/dashboard',
};
