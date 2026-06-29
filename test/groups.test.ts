import { describe, expect, it, vi } from "vitest";
import { syncGoogleGroupMembers } from "../src/oauth/groups";

describe("Google Group member sync", () => {
  it("adds missing targets, removes stale ordinary members, and keeps protected members", async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === "GET") {
        return new Response(JSON.stringify({
          members: [
            { id: "old-id", email: "old@gmail.com", role: "MEMBER", type: "USER" },
            { id: "teacher-id", email: "teacher@example.edu", role: "OWNER", type: "USER" },
            { id: "nested-id", email: "nested@example.edu", role: "MEMBER", type: "GROUP" },
            { id: "keep-id", email: "keep@gmail.com", role: "MEMBER", type: "USER" },
          ],
        }), { headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const result = await syncGoogleGroupMembers(
      "token",
      "course-group@example.edu",
      ["new@gmail.com", "KEEP@gmail.com", "new@gmail.com"],
      fetcher,
    );

    expect(result).toEqual({ added: 1, removed: 1, kept: 1, skippedProtected: 2, errors: 0 });
    expect(calls).toContainEqual(expect.objectContaining({
      method: "POST",
      body: { email: "new@gmail.com", role: "MEMBER" },
    }));
    expect(calls).toContainEqual(expect.objectContaining({
      method: "DELETE",
      url: expect.stringContaining("/members/old-id"),
    }));
    expect(calls.some((c) => c.url.includes("teacher-id"))).toBe(false);
    expect(calls.some((c) => c.url.includes("nested-id"))).toBe(false);
  });

  it("lists paginated group members before syncing", async () => {
    const pages: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!init?.method) {
        pages.push(new URL(url).searchParams.get("pageToken") ?? "");
        return new Response(JSON.stringify(
          pages.length === 1
            ? { members: [{ email: "a@gmail.com", role: "MEMBER", type: "USER" }], nextPageToken: "p2" }
            : { members: [{ email: "b@gmail.com", role: "MEMBER", type: "USER" }] },
        ), { headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const result = await syncGoogleGroupMembers("token", "g@example.edu", ["a@gmail.com", "b@gmail.com"], fetcher);

    expect(pages).toEqual(["", "p2"]);
    expect(result).toMatchObject({ added: 0, removed: 0, kept: 2, errors: 0 });
  });
});
