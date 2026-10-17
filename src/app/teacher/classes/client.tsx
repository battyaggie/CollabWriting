"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import type { ClassDoc } from "@/lib/types";

const STATUS_LABEL: Record<ClassDoc["status"], { label: string; color: string }> = {
  waiting: { label: "Waiting Room", color: "#66A2C4" },
  grouped: { label: "Grouped", color: "#66A2C4" },
  live: { label: "Live", color: "#8BB31D" },
  completed: { label: "Completed", color: "#AAADAF" },
};

export default function MyClassesPage() {
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);
  const [classes, setClasses] = useState<(ClassDoc & { id: string })[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.replace("/teacher/login");
        return;
      }
      setUid(user.uid);
    });
    return () => unsub();
  }, [router]);

  useEffect(() => {
    if (!uid) return;
    // Deliberately no orderBy here: combining it with the where() below would
    // require a Firestore composite index. If that index doesn't exist, the
    // listener errors out silently (no error UI, no thrown exception visible
    // to the user) and `classes` just stays empty forever -- which looked
    // exactly like "you have no classes" even though they existed. Sorting
    // client-side avoids needing that index at all.
    const q = query(collection(db, "classes"), where("teacherId", "==", uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as ClassDoc) }));
        rows.sort((a, b) => b.createdAt - a.createdAt);
        setClasses(rows);
        setLoaded(true);
      },
      (err) => {
        console.error("Failed to load classes", err);
        setLoaded(true);
      }
    );
    return () => unsub();
  }, [uid]);

  function statusHref(c: ClassDoc & { id: string }) {
    if (c.status === "waiting") return `/teacher/classes/${c.id}/waiting-room`;
    if (c.status === "grouped") return `/teacher/classes/${c.id}/assign-groups`;
    return `/teacher/classes/${c.id}/dashboard`;
  }

  return (
    <div className="min-h-screen bg-tw-bg">
      <div className="max-w-3xl mx-auto px-6 py-10 flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <span className="font-display text-xs tracking-wide text-tw-blue">TECHNIKUM WIEN</span>
            <h1 className="font-display text-2xl text-tw-navy m-0">My Classes</h1>
          </div>
          <button className="text-sm text-tw-grey underline" onClick={() => signOut(auth)}>
            Sign out
          </button>
        </div>

        <Link href="/teacher/classes/new" className="tw-btn tw-btn-primary self-start">
          + New Class
        </Link>

        <div className="flex flex-col gap-3">
          {loaded && classes.length === 0 && (
            <p className="text-sm text-tw-grey">No classes yet — create your first one above.</p>
          )}
          {classes.map((c) => (
            <Link
              href={statusHref(c)}
              key={c.id}
              className="bg-white border border-tw-grey-light rounded-xl p-5 flex items-center justify-between hover:border-tw-blue-light"
            >
              <div>
                <p className="font-display text-base text-tw-navy m-0">
                  {c.semester} &middot; {c.className}
                </p>
                <p className="text-sm text-tw-grey m-0">{c.taskName}</p>
              </div>
              <span
                className="text-xs font-bold rounded-full px-3 py-1.5 text-white"
                style={{ background: STATUS_LABEL[c.status].color }}
              >
                {STATUS_LABEL[c.status].label}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
