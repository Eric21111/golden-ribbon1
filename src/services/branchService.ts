import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';
import type { Branch, BranchInput } from '@/types/models';

type BranchInsert = Database['public']['Tables']['branches']['Insert'];

export async function listBranches(): Promise<Branch[]> {
  const { data, error } = await supabase
    .from('branches')
    .select('*')
    .order('is_main_branch', { ascending: false })
    .order('name');
  if (error) throw error;
  return data;
}

export async function getBranch(id: string): Promise<Branch> {
  const { data, error } = await supabase.from('branches').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function createBranch(input: BranchInput): Promise<Branch> {
  const values: BranchInsert = { ...input, code: input.code.trim().toUpperCase() };
  const { data, error } = await supabase
    .from('branches')
    .insert(values)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateBranch(id: string, input: BranchInput): Promise<Branch> {
  const values: Partial<BranchInsert> = { ...input, code: input.code.trim().toUpperCase() };
  const { data, error } = await supabase
    .from('branches')
    .update(values)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}
