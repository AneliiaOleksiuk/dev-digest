import { MultiAgentPageView } from "./_components/MultiAgentPageView";

/* Route: /repos/:repoId/multi-agent (SPEC-04). Thin route entry — the view,
   its styles and i18n are colocated under _components (folder shape copied
   from repos/[repoId]/onboarding/). */
export default function MultiAgentPage() {
  return <MultiAgentPageView />;
}
