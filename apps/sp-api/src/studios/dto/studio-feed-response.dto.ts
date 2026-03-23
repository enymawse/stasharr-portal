import { StudioFeedItemDto } from './studio-feed-item.dto';

export interface StudioFeedResponseDto {
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  items: StudioFeedItemDto[];
}
