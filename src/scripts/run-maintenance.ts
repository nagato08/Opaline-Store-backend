import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { CartService } from '../cart/cart.service';
import { InventoryService } from '../inventory/inventory.service';

/**
 * Déclenche à la main les tâches de maintenance normalement planifiées.
 * Utile pour vérifier une relance sans attendre le prochain passage du cron.
 *
 * Usage : npm run maintenance -- [abandoned-carts|expired-reservations]
 */
async function main() {
  const task = process.argv[2] ?? 'abandoned-carts';
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    if (task === 'abandoned-carts') {
      const count = await app.get(CartService).flagAbandoned();
      console.log(`${count} panier(s) traité(s).`);
    } else if (task === 'expired-reservations') {
      const count = await app.get(InventoryService).releaseExpired();
      console.log(`${count} réservation(s) libérée(s).`);
    } else {
      console.error(`Tâche inconnue : ${task}`);
      process.exitCode = 1;
    }

    // Laisse le temps à la file d'absorber les emails mis en attente.
    await new Promise((resolve) => setTimeout(resolve, 3000));
  } finally {
    await app.close();
  }
}

void main();
