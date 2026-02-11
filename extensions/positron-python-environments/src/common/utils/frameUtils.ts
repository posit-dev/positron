import { Uri } from 'vscode';
import { ENVS_EXTENSION_ID, PYTHON_EXTENSION_ID } from '../constants';
import { parseStack } from '../errors/utils';
import { allExtensions, getExtension } from '../extension.apis';
import { normalizePath } from './pathUtils';
interface FrameData {
    filePath: string;
    functionName: string;
}

function getFrameData(): FrameData[] {
    const frames = parseStack(new Error());
    return frames.map((frame) => ({
        filePath: frame.getFileName(),
        functionName: frame.getFunctionName(),
    }));
}

function getPathFromFrame(frame: FrameData): string {
    if (frame.filePath && frame.filePath.startsWith('file://')) {
        return Uri.parse(frame.filePath).fsPath;
    }
    return frame.filePath;
}

export function getCallingExtension(): string {
    const pythonExts = [ENVS_EXTENSION_ID, PYTHON_EXTENSION_ID];
    const extensions = allExtensions();
    const otherExts = extensions.filter((ext) => !pythonExts.includes(ext.id));
    const frames = getFrameData();

    const registerEnvManagerFrameIndex = frames.findIndex(
        (frame) =>
            frame.functionName &&
            (frame.functionName.includes('registerEnvironmentManager') ||
                frame.functionName.includes('registerPackageManager')),
    );

    const relevantFrames =
        registerEnvManagerFrameIndex !== -1 ? frames.slice(registerEnvManagerFrameIndex + 1) : frames;

    const filePaths: string[] = [];
    for (const frame of relevantFrames) {
        if (!frame || !frame.filePath) {
            continue;
        }
        const filePath = normalizePath(getPathFromFrame(frame));
        if (!filePath) {
            continue;
        }

        if (filePath.toLowerCase().endsWith('extensionhostprocess.js')) {
            continue;
        }

        if (filePath.startsWith('node:')) {
            continue;
        }

        filePaths.push(filePath);

        const ext = otherExts.find((ext) => filePath.includes(ext.id));
        if (ext) {
            return ext.id;
        }
    }

    const envExt = getExtension(ENVS_EXTENSION_ID);
    const pythonExt = getExtension(PYTHON_EXTENSION_ID);
    if (!envExt || !pythonExt) {
        throw new Error('Something went wrong with feature registration');
    }
    const envsExtPath = normalizePath(envExt.extensionPath);

    if (filePaths.every((filePath) => filePath.startsWith(envsExtPath))) {
        return PYTHON_EXTENSION_ID;
    }

    for (const ext of otherExts) {
        const extPath = normalizePath(ext.extensionPath);
        if (filePaths.some((filePath) => filePath.startsWith(extPath))) {
            return ext.id;
        }
    }

    // Fallback - we're likely being called from Python extension in conda registration
    return PYTHON_EXTENSION_ID;
}
