import { Disposable, LogOutputChannel } from 'vscode';
import { PythonEnvironmentApi } from '../../api';
import { createSimpleDebounce } from '../../common/utils/debounce';
import { onDidEndTerminalShellExecution } from '../../common/window.apis';
import { createFileSystemWatcher, onDidDeleteFiles } from '../../common/workspace.apis';
import { getPythonApi } from '../../features/pythonApi';
import { NativePythonFinder } from '../common/nativePythonFinder';
import { PipPackageManager } from './pipManager';
import { isPipInstallCommand } from './pipUtils';
import { SysPythonManager } from './sysPythonManager';
import { VenvManager } from './venvManager';

export async function registerSystemPythonFeatures(
    nativeFinder: NativePythonFinder,
    disposables: Disposable[],
    log: LogOutputChannel,
    envManager: SysPythonManager,
): Promise<void> {
    const api: PythonEnvironmentApi = await getPythonApi();
    const venvManager = new VenvManager(nativeFinder, api, envManager, log);
    const pkgManager = new PipPackageManager(api, log, venvManager);

    disposables.push(
        api.registerPackageManager(pkgManager),
        api.registerEnvironmentManager(envManager),
        api.registerEnvironmentManager(venvManager),
    );

    const venvDebouncedRefresh = createSimpleDebounce(500, () => {
        venvManager.watcherRefresh();
    });
    const watcher = createFileSystemWatcher('{**/activate}', false, true, false);
    disposables.push(
        watcher,
        watcher.onDidCreate(() => {
            venvDebouncedRefresh.trigger();
        }),
        watcher.onDidDelete(() => {
            venvDebouncedRefresh.trigger();
        }),
        onDidDeleteFiles(() => {
            venvDebouncedRefresh.trigger();
        }),
    );

    disposables.push(
        onDidEndTerminalShellExecution(async (e) => {
            const cwd = e.terminal.shellIntegration?.cwd;
            if (isPipInstallCommand(e.execution.commandLine.value) && cwd) {
                const env = await venvManager.get(cwd);
                if (env) {
                    await pkgManager.refresh(env);
                }
            }
        }),
    );
}
