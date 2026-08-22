export async function fetchPreview(req: { query: { url: string; token: string } }) {
  const res = await fetch(req.query.url, {
    headers: { Authorization: "Bearer " + req.query.token },
  });
  return res.text();
}

export async function probeInternal(req: { body: { host: string; port: string } }) {
  return fetch("http://" + req.body.host + ":" + req.body.port + "/health");
}
