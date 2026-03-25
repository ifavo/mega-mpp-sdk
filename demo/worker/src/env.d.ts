declare global {
  namespace Cloudflare {
    interface Env {
      ASSETS: Fetcher;
      DEMO_STORE: DurableObjectNamespace;
    }
  }
}

export {};
