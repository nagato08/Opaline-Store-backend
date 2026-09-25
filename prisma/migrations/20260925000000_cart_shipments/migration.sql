-- Mode de livraison par groupe physique du panier.
--
-- Additive : les paniers existants gardent `shippingMethodId` et ne créent
-- aucune ligne ici tant qu'un seul transporteur suffit.
CREATE TABLE "CartShipment" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "constraint" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,
    "slotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CartShipment_pkey" PRIMARY KEY ("id")
);

-- Un seul mode par groupe : rechoisir remplace au lieu d'empiler.
CREATE UNIQUE INDEX "CartShipment_cartId_constraint_key" ON "CartShipment"("cartId", "constraint");

ALTER TABLE "CartShipment" ADD CONSTRAINT "CartShipment_cartId_fkey"
    FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CartShipment" ADD CONSTRAINT "CartShipment_methodId_fkey"
    FOREIGN KEY ("methodId") REFERENCES "ShippingMethod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CartShipment" ADD CONSTRAINT "CartShipment_slotId_fkey"
    FOREIGN KEY ("slotId") REFERENCES "DeliverySlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
