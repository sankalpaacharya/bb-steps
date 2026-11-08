import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Note({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("px-2.5 py-1.5 text-sm text-muted-foreground", className)}>
      {children}
    </p>
  );
}
