import { l10n, ProgressLocation } from 'vscode';
import { executeCommand } from '../../common/command.api';
import { ActivationStrings, Common } from '../../common/localize';
import { traceInfo, traceVerbose } from '../../common/logging';
import { showErrorMessage, showInformationMessage, withProgress } from '../../common/window.apis';
import { ShellScriptEditState, ShellStartupScriptProvider } from './shells/startupProvider';
import { ACT_TYPE_COMMAND, ACT_TYPE_SHELL, getAutoActivationType, setAutoActivationType } from './utils';

export async function handleSettingUpShellProfile(
    providers: ShellStartupScriptProvider[],
    callback: (provider: ShellStartupScriptProvider, result: boolean) => void,
): Promise<void> {
    const shells = providers.map((p) => p.shellType).join(', ');
    // Only show prompt when shell integration is not available, or disabled.
    const response = await showInformationMessage(
        l10n.t(
            'To enable "{0}" activation, your shell profile(s) may need to be updated to include the necessary startup scripts. Would you like to proceed with these changes?',
            ACT_TYPE_SHELL,
        ),
        { modal: true, detail: l10n.t('Shells: {0}', shells) },
        Common.yes,
    );

    if (response === Common.yes) {
        traceVerbose(`User chose to set up shell profiles for ${shells} shells`);
        const states = await withProgress(
            {
                location: ProgressLocation.Notification,
                title: l10n.t('Setting up shell profiles for {0}', shells),
            },
            async () => {
                return (await Promise.all(providers.map((provider) => provider.setupScripts()))).filter(
                    (state) => state !== ShellScriptEditState.NotInstalled,
                );
            },
        );
        if (states.every((state) => state === ShellScriptEditState.Edited)) {
            setImmediate(async () => {
                await showInformationMessage(
                    l10n.t(
                        'Shell profiles have been set up successfully. Extension will use shell startup activation next time a new terminal is created.',
                    ),
                );
            });
            providers.forEach((provider) => callback(provider, true));
        } else {
            setImmediate(async () => {
                const button = await showErrorMessage(
                    l10n.t('Failed to set up shell profiles. Please check the output panel for more details.'),
                    Common.viewLogs,
                );
                if (button === Common.viewLogs) {
                    await executeCommand('python-envs.viewLogs');
                }
            });
            providers.forEach((provider) => callback(provider, false));
        }
    } else {
        traceInfo(`User declined shell profile setup for ${shells}, switching to command activation`);
        await Promise.all(providers.map((provider) => provider.teardownScripts()));
        await setAutoActivationType(ACT_TYPE_COMMAND);
    }
}

export async function cleanupStartupScripts(allProviders: ShellStartupScriptProvider[]): Promise<void> {
    await Promise.all(allProviders.map((provider) => provider.teardownScripts()));
    if (getAutoActivationType() === ACT_TYPE_SHELL) {
        setAutoActivationType(ACT_TYPE_COMMAND);
        traceInfo(
            'Setting `python-envs.terminal.autoActivationType` to `command`, after removing shell startup scripts.',
        );
    }
    setImmediate(async () => await showInformationMessage(ActivationStrings.revertedShellStartupScripts));
}
