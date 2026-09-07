import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';
import { getTransfer, listTransfers, receiveTransfer, sendTransfer } from '@/services/transferService';
import type { ReceiveTransferInput, SendTransferInput, TransferStatus } from '@/types/models';

export function useTransfers(branchId = '', status: TransferStatus | '' = '') {
  return useQuery({
    queryKey: queryKeys.transfers(branchId, status),
    queryFn: () => listTransfers({ branchId, status }),
  });
}

export function useTransfer(id: string) {
  return useQuery({ queryKey: queryKeys.transfer(id), queryFn: () => getTransfer(id), enabled: Boolean(id) });
}

function invalidateInventoryFlow(client: ReturnType<typeof useQueryClient>, transferId?: string) {
  const requests = [
    client.invalidateQueries({ queryKey: ['inventory'] }),
    client.invalidateQueries({ queryKey: ['inventory-movements'] }),
    client.invalidateQueries({ queryKey: ['transfers'] }),
  ];
  if (transferId) requests.push(client.invalidateQueries({ queryKey: queryKeys.transfer(transferId) }));
  return Promise.all(requests);
}

export function useSendTransfer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SendTransferInput) => sendTransfer(input),
    onSuccess: (id) => invalidateInventoryFlow(client, id),
  });
}

export function useReceiveTransfer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ReceiveTransferInput) => receiveTransfer(input),
    onSuccess: (_status, input) => invalidateInventoryFlow(client, input.transferId),
  });
}
