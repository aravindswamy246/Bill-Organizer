import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import type { Bill } from '@/features/bills/types';

// OWASP CSV-injection trigger set: a field opened by Excel/Sheets that starts with one of
// these characters (or a leading tab/CR) is interpreted as a formula, not text. Prefixing it
// with an apostrophe forces text interpretation. Plain signed decimal numbers (e.g. the
// negative amounts formatAmount can produce, like '-1234.50') are exempted so legitimate data
// isn't mangled — only non-numeric values starting with a trigger character get the apostrophe.
const CSV_FORMULA_TRIGGER = /^[=+\-@\t\r]/;
const PLAIN_SIGNED_NUMBER = /^[+-]?\d+(\.\d+)?$/;

export function csvEscape(value: string): string {
  const safe = CSV_FORMULA_TRIGGER.test(value) && !PLAIN_SIGNED_NUMBER.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

export function formatAmount(bill: Bill): string {
  return bill.total_amount != null ? bill.total_amount.toFixed(2) : '';
}

export function billsToCsv(bills: Bill[]): string {
  const header = ['Date', 'Merchant', 'Category', 'Amount', 'Currency', 'Status', 'Source'];
  const rows = bills.map((bill) => [
    bill.bill_date ?? '',
    bill.merchant_name ?? '',
    bill.category,
    formatAmount(bill),
    bill.currency,
    bill.status,
    bill.source,
  ]);
  return [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function billsToHtml(bills: Bill[]): string {
  const rows = bills
    .map(
      (bill) => `
        <tr>
          <td>${escapeHtml(bill.bill_date ?? '')}</td>
          <td>${escapeHtml(bill.merchant_name ?? '')}</td>
          <td>${escapeHtml(bill.category)}</td>
          <td class="amount">${bill.currency} ${formatAmount(bill)}</td>
          <td>${escapeHtml(bill.status)}</td>
        </tr>`,
    )
    .join('');

  const total = bills.reduce((sum, bill) => sum + (bill.total_amount ?? 0), 0);

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: -apple-system, Roboto, sans-serif; padding: 24px; }
          h1 { font-size: 20px; }
          table { width: 100%; border-collapse: collapse; margin-top: 16px; }
          th, td { text-align: left; padding: 8px; border-bottom: 1px solid #ddd; font-size: 12px; }
          .amount { text-align: right; }
          tfoot td { font-weight: bold; }
        </style>
      </head>
      <body>
        <h1>Bill Organizer — Export</h1>
        <p>${bills.length} bill${bills.length === 1 ? '' : 's'}</p>
        <table>
          <thead>
            <tr><th>Date</th><th>Merchant</th><th>Category</th><th>Amount</th><th>Status</th></tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr><td colspan="3"></td><td class="amount">${total.toFixed(2)}</td><td></td></tr>
          </tfoot>
        </table>
      </body>
    </html>
  `;
}

/** Writes bills to a CSV file in the cache dir and opens the OS share sheet.
 * Premium-gated feature (prompt.md §5) — callers must check
 * `useEntitlements().isPremium` before calling this. */
export async function exportBillsAsCsv(bills: Bill[]): Promise<void> {
  const csv = billsToCsv(bills);
  const file = new File(Paths.cache, `bill-organizer-export-${Date.now()}.csv`);
  file.create();
  file.write(csv);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: 'Export bills (CSV)' });
  }
}

/** Renders bills to a PDF via expo-print and opens the OS share sheet.
 * Premium-gated feature (prompt.md §5) — callers must check
 * `useEntitlements().isPremium` before calling this. */
export async function exportBillsAsPdf(bills: Bill[]): Promise<void> {
  const html = billsToHtml(bills);
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Export bills (PDF)' });
  }
}
