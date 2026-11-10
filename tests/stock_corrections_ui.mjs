import assert from 'node:assert/strict';
import { loadTs } from './_load_ts.mjs';
const memory=new Map();
globalThis.localStorage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
const logic=loadTs('src/features/pos/stockCorrection.ts');
for(const value of ['0','1','999999']) assert.equal(logic.parseStockCount(value),Number(value));
for(const value of ['','-1','0.5','1.5','1000000','1e2',' 1','12x']) assert.equal(logic.parseStockCount(value),null);
const request={p_shift_id:'shift',p_product_id:'rice',p_expected_quantity:0,p_expected_updated_at:'2026-11-10T00:00:00Z',p_actual_quantity:10,p_reason:'Incorrect kitchen count',p_idempotency_key:'correction-persisted-001'};
logic.savePendingCorrection('cashier',request);
assert.deepEqual(logic.readPendingCorrection('cashier'),request);
assert.equal(logic.readPendingCorrection('other'),null);
logic.savePendingCorrection('cashier',null);
memory.set('golden-ribbons-stock-correction:cashier','{"p_actual_quantity":10}');
assert.throws(()=>logic.readPendingCorrection('cashier'),/Invalid saved correction/);
memory.clear();

let slots=[],cursor=0,calls=[],fail=true;
const state=initial=>{const i=cursor++;if(!(i in slots)) slots[i]=typeof initial==='function'?initial():initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];};
const cart={items:[{product_id:'meal',quantity:2}],stockContext:{}};
const original=JSON.stringify(cart);
const row={product_id:'rice',product_name:'Rice',quantity:0,updated_at:'2026-11-10T00:00:00Z',stock_unit_code:'half_serving'};
const {default:Screen}=loadTs('app/(cashier)/cashier/correct-stock.tsx',{
  react:{useState:state,useMemo:fn=>fn(),useRef:v=>state(()=>({current:v}))[0]},
  'react-native':{Pressable:'Pressable',Text:'Text',TextInput:'Input',View:'View'},
  'expo-router':{router:{back:()=>{},push:()=>{}}},
  '@tanstack/react-query':{useQuery:()=>({data:[row],refetch:async()=>{}}),useQueryClient:()=>({invalidateQueries:async()=>{}})},
  '@/components/Screen':{Screen:'Screen'},
  '@/components/dashboard/ManagerScreenHeader':{ManagerScreenHeader:'Header'},
  '@/components/dashboard/ManagerActionButton':{ManagerActionButton:'Button'},
  '@/features/auth/AuthProvider':{useAuth:()=>({profile:{id:'cashier'}})},
  '@/hooks/useShifts':{useActiveShift:()=>({data:{id:'shift',status:'open'}})},
  '@/stores/cartStore':{useCartStore:()=>cart},
  '@/stores/checkoutStore':{useCheckoutStore:fn=>fn({request:null})},
  '@/features/pos/posAvailability':{cartUsage:()=>new Map([['rice',2]])},
  '@/lib/errors':{getErrorMessage:e=>e.message},
  '@/services/stockCorrectionService':{listCorrectionStock:async()=>[row],correctStock:async r=>{
    assert.deepEqual(logic.readPendingCorrection('cashier'),r,'persist before send');
    calls.push(r);if(fail)throw new Error('Network response lost');return 'receipt';
  }},
});
const render=()=>{cursor=0;return Screen();};
const nodes=tree=>[tree,...(Array.isArray(tree?.props?.children)?tree.props.children:[tree?.props?.children]).flat(Infinity).filter(Boolean).flatMap(child=>typeof child==='object'?nodes(child):[child])];
const button=(tree,label)=>nodes(tree).find(n=>n?.props?.label===label);
let tree=render();
nodes(tree).find(n=>n?.type==='Pressable').props.onPress();
tree=render();
nodes(tree).find(n=>n?.type==='Input').props.onChangeText('0.5');
tree=render();assert.equal(button(tree,'Review correction').props.disabled,true);
nodes(tree).find(n=>n?.type==='Input').props.onChangeText('10');
button(tree,'Incorrect kitchen count').props.onPress();
tree=render();assert.equal(button(tree,'Review correction').props.disabled,false);
button(tree,'Review correction').props.onPress();
tree=render();assert.match(nodes(tree).filter(n=>typeof n==='string').join(' '),/Expected remaining: 8 half-serving units/);
button(tree,'Confirm stock correction').props.onPress();
await new Promise(resolve=>setImmediate(resolve));
tree=render();assert.ok(button(tree,'Confirm correction result'));
const savedRequest=logic.readPendingCorrection('cashier');assert.ok(savedRequest);
// Remount after navigation or app restart, retry the exact operation rather than creating another adjustment.
slots=[];fail=false;tree=render();
button(tree,'Confirm correction result').props.onPress();
await new Promise(resolve=>setImmediate(resolve));
assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);
assert.equal(logic.readPendingCorrection('cashier'),null);
assert.ok(button(render(),'Back to order'));
assert.equal(JSON.stringify(cart),original,'correction never clears or rewrites the cart');
console.log('Stock correction UI passed: whole counts, units, review arithmetic, persisted retries after restart, and cart preservation.');
