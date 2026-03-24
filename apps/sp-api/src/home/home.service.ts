import { BadRequestException, Injectable } from '@nestjs/common';
import { HomeRail, HomeRailKey } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HomeRailDto, type HomeRailFavorites } from './dto/home-rail.dto';
import { UpdateHomeRailsDto } from './dto/update-home-rails.dto';

const DEFAULT_HOME_RAILS: Array<{
  key: HomeRailKey;
  title: string;
  subtitle: string;
  enabled: boolean;
  sortOrder: number;
  favorites: HomeRailFavorites;
}> = [
  {
    key: HomeRailKey.FAVORITE_STUDIOS,
    title: 'Latest From Favorite Studios',
    subtitle: 'Recent scenes pulled from the studios you have starred.',
    enabled: true,
    sortOrder: 0,
    favorites: 'STUDIO',
  },
  {
    key: HomeRailKey.FAVORITE_PERFORMERS,
    title: 'Latest From Favorite Performers',
    subtitle: 'A rolling lineup from performers you are actively tracking.',
    enabled: true,
    sortOrder: 1,
    favorites: 'PERFORMER',
  },
];

@Injectable()
export class HomeService {
  constructor(private readonly prisma: PrismaService) {}

  async getRails(): Promise<HomeRailDto[]> {
    await this.ensureDefaultRails();
    const rails = await this.prisma.homeRail.findMany({
      orderBy: { sortOrder: 'asc' },
    });

    return rails.map((rail) => this.toDto(rail));
  }

  async updateRails(payload: UpdateHomeRailsDto): Promise<HomeRailDto[]> {
    await this.ensureDefaultRails();
    this.validateSubmittedRails(payload);

    await this.prisma.$transaction(
      payload.rails.map((rail, index) =>
        this.prisma.homeRail.update({
          where: { key: rail.key },
          data: {
            enabled: rail.enabled,
            sortOrder: index,
          },
        }),
      ),
    );

    return this.getRails();
  }

  private async ensureDefaultRails(): Promise<void> {
    for (const rail of DEFAULT_HOME_RAILS) {
      await this.prisma.homeRail.upsert({
        where: { key: rail.key },
        update: {},
        create: {
          key: rail.key,
          title: rail.title,
          subtitle: rail.subtitle,
          enabled: rail.enabled,
          sortOrder: rail.sortOrder,
        },
      });
    }
  }

  private validateSubmittedRails(payload: UpdateHomeRailsDto): void {
    const submittedKeys = payload.rails.map((rail) => rail.key);
    const uniqueKeys = new Set(submittedKeys);
    if (uniqueKeys.size !== submittedKeys.length) {
      throw new BadRequestException('Home rails payload contains duplicate keys.');
    }

    const expectedKeys = DEFAULT_HOME_RAILS.map((rail) => rail.key);
    if (
      submittedKeys.length !== expectedKeys.length ||
      expectedKeys.some((key) => !uniqueKeys.has(key))
    ) {
      throw new BadRequestException(
        'Home rails payload must include each built-in rail exactly once.',
      );
    }
  }

  private toDto(rail: HomeRail): HomeRailDto {
    const defaults = DEFAULT_HOME_RAILS.find((defaultRail) => defaultRail.key === rail.key);
    if (!defaults) {
      throw new BadRequestException(`Unsupported Home rail key: ${rail.key}`);
    }

    return {
      key: rail.key,
      title: rail.title,
      subtitle: rail.subtitle,
      enabled: rail.enabled,
      sortOrder: rail.sortOrder,
      favorites: defaults.favorites,
    };
  }
}
