-- ============================================================
-- Living Mood — جدول الاستفسارات (inquiries)
-- شغّل الملف ده مرة واحدة بس من: Supabase → SQL Editor → New query → Paste → Run
-- بيسجّل: دوسات واتساب، دوسات الاتصال، طلبات السعر من الفورم، ومشاهدات المنتجات
-- وكمان بيضيف للمنتجات خانتين: "متوفر" و"يتعرض في الكاتلوج" (زراير في الأدمن)
-- آمن تشغّله أكتر من مرة (لو كنت شغّلت نسخة قديمة، شغّل دي تاني وهتكمّل الناقص)
-- ============================================================

create table if not exists public.inquiries (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  type           text not null check (type in ('whatsapp', 'call', 'form', 'view')),
  product_id     text,
  product_name   text,
  category_name  text,
  customer_name  text,
  customer_phone text,
  customer_email text,
  customer_address text,
  message        text,
  page           text,
  status         text not null default 'new' check (status in ('new', 'contacted', 'done')),
  note           text
);

-- لو الجدول كان متعمل بنسخة قديمة
alter table public.inquiries add column if not exists customer_email   text;
alter table public.inquiries add column if not exists customer_address text;

create index if not exists inquiries_created_at_idx on public.inquiries (created_at desc);
create index if not exists inquiries_type_idx on public.inquiries (type);

alter table public.inquiries enable row level security;

-- زوار الموقع: يقدروا يضيفوا استفسار جديد بس (مايقدروش يقروا أو يعدّلوا)
drop policy if exists "public can insert inquiries" on public.inquiries;
create policy "public can insert inquiries"
  on public.inquiries for insert
  to anon, authenticated
  with check (
    status = 'new'
    and note is null
    and coalesce(length(product_name), 0)   <= 200
    and coalesce(length(category_name), 0)  <= 120
    and coalesce(length(customer_name), 0)  <= 80
    and coalesce(length(customer_phone), 0) <= 20
    and coalesce(length(customer_email), 0) <= 120
    and coalesce(length(customer_address), 0) <= 300
    and coalesce(length(message), 0)        <= 600
    and coalesce(length(page), 0)           <= 300
  );

-- الأدمن (مسجّل دخول): يقرأ ويعدّل ويمسح
drop policy if exists "admin can read inquiries" on public.inquiries;
create policy "admin can read inquiries"
  on public.inquiries for select to authenticated using (true);

drop policy if exists "admin can update inquiries" on public.inquiries;
create policy "admin can update inquiries"
  on public.inquiries for update to authenticated using (true) with check (true);

drop policy if exists "admin can delete inquiries" on public.inquiries;
create policy "admin can delete inquiries"
  on public.inquiries for delete to authenticated using (true);

grant insert on public.inquiries to anon;
grant select, insert, update, delete on public.inquiries to authenticated;

-- ============================================================
-- المنتجات: متوفر آه/لا + يتعرض آه/لا
-- ============================================================
alter table public.products add column if not exists is_available boolean not null default true;
alter table public.products add column if not exists is_visible   boolean not null default true;

-- يتعرض آه/لا للتصنيفات والفريق والفيديوهات
alter table public.categories      add column if not exists is_visible boolean not null default true;
alter table public.team_members    add column if not exists is_visible boolean not null default true;
alter table public.portfolio_items add column if not exists is_visible boolean not null default true;

-- ============================================================
-- ⚡ تحديث لحظي: أي تعديل من الأدمن يوصل للزوار فورًا (Supabase Realtime)
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array['products','categories','team_members','portfolio_items','site_settings'] loop
    if exists (select 1 from pg_tables where schemaname = 'public' and tablename = t)
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- تحديث الـ API عشان يشوف الخانات الجديدة فورًا
notify pgrst, 'reload schema';
