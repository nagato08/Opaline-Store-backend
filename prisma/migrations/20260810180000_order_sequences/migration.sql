-- Séquences de numérotation.
-- Une séquence Postgres garantit l'unicité sous concurrence, ce qu'un
-- `SELECT count(*) + 1` ne fait pas. La numérotation des factures doit en
-- plus être continue pour être opposable comptablement.
CREATE SEQUENCE IF NOT EXISTS order_number_seq START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START WITH 1 INCREMENT BY 1;
