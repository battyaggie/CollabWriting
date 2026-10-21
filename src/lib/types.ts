export type ClassStatus = "waiting" | "grouped" | "live" | "completed";

/**
 * A class that meets regularly (e.g. "BMR"). Students always use the same code; the teacher opens
 * one writing exercise per week inside it. Each exercise is a ClassDoc whose `courseId` is this code.
 */
export interface CourseDoc {
  courseCode: string; // also the Firestore document id
  teacherId: string;
  semester: string;
  className: string;
  /** default group size for new exercises */
  targetGroupSize: number;
  /** the exercise students join when they enter the class code */
  activeExerciseId: string | null;
  createdAt: number;
}

export interface ClassDoc {
  classCode: string; // also the Firestore document id
  /** The class (CourseDoc) this exercise belongs to; missing on single sessions made before classes existed. */
  courseId?: string | null;
  teacherId: string;
  semester: string; // e.g. "WS 2026/27"
  className: string; // e.g. "3AHITM"
  taskName: string; // e.g. "Writing an Email"
  targetGroupSize: number;
  status: ClassStatus;
  hotSeatGroupId: string | null;
  nextColorIndex: number;
  createdAt: number;
}

export interface StudentDoc {
  alias: string;
  colorIndex: number;
  groupId: string | null;
  joinedAt: number;
}

export interface GroupDoc {
  name: string; // e.g. "Group 1"
  memberIds: string[];
  createdAt: number;
  /** The group whose writing this group reviews and gives feedback on (set by the teacher). */
  reviewsGroupId?: string | null;
  /** A copy of this group's text taken when another group was first linked to review it. */
  original?: OriginalText;
}

export interface OriginalText {
  takenAt: number;
  /** One entry per paragraph (an array of arrays is not allowed in Firestore, hence the wrapper object). */
  paragraphs: { segments: Segment[] }[];
}

/** A stretch of text written by one student. A paragraph is a list of these. */
export interface Segment {
  studentId: string;
  alias: string;
  colorIndex: number;
  text: string;
}

export interface RunDoc {
  /** Who started this paragraph (used as the author of text with no segments, e.g. older documents). */
  studentId: string;
  alias: string;
  colorIndex: number;
  /** The whole paragraph as plain text (always kept in sync with `segments`). */
  text: string;
  /** Who wrote which part of the paragraph. Missing on older documents. */
  segments?: Segment[];
  order: number;
  updatedAt: number;
}

export interface FeedbackDoc {
  studentId: string;
  alias: string;
  colorIndex: number;
  text: string;
  createdAt: number;
  /** Set when the comment is about a highlighted part of the text: the highlighted words... */
  quote?: string;
  /** ...and where they were in the text (character positions) when the comment was made. */
  start?: number;
  end?: number;
}

export interface StudentSession {
  classId: string;
  studentId: string;
  alias: string;
}
