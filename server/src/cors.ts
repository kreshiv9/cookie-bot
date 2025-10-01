export function withCors(resHeaders: Headers, origin: string | null) {
    resHeaders.set('Access-Control-Allow-Origin', '*');
    resHeaders.set('Access-Control-Allow-Headers', 'content-type, authorization');
    resHeaders.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  }