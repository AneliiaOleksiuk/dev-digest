import { CiRunsView } from "./_components/CiRunsView";

/* Route: /ci-runs (CI Runs, AC-61..AC-70). Thin route entry — CiRunsView
   owns the actual UI, styles, helpers and data fetching. */
export default function CiRunsPage() {
  return <CiRunsView />;
}
