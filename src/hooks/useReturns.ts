import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';
import {
  getReturn,
  listReturnDiscrepancies,
  listReturns,
  receiveReturn,
} from '@/services/returnService';
import type { ReceiveReturnInput, ReturnStatus } from '@/types/returns';

export function useReturns(branchId = '', status: ReturnStatus | '' = '') {
  return useQuery({
    queryKey: queryKeys.returns(branchId, status),
    queryFn: () => listReturns({ branchId, status }),
  });
}

export function useReturn(id: string) {
  return useQuery({
    queryKey: queryKeys.return(id),
    queryFn: () => getReturn(id),
    enabled: Boolean(id),
  });
}

export function useReturnDiscrepancies() {
  return useQuery({
    queryKey: queryKeys.returnDiscrepancies,
    queryFn: listReturnDiscrepancies,
  });
}

function invalidateReturnFlow(client: ReturnType<typeof useQueryClient>, returnId?: string) {
  const requests = [
    client.invalidateQueries({ queryKey: ['inventory'] }),
    client.invalidateQueries({ queryKey: ['inventory-movements'] }),
    client.invalidateQueries({ queryKey: ['stock-returns'] }),
    client.invalidateQueries({ queryKey: ['return-inventory'] }),
    client.invalidateQueries({ queryKey: queryKeys.returnDiscrepancies }),
  ];
  if (returnId) {
    requests.push(client.invalidateQueries({ queryKey: queryKeys.return(returnId) }));
  }
  return Promise.all(requests);
}

export function useReceiveReturn() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ReceiveReturnInput) => receiveReturn(input),
    onSuccess: (_status, input) => invalidateReturnFlow(client, input.returnId),
  });
}
