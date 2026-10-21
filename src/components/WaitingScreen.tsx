import { RosterChips } from "@/components/RosterChips";
import { colorFor } from "@/lib/colors";
import type { ClassDoc, StudentDoc } from "@/lib/types";

interface Props {
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
export function WaitingScreen({ classData, alias, colorIndex, roster, groupName, groupMates }: Props) {
  const hasGroup = !!groupName;
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

        <div className="flex items-center gap-3 bg-tw-bg rounded-xl px-4 py-3">
          <span className="w-4 h-4 rounded-full inline-block flex-none" style={{ background: colorFor(colorIndex) }} />
          <span className="text-sm text-tw-navy">
            Your colour. Everything you write in the group text will appear in this colour.
          </span>
        </div>

        <ol className="list-none p-0 m-0 flex flex-col gap-3">
          <Step state="done">You have joined the class</Step>
          <Step state={hasGroup ? "done" : "active"}>
            {hasGroup ? `Your teacher has put you in ${groupName}` : "Your teacher is forming the groups"}
          </Step>
          <Step state={hasGroup ? "active" : "todo"}>Your teacher starts the writing task</Step>
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
          Keep this page open &mdash; the writing page appears here by itself when your teacher starts. You don&rsquo;t
          need to refresh.
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
