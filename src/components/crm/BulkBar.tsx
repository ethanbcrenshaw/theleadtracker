import { Trash2, Download, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { STATUSES } from "@/lib/crm-utils";
import type { LeadStatus } from "@/lib/types";

interface Props {
  count: number;
  onClear: () => void;
  onStatus: (s: LeadStatus) => void;
  onDelete: () => void;
  onExport: () => void;
}

export function BulkBar({ count, onClear, onStatus, onDelete, onExport }: Props) {
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 bg-navy text-navy-foreground rounded-2xl shadow-elev px-3 py-2 flex items-center gap-2 flex-wrap max-w-[95vw]"
        >
          <span className="text-xs font-medium px-2">{count} selected</span>
          <select onChange={(e) => { if (e.target.value) onStatus(e.target.value as LeadStatus); e.target.value=""; }}
                  defaultValue="" className="bg-white/10 text-navy-foreground rounded-lg px-2 py-1 text-xs">
            <option value="" disabled>Set status…</option>
            {STATUSES.map((s) => <option key={s} value={s} className="text-foreground">{s}</option>)}
          </select>
          <button onClick={onExport} className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs inline-flex items-center gap-1">
            <Download className="h-3 w-3" /> Export
          </button>
          <button onClick={onDelete} className="px-2.5 py-1 rounded-lg bg-clay/80 hover:bg-clay text-xs inline-flex items-center gap-1">
            <Trash2 className="h-3 w-3" /> Delete
          </button>
          <button onClick={onClear} className="p-1 rounded-lg hover:bg-white/10"><X className="h-3.5 w-3.5" /></button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
