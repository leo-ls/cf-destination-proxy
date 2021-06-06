#!/usr/bin/env node

const { Command, Option } = require("commander");

const { version } = require("../package.json");

const program = new Command();
program.version(version);
program.addHelpText("beforeAll", `cf-destination-proxy v${version}\n`);

const envPath = new Option(
  "-e, --env-path <path>",
  "path to the binding .env file(s)"
);
envPath.default(".", "current directory");
const port = new Option("-p, --port <number>", "local proxy port");
port.defaultValue = 8887;

const bind = new Command("bind");

bind
  .arguments("<route>")
  .description(
    "generates .env file that binds the local proxy to the deployed proxy",
    {
      route:
        "[REQUIRED] the deployed proxy route, " +
        "e.g. <...>cf-destination-proxy.cfapps.<region>.hana.ondemand.com",
    }
  )
  .addOption(envPath)
  .addOption(port)
  .action(require("./commands/bind"));

program.addCommand(bind);

const run = new Command("run");

const log = new Option("-l, --log", "log each request and its destination");
log.defaultValue = false;

run
  .description("run the local proxy")
  .addOption(envPath)
  .addOption(log)
  .addOption(port)
  .action(require("./commands/run"));

program.addCommand(run);

(async () => {
  try {
    await program.parseAsync();
  } catch (error) {
    console.error("[error]", error.message);
  }
})();
