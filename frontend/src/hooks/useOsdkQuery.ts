import { useOsdkClient } from "@osdk/react";
import { useQuery } from "@tanstack/react-query";
import type { ObjectTypeDefinition, Osdk, WhereClause } from "@osdk/client";

interface UseOsdkQueryOptions<T extends ObjectTypeDefinition> {
  objectType: T;
  queryKey: string[];
  where?: WhereClause<T>;
  orderBy?: Record<string, "asc" | "desc">;
  pageSize?: number;
  enabled?: boolean;
}

export function useOsdkQuery<T extends ObjectTypeDefinition>({
  objectType,
  queryKey,
  where,
  orderBy,
  pageSize = 50,
  enabled = true,
}: UseOsdkQueryOptions<T>) {
  const client = useOsdkClient();

  return useQuery({
    queryKey,
    queryFn: async () => {
      let query = client(objectType);
      if (where) {
        query = query.where(where as Parameters<typeof query.where>[0]);
      }
      const result = await query.fetchPage({
        $pageSize: pageSize,
        $orderBy: orderBy as Record<string, "asc" | "desc"> | undefined,
      });
      return result.data as Osdk.Instance<T>[];
    },
    enabled,
  });
}
