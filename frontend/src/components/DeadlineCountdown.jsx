import { useEffect, useState } from "react";

function remaining(deadline) {
  const diff = deadline * 1000 - Date.now();
  if (diff <= 0) return null;
  const s = Math.floor(diff / 1000);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

/** Live countdown to the submission deadline (docs/ARCHITECTURE.md §2.6 R2). */
export default function DeadlineCountdown({ deadline }) {
  const [, forceTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const text = remaining(deadline);
  if (text === null) return <span className="countdown countdown-passed">Deadline passed</span>;
  return <span className="countdown">{text} left</span>;
}
