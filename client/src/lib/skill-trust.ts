import type { Skill } from "@devdigest/shared";

/** A skill needs human vetting before it's safe to enable/link — anything not
 *  directly authored or pasted in by the user themselves. */
export function isUntrustedSource(skill: Pick<Skill, "source">): boolean {
  return skill.source !== "extracted" && skill.source !== "manual";
}
