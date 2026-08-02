/** Capability port for fetching a skill body from an external URL. */
export interface SkillUrlFetcher {
  fetchText(url: string): Promise<string>;
}
