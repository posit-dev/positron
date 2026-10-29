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
import { parsePythonVersionFile } from '../interpreter/configuration/environmentTypeComparer';
import { traceWarn } from '../logging';
import { getInterpreterPathFromDir } from '../pythonEnvironments/common/commonUtils';
import { arePathsSame } from '../pythonEnvironments/common/externalDependencies';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { shouldIncludeInterpreter } from './interpreterSettings';

/** Env folder names, highest priority first. At the root, `.pixi/envs/*` follows these. */
const ENV_DIR_NAMES = ['.venv', '.conda', 'venv', '.virtualenv'];

/**
 * Root entries never scanned one level deep, lowercase and matched case-insensitively.
 * Mirrors PET's `should_search_for_environments_in_path`.
 */
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

/** Disk reads each step of a scan has in flight at once, so a large folder on a network drive isn't flooded. */
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
    /** Root project envs, highest priority first. */
    rootProjectEnvs: ProjectEnvironment[];
    nestedEnvDirs: string[];
    hasPythonSignals: boolean;
    pythonVersion: string | undefined;
    /** Whether the root holds nothing but dot entries such as `.git`. */
    isEmpty: boolean;
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

/**
 * `fn` over `items`, results in order, with at most `MAX_CONCURRENT_READS` running at
 * once. Each finished call starts the next, so one slow read doesn't hold up the rest.
 */
async function mapBounded<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next;
            next += 1;
            results[i] = await fn(items[i]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_READS, items.length) }, worker));
    return results;
}

/** Names of the folders (or links, which may be folders) in `entries`. */
function folderNames(entries: Dirent[]): string[] {
    return entries.filter((entry) => entry.isDirectory() || entry.isSymbolicLink()).map((entry) => entry.name);
}

/** Child folders in `entries` (read from `root`) worth scanning: sorted, ignored names removed, capped. */
function childFolders(root: string, entries: Dirent[]): string[] {
    return folderNames(entries)
        .filter((name) => !IGNORED_CHILDREN.has(name.toLowerCase()))
        .sort()
        .slice(0, MAX_SCANNED_CHILDREN)
        .map((name) => path.join(root, name));
}

/** The env folders named in `ENV_DIR_NAMES` that `folders` (read from `dir`) has, in priority order. */
function envDirsIn(dir: string, folders: Set<string>): string[] {
    return ENV_DIR_NAMES.filter((name) => folders.has(name)).map((name) => path.join(dir, name));
}

/** `.pixi/envs/*` folders, `default` first, then alphabetical. */
async function pixiEnvDirs(root: string): Promise<string[]> {
    const envsDir = path.join(root, '.pixi', 'envs');
    return folderNames(await readEntries(envsDir))
        .sort((a, b) => Number(b === 'default') - Number(a === 'default') || a.localeCompare(b))
        .map((name) => path.join(envsDir, name));
}

/**
 * The env folders in `envDirs` that have a Python, in the given order. Envs that
 * `python.interpreters.exclude` or `override` filter out are treated as absent.
 */
async function findEnvironments(envDirs: string[]): Promise<ProjectEnvironment[]> {
    const executables = await mapBounded(envDirs, (dir) => getInterpreterPathFromDir(dir));
    return envDirs.flatMap((envDir, i) => {
        const executable = executables[i];
        return executable !== undefined && shouldIncludeInterpreter(executable) ? [{ envDir, executable }] : [];
    });
}

/**
 * The project environments at the root of `root` (`ProjectEnv`), highest priority first.
 * All of them are kept, so when the first can't be recommended (e.g. an unsupported
 * Python version) the next one is. Only env folders in `rootEntries` are checked.
 */
async function findRootProjectEnvironments(root: string, rootEntries: Dirent[]): Promise<ProjectEnvironment[]> {
    const folders = new Set(folderNames(rootEntries));
    const pixi = folders.has('.pixi') ? await pixiEnvDirs(root) : [];
    return findEnvironments([...envDirsIn(root, folders), ...pixi]);
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
        return {
            hasPythonSignals: hasSignalFile(entries),
            envDirs: envDirsIn(child, new Set(folderNames(entries))),
        };
    });
    const nestedEnvs = await findEnvironments(children.flatMap((child) => child.envDirs));
    return {
        nestedEnvDirs: nestedEnvs.map((env) => env.envDir),
        hasPythonSignals: children.some((child) => child.hasPythonSignals),
    };
}

/** The first version named in `<root>/.python-version`, if any. Parent folders are not read. */
async function readPythonVersionFile(root: string): Promise<string | undefined> {
    try {
        return parsePythonVersionFile(await fs.readFile(path.join(root, '.python-version'), 'utf-8'));
    } catch {
        return undefined;
    }
}

/** The latest scan of each folder. Discovery and the ranking share it, so startup reads a folder once. */
const latestScans = new Map<string, Promise<WorkspaceScan>>();
/** Folders being read now. */
const readingRoots = new Set<string>();
/** The one read queued after the read in progress, for every rescan asked for meanwhile. */
const queuedRescans = new Map<string, Promise<WorkspaceScan>>();

/**
 * Everything the ranking needs from the folder, and the env folders one level down that
 * are passed to PET. Returns the latest scan of `root`, starting one if there is none;
 * `rescan` reads the folder again and makes that the latest.
 */
export function scanWorkspace(root: string, rescan = false): Promise<WorkspaceScan> {
    const latest = latestScans.get(root);
    if (latest && !rescan) {
        return latest;
    }
    // A burst of rescans (e.g. one per env discovery adds) reads the folder at most twice:
    // the read in progress, which may miss the change, then one read after it.
    if (latest && readingRoots.has(root)) {
        let queued = queuedRescans.get(root);
        if (!queued) {
            queued = latest.then(() => {
                queuedRescans.delete(root);
                return readAndKeep(root);
            });
            queuedRescans.set(root, queued);
            latestScans.set(root, queued);
        }
        return queued;
    }
    return readAndKeep(root);
}

function readAndKeep(root: string): Promise<WorkspaceScan> {
    readingRoots.add(root);
    // A failed scan finds nothing and isn't kept, so the next caller reads the folder again.
    // It doesn't claim the folder is empty either, so the picker doesn't suggest a new env.
    const scan: Promise<WorkspaceScan> = readWorkspace(root)
        .catch((error) => {
            traceWarn(`Could not scan ${root}: ${error}`);
            if (latestScans.get(root) === scan) {
                latestScans.delete(root);
            }
            return {
                rootProjectEnvs: [],
                nestedEnvDirs: [],
                hasPythonSignals: false,
                pythonVersion: undefined,
                isEmpty: false,
            };
        })
        .finally(() => readingRoots.delete(root));
    latestScans.set(root, scan);
    return scan;
}

/** Reads the folder. The root and each child folder are read once. */
async function readWorkspace(root: string): Promise<WorkspaceScan> {
    const rootEntries = await readEntries(root);
    const [rootProjectEnvs, children, pythonVersion] = await Promise.all([
        findRootProjectEnvironments(root, rootEntries),
        scanChildFolders(root, rootEntries),
        readPythonVersionFile(root),
    ]);
    return {
        rootProjectEnvs,
        nestedEnvDirs: children.nestedEnvDirs,
        hasPythonSignals: hasSignalFile(rootEntries) || children.hasPythonSignals,
        pythonVersion,
        isEmpty: rootEntries.every((entry) => entry.name.startsWith('.')),
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
