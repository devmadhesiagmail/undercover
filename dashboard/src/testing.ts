import { vi } from "vitest";

export function reply(status: number, body: unknown): () => Response {
  return () => new Response(JSON.stringify(body), { status });
}

export function stubApi(routes: Record<string, unknown>) {
  const fetchMock = vi.fn((path: string, init?: RequestInit) => {
    const route = routes[`${init?.method ?? "GET"} ${path}`] ?? routes[path];
    if (route === undefined) {
      return Promise.resolve(reply(404, { detail: `No route ${path}` })());
    }
    return Promise.resolve(
      typeof route === "function"
        ? (route as () => Response)()
        : new Response(JSON.stringify(route)),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
