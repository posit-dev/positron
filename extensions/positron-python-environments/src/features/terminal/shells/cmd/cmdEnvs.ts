import { EnvironmentVariableCollection } from 'vscode';
import { PythonEnvironment } from '../../../../api';
import { traceError } from '../../../../common/logging';
import { ShellConstants } from '../../../common/shellConstants';
import { getShellActivationCommand, getShellCommandAsString } from '../common/shellUtils';
import { ShellEnvsProvider } from '../startupProvider';
import { CMD_ENV_KEY } from './cmdConstants';

export class CmdEnvsProvider implements ShellEnvsProvider {
    readonly shellType: string = ShellConstants.CMD;
    updateEnvVariables(collection: EnvironmentVariableCollection, env: PythonEnvironment): void {
        try {
            const cmdActivation = getShellActivationCommand(this.shellType, env);
            if (cmdActivation) {
                const command = getShellCommandAsString(this.shellType, cmdActivation);
                const v = collection.get(CMD_ENV_KEY);
                if (v?.value === command) {
                    return;
                }
                collection.replace(CMD_ENV_KEY, command);
            } else {
                collection.delete(CMD_ENV_KEY);
            }
        } catch (err) {
            traceError('Failed to update CMD environment variables', err);
            collection.delete(CMD_ENV_KEY);
        }
    }

    removeEnvVariables(envCollection: EnvironmentVariableCollection): void {
        envCollection.delete(CMD_ENV_KEY);
    }

    getEnvVariables(env?: PythonEnvironment): Map<string, string | undefined> | undefined {
        if (!env) {
            return new Map([[CMD_ENV_KEY, undefined]]);
        }

        try {
            const cmdActivation = getShellActivationCommand(this.shellType, env);
            if (cmdActivation) {
                return new Map([[CMD_ENV_KEY, getShellCommandAsString(this.shellType, cmdActivation)]]);
            }
            return undefined;
        } catch (err) {
            traceError('Failed to get CMD environment variables', err);
            return undefined;
        }
    }
}
