create schema if not exists ozel;

create table public.profiller (
  id uuid primary key references auth.users on delete cascade,
  ad text not null,
  rol text not null check (rol in ('teknisyen','satinalma','mudur','gm')),
  aktif boolean not null default true,
  gecici_sifre boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.malzemeler (
  sku text primary key, name text not null, unit text not null,
  stock numeric not null default 0, min numeric not null default 0, last numeric not null default 0
);
create table public.talepler (
  id text primary key, no text unique not null, durum text not null,
  olusturan uuid references public.profiller, veri jsonb not null,
  surum int not null default 1, created_at timestamptz not null default now()
);
create index on public.talepler (olusturan);
create table public.siparisler (
  id text primary key, no text unique not null,
  talep_id text references public.talepler, veri jsonb not null,
  created_at timestamptz not null default now()
);
create index on public.siparisler (talep_id);
create table public.bildirimler (
  id uuid primary key default gen_random_uuid(), at timestamptz not null default now(),
  alici text not null, metin text not null, talep_id text, okuyan uuid[] not null default '{}'
);
create index on public.bildirimler (alici, at desc);
create sequence public.tlp_seq start 2405;
create sequence public.sas_seq start 414;

-- aktif kullanıcının rolü (pasif ya da profilsiz ise null)
create function ozel.aktif_rol() returns text language sql stable security definer set search_path = '' as
$$ select rol from public.profiller where id = (select auth.uid()) and aktif $$;
revoke all on function ozel.aktif_rol() from public;
grant usage on schema ozel to authenticated;
grant execute on function ozel.aktif_rol() to authenticated;

alter table public.profiller enable row level security;
alter table public.malzemeler enable row level security;
alter table public.talepler enable row level security;
alter table public.siparisler enable row level security;
alter table public.bildirimler enable row level security;

-- yalnızca okuma; tüm yazma işlemleri sunucu işlevi (service role) üzerinden yapılır
create policy profil_oku on public.profiller for select to authenticated
  using (id = (select auth.uid()) or (select ozel.aktif_rol()) is not null);
create policy malzeme_oku on public.malzemeler for select to authenticated using ((select ozel.aktif_rol()) is not null);
create policy talep_oku on public.talepler for select to authenticated using ((select ozel.aktif_rol()) is not null);
create policy siparis_oku on public.siparisler for select to authenticated using ((select ozel.aktif_rol()) is not null);
create policy bildirim_oku on public.bildirimler for select to authenticated
  using (alici = (select auth.uid())::text or alici = 'role:' || (select ozel.aktif_rol()));

create function public.sira_no(tip text) returns bigint language sql security invoker set search_path = '' as
$$ select case when tip = 'sas' then nextval('public.sas_seq') else nextval('public.tlp_seq') end $$;

-- bir iş akışı adımının tüm yazmalarını tek işlemde uygular
create function public.akis_kaydet(p_talep jsonb, p_surum int, p_po jsonb, p_stok jsonb, p_bildirim jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare r jsonb; n int;
begin
  if p_talep is not null then
    if p_surum is null then
      insert into public.talepler (id, no, durum, olusturan, veri)
      values (p_talep->>'id', p_talep->>'no', p_talep->>'status', (p_talep->>'by')::uuid, p_talep);
    else
      update public.talepler set veri = p_talep, durum = p_talep->>'status', surum = surum + 1
      where id = p_talep->>'id' and surum = p_surum;
      get diagnostics n = row_count;
      if n = 0 then raise exception 'SURUM'; end if;
    end if;
  end if;
  if p_po is not null then
    insert into public.siparisler (id, no, talep_id, veri) values (p_po->>'id', p_po->>'no', p_po->>'talepId', p_po)
    on conflict (id) do update set veri = excluded.veri;
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_stok, '[]'::jsonb)) loop
    update public.malzemeler set stock = greatest(0, stock + (r->>'delta')::numeric),
      last = coalesce((r->>'last')::numeric, last) where sku = r->>'sku';
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_bildirim, '[]'::jsonb)) loop
    insert into public.bildirimler (alici, metin, talep_id) values (r->>'to', r->>'text', r->>'talepId');
  end loop;
end $$;

revoke all on function public.sira_no(text) from public, anon, authenticated;
revoke all on function public.akis_kaydet(jsonb, int, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.sira_no(text) to service_role;
grant execute on function public.akis_kaydet(jsonb, int, jsonb, jsonb, jsonb) to service_role;
revoke all on sequence public.tlp_seq, public.sas_seq from anon, authenticated;

insert into public.malzemeler (sku, name, unit, stock, min, last) values
 ('RLM-6204-2Z','Rulman 6204-2Z (paslanmaz)','adet',0,4,810),
 ('BNT-80-PU','Taşıyıcı bant kayışı 80 mm','adet',2,2,1240),
 ('YTK-UCP204','Rulman yatağı UCP 204','adet',3,2,460),
 ('GRS-H1-400G','Gıda sınıfı gres NSF H1 400 g','tüp',2,6,185),
 ('SNS-PT100-3M','Sıcaklık sensörü PT100 3 m','adet',1,2,1450),
 ('YAG-H1-5L','Zincir yağlayıcı NSF H1','L',2,5,310),
 ('REZ-220-450W','Çene ısıtıcı rezistans 220V 450W','adet',2,4,540),
 ('CNT-EPDM-80','Hijyenik conta EPDM DN80','adet',14,10,95),
 ('SLM-CIP-40','CIP pompası salmastra takımı','takım',0,1,3950),
 ('VKM-PED-80','Vakum pedi 80 mm (gıda uyumlu)','adet',5,8,150),
 ('VNA-DN65-SS','Hijyenik kelebek vana DN65','adet',1,1,9500),
 ('NZL-12-SS','Dolum nozulu 12 mm (paslanmaz)','adet',2,6,920);
