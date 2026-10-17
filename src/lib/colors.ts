// Student/reviewer color palette (matches the Technikum Wien design mockups).
export const STUDENT_COLORS = [
  "#C1440E",
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

export function colorFor(index: number): string {
  return STUDENT_COLORS[((index % STUDENT_COLORS.length) + STUDENT_COLORS.length) % STUDENT_COLORS.length];
}
