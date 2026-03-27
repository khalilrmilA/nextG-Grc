/**
 * Hook to manage real-time AI token usage updates.
 * Automatically refetches token usage after AI operations complete.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

export function useAiTokenRefresh() {
  const queryClient = useQueryClient();

  // Refetch AI access and usage data
  const refreshAiTokens = useCallback(async () => {
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ["ai", "access-check"] }),
      queryClient.refetchQueries({ queryKey: ["auth", "ai-usage"] }),
    ]);
  }, [queryClient]);

  return { refreshAiTokens };
}
