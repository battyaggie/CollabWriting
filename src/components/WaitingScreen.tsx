import { useEffect } from "react";
import { RosterChips } from "@/components/RosterChips";
import { ColorPicker } from "@/components/ColorPicker";
import { colorFor } from "@/lib/colors";
import type { ClassDoc, StudentDoc } from "@/lib/types";

interface Props {
  classId: string;
  studentId: string;
  classData: ClassDoc;
  alias: string;
  colorIndex: number;
  /** everyone who has joined the class so far */
  roster: (StudentDoc & { id: string })[];
  /** the student's group, once the teacher has put them in one */
  groupName: string | null;
  /** the other members of that group */
  groupMates: (StudentDoc & { id: string })[];
}

function Step({ state, children }: { state: "done" | "active" | "todo"; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span
        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-none ${
          state === "done"
            ? "bg-tw-green text-[#14231A]"
            : state === "active"
              ? "border-2 border-tw-blue text-tw-blue animate-pulse"
              : "border-2 border-tw-grey-light text-tw-grey-light"
        }`}
        aria-hidden="true"
      >
        {state === "done" ? "✓" : ""}
      </span>
      <span className={`text-[15px] ${state === "todo" ? "text-tw-grey" : "text-tw-navy"} ${state === "active" ? "font-bold" : ""}`}>
        {children}
      </span>
    </li>
  );
}

/** Shown after joining, until the teacher has formed the groups and started the session. */
export function WaitingScreen({ classId, studentId, classData, alias, colorIndex, roster, groupName, groupMates }: Props) {
  const hasGroup = !!groupName;
  // When this page is shown inside another site (Process Lab's lobby), tell that site the student's group,
  // so it can show it outside the small frame. Only the group name and nicknames are sent, only to the embedding site.
  const mates = groupMates.map((m) => m.alias).join("|");
  useEffect(() => {
    if (!hasGroup || typeof window === "undefined" || window.parent === window) return;
    try {
      const target = document.referrer ? new URL(document.referrer).origin : "";
      if (!target) return;
      window.parent.postMessage(
        { type: "pl-group", group: groupName, you: alias, members: mates ? mates.split("|") : [] },
        target
      );
    } catch {
      /* no embedding site to tell: fine */
    }
  }, [hasGroup, groupName, alias, mates]);
  // Joined after the exercise had already started (or came back on a new device): the other groups are writing.
  const lateJoin = !hasGroup && classData.status === "live";
  return (
    <div className="min-h-screen flex items-center justify-center bg-tw-bg px-6 py-10">
      <div className="w-full max-w-[520px] bg-white border border-tw-grey-light rounded-2xl p-10 flex flex-col gap-6" aria-live="polite">
        <div className="flex flex-col gap-1">
          <span className="font-display text-xs tracking-wide text-tw-blue">TECHNIKUM WIEN</span>
          <h1 className="font-display text-2xl text-tw-navy m-0">You&rsquo;re in, {alias}!</h1>
          <p className="text-sm text-tw-grey m-0">
            {classData.className} &middot; {classData.taskName}
          </p>
        </div>

        <div className="flex flex-col gap-3 bg-tw-bg rounded-xl px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="w-4 h-4 rounded-full inline-block flex-none" style={{ background: colorFor(colorIndex) }} />
            <span className="text-sm text-tw-navy">
              Your colour. Everything you write in the group text will appear in this colour.
            </span>
          </div>
          <ColorPicker classId={classId} studentId={studentId} colorIndex={colorIndex} roster={roster} />
        </div>

        <ol className="list-none p-0 m-0 flex flex-col gap-3">
          <Step state="done">You have joined the class</Step>
          <Step state={hasGroup ? "done" : "active"}>
            {hasGroup
              ? `Your teacher has put you in ${groupName}`
              : lateJoin
                ? "The writing task has already started. Your teacher is putting you in a group"
                : "Your teacher is forming the groups"}
          </Step>
          <Step state={hasGroup ? "active" : "todo"}>
            {lateJoin ? "You join your group’s writing" : "Your teacher starts the writing task"}
          </Step>
        </ol>

        {hasGroup && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-bold text-tw-navy m-0">
              {groupMates.length > 0 ? `Your group: you and ${groupMates.length} other${groupMates.length === 1 ? "" : "s"}` : "Your group"}
            </p>
            <RosterChips people={[{ alias: `${alias} (you)`, colorIndex }, ...groupMates]} />
            <p className="text-xs text-tw-grey m-0">Your teacher may still change the groups before starting.</p>
          </div>
        )}

        <p className="text-sm text-tw-grey m-0">
          Keep this page open &mdash; the writing page appears here by itself when your teacher{" "}
          {lateJoin ? "puts you in a group" : "starts"}. You don&rsquo;t need to refresh.
        </p>

        {!hasGroup && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-bold text-tw-navy m-0">
              In the class so far: {roster.length} {roster.length === 1 ? "person" : "people"}
            </p>
            <RosterChips people={roster} />
          </div>
        )}
      </div>
    </div>
  );
}
