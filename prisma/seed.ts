import 'dotenv/config';
import * as argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { EU_VAT_RATES, NON_EU_COUNTRIES } from './seed-data/tax';
import { seedShipping } from './seed-data/shipping';
import { CANADIAN_PROVINCES } from './seed-data/tax-canada';

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env['DATABASE_URL'] as string,
  }),
});

async function seedCurrencies() {
  const currencies = [
    { code: 'EUR', symbol: '€', name: 'Euro', decimals: 2, isDefault: true },
    { code: 'USD', symbol: '$', name: 'Dollar américain', decimals: 2, isDefault: false },
    { code: 'CAD', symbol: 'CA$', name: 'Dollar canadien', decimals: 2, isDefault: false },
    { code: 'GBP', symbol: '£', name: 'Livre sterling', decimals: 2, isDefault: false },
  ];

  for (const currency of currencies) {
    await prisma.currency.upsert({
      where: { code: currency.code },
      update: currency,
      create: currency,
    });
  }
  console.log(`✓ ${currencies.length} devises`);
}

async function seedCountries() {
  const euCountries = EU_VAT_RATES.map((country) => ({
    code: country.code,
    name: country.name,
    nameEn: country.nameEn,
    currencyCode: country.currencyCode,
    isEuMember: true,
    isShippingActive: country.code === 'FR',
    requiresRegion: false,
  }));

  const countries = [...euCountries, ...NON_EU_COUNTRIES];

  for (const country of countries) {
    await prisma.country.upsert({
      where: { code: country.code },
      update: country,
      create: country,
    });
  }
  console.log(`✓ ${countries.length} pays`);
}

async function seedTaxClasses() {
  const classes = [
    { code: 'STANDARD', name: 'Taux normal', isDefault: true },
    { code: 'FOOD', name: 'Alimentaire (taux réduit)', isDefault: false },
    { code: 'REDUCED', name: 'Taux réduit', isDefault: false },
    { code: 'ZERO', name: 'Exonéré', isDefault: false },
  ];

  for (const taxClass of classes) {
    await prisma.taxClass.upsert({
      where: { code: taxClass.code },
      update: taxClass,
      create: taxClass,
    });
  }
  console.log(`✓ ${classes.length} classes fiscales`);
}

/**
 * Une zone fiscale par pays de l'UE : la TVA due est celle du pays de
 * destination (régime OSS). Les taux sont indicatifs et doivent être vérifiés
 * avant la mise en production — à terme, déléguer le calcul à Stripe Tax.
 */
async function seedEuTaxZones() {
  const standard = await prisma.taxClass.findUniqueOrThrow({ where: { code: 'STANDARD' } });
  const food = await prisma.taxClass.findUniqueOrThrow({ where: { code: 'FOOD' } });
  const zero = await prisma.taxClass.findUniqueOrThrow({ where: { code: 'ZERO' } });

  for (const country of EU_VAT_RATES) {
    const zone = await prisma.taxZone.upsert({
      where: { code: `EU_${country.code}` },
      update: { name: `TVA ${country.name}` },
      create: { code: `EU_${country.code}`, name: `TVA ${country.name}` },
    });

    await prisma.taxZoneCountry.deleteMany({ where: { taxZoneId: zone.id } });
    await prisma.taxZoneCountry.create({
      data: { taxZoneId: zone.id, countryCode: country.code },
    });

    const rates = [
      { taxClassId: standard.id, name: `TVA ${country.standard}%`, ratePercent: country.standard },
      { taxClassId: food.id, name: `TVA ${country.food}%`, ratePercent: country.food },
      { taxClassId: zero.id, name: 'Exonéré', ratePercent: 0 },
    ];

    for (const rate of rates) {
      await prisma.taxRate.upsert({
        where: {
          taxZoneId_taxClassId_priority: {
            taxZoneId: zone.id,
            taxClassId: rate.taxClassId,
            priority: 0,
          },
        },
        update: { name: rate.name, ratePercent: rate.ratePercent },
        create: {
          taxZoneId: zone.id,
          taxClassId: rate.taxClassId,
          name: rate.name,
          ratePercent: rate.ratePercent,
          priority: 0,
        },
      });
    }
  }
  console.log(`✓ ${EU_VAT_RATES.length} zones fiscales UE`);
}

/**
 * Une zone fiscale par province : au Canada la taxe dépend de la province de
 * livraison, et les provinces à taxe séparée (Québec, Colombie-Britannique…)
 * exigent deux lignes distinctes sur la facture.
 *
 * Les aliments de base y sont détaxés — l'inverse de l'UE, où ils bénéficient
 * d'un taux réduit mais non nul.
 */
async function seedCanadaTaxZones() {
  const standard = await prisma.taxClass.findUniqueOrThrow({
    where: { code: 'STANDARD' },
  });
  const food = await prisma.taxClass.findUniqueOrThrow({ where: { code: 'FOOD' } });
  const zero = await prisma.taxClass.findUniqueOrThrow({ where: { code: 'ZERO' } });

  for (const province of CANADIAN_PROVINCES) {
    const zone = await prisma.taxZone.upsert({
      where: { code: `CA_${province.code}` },
      update: { name: `Taxes ${province.name}` },
      create: { code: `CA_${province.code}`, name: `Taxes ${province.name}` },
    });

    await prisma.taxZoneCountry.deleteMany({ where: { taxZoneId: zone.id } });
    await prisma.taxZoneCountry.create({
      data: { taxZoneId: zone.id, countryCode: 'CA', region: province.code },
    });

    await prisma.taxRate.deleteMany({ where: { taxZoneId: zone.id } });

    for (const [index, line] of province.standard.entries()) {
      await prisma.taxRate.create({
        data: {
          taxZoneId: zone.id,
          taxClassId: standard.id,
          name: line.name,
          ratePercent: line.rate,
          priority: index,
        },
      });
    }

    for (const taxClass of [food, zero]) {
      await prisma.taxRate.create({
        data: {
          taxZoneId: zone.id,
          taxClassId: taxClass.id,
          name: 'Détaxé',
          ratePercent: 0,
          priority: 0,
        },
      });
    }
  }

  console.log(`✓ ${CANADIAN_PROVINCES.length} zones fiscales canadiennes`);
}

async function seedCustomerGroups() {
  const groups = [
    { code: 'DEFAULT', name: 'Particuliers', isDefault: true, isTaxExempt: false },
    { code: 'PRO', name: 'Professionnels', isDefault: false, isTaxExempt: true },
  ];

  for (const group of groups) {
    await prisma.customerGroup.upsert({
      where: { code: group.code },
      update: group,
      create: group,
    });
  }
  console.log(`✓ ${groups.length} groupes clients`);
}

async function seedLocation() {
  await prisma.location.upsert({
    where: { code: 'MAIN' },
    update: {},
    create: {
      code: 'MAIN',
      name: 'Entrepôt principal',
      countryCode: 'FR',
      isDefault: true,
      isActive: true,
    },
  });
  console.log('✓ emplacement de stock par défaut');
}

async function seedSettings() {
  const settings: { key: string; group: string; value: unknown }[] = [
    // Enseigne affichée aux visiteurs. À remplacer par le vrai nom du client :
    // « Comptoir » désigne le logiciel, pas la boutique.
    { key: 'store.name', group: 'general', value: 'Ma Boutique' },
    { key: 'store.email', group: 'general', value: 'contact@tadjo.dev' },
    { key: 'store.defaultLocale', group: 'general', value: 'FR' },
    { key: 'store.locales', group: 'general', value: ['FR', 'EN'] },
    { key: 'store.defaultCurrency', group: 'general', value: 'EUR' },
    { key: 'store.currencies', group: 'general', value: ['EUR', 'CAD'] },
    // Repli seulement : le régime d'affichage est désormais porté par le pays
    // de destination (`Country.pricesIncludeTax`), la France étant TTC et le
    // Canada hors taxe.
    { key: 'tax.pricesIncludeTax', group: 'tax', value: true },
    { key: 'tax.provider', group: 'tax', value: 'MANUAL' },
    { key: 'checkout.reservationMinutes', group: 'checkout', value: 20 },
    { key: 'checkout.guestEnabled', group: 'checkout', value: true },
    { key: 'cart.abandonedAfterHours', group: 'cart', value: 4 },
    { key: 'order.numberPrefix', group: 'order', value: 'CMD' },
    // Modération a priori : publier un avis sans relecture expose la fiche
    // produit au spam et aux propos illicites.
    { key: 'reviews.autoApprove', group: 'reviews', value: false },
    // Fidélité : 1 point par euro dépensé, 1 point = 1 centime, soit 1 % de
    // remise différée. C'est la norme du commerce généraliste — au-delà, la
    // marge sur le meuble et l'électronique ne suit pas. Palier de conversion
    // à 500 points (5 €) pour éviter des avoirs à quelques centimes.
    { key: 'loyalty.enabled', group: 'loyalty', value: true },
    { key: 'loyalty.pointsPerEuro', group: 'loyalty', value: 1 },
    { key: 'loyalty.pointValueCents', group: 'loyalty', value: 1 },
    { key: 'loyalty.minRedeemPoints', group: 'loyalty', value: 500 },
    { key: 'loyalty.maxRedeemPercent', group: 'loyalty', value: 30 },
    { key: 'loyalty.expiryMonths', group: 'loyalty', value: 24 },
  ];

  for (const setting of settings) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      update: { value: setting.value as object, group: setting.group },
      create: { key: setting.key, group: setting.group, value: setting.value as object },
    });
  }
  console.log(`✓ ${settings.length} réglages`);
}

async function seedAdmin() {
  const email = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@example.com';
  const password = process.env['SEED_ADMIN_PASSWORD'] ?? 'Admin123!';
  const passwordHash = await argon2.hash(password);

  await prisma.user.upsert({
    where: { email },
    update: { role: 'ADMIN' },
    create: {
      email,
      passwordHash,
      firstName: 'Admin',
      lastName: 'Boutique',
      role: 'ADMIN',
      emailVerifiedAt: new Date(),
      locale: 'FR',
      currencyCode: 'EUR',
    },
  });
  console.log(`✓ compte admin : ${email}`);
}

async function seedFeatureFlags() {
  const flags = [
    { key: 'promotions', isEnabled: true, description: 'Moteur de promotions' },
    { key: 'campaigns', isEnabled: true, description: 'Campagnes et popups' },
    { key: 'reviews', isEnabled: true, description: 'Avis clients' },
    { key: 'loyalty', isEnabled: false, description: 'Programme de fidélité' },
    // Les deux marchés sont ouverts au lancement : le visiteur choisit sa
    // langue et sa devise.
    { key: 'multiCurrency', isEnabled: true, description: 'Sélecteur de devise' },
    { key: 'multiLocale', isEnabled: true, description: 'Sélecteur de langue' },
  ];

  for (const flag of flags) {
    await prisma.featureFlag.upsert({
      where: { key: flag.key },
      update: { description: flag.description },
      create: flag,
    });
  }
  console.log(`✓ ${flags.length} feature flags`);
}

async function main() {
  await seedCurrencies();
  await seedCountries();
  await seedTaxClasses();
  await seedEuTaxZones();
  await seedCanadaTaxZones();
  await seedCustomerGroups();
  await seedLocation();
  await seedShipping(prisma);
  await seedSettings();
  await seedFeatureFlags();
  await seedAdmin();
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log('\nSeed terminé.');
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
