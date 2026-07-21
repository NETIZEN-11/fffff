import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ApiResponse } from "@/types";

// Generic fetch helper with typed response. The X-Requested-With
// header is the simplest CSRF defence on top of the session cookie:
// browsers will not let a cross-origin <form> POST set custom
// headers, so any request that *does* include this header is
// either same-origin or has been CORS-preflighted. The middleware
// rejects state-changing API requests that don't carry it.
async function apiFetch<T>(
  url: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...options?.headers,
    },
    ...options,
  });

  const data = (await response.json()) as ApiResponse<T>;

  if (!response.ok) {
    throw new Error(data.message ?? "Request failed");
  }

  return data;
}

// Hook: GET request
export function useApiQuery<T>(
  key: (string | number | undefined)[],
  url: string,
  options?: { enabled?: boolean; staleTime?: number }
) {
  return useQuery({
    queryKey: key,
    queryFn: () => apiFetch<T>(url),
    enabled: options?.enabled !== false,
    staleTime: options?.staleTime,
  });
}

// Hook: mutation (POST / PATCH / DELETE)
export function useApiMutation<TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<ApiResponse<TData>>,
  options?: {
    onSuccess?: (data: ApiResponse<TData>) => void;
    onError?: (error: Error) => void;
    invalidateKeys?: string[][];
    successMessage?: string;
  }
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: (data) => {
      if (options?.successMessage) {
        toast.success(options.successMessage);
      }
      if (options?.invalidateKeys) {
        options.invalidateKeys.forEach((key) => {
          queryClient.invalidateQueries({ queryKey: key });
        });
      }
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      toast.error(error.message ?? "Something went wrong");
      options?.onError?.(error);
    },
  });
}

export { apiFetch };
