-- Recherche plein texte et tolérance aux fautes.
--
-- `unaccent` permet de trouver « canape » en tapant « canapé » et inversement.
-- `pg_trgm` fournit la similarité trigramme, qui rattrape les fautes de frappe
-- là où le plein texte échoue (« canpé » ne produit aucun lexème utile).
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- La configuration de recherche par défaut ne retire pas les accents :
-- on en dérive une qui les normalise avant le stemming français.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'fr_unaccent') THEN
    CREATE TEXT SEARCH CONFIGURATION fr_unaccent (COPY = french);
    ALTER TEXT SEARCH CONFIGURATION fr_unaccent
      ALTER MAPPING FOR hword, hword_part, word
      WITH unaccent, french_stem;
  END IF;
END
$$;

-- Vecteur de recherche calculé par la base : impossible qu'il se désynchronise
-- du contenu, contrairement à une colonne alimentée par l'application.
ALTER TABLE "ProductTranslation"
  ADD COLUMN IF NOT EXISTS "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('fr_unaccent', coalesce("name", '')), 'A') ||
    setweight(to_tsvector('fr_unaccent', coalesce("shortDescription", '')), 'B') ||
    setweight(to_tsvector('fr_unaccent', coalesce("description", '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS "ProductTranslation_searchVector_idx"
  ON "ProductTranslation" USING GIN ("searchVector");

-- Index trigramme sur le nom, pour la correction de fautes et l'autocomplétion.
CREATE INDEX IF NOT EXISTS "ProductTranslation_name_trgm_idx"
  ON "ProductTranslation" USING GIN ("name" gin_trgm_ops);

-- Journal des recherches : alimente les suggestions et révèle les requêtes
-- sans résultat, qui sont autant de ventes manquées.
CREATE TABLE IF NOT EXISTS "SearchQuery" (
  "id" TEXT NOT NULL,
  "term" TEXT NOT NULL,
  "normalized" TEXT NOT NULL,
  "locale" "Locale" NOT NULL,
  "resultCount" INTEGER NOT NULL DEFAULT 0,
  "userId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SearchQuery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SearchQuery_normalized_idx" ON "SearchQuery" ("normalized");
CREATE INDEX IF NOT EXISTS "SearchQuery_createdAt_idx" ON "SearchQuery" ("createdAt");
CREATE INDEX IF NOT EXISTS "SearchQuery_resultCount_idx" ON "SearchQuery" ("resultCount");

-- Synonymes gérés depuis l'administration : « sofa » doit trouver « canapé ».
CREATE TABLE IF NOT EXISTS "SearchSynonym" (
  "id" TEXT NOT NULL,
  "term" TEXT NOT NULL,
  "synonyms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "locale" "Locale" NOT NULL DEFAULT 'FR',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SearchSynonym_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SearchSynonym_term_locale_key"
  ON "SearchSynonym" ("term", "locale");

-- Mise en avant manuelle : épingler un produit sur une requête donnée.
CREATE TABLE IF NOT EXISTS "SearchPin" (
  "id" TEXT NOT NULL,
  "term" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "locale" "Locale" NOT NULL DEFAULT 'FR',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SearchPin_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SearchPin_productId_fkey" FOREIGN KEY ("productId")
    REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "SearchPin_term_locale_productId_key"
  ON "SearchPin" ("term", "locale", "productId");
