import { withStashImageSize } from './stashdb-image-url.util';

describe('withStashImageSize', () => {
  it('returns null when url is null', () => {
    expect(withStashImageSize(null, 600)).toBeNull();
  });

  it('adds size query param when none exists', () => {
    expect(withStashImageSize('https://stashdb/image.jpg', 600)).toBe(
      'https://stashdb/image.jpg?size=600',
    );
  });

  it('replaces existing size query param', () => {
    expect(
      withStashImageSize('https://stashdb/image.jpg?foo=bar&size=1200', 600),
    ).toBe('https://stashdb/image.jpg?foo=bar&size=600');
  });

  it('keeps hash fragments intact', () => {
    expect(withStashImageSize('https://stashdb/image.jpg#preview', 300)).toBe(
      'https://stashdb/image.jpg?size=300#preview',
    );
  });

  it('handles non-absolute urls', () => {
    expect(withStashImageSize('/image.jpg?x=1', 300)).toBe(
      '/image.jpg?x=1&size=300',
    );
  });
});
