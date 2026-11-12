import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Screen } from '@/components/Screen';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { getErrorMessage } from '@/lib/errors';
import { useActiveShift } from '@/hooks/useShifts';
import { useAuth } from '@/features/auth/AuthProvider';
import { listShiftSales } from '@/services/saleService';
import { paymentBreakdown, paymentLabel, type PaymentFilter } from '@/features/sales/paymentMethods';
import { formatMoney } from '@/lib/format';

export default function PaymentTotals() {
  const { profile } = useAuth();
  const shift = useActiveShift(profile?.id ?? '');
  const id = shift.data?.id;
  const sales = useQuery({queryKey:['shift-sales',id], queryFn:()=>listShiftSales(id!), enabled:!!id});
  const { refetch } = sales;
  useFocusEffect(useCallback(()=>{ if(id) void refetch(); },[id,refetch]));
  const [open,setOpen] = useState<PaymentFilter | null>(null);
  return <Screen><ManagerScreenHeader title="Current shift sales" showBack />
    {shift.error || sales.error ? <ErrorState message={getErrorMessage(shift.error ?? sales.error)} onRetry={()=>{void shift.refetch(); if(id) void refetch();}} /> :
      shift.isPending || (id && sales.isPending) ? <LoadingState label="Loading sales…" /> : !id ? <EmptyState title="No active shift" message="Start a shift to see its sales." /> :
      (['cash','gcash','unrecorded'] as const).map(method=>{
        const row=paymentBreakdown(sales.data ?? [],method);
        if(method==='unrecorded' && !row.orders) return null;
        return <View key={method} style={{gap:10,paddingVertical:8}}>
          <ManagerActionButton variant="secondary" label={paymentLabel(method)+' · '+formatMoney(row.total/100)} onPress={()=>setOpen(open===method?null:method)} />
          {open===method && <>
            <Text>Standard: {formatMoney(row.groups.standard/100)}</Text>
            <Text>PWD: {formatMoney(row.groups.pwd/100)}</Text>
            <Text>Back office / security: {formatMoney(row.groups.back_office_guard/100)}</Text>
            <Text>Employee / guest meals: {row.employeeMeals} orders · {formatMoney(row.groups.employee_meal/100)}</Text>
            <ManagerActionButton label="View receipts" onPress={()=>router.push({pathname:'/cashier/sales',params:{method}})} />
          </>}
        </View>;
      })}
  </Screen>;
}
