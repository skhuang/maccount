import { describe, it, expect } from "vitest";
import { createGoogleForm } from "../src/oauth/google_forms";

describe("createGoogleForm", () => {
  it("POSTs the title and returns formId + responderUri", async () => {
    let captured: { url: string; body: unknown; auth: string | null } | null = null;
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = {
        url: String(input),
        body: JSON.parse(String(init?.body)),
        auth: new Headers(init?.headers).get("Authorization"),
      };
      return new Response(
        JSON.stringify({ formId: "F123", responderUri: "https://docs.google.com/forms/d/e/F123/viewform" }),
        { headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const got = await createGoogleForm("acc_tok", "第一週小考", fetcher);
    expect(got).toEqual({ formId: "F123", responderUri: "https://docs.google.com/forms/d/e/F123/viewform" });
    expect(captured!.url).toBe("https://forms.googleapis.com/v1/forms");
    expect(captured!.auth).toBe("Bearer acc_tok");
    expect(captured!.body).toEqual({ info: { title: "第一週小考", documentTitle: "第一週小考" } });
  });

  it("throws on a non-2xx response", async () => {
    const fetcher = (async () => new Response("no", { status: 403 })) as unknown as typeof fetch;
    await expect(createGoogleForm("t", "x", fetcher)).rejects.toThrow(/403/);
  });

  it("throws when the response lacks formId/responderUri", async () => {
    const fetcher = (async () =>
      new Response(JSON.stringify({ formId: "F" }), { headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
    await expect(createGoogleForm("t", "x", fetcher)).rejects.toThrow(/missing/);
  });
});
