export function withStashImageSize(
  imageUrl: string | null | undefined,
  size: number,
): string | null {
  if (!imageUrl) {
    return null;
  }

  const normalizedSize = Math.trunc(size);
  if (!Number.isFinite(normalizedSize) || normalizedSize <= 0) {
    return imageUrl;
  }

  const sizeValue = normalizedSize.toString();

  try {
    const parsed = new URL(imageUrl);
    parsed.searchParams.set('size', sizeValue);
    return parsed.toString();
  } catch {
    const [beforeHash, hash = ''] = imageUrl.split('#', 2);
    const [path, query = ''] = beforeHash.split('?', 2);
    const params = new URLSearchParams(query);
    params.set('size', sizeValue);
    const serializedParams = params.toString();
    const hashSuffix = hash ? `#${hash}` : '';
    return serializedParams
      ? `${path}?${serializedParams}${hashSuffix}`
      : `${path}${hashSuffix}`;
  }
}
