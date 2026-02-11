import { Disposable, LogOutputChannel } from 'vscode';
import { PythonEnvironmentApi } from '../../api';
import { traceInfo } from '../../common/logging';
import { getPythonApi } from '../../features/pythonApi';
import { PythonProjectManager } from '../../internal.api';
import { NativePythonFinder } from '../common/nativePythonFinder';
import { notifyMissingManagerIfDefault } from '../common/utils';
import { PoetryManager } from './poetryManager';
import { PoetryPackageManager } from './poetryPackageManager';
import { getPoetry, getPoetryVersion } from './poetryUtils';

export async function registerPoetryFeatures(
    nativeFinder: NativePythonFinder,
    disposables: Disposable[],
    outputChannel: LogOutputChannel,
    projectManager: PythonProjectManager,
): Promise<void> {
    const api: PythonEnvironmentApi = await getPythonApi();

    try {
        const poetryPath = await getPoetry(nativeFinder);
        if (poetryPath) {
            traceInfo(
                'The `shell` command is not available by default in Poetry versions 2.0.0 and above. Therefore all shell activation will be handled by calling `source <path-to-activate>`. If you face any problems with shell activation, please file an issue at https://github.com/microsoft/vscode-python-environments/issues to help us improve this implementation.',
            );
            const version = await getPoetryVersion(poetryPath);
            traceInfo(`Poetry found at ${poetryPath}, version: ${version}`);
            const envManager = new PoetryManager(nativeFinder, api);
            const pkgManager = new PoetryPackageManager(api, outputChannel, envManager);

            disposables.push(
                envManager,
                pkgManager,
                api.registerEnvironmentManager(envManager),
                api.registerPackageManager(pkgManager),
            );
        } else {
            traceInfo('Poetry not found, turning off poetry features.');
            await notifyMissingManagerIfDefault('ms-python.python:poetry', projectManager, api);
        }
    } catch (ex) {
        traceInfo('Poetry not found, turning off poetry features.', ex);
        await notifyMissingManagerIfDefault('ms-python.python:poetry', projectManager, api);
    }
}
