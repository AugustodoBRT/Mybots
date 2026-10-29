// What a reply would cost at the API's list price, in US dollars. The plans (ChatGPT, Claude) do not charge per token, so this is
// an estimate of the "API-equivalent" value of the use, not a bill. Prices are USD per million tokens: input (not cached), cached
// input and output. Reference values taken from public price lists in October 2026 (secondary sources, some disagree);
// edit here when the lists change. A model with no price of its own uses its provider's default, and the app says "estimativa".
export const PRICES = {
  claude: [
    [/opus/i, { input: 4, cached: 0.4, output: 20 }],
    [/sonnet/i, { input: 2, cached: 0.2, output: 10 }],
    [/haiku/i, { input: 0.1, cached: 0.01, output: 0.5 }]
  ],
  codex: [
    [/sol/i, { input: 2, cached: 0.1, output: 10 }]
  ]
};
// Used when the model is unknown (Fable, Luna…): the provider's main model.
export const DEFAULT_PRICE = { claude: { input: 2, cached: 0.2, output: 10 }, codex: { input: 2, cached: 0.1, output: 10 } };

export function priceOf(provider, model) {
  const key = provider === 'claude' ? 'claude' : 'codex';
  const found = PRICES[key].find(([pattern]) => pattern.test(String(model || '')));
  return found ? { ...found[1], exact: true } : { ...DEFAULT_PRICE[key], exact: false };
}

// `input` already counts the cached part (both IAs report it that way), so the cached tokens are priced apart from the rest.
export function costOf({ provider, model, input = 0, cached = 0, output = 0 }) {
  const price = priceOf(provider, model); const cachedTokens = Math.min(cached, input);
  return ((input - cachedTokens) * price.input + cachedTokens * price.cached + output * price.output) / 1e6;
}
