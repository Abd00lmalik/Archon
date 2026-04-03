"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

function labelFromPath(pathname: string) {
  if (pathname === "/") return "Home";
  if (pathname === "/create-job") return "Create Job";
  if (pathname === "/submit-work") return "Submit Work";
  if (pathname === "/approve-job") return "Approve Job";
  if (pathname === "/profile") return "Profile";
  if (pathname.startsWith("/job/")) return "Job Details";
  return "Oris";
}

export function RouteAnnouncer() {
  const pathname = usePathname();
  const [announcement, setAnnouncement] = useState("");

  const label = useMemo(() => labelFromPath(pathname), [pathname]);

  useEffect(() => {
    setAnnouncement(`Navigated to ${label}`);
  }, [label]);

  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {announcement}
    </div>
  );
}
