import type { ReturnStatus } from '@/types/returns';

export type ReturnStatusFilter = ReturnStatus | '';

export const OWNER_RETURN_STATUS_CHOICES: Array<{ label: string; value: ReturnStatusFilter }> = [
  { label: 'All', value: '' },
  { label: 'In transit', value: 'in_transit' },
  { label: 'Received', value: 'received' },
  { label: 'Discrepancy', value: 'received_with_discrepancy' },
];

export const MANAGER_RETURN_STATUS_CHOICES: Array<{ label: string; value: ReturnStatusFilter }> = [
  { label: 'All', value: '' },
  { label: 'In transit', value: 'in_transit' },
  { label: 'Received', value: 'received' },
  { label: 'Discrepancy', value: 'received_with_discrepancy' },
];

export function returnFilterEmptyMessage(
  status: ReturnStatusFilter,
  hasSearch: boolean
): { title: string; message: string } {
  if (hasSearch) {
    return { title: 'No matches', message: 'Try another return number or branch name.' };
  }
  switch (status) {
    case 'in_transit':
      return {
        title: 'No returns in transit',
        message: 'Nothing is waiting for Main Branch receipt. Switch to All to see history.',
      };
    case 'received':
      return { title: 'No received returns', message: 'No clean receipts match this filter.' };
    case 'received_with_discrepancy':
      return { title: 'No discrepancy returns', message: 'No returns with receive differences.' };
    default:
      return { title: 'No returns yet', message: 'Confirmed stock returns will appear here.' };
  }
}
