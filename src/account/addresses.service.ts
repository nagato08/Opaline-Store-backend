import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AddressInputDto } from '../cart/dto/cart.dto';

@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefaultShipping: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async create(userId: string, dto: AddressInputDto & { label?: string }) {
    const isFirst =
      (await this.prisma.address.count({ where: { userId } })) === 0;

    return this.prisma.address.create({
      data: {
        userId,
        label: dto.label,
        firstName: dto.firstName,
        lastName: dto.lastName,
        company: dto.company,
        line1: dto.line1,
        line2: dto.line2,
        postalCode: dto.postalCode,
        city: dto.city,
        region: dto.region,
        countryCode: dto.countryCode.toUpperCase(),
        phone: dto.phone,
        vatNumber: dto.vatNumber,
        notes: dto.notes,
        // La première adresse enregistrée devient l'adresse par défaut :
        // sans ça, le client doit en désigner une explicitement pour rien.
        isDefaultShipping: isFirst,
        isDefaultBilling: isFirst,
      },
    });
  }

  async update(
    userId: string,
    id: string,
    dto: Partial<AddressInputDto> & { label?: string },
  ) {
    await this.assertOwned(userId, id);

    return this.prisma.address.update({
      where: { id },
      data: {
        label: dto.label,
        firstName: dto.firstName,
        lastName: dto.lastName,
        company: dto.company,
        line1: dto.line1,
        line2: dto.line2,
        postalCode: dto.postalCode,
        city: dto.city,
        region: dto.region,
        countryCode: dto.countryCode?.toUpperCase(),
        phone: dto.phone,
        vatNumber: dto.vatNumber,
        notes: dto.notes,
      },
    });
  }

  /**
   * Désigne l'adresse par défaut. Le retrait du drapeau sur les autres se fait
   * dans la même transaction : deux adresses par défaut rendraient le
   * pré-remplissage du checkout non déterministe.
   */
  async setDefault(userId: string, id: string, type: 'SHIPPING' | 'BILLING') {
    await this.assertOwned(userId, id);

    const field =
      type === 'SHIPPING' ? 'isDefaultShipping' : 'isDefaultBilling';

    await this.prisma.$transaction([
      this.prisma.address.updateMany({
        where: { userId },
        data: { [field]: false },
      }),
      this.prisma.address.update({
        where: { id },
        data: { [field]: true },
      }),
    ]);

    return this.list(userId);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.assertOwned(userId, id);

    // Les commandes gardent une copie figée de l'adresse : supprimer celle du
    // carnet n'altère aucun historique.
    await this.prisma.address.delete({ where: { id } });
  }

  private async assertOwned(userId: string, id: string): Promise<void> {
    const address = await this.prisma.address.findFirst({
      where: { id, userId },
      select: { id: true },
    });

    if (!address) {
      throw new NotFoundException('Adresse introuvable.');
    }
  }
}
