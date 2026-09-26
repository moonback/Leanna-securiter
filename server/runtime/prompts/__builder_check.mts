import { SystemPromptBuilder } from "./SystemPromptBuilder.js";

function sectionsFor(label: string, cfg: any) {
  const b = new SystemPromptBuilder();
  const built = b.buildFull(cfg);
  const ids = built.sections.map(s => `${s.id}(p${s.priority})`);
  console.log(`\n=== ${label} ===`);
  console.log(ids.join(", "));
}

// full mode, agents on, no tools known
sectionsFor("full / agents on / no tools", { mode: "full", agents: { enabled: true } });

// full mode with browser + security tools available
sectionsFor("full / tools: browser_ + security_audit", {
  mode: "full",
  agents: { enabled: true },
  tools: { available: ["browser_navigate", "security_audit"], enabled: [] },
});

// ask mode -> chat should appear, base/autonomy/agents should not (scope full/agent)
sectionsFor("ask mode", { mode: "ask", agents: { enabled: false } });

// full mode, allowedRoles subset that excludes security fleet
sectionsFor("full / allowedRoles=[coder] / security_audit tool", {
  mode: "full",
  agents: { enabled: true, allowedRoles: ["coder"] },
  tools: { available: ["security_audit"], enabled: [] },
});

// full mode, allowedRoles includes a security role + security tool
sectionsFor("full / allowedRoles=[sast_analyzer] / security_audit tool", {
  mode: "full",
  agents: { enabled: true, allowedRoles: ["sast_analyzer"] },
  tools: { available: ["security_audit"], enabled: [] },
});
