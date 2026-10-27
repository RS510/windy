export class FetchError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

/** fetch + JSON with timeout; Open-Meteo returns {error:true, reason} on bad requests. */
export async function getJSON<T>(url: string, timeoutMs = 25000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { signal: ctrl.signal });
  } catch (e) {
    throw new FetchError(ctrl.signal.aborted ? 'Zeitüberschreitung' : 'Keine Verbindung');
  } finally {
    clearTimeout(timer);
  }
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    throw new FetchError(`Ungültige Antwort (${res.status})`, res.status);
  }
  if (!res.ok || (body && body.error === true)) {
    throw new FetchError(body?.reason || `Serverfehler (${res.status})`, res.status);
  }
  return body as T;
}
