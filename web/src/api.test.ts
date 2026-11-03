import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { request } from "./api";

const schema = z.object({ message: z.string() });
const unexpected = "The server returned an unexpected response. Refresh or check the server logs.";
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("request recovery", () => {
  it("times out a hanging GET and aborts its fetch", async () => {
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", vi.fn((_path: string, options?: RequestInit) => {
      signal = options?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal?.reason));
      });
    }));
    let error: unknown;
    void request("/state", schema).catch((failure: unknown) => { error = failure; });
    await vi.advanceTimersByTimeAsync(9999);
    expect(error).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(error).toEqual(new Error("The request timed out. Try again."));
    expect(signal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the GET deadline active while reading the response body", async () => {
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_path: string, options?: RequestInit) => {
      signal = options?.signal;
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"message":'));
          signal?.addEventListener("abort", () => controller.error(signal?.reason));
        },
      }));
    }));
    let error: unknown;
    void request("/state", schema).catch((failure: unknown) => { error = failure; });
    await vi.advanceTimersByTimeAsync(10000);
    expect(error).toEqual(new Error("The request timed out. Try again."));
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["HTML", "<html>private proxy error</html>"],
    ["empty", ""],
    ["malformed JSON", '{"error":'],
    ["unexpected JSON", '{"message":"private proxy error"}'],
  ])("uses the status for a non-JSON or invalid %s error", async (_label, body) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 502 })));
    await expect(request("/state", schema)).rejects.toThrow("Request failed (502).");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves a valid server JSON error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Evidence temporarily unavailable" }, { status: 503 })));
    await expect(request("/state", schema)).rejects.toThrow("Evidence temporarily unavailable");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["", "<html>private proxy response</html>", '{"message":', '{"message":4}'])(
    "uses the friendly message for a malformed or schema-invalid success %j",
    async (body) => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
      await expect(request("/state", schema)).rejects.toThrow(unexpected);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("clears the GET timer after success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "Recovered" })));
    await expect(request("/state", schema)).resolves.toEqual({ message: "Recovered" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lets an approval remain pending beyond the read deadline without retrying", async () => {
    let finish: ((response: Response) => void) | undefined;
    const fetcher = vi.fn((_path: string, _options?: RequestInit) => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    let settled = false;
    const approval = request("/proposals/test/decision", schema, { decision: "approve" }).finally(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(11000);
    expect(settled).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "POST", body: '{"decision":"approve"}' });
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBeUndefined();
    finish?.(Response.json({ message: "Approved" }));
    await expect(approval).resolves.toEqual({ message: "Approved" });
  });
});
