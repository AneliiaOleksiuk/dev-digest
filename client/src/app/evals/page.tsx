import { EvalDashboardView } from "./_components/EvalDashboardView";

/* Route: /evals (Eval Dashboard, AC-36). Thin route entry — the view and
   its child _components/AgentEvalDetail, _components/EvalCompareView own
   the actual UI, styles, helpers and data fetching. */
export default function EvalsPage() {
  return <EvalDashboardView />;
}
