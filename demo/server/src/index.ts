import path from "node:path";
import { fileURLToPath } from "node:url";

import cors from "cors";
import express, {
  type Request as ExpressRequest,
  type Response as ExpressResponse,
} from "express";

import { createDemoApi } from "./api.js";
import { loadNodeDemoEnvironment } from "./config.js";
import { createFileStore, getDefaultDemoStorePath } from "./store.js";

const app = express();
app.use(express.json());
app.use(
  cors({
    exposedHeaders: ["www-authenticate", "payment-receipt"],
  }),
);

const { environment, port } = loadNodeDemoEnvironment();
const demoApi = createDemoApi({
  environment,
  store: createFileStore(getDefaultDemoStorePath()),
});

app.get("/api/v1/health", handleApiRequest);
app.get("/api/v1/config", handleApiRequest);
app.get("/api/v1/charge/basic", handleApiRequest);
app.get("/api/v1/charge/splits", handleApiRequest);
app.get("/api/v1/session/basic", handleApiRequest);
app.get("/api/v1/session/state", handleApiRequest);
app.head("/api/v1/session/basic", handleApiRequest);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDist = path.resolve(__dirname, "../../app/dist");
app.use(express.static(appDist));
app.get("*splat", (_request: ExpressRequest, response: ExpressResponse) => {
  response.sendFile(path.join(appDist, "index.html"));
});

app.listen(port, () => {
  process.stdout.write(
    `mega-mpp demo server listening on ${environment.apiOrigin}\n`,
  );
});

async function handleApiRequest(
  request: ExpressRequest,
  response: ExpressResponse,
): Promise<void> {
  const webResponse = await demoApi.handleRequest(
    toWebRequest(request, environment.apiOrigin),
  );
  if (!webResponse) {
    response.status(404).json({
      detail:
        "Use one of the documented demo API routes before retrying this request.",
      status: 404,
      title: "Demo Route Not Found",
    });
    return;
  }

  await sendWebResponse(response, webResponse);
}

function toWebRequest(request: ExpressRequest, apiOrigin: string): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (!value) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }

  return new Request(new URL(request.originalUrl, apiOrigin).toString(), {
    headers,
    method: request.method,
  });
}

async function sendWebResponse(
  response: ExpressResponse,
  webResponse: globalThis.Response,
): Promise<void> {
  response.status(webResponse.status);
  webResponse.headers.forEach((value, key) => {
    response.setHeader(key, value);
  });

  const body = await webResponse.text();
  response.send(body);
}
