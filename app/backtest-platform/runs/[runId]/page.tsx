import { RunPage } from "../../../components/backtest/run-page";

export default async function BacktestRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return <RunPage runId={runId} />;
}
