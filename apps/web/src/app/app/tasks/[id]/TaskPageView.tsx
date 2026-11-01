"use client";

import { Card } from "@/components/Card";
import { TaskDetailView } from "@/components/TaskDetail";
import { useAzzy } from "@/store/useAzzy";

export function TaskPageView({ id }: { id: string }) {
  const title = useAzzy((s) => s.tasks.find((t) => t.id === id)?.title);
  return (
    <div>
      <h1 className="mb-4 mt-2 text-xl font-semibold tracking-tight text-white md:text-2xl">{title ?? "Task"}</h1>
      <Card className="p-4">
        <TaskDetailView taskId={id} initialTab="messages" />
      </Card>
    </div>
  );
}
