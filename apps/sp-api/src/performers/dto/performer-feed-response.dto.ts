import { PerformerFeedItemDto } from './performer-feed-item.dto';

export interface PerformerFeedResponseDto {
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  items: PerformerFeedItemDto[];
}
