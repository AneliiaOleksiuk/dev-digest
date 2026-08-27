export async function updateUser(
  req: { params: { id: string }; body: Record<string, unknown>; user?: { id: string } },
  db: {
    query: (sql: string) => Promise<unknown>;
    users: { update: (id: string, data: Record<string, unknown>) => Promise<unknown> };
  },
) {
  console.log("password-change", req.body.email, req.body.password);
  await db.query(
    "UPDATE users SET role = '" + String(req.body.role) + "' WHERE id = " + req.params.id,
  );
  return db.users.update(req.params.id, { ...req.body });
}

export async function getUser(
  req: { params: { id: string } },
  db: { query: (sql: string) => Promise<unknown> },
) {
  return db.query("SELECT * FROM users WHERE id = " + req.params.id);
}
