import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDemoConfigFixture } from "../../shared/testFixtures.js";
import { Mppx } from "../../../typescript/packages/mpp/src/client/index.js";
import {
  executeSessionResourceRequest,
  toSessionErrorProgress,
  toSessionProgress,
} from "./useSessionResource.js";

vi.mock("../../../typescript/packages/mpp/src/client/index.js", () => ({
  Mppx: {
    create: vi.fn(),
  },
  megaeth: {
    session: vi.fn((parameters) => parameters),
  },
}));

const mockedMppxCreate = vi.mocked(Mppx.create);
const config = createDemoConfigFixture();
const provider = {
  request: vi.fn(),
};
const channelId =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("useSessionResource helpers", () => {
  beforeEach(() => {
    mockedMppxCreate.mockReset();
    vi.restoreAllMocks();
  });

  it("loads session state by channelId when the primary response omits the session body", async () => {
    const onProgress = vi.fn();
    const onReceipt = vi.fn();
    const onSessionState = vi.fn();
    const stateFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({
          acceptedCumulative: "100000",
          channelId,
          deposit: "500000",
          payer: "0x1111111111111111111111111111111111111111",
          recipient: "0x2222222222222222222222222222222222222222",
          settled: "0",
          signerMode: "wallet",
          status: "open",
          unsettled: "100000",
        }),
      );

    mockedMppxCreate.mockImplementation(({ methods }) => ({
      fetch: vi.fn(async () => {
        methods[0]?.onProgress?.({
          channelId,
          cumulativeAmount: "100000",
          type: "updated",
        });

        return Response.json({
          amount: "100000",
          description: "MegaETH reusable session resource",
          method: "session",
          status: "paid",
          tokenAddress: config.tokenAddress,
        });
      }),
    }) as unknown as ReturnType<typeof Mppx.create>);

    const result = await executeSessionResourceRequest({
      account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      config,
      endpoint: "/api/v1/session/basic",
      onProgress,
      onReceipt,
      onSessionState,
      provider,
    });

    expect(stateFetch).toHaveBeenCalledWith(
      `${config.apiOrigin}${config.session.statePath}?channelId=${channelId}`,
    );
    expect(result.session?.channelId).toBe(channelId);
    expect(onSessionState).toHaveBeenCalledWith(
      expect.objectContaining({ channelId }),
    );
  });

  it("sends a pure top-up context with authorizeCurrentRequest set to false", async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = init as
        | (RequestInit & { context?: unknown | undefined })
        | undefined;
      expect(request?.method).toBe("HEAD");
      expect(request?.context).toEqual({
        action: "topUp",
        additionalDepositRaw: "2000",
        authorizeCurrentRequest: false,
        channelId,
      });

      return new Response(null, {
        headers: {
          "payment-receipt": "Payment receipt-top-up",
        },
        status: 204,
      });
    });

    mockedMppxCreate.mockReturnValue({
      fetch,
    } as unknown as ReturnType<typeof Mppx.create>);

    const stateFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({
          acceptedCumulative: "100000",
          channelId,
          deposit: "700000",
          payer: "0x1111111111111111111111111111111111111111",
          recipient: "0x2222222222222222222222222222222222222222",
          settled: "100000",
          signerMode: "wallet",
          status: "open",
          unsettled: "0",
        }),
      );

    const result = await executeSessionResourceRequest({
      account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      config,
      context: {
        action: "topUp",
        additionalDepositRaw: "2000",
        authorizeCurrentRequest: false,
        channelId,
      },
      endpoint: "/api/v1/session/basic",
      method: "HEAD",
      onProgress: vi.fn(),
      onReceipt: vi.fn(),
      onSessionState: vi.fn(),
      provider,
    });

    expect(result.session?.deposit).toBe("700000");
    expect(stateFetch).toHaveBeenCalledOnce();
  });

  it("supports close flows and returns the refreshed session state", async () => {
    mockedMppxCreate.mockReturnValue({
      fetch: vi.fn(async (_url: string, init?: RequestInit) => {
        const request = init as
          | (RequestInit & { context?: unknown | undefined })
          | undefined;
        expect(request?.context).toEqual({
          action: "close",
          channelId,
        });

        return new Response(null, { status: 204 });
      }),
    } as unknown as ReturnType<typeof Mppx.create>);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        acceptedCumulative: "200000",
        channelId,
        deposit: "500000",
        payer: "0x1111111111111111111111111111111111111111",
        recipient: "0x2222222222222222222222222222222222222222",
        settled: "200000",
        signerMode: "wallet",
        status: "closed",
        unsettled: "0",
      }),
    );

    const result = await executeSessionResourceRequest({
      account: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      config,
      context: {
        action: "close",
        channelId,
      },
      endpoint: "/api/v1/session/basic",
      method: "HEAD",
      onProgress: vi.fn(),
      onReceipt: vi.fn(),
      onSessionState: vi.fn(),
      provider,
    });

    expect(result.session?.status).toBe("closed");
  });

  it("maps session progress and errors into UI-safe messages", () => {
    const progress = toSessionProgress({
      channelId,
      cumulativeAmount: "100000",
      type: "closing",
    });
    expect(progress.type).toBe("closing");
    if (progress.type !== "closing") {
      throw new Error("Expected closing session progress");
    }

    const errorProgress = toSessionErrorProgress(
      new Error("Session setup missing"),
    );
    expect(errorProgress.type).toBe("error");
    if (errorProgress.type !== "error") {
      throw new Error("Expected error session progress");
    }

    expect(progress.detail).toMatch(/final cooperative close voucher/i);
    expect(errorProgress.detail).toBe("Session setup missing");
  });
});
