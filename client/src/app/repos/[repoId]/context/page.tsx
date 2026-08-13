import { ProjectContextView } from "./_components/ProjectContextView";

/* Route: /repos/:repoId/context. Thin route entry — the view, its styles and
   i18n are colocated under _components (folder shape copied from
   repos/[repoId]/conventions/_components/ConventionsListView/). */
export default function ProjectContextPage() {
  return <ProjectContextView />;
}
