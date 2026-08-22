export function applyCors(_req: unknown, reply: { header: (name: string, value: string) => void }) {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Access-Control-Allow-Credentials", "true");
}

export function runSnippet(req: { body: { code: string } }) {
  return { result: eval(req.body.code) };
}

export function leave(req: { query: { next: string } }, reply: { redirect: (url: string) => unknown }) {
  return reply.redirect(req.query.next);
}

export function errorHandler(
  err: { stack?: string; message: string },
  reply: { code: (n: number) => { send: (body: unknown) => unknown } },
) {
  return reply.code(500).send({ stack: err.stack, env: process.env, message: err.message });
}
