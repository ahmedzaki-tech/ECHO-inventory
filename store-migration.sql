-- ============================================================
-- سكريبت توسيع قاعدة بيانات "صدى للعطور" لدعم متجر العملاء
-- شغّله كامل في Supabase SQL Editor (نفس مشروع ECHO-Perfumes الحالي)
-- آمن يتشغّل أكتر من مرة (كل الأوامر تتحقق قبل ما تنفّذ)
-- ============================================================

-- ---------- 1. جدول الموظفين (staff) لتمييزهم عن العملاء ----------
create table if not exists staff_emails (
  email text primary key
);
insert into staff_emails (email) values
  ('ahmedzaki9814@gmail.com'),
  ('sarahsaeed474@gmail.com')
on conflict (email) do nothing;

-- دالة مساعدة: هل المستخدم الحالي موظف؟
create or replace function is_staff() returns boolean as $$
  select exists (
    select 1 from staff_emails where email = auth.jwt() ->> 'email'
  );
$$ language sql stable;

-- ---------- 2. توسيع جدول الأصناف (items) ليدعم عرضها في المتجر ----------
alter table items add column if not exists description text default '';
alter table items add column if not exists images jsonb default '[]'::jsonb;
alter table items add column if not exists category text default '';
alter table items add column if not exists slug text;
alter table items add column if not exists is_active boolean default false;
alter table items add column if not exists rating_avg numeric default 0;
alter table items add column if not exists rating_count integer default 0;

-- ---------- 3. جدول الفئات ----------
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  sort_order integer default 0,
  created_at timestamptz default now()
);

insert into categories (name, slug, sort_order) values
  ('عطور رجالي', 'men', 1),
  ('عطور حريمي', 'women', 2),
  ('عود ومسك', 'oud', 3),
  ('أطقم هدايا', 'gifts', 4)
on conflict (slug) do nothing;

-- ---------- 4. ملفات تعريف العملاء ----------
create table if not exists customer_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text default '',
  phone text default '',
  created_at timestamptz default now()
);

-- ---------- 5. عناوين العملاء ----------
create table if not exists addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references auth.users(id) on delete cascade,
  label text default 'المنزل',
  full_address text not null,
  city text not null,
  phone text not null,
  is_default boolean default false,
  created_at timestamptz default now()
);

-- ---------- 6. المفضلة ----------
create table if not exists favorites (
  customer_id uuid references auth.users(id) on delete cascade,
  item_id uuid references items(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (customer_id, item_id)
);

-- ---------- 7. تقييمات العملاء ----------
create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references items(id) on delete cascade,
  customer_id uuid references auth.users(id) on delete set null,
  customer_name text default 'عميل',
  rating integer check (rating between 1 and 5),
  comment text default '',
  created_at timestamptz default now()
);

-- ---------- 8. توسيع جدول الطلبات (orders) لدعم الطلبات الأونلاين ----------
alter table orders add column if not exists source text default 'staff'; -- 'staff' أو 'online'
alter table orders add column if not exists customer_id uuid references auth.users(id) on delete set null;
alter table orders add column if not exists payment_method text default 'cod'; -- 'cod' أو 'fawry'
alter table orders add column if not exists payment_status text default 'pending'; -- pending / paid / failed
alter table orders add column if not exists shipping_address text default '';
alter table orders add column if not exists shipping_phone text default '';
alter table orders add column if not exists shipping_city text default '';
alter table orders add column if not exists bosta_tracking_number text;
alter table orders add column if not exists fawry_reference text;

-- ============================================================
-- الحماية (Row Level Security)
-- ============================================================
alter table categories enable row level security;
alter table customer_profiles enable row level security;
alter table addresses enable row level security;
alter table favorites enable row level security;
alter table reviews enable row level security;

-- الأصناف: أي حد (حتى بدون تسجيل دخول) يقدر يشوف الأصناف المفعّلة للعرض في المتجر
drop policy if exists "public read active items" on items;
create policy "public read active items" on items for select
  using (is_active = true or is_staff());

-- الفئات: قراءة عامة، تعديل للموظفين فقط
drop policy if exists "public read categories" on categories;
create policy "public read categories" on categories for select using (true);
drop policy if exists "staff write categories" on categories;
create policy "staff write categories" on categories for all
  using (is_staff()) with check (is_staff());

-- ملفات العملاء: كل عميل يشوف ويعدّل بياناته فقط، الموظفين يشوفوا الكل
drop policy if exists "customer own profile" on customer_profiles;
create policy "customer own profile" on customer_profiles for all
  using (id = auth.uid() or is_staff()) with check (id = auth.uid() or is_staff());

-- العناوين: نفس المبدأ
drop policy if exists "customer own addresses" on addresses;
create policy "customer own addresses" on addresses for all
  using (customer_id = auth.uid() or is_staff()) with check (customer_id = auth.uid() or is_staff());

-- المفضلة: نفس المبدأ
drop policy if exists "customer own favorites" on favorites;
create policy "customer own favorites" on favorites for all
  using (customer_id = auth.uid() or is_staff()) with check (customer_id = auth.uid() or is_staff());

-- التقييمات: أي حد يقرأ، أي عميل مسجّل يضيف تقييم، الموظفين يقدروا يحذفوا
drop policy if exists "public read reviews" on reviews;
create policy "public read reviews" on reviews for select using (true);
drop policy if exists "customer add review" on reviews;
create policy "customer add review" on reviews for insert
  with check (customer_id = auth.uid());
drop policy if exists "staff delete reviews" on reviews;
create policy "staff delete reviews" on reviews for delete using (is_staff());

-- الطلبات: تحديث السياسة الحالية لتفرّق بين الموظف والعميل
drop policy if exists "team full access orders" on orders;
drop policy if exists "staff full access orders" on orders;
create policy "staff full access orders" on orders for all
  using (is_staff()) with check (is_staff());
drop policy if exists "customer own orders" on orders;
create policy "customer own orders" on orders for select
  using (customer_id = auth.uid());
drop policy if exists "customer create own order" on orders;
create policy "customer create own order" on orders for insert
  with check (customer_id = auth.uid() and source = 'online');

-- order_items: تحديث السياسة لتسمح للعميل يشوف أصناف طلباته هو بس
drop policy if exists "team full access order_items" on order_items;
drop policy if exists "staff full access order_items" on order_items;
create policy "staff full access order_items" on order_items for all
  using (is_staff()) with check (is_staff());
drop policy if exists "customer read own order_items" on order_items;
create policy "customer read own order_items" on order_items for select
  using (exists (select 1 from orders o where o.id = order_items.order_id and o.customer_id = auth.uid()));
drop policy if exists "customer insert own order_items" on order_items;
create policy "customer insert own order_items" on order_items for insert
  with check (exists (select 1 from orders o where o.id = order_items.order_id and o.customer_id = auth.uid()));

-- تفعيل التزامن اللحظي على الجداول الجديدة
-- ملحوظة: لو ظهر خطأ "already a member of publication" على السطرين دول، تجاهله — معناه إنه اتفعّل قبل كده بالفعل
alter publication supabase_realtime add table categories;
alter publication supabase_realtime add table reviews;
