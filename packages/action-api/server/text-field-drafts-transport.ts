import type { IncomingMessage, ServerResponse } from 'node:http';
import { FlowError } from './repository';

/** Lifecycle for the local owner route. Disconnect never implies SQL rollback. */
export function textDraftTransport(req: IncomingMessage, res: ServerResponse) {
  const alive = () => !req.aborted && !req.socket.destroyed && !res.destroyed && !res.writableEnded;
  const ignoredError = () => {};
  req.on('error', ignoredError);
  res.setHeader('Connection', 'close');
  let writeTimer: ReturnType<typeof setTimeout> | undefined;
  function cleanup() {
    if (writeTimer) clearTimeout(writeTimer);
    req.removeListener('error', ignoredError);
    res.removeListener('finish', finished);
    res.removeListener('close', cleanup);
  }
  function finished() {
    req.pause();
    req.socket.end();
    cleanup();
  }
  res.once('finish', finished);
  res.once('close', cleanup);
  return {
    alive,
    async authenticate(credential: string, resolve?: (credential: string) => Promise<string | null>): Promise<string | null> {
      if (!resolve || !alive()) throw new FlowError('UNAUTHENTICATED');
      return new Promise(accept => {
        let settled = false;
        const timer = setTimeout(() => settle(null), 5000);
        function closed() { settle(null); }
        function settle(value: string | null) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          res.removeListener('close', closed);
          accept(alive() ? value : null);
        }
        res.once('close', closed);
        try { Promise.resolve(resolve(credential)).then(settle, () => settle(null)); }
        catch { settle(null); }
      });
    },
    send(status: number, body: unknown) {
      req.pause();
      if (!alive()) return;
      writeTimer = setTimeout(() => res.destroy(), 5000);
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(body));
    },
  };
}
