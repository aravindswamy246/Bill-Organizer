// Vision-provider registry. This is the entire seam parse-bill/index.ts
// depends on — it never imports a specific provider itself.
//
// To add a new vision provider (e.g. when swapping off Anthropic):
//   1. Create providers/<name>.ts exporting an object that implements
//      the VisionProvider interface from ./types.ts (name, isConfigured(),
//      extract()). Read its API key/config from Deno.env yourself, the
//      same way providers/anthropic.ts reads ANTHROPIC_API_KEY.
//   2. Import it below and add it to the `providers` map under the key
//      you want VISION_PROVIDER to select it by.
//   3. Set VISION_PROVIDER=<name> (and that provider's own env vars) in
//      the function's deployment env. Leaving VISION_PROVIDER unset keeps
//      today's default ('anthropic').
// No other file needs to change — index.ts only ever calls
// getVisionProvider() and, if it returns non-null, provider.extract().
import { anthropicProvider } from './anthropic.ts';
import { sarvamProvider } from './sarvam.ts';
import type { VisionProvider } from './types.ts';

const providers: Record<string, VisionProvider> = {
  anthropic: anthropicProvider,
  sarvam: sarvamProvider,
};

const DEFAULT_PROVIDER = 'anthropic';

// Returns null (never throws) when no usable provider is available:
// - the selected name isn't registered (logs a warning), or
// - the selected provider is registered but not configured (e.g. its API
//   key env var isn't set).
// Callers treat null the same as any other extraction failure: fall back
// to mockExtraction() and keep going — a provider-selection problem must
// never block saving the bill.
export function getVisionProvider(): VisionProvider | null {
  const selected = Deno.env.get('VISION_PROVIDER') || DEFAULT_PROVIDER;
  const provider = providers[selected];
  if (!provider) {
    console.warn(
      `Unknown VISION_PROVIDER "${selected}" (known: ${Object.keys(providers).join(', ')}); falling back to mock extraction.`,
    );
    return null;
  }
  if (!provider.isConfigured()) return null;
  return provider;
}
