import { Disposable } from 'vscode';
import { PythonEnvironmentApi } from '../../api';
import { traceInfo } from '../../common/logging';
import { getPythonApi } from '../../features/pythonApi';
import { PythonProjectManager } from '../../internal.api';
import { NativePythonFinder } from '../common/nativePythonFinder';
import { notifyMissingManagerIfDefault } from '../common/utils';
import { PyEnvManager } from './pyenvManager';
import { getPyenv } from './pyenvUtils';

export async function registerPyenvFeatures(
    nativeFinder: NativePythonFinder,
    disposables: Disposable[],
    projectManager: PythonProjectManager,
): Promise<void> {
    const api: PythonEnvironmentApi = await getPythonApi();

    try {
        const pyenv = await getPyenv(nativeFinder);

        if (pyenv) {
            const mgr = new PyEnvManager(nativeFinder, api);
            disposables.push(mgr, api.registerEnvironmentManager(mgr));
        } else {
            traceInfo('Pyenv not found, turning off pyenv features.');
            await notifyMissingManagerIfDefault('ms-python.python:pyenv', projectManager, api);
        }
    } catch (ex) {
        traceInfo('Pyenv not found, turning off pyenv features.', ex);
        await notifyMissingManagerIfDefault('ms-python.python:pyenv', projectManager, api);
    }
}
