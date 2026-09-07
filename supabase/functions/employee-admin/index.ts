import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

type EmployeeRole = 'manager' | 'cashier';

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function readDefaultKey(name: 'SUPABASE_PUBLISHABLE_KEYS' | 'SUPABASE_SECRET_KEYS') {
  const value = Deno.env.get(name);
  if (!value) throw new Error('Required Supabase function credentials are unavailable.');
  const keys = JSON.parse(value) as Record<string, string>;
  if (!keys.default) throw new Error('The default Supabase function credential is unavailable.');
  return keys.default;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function employeeProfileError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes('active selling branch') || normalized.includes('selling branch')) {
    return 'Select an active selling branch.';
  }
  if (normalized.includes('full name')) return 'Enter a valid full name.';
  if (normalized.includes('employee role')) return 'Select Manager or Cashier.';
  if (normalized.includes('owner access')) return 'Owner access is required.';
  return 'Employee account could not be created.';
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response(405, { message: 'Method not allowed.' });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (!supabaseUrl) throw new Error('Supabase URL is unavailable.');
    const publishableKey = readDefaultKey('SUPABASE_PUBLISHABLE_KEYS');
    const secretKey = readDefaultKey('SUPABASE_SECRET_KEYS');
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return response(401, { message: 'Authentication is required.' });

    const authClient = createClient(supabaseUrl, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const adminClient = createClient(supabaseUrl, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    if (userError || !userData.user) return response(401, { message: 'Your session is invalid or expired.' });

    const { data: owner, error: ownerError } = await adminClient
      .from('profiles')
      .select('id')
      .eq('id', userData.user.id)
      .eq('role', 'owner')
      .eq('is_active', true)
      .maybeSingle();
    if (ownerError) throw ownerError;
    if (!owner) return response(403, { message: 'Owner access is required.' });

    const body = await request.json() as Record<string, unknown>;

    if (body.action === 'create') {
      const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const role = body.role as EmployeeRole;
      const branchId = body.branchId;
      const isActive = body.isActive;

      if (fullName.length < 2 || fullName.length > 120) return response(400, { message: 'Enter a valid full name.' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response(400, { message: 'Enter a valid email address.' });
      if (password.length < 8 || password.length > 72) return response(400, { message: 'Temporary password must contain 8 to 72 characters.' });
      if (role !== 'manager' && role !== 'cashier') return response(400, { message: 'Select Manager or Cashier.' });
      if (!isUuid(branchId)) return response(400, { message: 'Select an active selling branch.' });
      if (typeof isActive !== 'boolean') return response(400, { message: 'Employee status is required.' });

      const { data: branch, error: branchError } = await adminClient
        .from('branches')
        .select('id')
        .eq('id', branchId)
        .eq('is_active', true)
        .eq('is_main_branch', false)
        .maybeSingle();
      if (branchError) throw branchError;
      if (!branch) return response(400, { message: 'Select an active selling branch.' });

      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (createError) {
        const duplicate = createError.code === 'email_exists' || createError.message.toLowerCase().includes('already');
        return response(duplicate ? 409 : 400, {
          message: duplicate
            ? 'That email is already registered.'
            : 'Employee account could not be created. Check the email and temporary password.',
        });
      }

      const { error: profileError } = await adminClient.rpc('create_employee_profile_from_server', {
        p_requester_id: userData.user.id,
        p_employee_id: created.user.id,
        p_full_name: fullName,
        p_role: role,
        p_branch_id: branchId,
        p_is_active: isActive,
      });
      if (profileError) {
        const { error: cleanupError } = await adminClient.auth.admin.deleteUser(created.user.id);
        if (cleanupError) console.error('Unable to compensate failed employee profile creation.', cleanupError.message);
        return response(400, { message: employeeProfileError(profileError.message) });
      }

      return response(201, { employeeId: created.user.id });
    }

    if (body.action === 'reset-password') {
      const employeeId = body.employeeId;
      const password = typeof body.password === 'string' ? body.password : '';
      if (!isUuid(employeeId)) return response(400, { message: 'Employee account was not found.' });
      if (password.length < 8 || password.length > 72) return response(400, { message: 'Temporary password must contain 8 to 72 characters.' });

      const { data: employee, error: employeeError } = await adminClient
        .from('profiles')
        .select('id, role')
        .eq('id', employeeId)
        .in('role', ['manager', 'cashier'])
        .maybeSingle();
      if (employeeError) throw employeeError;
      if (!employee) return response(404, { message: 'Employee account was not found.' });

      const { error: updateError } = await adminClient.auth.admin.updateUserById(employeeId, { password });
      if (updateError) return response(400, { message: 'Password could not be reset. Check the temporary password and try again.' });
      return response(200, { success: true });
    }

    return response(400, { message: 'Invalid employee operation.' });
  } catch (error) {
    console.error('Employee administration failed.', error instanceof Error ? error.message : 'Unknown error');
    return response(500, { message: 'Employee operation could not be completed.' });
  }
});
