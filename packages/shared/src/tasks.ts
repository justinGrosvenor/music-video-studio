import { z } from "zod";

export const TaskStatus = z.enum([
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const Task = z.object({
  id: z.string(),
  status: TaskStatus,
  progress: z.number().min(0).max(1).optional(),
  output: z.array(z.string()).optional(),
  error: z.string().optional(),
  createdAt: z.string(),
});
export type Task = z.infer<typeof Task>;
