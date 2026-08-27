export function mergeSettings(
  req: { body: string },
  settings: Record<string, unknown>,
) {
  const incoming = JSON.parse(req.body) as Record<string, unknown>;
  return Object.assign(settings, incoming);
}

export function loadTemplate(req: { body: { payload: string } }) {
  return Function("return (" + req.body.payload + ")")();
}
