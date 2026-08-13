import { OnboardingTourView } from "./_components/OnboardingTourView";

/* Route: /repos/:repoId/onboarding. Thin route entry — the view, its styles
   and i18n are colocated under _components (folder shape copied from
   repos/[repoId]/context/_components/ProjectContextView/). */
export default function OnboardingTourPage() {
  return <OnboardingTourView />;
}
