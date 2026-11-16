import { Platform, Share } from 'react-native';

import type { ArchiveExportPackage } from '@/types/models';

function csvEscape(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header] as string | number | null | undefined)).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export type ArchiveDownloadFile = {
  name: string;
  content: string;
  mime: string;
};

export function buildArchiveFiles(pack: ArchiveExportPackage): ArchiveDownloadFile[] {
  return [
    {
      name: 'sales.csv',
      mime: 'text/csv',
      content: toCsv(
        [
          'id',
          'sale_number',
          'branch',
          'cashier_id',
          'cashier_name',
          'shift_id',
          'status',
          'total_amount',
          'amount_paid',
          'change_amount',
          'sold_at',
        ],
        pack.sales.map((sale) => ({
          id: sale.id,
          sale_number: sale.sale_number,
          branch: sale.branch_name,
          cashier_id: sale.cashier_id,
          cashier_name: sale.cashier_name,
          shift_id: sale.shift_id,
          status: sale.status,
          total_amount: sale.total_amount,
          amount_paid: sale.amount_paid,
          change_amount: sale.change_amount,
          sold_at: sale.sold_at,
        })),
      ),
    },
    {
      name: 'sale_items.csv',
      mime: 'text/csv',
      content: toCsv(
        ['sale_id', 'product_id', 'product_name', 'quantity', 'unit_price', 'subtotal', 'void_history'],
        pack.sale_items.map((item) => ({
          sale_id: item.sale_id,
          product_id: item.product_id,
          product_name: item.product_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          subtotal: item.subtotal,
          void_history: JSON.stringify(item.void_history ?? []),
        })),
      ),
    },
    {
      name: 'void_events.csv',
      mime: 'text/csv',
      content: toCsv(
        [
          'void_event_id',
          'sale_item_id',
          'sale_id',
          'sale_number',
          'product_id',
          'product_name',
          'quantity',
          'amount',
          'reason',
          'note',
          'actor_id',
          'actor_name',
          'voided_at',
        ],
        (pack.void_events ?? []).map((event) => ({
          void_event_id: event.void_event_id,
          sale_item_id: event.sale_item_id,
          sale_id: event.sale_id,
          sale_number: event.sale_number,
          product_id: event.product_id,
          product_name: event.product_name,
          quantity: event.quantity,
          amount: event.amount,
          reason: event.reason,
          note: event.note,
          actor_id: event.actor_id,
          actor_name: event.actor_name,
          voided_at: event.voided_at,
        })),
      ),
    },
    {
      name: 'shifts.csv',
      mime: 'text/csv',
      content: toCsv(
        ['id', 'cashier_id', 'cashier_name', 'branch', 'started_at', 'ended_at', 'status'],
        pack.shifts.map((shift) => ({
          id: shift.id,
          cashier_id: shift.cashier_id,
          cashier_name: shift.cashier_name,
          branch: shift.branch_name,
          started_at: shift.started_at,
          ended_at: shift.ended_at,
          status: shift.status,
        })),
      ),
    },
    {
      name: 'archive_manifest.json',
      mime: 'application/json',
      content: `${JSON.stringify(pack.manifest, null, 2)}\n`,
    },
  ];
}

function downloadWebFile(file: ArchiveDownloadFile) {
  const blob = new Blob([file.content], { type: `${file.mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  URL.revokeObjectURL(url);
}

/** Result of offering archive files to the Owner. Does not prove the files were saved. */
export type ArchiveSaveOffer = {
  packageName: string;
  fileNames: string[];
  delivery: 'browser_download_started' | 'share_sheet_opened';
  message: string;
};

/**
 * Offers archive backup files for the Owner to save.
 * Browser download start / share-sheet open is not confirmation that files were stored.
 */
export async function saveArchivePackage(pack: ArchiveExportPackage): Promise<ArchiveSaveOffer> {
  const files = buildArchiveFiles(pack);
  const fileNames = files.map((file) => file.name);
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    for (const [index, file] of files.entries()) {
      window.setTimeout(() => downloadWebFile(file), index * 250);
    }
    return {
      packageName: pack.manifest.package_name,
      fileNames,
      delivery: 'browser_download_started',
      message:
        `Browser downloads were started for ${pack.manifest.package_name}. Check your downloads for ${fileNames.join(', ')}, including void_events.csv, then confirm the backup was saved before verifying.`,
    };
  }

  const combined = files.map((file) => `===== ${file.name} =====\n${file.content}`).join('\n');
  await Share.share({
    title: pack.manifest.package_name,
    message: combined,
  });
  return {
    packageName: pack.manifest.package_name,
    fileNames,
    delivery: 'share_sheet_opened',
    message:
      `The share sheet was opened for ${pack.manifest.package_name}. Save the archive files to a location you control, check that void_events.csv is included, then confirm the backup was saved before verifying.`,
  };
}
