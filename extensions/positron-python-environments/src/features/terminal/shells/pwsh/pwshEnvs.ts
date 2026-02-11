import { EnvironmentVariableCollection } from 'vscode';
import { PythonEnvironment } from '../../../../api';
import { traceError } from '../../../../common/logging';
import { ShellConstants } from '../../../common/shellConstants';
import { getShellActivationCommand, getShellCommandAsString } from '../common/shellUtils';
import { ShellEnvsProvider } from '../startupProvider';
import { POWERSHELL_ENV_KEY } from './pwshConstants';

export class PowerShellEnvsProvider implements ShellEnvsProvider {
    public readonly shellType: string = ShellConstants.PWSH;

    updateEnvVariables(collection: EnvironmentVariableCollection, env: PythonEnvironment): void {
        try {
            const pwshActivation = getShellActivationCommand(this.shellType, env);
            if (pwshActivation) {
                const command = getShellCommandAsString(this.shellType, pwshActivation);
                const v = collection.get(POWERSHELL_ENV_KEY);
                if (v?.value === command) {
                    return;
                }
                collection.replace(POWERSHELL_ENV_KEY, command);
            } else {
                collection.delete(POWERSHELL_ENV_KEY);
            }
        } catch (err) {
            traceError('Failed to update PowerShell environment variables', err);
            collection.delete(POWERSHELL_ENV_KEY);
        }
    }

    removeEnvVariables(envCollection: EnvironmentVariableCollection): void {
        envCollection.delete(POWERSHELL_ENV_KEY);
    }

    getEnvVariables(env?: PythonEnvironment): Map<string, string | undefined> | undefined {
        if (!env) {
            return new Map([[POWERSHELL_ENV_KEY, undefined]]);
        }

        try {
            const pwshActivation = getShellActivationCommand(this.shellType, env);
            if (pwshActivation) {
                return new Map([[POWERSHELL_ENV_KEY, getShellCommandAsString(this.shellType, pwshActivation)]]);
            }
            return undefined;
        } catch (err) {
            traceError('Failed to get PowerShell environment variables', err);
            return undefined;
        }
    }
}
