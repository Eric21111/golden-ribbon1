-- SM1 menu transcription for review. Run the entire SELECT in SQL Editor.
-- Transcribed prices are pesos. NULL means no price transcribed for that column.
-- Stock recipes, branch assignments, opening quantities and SKUs require separate approval.
with transcription(sheet, line, source_name, viand_price, meal_price, single_price, review_note) as (values
  (1,1,'Beef Kulma',90,108,null,'Check spelling against kitchen list'),
  (1,2,'Beef Tapa',90,108,null,null),
  (1,3,'Beef Menudo',90,108,null,null),
  (1,4,'Beef Bopis',80,98,null,'Verify handwritten name'),
  (1,5,'Beef Pares',140,168,null,'Drink included, no bihon. Confirm eligible drinks and sizes; note cut off on right'),
  (1,6,'Buttered Chicken',60,88,null,'1 pc; regular meal heading lists rice and bihon'),
  (1,6,'Honey Glazed Chicken',60,88,null,'1 pc; no bihon on meal'),
  (1,7,'Spicy Chk Wings',60,88,null,'2 pcs per order'),
  (1,8,'Chicken Curry',60,88,null,'1 pc with half boiled egg, no bihon'),
  (1,9,'Chicken Caldereta',60,88,null,'3 pcs (small cuts); confirm handwritten spelling'),
  (1,10,'Buffalo Wings Chicken',60,88,null,'3 pcs wings'),
  (1,11,'Chicken Skin',60,88,null,'100 grams'),
  (1,12,'Marlin',80,98,null,'1 pc, no bihon'),
  (1,13,'Sweet N Sour Fish',70,88,null,'3–4 pcs'),
  (1,14,'Sisig Tuna',70,88,null,'100 grams, fried egg, no bihon; verify egg quantity'),
  (1,15,'Kilawin Tuna',80,98,null,'No bihon; verify spelling'),
  (1,16,'Calamares',70,88,null,'100 grams / 6–7 pcs; verify spelling'),
  (1,17,'Adobong Pork',70,88,null,'100 grams / 6–7 pcs; verify name'),
  (1,18,'Shrimp',70,88,null,'3–4 pcs, no bihon'),
  (1,19,'Beef Balls',70,88,null,'5 pcs'),
  (1,20,'Chicken Patty',60,68,null,'4 pcs'),
  (2,1,'Tortang Talong',50,58,null,'No bihon'),
  (2,2,'Chopsuey',40,48,null,'No bihon'),
  (2,3,'Ampalaya',40,48,null,'No bihon'),
  (2,4,'Upo',40,48,null,'No bihon'),
  (2,5,'Pinakbet',40,48,null,'No bihon'),
  (2,6,'Sitaw',40,48,null,'No bihon'),
  (2,7,'Any Vegie',40,48,null,'No bihon; confirm if sellable item or pricing note'),
  (2,8,'Sotanghon',null,null,48,'Single listed price; confirm spelling'),
  (2,9,'Spaghetti',null,null,58,null),
  (2,10,'Siopao',null,null,48,null),
  (2,11,'Additional / Extra Egg',null,null,20,'Note appears to say in store stocks'),
  (2,12,'Extra Rice',null,null,20,null),
  (2,13,'Extra Spoon / Fork',null,null,3,'Confirm whether one item or separate utensils'),
  (2,14,'Extra Styro',null,null,10,null),
  (2,15,'Extra Container',null,null,10,null),
  (2,16,'Leche Flan',null,null,40,null),
  (2,17,'Salad',null,null,40,null),
  (3,1,'Yakult',null,null,13,'Verify handwritten price'),
  (3,2,'Dutchmill',null,null,35,null),
  (3,3,'Chuckie (Big)',null,null,35,null),
  (3,4,'Del Monte',null,null,40,null),
  (3,5,'C2 (Big)',null,null,40,null),
  (3,6,'Minute Maid',null,null,35,null),
  (3,7,'Nestea',null,null,40,null),
  (3,8,'Kalamansi (Big)',null,null,35,'Verify label'),
  (3,9,'Coke Mismo',null,null,25,null),
  (3,10,'Royal Mismo',null,null,25,null),
  (3,11,'Sprite Mismo',null,null,25,null),
  (3,12,'Mountain Dew',null,null,30,null),
  (3,13,'Pepsi',null,null,30,null),
  (3,14,'Sting',null,null,30,null),
  (3,15,'Coke Can',null,null,40,null),
  (3,16,'Royal Can',null,null,40,null),
  (3,17,'Sprite Can',null,null,40,null),
  (3,18,'Coke Zero',null,null,40,null),
  (3,19,'Sprite Zero',null,null,40,null),
  (3,20,'Royal Zero',null,null,40,null),
  (3,21,'H2O Medium',null,null,20,null)
), menu as (
  select t.*, upper(left(source_name, 1)) || lower(substr(source_name, 2)) as proposed_name
  from transcription t
)
select m.sheet, m.line, m.proposed_name,
  case when matches.total = 0 then 'No name match'
       when matches.total = 1 and matches.exact_name then 'Already exists - skip creation'
       else 'Possible match - review before creation' end as catalog_check,
  matches.products as existing_products,
  m.viand_price, m.meal_price, m.single_price, m.review_note,
  case when m.viand_price is not null and m.meal_price is not null then
    jsonb_build_array(jsonb_build_object('name','Viand only','price',m.viand_price),
                      jsonb_build_object('name','Meal','price',m.meal_price))
  end as proposed_sm1_variants
from menu m
cross join lateral (
  select count(*) as total,
    bool_or(lower(trim(p.name)) = lower(m.proposed_name)) as exact_name,
    jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'sku', p.sku,
      'active', p.is_active) order by p.name, p.id) as products
  from public.products p
  where regexp_replace(lower(p.name), '[^[:alnum:]]', '', 'g')
      = regexp_replace(lower(m.proposed_name), '[^[:alnum:]]', '', 'g')
) matches
order by m.sheet, m.line, m.proposed_name;
