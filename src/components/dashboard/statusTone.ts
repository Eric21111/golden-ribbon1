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

/** Short label for badge pills — "Received With Discrepancy" wraps and crowds the row. */
export function transferStatusBadgeLabel(status: TransferStatus): string {
  switch (status) {
    case 'pending_receipt':
      return 'Pending';
    case 'received':
      return 'Received';
    case 'received_with_discrepancy':
      return 'Discrepancy';
    case 'draft':
      return 'Draft';
    case 'cancelled':
      return 'Cancelled';
  }
}

/** Short label for badge pills — "Received With Discrepancy" wraps and crowds the row. */
export function returnStatusBadgeLabel(status: ReturnStatus): string {
  switch (status) {
    case 'in_transit':
      return 'In transit';
    case 'received':
      return 'Received';
    case 'received_with_discrepancy':
      return 'Discrepancy';
    case 'draft':
      return 'Draft';
    case 'cancelled':
      return 'Cancelled';
  }
}

export function saleStatusTone(status: 'completed' | 'voided'): ManagerBadgeTone {
  return status === 'completed' ? 'success' : 'danger';
}

export function shiftStatusTone(status: 'open' | 'closed'): ManagerBadgeTone {
  return status === 'open' ? 'success' : 'neutral';
}
