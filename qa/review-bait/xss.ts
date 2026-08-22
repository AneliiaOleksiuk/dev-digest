export function searchPage(
  req: { query: { q: string } },
  reply: { type: (t: string) => { send: (body: string) => unknown } },
) {
  return reply.type("text/html").send("<h1>Results for " + req.query.q + "</h1>");
}

export function profileComment(req: { body: { comment: string } }) {
  return { html: "<div class=\"comment\">" + req.body.comment + "</div>" };
}
