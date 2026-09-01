import { billsToCsv, billsToHtml, csvEscape, escapeHtml, formatAmount } from './exportBills';
import type { Bill } from '@/features/bills/types';

function makeBill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: 'b1',
    user_id: 'u1',
    bill_date: '2026-07-01',
    merchant_name: 'Acme Store',
    category: 'Utilities',
    currency: 'INR',
    status: 'confirmed',
    source: 'camera',
    storage_path: 'u1/b1.jpg',
    total_amount: 1234.5,
    extracted_json: null,
    is_insurance_document: false,
    is_warranty_document: false,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

describe('csvEscape', () => {
  it('leaves plain values unquoted', () => {
    expect(csvEscape('Acme Store')).toBe('Acme Store');
  });

  it('quotes and escapes values containing commas', () => {
    expect(csvEscape('Acme, Inc')).toBe('"Acme, Inc"');
  });

  it('quotes and doubles embedded quotes', () => {
    expect(csvEscape('Say "hi"')).toBe('"Say ""hi"""');
  });

  it('quotes values containing newlines', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });

  it('neutralises a leading-equals formula with an apostrophe', () => {
    expect(csvEscape('=1+1')).toBe("'=1+1");
  });

  it('neutralises a leading-plus formula with an apostrophe', () => {
    expect(csvEscape('+SUM(A1)')).toBe("'+SUM(A1)");
  });

  it('neutralises a leading-at formula with an apostrophe', () => {
    expect(csvEscape('@import')).toBe("'@import");
  });

  it('neutralises a leading-minus formula with an apostrophe', () => {
    expect(csvEscape('-cmd')).toBe("'-cmd");
  });

  it('neutralises a leading-tab value with an apostrophe', () => {
    expect(csvEscape('\tmalicious')).toBe("'\tmalicious");
  });

  it('neutralises a leading-CR value and quotes it so the row cannot split', () => {
    expect(csvEscape('\rmalicious')).toBe("\"'\rmalicious\"");
  });

  it('leaves a plain negative amount unchanged', () => {
    expect(csvEscape('-1234.50')).toBe('-1234.50');
  });

  it('leaves a plain positive number unchanged', () => {
    expect(csvEscape('1234.50')).toBe('1234.50');
  });

  it('applies both the apostrophe prefix and comma/quote escaping to a formula containing a comma', () => {
    expect(csvEscape('=HYPERLINK("a","b")')).toBe('"\'=HYPERLINK(""a"",""b"")"');
  });
});

describe('formatAmount', () => {
  it('formats a numeric amount to 2 decimals', () => {
    expect(formatAmount(makeBill({ total_amount: 1234.5 }))).toBe('1234.50');
  });

  it('returns an empty string when the amount is null', () => {
    expect(formatAmount(makeBill({ total_amount: null }))).toBe('');
  });
});

describe('billsToCsv', () => {
  it('emits a header row followed by one row per bill', () => {
    const csv = billsToCsv([makeBill()]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Date,Merchant,Category,Amount,Currency,Status,Source');
    expect(lines[1]).toBe('2026-07-01,Acme Store,Utilities,1234.50,INR,confirmed,camera');
  });

  it('escapes merchant names containing commas', () => {
    const csv = billsToCsv([makeBill({ merchant_name: 'Acme, Inc' })]);
    expect(csv.split('\n')[1]).toBe('2026-07-01,"Acme, Inc",Utilities,1234.50,INR,confirmed,camera');
  });

  it('falls back to empty strings for null date/merchant', () => {
    const csv = billsToCsv([makeBill({ bill_date: null, merchant_name: null })]);
    expect(csv.split('\n')[1]).toBe(',,Utilities,1234.50,INR,confirmed,camera');
  });

  it('neutralises a formula-injection merchant name', () => {
    const csv = billsToCsv([makeBill({ merchant_name: '=cmd|\' /C calc\'!A1' })]);
    expect(csv.split('\n')[1]).toBe("2026-07-01,'=cmd|' /C calc'!A1,Utilities,1234.50,INR,confirmed,camera");
  });
});

describe('escapeHtml', () => {
  it('escapes ampersands and angle brackets', () => {
    expect(escapeHtml('Tom & Jerry <script>')).toBe('Tom &amp; Jerry &lt;script&gt;');
  });
});

describe('billsToHtml', () => {
  it('includes the bill count, merchant, and formatted total', () => {
    const html = billsToHtml([makeBill(), makeBill({ id: 'b2', total_amount: 100 })]);
    expect(html).toContain('2 bills');
    expect(html).toContain('Acme Store');
    expect(html).toContain('INR 1234.50');
    expect(html).toContain('1334.50');
  });

  it('escapes merchant names to prevent HTML injection', () => {
    const html = billsToHtml([makeBill({ merchant_name: '<img src=x onerror=alert(1)>' })]);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('uses singular "bill" for a single result', () => {
    const html = billsToHtml([makeBill()]);
    expect(html).toContain('1 bill<');
  });
});
