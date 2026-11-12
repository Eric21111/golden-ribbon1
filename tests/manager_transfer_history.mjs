import assert from 'node:assert/strict';
import { loadTs } from './_load_ts.mjs';

const timestamp = '2026-11-10T10:00:00+00:00';
const rows = Array.from({length:203}, (_,i)=>({id:String(203-i).padStart(4,'0'),created_at:timestamp}));
const filters = [];
const cursors = [];
const supabase = {from(table) {
  assert.equal(table,'stock_transfers');
  let start = 0;
  const conditions = [];
  filters.push(conditions);
  return {
    select(){return this;}, order(){return this;},
    eq(column,value){conditions.push([column,value]);return this;},
    or(condition){
      const id = condition.match(/id\.lt\.(\d+)\)$/)?.[1];
      assert.ok(id && condition.includes('created_at.eq.'+timestamp));
      cursors.push(id);
      start=rows.findIndex(row=>row.id===id)+1;
      return this;
    },
    limit(limit){return Promise.resolve({data:rows.slice(start,start+limit),error:null});},
  };
}};
const {listTransfers}=loadTs('src/services/transferService.ts',{
  '@/lib/supabase':{supabase}, './stockUnitService':{},
});
assert.deepEqual(await listTransfers({branchId:'sm2',status:'pending_receipt'}),rows);
assert.deepEqual(cursors,[rows[99].id,rows[199].id]);
for (const conditions of filters) assert.deepEqual(conditions,[['to_branch_id','sm2'],['status','pending_receipt']]);
console.log('Manager transfer history passed for 203 shipments sharing one timestamp.');
