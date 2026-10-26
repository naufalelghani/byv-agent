import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const commandUrl = new URL("../commands/autonomous.md", import.meta.url);

async function loadControlPlaneProtocol() {
  const command = await readFile(commandUrl, "utf8");
  const heading = "### MCP control-plane run protocol (P5.2/P5.3)";
  const start = command.indexOf(heading);
  assert.notEqual(start, -1, "autonomous command must document the MCP run protocol");
  const end = command.indexOf("\n## Autonomy and safety", start);
  assert.notEqual(end, -1, "MCP protocol section must have a clear boundary");
  return command.slice(start, end);
}

test("autonomous workflow retains required P5.2 control-plane tool calls", async () => {
  const protocol = await loadControlPlaneProtocol();
  for (const tool of [
    "byv_runtime_status",
    "byv_registry_status",
    "byv_begin_run",
    "byv_record_plan",
    "byv_prepare_agent",
    "byv_update_task",
    "byv_record_handoff",
    "byv_record_verification",
    "byv_finish_run",
    "byv_get_run_summary",
    "byv_resume_run",
  ]) {
    assert.ok(protocol.includes(tool), "missing required tool: " + tool);
  }

  assert.ok(protocol.indexOf("byv_runtime_status") < protocol.indexOf("byv_begin_run"),
    "preflight must precede run creation");
  assert.ok(protocol.indexOf("byv_registry_status") < protocol.indexOf("byv_begin_run"),
    "registry validation must precede run creation");
  assert.ok(protocol.indexOf("byv_begin_run") < protocol.indexOf("byv_record_plan"),
    "run creation must precede canonical plan persistence");
  assert.ok(protocol.indexOf("byv_record_plan") < protocol.indexOf("byv_prepare_agent"),
    "the plan must be persisted before worker preparation");
  assert.ok(protocol.indexOf("byv_finish_run") < protocol.indexOf("byv_get_run_summary"),
    "final disposition must precede the final summary read");
});

test("autonomous workflow keeps dispatch and acceptance evidence truthful", async () => {
  const protocol = await loadControlPlaneProtocol();
  assert.match(protocol, /does not spawn or message an agent/i);
  assert.match(protocol, /only when that command or case actually ran/i);
  assert.match(protocol, /selected execution mode equals the mode proven by dispatch/i);
  assert.match(protocol, /Morgan review the integrated diff and evidence with read-only tools/i);
  assert.match(protocol, /re-evaluate and re-execute interrupted work/i);
});
