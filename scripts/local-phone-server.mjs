import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
]);

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function resolveRequestPath(root, url, host, port) {
  const pathname = decodeURIComponent(new URL(url, `http://${host}:${port}`).pathname);
  const clean = pathname === '/' ? '/index.html' : pathname;
  const resolved = path.resolve(root, `.${clean}`);
  if (!resolved.startsWith(path.resolve(root))) {
    return null;
  }
  return resolved;
}

async function handleChatProxy(request, response) {
  if (request.method !== 'POST') {
    response.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Method not allowed');
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(request));
  } catch {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Invalid JSON body');
    return;
  }

  const apiUrl = typeof payload.apiUrl === 'string' ? payload.apiUrl : '';
  const apiKey = typeof payload.apiKey === 'string' ? payload.apiKey : '';
  if (!apiUrl || !payload.model || !Array.isArray(payload.messages)) {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Missing apiUrl, model, or messages');
    return;
  }

  const headers = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  try {
    const upstream = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: payload.model,
        messages: payload.messages,
        temperature: typeof payload.temperature === 'number' ? payload.temperature : 0.75,
        stream: false,
      }),
    });
    const text = await upstream.text();
    response.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
    });
    response.end(text);
  } catch (error) {
    response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(error instanceof Error ? error.message : String(error));
  }
}

export function startLocalPhoneServer({
  root = path.join(process.cwd(), 'dist', 'local-phone'),
  host = process.env.LOCAL_PHONE_HOST || '127.0.0.1',
  port = Number(process.env.LOCAL_PHONE_PORT || '8088'),
  quiet = false,
} = {}) {
  const server = createServer(async (request, response) => {
    const requestUrl = request.url || '/';
    if (new URL(requestUrl, `http://${host}:${port}`).pathname === '/local-phone-api/chat-completions') {
      await handleChatProxy(request, response);
      return;
    }

    const filePath = resolveRequestPath(root, requestUrl, host, port);
    if (!filePath) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }

    try {
      const info = await stat(filePath);
      if (!info.isFile()) {
        response.writeHead(404);
        response.end('Not found');
        return;
      }
      response.writeHead(200, {
        'Content-Type': mimeTypes.get(path.extname(filePath)) || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      createReadStream(filePath).pipe(response);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      const url = `http://${host}:${actualPort}/`;
      if (!quiet) {
        console.log(`Local phone is running at ${url}`);
      }
      resolve({ server, url, port: actualPort });
    });
  });
}
