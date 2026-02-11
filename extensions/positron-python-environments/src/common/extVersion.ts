import { PYTHON_EXTENSION_ID } from './constants';
import { getExtension } from './extension.apis';
import { traceError } from './logging';

export function ensureCorrectVersion() {
    const extension = getExtension(PYTHON_EXTENSION_ID);
    if (!extension) {
        return;
    }

    const version = extension.packageJSON.version;
    const parts = version.split('.');
    const major = parseInt(parts[0]);
    const minor = parseInt(parts[1]);
    if (major >= 2025 || (major === 2024 && minor >= 23)) {
        return;
    }
    traceError('Incompatible Python extension. Please update `ms-python.python` to version 2024.23 or later.');
    throw new Error('Incompatible Python extension. Please update `ms-python.python` to version 2024.23 or later.');
}
