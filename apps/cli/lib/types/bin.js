#!/usr/bin/env node
/**
 * dsh — command-line entry. Dynamic imports per mode keep unrelated modes out
 * of each dispatch path; the adapter prints and exits for
 * `--help`/`--version`/a parse error, so only a valid mode reaches the switch.
 * @module @deepseek-ai/dsh/bin
 */
/* v8 ignore file -- built-bin acceptance exercises this self-executing dispatch. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot';
import { parseDshArgs } from "./args.js";
// Both the source tree (apps/cli/src) and the bundled bin (apps/cli/lib) sit
// one directory under apps/cli, so the checked-in manifest resolves with the
// same relative hop from either artifact.
/** This app's version, read from its checked-in package.json. */
function readVersion() {
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0';
}
const invocation = parseDshArgs(process.argv.slice(2), readVersion());
switch (invocation.mode) {
    case 'profile': {
        const { runProfile } = await import("./profile-boot.js");
        // Single-writer guard for the web profile: two servers appending the same
        // session store is what corrupts session logs (seq gaps). App `--help`
        // boots nothing, so it bypasses the guard.
        if (invocation.profile === 'web'
            && !invocation.args.some(argument => argument === '--help' || argument === '-h')
            && process.env.DSH_GUI_FORCE_WEB !== '1') {
            const { guardWebServer, portFromArgs } = await import("./web-lock.js");
            const guard = guardWebServer(portFromArgs(invocation.args));
            if (guard.status === 'refused') {
                console.log(guard.message);
                process.exit(0);
            }
        }
        await runProfile({
            environment: loadLayeredEnv('dsh'),
            profile: invocation.profile,
            patchFiles: invocation.patches,
            args: invocation.args,
        });
        break;
    }
    case 'plugin': {
        const { runPlugin } = await import("./plugin.js");
        process.exit(runPlugin(invocation.profile, invocation.args));
        break;
    }
    case 'dump-config': {
        const { runDumpConfig } = await import("./dump-config.js");
        runDumpConfig(invocation.profile, invocation.defaultOnly, invocation.patches);
        break;
    }
    default:
        invocation;
        throw new Error(`dsh: unhandled invocation mode ${JSON.stringify(invocation)}`);
}
//# sourceMappingURL=bin.js.map