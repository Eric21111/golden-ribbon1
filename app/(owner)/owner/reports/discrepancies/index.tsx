import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/Screen';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/dashboard/ManagerFeedback';
import { FilterChipRow } from '@/components/dashboard/FilterChipRow';
import { useReturnDiscrepanciesReport,useTransferDiscrepanciesReport } from '@/hooks/useReconciliation';
import { useShiftRemittances } from '@/hooks/useShifts';
import { stockUnit } from '@/lib/stockUnits';
import { getErrorMessage } from '@/lib/errors';
import { formatMoney } from '@/lib/format';
import { Pagination } from '@/components/Pagination';
import { useClientPagination } from '@/hooks/useClientPagination';

export default function OwnerDiscrepancyAnalytics() {
  const [section,setSection]=useState('transfer');
  const transfers=useTransferDiscrepanciesReport(undefined,'all','all_time');
  const returns=useReturnDiscrepanciesReport(undefined,'all','all_time');
  const remittance=useShiftRemittances('all_time');
  const query=section==='transfer'?transfers:section==='return'?returns:remittance;
  const rows=section==='remittance' ? (remittance.data?.days ?? []).flatMap(day=>day.shifts.flatMap(shift=>
    ([[shift.expected_gcash == null ? 'Collections' : 'Cash',shift.expected_cash,shift.actual_cash],['GCash',shift.expected_gcash,shift.actual_gcash]] as const).flatMap(([label,expected,actual])=>{
      if(expected==null || actual==null || Number(actual)===Number(expected)) return [];
      return [{id:shift.shift_id+label,title:label+' - '+shift.branch_name,expected:formatMoney(expected),actual:formatMoney(actual),
        difference:formatMoney(Math.abs(actual-expected)),missing:expected>actual,reason:'No reason recorded',resolution:'No resolution recorded',
        link:'/owner/reports/shift-remittances/'+shift.shift_id}];
    }))) : (section==='transfer'?transfers.data ?? []:returns.data ?? []).map(item=>{
      const unit=' '+(stockUnit(item.stock_unit_code)?.plural ?? 'pcs');
      const expected='quantity_sent' in item?item.quantity_sent:item.quantity_returned;
      return {id:item.id,title:item.product_name+' - '+item.branch_name,expected:expected+unit,actual:item.quantity_received+unit,
        difference:Math.abs(item.difference)+unit,missing:item.discrepancy_type==='missing',reason:item.notes || 'No reason recorded',
        resolution:[item.resolution_reason?.replace(/_/g,' '),item.resolution_note].filter(Boolean).join(' - ') || 'No resolution recorded',
        link:'/owner/reports/discrepancies/'+section+'/'+item.id};
    });
  const page=useClientPagination(rows,section,20);
  return <Screen refreshing={query.isRefetching} onRefresh={()=>void query.refetch()}>
    <ManagerScreenHeader title="Discrepancy Analytics" showBack />
    <Pressable accessibilityRole="button" onPress={()=>router.push('/owner/reports/stock-count-changes' as never)} style={{paddingVertical:12}}>
      <Text>View stock count changes and reasons ›</Text>
    </Pressable>
    <FilterChipRow value={section} onChange={setSection} options={[{value:'transfer',label:'Transfers'},{value:'return',label:'Returns'},{value:'remittance',label:'Remittance'}]} />
    {query.error?<ErrorState message={getErrorMessage(query.error)} onRetry={()=>void query.refetch()}/>:
      query.isPending?<LoadingState label="Loading differences..."/>:!rows.length?<EmptyState title="No differences" message="No differences recorded for this category."/>:
      <>{page.pageItems.map(row=><Pressable key={row.id} accessibilityRole="button" onPress={()=>router.push(row.link as never)} style={{paddingVertical:12,gap:5}}>
        <Text style={{fontWeight:'700'}}>{row.title}</Text>
        <Text>Expected: {row.expected} | {section==='remittance'?'Remitted':'Received'}: {row.actual}</Text>
        <Text>{row.missing?'Missing':'Extra'}: {row.difference}</Text>
        <Text>Reason: {row.reason}</Text><Text>Reason for resolving: {row.resolution}</Text>
      </Pressable>)}{page.totalPages>1 && <Pagination page={page.page} totalPages={page.totalPages} onPageChange={page.setPage}/>}</>}
  </Screen>;
}
