-- Clients made before the country field existed. India is the only country at launch. Without a country a client has
-- no price and cannot be checked against its audience, so none is left blank.
update clients set country_calling_code = '91' where country_calling_code is null;
