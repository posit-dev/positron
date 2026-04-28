/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { getPyenvDir } from '../pythonEnvironments/common/environmentManagers/pyenv';
import { getUserHomeDir } from '../common/utils/platform';

/**
 * Hard-coded POSIX bin directories where Python installers commonly drop
 * binaries. Mirrors the set probed by the posix known-paths locator. We stat
 * the directory itself; a `brew install python@3.13` (or apt install of a new
 * point release) moves the directory's mtime, which lets the warm-start
 * check fire a full discovery the next time the user opens Positron.
 */
const POSIX_BIN_PATHS: readonly string[] = [
    '/usr/bin',
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/opt/local/bin',
    // /opt/python: recommended Python installation location on Posit Workbench.
    // See ADDITIONAL_POSIX_BIN_PATHS in posixUtils.ts.
    '/opt/python',
];

/**
 * Default home-relative directories where well-known package managers drop
 * Python interpreters. Resolved against the user's home dir at call time.
 *
 *   - `.pyenv/versions`: pyenv-managed CPython releases (covered also via
 *     `getPyenvDir()` -- listed here for the rare case where PYENV_ROOT is
 *     unset and pyenv is installed somewhere unconventional).
 *   - `anaconda3/envs`, `miniconda3/envs`, `.conda/envs`, etc.: conda env
 *     directories created via `conda create -n foo`. `conda create --prefix`
 *     places envs outside these roots and falls back to the periodic-refresh
 *     trigger.
 *   - Hatch virtual-env directories (one per OS).
 */
const HOME_RELATIVE_PATHS: readonly string[] = [
    '.pyenv/versions',
    'anaconda3/envs',
    'miniconda3/envs',
    'anaconda/envs',
    'miniconda/envs',
    '.conda/envs',
];

/**
 * Hatch virtual-env root for the current platform. Hatch keeps interpreters
 * and project envs in a per-OS data directory; new project envs land here.
 */
function getHatchVirtualEnvRoot(): string | undefined {
    const home = getUserHomeDir();
    if (!home) {
        return undefined;
    }
    switch (process.platform) {
        case 'darwin':
            return path.join(home, 'Library', 'Application Support', 'hatch', 'env', 'virtual');
        case 'linux':
            return path.join(home, '.local', 'share', 'hatch', 'env', 'virtual');
        case 'win32': {
            const localAppData = process.env['LOCALAPPDATA'];
            if (!localAppData) {
                return undefined;
            }
            return path.join(localAppData, 'hatch', 'env', 'virtual');
        }
        default:
            return undefined;
    }
}

/**
 * Windows-only well-known Python install roots. Python.org installs land in
 * either `%LOCALAPPDATA%\Programs\Python` or `%PROGRAMFILES%\Python*`; the
 * Microsoft Store distribution ships through `%LOCALAPPDATA%\Microsoft\WindowsApps`.
 */
function getWindowsKnownRoots(): string[] {
    if (process.platform !== 'win32') {
        return [];
    }
    const roots: string[] = [];
    const localAppData = process.env['LOCALAPPDATA'];
    if (localAppData) {
        roots.push(path.join(localAppData, 'Programs', 'Python'));
        roots.push(path.join(localAppData, 'Microsoft', 'WindowsApps'));
    }
    const programFiles = process.env['ProgramFiles'] || process.env['PROGRAMFILES'];
    if (programFiles) {
        roots.push(path.join(programFiles, 'Python'));
    }
    return roots;
}

/**
 * Parent directory of the user's `python.defaultInterpreterPath` setting, if
 * set. The directory's mtime moves when the configured interpreter is
 * replaced (e.g. recreating a venv at a fixed path).
 */
function getDefaultInterpreterParent(): string | undefined {
    const value = vscode.workspace.getConfiguration('python').get<string>('defaultInterpreterPath');
    if (!value) {
        return undefined;
    }
    return path.dirname(value);
}

/**
 * Snapshot the directories this extension scans for Python interpreters.
 * Cheap (one stat per root); used by Positron's discovery cache to decide
 * whether a warm start needs a full discovery pass to pick up newly-installed
 * Python interpreters.
 *
 * Sources covered:
 *   - pyenv root (via PYENV_ROOT / PYENV / OS default), `versions/` subdir.
 *   - Common POSIX bin dirs (`/usr/local/bin`, `/opt/homebrew/bin`, ...).
 *   - Default conda env dirs under the user's home (`~/anaconda3/envs`, etc.).
 *   - Hatch virtual-env root (per-OS data dir).
 *   - Windows-known Python install roots (LOCALAPPDATA / ProgramFiles).
 *   - The parent of `python.defaultInterpreterPath`.
 *
 * Sources intentionally excluded (fall back to the periodic-refresh trigger):
 *   - Conda envs created with `--prefix` outside the well-known dirs.
 *   - Project-local venvs (.venv) and poetry/pipenv environments (these are
 *     recommended via `recommendedWorkspaceRuntime` on every open and are
 *     never cached, so they don't need a signature signal).
 *   - Pyenv/asdf shims (per-project effective version; not cacheable).
 *   - Module-managed interpreters and remote/proxy runtimes.
 */
export async function getPythonDiscoveryRootSignature(): Promise<positron.RuntimeRootSignature> {
    const home = getUserHomeDir();

    // Compose the full ordered list of candidate paths. Order is part of the
    // signature, so we keep it stable across runs to avoid spurious deltas.
    const candidates: string[] = [];
    const addAll = (paths: readonly (string | undefined)[]) => {
        for (const p of paths) {
            if (p) {
                candidates.push(p);
            }
        }
    };

    // pyenv: stat the `versions/` subdirectory rather than the pyenv root --
    // the root's mtime moves on plugin updates, but `versions/` only moves
    // when interpreters are added/removed, which is the signal we want.
    try {
        const pyenvDir = getPyenvDir();
        if (pyenvDir) {
            candidates.push(path.join(pyenvDir, 'versions'));
        }
    } catch {
        // PYENV not configured / no home dir; skip.
    }

    addAll(POSIX_BIN_PATHS);

    if (home) {
        for (const rel of HOME_RELATIVE_PATHS) {
            candidates.push(path.join(home, rel));
        }
    }

    addAll([getHatchVirtualEnvRoot()]);
    addAll(getWindowsKnownRoots());
    addAll([getDefaultInterpreterParent()]);

    // Dedupe by resolved path -- two settings/defaults may both land at the
    // same physical location (e.g. PYENV_ROOT explicitly set to ~/.pyenv).
    // The first occurrence wins so the signature is stable across runs.
    const seen = new Set<string>();
    const entries: positron.RuntimeRootEntry[] = [];
    for (const candidate of candidates) {
        let resolved = candidate;
        let exists = false;
        let mtimeMs = 0;
        try {
            const st = fs.statSync(candidate);
            try {
                resolved = fs.realpathSync(candidate);
            } catch {
                resolved = candidate;
            }
            exists = true;
            mtimeMs = st.mtimeMs;
        } catch {
            // ENOENT / EACCES / etc.: treat as non-existent. Path still
            // contributes; if it later starts existing, the next signature
            // will differ and trigger discovery.
            resolved = candidate;
        }
        if (seen.has(resolved)) {
            continue;
        }
        seen.add(resolved);
        entries.push({ path: resolved, exists, mtimeMs });
    }

    return { entries };
}
