const DEFAULT_PROVIDER_FETCH_TIMEOUT_MS = 30_000;

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_PROVIDER_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const timeoutController = new AbortController();
  const callerSignal = init.signal ?? null;
  const composedSignal = callerSignal
    ? composeAbortSignals(callerSignal, timeoutController.signal)
    : {
        signal: timeoutController.signal,
        cleanup: () => undefined,
      };
  const timeout = setTimeout(() => {
    timeoutController.abort();
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: composedSignal.signal,
    });
  } finally {
    clearTimeout(timeout);
    composedSignal.cleanup();
  }
}

function composeAbortSignals(
  callerSignal: AbortSignal,
  timeoutSignal: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();

  const abortFromCaller = () => {
    controller.abort(callerSignal.reason);
  };
  const abortFromTimeout = () => {
    controller.abort(timeoutSignal.reason);
  };

  if (callerSignal.aborted) {
    abortFromCaller();
    return {
      signal: controller.signal,
      cleanup: () => undefined,
    };
  }

  if (timeoutSignal.aborted) {
    abortFromTimeout();
    return {
      signal: controller.signal,
      cleanup: () => undefined,
    };
  }

  callerSignal.addEventListener('abort', abortFromCaller, { once: true });
  timeoutSignal.addEventListener('abort', abortFromTimeout, { once: true });

  return {
    signal: controller.signal,
    cleanup: () => {
      callerSignal.removeEventListener('abort', abortFromCaller);
      timeoutSignal.removeEventListener('abort', abortFromTimeout);
    },
  };
}
