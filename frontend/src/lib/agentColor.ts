// A stable, deterministic accent hue per agent name (same name -> same hue across
// renders and sessions), so a sub-agent's section header and any per-agent chips
// stay visually consistent as you scroll through a trace.
export function hueForAgent(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (Math.imul(hash, 31) + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}
