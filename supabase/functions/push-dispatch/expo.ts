// Pure helpers for the Expo Push API (no Deno APIs, so they are unit-testable from Node).
// https://docs.expo.dev/push-notifications/sending-notifications/

export const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
export const MAX_MESSAGES_PER_REQUEST = 100;
export const MAX_RECEIPT_IDS_PER_REQUEST = 300;

export type ClaimedDelivery = {
  delivery_id: string;
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
};

export type TicketResult = { delivery_id: string; ticket_id?: string; error?: string; message?: string };
export type ReceiptClaim = { delivery_id: string; ticket_id: string };
export type ReceiptResult = { delivery_id: string; status: 'ok' | 'error'; error?: string; message?: string };

type ExpoTicket = { status?: string; id?: string; message?: string; details?: { error?: string } };
type ExpoReceipt = { status?: string; message?: string; details?: { error?: string } };

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

export function toExpoMessages(deliveries: readonly ClaimedDelivery[]) {
  return deliveries.map((delivery) => ({
    to: delivery.to,
    title: delivery.title,
    body: delivery.body,
    data: delivery.data,
    sound: 'default',
    priority: 'high',
    // Matches the channel the app creates and the expo-notifications plugin defaultChannel.
    channelId: 'default',
  }));
}

/** Maps a send response (tickets are positional) to one result per delivery. */
export function ticketResults(
  deliveries: readonly ClaimedDelivery[],
  httpOk: boolean,
  payload: unknown,
): TicketResult[] {
  const tickets = (payload as { data?: unknown } | null)?.data;
  if (!httpOk || !Array.isArray(tickets)) {
    const errors = (payload as { errors?: Array<{ code?: string; message?: string }> } | null)?.errors;
    const error = errors?.[0]?.code ?? 'RequestFailed';
    const message = errors?.[0]?.message ?? 'Expo push request failed.';
    return deliveries.map((delivery) => ({ delivery_id: delivery.delivery_id, error, message }));
  }
  return deliveries.map((delivery, index) => {
    const ticket = tickets[index] as ExpoTicket | undefined;
    if (ticket?.status === 'ok' && typeof ticket.id === 'string') {
      return { delivery_id: delivery.delivery_id, ticket_id: ticket.id };
    }
    return {
      delivery_id: delivery.delivery_id,
      error: ticket?.details?.error ?? (ticket ? 'TicketError' : 'MissingTicket'),
      message: ticket?.message,
    };
  });
}

/** Maps a getReceipts response; receipts not yet available are omitted so they are checked again later. */
export function receiptResults(claims: readonly ReceiptClaim[], payload: unknown): ReceiptResult[] {
  const receipts = (payload as { data?: Record<string, ExpoReceipt> } | null)?.data;
  if (!receipts || typeof receipts !== 'object') return [];
  const results: ReceiptResult[] = [];
  for (const claim of claims) {
    const receipt = receipts[claim.ticket_id];
    if (!receipt) continue;
    if (receipt.status === 'ok') {
      results.push({ delivery_id: claim.delivery_id, status: 'ok' });
    } else {
      results.push({
        delivery_id: claim.delivery_id,
        status: 'error',
        error: receipt.details?.error ?? 'ReceiptError',
        message: receipt.message,
      });
    }
  }
  return results;
}

/** Constant-time comparison against every configured server key. */
export function isAuthorizedKey(provided: string | null, allowed: readonly string[]): boolean {
  if (!provided) return false;
  let match = false;
  for (const key of allowed) {
    if (!key || key.length !== provided.length) continue;
    let diff = 0;
    for (let i = 0; i < key.length; i += 1) diff |= key.charCodeAt(i) ^ provided.charCodeAt(i);
    if (diff === 0) match = true;
  }
  return match;
}
