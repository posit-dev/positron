import { ENVS_EXTENSION_ID } from '../../common/constants';
import { getWorkspacePersistentState } from '../../common/persistentState';

/**
 * Persistent storage key for UV-managed virtual environments.
 *
 * This key is used to store a list of environment paths that were created or identified
 * as UV-managed virtual environments. The stored paths correspond to the
 * PythonEnvironmentInfo.environmentPath.fsPath values.
 */
export const UV_ENVS_KEY = `${ENVS_EXTENSION_ID}:uv:UV_ENVIRONMENTS`;

/**
 * @returns Array of environment paths (PythonEnvironmentInfo.environmentPath.fsPath values)
 * that are known to be UV-managed virtual environments
 */
export async function getUvEnvironments(): Promise<string[]> {
    const state = await getWorkspacePersistentState();
    return (await state.get(UV_ENVS_KEY)) ?? [];
}

/**
 * @param environmentPath The environment path (should be PythonEnvironmentInfo.environmentPath.fsPath)
 * to mark as UV-managed. Duplicates are automatically ignored.
 */
export async function addUvEnvironment(environmentPath: string): Promise<void> {
    const state = await getWorkspacePersistentState();
    const uvEnvs = await getUvEnvironments();
    if (!uvEnvs.includes(environmentPath)) {
        uvEnvs.push(environmentPath);
        await state.set(UV_ENVS_KEY, uvEnvs);
    }
}

/**
 * @param environmentPath The environment path (PythonEnvironmentInfo.environmentPath.fsPath)
 * to remove from UV tracking. No-op if path not found.
 */
export async function removeUvEnvironment(environmentPath: string): Promise<void> {
    const state = await getWorkspacePersistentState();
    const uvEnvs = await getUvEnvironments();
    const filtered = uvEnvs.filter((path) => path !== environmentPath);
    await state.set(UV_ENVS_KEY, filtered);
}

/**
 * Clears all UV-managed environment paths from the tracking list.
 */
export async function clearUvEnvironments(): Promise<void> {
    const state = await getWorkspacePersistentState();
    await state.set(UV_ENVS_KEY, []);
}
