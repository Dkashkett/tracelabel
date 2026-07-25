import { hueForAgent } from "@/lib/agentColor";

export function AgentSectionHeader({ agent }: { agent: string }) {
  const hue = hueForAgent(agent);
  return (
    <div
      data-agent-section={agent}
      className="flex items-center gap-1.5 px-4 py-1 text-[10px] font-semibold uppercase tracking-wide"
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
