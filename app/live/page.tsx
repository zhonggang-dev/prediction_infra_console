import { redirect } from "next/navigation";
import { legacyTradingDestination } from "../lib/trading-navigation";

export default async function LegacyTradingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(legacyTradingDestination("orders", await searchParams));
}
