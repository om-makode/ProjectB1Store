-- Catalog-only seed for a real Supabase project (no test users). Paste into the SQL Editor.
-- ---------- store (Amravati) ----------
insert into public.stores (name, address, city, location, service_radius_km, phone, whatsapp,
                           gstin, fssai_license, opening_hours, eta_minutes)
values (
  '{"en":"NearKart Rajapeth","mr":"नियरकार्ट राजापेठ","hi":"नियरकार्ट राजापेठ"}',
  '{"en":"Shop 4, Rajapeth Square, Amravati 444601","mr":"दुकान ४, राजापेठ चौक, अमरावती ४४४६०१","hi":"दुकान 4, राजापेठ चौक, अमरावती 444601"}',
  'Amravati',
  extensions.st_setsrid(extensions.st_makepoint(77.7523, 20.9374), 4326)::extensions.geography,   -- lng, lat
  4, '+919800000000', '+919800000000',
  '27ABCDE1234F1Z5', '11524999000000',
  '{"mon":[{"open":"07:00","close":"22:30"}],"tue":[{"open":"07:00","close":"22:30"}],
    "wed":[{"open":"07:00","close":"22:30"}],"thu":[{"open":"07:00","close":"22:30"}],
    "fri":[{"open":"07:00","close":"22:30"}],"sat":[{"open":"07:00","close":"23:00"}],
    "sun":[{"open":"08:00","close":"14:00"},{"open":"16:00","close":"22:00"}]}',
  20);

-- ---------- categories (8 parents) ----------
insert into public.categories (slug, name, icon, color, sort_order, image_path) values
 ('fruits-vegetables', '{"en":"Fruits & Vegetables","mr":"फळे व भाज्या","hi":"फल और सब्ज़ियाँ"}',        'food-apple',   '#16A34A', 1, 'categories/fruits-vegetables.webp'),
 ('dairy-bread-eggs',  '{"en":"Dairy, Bread & Eggs","mr":"दूध, ब्रेड व अंडी","hi":"डेयरी, ब्रेड और अंडे"}', 'cup',          '#2563EB', 2, 'categories/dairy-bread-eggs.webp'),
 ('atta-rice-dal',     '{"en":"Atta, Rice & Dal","mr":"पीठ, तांदूळ व डाळ","hi":"आटा, चावल और दाल"}',      'rice',         '#CA8A04', 3, 'categories/atta-rice-dal.webp'),
 ('oil-masala',        '{"en":"Oil, Masala & Dry Fruits","mr":"तेल, मसाले व सुका मेवा","hi":"तेल, मसाले और मेवे"}', 'bottle-tonic', '#EA580C', 4, 'categories/oil-masala.webp'),
 ('snacks-biscuits',   '{"en":"Snacks & Biscuits","mr":"स्नॅक्स व बिस्किटे","hi":"स्नैक्स और बिस्किट"}',   'cookie',       '#DB2777', 5, 'categories/snacks-biscuits.webp'),
 ('cold-drinks',       '{"en":"Cold Drinks & Juices","mr":"शीतपेये व ज्यूस","hi":"कोल्ड ड्रिंक और जूस"}',  'cup-water',    '#0891B2', 6, 'categories/cold-drinks.webp'),
 ('personal-care',     '{"en":"Personal Care","mr":"वैयक्तिक काळजी","hi":"पर्सनल केयर"}',                  'lotion',       '#7C3AED', 7, 'categories/personal-care.webp'),
 ('household',         '{"en":"Cleaning & Household","mr":"स्वच्छता व घरगुती","hi":"सफाई और घरेलू"}',      'spray-bottle', '#475569', 8, 'categories/household.webp');

-- Attribute schemas + filters on parents (sub-categories inherit)
update public.categories set
  attribute_schema = '{"fields":[
    {"key":"milk_type","type":"select","label":{"en":"Milk type","mr":"दुधाचा प्रकार","hi":"दूध का प्रकार"},"filterable":true,
     "options":[{"value":"cow","label":{"en":"Cow","mr":"गाय","hi":"गाय"}},{"value":"buffalo","label":{"en":"Buffalo","mr":"म्हैस","hi":"भैंस"}}]},
    {"key":"fat_percent","type":"number","unit":"%","label":{"en":"Fat","mr":"फॅट","hi":"वसा"}},
    {"key":"organic","type":"boolean","label":{"en":"Organic","mr":"सेंद्रिय","hi":"जैविक"},"filterable":true,"badge":true}
  ]}',
  filters = '[{"type":"brand"},{"type":"price","buckets":[0,30,60,100]},{"type":"attribute","key":"milk_type"},{"type":"attribute","key":"organic","quick":true},{"type":"veg"}]'
where slug = 'dairy-bread-eggs';

update public.categories set
  attribute_schema = '{"fields":[
    {"key":"organic","type":"boolean","label":{"en":"Organic","mr":"सेंद्रिय","hi":"जैविक"},"filterable":true,"badge":true},
    {"key":"origin_farm","type":"text","label":{"en":"Farm / village","mr":"शेत / गाव","hi":"खेत / गाँव"}}
  ]}',
  filters = '[{"type":"price","buckets":[0,20,50,100]},{"type":"attribute","key":"organic","quick":true}]'
where slug = 'fruits-vegetables';

update public.categories set
  filters = '[{"type":"brand"},{"type":"price","buckets":[0,50,100,250,500]},{"type":"veg"}]'
where parent_id is null and slug not in ('dairy-bread-eggs', 'fruits-vegetables');

-- Sub-categories
insert into public.categories (parent_id, slug, name, sort_order, image_path)
select p.id, s.slug, s.name::jsonb, s.ord, 'categories/' || s.slug || '.webp'
from (values
  ('fruits-vegetables','fresh-vegetables','{"en":"Fresh Vegetables","mr":"ताज्या भाज्या","hi":"ताज़ी सब्ज़ियाँ"}',1),
  ('fruits-vegetables','fresh-fruits',    '{"en":"Fresh Fruits","mr":"ताजी फळे","hi":"ताज़े फल"}',2),
  ('fruits-vegetables','leafy-herbs',     '{"en":"Leafy & Herbs","mr":"पालेभाज्या","hi":"पत्तेदार सब्ज़ियाँ"}',3),
  ('dairy-bread-eggs', 'milk',            '{"en":"Milk","mr":"दूध","hi":"दूध"}',1),
  ('dairy-bread-eggs', 'curd-paneer',     '{"en":"Curd & Paneer","mr":"दही व पनीर","hi":"दही और पनीर"}',2),
  ('dairy-bread-eggs', 'bread-pav',       '{"en":"Bread & Pav","mr":"ब्रेड व पाव","hi":"ब्रेड और पाव"}',3),
  ('dairy-bread-eggs', 'eggs',            '{"en":"Eggs","mr":"अंडी","hi":"अंडे"}',4),
  ('atta-rice-dal',    'atta-flours',     '{"en":"Atta & Flours","mr":"पीठ","hi":"आटा"}',1),
  ('atta-rice-dal',    'rice',            '{"en":"Rice","mr":"तांदूळ","hi":"चावल"}',2),
  ('atta-rice-dal',    'dal-pulses',      '{"en":"Dal & Pulses","mr":"डाळी व कडधान्ये","hi":"दाल और दलहन"}',3),
  ('oil-masala',       'edible-oil',      '{"en":"Edible Oil","mr":"खाद्य तेल","hi":"खाने का तेल"}',1),
  ('oil-masala',       'masala',          '{"en":"Masala, Salt & Sugar","mr":"मसाले, मीठ व साखर","hi":"मसाले, नमक और चीनी"}',2),
  ('oil-masala',       'dry-fruits',      '{"en":"Dry Fruits","mr":"सुका मेवा","hi":"सूखे मेवे"}',3),
  ('snacks-biscuits',  'biscuits',        '{"en":"Biscuits","mr":"बिस्किटे","hi":"बिस्किट"}',1),
  ('snacks-biscuits',  'namkeen-chips',   '{"en":"Namkeen & Chips","mr":"नमकीन व चिप्स","hi":"नमकीन और चिप्स"}',2),
  ('cold-drinks',      'soft-drinks',     '{"en":"Soft Drinks","mr":"सॉफ्ट ड्रिंक्स","hi":"सॉफ्ट ड्रिंक"}',1),
  ('cold-drinks',      'juices',          '{"en":"Juices","mr":"ज्यूस","hi":"जूस"}',2),
  ('personal-care',    'bath-body',       '{"en":"Bath & Body","mr":"अंघोळ","hi":"स्नान"}',1),
  ('personal-care',    'oral-care',       '{"en":"Oral Care","mr":"दातांची काळजी","hi":"दाँतों की देखभाल"}',2),
  ('household',        'detergents',      '{"en":"Detergents","mr":"डिटर्जंट","hi":"डिटर्जेंट"}',1),
  ('household',        'cleaners',        '{"en":"Floor & Toilet Cleaners","mr":"फ्लोअर व टॉयलेट क्लीनर","hi":"फ़्लोर और टॉयलेट क्लीनर"}',2)
) as s(parent_slug, slug, name, ord)
join public.categories p on p.slug = s.parent_slug;

-- ---------- brands ----------
insert into public.brands (slug, name) values
 ('fresh',      '{"en":"Fresh","mr":"ताजे","hi":"ताज़ा"}'),
 ('amul',       '{"en":"Amul","mr":"अमूल","hi":"अमूल"}'),
 ('gokul',      '{"en":"Gokul","mr":"गोकुळ","hi":"गोकुल"}'),
 ('britannia',  '{"en":"Britannia","mr":"ब्रिटानिया","hi":"ब्रिटानिया"}'),
 ('aashirvaad', '{"en":"Aashirvaad","mr":"आशीर्वाद","hi":"आशीर्वाद"}'),
 ('india-gate', '{"en":"India Gate","mr":"इंडिया गेट","hi":"इंडिया गेट"}'),
 ('tata',       '{"en":"Tata","mr":"टाटा","hi":"टाटा"}'),
 ('fortune',    '{"en":"Fortune","mr":"फॉर्च्यून","hi":"फ़ॉर्च्यून"}'),
 ('saffola',    '{"en":"Saffola","mr":"सफोला","hi":"सफ़ोला"}'),
 ('everest',    '{"en":"Everest","mr":"एव्हरेस्ट","hi":"एवरेस्ट"}'),
 ('mdh',        '{"en":"MDH","mr":"एमडीएच","hi":"एमडीएच"}'),
 ('parle',      '{"en":"Parle","mr":"पार्ले","hi":"पारले"}'),
 ('haldirams',  '{"en":"Haldiram''s","mr":"हल्दीराम","hi":"हल्दीराम"}'),
 ('lays',       '{"en":"Lay''s","mr":"लेज","hi":"लेज़"}'),
 ('coca-cola',  '{"en":"Coca-Cola","mr":"कोका-कोला","hi":"कोका-कोला"}'),
 ('real',       '{"en":"Real","mr":"रिअल","hi":"रियल"}'),
 ('hul',        '{"en":"Hindustan Unilever","mr":"हिंदुस्तान युनिलिव्हर","hi":"हिंदुस्तान यूनिलीवर"}'),
 ('colgate',    '{"en":"Colgate","mr":"कोलगेट","hi":"कोलगेट"}'),
 ('reckitt',    '{"en":"Reckitt","mr":"रेकिट","hi":"रेकिट"}');

-- ---------- products ----------
-- manufacturer = Legal Metrology text as printed on the pack: {"name", "address"}
insert into public.products (category_id, brand_id, slug, name, description, attributes, is_veg, tags,
                             hsn_code, gst_rate, country_of_origin, manufacturer, shelf_life, sort_order)
select c.id, b.id, p.slug, p.name::jsonb, p.descr::jsonb, p.attrs::jsonb, p.veg, p.tags::text[],
       p.hsn, p.gst, 'India', p.mfr::jsonb, p.shelf, p.ord
from (values
  -- fresh-vegetables
  ('fresh-vegetables','fresh','tomato-local','{"en":"Tomato (Local)","mr":"टोमॅटो (गावरान)","hi":"टमाटर (देसी)"}',
   '{"en":"Fresh, firm local tomatoes.","mr":"ताजे, घट्ट गावरान टोमॅटो.","hi":"ताज़े, सख़्त देसी टमाटर।"}',
   '{"organic":false}', true, '{tamatar,tameta,tomato}', '0702', 0, null, '3 days', 1),
  ('fresh-vegetables','fresh','onion-local','{"en":"Onion","mr":"कांदा","hi":"प्याज़"}',
   '{"en":"Dry red onions from Nashik.","mr":"नाशिकचा लाल कांदा.","hi":"नासिक का लाल प्याज़।"}',
   '{"origin_farm":"Nashik"}', true, '{kanda,pyaz,onion}', '0703', 0, null, '2 weeks', 2),
  ('fresh-vegetables','fresh','potato-local','{"en":"Potato","mr":"बटाटा","hi":"आलू"}',
   null, '{}', true, '{batata,aloo,potato}', '0701', 0, null, '2 weeks', 3),
  ('fresh-vegetables','fresh','green-chilli','{"en":"Green Chilli","mr":"हिरवी मिरची","hi":"हरी मिर्च"}',
   null, '{}', true, '{mirchi,chilli}', '0709', 0, null, '4 days', 4),
  -- leafy-herbs
  ('leafy-herbs','fresh','coriander-bunch','{"en":"Coriander","mr":"कोथिंबीर","hi":"हरा धनिया"}',
   null, '{"organic":true}', true, '{kothimbir,dhaniya,coriander}', '0709', 0, null, '2 days', 1),
  ('leafy-herbs','fresh','spinach-bunch','{"en":"Spinach (Palak)","mr":"पालक","hi":"पालक"}',
   null, '{}', true, '{palak,spinach}', '0709', 0, null, '2 days', 2),
  -- fresh-fruits
  ('fresh-fruits','fresh','banana-robusta','{"en":"Banana (Robusta)","mr":"केळी","hi":"केला"}',
   null, '{}', true, '{kela,keli,banana}', '0803', 0, null, '4 days', 1),
  ('fresh-fruits','fresh','apple-shimla','{"en":"Apple (Shimla)","mr":"सफरचंद (शिमला)","hi":"सेब (शिमला)"}',
   null, '{}', true, '{seb,apple}', '0808', 0, null, '2 weeks', 2),
  -- milk
  ('milk','amul','amul-taaza-toned-milk','{"en":"Amul Taaza Toned Milk","mr":"अमूल ताजा टोन्ड दूध","hi":"अमूल ताज़ा टोंड दूध"}',
   '{"en":"Pasteurised toned milk. Keep refrigerated.","mr":"पाश्चराइज्ड टोन्ड दूध. फ्रिजमध्ये ठेवा.","hi":"पाश्चराइज़्ड टोंड दूध। फ्रिज में रखें।"}',
   '{"milk_type":"buffalo","fat_percent":3}', true, '{milk,doodh,dudh}', '0401', 0,
   '{"name":"Gujarat Co-operative Milk Marketing Federation Ltd","address":"Amul Dairy Road, Anand, Gujarat 388001"}', '2 days', 1),
  ('milk','amul','amul-gold-full-cream-milk','{"en":"Amul Gold Full Cream Milk","mr":"अमूल गोल्ड फुल क्रीम दूध","hi":"अमूल गोल्ड फुल क्रीम दूध"}',
   null, '{"milk_type":"buffalo","fat_percent":6}', true, '{milk,doodh}', '0401', 0,
   '{"name":"Gujarat Co-operative Milk Marketing Federation Ltd","address":"Amul Dairy Road, Anand, Gujarat 388001"}', '2 days', 2),
  ('milk','gokul','gokul-cow-milk','{"en":"Gokul Cow Milk","mr":"गोकुळ गाईचे दूध","hi":"गोकुल गाय का दूध"}',
   null, '{"milk_type":"cow","fat_percent":3.5}', true, '{milk,doodh,cow}', '0401', 0,
   '{"name":"Kolhapur Zilla Sahakari Dudh Utpadak Sangh Ltd","address":"Gokul Shirgaon, Kolhapur 416234"}', '2 days', 3),
  -- curd-paneer
  ('curd-paneer','amul','amul-masti-dahi','{"en":"Amul Masti Dahi","mr":"अमूल मस्ती दही","hi":"अमूल मस्ती दही"}',
   null, '{}', true, '{dahi,curd}', '0403', 5,
   '{"name":"Gujarat Co-operative Milk Marketing Federation Ltd","address":"Amul Dairy Road, Anand, Gujarat 388001"}', '10 days', 1),
  ('curd-paneer','amul','amul-malai-paneer','{"en":"Amul Malai Paneer","mr":"अमूल मलई पनीर","hi":"अमूल मलाई पनीर"}',
   null, '{}', true, '{paneer}', '0406', 5,
   '{"name":"Gujarat Co-operative Milk Marketing Federation Ltd","address":"Amul Dairy Road, Anand, Gujarat 388001"}', '20 days', 2),
  -- bread-pav
  ('bread-pav','britannia','britannia-white-bread','{"en":"Britannia White Bread","mr":"ब्रिटानिया व्हाईट ब्रेड","hi":"ब्रिटानिया व्हाइट ब्रेड"}',
   null, '{}', true, '{bread,double roti}', '1905', 0,
   '{"name":"Britannia Industries Ltd","address":"5/1A Hungerford Street, Kolkata 700017"}', '4 days', 1),
  ('bread-pav','fresh','ladi-pav','{"en":"Ladi Pav (6 pcs)","mr":"लादी पाव (६ नग)","hi":"लादी पाव (6 पीस)"}',
   null, '{}', true, '{pav,paav}', '1905', 0,
   '{"name":"Shree Bakery","address":"Rajapeth, Amravati 444601"}', '2 days', 2),
  -- eggs
  ('eggs','fresh','farm-eggs-white','{"en":"Farm Eggs (White)","mr":"अंडी (पांढरी)","hi":"अंडे (सफ़ेद)"}',
   null, '{}', false, '{anda,ande,egg}', '0407', 0,
   '{"name":"Vidarbha Poultry Farms","address":"Badnera Road, Amravati 444607"}', '10 days', 1),
  -- atta-flours
  ('atta-flours','aashirvaad','aashirvaad-whole-wheat-atta','{"en":"Aashirvaad Shudh Chakki Atta","mr":"आशीर्वाद शुद्ध चक्की आटा","hi":"आशीर्वाद शुद्ध चक्की आटा"}',
   '{"en":"100% whole wheat atta.","mr":"१००% गव्हाचे पीठ.","hi":"100% गेहूँ का आटा।"}',
   '{}', true, '{atta,aata,gehu,wheat}', '1101', 5,
   '{"name":"ITC Ltd","address":"Virginia House, 37 J.L. Nehru Road, Kolkata 700071"}', '4 months', 1),
  ('atta-flours','tata','tata-sampann-besan','{"en":"Tata Sampann Besan","mr":"टाटा संपन्न बेसन","hi":"टाटा संपन्न बेसन"}',
   null, '{}', true, '{besan,gram flour}', '1106', 5,
   '{"name":"Tata Consumer Products Ltd","address":"1 Bishop Lefroy Road, Kolkata 700020"}', '6 months', 2),
  -- rice
  ('rice','india-gate','india-gate-basmati-classic','{"en":"India Gate Basmati Rice (Classic)","mr":"इंडिया गेट बासमती तांदूळ","hi":"इंडिया गेट बासमती चावल"}',
   null, '{}', true, '{rice,chawal,tandul,basmati}', '1006', 5,
   '{"name":"KRBL Ltd","address":"5190 Lahori Gate, Delhi 110006"}', '24 months', 1),
  ('rice','fresh','kolam-rice','{"en":"Kolam Rice","mr":"कोलम तांदूळ","hi":"कोलम चावल"}',
   null, '{}', true, '{rice,chawal,tandul,kolam}', '1006', 5,
   '{"name":"Amravati Rice Traders","address":"Itwara Bazar, Amravati 444601"}', '12 months', 2),
  -- dal-pulses
  ('dal-pulses','tata','tata-sampann-toor-dal','{"en":"Tata Sampann Toor Dal","mr":"टाटा संपन्न तूर डाळ","hi":"टाटा संपन्न अरहर दाल"}',
   null, '{}', true, '{toor,tur,arhar,dal}', '0713', 5,
   '{"name":"Tata Consumer Products Ltd","address":"1 Bishop Lefroy Road, Kolkata 700020"}', '9 months', 1),
  ('dal-pulses','fresh','moong-dal','{"en":"Moong Dal","mr":"मूग डाळ","hi":"मूंग दाल"}',
   null, '{}', true, '{moong,mung,dal}', '0713', 5,
   '{"name":"Amravati Rice Traders","address":"Itwara Bazar, Amravati 444601"}', '9 months', 2),
  -- edible-oil
  ('edible-oil','fortune','fortune-soyabean-oil','{"en":"Fortune Soyabean Oil","mr":"फॉर्च्यून सोयाबीन तेल","hi":"फ़ॉर्च्यून सोयाबीन तेल"}',
   null, '{}', true, '{oil,tel,soyabean}', '1507', 5,
   '{"name":"AWL Agri Business Ltd","address":"Fortune House, Navrangpura, Ahmedabad 380009"}', '9 months', 1),
  ('edible-oil','saffola','saffola-gold-oil','{"en":"Saffola Gold Oil","mr":"सफोला गोल्ड तेल","hi":"सफ़ोला गोल्ड तेल"}',
   null, '{}', true, '{oil,tel}', '1512', 5,
   '{"name":"Marico Ltd","address":"7th Floor, Grande Palladium, Kalina, Mumbai 400098"}', '9 months', 2),
  -- masala, salt & sugar
  ('masala','everest','everest-turmeric-powder','{"en":"Everest Turmeric Powder","mr":"एव्हरेस्ट हळद पावडर","hi":"एवरेस्ट हल्दी पाउडर"}',
   null, '{}', true, '{haldi,halad,turmeric}', '0910', 5,
   '{"name":"Everest Food Products Pvt Ltd","address":"Ghatkopar (W), Mumbai 400086"}', '12 months', 1),
  ('masala','mdh','mdh-garam-masala','{"en":"MDH Garam Masala","mr":"एमडीएच गरम मसाला","hi":"एमडीएच गरम मसाला"}',
   null, '{}', true, '{masala,garam masala}', '0910', 5,
   '{"name":"Mahashian Di Hatti Pvt Ltd","address":"9/44 Kirti Nagar, New Delhi 110015"}', '12 months', 2),
  ('masala','tata','tata-salt','{"en":"Tata Salt","mr":"टाटा मीठ","hi":"टाटा नमक"}',
   null, '{}', true, '{namak,meeth,salt}', '2501', 0,
   '{"name":"Tata Consumer Products Ltd","address":"1 Bishop Lefroy Road, Kolkata 700020"}', '24 months', 3),
  ('masala','fresh','sugar-loose','{"en":"Sugar","mr":"साखर","hi":"चीनी"}',
   null, '{}', true, '{sakhar,chini,cheeni,sugar}', '1701', 5,
   '{"name":"Amravati Rice Traders","address":"Itwara Bazar, Amravati 444601"}', '12 months', 4),
  -- dry-fruits
  ('dry-fruits','fresh','cashew-w320','{"en":"Cashews (W320)","mr":"काजू (W320)","hi":"काजू (W320)"}',
   null, '{}', true, '{kaju,cashew}', '0801', 5,
   '{"name":"Konkan Cashew Processors","address":"MIDC, Ratnagiri 415639"}', '6 months', 1),
  -- biscuits
  ('biscuits','parle','parle-g-gold','{"en":"Parle-G Gold Biscuits","mr":"पार्ले-जी गोल्ड बिस्किटे","hi":"पारले-जी गोल्ड बिस्किट"}',
   null, '{}', true, '{biscuit,parle}', '1905', 5,
   '{"name":"Parle Products Pvt Ltd","address":"Vile Parle (E), Mumbai 400057"}', '9 months', 1),
  ('biscuits','britannia','britannia-good-day-butter','{"en":"Britannia Good Day Butter Cookies","mr":"ब्रिटानिया गुड डे बटर कुकीज","hi":"ब्रिटानिया गुड डे बटर कुकीज़"}',
   null, '{}', true, '{biscuit,cookies}', '1905', 5,
   '{"name":"Britannia Industries Ltd","address":"5/1A Hungerford Street, Kolkata 700017"}', '6 months', 2),
  -- namkeen-chips
  ('namkeen-chips','haldirams','haldirams-aloo-bhujia','{"en":"Haldiram''s Aloo Bhujia","mr":"हल्दीराम आलू भुजिया","hi":"हल्दीराम आलू भुजिया"}',
   null, '{}', true, '{namkeen,bhujia}', '2106', 5,
   '{"name":"Haldiram Snacks Pvt Ltd","address":"B-1/H-3 Mohan Co-operative Industrial Area, New Delhi 110044"}', '6 months', 1),
  ('namkeen-chips','lays','lays-classic-salted','{"en":"Lay''s Classic Salted Chips","mr":"लेज क्लासिक सॉल्टेड चिप्स","hi":"लेज़ क्लासिक सॉल्टेड चिप्स"}',
   null, '{}', true, '{chips,wafers}', '2005', 5,
   '{"name":"PepsiCo India Holdings Pvt Ltd","address":"DLF Cyber City, Gurugram 122002"}', '4 months', 2),
  -- soft-drinks
  ('soft-drinks','coca-cola','coca-cola-original','{"en":"Coca-Cola Original","mr":"कोका-कोला","hi":"कोका-कोला"}',
   null, '{}', true, '{coke,cold drink,thanda}', '2202', 40,
   '{"name":"Hindustan Coca-Cola Beverages Pvt Ltd","address":"Bengaluru 560103"}', '6 months', 1),
  -- juices
  ('juices','real','real-mixed-fruit-juice','{"en":"Real Mixed Fruit Juice","mr":"रिअल मिक्स फ्रूट ज्यूस","hi":"रियल मिक्स फ्रूट जूस"}',
   null, '{}', true, '{juice}', '2009', 5,
   '{"name":"Dabur India Ltd","address":"Kaushambi, Sahibabad, Ghaziabad 201010"}', '9 months', 1),
  -- bath-body
  ('bath-body','hul','lifebuoy-total-soap','{"en":"Lifebuoy Total 10 Soap","mr":"लाइफबॉय टोटल १० साबण","hi":"लाइफबॉय टोटल 10 साबुन"}',
   null, '{}', null, '{sabun,saban,soap}', '3401', 5,
   '{"name":"Hindustan Unilever Ltd","address":"Unilever House, Andheri (E), Mumbai 400099"}', '36 months', 1),
  -- oral-care
  ('oral-care','colgate','colgate-strong-teeth','{"en":"Colgate Strong Teeth Toothpaste","mr":"कोलगेट स्ट्राँग टीथ टूथपेस्ट","hi":"कोलगेट स्ट्रॉन्ग टीथ टूथपेस्ट"}',
   null, '{}', null, '{toothpaste,colgate}', '3306', 5,
   '{"name":"Colgate-Palmolive (India) Ltd","address":"Hiranandani Gardens, Powai, Mumbai 400076"}', '36 months', 1),
  -- detergents
  ('detergents','hul','surf-excel-easy-wash','{"en":"Surf Excel Easy Wash Powder","mr":"सर्फ एक्सेल इझी वॉश पावडर","hi":"सर्फ़ एक्सेल ईज़ी वॉश पाउडर"}',
   null, '{}', null, '{detergent,surf}', '3402', 18,
   '{"name":"Hindustan Unilever Ltd","address":"Unilever House, Andheri (E), Mumbai 400099"}', '24 months', 1),
  -- cleaners
  ('cleaners','reckitt','harpic-power-plus','{"en":"Harpic Power Plus Toilet Cleaner","mr":"हार्पिक पॉवर प्लस","hi":"हार्पिक पावर प्लस"}',
   null, '{}', null, '{harpic,toilet cleaner}', '3402', 18,
   '{"name":"Reckitt Benckiser (India) Pvt Ltd","address":"DLF Cyber City, Gurugram 122002"}', '36 months', 1)
) as p(sub_slug, brand_slug, slug, name, descr, attrs, veg, tags, hsn, gst, mfr, shelf, ord)
join public.categories c on c.slug = p.sub_slug
left join public.brands b on b.slug = p.brand_slug;

-- ---------- variants (labels generated in EN / MR / HI) ----------
insert into public.product_variants (product_id, sku, barcode, label, net_quantity, unit, mrp, price, max_per_order, is_default, sort_order)
select pr.id, v.sku, v.barcode,
       jsonb_build_object(
         'en', v.qty::text || ' ' || v.unit,
         'mr', translate(v.qty::text, '0123456789', '०१२३४५६७८९') || ' ' ||
               case v.unit when 'g' then 'ग्रॅ' when 'kg' then 'किलो' when 'ml' then 'मिली'
                           when 'l' then 'लि' when 'pc' then 'नग' else 'पॅक' end,
         'hi', v.qty::text || ' ' ||
               case v.unit when 'g' then 'ग्राम' when 'kg' then 'किलो' when 'ml' then 'मिली'
                           when 'l' then 'ली' when 'pc' then 'पीस' else 'पैक' end),
       v.qty, v.unit, v.mrp, v.price, v.maxq, v.def, v.ord
from (values
  ('tomato-local',                'TOM-500',          null,            500, 'g',   30,  22, 5, true,  1),
  ('tomato-local',                'TOM-1KG',          null,              1, 'kg',  60,  42, 5, false, 2),
  ('onion-local',                 'ONION-1KG',        null,              1, 'kg',  45,  36, 5, true,  1),
  ('onion-local',                 'ONION-2KG',        null,              2, 'kg',  90,  68, 3, false, 2),
  ('potato-local',                'POTATO-1KG',       null,              1, 'kg',  40,  32, 5, true,  1),
  ('green-chilli',                'CHILLI-100',       null,            100, 'g',   12,  10, 5, true,  1),
  ('coriander-bunch',             'CORIANDER-1',      null,              1, 'pc',  15,  12, 5, true,  1),
  ('spinach-bunch',               'SPINACH-1',        null,              1, 'pc',  20,  18, 5, true,  1),
  ('banana-robusta',              'BANANA-6',         null,              6, 'pc',  48,  42, 4, true,  1),
  ('apple-shimla',                'APPLE-1KG',        null,              1, 'kg', 180, 159, 3, true,  1),
  ('amul-taaza-toned-milk',       'AMUL-TAAZA-500',   '8901262010016', 500, 'ml',  28,  28, 6, true,  1),
  ('amul-taaza-toned-milk',       'AMUL-TAAZA-1L',    '8901262010023',   1, 'l',   56,  54, 6, false, 2),
  ('amul-gold-full-cream-milk',   'AMUL-GOLD-500',    '8901262010030', 500, 'ml',  34,  34, 6, true,  1),
  ('gokul-cow-milk',              'GOKUL-COW-500',    '8906010500011', 500, 'ml',  30,  29, 6, true,  1),
  ('amul-masti-dahi',             'AMUL-DAHI-400',    '8901262040013', 400, 'g',   35,  33, 4, true,  1),
  ('amul-malai-paneer',           'AMUL-PANEER-200',  '8901262150019', 200, 'g',   95,  90, 4, true,  1),
  ('britannia-white-bread',       'BRIT-BREAD-400',   '8901063091010', 400, 'g',   45,  45, 4, true,  1),
  ('ladi-pav',                    'LADI-PAV-6',       null,              6, 'pc',  30,  30, 4, true,  1),
  ('farm-eggs-white',             'EGGS-6',           null,              6, 'pc',  48,  45, 5, true,  1),
  ('farm-eggs-white',             'EGGS-30',          null,             30, 'pc', 230, 210, 2, false, 2),
  ('aashirvaad-whole-wheat-atta', 'AASH-ATTA-5',      '8901725181222',   5, 'kg', 299, 249, 3, true,  1),
  ('aashirvaad-whole-wheat-atta', 'AASH-ATTA-10',     '8901725181239',  10, 'kg', 570, 489, 2, false, 2),
  ('tata-sampann-besan',          'TATA-BESAN-500',   '8901725016661', 500, 'g',   75,  65, 4, true,  1),
  ('india-gate-basmati-classic',  'IG-BASMATI-1KG',   '8904109400016',   1, 'kg', 245, 199, 3, true,  1),
  ('kolam-rice',                  'KOLAM-5KG',        null,              5, 'kg', 450, 399, 2, true,  1),
  ('tata-sampann-toor-dal',       'TATA-TOOR-1KG',    '8901725132019',   1, 'kg', 210, 179, 3, true,  1),
  ('moong-dal',                   'MOONG-500',        null,            500, 'g',   80,  72, 4, true,  1),
  ('fortune-soyabean-oil',        'FORTUNE-SOYA-1L',  '8906007280014',   1, 'l',  165, 139, 4, true,  1),
  ('saffola-gold-oil',            'SAFFOLA-GOLD-1L',  '8901088060015',   1, 'l',  215, 189, 4, true,  1),
  ('everest-turmeric-powder',     'EVEREST-HALDI-100','8901786100014', 100, 'g',   38,  34, 5, true,  1),
  ('mdh-garam-masala',            'MDH-GARAM-100',    '8902167000010', 100, 'g',   92,  85, 5, true,  1),
  ('tata-salt',                   'TATA-SALT-1KG',    '8904043901015',   1, 'kg',  28,  28, 5, true,  1),
  ('sugar-loose',                 'SUGAR-1KG',        null,              1, 'kg',  48,  44, 5, true,  1),
  ('cashew-w320',                 'KAJU-250',         null,            250, 'g',  320, 279, 3, true,  1),
  ('parle-g-gold',                'PARLEG-GOLD-100',  '8901719110016', 100, 'g',   10,  10,12, true,  1),
  ('britannia-good-day-butter',   'GOODDAY-200',      '8901063010011', 200, 'g',   40,  38, 6, true,  1),
  ('haldirams-aloo-bhujia',       'HALDI-BHUJIA-400', '8904004400014', 400, 'g',  110,  99, 4, true,  1),
  ('lays-classic-salted',         'LAYS-CLASSIC-52',  '8901491101011',  52, 'g',   20,  20,10, true,  1),
  ('coca-cola-original',          'COKE-750',         '8901764012013', 750, 'ml',  40,  40, 6, true,  1),
  ('coca-cola-original',          'COKE-2L',          '8901764012020',   2, 'l',   99,  95, 4, false, 2),
  ('real-mixed-fruit-juice',      'REAL-MIXED-1L',    '8901207000017',   1, 'l',  130, 115, 4, true,  1),
  ('lifebuoy-total-soap',         'LIFEBUOY-4X100',   '8901030700013',   4, 'pack', 160, 139, 4, true, 1),
  ('colgate-strong-teeth',        'COLGATE-ST-200',   '8901314010018', 200, 'g',  125, 110, 4, true,  1),
  ('surf-excel-easy-wash',        'SURF-EW-1KG',      '8901030500019',   1, 'kg', 145, 135, 4, true,  1),
  ('harpic-power-plus',           'HARPIC-PP-500',    '8901396300015', 500, 'ml', 112, 104, 4, true,  1)
) as v(slug, sku, barcode, qty, unit, mrp, price, maxq, def, ord)
join public.products pr on pr.slug = v.slug;

-- ---------- stock for every variant ----------
insert into public.inventory (store_id, variant_id, stock, low_stock_threshold)
select public.default_store_id(), v.id,
       case v.sku when 'AASH-ATTA-10'  then 0     -- out of stock: test "Notify me"
                  when 'APPLE-1KG'     then 0
                  when 'AMUL-TAAZA-1L' then 3     -- low stock badge
                  when 'KAJU-250'      then 2
                  else 20 + (v.id * 7) % 60 end,
       5
from public.product_variants v
on conflict do nothing;

insert into public.inventory_movements (store_id, variant_id, delta, reason, note)
select i.store_id, i.variant_id, i.stock, 'initial', 'seed'
from public.inventory i where i.stock > 0;

-- ---------- merchandising ----------
insert into public.collections (slug, title) values
  ('bestsellers', '{"en":"Bestsellers","mr":"सर्वाधिक विक्री","hi":"बेस्टसेलर"}'),
  ('diwali-specials', '{"en":"Diwali Specials","mr":"दिवाळी स्पेशल","hi":"दिवाली स्पेशल"}');

insert into public.collection_products (collection_id, product_id, sort_order)
select (select id from public.collections where slug = 'bestsellers'), p.id, x.ord
from unnest(array['amul-taaza-toned-milk','aashirvaad-whole-wheat-atta','tomato-local','onion-local',
                  'parle-g-gold','fortune-soyabean-oil','tata-salt','farm-eggs-white',
                  'britannia-white-bread','surf-excel-easy-wash']) with ordinality as x(slug, ord)
join public.products p on p.slug = x.slug;

insert into public.collection_products (collection_id, product_id, sort_order)
select (select id from public.collections where slug = 'diwali-specials'), p.id, x.ord
from unnest(array['cashew-w320','haldirams-aloo-bhujia','sugar-loose','tata-sampann-besan',
                  'saffola-gold-oil','coca-cola-original']) with ordinality as x(slug, ord)
join public.products p on p.slug = x.slug;

insert into public.banners (store_id, image_path, title, link, sort_order) values
 (public.default_store_id(), 'banners/fresh-veggies.webp',
  '{"en":"Fresh vegetables every morning","mr":"दररोज सकाळी ताज्या भाज्या","hi":"हर सुबह ताज़ी सब्ज़ियाँ"}',
  '{"type":"category","value":"fresh-vegetables"}', 1),
 (public.default_store_id(), 'banners/diwali.webp',
  '{"en":"Diwali specials","mr":"दिवाळी स्पेशल","hi":"दिवाली स्पेशल"}',
  '{"type":"collection","value":"diwali-specials"}', 2);

insert into public.home_sections (store_id, type, title, config, sort_order) values
 (public.default_store_id(), 'banner_carousel', null, '{}', 1),
 (public.default_store_id(), 'buy_again', '{"en":"Buy again","mr":"पुन्हा खरेदी करा","hi":"फिर से खरीदें"}', '{}', 2),
 (public.default_store_id(), 'category_grid', '{"en":"Shop by category","mr":"श्रेणीनुसार खरेदी","hi":"श्रेणी के अनुसार"}', '{"columns":4}', 3),
 (public.default_store_id(), 'product_rail', '{"en":"Bestsellers","mr":"सर्वाधिक विक्री","hi":"बेस्टसेलर"}',
   jsonb_build_object('collection_id', (select id from public.collections where slug = 'bestsellers')), 4),
 (public.default_store_id(), 'product_rail', '{"en":"Fresh vegetables","mr":"ताज्या भाज्या","hi":"ताज़ी सब्ज़ियाँ"}',
   jsonb_build_object('category_id', (select id from public.categories where slug = 'fruits-vegetables'), 'sort', 'discount'), 5),
 (public.default_store_id(), 'collection_rail', '{"en":"Diwali specials","mr":"दिवाळी स्पेशल","hi":"दिवाली स्पेशल"}',
   jsonb_build_object('collection_id', (select id from public.collections where slug = 'diwali-specials')), 6);

-- ---------- search synonyms ----------
insert into public.search_synonyms (term, maps_to) values
  -- Latin-script Marathi/Hindi → catalog English
  ('doodh','milk'), ('dudh','milk'), ('dahi','curd'), ('anda','egg'), ('ande','egg'), ('andi','egg'),
  ('kanda','onion'), ('pyaz','onion'), ('pyaaz','onion'), ('batata','potato'), ('aloo','potato'), ('alu','potato'),
  ('tamatar','tomato'), ('tameta','tomato'), ('mirchi','chilli'), ('kothimbir','coriander'), ('dhaniya','coriander'),
  ('aata','atta'), ('ata','atta'), ('gehu','wheat'), ('chawal','rice'), ('tandul','rice'),
  ('sakhar','sugar'), ('chini','sugar'), ('cheeni','sugar'), ('tel','oil'), ('namak','salt'), ('meeth','salt'),
  ('haldi','turmeric'), ('halad','turmeric'), ('jeera','cumin'), ('jira','cumin'), ('sabun','soap'),
  ('biskit','biscuit'), ('biscut','biscuit'), ('chai','tea'), ('chaha','tea'), ('paav','pav'), ('double roti','bread'),
  -- Devanagari words that may not appear in a product's own name
  ('दूध','milk'), ('कांदा','onion'), ('प्याज','onion'), ('बटाटा','potato'), ('आलू','potato'),
  ('साखर','sugar'), ('चीनी','sugar'), ('तेल','oil'), ('साबण','soap'), ('साबुन','soap'), ('चहा','tea'), ('चाय','tea')
on conflict do nothing;

insert into public.app_config (key, value) values
  ('trending_searches', '["milk","atta","onion","biscuits","oil","eggs","bread","sugar"]')
on conflict (key) do update set value = excluded.value;

-- Pincodes the store delivers to (addresses saved without GPS are checked against these).
update public.stores set serviceable_pincodes = array['444601','444602','444603','444604','444605','444606','444607']
 where city = 'Amravati' and serviceable_pincodes = '{}';
