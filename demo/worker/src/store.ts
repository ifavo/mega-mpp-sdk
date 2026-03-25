const DEMO_STORE_OBJECT_NAME = "mega-mpp-demo-store";

type DurableStoreOperation =
  | {
      key: string;
      operation: "delete" | "get";
    }
  | {
      key: string;
      operation: "put";
      value: string;
    };

type DurableStoreResponse = {
  value: string | null;
};

type StoreLike = {
  delete: <key extends string>(key: key) => Promise<void>;
  get: <key extends string>(key: key) => Promise<unknown | null>;
  put: <key extends string>(key: key, value: unknown) => Promise<void>;
};

export class DemoStoreDurableObject implements DurableObject {
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
      case "put":
        await this.ctx.storage.put(operation.key, operation.value);
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
}

export function createDurableObjectStore(
  namespace: DurableObjectNamespace,
): StoreLike {
  const durableObjectId = namespace.idFromName(DEMO_STORE_OBJECT_NAME);
  const stub = namespace.get(durableObjectId);

  return {
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
      const payload = (await response.json()) as DurableStoreResponse;
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
