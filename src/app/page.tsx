import Link from "next/link";

export default function HomePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-tw-bg">
      <div className="w-[420px] bg-white border border-tw-grey-light rounded-2xl p-10 flex flex-col gap-5 text-center">
        <div>
          <span className="font-display text-sm tracking-wide text-tw-blue">TECHNIKUM WIEN</span>
          <h1 className="font-display text-2xl text-tw-navy mt-1">Collaborative Writing</h1>
        </div>
        <Link href="/join" className="tw-btn tw-btn-primary">
          I&rsquo;m a student &mdash; join a class
        </Link>
        <Link href="/teacher/login" className="text-sm text-tw-grey underline">
          Teaching this class? Sign in
        </Link>
      </div>
    </div>
  );
}
