-- Reparación única auditada para rootcode -> gentecashprueba.
-- Ejecutar solo después de confirmar que esta relación comercial es correcta.
-- Es idempotente: la restricción única del ledger evita repetir la comisión y
-- el volumen solo se suma cuando se inserta una comisión nueva.
do $$
declare
  v_sponsor_id uuid;
  v_child_id uuid;
  v_contract record;
  v_inserted integer;
begin
  select id into strict v_sponsor_id
  from public.profiles where lower(username) = 'rootcode';

  select id into strict v_child_id
  from public.profiles where lower(username) = 'gentecashprueba';

  if exists (
    select 1 from public.network_nodes
    where parent_id = v_sponsor_id and leg = 'left' and user_id <> v_child_id
  ) then
    raise exception 'La pierna izquierda de rootcode ya está ocupada';
  end if;

  if exists (
    select 1 from public.network_nodes where parent_id = v_child_id
  ) then
    raise exception 'gentecashprueba ya tiene descendientes; requiere revisión manual';
  end if;

  update public.profiles
  set sponsor_id = v_sponsor_id
  where id = v_child_id
    and sponsor_id is null;

  if not found and not exists (
    select 1 from public.profiles
    where id = v_child_id and sponsor_id = v_sponsor_id
  ) then
    raise exception 'gentecashprueba ya tiene otro patrocinador';
  end if;

  update public.network_nodes
  set sponsor_id = v_sponsor_id, parent_id = v_sponsor_id, leg = 'left'
  where user_id = v_child_id
    and sponsor_id is null and parent_id is null and leg is null;

  if not found and not exists (
    select 1 from public.network_nodes
    where user_id = v_child_id and sponsor_id = v_sponsor_id
      and parent_id = v_sponsor_id and leg = 'left'
  ) then
    raise exception 'La posición actual de gentecashprueba no permite esta reparación';
  end if;

  for v_contract in
    select c.id, c.amount, e.source_event_id, e.created_at
    from public.contracts c
    join public.commission_events e
      on e.contract_id = c.id and e.user_id = c.user_id
    where c.user_id = v_child_id and c.status = 'active'
  loop
    insert into public.commission_ledger(
      beneficiary_id, source_user_id, source_event_id,
      commission_type, amount, rate, leg, status, metadata, created_at
    ) values (
      v_sponsor_id, v_child_id, v_contract.source_event_id,
      'direct', round(v_contract.amount * 0.10, 8), 0.10, '', 'credited',
      jsonb_build_object(
        'contract_id', v_contract.id,
        'formula', 'amount * 10%',
        'repair', 'rootcode-gentecashprueba'
      ),
      v_contract.created_at
    ) on conflict (source_event_id, commission_type, beneficiary_id, leg) do nothing;
    get diagnostics v_inserted = row_count;

    if v_inserted = 1 then
      insert into public.network_volume(user_id, leg, volume, matched_volume)
      values (v_sponsor_id, 'left', v_contract.amount, 0)
      on conflict (user_id, leg) do update
      set volume = public.network_volume.volume + excluded.volume,
          updated_at = now();
    end if;
  end loop;
end;
$$;
