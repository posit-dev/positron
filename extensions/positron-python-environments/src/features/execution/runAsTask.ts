import {
    ShellExecution,
    Task,
    TaskExecution,
    TaskPanelKind,
    TaskRevealKind,
    TaskScope,
    Uri,
    WorkspaceFolder,
} from 'vscode';
import { PythonEnvironment, PythonTaskExecutionOptions } from '../../api';
import { traceInfo, traceWarn } from '../../common/logging';
import { executeTask } from '../../common/tasks.apis';
import { getWorkspaceFolder } from '../../common/workspace.apis';
import { quoteStringIfNecessary } from './execUtils';

function getWorkspaceFolderOrDefault(uri?: Uri): WorkspaceFolder | TaskScope {
    const workspace = uri ? getWorkspaceFolder(uri) : undefined;
    return workspace ?? TaskScope.Global;
}

export async function runAsTask(
    environment: PythonEnvironment,
    options: PythonTaskExecutionOptions,
    extra?: { reveal?: TaskRevealKind },
): Promise<TaskExecution> {
    const workspace: WorkspaceFolder | TaskScope = getWorkspaceFolderOrDefault(options.project?.uri);

    let executable = environment.execInfo?.activatedRun?.executable ?? environment.execInfo?.run.executable;
    if (!executable) {
        traceWarn('No Python executable found in environment; falling back to "python".');
        executable = 'python';
    }
    // Check and quote the executable path if necessary
    executable = quoteStringIfNecessary(executable);

    const args = environment.execInfo?.activatedRun?.args ?? environment.execInfo?.run.args ?? [];
    const allArgs = [...args, ...options.args];
    traceInfo(`Running as task: ${executable} ${allArgs.join(' ')}`);

    const task = new Task(
        { type: 'python' },
        workspace,
        options.name,
        'Python',
        new ShellExecution(executable, allArgs, { cwd: options.cwd, env: options.env }),
        '$python',
    );

    task.presentationOptions = {
        reveal: extra?.reveal ?? TaskRevealKind.Silent,
        echo: true,
        panel: TaskPanelKind.Shared,
        close: false,
        showReuseMessage: true,
    };

    return executeTask(task);
}
