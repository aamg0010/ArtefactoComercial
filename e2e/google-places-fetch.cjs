// Loaded only by the isolated phase 16 test server. No Google request leaves Node.
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (new URL(url).hostname === 'places.googleapis.com') {
    if (!url.endsWith('/ChIJfase16live')) return new Response('{}', { status: 503 });
    return new Response(JSON.stringify({ id: 'ChIJfase16live', displayName: { text: 'Construcciones Bajo Aragón E2E' },
      addressComponents: [{ shortText: 'ES', longText: 'España', types: ['country'] }] }));
  }
  return original(input, init);
};
