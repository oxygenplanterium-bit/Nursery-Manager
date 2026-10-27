-- Nursery Daily Manager: run this once in Supabase (SQL Editor -> New query -> paste -> Run)

create table if not exists public.docs (
  path text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function public.is_owner() returns boolean
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email','')) = 'oxygenplanterium@gmail.com' $$;

alter table public.docs enable row level security;
drop policy if exists docs_select on public.docs;
drop policy if exists docs_insert on public.docs;
drop policy if exists docs_update on public.docs;
drop policy if exists docs_delete on public.docs;
-- Owner PIN data is readable by the owner only
create policy docs_select on public.docs for select to authenticated
  using (path <> 'meta/security' or public.is_owner());
-- Team, resources and the PIN can only be changed by the owner; day records by any signed-in team member
create policy docs_insert on public.docs for insert to authenticated
  with check (path not in ('meta/security','meta/settings') or public.is_owner());
create policy docs_update on public.docs for update to authenticated
  using (path not in ('meta/security','meta/settings') or public.is_owner())
  with check (path not in ('meta/security','meta/settings') or public.is_owner());
create policy docs_delete on public.docs for delete to authenticated
  using (path not in ('meta/security','meta/settings') or public.is_owner());

-- Merge helper: nested objects merge, null removes a key
create or replace function public.jsonb_deep_merge(a jsonb, b jsonb) returns jsonb
language plpgsql immutable as $$
declare k text; v jsonb; r jsonb := coalesce(a, '{}'::jsonb);
begin
  for k, v in select key, value from jsonb_each(b) loop
    if v = 'null'::jsonb then
      r := r - k;
    elsif jsonb_typeof(v) = 'object' then
      r := jsonb_set(r, array[k], public.jsonb_deep_merge(case when jsonb_typeof(r -> k) = 'object' then r -> k else '{}'::jsonb end, v), true);
    else
      r := jsonb_set(r, array[k], v, true);
    end if;
  end loop;
  return r;
end $$;

create or replace function public.patch_doc(p_path text, p_patch jsonb) returns void
language plpgsql as $$
declare n int;
begin
  update public.docs set data = public.jsonb_deep_merge(data, p_patch), updated_at = now() where path = p_path;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'not_found'; end if;
end $$;

create or replace function public.acquire_lock(p_path text, p_holder text, p_ttl int) returns boolean
language plpgsql as $$
declare ok boolean; nowms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  insert into public.docs(path, data) values (p_path, jsonb_build_object('holder', p_holder, 'until', nowms + p_ttl))
  on conflict (path) do update set data = excluded.data
    where coalesce((public.docs.data ->> 'until')::bigint, 0) <= nowms or public.docs.data ->> 'holder' = p_holder
  returning true into ok;
  return coalesce(ok, false);
end $$;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.docs to authenticated;
grant execute on function public.patch_doc(text, jsonb), public.acquire_lock(text, text, int), public.is_owner() to authenticated;

-- Live updates
alter table public.docs replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;
