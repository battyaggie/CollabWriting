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
}

export interface RunDoc {
  studentId: string;
  alias: string;
  colorIndex: number;
  text: string;
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
