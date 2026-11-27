import assert from 'node:assert/strict';
import { loadTs } from './_load_ts.mjs';
const { unavailableIngredientNames, buildStockContext, maxAdditional, preferredVariantId } = loadTs('src/features/pos/posAvailability.ts');
const extra = { product: {id:'extra',name:'Extra Egg'}, quantity_on_hand:0, variants:[], stock_uses:{
  product:[{ingredient_product_id:'egg',quantity:1}], variants:{},
  ingredient_stock:{egg:0,boiled:60}, ingredient_names:{egg:'Egg',boiled:'Boiled Egg'},
}};
assert.deepEqual(unavailableIngredientNames(extra), ['Egg']);
const choiceItem={...extra,quantity_on_hand:60,variants:[{id:'fried',max_quantity:0},{id:'boiled',max_quantity:60}]};
assert.equal(preferredVariantId(choiceItem),'boiled','opening avoids the empty fried preparation');
assert.equal(preferredVariantId(choiceItem,'fried'),'fried','refresh does not switch an explicit preparation');
assert.equal(preferredVariantId(choiceItem,'removed'),'boiled');
assert.equal(preferredVariantId(extra),null);
assert.equal(maxAdditional(buildStockContext([extra]), [], 'extra', null), 0, 'boiled stock cannot silently satisfy a separate Egg recipe');
const restocked = {...extra, quantity_on_hand:3, stock_uses:{...extra.stock_uses,ingredient_stock:{egg:3,boiled:60}}};
assert.deepEqual(unavailableIngredientNames(restocked), []);
assert.equal(maxAdditional(buildStockContext([restocked]), [], 'extra', null), 3);
const boiled = {...extra, product:{id:'boiled',name:'Boiled Egg'},quantity_on_hand:60,stock_uses:{...extra.stock_uses,product:[{ingredient_product_id:'boiled',quantity:1}]}};
assert.equal(maxAdditional(buildStockContext([extra,boiled]), [], 'boiled', null), 60);
assert.deepEqual(unavailableIngredientNames({...boiled,quantity_on_hand:0,stock_uses:{...boiled.stock_uses,ingredient_stock:{boiled:0}}}), [], 'ordinary own-stock shortages keep the short label');

let effect, listener, removed=false, refreshes=0;
const {usePosStockRefresh} = loadTs('src/hooks/usePosStockRefresh.ts', {
  react:{useCallback:(fn)=>fn},
  'expo-router':{useFocusEffect:(fn)=>{effect=fn;}},
  'react-native':{AppState:{currentState:'active',addEventListener:(_,fn)=>{listener=fn;return {remove:()=>{removed=true;}};}}},
});
usePosStockRefresh(false,()=>refreshes++);
assert.equal(effect(),undefined);
assert.equal(refreshes,0);
usePosStockRefresh(true,()=>refreshes++);
const cleanup=effect();
assert.equal(refreshes,1,'returning to POS refreshes stock');
listener('active'); assert.equal(refreshes,1);
listener('background'); listener('active'); assert.equal(refreshes,2);
cleanup(); assert.equal(removed,true,'leaving POS removes the foreground listener');
console.log('Egg stock isolation, restock availability, focus and foreground refresh passed.');
