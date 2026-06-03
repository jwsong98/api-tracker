#!/usr/bin/env node

import { Command } from "commander";
import { sessionCommand } from "./commands/session.js";
import { authCommand } from "./commands/auth.js";
import { callCommand } from "./commands/call.js";
import { replayCommand } from "./commands/replay.js";
import { dbCommand } from "./commands/db.js";
import { flowCommand } from "./commands/flow.js";
import { initCommand } from "./commands/init.js";

const program = new Command()
  .name("api-tracker")
  .description("API 호출 기록 및 Replay CLI")
  .version("0.1.0")
  .option("--human", "사람이 읽기 쉬운 출력 형식");

program.addCommand(sessionCommand());
program.addCommand(initCommand());
program.addCommand(authCommand());
program.addCommand(callCommand());
program.addCommand(replayCommand());
program.addCommand(dbCommand());
program.addCommand(flowCommand());

program.parseAsync(process.argv).catch((err: unknown) => {
  console.log(JSON.stringify({ error: (err as Error).message, details: {} }));
  process.exit(1);
});
