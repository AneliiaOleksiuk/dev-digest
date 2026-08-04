/** Build a GitHub "blob" URL to the exact evidence line, or null if repo info is missing. */
export function buildGithubFileUrl(
  repoFullName: string | null | undefined,
  defaultBranch: string | null | undefined,
  path: string,
  line?: number | null,
): string | null {
  if (!repoFullName || !defaultBranch) return null;
  const anchor = line != null ? `#L${line}` : "";
  return `https://github.com/${repoFullName}/blob/${defaultBranch}/${path}${anchor}`;
}
