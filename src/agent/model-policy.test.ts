import { expect, it } from "vitest";
import { chooseBudgetModel } from "./model-policy";
import { responsesRequest } from "../server/responses-input";

it("uses the visible budget fallback without escalating to premium or hidden models", () => {
  const catalog = [{ slug: "gpt-6.2-sol", visibility: "list" }, { slug: "gpt-6-luna", visibility: "hidden" }];
  expect(chooseBudgetModel(catalog)).toBeUndefined();
  expect(chooseBudgetModel([...catalog, { slug: "gpt-5.6-luna", visibility: "list" }])).toBe("gpt-5.6-luna");
});

it("requests no reasoning effort while retaining workspace tools on budget models", () => {
  const request = responsesRequest([{ role: "user", content: "Find a page" }], "gpt-6-luna", "Workspace instructions");
  expect(request).toMatchObject({
    model: "gpt-6-luna", reasoning: { effort: "none" }, tools: [{ type: "namespace", name: "workspace" }], store: false, stream: true,
  });
  expect(request).not.toHaveProperty("include");
});
