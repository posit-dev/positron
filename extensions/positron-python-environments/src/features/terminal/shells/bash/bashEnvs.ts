import { EnvironmentVariableCollection } from 'vscode';
import { PythonEnvironment } from '../../../../api';
import { traceError } from '../../../../common/logging';
import { ShellConstants } from '../../../common/shellConstants';
import { getShellActivationCommand, getShellCommandAsString } from '../common/shellUtils';
import { ShellEnvsProvider } from '../startupProvider';
import { BASH_ENV_KEY, ZSH_ENV_KEY } from './bashConstants';

export class BashEnvsProvider implements ShellEnvsProvider {
    constructor(public readonly shellType: 'bash' | 'gitbash') {}

    updateEnvVariables(collection: EnvironmentVariableCollection, env: PythonEnvironment): void {
        try {
            const bashActivation = getShellActivationCommand(this.shellType, env);
            if (bashActivation) {
                const command = getShellCommandAsString(this.shellType, bashActivation);
                const v = collection.get(BASH_ENV_KEY);
                if (v?.value === command) {
                    return;
                }
                collection.replace(BASH_ENV_KEY, command);
            } else {
                collection.delete(BASH_ENV_KEY);
            }
        } catch (err) {
            traceError(`Failed to update env variables for ${this.shellType}`, err);
            collection.delete(BASH_ENV_KEY);
        }
    }

    removeEnvVariables(envCollection: EnvironmentVariableCollection): void {
        envCollection.delete(BASH_ENV_KEY);
    }

    getEnvVariables(env?: PythonEnvironment): Map<string, string | undefined> | undefined {
        if (!env) {
            return new Map([[BASH_ENV_KEY, undefined]]);
        }

        try {
            const bashActivation = getShellActivationCommand(this.shellType, env);
            if (bashActivation) {
                const command = getShellCommandAsString(this.shellType, bashActivation);
                return new Map([[BASH_ENV_KEY, command]]);
            }
            return undefined;
        } catch (err) {
            traceError(`Failed to get env variables for ${this.shellType}`, err);
            return undefined;
        }
    }
}

export class ZshEnvsProvider implements ShellEnvsProvider {
    public readonly shellType: string = ShellConstants.ZSH;
    updateEnvVariables(collection: EnvironmentVariableCollection, env: PythonEnvironment): void {
        try {
            const zshActivation = getShellActivationCommand(this.shellType, env);
            if (zshActivation) {
                const command = getShellCommandAsString(this.shellType, zshActivation);
                const v = collection.get(ZSH_ENV_KEY);
                if (v?.value === command) {
                    return;
                }
                collection.replace(ZSH_ENV_KEY, command);
            } else {
                collection.delete(ZSH_ENV_KEY);
            }
        } catch (err) {
            traceError('Failed to update env variables for zsh', err);
            collection.delete(ZSH_ENV_KEY);
        }
    }

    removeEnvVariables(collection: EnvironmentVariableCollection): void {
        collection.delete(ZSH_ENV_KEY);
    }

    getEnvVariables(env?: PythonEnvironment): Map<string, string | undefined> | undefined {
        if (!env) {
            return new Map([[ZSH_ENV_KEY, undefined]]);
        }

        try {
            const zshActivation = getShellActivationCommand(this.shellType, env);
            if (zshActivation) {
                const command = getShellCommandAsString(this.shellType, zshActivation);
                return new Map([[ZSH_ENV_KEY, command]]);
            }
            return undefined;
        } catch (err) {
            traceError('Failed to get env variables for zsh', err);
            return undefined;
        }
    }
}
