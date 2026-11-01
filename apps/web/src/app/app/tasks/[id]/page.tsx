import type { Metadata } from "next";
import Link from "next/link";
import { TaskPageView } from "./TaskPageView";

export const metadata: Metadata = { title: "Task" };

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/app/tasks" className="text-xs text-slate-400 hover:text-white">
        ← All tasks
      </Link>
      <TaskPageView id={id} />
    </div>
  );
}
