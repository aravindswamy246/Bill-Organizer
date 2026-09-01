// Provider-neutral pieces shared by every vision provider: the extracted
// bill shape, the fixed category list, the mock/degraded extraction, the
// extraction schema/instruction a provider adapts to its own
// tool/function-calling payload, and the VisionProvider seam itself.
// index.ts and every file under providers/ import from here rather than
// from each other, so adding a provider never means editing this file.

export const CATEGORIES = [
  'Warranty',
  'Insurance',
  'Utilities',
  'Subscriptions',
  'Dining & Grocery',
  'Medical',
  'Travel',
  'Other',
] as const;

export type Category = (typeof CATEGORIES)[number];

export type ExtractedBill = {
  merchant_name: string | null;
  bill_date: string | null;
  total_amount: number | null;
  currency: string;
  category_guess: Category;
  line_items: { description: string; amount: number }[];
  is_warranty_document: boolean;
  is_insurance_document: boolean;
  detected_expiry_date: string | null;
  confidence: 'high' | 'medium' | 'low';
};

export const EXTRACT_BILL_NAME = 'extract_bill';

export const EXTRACT_BILL_DESCRIPTION =
  'Extract structured data from a bill, receipt, warranty card, or insurance document image/PDF.';

// The extraction schema, provider-neutral. Anthropic consumes this as a
// tool's `input_schema` verbatim; a future provider shapes it into
// whatever its own function-calling payload expects (e.g. OpenAI's
// `parameters`).
export const EXTRACT_BILL_SCHEMA = {
  type: 'object',
  properties: {
    merchant_name: { type: ['string', 'null'], description: 'Store or service provider name.' },
    bill_date: {
      type: ['string', 'null'],
      description: 'Date printed on the document, ISO 8601 (YYYY-MM-DD).',
    },
    total_amount: { type: ['number', 'null'], description: 'Total amount charged.' },
    currency: { type: 'string', description: 'ISO 4217 currency code, e.g. INR.' },
    category_guess: { type: 'string', enum: CATEGORIES },
    line_items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          amount: { type: 'number' },
        },
        required: ['description', 'amount'],
      },
    },
    is_warranty_document: { type: 'boolean' },
    is_insurance_document: { type: 'boolean' },
    detected_expiry_date: {
      type: ['string', 'null'],
      description:
        'Warranty or insurance policy expiry date, ISO 8601. Only set when is_warranty_document or is_insurance_document is true and an expiry/valid-until date is visible.',
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: [
    'merchant_name',
    'bill_date',
    'total_amount',
    'currency',
    'category_guess',
    'line_items',
    'is_warranty_document',
    'is_insurance_document',
    'detected_expiry_date',
    'confidence',
  ],
};

export const EXTRACTION_INSTRUCTION =
  'Extract structured data from this bill, receipt, warranty card, or insurance document using the extract_bill tool. If a field is missing or illegible, use null rather than guessing.';

export function mockExtraction(): ExtractedBill {
  return {
    merchant_name: null,
    bill_date: null,
    total_amount: null,
    currency: 'INR',
    category_guess: 'Other',
    line_items: [],
    is_warranty_document: false,
    is_insurance_document: false,
    detected_expiry_date: null,
    confidence: 'low',
  };
}

// The seam every vision provider implements. index.ts only ever talks to
// this interface — swapping providers means adding a file under
// providers/ that implements it, registering it in providers/index.ts,
// and setting VISION_PROVIDER. See providers/index.ts for the how-to.
export interface VisionProvider {
  readonly name: string;
  isConfigured(): boolean;
  extract(mimeType: string, base64: string): Promise<ExtractedBill>;
}
