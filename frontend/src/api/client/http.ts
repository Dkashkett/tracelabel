// Shared fetch response handler for every domain client. Moved verbatim (behavior
// unchanged) from the old api/client.ts.

export async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = ((await res.json()) as { detail?: string }).detail ?? detail;
    } catch {
      // non-JSON error body; keep statusText
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}
