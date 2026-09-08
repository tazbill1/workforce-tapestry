insert into public.exclusions (client_id, match_type, match_value, category, reason, active)
values ('bec5e5f5-de74-4de2-badc-fbf045f57f27','email','lisahaffecke@hotmail.com','test','Name contains "Test" — test account',true)
on conflict do nothing;