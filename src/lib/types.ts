export type ClassStatus = "waiting" | "grouped" | "live" | "completed";

export interface ClassDoc {
  classCode: string; // also the Firestore document id
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
}

export interface StudentSession {
  classId: string;
  studentId: string;
  alias: string;
}
