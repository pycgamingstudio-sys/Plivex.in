import { computeRiskScore, getRiskBadge, getRiskAdvice } from "@/lib/clientRiskScore";

export default function ClientRiskBadge({ clientName, showAdvice = false }) {
  const score = computeRiskScore(clientName);
  const badge = getRiskBadge(score);
  const advice = getRiskAdvice(score);

  if (!badge) return null;

  return (
    <div className="inline-flex flex-col gap-1">
      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide ${badge.color}`}>
        {badge.label}
        {score !== null && <span className="ml-1 opacity-75">({score})</span>}
      </span>
      {showAdvice && advice && (
        <p className="text-[10px] text-slate-400">{advice}</p>
      )}
    </div>
  );
}