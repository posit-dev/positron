import { isWindows } from '../../../common/utils/platformUtils';
import { ShellConstants } from '../../common/shellConstants';
import { BashEnvsProvider, ZshEnvsProvider } from './bash/bashEnvs';
import { BashStartupProvider, GitBashStartupProvider, ZshStartupProvider } from './bash/bashStartup';
import { CmdEnvsProvider } from './cmd/cmdEnvs';
import { CmdStartupProvider } from './cmd/cmdStartup';
import { FishEnvsProvider } from './fish/fishEnvs';
import { FishStartupProvider } from './fish/fishStartup';
import { PowerShellEnvsProvider } from './pwsh/pwshEnvs';
import { PwshStartupProvider } from './pwsh/pwshStartup';
import { ShellEnvsProvider, ShellStartupScriptProvider } from './startupProvider';

export function createShellStartupProviders(): ShellStartupScriptProvider[] {
    if (isWindows()) {
        return [
            // PowerShell classic is the default on Windows, so it is included here explicitly.
            // pwsh is the new PowerShell Core, which is cross-platform and preferred.
            new PwshStartupProvider([ShellConstants.PWSH, 'powershell']),
            new GitBashStartupProvider(),
            new CmdStartupProvider(),
        ];
    }
    return [
        new PwshStartupProvider([ShellConstants.PWSH]),
        new BashStartupProvider(),
        new FishStartupProvider(),
        new ZshStartupProvider(),
    ];
}

export function createShellEnvProviders(): ShellEnvsProvider[] {
    if (isWindows()) {
        return [new PowerShellEnvsProvider(), new BashEnvsProvider(ShellConstants.GITBASH), new CmdEnvsProvider()];
    }
    return [
        new PowerShellEnvsProvider(),
        new BashEnvsProvider(ShellConstants.BASH),
        new FishEnvsProvider(),
        new ZshEnvsProvider(),
    ];
}

export async function clearShellProfileCache(providers: ShellStartupScriptProvider[]): Promise<void> {
    await Promise.all(providers.map((provider) => provider.clearCache()));
}
