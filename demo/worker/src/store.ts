const DEMO_STORE_OBJECT_NAME = "mega-mpp-demo-store";

type DurableStoreOperation =
  | {
      key: string;
      operation: "delete" | "get";
    }
  | {
      key: string;
      operation: "lock";
    }
  | {
      key: string;
      operation: "put";
      value: string;
    }
  | {
      key: string;
      operation: "unlock";
      token: string;
    };

type DurableStoreResponse =
  | {
      value: string | null;
    }
  | {
      token: string;
    };

type StoreLike = {
  acquireLock: (key: string) => Promise<() => Promise<void>>;
  delete: <key extends string>(key: key) => Promise<void>;
  get: <key extends string>(key: key) => Promise<unknown | null>;
  put: <key extends string>(key: key, value: unknown) => Promise<void>;
};

export class DemoStoreDurableObject implements DurableObject {
  readonly heldLocks = new Map<string, string>();
  readonly waitQueues = new Map<string, Array<() => void>>();

  constructor(readonly ctx: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const operation = (await request.json()) as DurableStoreOperation;

    switch (operation.operation) {
      case "get": {
        const value = await this.ctx.storage.get<string>(operation.key);
        return Response.json({
          value: value ?? null,
        } satisfies DurableStoreResponse);
      }
      case "lock": {
        const token = crypto.randomUUID();
        await this.acquireLock(operation.key, token);
        return Response.json({
          token,
        } satisfies DurableStoreResponse);
      }
      case "put":
        await this.ctx.storage.put(operation.key, operation.value);
        return new Response(null, { status: 204 });
      case "unlock":
        this.releaseLock(operation.key, operation.token);
        return new Response(null, { status: 204 });
      case "delete":
        await this.ctx.storage.delete(operation.key);
        return new Response(null, { status: 204 });
      default:
        return Response.json(
          {
            detail:
              "Use a supported Durable Object store operation before retrying the Cloudflare demo request.",
            status: 400,
            title: "Demo Store Operation Invalid",
          },
          { status: 400 },
        );
    }
  }

  private async acquireLock(key: string, token: string): Promise<void> {
    while (this.heldLocks.has(key)) {
      await new Promise<void>((resolve) => {
        const queue = this.waitQueues.get(key) ?? [];
        queue.push(resolve);
        this.waitQueues.set(key, queue);
      });
    }

    this.heldLocks.set(key, token);
  }

  private releaseLock(key: string, token: string): void {
    if (this.heldLocks.get(key) !== token) {
      throw new Error(
        "Release the matching Durable Object lock token before retrying the Cloudflare demo request.",
      );
    }

    this.heldLocks.delete(key);
    const queue = this.waitQueues.get(key);
    const next = queue?.shift();

    if (!queue?.length) {
      this.waitQueues.delete(key);
    }

    next?.();
  }
}

export function createDurableObjectStore(
  namespace: DurableObjectNamespace,
): StoreLike {
  const durableObjectId = namespace.idFromName(DEMO_STORE_OBJECT_NAME);
  const stub = namespace.get(durableObjectId);

  return {
    async acquireLock(key) {
      const response = await sendStoreOperation(stub, {
        key,
        operation: "lock",
      });
      const payload = (await response.json()) as Extract<
        DurableStoreResponse,
        { token: string }
      >;

      return async () => {
        await sendStoreOperation(stub, {
          key,
          operation: "unlock",
          token: payload.token,
        });
      };
    },
    async delete(key) {
      await sendStoreOperation(stub, {
        key,
        operation: "delete",
      });
    },
    async get(key) {
      const response = await sendStoreOperation(stub, {
        key,
        operation: "get",
      });
      const payload = (await response.json()) as Extract<
        DurableStoreResponse,
        { value: string | null }
      >;
      return payload.value === null ? null : JSON.parse(payload.value);
    },
    async put(key, value) {
      await sendStoreOperation(stub, {
        key,
        operation: "put",
        value: JSON.stringify(value),
      });
    },
  };
}

async function sendStoreOperation(
  stub: DurableObjectStub,
  operation: DurableStoreOperation,
): Promise<Response> {
  const response = await stub.fetch("https://demo-store.internal", {
    body: JSON.stringify(operation),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(
      "Handle the Durable Object store operation successfully before retrying the Cloudflare demo request.",
    );
  }

  return response;
}
