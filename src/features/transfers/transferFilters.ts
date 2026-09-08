import type { TransferStatus } from '@/types/models';

export type TransferStatusFilter = TransferStatus | '';

export const OWNER_STATUS_CHOICES: Array<{ label: string; value: TransferStatusFilter }> = [
  { label: 'All', value: '' },
  { label: 'Pending', value: 'pending_receipt' },
  { label: 'Received', value: 'received' },
  { label: 'Discrepancy', value: 'received_with_discrepancy' },
];

export const MANAGER_STATUS_CHOICES: Array<{ label: string; value: TransferStatusFilter }> = [
  { label: 'Pending', value: 'pending_receipt' },
  { label: 'All', value: '' },
  { label: 'Received', value: 'received' },
  { label: 'Discrepancy', value: 'received_with_discrepancy' },
];

export function transferFilterEmptyMessage(
  status: TransferStatusFilter,
  hasSearch: boolean,
  hasDestinationFilter: boolean
): { title: string; message: string } {
  if (hasSearch) {
    return { title: 'No matches', message: 'Try another transfer number or branch name.' };
  }
  if (hasDestinationFilter && !status) {
    return { title: 'No transfers for this branch', message: 'Try another destination or create a transfer.' };
  }
  switch (status) {
    case 'pending_receipt':
      return {
        title: 'No pending transfers',
        message: 'Nothing is waiting for receipt. Switch to All to see history.',
      };
    case 'received':
      return { title: 'No received transfers', message: 'No clean receipts match this filter.' };
    case 'received_with_discrepancy':
      return { title: 'No discrepancy transfers', message: 'No transfers with receive differences.' };
    default:
      return { title: 'No transfer history', message: 'Create a transfer to send Main Branch stock.' };
  }
}
