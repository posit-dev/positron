import { ConfigurationTarget } from 'vscode';
// --- Start Positron ---
import { IInterpreterPathService, InterpreterPathUpdateOptions } from '../../../common/types';
// --- End Positron ---
import { IPythonPathUpdaterService } from '../types';

export class GlobalPythonPathUpdaterService implements IPythonPathUpdaterService {
    constructor(private readonly interpreterPathService: IInterpreterPathService) {}
    public async updatePythonPath(
        pythonPath: string | undefined,
        // --- Start Positron ---
        options?: InterpreterPathUpdateOptions,
        // --- End Positron ---
    ): Promise<void> {
        const pythonPathValue = this.interpreterPathService.inspect(undefined);

        if (pythonPathValue && pythonPathValue.globalValue === pythonPath) {
            return;
        }
        // --- Start Positron ---
        await this.interpreterPathService.update(undefined, ConfigurationTarget.Global, pythonPath, options);
        // --- End Positron ---
    }
}
