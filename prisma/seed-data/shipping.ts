import type { PrismaClient } from '../../src/generated/prisma/client';

/**
 * Transporteurs, zones et barèmes de livraison de départ.
 *
 * Trois cas couverts dès l'origine parce qu'ils contraignent la modélisation :
 * le colis standard (barème au poids), le meuble hors gabarit (livraison sur
 * rendez-vous) et le frais alimentaire (chaîne du froid).
 */
export async function seedShipping(prisma: PrismaClient): Promise<void> {
  const carriers = [
    {
      code: 'POSTES_CANADA',
      name: 'Postes Canada',
      trackingUrlTemplate:
        'https://www.canadapost-postescanada.ca/track-reperage/fr#/resultats?trackingNumber={tracking}',
    },
    {
      code: 'COLISSIMO',
      name: 'Colissimo',
      trackingUrlTemplate: 'https://www.laposte.fr/outils/suivre-vos-envois?code={tracking}',
    },
    { code: 'CHRONOFRESH', name: 'Chronofresh', trackingUrlTemplate: null },
    { code: 'TRANSPORTEUR_MEUBLE', name: 'Transporteur spécialisé', trackingUrlTemplate: null },
  ];

  for (const carrier of carriers) {
    await prisma.carrier.upsert({
      where: { code: carrier.code },
      update: { name: carrier.name },
      create: carrier,
    });
  }

  const standardTax = await prisma.taxClass.findUniqueOrThrow({ where: { code: 'STANDARD' } });

  const zoneFr = await prisma.shippingZone.upsert({
    where: { code: 'FR' },
    update: { countryCodes: ['FR'] },
    create: { code: 'FR', name: 'France métropolitaine', countryCodes: ['FR'], priority: 0 },
  });

  const zoneEu = await prisma.shippingZone.upsert({
    where: { code: 'EU' },
    update: {},
    create: {
      code: 'EU',
      name: 'Union européenne',
      countryCodes: ['BE', 'DE', 'ES', 'IT', 'LU', 'NL', 'PT', 'AT', 'IE'],
      priority: 10,
    },
  });

  const zoneCa = await prisma.shippingZone.upsert({
    where: { code: 'CA' },
    update: { countryCodes: ['CA'] },
    create: { code: 'CA', name: 'Canada', countryCodes: ['CA'], priority: 20 },
  });

  const colissimo = await prisma.carrier.findUniqueOrThrow({ where: { code: 'COLISSIMO' } });
  const chronofresh = await prisma.carrier.findUniqueOrThrow({ where: { code: 'CHRONOFRESH' } });
  const meuble = await prisma.carrier.findUniqueOrThrow({
    where: { code: 'TRANSPORTEUR_MEUBLE' },
  });
  const postesCanada = await prisma.carrier.findUniqueOrThrow({
    where: { code: 'POSTES_CANADA' },
  });

  const methods = [
    {
      code: 'FR_STANDARD',
      zoneId: zoneFr.id,
      carrierId: colissimo.id,
      rateType: 'BY_WEIGHT' as const,
      minDeliveryDays: 2,
      maxDeliveryDays: 4,
      maxWeightGrams: 30000,
      freeAboveCents: 6000,
      position: 0,
      fr: { name: 'Colissimo domicile', description: 'Livraison en 2 à 4 jours ouvrés' },
      en: { name: 'Standard home delivery', description: 'Delivered within 2-4 business days' },
      rates: [
        { minValue: 0, maxValue: 1000, priceCents: 590 },
        { minValue: 1000, maxValue: 5000, priceCents: 890 },
        { minValue: 5000, maxValue: 30000, priceCents: 1490 },
      ],
    },
    {
      code: 'FR_PICKUP',
      zoneId: zoneFr.id,
      carrierId: null,
      rateType: 'PICKUP' as const,
      minDeliveryDays: 1,
      maxDeliveryDays: 2,
      position: 1,
      fr: { name: 'Retrait en magasin', description: 'Gratuit, sous 24 à 48 h' },
      en: { name: 'Store pickup', description: 'Free, ready within 24-48h' },
      rates: [{ minValue: 0, maxValue: null, priceCents: 0 }],
    },
    {
      code: 'FR_FRAIS',
      zoneId: zoneFr.id,
      carrierId: chronofresh.id,
      rateType: 'FLAT' as const,
      supportsColdChain: true,
      minDeliveryDays: 1,
      maxDeliveryDays: 2,
      position: 2,
      fr: { name: 'Livraison fraîcheur', description: 'Colis isotherme, livraison en 24 h' },
      en: { name: 'Chilled delivery', description: 'Insulated parcel, next-day delivery' },
      rates: [{ minValue: 0, maxValue: null, priceCents: 1290 }],
    },
    {
      code: 'FR_VOLUMINEUX',
      zoneId: zoneFr.id,
      carrierId: meuble.id,
      rateType: 'FLAT' as const,
      supportsOversized: true,
      requiresSlot: true,
      minDeliveryDays: 7,
      maxDeliveryDays: 21,
      position: 3,
      fr: { name: 'Livraison sur rendez-vous', description: 'Meubles et objets volumineux, créneau à choisir' },
      en: { name: 'Scheduled delivery', description: 'Furniture and bulky items, pick a time slot' },
      rates: [{ minValue: 0, maxValue: null, priceCents: 4900 }],
    },
    {
      code: 'EU_STANDARD',
      zoneId: zoneEu.id,
      carrierId: colissimo.id,
      rateType: 'BY_WEIGHT' as const,
      minDeliveryDays: 4,
      maxDeliveryDays: 8,
      maxWeightGrams: 30000,
      position: 0,
      fr: { name: 'Livraison Europe', description: 'Livraison en 4 à 8 jours ouvrés' },
      en: { name: 'European delivery', description: 'Delivered within 4-8 business days' },
      rates: [
        { minValue: 0, maxValue: 2000, priceCents: 1290 },
        { minValue: 2000, maxValue: 30000, priceCents: 2490 },
      ],
    },
    {
      code: 'CA_STANDARD',
      zoneId: zoneCa.id,
      carrierId: postesCanada.id,
      rateType: 'BY_WEIGHT' as const,
      minDeliveryDays: 5,
      maxDeliveryDays: 12,
      maxWeightGrams: 30000,
      freeAboveCents: 15000,
      position: 0,
      fr: { name: 'Livraison Canada', description: 'Livraison en 5 à 12 jours ouvrés' },
      en: { name: 'Canada delivery', description: 'Delivered within 5-12 business days' },
      rates: [
        { minValue: 0, maxValue: 2000, priceCents: 1890 },
        { minValue: 2000, maxValue: 10000, priceCents: 2990 },
        { minValue: 10000, maxValue: 30000, priceCents: 4990 },
      ],
    },
    {
      code: 'CA_EXPRESS',
      zoneId: zoneCa.id,
      carrierId: postesCanada.id,
      rateType: 'FLAT' as const,
      minDeliveryDays: 2,
      maxDeliveryDays: 4,
      maxWeightGrams: 20000,
      position: 1,
      fr: { name: 'Livraison express Canada', description: 'Livraison en 2 à 4 jours ouvrés' },
      en: { name: 'Canada express', description: 'Delivered within 2-4 business days' },
      rates: [{ minValue: 0, maxValue: null, priceCents: 6900 }],
    },
  ];

  for (const method of methods) {
    const { fr, en, rates, ...data } = method;

    const created = await prisma.shippingMethod.upsert({
      where: { code: method.code },
      update: { isActive: true },
      create: { ...data, taxClassId: standardTax.id },
    });

    for (const [locale, labels] of [
      ['FR', fr],
      ['EN', en],
    ] as const) {
      await prisma.shippingMethodTranslation.upsert({
        where: { methodId_locale: { methodId: created.id, locale } },
        update: labels,
        create: { methodId: created.id, locale, ...labels },
      });
    }

    // Les frais suivent la devise du marché : un tarif en euros serait
    // inapplicable à un panier canadien.
    const currencyCode = method.code.startsWith('CA_') ? 'CAD' : 'EUR';

    await prisma.shippingRate.deleteMany({ where: { methodId: created.id } });
    await prisma.shippingRate.createMany({
      data: rates.map((rate) => ({
        methodId: created.id,
        currencyCode,
        minValue: rate.minValue,
        maxValue: rate.maxValue,
        priceCents: rate.priceCents,
      })),
    });
  }

  console.log(
    `✓ ${carriers.length} transporteurs, 3 zones, ${methods.length} modes de livraison`,
  );
}
