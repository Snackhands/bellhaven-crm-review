import { useEffect, useState } from "react";

export function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function UtcClock() {
  const now = useClock();
  return (
    <time className="utc-clock" dateTime={now.toISOString()} aria-label="Current UTC time">
      <strong>{now.toISOString().slice(11, 19)} UTC</strong>
      <span>{now.toLocaleDateString("en", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })}</span>
    </time>
  );
}
