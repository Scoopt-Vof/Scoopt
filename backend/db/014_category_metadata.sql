-- Scoopt back end — schema v14: category display metadata lives on the tree.
--
-- The blurb, icon and "what you'll typically need" list for each category were
-- hardcoded in src/api/contract-queries.ts (CATEGORY_META / SUBCATEGORY_META),
-- duplicating the names seeded in 007_category_tree.sql. That meant the tree
-- endpoints could not return them, so the front end could not move onto the
-- tree without losing them, and the names could drift between the two copies.
--
-- The seed below is a one-time copy of those constants. It only fills values
-- that are still NULL, so an edit made in the database is never overwritten.
--
-- Safe to re-run.

begin;

alter table category add column if not exists blurb      text;
alter table category add column if not exists icon       text;
alter table category add column if not exists essentials text[] not null default '{}';

update category c
   set blurb = coalesce(c.blurb, v.blurb),
       icon  = coalesce(c.icon, v.icon),
       essentials = case when c.essentials = '{}' then v.essentials else c.essentials end
  from (values
    ('sport', 'Find the right gear for the sport you actually do, with every store’s price side by side.', null, '{}'::text[]),
    ('home',  'Furnish every room and compare the same sofa, table or lamp across every store.',          null, '{}'::text[]),
    ('tech',  'See what a phone, laptop or TV really costs across every major store.',                     null, '{}'::text[]),

    ('sport/running',        null, 'shoe',      array['Running shoes', 'GPS watch', 'Running socks', 'Heart rate monitor']),
    ('sport/cycling',        null, 'bike',      array['Bike', 'Helmet', 'Cycling shorts', 'Lights']),
    ('sport/hiking-outdoor', null, 'mountain',  array['Hiking boots', 'Backpack', 'Rain shell', 'Trekking poles']),
    ('sport/fitness-gym',    null, 'dumbbell',  array['Training shoes', 'Dumbbells', 'Fitness mat', 'Resistance bands']),
    ('sport/swimming',       null, 'waves',     array['Swimsuit', 'Goggles', 'Swim cap', 'Fins']),
    ('sport/team-sports',    null, 'ball',      array['Boots', 'Shin guards', 'Match ball', 'Kit bag']),
    ('sport/racket-sports',  null, 'racket',    array['Racket', 'Balls', 'Court shoes', 'Grip tape']),
    ('sport/winter-sports',  null, 'snowflake', array['Skis or board', 'Boots', 'Goggles', 'Thermal layers']),

    ('home/furniture',       null, 'sofa',      array['Sofa', 'Dining table', 'Chairs', 'Bookshelf']),
    ('home/kitchen-dining',  null, 'plate',     array['Cookware set', 'Dinner plates', 'Cutlery', 'Stand mixer']),
    ('home/bedroom',         null, 'bed',       array['Bed frame', 'Mattress', 'Wardrobe', 'Bedside table']),
    ('home/lighting',        null, 'lamp',      array['Floor lamp', 'Pendant light', 'Table lamp', 'Smart bulbs']),
    ('home/home-decor',      null, 'frame',     array['Wall art', 'Cushions', 'Rugs', 'Mirrors']),
    ('home/storage',         null, 'box',       array['Shelving unit', 'Storage boxes', 'Closet organiser', 'Baskets']),
    ('home/home-textiles',   null, 'blanket',   array['Duvet set', 'Curtains', 'Towels', 'Throws']),
    ('home/garden-outdoor',  null, 'plant',     array['Garden furniture', 'Parasol', 'BBQ', 'Planters']),

    ('tech/smartphones',       null, 'phone',      array['Phone', 'Case', 'Screen protector', 'Charger']),
    ('tech/laptops-computers', null, 'laptop',     array['Laptop', 'Mouse', 'Monitor', 'Backpack']),
    ('tech/wearables',         null, 'watch',      array['Smartwatch', 'Fitness band', 'Charging dock', 'Strap']),
    ('tech/audio-headphones',  null, 'headphones', array['Headphones', 'Earbuds', 'Speaker', 'DAC']),
    ('tech/tv-video',          null, 'tv',         array['Television', 'Soundbar', 'Streaming stick', 'Wall mount']),
    ('tech/cameras',           null, 'camera',     array['Camera body', 'Lens', 'Memory card', 'Tripod']),
    ('tech/gaming',            null, 'gamepad',    array['Console', 'Controller', 'Headset', 'Games']),
    ('tech/home-appliances',   null, 'appliance',  array['Vacuum cleaner', 'Air fryer', 'Coffee machine', 'Blender'])
  ) as v(path, blurb, icon, essentials)
 where c.path = v.path;

commit;
