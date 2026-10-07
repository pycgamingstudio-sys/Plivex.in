import { useState, useEffect, useRef } from "react";
import { searchHSN } from "@/lib/hsnData";

export default function HSNAutocomplete({ value, onChange, onSelect, placeholder, className, style }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!value || value.length < 2) { setSuggestions([]); setOpen(false); return; }
    timerRef.current = setTimeout(() => {
      const results = searchHSN(value, 5);
      setSuggestions(results);
      setOpen(results.length > 0);
    }, 200);
    return () => clearTimeout(timerRef.current);
  }, [value]);

  useEffect(() => {
    const handler = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={wrapRef} className="relative w-full">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={className}
        style={style}
        autoComplete="off"
        onFocus={() => suggestions.length > 0 && setOpen(true)}
      />
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-xl border border-[#E5E7EB] bg-white shadow-xl">
          {suggestions.map((s) => (
            <button
              key={s.hsn_code}
              type="button"
              className="flex w-full items-start gap-3 px-3 py-2.5 text-left text-[12px] hover:bg-slate-50"
              onMouseDown={(e) => { e.preventDefault(); onSelect(s); setOpen(false); }}
            >
              <span className="mt-0.5 shrink-0 rounded-md bg-[#6D28D9]/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#6D28D9]">{s.hsn_code}</span>
              <div>
                <p className="font-semibold text-slate-800 line-clamp-1">{s.description}</p>
                <p className="text-[10px] text-slate-400">GST: {s.gst_rate}%</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}