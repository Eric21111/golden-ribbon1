import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {loadTs} from './_load_ts.mjs';

const refs={current:[]};
const {PinField}=loadTs('src/components/PinField.tsx',{
  react:{useRef:()=>refs,useState:v=>[v,()=>{}]},
  'react-native':{View:'View',Text:'Text',TextInput:'Input',Pressable:'Pressable'},
  './FormField':{FormField:'Field'}
});
let value='',focus=-1;
function inputs(){
  const tree=PinField({label:'PIN',value,onChangeText:next=>{value=next;}});
  const result=[];
  function walk(node){if(!node)return;if(Array.isArray(node))return node.forEach(walk);
    if(node.type==='Input')result.push(node.props);else walk(node.props?.children);}
  walk(tree);result.forEach((input,i)=>input.ref({focus:()=>{focus=i;}}));return result;
}
assert.equal(inputs().length,6);
inputs()[0].onChangeText('0');assert.equal(value,'0');assert.equal(focus,1);
inputs()[1].onChangeText('2@');assert.equal(value,'0');
inputs()[1].onKeyPress({nativeEvent:{key:'Backspace'}});assert.equal(value,'');assert.equal(focus,0);
inputs()[0].onChangeText('012345');assert.equal(value,'012345');assert.equal(focus,5);
inputs()[5].onChangeText('');assert.equal(value,'01234');assert.equal(focus,4);

let handler,verified,claimedId,closed=0,revoked=0;
const user={id:'cashier-a',email:'cashier@example.test'};
const factory=()=>({auth:{
  getUser:async token=>({data:{user:token==='valid'?user:null}}),
  signInWithPassword:async ({email,password})=>{
    assert.equal(email,user.email);return password===verified?{data:{user:{id:claimedId}}}:{error:{status:400}};
  },
  signOut:async ({scope})=>{assert.equal(scope,'local');revoked++;},
},rpc:async (name,args)=>{assert.equal(name,'begin_verified_cashier_close');assert.equal(args.p_cashier,user.id);closed++;return {data:{status:'pending'}};}});
const js=ts.transpileModule(readFileSync('supabase/functions/confirm-end-shift/index.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(js,{exports:{},require:()=>({createClient:factory}),Response,Deno:{env:{get:()=>undefined},serve:h=>handler=h}});
const send=(token,credential)=>handler(new Request('https://test.invalid',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({shiftId:'10000000-0000-4000-8000-000000000001',credential})}));
verified='012345';claimedId=user.id;
assert.equal((await send('unknown','012345')).status,401);
assert.equal((await send('valid','999999')).status,403);
claimedId='someone-else';assert.equal((await send('valid',verified)).status,403);assert.equal(closed,0);
claimedId=user.id;assert.equal((await send('valid',verified)).status,200);
verified='ExistingBetaPassword';assert.equal((await send('valid',verified)).status,200);
assert.equal(closed,2);assert.equal(revoked,2);
console.log('PIN input, verified account, incorrect credentials and beta transition passed.');
