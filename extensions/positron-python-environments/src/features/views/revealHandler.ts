import { PythonEnvironmentApi } from '../../api';
import { isPythonProjectFile } from '../../common/utils/fileNameUtils';
import { activeTextEditor } from '../../common/window.apis';
import { EnvManagerView } from './envManagersView';
import { ProjectView } from './projectView';
import { PythonStatusBar } from './pythonStatusBar';

export function updateViewsAndStatus(
    statusBar: PythonStatusBar,
    workspaceView: ProjectView,
    managerView: EnvManagerView,
    api: PythonEnvironmentApi,
) {
    workspaceView.updateProject();

    const activeDocument = activeTextEditor()?.document;
    if (!activeDocument || activeDocument.isUntitled || activeDocument.uri.scheme !== 'file') {
        statusBar.hide();
        return;
    }

    if (
        activeDocument.languageId !== 'python' &&
        activeDocument.languageId !== 'pip-requirements' &&
        !isPythonProjectFile(activeDocument.uri.fsPath)
    ) {
        statusBar.hide();
        return;
    }

    workspaceView.reveal(activeDocument.uri);
    setImmediate(async () => {
        const env = await api.getEnvironment(activeDocument.uri);
        statusBar.show(env);
        managerView.reveal(env);
    });
}
