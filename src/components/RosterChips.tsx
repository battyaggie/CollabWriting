import { colorFor } from "@/lib/colors";

export function RosterChips({
  people,
}: {
  people: { alias: string; colorIndex: number }[];
}) {
  return (
    <div className="flex flex-wrap gap-2.5">
      {people.map((p, i) => (
        <span className="tw-chip" key={`${p.alias}-${i}`}>
          <span
            className="w-3 h-3 rounded-full inline-block"
            style={{ background: colorFor(p.colorIndex) }}
          />
          <span className="text-sm text-tw-navy">{p.alias}</span>
        </span>
      ))}
    </div>
  );
}
