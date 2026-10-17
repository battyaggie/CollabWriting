import { privacyNotice } from "@/lib/config";

interface Props {
  /** Small bold label above the notice (used on the teacher screens). */
  label?: string;
  /** Small grey line below the notice. */
  caption?: string;
}

export function PrivacyNotice({ label, caption }: Props) {
  return (
    <div className="bg-[#EAF1F5] border border-tw-blue-light rounded-lg p-3 flex flex-col gap-1 text-left">
      {label && <span className="text-xs font-bold text-tw-navy">{label}</span>}
      <span className="text-xs leading-relaxed text-tw-navy">
        <strong>{privacyNotice.title}</strong> {privacyNotice.body}
      </span>
      {caption && <span className="text-xs text-tw-grey mt-1">{caption}</span>}
    </div>
  );
}
