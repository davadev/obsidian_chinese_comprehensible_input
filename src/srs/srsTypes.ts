export type ReviewGrade = "again" | "hard" | "good" | "easy";

export interface ScheduleResult {
  dueAt: string;
  intervalDays: number;
  ease: number;
  lapses: number;
  lastReviewedAt: string;
}
