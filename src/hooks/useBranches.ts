import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';
import { createBranch, getBranch, listBranches, updateBranch } from '@/services/branchService';
import type { BranchInput } from '@/types/models';

export function useBranches() {
  return useQuery({ queryKey: queryKeys.branches, queryFn: listBranches });
}

export function useBranch(id: string) {
  return useQuery({ queryKey: queryKeys.branch(id), queryFn: () => getBranch(id), enabled: Boolean(id) });
}

export function useCreateBranch() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: createBranch,
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.branches }),
  });
}

export function useUpdateBranch(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: BranchInput) => updateBranch(id, input),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.branches }),
        client.invalidateQueries({ queryKey: queryKeys.branch(id) }),
      ]);
    },
  });
}
