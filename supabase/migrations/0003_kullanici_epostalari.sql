-- kullanıcı yönetimi ekranı için: e-postaları yalnızca aktif müdür / genel müdür görebilir
create function public.kullanici_epostalari() returns table (id uuid, eposta text)
language sql stable security definer set search_path = '' as $$
  select u.id, u.email::text from auth.users u join public.profiller p on p.id = u.id
  where (select ozel.aktif_rol()) in ('mudur', 'gm')
$$;
revoke all on function public.kullanici_epostalari() from public, anon;
grant execute on function public.kullanici_epostalari() to authenticated;
