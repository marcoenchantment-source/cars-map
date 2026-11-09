// fetch() wrapper with a timeout, caller abort, and friendly errors. DOM-free (works in Node).

/** Error with a machine code and a message that is safe to show the driver. */
export class ServiceError extends Error {
  /**
   * @param {string} message friendly, user-facing
   * @param {{code?: string, status?: number, cause?: unknown}} [info]
   */
  constructor(message, { code = 'network', status = 0, cause } = {}) {
    super(message);
    this.name = 'ServiceError';
    this.code = code; // network | timeout | http | bad-response | no-route | aborted
    this.status = status;
    if (cause) this.cause = cause;
  }
}

/** True when the caller cancelled the request (a newer one replaced it). Callers ignore these. */
export function isAbort(err) {
  return err?.name === 'AbortError' || err?.code === 'aborted';
}

function linkSignals(external, controller) {
  if (!external) return () => {};
  if (external.aborted) {
    controller.abort();
    return () => {};
  }
  const onAbort = () => controller.abort();
  external.addEventListener('abort', onAbort, { once: true });
  return () => external.removeEventListener('abort', onAbort);
}

/**
 * Fetch JSON with a timeout.
 * @param {string} url
 * @param {{method?: string, body?: unknown, headers?: object, timeoutMs?: number,
 *          signal?: AbortSignal, service?: string, fetchImpl?: Function}} [opts]
 * @returns {Promise<unknown>} parsed JSON (validate it before use)
 */
export async function fetchJson(url, opts = {}) {
  const { method = 'GET', body, headers = {}, timeoutMs = 10000, signal, service = 'The service', fetchImpl = globalThis.fetch } = opts;
  if (signal?.aborted) throw new ServiceError('Cancelled', { code: 'aborted' });
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const unlink = linkSignals(signal, controller);
  try {
    const init = { method, headers: { Accept: 'application/json', ...headers }, signal: controller.signal };
    if (body !== undefined) {
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
      init.headers['Content-Type'] = 'application/json';
    }
    const res = await fetchImpl(url, init);
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const err = new ServiceError(`${service} is busy right now. Try again in a moment.`, { code: 'http', status: res.status });
      err.body = json;
      throw err;
    }
    if (json == null) throw new ServiceError(`${service} sent an answer we couldn't read. Try again.`, { code: 'bad-response' });
    return json;
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    if (timedOut) throw new ServiceError(`${service} took too long to answer. Check your signal and try again.`, { code: 'timeout', cause: err });
    if (signal?.aborted || err?.name === 'AbortError') throw new ServiceError('Cancelled', { code: 'aborted', cause: err });
    throw new ServiceError(`Couldn't reach ${service.toLowerCase()}. Check your signal and try again.`, { code: 'network', cause: err });
  } finally {
    clearTimeout(timer);
    unlink();
  }
}
