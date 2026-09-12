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
        ['sale_id', 'product_id', 'product_name', 'quantity', 'unit_price', 'subtotal'],
        pack.sale_items.map((item) => ({
          sale_id: item.sale_id,
          product_id: item.product_id,
          product_name: item.product_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          subtotal: item.subtotal,
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

export async function saveArchivePackage(pack: ArchiveExportPackage): Promise<void> {
  const files = buildArchiveFiles(pack);
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    for (const [index, file] of files.entries()) {
      window.setTimeout(() => downloadWebFile(file), index * 250);
    }
    return;
  }

  const combined = files.map((file) => `===== ${file.name} =====\n${file.content}`).join('\n');
  await Share.share({
    title: pack.manifest.package_name,
    message: combined,
  });
}
