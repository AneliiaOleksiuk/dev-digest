import { ConventionsListView } from "./_components/ConventionsListView";

/* Route: /repos/:repoId/conventions. Thin route entry — the view, its card,
   create-skill modal, styles and i18n are colocated under _components. */
export default function ConventionsPage() {
  return <ConventionsListView />;
}
