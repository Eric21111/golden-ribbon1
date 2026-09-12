import type { ManagerBadgeTone } from './ManagerBadge';

import type { TransferStatus } from '@/types/models';
import type { ReturnStatus } from '@/types/returns';

export function transferStatusTone(status: TransferStatus): ManagerBadgeTone {
  switch (status) {
    case 'pending_receipt':
      return 'warning';
    case 'received':
      return 'success';
    case 'received_with_discrepancy':
      return 'danger';
    case 'draft':
    case 'cancelled':
      return 'neutral';
  }
}

export function returnStatusTone(status: ReturnStatus): ManagerBadgeTone {
  switch (status) {
    case 'in_transit':
      return 'info';
    case 'received':
      return 'success';
    case 'received_with_discrepancy':
      return 'danger';
    case 'draft':
    case 'cancelled':
      return 'neutral';
  }
}

export function saleStatusTone(status: 'completed' | 'voided'): ManagerBadgeTone {
  return status === 'completed' ? 'success' : 'danger';
}

export function shiftStatusTone(status: 'open' | 'closed'): ManagerBadgeTone {
  return status === 'open' ? 'success' : 'neutral';
}
