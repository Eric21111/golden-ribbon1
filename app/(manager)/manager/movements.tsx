import { useAuth } from '@/features/auth/AuthProvider';
import { InventoryHistoryScreen } from '@/features/inventory/InventoryHistoryScreen';

export default function ManagerMovementsScreen() {
  const { profile } = useAuth();
  return <InventoryHistoryScreen branchId={profile?.branch_id ?? ''} branchName={profile?.branch?.name} />;
}
