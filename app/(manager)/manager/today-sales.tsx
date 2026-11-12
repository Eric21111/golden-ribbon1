import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Screen } from '@/components/Screen';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { useBranches } from '@/hooks/useBranches';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { useAuth } from '@/features/auth/AuthProvider';
import { paymentLabel } from '@/features/sales/paymentMethods';
import { formatMoney } from '@/lib/format';
import { getErrorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export default function TodaySales() {
  const {profile}=useAuth();
  const branches=useBranches();
  const [branch,setBranch]=useState('');
  const [expanded,setExpanded]=useState('');
  const query=useQuery({queryKey:['manager-today-payments',profile?.branch_id,branch],queryFn:async()=>{
    const {data,error}=await supabase.rpc('manager_today_payments',branch?{p_branch:branch}:{});
    if(error) throw error;
    return data ?? [];
  }});
  const {refetch}=query;
  useFocusEffect(useCallback(()=>{void refetch();},[refetch]));
  return <Screen onRefresh={()=>void refetch()} refreshing={query.isRefetching}>
    <ManagerScreenHeader title="Today's sales" subtitle={profile?.branch?.is_main_branch?'Selling branches':profile?.branch?.name} showBack />
    {profile?.branch?.is_main_branch && <FilterChipRow value={branch} onChange={setBranch} options={[{value:'',label:'All branches'},...(branches.data ?? []).filter(b=>!b.is_main_branch).map(b=>({value:b.id,label:b.name}))]}/>}
    {query.error ? <ErrorState message={getErrorMessage(query.error)} onRetry={()=>void refetch()}/> :
      query.isPending ? <LoadingState label="Loading sales..." /> :
      (['cash','gcash','unrecorded'] as const).map(method=>{
        const rows=query.data.filter(r=>r.method===method);
        if(method==='unrecorded' && !rows.length) return null;
        return <View key={method} style={{gap:10,paddingVertical:8}}>
          <ManagerActionButton label={paymentLabel(method)+' - '+formatMoney(rows.reduce((sum,r)=>sum+Number(r.amount),0))}
            variant="secondary" onPress={()=>setExpanded(expanded===method?'':method)}/>
          {expanded===method && Object.entries({standard:'Standard',pwd:'PWD',back_office_guard:'Back office / security',employee_meal:'Employee / guest meals'}).map(([key,label])=>
            <Text key={key}>{label}: {formatMoney(Number(rows.find(r=>r.program===key)?.amount ?? 0))}</Text>)}
        </View>;
      })}
  </Screen>;
}
