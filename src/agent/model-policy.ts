// Current cost-efficient text models with streaming and function calling.
// Ordered by OpenAI's public standard text rates, not by ChatGPT plan allowances.
// https://developers.openai.com/api/docs/pricing
export const budgetModels = ["gpt-6-luna", "gpt-5.6-luna"] as const;
export type BudgetModel = (typeof budgetModels)[number];
export const defaultModel = budgetModels[0];

export const usesMinimalReasoning = (model: string) => budgetModels.some((budget) => budget === model);

export function chooseBudgetModel(models: readonly { slug: string; visibility: string }[]): BudgetModel | undefined {
  return budgetModels.find((slug) => models.some((model) => model.visibility === "list" && model.slug === slug));
}

export const modelHeader = "X-Godspeed-Model";
export const protocolHeader = "X-Godspeed-Protocol";
export const validModelName = (model: string | null) => model && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(model) ? model : undefined;
export type ModelOption = { slug: string; label: string };
export const modelLabel = (slug: string) => slug === "gpt-6-luna" ? "GPT-6 Luna" : slug === "gpt-5.6-luna" ? "GPT-5.6 Luna" : slug;
export const supportsWebSearch = (slug: string) => /^gpt-(?:6(?:[.-]|$)|5\.[456](?:[.-]|$))/.test(slug)
  && !/(?:codex|image|realtime|audio|transcribe|embedding)/i.test(slug);
