import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {loadTs} from './_load_ts.mjs';

const refs={current:[]};
let stateCursor=0;
const stateBag=[];
const {PinField}=loadTs('src/components/PinField.tsx',{
  react:{
    useRef:()=>refs,
    useState(v){
      const i=stateCursor++;
      if(!(i in stateBag)) stateBag[i]=v;
      return [stateBag[i], next=>{stateBag[i]=typeof next==='function'?next(stateBag[i]):next;}];
    },
  },
  'react-native':{
    View:'View',Text:'Text',TextInput:'Input',Pressable:'Pressable',
    StyleSheet:{create:x=>x},
  },
  '@react-native-vector-icons/ionicons':{default:'Icon'},
  '@/components/FormField':{FormField:'Field'},
  '@/components/dashboard/theme':{managerColors:{ink:'#111',subtext:'#667',royalBlue:'#1E3A8A'}},
});
let value='',focus=-1;
function inputs(){
  stateCursor=0;
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
for (const invalid of ['ExistingBetaPassword', '12345', '1234567', '12a456', ' 12345', '', 123456]) {
  verified=invalid;
  assert.equal((await send('valid',invalid)).status,400);
}
assert.equal(closed,1);assert.equal(revoked,1);
console.log('PIN input, verified account, incorrect credentials and rejection of beta passwords and invalid PINs passed.');

// Validate at the service boundary as well as in the form.
let authCalls=0;
const account=loadTs('src/services/accountService.ts', {
  '@/lib/supabase': {supabase:{auth:{
    getUser:async()=>{authCalls++;return {data:{user}};},
    signInWithPassword:async ({password})=>{authCalls++;assert.equal(password,'012345');return {data:{user}};},
  }}},
});
for (const invalid of ['BetaPassword','12345','1234567','12345a','１２３４５６']) {
  await assert.rejects(account.verifyOwnPassword(invalid), /six digits/);
  await assert.rejects(account.changeOwnEmail(invalid,'new@example.test'), /six digits/);
  await assert.rejects(account.changeOwnPassword(invalid,'012345'), /six digits/);
}
assert.equal(authCalls,0,'invalid PINs never reach authentication');
await account.verifyOwnPassword('012345');
assert.equal(authCalls,2);
const {currentPinStepSchema}=loadTs('src/features/profile/changePasswordSchema.ts');
for(const value of ['BetaPassword','12345','1234567','12345a'])
  assert.equal(currentPinStepSchema.safeParse({current_password:value}).success,false);
assert.equal(currentPinStepSchema.safeParse({current_password:'012345'}).success,true);
console.log('PIN-only service validation and leading-zero PIN verification passed.');
