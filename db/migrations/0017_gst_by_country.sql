-- Tax belongs to a country, like Meta's rates and client prices, so another country's can be added without a redesign.
alter table gst_rates add column if not exists country_calling_code text;
update gst_rates set country_calling_code = '91' where country_calling_code is null;
create index if not exists gst_rates_country_idx on gst_rates (country_calling_code, valid_from desc, seq desc);
