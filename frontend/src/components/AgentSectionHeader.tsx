import { hueForAgent } from "@/lib/agentColor";

export function AgentSectionHeader({ agent }: { agent: string }) {
  const hue = hueForAgent(agent);
  return (
    <div
      data-agent-section={agent}
      className="flex items-center gap-2 px-4 py-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.15em]"
      style={{ color: `hsl(${hue}, 45%, 65%)` }}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: `hsl(${hue}, 60%, 60%)` }}
      />
      {agent}
    </div>
  );
}
