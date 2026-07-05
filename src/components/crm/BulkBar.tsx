import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { STATUSES } from "@/lib/crm-utils";
import type { LeadStatus } from "@/lib/types";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Props {
  count: number;
  onClear: () => void;
  onStatus: (s: LeadStatus) => void;
  onDelete: () => void;
  onExport: () => void;
}

export function BulkBar({ count, onClear, onStatus, onDelete, onExport }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <>
      <AnimatePresence>
        {count > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 bg-foreground text-background border border-foreground px-4 py-2 flex items-center gap-5 flex-wrap max-w-[95vw]"
          >
            <span className="mono">{String(count).padStart(3, "0")} selected</span>
            <select
              onChange={(e) => { if (e.target.value) onStatus(e.target.value as LeadStatus); e.target.value=""; }}
              defaultValue=""
              className="mono bg-transparent border border-background/40 text-background px-2 py-1"
            >
              <option value="" disabled className="text-foreground">Set status…</option>
              {STATUSES.map((s) => <option key={s} value={s} className="text-foreground">{s}</option>)}
            </select>
            <button onClick={onExport} className="mono hover:opacity-70">[ EXPORT ]</button>
            <button onClick={() => setConfirmOpen(true)} className="mono text-[color:var(--sienna)] hover:opacity-70">[ DELETE ]</button>
            <button onClick={onClear} className="mono opacity-70 hover:opacity-100">[ CLEAR ]</button>
          </motion.div>
        )}
      </AnimatePresence>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="border border-foreground bg-background rounded-none">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-3xl font-normal">
              Delete {count} lead{count === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              This can't be undone. The selected leads will be removed from your collection.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="mono rounded-none border border-border">[ CANCEL ]</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { onDelete(); setConfirmOpen(false); }}
              className="mono rounded-none bg-foreground text-background hover:bg-foreground/90"
            >
              [ DELETE ]
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
