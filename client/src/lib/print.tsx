// Print machinery ported from the original (PrintPortal, App.tsx:1278 + the
// "commit state before window.print()" sequencing at 11336): documents render
// into a body-level portal; @media print hides #root and shows only the portal.
import { useEffect } from "react";
import { createPortal } from "react-dom";

export function PrintPortal({ children, onDone }: {
  children: React.ReactNode;
  onDone: () => void;
}) {
  useEffect(() => {
    // The portal content is committed to the DOM by the time this effect runs;
    // print on the next frame so styles are applied.
    const frame = requestAnimationFrame(() => {
      window.print();
      onDone();
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return createPortal(<div className="print-portal">{children}</div>, document.body);
}
