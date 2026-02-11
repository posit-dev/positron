import { ENVS_EXTENSION_ID } from '../../common/constants';
import { getWorkspacePersistentState } from '../../common/persistentState';

export const SYSTEM_WORKSPACE_KEY = `${ENVS_EXTENSION_ID}:system:WORKSPACE_SELECTED`;
export const SYSTEM_GLOBAL_KEY = `${ENVS_EXTENSION_ID}:system:GLOBAL_SELECTED`;

export async function clearSystemEnvCache(): Promise<void> {
    const keys = [SYSTEM_WORKSPACE_KEY, SYSTEM_GLOBAL_KEY];
    const state = await getWorkspacePersistentState();
    await state.clear(keys);
}

export async function getSystemEnvForWorkspace(fsPath: string): Promise<string | undefined> {
    const state = await getWorkspacePersistentState();
    const data: { [key: string]: string } | undefined = await state.get(SYSTEM_WORKSPACE_KEY);
    if (data) {
        try {
            return data[fsPath];
        } catch {
            return undefined;
        }
    }
    return undefined;
}

export async function setSystemEnvForWorkspace(fsPath: string, envPath: string | undefined): Promise<void> {
    const state = await getWorkspacePersistentState();
    const data: { [key: string]: string } = (await state.get(SYSTEM_WORKSPACE_KEY)) ?? {};
    if (envPath) {
        data[fsPath] = envPath;
    } else {
        delete data[fsPath];
    }
    await state.set(SYSTEM_WORKSPACE_KEY, data);
}

export async function setSystemEnvForWorkspaces(fsPath: string[], envPath: string | undefined): Promise<void> {
    const state = await getWorkspacePersistentState();
    const data: { [key: string]: string } = (await state.get(SYSTEM_WORKSPACE_KEY)) ?? {};
    fsPath.forEach((s) => {
        if (envPath) {
            data[s] = envPath;
        } else {
            delete data[s];
        }
    });
    await state.set(SYSTEM_WORKSPACE_KEY, data);
}

export async function getSystemEnvForGlobal(): Promise<string | undefined> {
    const state = await getWorkspacePersistentState();
    return await state.get(SYSTEM_GLOBAL_KEY);
}

export async function setSystemEnvForGlobal(envPath: string | undefined): Promise<void> {
    const state = await getWorkspacePersistentState();
    await state.set(SYSTEM_GLOBAL_KEY, envPath);
}
