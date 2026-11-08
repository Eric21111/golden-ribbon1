import type { DiscrepancyResolutionStatus } from '@/types/models';

export type AttentionItem = {
  title: string;
  value: number;
  description: string;
  href: string;
};

/** Unresolved = anything not explicitly resolved (matches the discrepancy reports' Open badge). */
export function countUnresolved(rows: ReadonlyArray<{ status?: DiscrepancyResolutionStatus | null }>): number {
  return rows.filter((row) => (row.status ?? 'open') !== 'resolved').length;
}

/** Builds the Needs Attention alerts, in display order, keeping only positive counts. */
export function buildAttentionItems(counts: {
  pendingIncoming?: number;
  pendingOutgoing?: number;
  returnsInTransit?: number;
  transferDiscrepancies?: number;
  returnDiscrepancies?: number;
}): AttentionItem[] {
  const items: Array<Omit<AttentionItem, 'value'> & { value: number | undefined }> = [
    {
      title: 'Pending incoming',
      value: counts.pendingIncoming,
      description: 'Count and receive stock sent to this branch',
      href: '/manager/incoming',
    },
    {
      title: 'Pending transfers',
      value: counts.pendingOutgoing,
      description: 'Sent to branches and awaiting receipt',
      href: '/manager/transfers',
    },
    {
      title: 'Returns in transit',
      value: counts.returnsInTransit,
      description: 'Unsold stock returning to Main Branch',
      href: '/manager/returns',
    },
    {
      title: 'Transfer discrepancies',
      value: counts.transferDiscrepancies,
      description: 'Unresolved missing or excess items on received transfers',
      href: '/manager/reports/transfer-discrepancies',
    },
    {
      title: 'Return discrepancies',
      value: counts.returnDiscrepancies,
      description: 'Unresolved missing or excess items on received returns',
      href: '/manager/reports/return-discrepancies',
    },
  ];
  return items.filter((item): item is AttentionItem => typeof item.value === 'number' && item.value > 0);
}
