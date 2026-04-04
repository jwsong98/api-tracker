import { Command } from "commander";
import { login, getAuthStatus } from "../../core/auth-manager.js";
import { loadConfig } from "../../storage/config-loader.js";

export function authCommand(): Command {
  const auth = new Command("auth").description("Manage authentication profiles");

  auth
    .command("login")
    .requiredOption("--profile <name>", "Auth profile name")
    .action(async (opts: { profile: string }) => {
      const result = await login(opts.profile);
      const masked = result.token.length > 20
        ? result.token.slice(0, 20) + "..."
        : result.token;
      console.log(
        JSON.stringify({
          profile: opts.profile,
          token: masked,
          cached: true,
        }),
      );
    });

  auth
    .command("status")
    .action(async () => {
      const config = await loadConfig();
      const cache = await getAuthStatus();
      const profiles: Record<string, { cached: boolean; note: string }> = {};

      for (const [name, profile] of Object.entries(config.auth.profiles)) {
        const entry = cache[name];
        profiles[name] = {
          cached: !!entry?.token,
          note: entry?.note ?? profile.note,
        };
      }

      console.log(JSON.stringify({ profiles }));
    });

  return auth;
}
