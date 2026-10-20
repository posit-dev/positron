/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Reads a workspace folder for what the interpreter ranking needs: the root project
 * environment, environments one level deep, Python signals, and `.python-version`.
 * Uses direct file checks, never `workspace.findFiles` (which routes through ripgrep
 * and took seconds during startup in Posit Cloud), and never looks deeper than one level.
 */

import type { Dirent } from 'fs';
import * as path from 'path';
import * as fs from '../common/platform/fs-paths';
import { getInterpreterPathFromDir } from '../pythonEnvironments/common/commonUtils';
import { arePathsSame } from '../pythonEnvironments/common/externalDependencies';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { shouldIncludeInterpreter } from './interpreterSettings';

/** Env folder names, highest priority first. At the root, `.pixi/envs/*` follows these. */
const ENV_DIR_NAMES = ['.venv', '.conda', 'venv', '.virtualenv'];

/** Root entries never scanned one level deep. Mirrors PET's `should_search_for_environments_in_path`. */
const IGNORED_CHILDREN = new Set([
    ...ENV_DIR_NAMES,
    '.pixi',
    'node_modules',
    '.git',
    '.github',
    '.vscode',
    '.devcontainer',
    '.cargo',
    '.tox',
    '.nox',
    '.cache',
    '.mypy_cache',
    '.pytest_cache',
    '__pycache__',
    '__pypackages__',
]);

/** Upper bound on child folders scanned, so opening a huge folder (e.g. home) stays cheap. */
const MAX_SCANNED_CHILDREN = 1000;

/** Disk reads a scan has in flight at once, so a large folder on a network drive isn't flooded. */
const MAX_CONCURRENT_READS = 32;

/** File names that mark a folder as Python, besides `*.py`, `*.ipynb` and requirements files. */
const SIGNAL_FILE_NAMES = new Set([
    'pyproject.toml',
    'pipfile',
    'setup.py',
    'setup.cfg',
    'environment.yml',
    '.python-version',
    'uv.lock',
    'pixi.toml',
]);

/** A project environment found on disk, before PET has resolved it. */
export interface ProjectEnvironment {
    envDir: string;
    executable: string;
}

/** What `scanWorkspace` found. */
export interface WorkspaceScan {
    rootProjectEnv: ProjectEnvironment | undefined;
    nestedEnvDirs: string[];
    hasPythonSignals: boolean;
    pythonVersion: string | undefined;
}

function isSignalFile(fileName: string): boolean {
    const name = fileName.toLowerCase();
    return (
        SIGNAL_FILE_NAMES.has(name) ||
        name.endsWith('.py') ||
        name.endsWith('.ipynb') ||
        (name.includes('requirements') && name.endsWith('.txt'))
    );
}

function hasSignalFile(entries: Dirent[]): boolean {
    return entries.some((entry) => entry.isFile() && isSignalFile(entry.name));
}

async function readEntries(dir: string): Promise<Dirent[]> {
    try {
        return await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return [];
    }
}

/** `fn` over `items` in order, with at most `MAX_CONCURRENT_READS` running at once. */
async function mapBounded<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = [];
    for (let i = 0; i < items.length; i += MAX_CONCURRENT_READS) {
        results.push(...(await Promise.all(items.slice(i, i + MAX_CONCURRENT_READS).map(fn))));
    }
    return results;
}

/** Child folders in `entries` (read from `root`) worth scanning: sorted, ignored names removed, capped. */
function childFolders(root: string, entries: Dirent[]): string[] {
    return entries
        .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && !IGNORED_CHILDREN.has(entry.name))
        .map((entry) => entry.name)
        .sort()
        .slice(0, MAX_SCANNED_CHILDREN)
        .map((name) => path.join(root, name));
}

/** `.pixi/envs/*` folders, `default` first, then alphabetical. */
async function pixiEnvDirs(root: string): Promise<string[]> {
    const envsDir = path.join(root, '.pixi', 'envs');
    const names = (await readEntries(envsDir)).map((entry) => entry.name).sort();
    return names
        .sort((a, b) => Number(b === 'default') - Number(a === 'default'))
        .map((name) => path.join(envsDir, name));
}

/**
 * The project environment at the root of `root` (`ProjectEnv`), if any. Envs that
 * `python.interpreters.exclude` or `override` filter out are treated as absent.
 */
async function findRootProjectEnvironment(root: string): Promise<ProjectEnvironment | undefined> {
    const envDirs = [...ENV_DIR_NAMES.map((name) => path.join(root, name)), ...(await pixiEnvDirs(root))];
    const executables = await mapBounded(envDirs, (dir) => getInterpreterPathFromDir(dir));
    const index = executables.findIndex(
        (executable) => executable !== undefined && shouldIncludeInterpreter(executable),
    );
    if (index === -1) {
        return undefined;
    }
    return { envDir: envDirs[index], executable: executables[index] as string };
}

/**
 * One pass over the folders one level below `root`. Each child folder is read once, and
 * its entries answer both questions: does it have a Python signal, and which env folders
 * does it have. Only env folders that exist are checked for an executable. Env folders
 * come in found order: child folders alphabetically, then `.venv` > `.conda` > `venv` >
 * `.virtualenv` (`WorkspaceEnv`).
 */
async function scanChildFolders(
    root: string,
    rootEntries: Dirent[],
): Promise<{ nestedEnvDirs: string[]; hasPythonSignals: boolean }> {
    const children = await mapBounded(childFolders(root, rootEntries), async (child) => {
        const entries = await readEntries(child);
        const folders = new Set(entries.filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name));
        return {
            hasPythonSignals: hasSignalFile(entries),
            envDirs: ENV_DIR_NAMES.filter((name) => folders.has(name)).map((name) => path.join(child, name)),
        };
    });
    const candidates = children.flatMap((child) => child.envDirs);
    const executables = await mapBounded(candidates, (dir) => getInterpreterPathFromDir(dir));
    return {
        nestedEnvDirs: candidates.filter((_, i) => executables[i] !== undefined),
        hasPythonSignals: children.some((child) => child.hasPythonSignals),
    };
}

/** The first version named in `<root>/.python-version`, if any. Parent folders are not read. */
async function readPythonVersionFile(root: string): Promise<string | undefined> {
    try {
        const content = await fs.readFile(path.join(root, '.python-version'), 'utf-8');
        return content
            .replace(/^\uFEFF/, '')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .find((line) => line.length > 0);
    } catch {
        return undefined;
    }
}

/** The latest scan of each folder. Discovery and the ranking share it, so startup reads a folder once. */
const latestScans = new Map<string, Promise<WorkspaceScan>>();

/**
 * Everything the ranking needs from the folder, and the env folders one level down that
 * are passed to PET. Returns the latest scan of `root`, starting one if there is none;
 * `rescan` reads the folder again and makes that the latest.
 */
export function scanWorkspace(root: string, rescan = false): Promise<WorkspaceScan> {
    let scan = latestScans.get(root);
    if (!scan || rescan) {
        scan = readWorkspace(root);
        latestScans.set(root, scan);
    }
    return scan;
}

/** Reads the folder. The root and each child folder are read once. */
async function readWorkspace(root: string): Promise<WorkspaceScan> {
    const rootEntries = await readEntries(root);
    const [rootProjectEnv, children, pythonVersion] = await Promise.all([
        findRootProjectEnvironment(root),
        scanChildFolders(root, rootEntries),
        readPythonVersionFile(root),
    ]);
    return {
        rootProjectEnv,
        nestedEnvDirs: children.nestedEnvDirs,
        hasPythonSignals: hasSignalFile(rootEntries) || children.hasPythonSignals,
        pythonVersion,
    };
}

/** Whether a discovered interpreter is the root project environment. */
export function isProjectEnvironment(
    interpreter: PythonEnvironment,
    projectEnv: ProjectEnvironment | undefined,
): boolean {
    if (!projectEnv) {
        return false;
    }
    if (arePathsSame(interpreter.path, projectEnv.executable)) {
        return true;
    }
    return !!interpreter.envPath && arePathsSame(interpreter.envPath, projectEnv.envDir);
}
