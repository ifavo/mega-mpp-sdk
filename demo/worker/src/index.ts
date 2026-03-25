import { createDemoApi } from "../../server/src/api.js";
import {
  loadWorkerDemoEnvironment,
  type DemoEnvironmentBindings,
} from "../../server/src/config.js";
import { DemoStoreDurableObject, createDurableObjectStore } from "./store.js";

export type DemoWorkerEnv = DemoEnvironmentBindings & {
  ASSETS: Fetcher;
  DEMO_STORE: DurableObjectNamespace;
};

const worker: ExportedHandler<DemoWorkerEnv> = {
  async fetch(request, env) {
    const api = createDemoApi({
      environment: loadWorkerDemoEnvironment(env, request),
      store: createDurableObjectStore(env.DEMO_STORE),
    });
    const apiResponse = await api.handleRequest(request);
    if (apiResponse) {
      return apiResponse;
    }

    return env.ASSETS.fetch(request);
  },
};

export { DemoStoreDurableObject };
export default worker;
