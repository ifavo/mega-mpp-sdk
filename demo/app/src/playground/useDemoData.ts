import { useQuery } from "@tanstack/react-query";

import type { DemoConfigResponse, DemoHealthResponse } from "../types.js";

export function useDemoData() {
  const configQuery = useQuery({
    queryFn: async () => {
      const response = await fetch("/api/v1/config");
      if (!response.ok) {
        throw new Error(
          "Load the demo configuration successfully before retrying.",
        );
      }

      return (await response.json()) as DemoConfigResponse;
    },
    queryKey: ["demo-config"],
  });

  const healthQuery = useQuery({
    queryFn: async () => {
      const response = await fetch("/api/v1/health");
      if (!response.ok) {
        throw new Error(
          "Load the demo health status successfully before retrying.",
        );
      }

      return (await response.json()) as DemoHealthResponse;
    },
    queryKey: ["demo-health"],
    refetchInterval: 15_000,
  });

  return {
    configQuery,
    healthQuery,
  };
}
