import { fetchWithTimeout } from './fetch-with-timeout';

describe('fetchWithTimeout', () => {
  let originalFetch: typeof fetch;
  const fetchMock: jest.MockedFunction<typeof fetch> = jest.fn();

  beforeAll(() => {
    originalFetch = global.fetch;
    Object.assign(global, { fetch: fetchMock });
  });

  afterAll(() => {
    Object.assign(global, { fetch: originalFetch });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('passes an abort signal to fetch', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response);

    await fetchWithTimeout('http://provider.local/graphql', {
      method: 'POST',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://provider.local/graphql',
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('aborts a provider request after the timeout', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation((_input, init) => {
      const signal = init?.signal as AbortSignal;

      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('The operation was aborted.');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });

    const request = fetchWithTimeout('http://provider.local/graphql', {}, 25);
    const expectation = expect(request).rejects.toMatchObject({
      name: 'AbortError',
    });

    await jest.advanceTimersByTimeAsync(25);
    await expectation;
  });
});
