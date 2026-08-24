insert into public.units (code, symbol, name, dimension) values
  ('mm', 'mm', 'milímetro', 'length'),
  ('cm', 'cm', 'centímetro', 'length'),
  ('m', 'm', 'metro', 'length'),
  ('in', '"', 'polegada', 'length'),
  ('g', 'g', 'grama', 'mass'),
  ('kg', 'kg', 'quilograma', 'mass'),
  ('mL', 'mL', 'mililitro', 'volume'),
  ('L', 'L', 'litro', 'volume'),
  ('W', 'W', 'watt', 'power'),
  ('kW', 'kW', 'quilowatt', 'power'),
  ('V', 'V', 'volt', 'voltage'),
  ('A', 'A', 'ampere', 'current'),
  ('bar', 'bar', 'bar', 'pressure'),
  ('psi', 'psi', 'libra por polegada quadrada', 'pressure'),
  ('HP', 'HP', 'horsepower', 'power'),
  ('CV', 'CV', 'cavalo-vapor', 'power')
on conflict (code) do nothing;
insert into public.price_lists (code, name, currency, channel, status)
values ('retail-brl', 'Varejo BRL', 'BRL', 'storefront', 'active')
on conflict (code) do nothing;
