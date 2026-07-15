import { ConfigurationTarget, Uri } from 'vscode';
// --- Start Positron ---
import { IInterpreterPathService, InterpreterPathUpdateOptions } from '../../../common/types';
// --- End Positron ---
import { IPythonPathUpdaterService } from '../types';

export class WorkspaceFolderPythonPathUpdaterService implements IPythonPathUpdaterService {
    constructor(private workspaceFolder: Uri, private readonly interpreterPathService: IInterpreterPathService) {}
    public async updatePythonPath(
        pythonPath: string | undefined,
        // --- Start Positron ---
        options?: InterpreterPathUpdateOptions,
        // --- End Positron ---
    ): Promise<void> {
        const pythonPathValue = this.interpreterPathService.inspect(this.workspaceFolder);

        if (pythonPathValue && pythonPathValue.workspaceFolderValue === pythonPath) {
            return;
        }
        // --- Start Positron ---
        await this.interpreterPathService.update(
            this.workspaceFolder,
            ConfigurationTarget.WorkspaceFolder,
            pythonPath,
            options,
        );
        // --- End Positron ---
    }
}
