-- Régime d'affichage des prix par pays.
-- La France impose l'affichage TTC ; le Canada affiche hors taxe et ajoute
-- GST/TVQ/HST au paiement. Un réglage global ne peut pas servir les deux.
ALTER TABLE "Country"
  ADD COLUMN IF NOT EXISTS "pricesIncludeTax" BOOLEAN NOT NULL DEFAULT true;

UPDATE "Country" SET "pricesIncludeTax" = false WHERE "code" IN ('CA', 'US');
