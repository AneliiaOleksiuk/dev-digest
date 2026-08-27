import { AgentPerformanceView } from "./_components/AgentPerformanceView";

/* Route: /agent-performance (SPEC-06 WI11). Thin route entry — same shape as
   /ci-runs → CiRunsView. AgentPerformanceView owns the actual UI, styles,
   helpers and data fetching. */
export default function AgentPerformancePage() {
  return <AgentPerformanceView />;
}
