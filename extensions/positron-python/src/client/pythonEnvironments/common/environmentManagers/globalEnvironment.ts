/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { untildify } from '../../../common/helpers';
import { getEnvironmentVariable, getUserHomeDir } from '../../../common/utils/platform';
import * as fsapi from '../../../common/platform/fs-paths';
import { traceError, traceInfo } from '../../../logging';
import { execUv } from './uv';
import { executeCommand } from '../../../common/vscodeApis/commandApis';
import { Common, GlobalEnvironment } from '../../../common/utils/localize';
import { showThreeButtonModalDialogPrompt } from '../../../positron/positronApis';

/**
 * Directory name of the environment Positron creates when no folder is open.
 * Doubles as the name shown in the interpreter picker, e.g. "Python 3.13 ('positron')".
 */
export const GLOBAL_ENVIRONMENT_NAME = 'positron';

/**
 * Parent directory the global environment lives in.
 *
 * `$WORKON_HOME` when set, otherwise `~/.virtualenvs`. This deliberately mirrors
 * `getGlobalVirtualEnvDirs()` in `globalVirtualEnvronmentLocator.ts` (including the
 * tilde expansion and `getUserHomeDir()` rather than `os.homedir()`), and the
 * equivalent list in PET's `pet-global-virtualenvs` pass, so the directory we create
 * is one that discovery already scans on every OS.
 *
 * @returns The parent directory, or `undefined` when there is no `$WORKON_HOME` and
 *   no home directory. Falling back to `os.homedir()` there would put the environment
 *   somewhere the locator does not look, so there is deliberately no global
 *   environment at all in that case.
 */
export function getGlobalEnvironmentParent(): string | undefined {
    const workonHome = getEnvironmentVariable('WORKON_HOME');
    if (workonHome) {
        return untildify(workonHome);
    }
    const home = getUserHomeDir();
    return home ? path.join(home, '.virtualenvs') : undefined;
}

/**
 * Full path to the global environment. This is the venv itself: `pyvenv.cfg` and
 * `bin/` (or `Scripts/`) sit directly inside it. It is never a `.venv` nested one
 * level deeper, because locators enumerate only the immediate children of the
 * parent and would not see a nested layout.
 */
export function getGlobalEnvironmentDir(): string | undefined {
    const parent = getGlobalEnvironmentParent();
    return parent ? path.join(parent, GLOBAL_ENVIRONMENT_NAME) : undefined;
}

/**
 * Path to a venv's Python executable.
 *
 * Deliberately duplicated from the workspace `.venv` helpers rather than shared:
 * those live in upstream Microsoft files, take a `WorkspaceFolder`, and hard-code
 * `<folder>/.venv`. Keeping the global path out of them is what structurally
 * prevents the nested `.venv` layout.
 */
export function getGlobalEnvironmentPython(venvDir: string): string {
    return process.platform === 'win32'
        ? path.join(venvDir, 'Scripts', 'python.exe')
        : path.join(venvDir, 'bin', 'python');
}

/**
 * Outcome of trying to create the global environment.
 *
 * There is no `reused` outcome by design: Positron never inspects, reuses,
 * upgrades, or deletes an environment that is already at the global path. A user
 * who needs several Python versions should open a folder, or manage the parent
 * directory by hand.
 */
export type GlobalEnvironmentResult =
    | { outcome: 'created'; venvDir: string; pythonPath: string }
    | { outcome: 'occupied'; venvDir: string }
    | { outcome: 'failed'; venvDir: string }
    | { outcome: 'unsupported' };

/**
 * Creates the global environment at `$WORKON_HOME/positron`.
 *
 * @param base What uv should build the environment from: either a `major.minor`
 *   version string or the path to a base interpreter. Every calling surface has
 *   one in hand, so there is no default-version path here.
 * @returns `created` with the new environment's Python, `occupied` if anything is
 *   already at the path, `failed` if creation did not succeed, or `unsupported` if
 *   there is no directory discovery would scan (no `$WORKON_HOME`, no home dir).
 *   Callers surface the matching message from the `GlobalEnvironment` localize
 *   namespace and fall back to their base interpreter.
 */
export async function createGlobalEnvironment(base: string): Promise<GlobalEnvironmentResult> {
    const parentDir = getGlobalEnvironmentParent();
    if (!parentDir) {
        traceError('Cannot create the global environment: no WORKON_HOME and no home directory.');
        return { outcome: 'unsupported' };
    }

    const venvDir = path.join(parentDir, GLOBAL_ENVIRONMENT_NAME);
    const pythonPath = getGlobalEnvironmentPython(venvDir);

    try {
        // Existence is the only check: no pyvenv.cfg parse, no version comparison.
        if (await fsapi.pathExists(venvDir)) {
            traceError(`Global environment path is already occupied: ${venvDir}`);
            return { outcome: 'occupied', venvDir };
        }

        // Neither ~/.virtualenvs nor a custom WORKON_HOME is guaranteed to exist,
        // and PET only scans directories that do.
        await fsapi.mkdirp(parentDir);

        traceInfo(`Creating global environment at ${venvDir} from ${base}...`);
        // --seed installs pip/setuptools for compatibility. --no-project matches the
        // workspace flow in uvCreationProvider and keeps whatever pyproject.toml happens
        // to sit above the extension host's cwd from constraining the environment.
        await execUv('uv', ['venv', venvDir, '--no-project', '--seed', '-p', base], { throwOnStdErr: false });

        // execUv resolves on a nonzero exit when throwOnStdErr is false, so a
        // resolved call is not proof that uv built anything. The interpreter
        // existing on disk is.
        if (!(await fsapi.pathExists(pythonPath))) {
            traceError(`Global environment creation left no interpreter at ${pythonPath}`);
            return { outcome: 'failed', venvDir };
        }
    } catch (error) {
        traceError(`Failed to create global environment at ${venvDir}: ${error}`);
        return { outcome: 'failed', venvDir };
    }

    traceInfo(`Global environment created at ${pythonPath}`);
    return { outcome: 'created', venvDir, pythonPath };
}

/**
 * Message to show when the global environment could not be created.
 * @param result A non-`created` outcome from `createGlobalEnvironment()`.
 */
export function globalEnvironmentErrorMessage(
    result: Exclude<GlobalEnvironmentResult, { outcome: 'created' }>,
): string {
    switch (result.outcome) {
        case 'occupied':
            return GlobalEnvironment.occupied(result.venvDir);
        case 'unsupported':
            return GlobalEnvironment.unsupported();
        default:
            return GlobalEnvironment.creationFailed(result.venvDir);
    }
}

/** What the user asked for in the global environment modal. */
export type GlobalEnvironmentChoice = 'openFolder' | 'create' | 'dismiss';

/**
 * Asks whether to open a folder, create the global environment, or do neither.
 *
 * "Open Folder..." is the primary action because the question these surfaces are
 * really asking is where the environment should live, and a project folder is the
 * better answer. Escape and the close button land on `dismiss`: a dialog the user
 * did not answer is never consent to create anything.
 *
 * `openFolder` means the user asked to open a folder and the picker was shown. If a
 * folder is actually opened the extension host reloads, ending whatever flow called
 * this, so callers must return rather than carry on. A cancelled picker also comes
 * back as `openFolder`; the flow has already ended either way.
 *
 * When there is no directory discovery would scan (no `$WORKON_HOME`, no home dir),
 * there is no environment to offer, so no dialog is shown and the answer is `dismiss`.
 *
 * @returns The user's choice.
 */
export async function promptForGlobalEnvironment(): Promise<GlobalEnvironmentChoice> {
    const venvDir = getGlobalEnvironmentDir();
    if (!venvDir) {
        traceError('Not offering a global environment: no WORKON_HOME and no home directory.');
        return 'dismiss';
    }

    const choice = await showThreeButtonModalDialogPrompt({
        title: GlobalEnvironment.promptTitle,
        message: GlobalEnvironment.promptMessage(venvDir),
        primaryButtonTitle: Common.openFolder,
        secondaryButtonTitle: GlobalEnvironment.createButton,
        tertiaryButtonTitle: GlobalEnvironment.notNow,
    });
    if (choice === GlobalEnvironment.createButton) {
        return 'create';
    }
    if (choice === Common.openFolder) {
        await executeCommand('workbench.action.files.openFolder');
        return 'openFolder';
    }
    return 'dismiss';
}
