-- Teknik Satınalma Talebi — şema, yetkiler ve iş akışı
-- Tüm durum geçişleri aşağıdaki fonksiyonlar üzerinden yapılır; tablolara
-- istemciden doğrudan yazma izni yoktur (ana veriler hariç, onlar yalnızca admin).

create type public.user_role as enum
  ('technician', 'buyer', 'plant_manager', 'general_manager', 'admin');

create type public.request_status as enum (
  'pending_approval',   -- Fabrika Müdürü talep onayında
  'sourcing',           -- Satınalma teklif topluyor
  'purchase_approval',  -- Fabrika Müdürü alım kararında
  'gm_approval',        -- Genel Müdür alım kararında
  'approved',           -- Alım onaylandı, sipariş açılabilir
  'ordered',            -- Sipariş verildi
  'delivered',          -- Teslim edildi
  'rejected',           -- Reddedildi
  'cancelled'           -- Talep sahibi iptal etti
);

create type public.urgency_level as enum ('normal', 'high', 'critical');

-- ───────────────────────── Ana veriler ─────────────────────────

create table public.factories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  -- Bu tutarın üzerindeki talepler Fabrika Müdürü talep onayına gider
  request_approval_limit numeric(14,2) not null default 1500 check (request_approval_limit >= 0),
  -- Bu tutarın üzerindeki alımlar Genel Müdür onayına yükselir
  gm_approval_limit numeric(14,2) not null default 100000 check (gm_approval_limit >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.cost_centers (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete cascade,
  code text not null,
  name text not null,
  active boolean not null default true,
  unique (factory_id, code)
);

create table public.equipment (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id) on delete cascade,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  name text not null,
  active boolean not null default true,
  unique (factory_id, name)
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  role public.user_role not null default 'technician',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.profile_factories (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  factory_id uuid not null references public.factories(id) on delete cascade,
  primary key (profile_id, factory_id)
);

create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  unit text not null default 'adet',
  last_price numeric(14,2) check (last_price is null or last_price >= 0),
  barcode text,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
create index catalog_items_barcode_idx on public.catalog_items (barcode);

create table public.stock_levels (
  item_id uuid not null references public.catalog_items(id) on delete cascade,
  factory_id uuid not null references public.factories(id) on delete cascade,
  quantity numeric(14,3) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (item_id, factory_id)
);

-- ───────────────────────── Talepler ─────────────────────────

create sequence public.request_code_seq start 1001;

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  factory_id uuid not null references public.factories(id),
  cost_center_id uuid not null references public.cost_centers(id),
  equipment_id uuid references public.equipment(id),
  requester_id uuid not null references public.profiles(id),
  urgency public.urgency_level not null default 'normal',
  needed_by date not null,
  note text not null default '',
  status public.request_status not null,
  estimated_total numeric(14,2) not null default 0,
  selected_quote_id uuid,
  po_number text,
  eta date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index requests_factory_status_idx on public.requests (factory_id, status);
create index requests_requester_idx on public.requests (requester_id);

create table public.request_lines (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  item_id uuid references public.catalog_items(id),
  sku text,
  description text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit text not null,
  est_unit_price numeric(14,2) not null check (est_unit_price >= 0)
);
create index request_lines_request_idx on public.request_lines (request_id);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  supplier_name text not null,
  total numeric(14,2) not null check (total > 0),  -- talebin tamamı için toplam tutar
  lead_days integer check (lead_days is null or lead_days >= 0),
  note text not null default '',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index quotes_request_idx on public.quotes (request_id);

alter table public.requests
  add constraint requests_selected_quote_fk
  foreign key (selected_quote_id) references public.quotes(id) on delete set null;

create table public.request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.requests(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  kind text not null,
  message text not null,
  created_at timestamptz not null default now()
);
create index request_events_request_idx on public.request_events (request_id, created_at);

create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid references public.requests(id) on delete cascade,
  title text not null,
  body text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- ───────────────────────── Yardımcılar ─────────────────────────

create function public.my_role() returns public.user_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid()) and active
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() = 'admin', false)
$$;

create function public.is_member(p_factory uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profile_factories
    where profile_id = (select auth.uid()) and factory_id = p_factory
  )
$$;

create function public.can_see_request(p_requester uuid, p_factory uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case public.my_role()
    when 'admin' then true
    when 'general_manager' then true
    when 'buyer' then public.is_member(p_factory)
    when 'plant_manager' then public.is_member(p_factory)
    when 'technician' then p_requester = (select auth.uid())
    else false
  end
$$;

-- Yeni auth kullanıcısı için profil. İlk kullanıcı admin olur (kurulum).
-- Sonraki herkes pasif teknisyen olarak başlar; rolü ve aktifliği yönetici
-- verir (uygulamadaki kullanıcı ekleme bunu tek adımda yapar). Böylece kendi
-- kendine kayıt olan biri, kayıt açık bırakılmış olsa bile hiçbir veriyi göremez.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_first boolean := not exists (select 1 from public.profiles);
begin
  insert into public.profiles (id, email, full_name, role, active)
  values (
    new.id, coalesce(new.email, ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(new.email, ''), '@', 1)),
    case when v_first then 'admin' else 'technician' end::public.user_role,
    v_first);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public._log(p_request uuid, p_kind text, p_message text) returns void
language sql security definer set search_path = '' as $$
  insert into public.request_events (request_id, actor_id, kind, message)
  values (p_request, (select auth.uid()), p_kind, p_message)
$$;

-- Bir talep için belirli roldeki fabrika üyelerine (GM için herkese) bildirim
create function public._notify_role(p_request uuid, p_role public.user_role, p_title text, p_body text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, request_id, title, body)
  select p.id, r.id, p_title, p_body
  from public.requests r
  join public.profiles p on p.role = p_role and p.active
  where r.id = p_request
    and p.id <> coalesce((select auth.uid()), '00000000-0000-0000-0000-000000000000')
    and (p_role = 'general_manager' or exists (
      select 1 from public.profile_factories pf
      where pf.profile_id = p.id and pf.factory_id = r.factory_id))
$$;

create function public._notify_user(p_request uuid, p_user uuid, p_title text, p_body text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, request_id, title, body)
  select p_user, p_request, p_title, p_body
  where p_user <> coalesce((select auth.uid()), '00000000-0000-0000-0000-000000000000')
$$;

create function public._money(p numeric) returns text
language sql immutable set search_path = '' as $$
  -- Türkçe biçim: 3.365,50 — kuruşsuz tutarlarda ",00" atılır
  select '₺' || regexp_replace(
    translate(to_char(p, 'FM999,999,999,990.00'), ',.', '.,'), ',00$', '')
$$;

-- ───────────────────────── İş akışı ─────────────────────────

-- p_lines: [{item_id?, sku?, description, quantity, unit, est_unit_price}]
create function public.create_request(
  p_factory uuid, p_cost_center uuid, p_equipment uuid,
  p_urgency public.urgency_level, p_needed_by date, p_note text, p_lines jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.user_role := public.my_role();
  v_factory public.factories;
  v_id uuid;
  v_code text;
  v_total numeric(14,2);
  v_status public.request_status;
begin
  if v_role is null then raise exception 'Oturum bulunamadı'; end if;
  if v_role <> 'admin' and not public.is_member(p_factory) then
    raise exception 'Bu fabrika için talep açma yetkiniz yok';
  end if;
  select * into v_factory from public.factories where id = p_factory and active;
  if not found then raise exception 'Fabrika bulunamadı'; end if;
  if not exists (select 1 from public.cost_centers
                 where id = p_cost_center and factory_id = p_factory and active) then
    raise exception 'Maliyet merkezi bu fabrikaya ait değil';
  end if;
  if p_equipment is not null and not exists (
      select 1 from public.equipment where id = p_equipment and factory_id = p_factory) then
    raise exception 'Ekipman bu fabrikaya ait değil';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'En az bir malzeme kalemi gerekli';
  end if;
  if p_needed_by is null then raise exception 'İhtiyaç tarihi gerekli'; end if;

  v_code := 'TLP-' || nextval('public.request_code_seq');
  insert into public.requests
    (code, factory_id, cost_center_id, equipment_id, requester_id, urgency, needed_by, note, status)
  values
    (v_code, p_factory, p_cost_center, p_equipment, (select auth.uid()),
     coalesce(p_urgency, 'normal'), p_needed_by, coalesce(p_note, ''), 'sourcing')
  returning id into v_id;

  insert into public.request_lines (request_id, item_id, sku, description, quantity, unit, est_unit_price)
  select v_id,
         nullif(l ->> 'item_id', '')::uuid,
         nullif(l ->> 'sku', ''),
         l ->> 'description',
         (l ->> 'quantity')::numeric,
         coalesce(nullif(l ->> 'unit', ''), 'adet'),
         coalesce((l ->> 'est_unit_price')::numeric, 0)
  from jsonb_array_elements(p_lines) l;

  select coalesce(sum(round(quantity * est_unit_price, 2)), 0) into v_total
  from public.request_lines where request_id = v_id;

  v_status := case when v_total > v_factory.request_approval_limit
                   then 'pending_approval' else 'sourcing' end;
  update public.requests set estimated_total = v_total, status = v_status where id = v_id;

  perform public._log(v_id, 'created', 'Talep oluşturuldu · tahmini ' || public._money(v_total));
  if v_status = 'pending_approval' then
    perform public._notify_role(v_id, 'plant_manager', v_code || ' talep onayınızı bekliyor',
      'Tahmini tutar ' || public._money(v_total));
  else
    perform public._log(v_id, 'auto_routed', 'Limit altında — doğrudan satınalmaya düştü');
    perform public._notify_role(v_id, 'buyer', v_code || ' satınalma masasına düştü',
      'Tahmini tutar ' || public._money(v_total));
  end if;
  return v_id;
end $$;

-- Fabrika Müdürü talep onayı
create function public.decide_request(p_request uuid, p_decision text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.requests;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into r from public.requests where id = p_request for update;
  if not found then raise exception 'Talep bulunamadı'; end if;
  if not (public.my_role() = 'plant_manager' and public.is_member(r.factory_id)) then
    raise exception 'Bu talebi onaylama yetkiniz yok';
  end if;
  if r.status <> 'pending_approval' then raise exception 'Talep onay aşamasında değil'; end if;

  if p_decision = 'approve' then
    update public.requests set status = 'sourcing', updated_at = now() where id = p_request;
    perform public._log(p_request, 'request_approved',
      'Fabrika Müdürü talebi onayladı' || coalesce(': ' || v_note, ''));
    perform public._notify_role(p_request, 'buyer', r.code || ' satınalma masasına düştü', coalesce(v_note, ''));
    perform public._notify_user(p_request, r.requester_id, r.code || ' talebiniz onaylandı', coalesce(v_note, ''));
  elsif p_decision = 'reject' then
    if v_note is null then raise exception 'Ret için karar notu gerekli'; end if;
    update public.requests set status = 'rejected', updated_at = now() where id = p_request;
    perform public._log(p_request, 'request_rejected', 'Fabrika Müdürü talebi reddetti: ' || v_note);
    perform public._notify_user(p_request, r.requester_id, r.code || ' talebiniz reddedildi', v_note);
  else
    raise exception 'Geçersiz karar';
  end if;
end $$;

create function public._assert_buyer(r public.requests) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.my_role() = 'buyer' and public.is_member(r.factory_id)) then
    raise exception 'Bu işlem için satınalma yetkisi gerekli';
  end if;
end $$;

create function public.add_quote(
  p_request uuid, p_supplier text, p_total numeric, p_lead_days integer, p_note text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  r public.requests;
  v_id uuid;
begin
  select * into r from public.requests where id = p_request for update;
  if not found then raise exception 'Talep bulunamadı'; end if;
  perform public._assert_buyer(r);
  if r.status <> 'sourcing' then raise exception 'Talep teklif toplama aşamasında değil'; end if;
  if nullif(btrim(coalesce(p_supplier, '')), '') is null then raise exception 'Tedarikçi adı gerekli'; end if;
  if p_total is null or p_total <= 0 then raise exception 'Teklif tutarı sıfırdan büyük olmalı'; end if;

  insert into public.quotes (request_id, supplier_name, total, lead_days, note, created_by)
  values (p_request, btrim(p_supplier), p_total, p_lead_days, coalesce(p_note, ''), (select auth.uid()))
  returning id into v_id;
  perform public._log(p_request, 'quote_added',
    'Teklif eklendi: ' || btrim(p_supplier) || ' · ' || public._money(p_total));
  return v_id;
end $$;

create function public.delete_quote(p_quote uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  q public.quotes;
  r public.requests;
begin
  select * into q from public.quotes where id = p_quote;
  if not found then raise exception 'Teklif bulunamadı'; end if;
  select * into r from public.requests where id = q.request_id for update;
  perform public._assert_buyer(r);
  if r.status <> 'sourcing' then raise exception 'Talep teklif toplama aşamasında değil'; end if;
  delete from public.quotes where id = p_quote;
  perform public._log(r.id, 'quote_removed', 'Teklif silindi: ' || q.supplier_name);
end $$;

-- Satınalma: tedarikçi seç ve alım kararına gönder
create function public.submit_purchase(p_request uuid, p_quote uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.requests;
  q public.quotes;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into r from public.requests where id = p_request for update;
  if not found then raise exception 'Talep bulunamadı'; end if;
  perform public._assert_buyer(r);
  if r.status <> 'sourcing' then raise exception 'Talep teklif toplama aşamasında değil'; end if;
  select * into q from public.quotes where id = p_quote and request_id = p_request;
  if not found then raise exception 'Seçilen teklif bu talebe ait değil'; end if;

  update public.requests
     set status = 'purchase_approval', selected_quote_id = p_quote, updated_at = now()
   where id = p_request;
  perform public._log(p_request, 'purchase_submitted',
    'Tedarikçi seçildi (' || q.supplier_name || ' · ' || public._money(q.total) ||
    ') ve alım kararına gönderildi' || coalesce(': ' || v_note, ''));
  perform public._notify_role(p_request, 'plant_manager', r.code || ' alım kararınızı bekliyor',
    q.supplier_name || ' · ' || public._money(q.total));
end $$;

-- Fabrika Müdürü / Genel Müdür alım kararı: approve | reject | revise
create function public.decide_purchase(p_request uuid, p_decision text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.requests;
  q public.quotes;
  f public.factories;
  v_role public.user_role := public.my_role();
  v_who text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into r from public.requests where id = p_request for update;
  if not found then raise exception 'Talep bulunamadı'; end if;
  select * into f from public.factories where id = r.factory_id;
  select * into q from public.quotes where id = r.selected_quote_id;

  if r.status = 'purchase_approval' then
    if not (v_role = 'plant_manager' and public.is_member(r.factory_id)) then
      raise exception 'Bu alım kararı Fabrika Müdürüne ait';
    end if;
    v_who := 'Fabrika Müdürü';
  elsif r.status = 'gm_approval' then
    if v_role is distinct from 'general_manager' then
      raise exception 'Bu alım kararı Genel Müdüre ait';
    end if;
    v_who := 'Genel Müdür';
  else
    raise exception 'Talep alım kararı aşamasında değil';
  end if;
  if q.id is null then raise exception 'Seçili teklif bulunamadı'; end if;

  if p_decision = 'approve' then
    if r.status = 'purchase_approval' and q.total > f.gm_approval_limit then
      update public.requests set status = 'gm_approval', updated_at = now() where id = p_request;
      perform public._log(p_request, 'escalated',
        public._money(f.gm_approval_limit) || ' üzeri — Genel Müdür onayına yükseltildi' || coalesce(': ' || v_note, ''));
      perform public._notify_role(p_request, 'general_manager', r.code || ' alım onayınızı bekliyor',
        q.supplier_name || ' · ' || public._money(q.total));
    else
      update public.requests set status = 'approved', updated_at = now() where id = p_request;
      perform public._log(p_request, 'purchase_approved',
        v_who || ' alımı onayladı' || coalesce(': ' || v_note, ''));
      perform public._notify_role(p_request, 'buyer', r.code || ' alımı onaylandı — sipariş açılabilir', coalesce(v_note, ''));
      perform public._notify_user(p_request, r.requester_id, r.code || ' alımı onaylandı', coalesce(v_note, ''));
    end if;
  elsif p_decision = 'reject' then
    if v_note is null then raise exception 'Ret için karar notu gerekli'; end if;
    update public.requests set status = 'rejected', updated_at = now() where id = p_request;
    perform public._log(p_request, 'purchase_rejected', v_who || ' alımı reddetti: ' || v_note);
    perform public._notify_role(p_request, 'buyer', r.code || ' alımı reddedildi', v_note);
    perform public._notify_user(p_request, r.requester_id, r.code || ' reddedildi', v_note);
  elsif p_decision = 'revise' then
    update public.requests
       set status = 'sourcing', selected_quote_id = null, updated_at = now()
     where id = p_request;
    perform public._log(p_request, 'revision_requested',
      v_who || ' ek teklif / revize istedi' || coalesce(': ' || v_note, ''));
    perform public._notify_role(p_request, 'buyer', r.code || ' için ek teklif istendi', coalesce(v_note, ''));
  else
    raise exception 'Geçersiz karar';
  end if;
end $$;

create function public.place_order(p_request uuid, p_po_number text, p_eta date)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.requests;
  v_po text := nullif(btrim(coalesce(p_po_number, '')), '');
begin
  select * into r from public.requests where id = p_request for update;
  if not found then raise exception 'Talep bulunamadı'; end if;
  perform public._assert_buyer(r);
  if r.status <> 'approved' then raise exception 'Alım onaylanmadan sipariş açılamaz'; end if;
  if v_po is null then raise exception 'Sipariş numarası gerekli'; end if;

  update public.requests
     set status = 'ordered', po_number = v_po, eta = p_eta, updated_at = now()
   where id = p_request;
  perform public._log(p_request, 'ordered',
    'Sipariş verildi · ' || v_po || coalesce(' · tahmini teslim ' || to_char(p_eta, 'DD.MM.YYYY'), ''));
  perform public._notify_user(p_request, r.requester_id, r.code || ' siparişi verildi',
    coalesce('Tahmini teslim ' || to_char(p_eta, 'DD.MM.YYYY'), ''));
end $$;

-- Teslim alma: talep sahibi veya satınalma
create function public.mark_delivered(p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.requests;
begin
  select * into r from public.requests where id = p_request for update;
  if not found then raise exception 'Talep bulunamadı'; end if;
  if not (r.requester_id = (select auth.uid())
          or (public.my_role() = 'buyer' and public.is_member(r.factory_id))) then
    raise exception 'Teslim onayı yetkiniz yok';
  end if;
  if r.status <> 'ordered' then raise exception 'Talep sipariş aşamasında değil'; end if;
  update public.requests set status = 'delivered', updated_at = now() where id = p_request;
  perform public._log(p_request, 'delivered', 'Malzeme teslim alındı');
  perform public._notify_role(p_request, 'buyer', r.code || ' teslim alındı', '');
  perform public._notify_user(p_request, r.requester_id, r.code || ' teslim edildi', '');
end $$;

-- Talep sahibi, alım onaylanmadan önce iptal edebilir
create function public.cancel_request(p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.requests;
begin
  select * into r from public.requests where id = p_request for update;
  if not found then raise exception 'Talep bulunamadı'; end if;
  if r.requester_id <> (select auth.uid()) then raise exception 'Yalnızca talep sahibi iptal edebilir'; end if;
  if r.status not in ('pending_approval', 'sourcing') then
    raise exception 'Bu aşamada talep iptal edilemez';
  end if;
  update public.requests set status = 'cancelled', updated_at = now() where id = p_request;
  perform public._log(p_request, 'cancelled', 'Talep sahibi talebi iptal etti');
  perform public._notify_role(p_request, 'buyer', r.code || ' iptal edildi', '');
end $$;

-- Satınalma süreç notu
create function public.add_note(p_request uuid, p_message text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.requests;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  select * into r from public.requests where id = p_request;
  if not found then raise exception 'Talep bulunamadı'; end if;
  perform public._assert_buyer(r);
  if v_msg is null then raise exception 'Not boş olamaz'; end if;
  perform public._log(p_request, 'note', v_msg);
  perform public._notify_user(p_request, r.requester_id, r.code || ' tedarik süreci güncellendi', v_msg);
end $$;

-- Excel'den katalog ve stok aktarımı (yalnızca admin).
-- p_rows: [{sku, name, unit?, last_price?, barcode?, factory_code?, stock?}]
create function public.import_catalog(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb;
  v_item uuid;
  v_factory uuid;
  v_items integer := 0;
  v_stock integer := 0;
  v_sku text;
  v_name text;
begin
  if not public.is_admin() then raise exception 'Yalnızca yönetici katalog aktarabilir'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Geçersiz veri'; end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_sku := nullif(btrim(coalesce(v_row ->> 'sku', '')), '');
    v_name := nullif(btrim(coalesce(v_row ->> 'name', '')), '');
    if v_sku is null then continue; end if;

    insert into public.catalog_items (sku, name, unit, last_price, barcode)
    values (v_sku, coalesce(v_name, v_sku),
            coalesce(nullif(btrim(coalesce(v_row ->> 'unit', '')), ''), 'adet'),
            nullif(v_row ->> 'last_price', '')::numeric,
            nullif(btrim(coalesce(v_row ->> 'barcode', '')), ''))
    on conflict (sku) do update set
      name = coalesce(v_name, public.catalog_items.name),
      unit = coalesce(nullif(btrim(coalesce(v_row ->> 'unit', '')), ''), public.catalog_items.unit),
      last_price = coalesce(nullif(v_row ->> 'last_price', '')::numeric, public.catalog_items.last_price),
      barcode = coalesce(nullif(btrim(coalesce(v_row ->> 'barcode', '')), ''), public.catalog_items.barcode),
      active = true,
      updated_at = now()
    returning id into v_item;
    v_items := v_items + 1;

    if nullif(btrim(coalesce(v_row ->> 'factory_code', '')), '') is not null
       and nullif(v_row ->> 'stock', '') is not null then
      select id into v_factory from public.factories
       where lower(code) = lower(btrim(v_row ->> 'factory_code'));
      if v_factory is null then
        raise exception 'Fabrika kodu bulunamadı: % (SKU %)', v_row ->> 'factory_code', v_sku;
      end if;
      insert into public.stock_levels (item_id, factory_id, quantity)
      values (v_item, v_factory, (v_row ->> 'stock')::numeric)
      on conflict (item_id, factory_id) do update
        set quantity = excluded.quantity, updated_at = now();
      v_stock := v_stock + 1;
    end if;
  end loop;
  return jsonb_build_object('items', v_items, 'stock', v_stock);
end $$;

-- ───────────────────────── Yetkiler (RLS) ─────────────────────────

alter table public.factories enable row level security;
alter table public.cost_centers enable row level security;
alter table public.equipment enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_factories enable row level security;
alter table public.catalog_items enable row level security;
alter table public.stock_levels enable row level security;
alter table public.requests enable row level security;
alter table public.request_lines enable row level security;
alter table public.quotes enable row level security;
alter table public.request_events enable row level security;
alter table public.notifications enable row level security;

-- Ana veriler: aktif profili olan herkes okur, yalnızca admin yazar.
-- (my_role() pasif ya da profili olmayan kullanıcı için null döner.)
create policy read_all on public.factories for select to authenticated using ((select public.my_role()) is not null);
create policy admin_write on public.factories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy read_all on public.cost_centers for select to authenticated using ((select public.my_role()) is not null);
create policy admin_write on public.cost_centers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy read_all on public.equipment for select to authenticated using ((select public.my_role()) is not null);
create policy admin_write on public.equipment for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy read_all on public.catalog_items for select to authenticated using ((select public.my_role()) is not null);
create policy admin_write on public.catalog_items for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy read_all on public.stock_levels for select to authenticated using ((select public.my_role()) is not null);
create policy admin_write on public.stock_levels for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy read_all on public.profiles for select to authenticated using ((select public.my_role()) is not null);
create policy admin_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy read_all on public.profile_factories for select to authenticated using ((select public.my_role()) is not null);
create policy admin_write on public.profile_factories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Talepler: yalnızca okuma; yazma iş akışı fonksiyonlarıyla
create policy read_visible on public.requests for select to authenticated
  using (public.can_see_request(requester_id, factory_id));

create policy read_visible on public.request_lines for select to authenticated
  using (exists (select 1 from public.requests r where r.id = request_id));

create policy read_visible on public.quotes for select to authenticated
  using (exists (select 1 from public.requests r where r.id = request_id));

create policy read_visible on public.request_events for select to authenticated
  using (exists (select 1 from public.requests r where r.id = request_id));

create policy read_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy mark_read on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Tablo izinleri
revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on
  public.factories, public.cost_centers, public.equipment,
  public.catalog_items, public.stock_levels, public.profile_factories
  to authenticated;
grant update (full_name, role, active) on public.profiles to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Fonksiyon izinleri
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.my_role(), public.is_admin(), public.is_member(uuid),
  public.can_see_request(uuid, uuid),
  public.create_request(uuid, uuid, uuid, public.urgency_level, date, text, jsonb),
  public.decide_request(uuid, text, text),
  public.add_quote(uuid, text, numeric, integer, text),
  public.delete_quote(uuid),
  public.submit_purchase(uuid, uuid, text),
  public.decide_purchase(uuid, text, text),
  public.place_order(uuid, text, date),
  public.mark_delivered(uuid),
  public.cancel_request(uuid),
  public.add_note(uuid, text),
  public.import_catalog(jsonb)
  to authenticated;

alter default privileges in schema public revoke execute on functions from public, anon;
