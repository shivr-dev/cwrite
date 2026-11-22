alter table public.ctb_events
  add column caret text check (caret is null or (kind = 'edit' and char_length(caret) between 1 and 240));
grant insert (caret) on public.ctb_events to authenticated;
