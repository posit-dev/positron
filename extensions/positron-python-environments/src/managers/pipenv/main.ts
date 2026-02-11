import { Disposable } from 'vscode';
import { PythonEnvironmentApi } from '../../api';
import { traceInfo } from '../../common/logging';
import { getPythonApi } from '../../features/pythonApi';
import { PythonProjectManager } from '../../internal.api';
import { NativePythonFinder } from '../common/nativePythonFinder';
import { PipenvManager } from './pipenvManager';
import { getPipenv } from './pipenvUtils';

import { notifyMissingManagerIfDefault } from '../common/utils';

export async function registerPipenvFeatures(
    nativeFinder: NativePythonFinder,
    disposables: Disposable[],
    projectManager: PythonProjectManager,
): Promise<void> {
    const api: PythonEnvironmentApi = await getPythonApi();

    try {
        const pipenv = await getPipenv(nativeFinder);

        if (pipenv) {
            const mgr = new PipenvManager(nativeFinder, api);
            disposables.push(mgr, api.registerEnvironmentManager(mgr));
        } else {
            traceInfo('Pipenv not found, turning off pipenv features.');
            await notifyMissingManagerIfDefault('ms-python.python:pipenv', projectManager, api);
        }
    } catch (ex) {
        traceInfo('Pipenv not found, turning off pipenv features.', ex);
        await notifyMissingManagerIfDefault('ms-python.python:pipenv', projectManager, api);
    }
}
