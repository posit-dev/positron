import * as vscode from 'vscode';
import { PythonEnvironmentApi } from './api';

let _extApi: PythonEnvironmentApi | undefined;
export async function getEnvExtApi(): Promise<PythonEnvironmentApi> {
    if (_extApi) {
        return _extApi;
    }
    const extension = vscode.extensions.getExtension('ms-python.vscode-python-envs');
    if (!extension) {
        throw new Error('Python Environments extension not found.');
    }
    if (extension?.isActive) {
        _extApi = extension.exports as PythonEnvironmentApi;
        return _extApi;
    }

    await extension.activate();

    _extApi = extension.exports as PythonEnvironmentApi;
    return _extApi;
}
