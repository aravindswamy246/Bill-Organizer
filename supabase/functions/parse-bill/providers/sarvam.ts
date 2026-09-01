// Sarvam AI vision provider.
//
// Unlike Anthropic, Sarvam has no single "send an image, get back
// structured fields" call. "Sarvam Vision" is a document-digitisation/OCR
// model: you submit a file to an async job, poll it, and get back
// HTML/Markdown plus page-level JSON — it does not do schema-driven field
// extraction itself (max 200 MB / 10 pages per the docs). So this provider
// is two HTTP legs internally, both hitting Sarvam:
//   1. ocrDocument()           — Sarvam Vision OCR: bill image/PDF -> text.
//   2. extractFieldsFromText() — Sarvam chat-completions (tool calling on
//                                 GLM-5.2 / Gemma 4 31B, both beta) maps
//                                 that text onto EXTRACT_BILL_SCHEMA.
// index.ts still only ever calls extract(mimeType, base64) -> ExtractedBill
// via the VisionProvider seam — this file is the only place that knows the
// real shape is two calls, mirroring how anthropic.ts is the only place
// that knows Claude's tool-use wire format.
//
// STATUS (2026-09-01): no SARVAM_API_KEY exists yet (see CLAUDE.md,
// "External setup required") — isConfigured() returns false until one is
// set, so the app stays in mock mode and nothing below has been exercised
// against a live key or a live response. Endpoint paths/response shapes
// are the best reading of docs.sarvam.ai as of today; every place the docs
// were incomplete, inconsistent, or silent is called out below with an
// UNVERIFIED comment and pulled into an env var, so a wrong guess is a
// config fix (set the env var in the function's deployment env) rather
// than a code change. Re-verify all of it against live docs/a live key
// before flipping VISION_PROVIDER=sarvam in production.
import {
  CATEGORIES,
  EXTRACT_BILL_DESCRIPTION,
  EXTRACT_BILL_NAME,
  EXTRACT_BILL_SCHEMA,
  EXTRACTION_INSTRUCTION,
  type Category,
  type ExtractedBill,
  type VisionProvider,
} from './types.ts';

// ---------------------------------------------------------------------
// Config — every value below is read once at module load and cached as a
// constant, but every one is overridable by env so a wrong guess about
// Sarvam's wire format doesn't require editing this file.
// ---------------------------------------------------------------------

// VERIFIED 2026-09-01 against docs.sarvam.ai/api-reference/authentication
// and docs.sarvam.ai/api-reference-docs/authentication (two independently
// fetched pages, consistent): the primary auth header is
// `api-subscription-key`. Sarvam also accepts `Authorization: Bearer
// <key>` "for OpenAI-compatible tooling", but we use the documented
// primary header for both Sarvam calls below.
const SARVAM_AUTH_HEADER = 'api-subscription-key';

// UNVERIFIED (2026-09-01): no fetched doc page showed a bare base-URL
// string; https://api.sarvam.ai is what every Sarvam SDK/blog example
// implies, but it was never quoted verbatim in what we could fetch.
export const SARVAM_API_BASE = Deno.env.get('SARVAM_API_BASE') || 'https://api.sarvam.ai';

// VERIFIED 2026-09-01 (docs.sarvam.ai/api/getting-started/models/open-source):
// "Open-source models are served on /v2/chat/completions ... Sarvam's own
// chat models use /v1, which does not accept these open-source models."
// GLM-5.2 and Gemma 4 31B are the two tool-calling-capable models on that
// endpoint, both listed as beta / gated by an API-key whitelist — a bill
// extraction call can 403 for a real key that isn't whitelisted yet, which
// callChatCompletions() surfaces as a normal HTTP error.
export const SARVAM_CHAT_PATH = Deno.env.get('SARVAM_CHAT_PATH') || '/v2/chat/completions';

// VERIFIED 2026-09-01 (same page): model id strings to pass as `model`.
// Default to GLM-5.2 (512K context, tool calling, visible reasoning);
// override to `gemma4` (Gemma 4 31B) via env if that fits better.
export const SARVAM_CHAT_MODEL = Deno.env.get('SARVAM_CHAT_MODEL') || 'glm5.2';

// UNVERIFIED (2026-09-01): Sarvam's own docs describe what look like TWO
// generations of the document-intelligence API that disagree with each
// other on paths and response shape:
//   - "modern", per docs.sarvam.ai/api-reference-docs/api-guides-tutorials/
//     document-intelligence/overview (fetched twice, self-consistent):
//     POST {base}/doc-ai/v1/job/digitise, multipart (file, language,
//     output_format=md|html|json); status has a `status` field with
//     values pending/running/completed/partially_completed/failed/rejected;
//     a separate GET .../job/{id}/results returns the extracted content.
//   - "legacy", per docs.sarvam.ai/api-reference/document-intelligence/
//     initialise AND independently corroborated by real traffic quoted in
//     a public GitHub issue (sarvamai/sarvam-mcp#64): POST {base}/
//     doc-digitization/job/v1 to create the job; GET {base}/
//     doc-digitization/job/v1/{job_id}/status returning a `job_state`
//     field (values like "Completed"); POST {base}/doc-digitization/
//     job/v1/{job_id}/download-files returning a presigned URL to a ZIP
//     of the output (markdown/html + per-page metadata JSON inside it).
// We default to the "modern" family below — the docs describe it as
// superseding the other, and it returns plain JSON rather than a ZIP to
// unpack, which matches the "returns HTML/Markdown + page-level JSON"
// framing this provider was speced against. But this is a genuine
// disagreement in Sarvam's own documentation, not a single confirmed
// source: RE-VERIFY ALL THREE PATHS AND THE RESULT SHAPE AGAINST LIVE
// DOCS (or a live call) BEFORE SARVAM_API_KEY IS FIRST SET. If Sarvam
// turns out to need the legacy/ZIP flow, that's a real code change to
// ocrDocument()/extractOcrText() below, not just an env var.
export const SARVAM_OCR_SUBMIT_PATH =
  Deno.env.get('SARVAM_OCR_SUBMIT_PATH') || '/doc-ai/v1/job/digitise';
const SARVAM_OCR_STATUS_PATH_TEMPLATE =
  Deno.env.get('SARVAM_OCR_STATUS_PATH_TEMPLATE') || '/doc-ai/v1/job/{job_id}/status';
const SARVAM_OCR_RESULTS_PATH_TEMPLATE =
  Deno.env.get('SARVAM_OCR_RESULTS_PATH_TEMPLATE') || '/doc-ai/v1/job/{job_id}/results';
// UNVERIFIED (2026-09-01): "en-IN" as a default language code is a guess —
// bills seen by this app are predominantly Indian and English-language,
// but Sarvam's own examples use whatever language the sample document is
// in (e.g. "hi-IN"). Fine as a default; override per-deployment if needed.
const SARVAM_OCR_LANGUAGE = Deno.env.get('SARVAM_OCR_LANGUAGE') || 'en-IN';

function ocrStatusUrl(jobId: string): string {
  return SARVAM_API_BASE + SARVAM_OCR_STATUS_PATH_TEMPLATE.replace('{job_id}', encodeURIComponent(jobId));
}

function ocrResultsUrl(jobId: string): string {
  return SARVAM_API_BASE + SARVAM_OCR_RESULTS_PATH_TEMPLATE.replace('{job_id}', encodeURIComponent(jobId));
}

// Bounded polling: never loop forever. These are the production defaults;
// ocrDocument() also accepts a per-call override (see below) so tests can
// exercise the "still running" and "timeout" paths without a real delay.
export const OCR_POLL_MAX_ATTEMPTS = 30;
export const OCR_POLL_DELAY_MS = 2000;

// Recognised across both documented API generations (lower-cased before
// comparison): modern uses `status: "completed"/"failed"/"rejected"`,
// legacy uses `job_state: "Completed"`.
const OCR_TERMINAL_SUCCESS = new Set(['completed', 'partially_completed']);
const OCR_TERMINAL_FAILURE = new Set(['failed', 'rejected']);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------
// Step 1: Sarvam Vision OCR (async job: submit -> poll -> fetch result)
// ---------------------------------------------------------------------

export async function ocrDocument(
  apiKey: string,
  mimeType: string,
  base64: string,
  pollOptions: { maxAttempts?: number; delayMs?: number } = {},
): Promise<string> {
  const maxAttempts = pollOptions.maxAttempts ?? OCR_POLL_MAX_ATTEMPTS;
  const delayMs = pollOptions.delayMs ?? OCR_POLL_DELAY_MS;

  const isPdf = mimeType === 'application/pdf';
  const bytes = base64ToBytes(base64);
  const form = new FormData();
  form.append(
    'file',
    new Blob([bytes as BlobPart], { type: isPdf ? 'application/pdf' : mimeType }),
    isPdf ? 'document.pdf' : 'document.jpg',
  );
  form.append('language', SARVAM_OCR_LANGUAGE);
  form.append('output_format', 'md');

  const submitResponse = await fetch(SARVAM_API_BASE + SARVAM_OCR_SUBMIT_PATH, {
    method: 'POST',
    headers: { [SARVAM_AUTH_HEADER]: apiKey },
    body: form,
  });
  if (!submitResponse.ok) {
    const body = await submitResponse.text();
    throw new Error(`Sarvam OCR submit error ${submitResponse.status}: ${body}`);
  }
  const submitData = await submitResponse.json();
  const jobId = submitData?.job_id;
  if (!jobId || typeof jobId !== 'string') {
    throw new Error(
      `Sarvam OCR submit response did not include a job_id: ${JSON.stringify(submitData).slice(0, 500)}`,
    );
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const statusResponse = await fetch(ocrStatusUrl(jobId), {
      headers: { [SARVAM_AUTH_HEADER]: apiKey },
    });
    if (!statusResponse.ok) {
      const body = await statusResponse.text();
      throw new Error(`Sarvam OCR status error ${statusResponse.status}: ${body}`);
    }
    const statusData = await statusResponse.json();
    const state = String(statusData?.status ?? statusData?.job_state ?? '').toLowerCase();

    if (OCR_TERMINAL_FAILURE.has(state)) {
      throw new Error(`Sarvam OCR job ${jobId} failed: ${JSON.stringify(statusData).slice(0, 500)}`);
    }
    if (OCR_TERMINAL_SUCCESS.has(state)) {
      const resultsResponse = await fetch(ocrResultsUrl(jobId), {
        headers: { [SARVAM_AUTH_HEADER]: apiKey },
      });
      if (!resultsResponse.ok) {
        const body = await resultsResponse.text();
        throw new Error(`Sarvam OCR results error ${resultsResponse.status}: ${body}`);
      }
      return extractOcrText(await resultsResponse.json());
    }
    // Still pending/running (or an unrecognised-but-non-terminal state) —
    // wait and poll again rather than guessing.
    await sleep(delayMs);
  }

  throw new Error(
    `Sarvam OCR job ${jobId} did not complete within ${maxAttempts} polls (${delayMs}ms apart) — timed out.`,
  );
}

// UNVERIFIED (2026-09-01): no fetched doc page showed the exact field the
// OCR text/markdown comes back under (only SDK method names were shown).
// Tries every plausible shape before giving up, so a slightly-off guess
// degrades to a clear thrown Error instead of `undefined` silently
// reaching the chat-extraction step.
export function extractOcrText(result: unknown): string {
  if (typeof result === 'string' && result.length > 0) return result;
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    const direct = r.markdown ?? r.md ?? r.html ?? r.text ?? r.content;
    if (typeof direct === 'string' && direct.length > 0) return direct;

    const nested = r.result as Record<string, unknown> | undefined;
    if (nested && typeof nested === 'object') {
      const nestedText = nested.markdown ?? nested.md ?? nested.html ?? nested.text;
      if (typeof nestedText === 'string' && nestedText.length > 0) return nestedText;
    }

    if (Array.isArray(r.pages)) {
      const joined = (r.pages as unknown[])
        .map((p) => {
          if (!p || typeof p !== 'object') return '';
          const page = p as Record<string, unknown>;
          const t = page.markdown ?? page.md ?? page.text ?? page.content;
          return typeof t === 'string' ? t : '';
        })
        .filter((t) => t.length > 0)
        .join('\n\n');
      if (joined.length > 0) return joined;
    }
  }
  throw new Error(
    `Sarvam OCR results response did not contain recognisable text/markdown content: ${JSON.stringify(result).slice(0, 500)}`,
  );
}

// ---------------------------------------------------------------------
// Step 2: chat completions with forced tool use, to map OCR text onto
// EXTRACT_BILL_SCHEMA.
// ---------------------------------------------------------------------

const EXTRACT_BILL_TOOL = {
  type: 'function',
  function: {
    name: EXTRACT_BILL_NAME,
    description: EXTRACT_BILL_DESCRIPTION,
    parameters: EXTRACT_BILL_SCHEMA,
  },
};

export async function extractFieldsFromText(apiKey: string, ocrText: string): Promise<ExtractedBill> {
  const response = await fetch(SARVAM_API_BASE + SARVAM_CHAT_PATH, {
    method: 'POST',
    headers: {
      [SARVAM_AUTH_HEADER]: apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: SARVAM_CHAT_MODEL,
      messages: [
        {
          role: 'user',
          content: `${EXTRACTION_INSTRUCTION}\n\nDocument text (from OCR):\n${ocrText}`,
        },
      ],
      tools: [EXTRACT_BILL_TOOL],
      // UNVERIFIED (2026-09-01): forcing a specific function the way
      // Anthropic's `tool_choice: { type: 'tool', name }` does. Sarvam's
      // chat-completions docs only showed `tool_choice: "auto"` in an
      // example; this assumes OpenAI-compatible forced-function syntax
      // works too (the docs describe the endpoint as OpenAI-tool-compatible
      // elsewhere). There is NO automatic retry with tool_choice 'auto':
      // if Sarvam rejects this shape the call surfaces as a normal HTTP
      // error and this file has to be revisited — re-check against a live
      // call before SARVAM_API_KEY is first set.
      tool_choice: { type: 'function', function: { name: EXTRACT_BILL_NAME } },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Sarvam chat completions error ${response.status}: ${body}`);
  }

  const data = await response.json();
  return normaliseExtractedBill(parseToolCallArguments(data));
}

// UNVERIFIED (2026-09-01): Sarvam's chat-completions docs describe the
// endpoint as OpenAI-compatible (it accepts an `Authorization: Bearer`
// header "for OpenAI-compatible tooling") and its non-tool-call sample
// response matches OpenAI's `{ choices: [{ message }] }` shape, but no
// fetched doc page showed an actual tool-call example. This assumes the
// standard OpenAI shape: `message.tool_calls[].function.arguments` as a
// JSON string. Re-check against a live response before trusting this.
function parseToolCallArguments(data: unknown): unknown {
  const message = (data as { choices?: { message?: Record<string, unknown> }[] } | null)?.choices?.[0]
    ?.message;
  const toolCalls = message?.tool_calls as
    | { function?: { name?: string; arguments?: string } }[]
    | undefined;
  const call =
    toolCalls?.find((c) => c.function?.name === EXTRACT_BILL_NAME) ?? toolCalls?.[0];
  const args = call?.function?.arguments;

  if (typeof args !== 'string' || args.length === 0) {
    throw new Error(
      `Sarvam chat completions response did not include a ${EXTRACT_BILL_NAME} tool call: ${JSON.stringify(data).slice(0, 500)}`,
    );
  }
  try {
    return JSON.parse(args);
  } catch {
    throw new Error(`Sarvam tool call arguments were not valid JSON: ${args.slice(0, 500)}`);
  }
}

// The chat step returns model-generated JSON: never trust it has every
// field, the right types, or a category from CATEGORIES. Normalise
// defensively — a malformed model response becomes a safely-shaped
// ExtractedBill (or, for a genuinely non-object response, a clean thrown
// Error) rather than a crash or a bad row saved to the database.
export function normaliseExtractedBill(raw: unknown): ExtractedBill {
  if (!raw || typeof raw !== 'object') {
    throw new Error(
      `Sarvam extraction tool call arguments were not a JSON object: ${JSON.stringify(raw).slice(0, 500)}`,
    );
  }
  const r = raw as Record<string, unknown>;

  const category: Category = (CATEGORIES as readonly string[]).includes(r.category_guess as string)
    ? (r.category_guess as Category)
    : 'Other';

  const lineItems = Array.isArray(r.line_items)
    ? (r.line_items as unknown[])
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map((item) => ({
          description: typeof item.description === 'string' ? item.description : '',
          amount: typeof item.amount === 'number' ? item.amount : 0,
        }))
    : [];

  const confidence: ExtractedBill['confidence'] = ['high', 'medium', 'low'].includes(
    r.confidence as string,
  )
    ? (r.confidence as ExtractedBill['confidence'])
    : 'low';

  return {
    merchant_name: typeof r.merchant_name === 'string' ? r.merchant_name : null,
    bill_date: typeof r.bill_date === 'string' ? r.bill_date : null,
    total_amount: typeof r.total_amount === 'number' ? r.total_amount : null,
    currency: typeof r.currency === 'string' && r.currency.length > 0 ? r.currency : 'INR',
    category_guess: category,
    line_items: lineItems,
    is_warranty_document: r.is_warranty_document === true,
    is_insurance_document: r.is_insurance_document === true,
    detected_expiry_date: typeof r.detected_expiry_date === 'string' ? r.detected_expiry_date : null,
    confidence,
  };
}

// ---------------------------------------------------------------------
// VisionProvider implementation
// ---------------------------------------------------------------------

// Implements VisionProvider. `name` is 'sarvam' — the VISION_PROVIDER
// registry key (see providers/index.ts). isConfigured() is the load-bearing
// bit today: no SARVAM_API_KEY exists yet, so this must return false and
// let the app fall back to mock extraction, exactly like anthropicProvider
// does before ANTHROPIC_API_KEY is set.
export const sarvamProvider: VisionProvider = {
  name: 'sarvam',
  isConfigured(): boolean {
    return !!Deno.env.get('SARVAM_API_KEY');
  },
  async extract(mimeType: string, base64: string): Promise<ExtractedBill> {
    const apiKey = Deno.env.get('SARVAM_API_KEY')!;
    const ocrText = await ocrDocument(apiKey, mimeType, base64);
    return extractFieldsFromText(apiKey, ocrText);
  },
};
