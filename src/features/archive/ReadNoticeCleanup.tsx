import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { useAuth } from '@/features/auth/AuthProvider';
import { confirmAction } from '@/lib/confirmAction';
import { getErrorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export function ReadNoticeCleanup() {
  const {profile} = useAuth();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const preview = useQuery({
    queryKey: ['owner-cleanup-notices', profile?.id], enabled: open && profile?.role === 'owner',
    queryFn: async () => {
      const {data,error} = await supabase.rpc('owner_cleanup_read_notices', {});
      if (error) throw error;
      return data ?? [];
    },
  });
  const remove = useMutation({
    mutationFn: async (ids: string[]) => {
      const {data,error} = await supabase.rpc('owner_cleanup_read_notices', {p_ids: ids});
      if (error) throw error;
      return data?.length ?? 0;
    },
    onSuccess: count => { setNotice('Read notifications removed: ' + count); },
    onSettled: () => { setSelected([]); void preview.refetch(); },
  });
  if (!open) return <ManagerActionButton label="Clean up read notifications" variant="secondary" onPress={() => setOpen(true)} />;
  return <View style={{gap:10}}>
    <Text>Choose read notifications to delete. The oldest 50 eligible notices appear first.</Text>
    {preview.isPending && <Text>Loading notifications…</Text>}
    {preview.isSuccess && !preview.data.length && <Text>No eligible read notifications.</Text>}
    {preview.data?.map(row => <Pressable accessibilityRole="checkbox" accessibilityState={{checked:selected.includes(row.id)}}
      disabled={remove.isPending} key={row.id} onPress={() => setSelected(ids => ids.includes(row.id) ? ids.filter(id=>id!==row.id) : [...ids,row.id])}>
      <Text style={{paddingVertical:8}}>{selected.includes(row.id) ? '☑' : '☐'} {row.title} · {new Date(row.read_at).toLocaleDateString()}</Text>
    </Pressable>)}
    {(preview.error || remove.error) && <Text accessibilityRole="alert">{getErrorMessage(preview.error || remove.error)}</Text>}
    {!!notice && <Text>{notice}</Text>}
    <ManagerActionButton label={'Delete selected (' + selected.length + ')'} disabled={!selected.length || remove.isPending || preview.isError}
      onPress={() => confirmAction('Delete selected notifications?', 'Permanently delete ' + selected.length + ' read notifications and their completed delivery records?',
        () => remove.mutate(selected), {confirm:'Delete selected', tone:'danger'})} />
    <ManagerActionButton label="Close" variant="secondary" disabled={remove.isPending} onPress={() => {setSelected([]); setOpen(false);}} />
  </View>;
}
