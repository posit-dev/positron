import { ConfigurationTarget, Uri } from 'vscode';
// --- Start Positron ---
import { IInterpreterPathService, InterpreterPathUpdateOptions } from '../../../common/types';
// --- End Positron ---
import { IPythonPathUpdaterService } from '../types';

export class WorkspacePythonPathUpdaterService implements IPythonPathUpdaterService {
    constructor(private workspace: Uri, private readonly interpreterPathService: IInterpreterPathService) {}
    public async updatePythonPath(
        pythonPath: string | undefined,
        // --- Start Positron ---
        options?: InterpreterPathUpdateOptions,
        // --- End Positron ---
    ): Promise<void> {
        const pythonPathValue = this.interpreterPathService.inspect(this.workspace);

        if (pythonPathValue && pythonPathValue.workspaceValue === pythonPath) {
            return;
        }
        // --- Start Positron ---
        await this.interpreterPathService.update(this.workspace, ConfigurationTarget.Workspace, pythonPath, options);
        // --- End Positron ---
    }
}
