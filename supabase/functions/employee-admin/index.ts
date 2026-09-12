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

async function findAuthUserByEmail(
  adminClient: ReturnType<typeof createClient>,
  email: string,
) {
  const admin = adminClient.auth.admin as typeof adminClient.auth.admin & {
    getUserByEmail?: (value: string) => Promise<{ data: { user?: { id: string } } | null; error: { message: string } | null }>;
  };
  if (typeof admin.getUserByEmail === 'function') {
    const { data, error } = await admin.getUserByEmail(email);
    if (!error && data?.user) return data.user;
  }

  let page = 1;
  const perPage = 200;
  while (page <= 20) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found;
    if (data.users.length < perPage) return null;
    page += 1;
  }
  return null;
}

async function ensureEmployeeProfile(
  adminClient: ReturnType<typeof createClient>,
  requesterId: string,
  employeeId: string,
  fullName: string,
  role: EmployeeRole,
  branchId: string,
  isActive: boolean,
) {
  const { data: existing, error: existingError } = await adminClient
    .from('profiles')
    .select('id, full_name, role, branch_id, is_active')
    .eq('id', employeeId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    const sameAccount =
      existing.role === role
      && existing.branch_id === branchId
      && existing.full_name === fullName
      && existing.is_active === isActive;
    return { reused: true as const, sameAccount };
  }

  const { error: profileError } = await adminClient.rpc('create_employee_profile_from_server', {
    p_requester_id: requesterId,
    p_employee_id: employeeId,
    p_full_name: fullName,
    p_role: role,
    p_branch_id: branchId,
    p_is_active: isActive,
  });
  if (profileError) throw profileError;
  return { reused: false as const, sameAccount: true };
}

function employeeProfileError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes('active selling branch') || normalized.includes('selling branch')) {
    return 'Select an active selling branch.';
  }
  if (normalized.includes('full name')) return 'Enter a valid full name.';
  if (normalized.includes('employee role')) return 'Select Manager or Cashier.';
  if (normalized.includes('owner access') || normalized.includes('main branch manager')) {
    return 'Owner access is required.';
  }
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

    const { data: requester, error: requesterError } = await adminClient
      .from('profiles')
      .select('id, role')
      .eq('id', userData.user.id)
      .eq('role', 'owner')
      .eq('is_active', true)
      .maybeSingle();
    if (requesterError) throw requesterError;
    if (!requester) return response(403, { message: 'Owner access is required.' });

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
      if (!isUuid(branchId)) return response(400, { message: 'Select an active branch.' });
      if (typeof isActive !== 'boolean') return response(400, { message: 'Employee status is required.' });

      const { data: branch, error: branchError } = await adminClient
        .from('branches')
        .select('id, is_main_branch')
        .eq('id', branchId)
        .eq('is_active', true)
        .maybeSingle();
      if (branchError) throw branchError;
      if (!branch) return response(400, { message: role === 'cashier' ? 'Select an active selling branch.' : 'Select an active branch.' });
      if (role === 'cashier' && branch.is_main_branch) {
        return response(400, { message: 'Select an active selling branch.' });
      }

      const existingUser = await findAuthUserByEmail(adminClient, email);
      if (existingUser) {
        try {
          const result = await ensureEmployeeProfile(
            adminClient,
            userData.user.id,
            existingUser.id,
            fullName,
            role,
            branchId,
            isActive,
          );
          if (!result.sameAccount) {
            return response(409, { message: 'That email is already registered.' });
          }
          return response(200, { employeeId: existingUser.id, reused: true });
        } catch (error) {
          return response(400, { message: employeeProfileError(error instanceof Error ? error.message : '') });
        }
      }

      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (createError) {
        const duplicate = createError.code === 'email_exists' || createError.message.toLowerCase().includes('already');
        if (duplicate) {
          const raced = await findAuthUserByEmail(adminClient, email);
          if (raced) {
            try {
              const result = await ensureEmployeeProfile(
                adminClient,
                userData.user.id,
                raced.id,
                fullName,
                role,
                branchId,
                isActive,
              );
              if (!result.sameAccount) {
                return response(409, { message: 'That email is already registered.' });
              }
              return response(200, { employeeId: raced.id, reused: true });
            } catch (error) {
              return response(400, { message: employeeProfileError(error instanceof Error ? error.message : '') });
            }
          }
        }
        return response(duplicate ? 409 : 400, {
          message: duplicate
            ? 'That email is already registered.'
            : 'Employee account could not be created. Check the email and temporary password.',
        });
      }

      try {
        await ensureEmployeeProfile(
          adminClient,
          userData.user.id,
          created.user.id,
          fullName,
          role,
          branchId,
          isActive,
        );
      } catch (error) {
        const { error: cleanupError } = await adminClient.auth.admin.deleteUser(created.user.id);
        if (cleanupError) console.error('Unable to compensate failed employee profile creation.', cleanupError.message);
        return response(400, { message: employeeProfileError(error instanceof Error ? error.message : '') });
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
