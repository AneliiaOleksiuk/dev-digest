import { readFile, writeFile } from "node:fs/promises";
import { exec } from "node:child_process";

export async function readUserFile(req: { query: { path: string } }) {
  return readFile("/var/data/" + req.query.path, "utf8");
}

export async function writeUserFile(req: { query: { path: string }; body: { content: string } }) {
  await writeFile(req.query.path, req.body.content);
}

export function convertImage(req: { query: { file: string } }) {
  exec("convert " + req.query.file + " /tmp/out.png");
}
