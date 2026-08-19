import { LiveTradingPage } from "../components/live-trading-page";

export default function LivePage() {
  return <LiveTradingPage previewObservedAt={new Date().toISOString()} />;
}
