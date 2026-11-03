import { redirect } from "next/navigation";
import { predictionTasksRedirect } from "../../lib/console-workspace";

export default async function PredictionTasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") query.set(key, value);
  redirect(predictionTasksRedirect(query));
}
