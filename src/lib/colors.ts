// Student/reviewer color palette (matches the Technikum Wien design mockups).
// Red is reserved for the teacher (see TEACHER_COLOR below), so no student colour is red.
export const STUDENT_COLORS = [
  "#8A6D00",
  "#6A4C93",
  "#1B998B",
  "#2C7DA0",
  "#A7226E",
  "#B9D177",
  "#E8871E",
  "#323F4F",
  "#66A2C4",
  "#8BB31D",
  "#00649C",
  "#72777A",
];

/** The teacher's colour index. It is not part of the student palette, so no student can ever get it. */
export const TEACHER_COLOR_INDEX = -1;
/** The teacher is always in red. */
export const TEACHER_COLOR = "#D00000";
/** The name the teacher's text and comments are shown under. */
export const TEACHER_ALIAS = "Teacher";

export function isTeacherColor(index: number): boolean {
  return index === TEACHER_COLOR_INDEX;
}

export function colorFor(index: number): string {
  if (index === TEACHER_COLOR_INDEX) return TEACHER_COLOR;
  return STUDENT_COLORS[((index % STUDENT_COLORS.length) + STUDENT_COLORS.length) % STUDENT_COLORS.length];
}
