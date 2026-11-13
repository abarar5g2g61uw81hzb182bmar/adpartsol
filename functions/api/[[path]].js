const UPSTREAM = "https://adpartsol.storzen-io.workers.dev";

export async function onRequest({ request }) {
  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, UPSTREAM);
  return fetch(new Request(target, request));
}
