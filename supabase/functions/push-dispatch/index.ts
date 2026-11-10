import { createClient } from 'npm:@supabase/supabase-js@2';

import {
  chunk,
  EXPO_RECEIPTS_URL,
  EXPO_SEND_URL,
  isAuthorizedKey,
  MAX_MESSAGES_PER_REQUEST,
  MAX_RECEIPT_IDS_PER_REQUEST,
  receiptResults,
  ticketResults,
  toExpoMessages,
  type ClaimedDelivery,
  type ReceiptClaim,
} from './expo.ts';

// Server-only: invoked by Postgres (pg_net) and pg_cron with the project secret key. Clients never call it.
const MAX_SEND_BATCHES = 5;
// Keeps a full run (5 send batches + receipts) well inside the Edge Function wall-clock limit.
const EXPO_TIMEOUT_MS = 15_000;

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function serverKeys(): string[] {
  const keys: string[] = [];
  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (secretKeys) {
    try {
      keys.push(...Object.values(JSON.parse(secretKeys) as Record<string, string>));
    } catch {
      // Ignore malformed value; fall through to the legacy key.
    }
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) keys.push(legacy);
  return keys.filter(Boolean);
}

function expoHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
  };
  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; payload: unknown }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: expoHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(EXPO_TIMEOUT_MS),
    });
    const payload = await res.json().catch(() => null);
    return { ok: res.ok, payload };
  } catch (error) {
    const code = error instanceof Error && error.name === 'TimeoutError' ? 'Timeout' : 'NetworkError';
    return { ok: false, payload: { errors: [{ code, message: String(error) }] } };
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405, { message: 'Method not allowed.' });

  const keys = serverKeys();
  const bearer = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  const provided = request.headers.get('apikey') ?? bearer;
  if (!isAuthorizedKey(provided, keys)) return json(401, { message: 'Unauthorized.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!supabaseUrl || keys.length === 0) return json(500, { message: 'Server configuration is incomplete.' });
  const admin = createClient(supabaseUrl, keys[0], { auth: { autoRefreshToken: false, persistSession: false } });

  let sent = 0;
  let failed = 0;
  for (let batch = 0; batch < MAX_SEND_BATCHES; batch += 1) {
    const { data, error } = await admin.rpc('claim_push_deliveries', { p_limit: MAX_MESSAGES_PER_REQUEST });
    if (error) return json(500, { message: 'Could not claim deliveries.', detail: error.message });
    const deliveries = (data ?? []) as ClaimedDelivery[];
    if (deliveries.length === 0) break;

    const { ok, payload } = await postJson(EXPO_SEND_URL, toExpoMessages(deliveries));
    const results = ticketResults(deliveries, ok, payload);
    sent += results.filter((result) => result.ticket_id).length;
    failed += results.filter((result) => !result.ticket_id).length;
    const { error: recordError } = await admin.rpc('record_push_tickets', { p_results: results });
    if (recordError) return json(500, { message: 'Could not record push tickets.', detail: recordError.message });
    if (deliveries.length < MAX_MESSAGES_PER_REQUEST) break;
  }

  let receiptsChecked = 0;
  const { data: claimData, error: claimError } = await admin.rpc('claim_push_receipts', { p_limit: 1000 });
  if (claimError) return json(500, { message: 'Could not load push receipts.', detail: claimError.message });
  for (const claims of chunk((claimData ?? []) as ReceiptClaim[], MAX_RECEIPT_IDS_PER_REQUEST)) {
    const { ok, payload } = await postJson(EXPO_RECEIPTS_URL, { ids: claims.map((claim) => claim.ticket_id) });
    if (!ok) continue;
    const results = receiptResults(claims, payload);
    receiptsChecked += results.length;
    const { error } = await admin.rpc('record_push_receipts', { p_results: results });
    if (error) return json(500, { message: 'Could not record push receipts.', detail: error.message });
  }

  return json(200, { sent, failed, receipts_checked: receiptsChecked });
});
