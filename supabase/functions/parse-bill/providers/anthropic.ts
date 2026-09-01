// Anthropic (Claude) vision provider — the default today. Wraps Claude's
// forced-tool-use API into the provider-neutral VisionProvider interface
// so index.ts never talks to Claude (or any provider) directly.
import {
  EXTRACT_BILL_DESCRIPTION,
  EXTRACT_BILL_NAME,
  EXTRACT_BILL_SCHEMA,
  EXTRACTION_INSTRUCTION,
  type ExtractedBill,
  type VisionProvider,
} from './types.ts';

export const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
export const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

const EXTRACT_BILL_TOOL = {
  name: EXTRACT_BILL_NAME,
  description: EXTRACT_BILL_DESCRIPTION,
  input_schema: EXTRACT_BILL_SCHEMA,
};

export function contentBlockForFile(mimeType: string, base64: string) {
  if (mimeType === 'application/pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: base64 },
    };
  }
  const imageMediaType = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mimeType)
    ? mimeType
    : 'image/jpeg';
  return { type: 'image', source: { type: 'base64', media_type: imageMediaType, data: base64 } };
}

export async function callClaude(
  apiKey: string,
  mimeType: string,
  base64: string,
): Promise<ExtractedBill> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      tools: [EXTRACT_BILL_TOOL],
      tool_choice: { type: 'tool', name: EXTRACT_BILL_NAME },
      messages: [
        {
          role: 'user',
          content: [
            contentBlockForFile(mimeType, base64),
            {
              type: 'text',
              text: EXTRACTION_INSTRUCTION,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Claude API error ${response.status}: ${body}`);
  }

  const data = await response.json();
  const toolUse = (data.content ?? []).find((block: { type: string }) => block.type === 'tool_use');
  if (!toolUse) throw new Error('Claude did not return a tool_use block');
  return toolUse.input as ExtractedBill;
}

// Implements VisionProvider. `name` is 'anthropic' (the VISION_PROVIDER
// registry key); index.ts maps that to the legacy 'claude' string when
// recording `mode`/`extracted_json._mode`, so already-stored rows and
// existing tests that assert mode === 'claude' see no value change from
// this provider split.
export const anthropicProvider: VisionProvider = {
  name: 'anthropic',
  isConfigured(): boolean {
    return !!Deno.env.get('ANTHROPIC_API_KEY');
  },
  async extract(mimeType: string, base64: string): Promise<ExtractedBill> {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')!;
    return callClaude(apiKey, mimeType, base64);
  },
};
