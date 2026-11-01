import type { Metadata } from "next";
import { TasksBoard } from "./TasksBoard";

export const metadata: Metadata = { title: "Tasks" };

export default function TasksPage() {
  return <TasksBoard />;
}
