alter table public.admin_payables
  add column display_label text not null default 'Retiro'
    check (length(trim(display_label)) between 1 and 80),
  add column sponsor_id uuid references public.profiles(id);


