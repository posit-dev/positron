/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import fancyLog from 'fancy-log';
import ansiColors from 'ansi-colors';
import {
	DEFAULT_EXTENSION_FILE_COUNT_BUDGET,
	EXTENSIONS_FILE_COUNT_BUDGET,
	EXTENSION_FILE_COUNT_BUDGETS,
	MAX_RELATIVE_PATH_LENGTH,
	describeBudget
} from './positron-path-budget.ts';

/** How many offenders to name when the check fails. */
const REPORTED_OFFENDERS = 10;

/** How many of the largest packages to name for each extension in the report. */
const REPORTED_PACKAGES = 20;

/** The name that the file-count report gives to the `extensions/` directory as a whole. */
const EXTENSIONS_TOTAL_NAME = 'extensions/';

/** A shipped file, relative to the install directory, with Windows separators. */
interface IShippedFile {
	path: string;
	bytes: number;
}

export interface IPathLengthResult {
	/** Number of files walked. */
	fileCount: number;
	/** Every path over budget, longest first, relative to the install directory. */
	offenders: string[];
	/** Longest path found, relative to the install directory. */
	longest: string;
}

/** The size of one directory in the packaged tree. */
export interface IFileCount {
	name: string;
	files: number;
	bytes: number;
}

/** A directory in the packaged tree with its file-count budget. */
export interface IBudgetedFileCount extends IFileCount {
	budget: number;
}

/** The size of one extension, with its largest `node_modules` packages. */
export interface IExtensionFileCount extends IBudgetedFileCount {
	/** The largest packages by file count, largest first. */
	packages: IFileCount[];
}

export interface IFileCountResult {
	/** Every file in the packaged tree. */
	shipped: IFileCount;
	/** The `extensions/` directory as a whole. */
	extensions: IBudgetedFileCount;
	/** The gzip copies in `extensions/`, which no budget counts. */
	gzipCopies: IFileCount;
	/** Each directory inside `extensions/`, largest first. */
	byExtension: IExtensionFileCount[];
	/** The entries over budget, `extensions/` as a whole included. */
	offenders: IBudgetedFileCount[];
}

/** The file-count budgets that `checkPackagedTree` applies. */
export interface IFileCountBudgets {
	total: number;
	default: number;
	byExtension: ReadonlyMap<string, number>;
}

const FILE_COUNT_BUDGETS: IFileCountBudgets = {
	total: EXTENSIONS_FILE_COUNT_BUDGET,
	default: DEFAULT_EXTENSION_FILE_COUNT_BUDGET,
	byExtension: EXTENSION_FILE_COUNT_BUDGETS
};

export interface IPackagedTreeCheckOptions {
	/**
	 * Whether to check the Windows MAX_PATH budget. The budget models the
	 * desktop install directory, so only the desktop build checks it.
	 */
	pathLengths: boolean;
	budgets?: IFileCountBudgets;
}

export interface IPackagedTreeResult {
	/** Undefined when `pathLengths` is false. */
	pathLengths?: IPathLengthResult;
	fileCounts: IFileCountResult;
}

/**
 * Collects every file under `root` as a path relative to `root`, with Windows
 * separators. A build on any platform then measures the lengths that Windows
 * gets. The walk itself uses native paths, and the function converts the
 * separators only at the end.
 *
 * The function does not follow a symlink. The tree holds a few symlinks, and a
 * walk through them counts a file twice and can find a cycle.
 */
function collectFiles(root: string): IShippedFile[] {
	if (!fs.existsSync(root)) {
		throw new Error(`Cannot check the packaged tree. ${root} does not exist.`);
	}

	const results: IShippedFile[] = [];
	const stack: string[] = [''];

	while (stack.length) {
		const relativeDir = stack.pop()!;
		const entries = fs.readdirSync(path.join(root, relativeDir), { withFileTypes: true });

		for (const entry of entries) {
			const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;

			if (entry.isDirectory()) {
				stack.push(relativePath);
			} else if (entry.isFile()) {
				results.push({
					path: relativePath.split(path.sep).join('\\'),
					bytes: fs.statSync(path.join(root, relativePath)).size
				});
			}
		}
	}

	return results;
}

function summarizePathLengths(files: IShippedFile[]): IPathLengthResult {
	const relativePaths = files.map(file => file.path);
	relativePaths.sort((a, b) => b.length - a.length);

	return {
		fileCount: relativePaths.length,
		offenders: relativePaths.filter(p => p.length > MAX_RELATIVE_PATH_LENGTH),
		longest: relativePaths[0] ?? ''
	};
}

/** A nested dependency counts toward the top-level package that pulled it in. */
function packageOf(segments: string[]): string | undefined {
	// The shared tree is `extensions/node_modules`. Any other extension keeps
	// its dependencies in `extensions/<name>/node_modules`.
	const start = segments[0] === 'node_modules' ? 1
		: segments[1] === 'node_modules' ? 2
			: -1;

	if (start < 0 || segments.length <= start + 1) {
		return undefined;
	}

	return segments[start].startsWith('@') && segments.length > start + 2
		? `${segments[start]}/${segments[start + 1]}`
		: segments[start];
}

/** Web server builds add these (`addCompressedSiblings` in gulpfile.reh.ts), so budgets skip them to fit every build. */
function isGzipCopy(filePath: string, paths: ReadonlySet<string>): boolean {
	return filePath.endsWith('.gz') && paths.has(filePath.slice(0, -'.gz'.length));
}

function addTo(counts: Map<string, IFileCount>, name: string, bytes: number): void {
	const count = counts.get(name) ?? { name, files: 0, bytes: 0 };
	count.files++;
	count.bytes += bytes;
	counts.set(name, count);
}

function largestFirst<T extends IFileCount>(counts: Iterable<T>): T[] {
	return [...counts].sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));
}

function summarizeFileCounts(files: IShippedFile[], extensionsDir: string, budgets: IFileCountBudgets): IFileCountResult {
	const prefix = extensionsDir.split(/[\\/]/).filter(Boolean).join('\\') + '\\';
	const byExtension = new Map<string, IFileCount>();
	const packagesByExtension = new Map<string, Map<string, IFileCount>>();
	const extensions: IBudgetedFileCount = { name: EXTENSIONS_TOTAL_NAME, files: 0, bytes: 0, budget: budgets.total };
	const gzipCopies: IFileCount = { name: 'gzip copies', files: 0, bytes: 0 };
	const shipped: IFileCount = { name: '', files: 0, bytes: 0 };
	const paths = new Set(files.map(file => file.path));

	for (const file of files) {
		shipped.files++;
		shipped.bytes += file.bytes;

		if (!file.path.startsWith(prefix)) {
			continue;
		}

		if (isGzipCopy(file.path, paths)) {
			gzipCopies.files++;
			gzipCopies.bytes += file.bytes;
			continue;
		}

		const segments = file.path.slice(prefix.length).split('\\');
		const name = segments[0];
		extensions.files++;
		extensions.bytes += file.bytes;
		addTo(byExtension, name, file.bytes);

		const packageName = packageOf(segments);
		if (packageName) {
			let packages = packagesByExtension.get(name);
			if (!packages) {
				packages = new Map();
				packagesByExtension.set(name, packages);
			}
			addTo(packages, packageName, file.bytes);
		}
	}

	if (extensions.files === 0) {
		throw new Error(`Cannot count files. ${extensionsDir} holds no files.`);
	}

	const extensionCounts = largestFirst([...byExtension.values()].map(count => ({
		...count,
		budget: budgets.byExtension.get(count.name) ?? budgets.default,
		packages: largestFirst(packagesByExtension.get(count.name)?.values() ?? []).slice(0, REPORTED_PACKAGES)
	})));

	return {
		shipped,
		extensions,
		gzipCopies,
		byExtension: extensionCounts,
		offenders: [extensions, ...extensionCounts].filter(count => count.files > count.budget)
	};
}

/** Logs the path-length result. Returns an error message when a path is over budget. */
function reportPathLengths({ fileCount, offenders, longest }: IPathLengthResult): string | undefined {
	if (offenders.length === 0) {
		fancyLog(`Path lengths ok: the longest of ${fileCount} shipped paths is `
			+ `${ansiColors.cyan(String(longest.length))} of ${MAX_RELATIVE_PATH_LENGTH} characters `
			+ `(${ansiColors.gray(longest)})`);
		return undefined;
	}

	fancyLog.error(`${offenders.length} shipped path(s) are longer than the Windows MAX_PATH `
		+ `budget of ${MAX_RELATIVE_PATH_LENGTH} characters (${describeBudget()}).`);
	fancyLog.error('A Windows per-user install or auto-update cannot write these files:');

	for (const offender of offenders.slice(0, REPORTED_OFFENDERS)) {
		fancyLog.error(`  ${ansiColors.yellow(String(offender.length))}  ${offender}`);
	}

	if (offenders.length > REPORTED_OFFENDERS) {
		fancyLog.error(`  ...and ${offenders.length - REPORTED_OFFENDERS} more.`);
	}

	fancyLog.error('Make these paths shorter, or do not ship these files.');
	fancyLog.error('Do not raise the budget.');
	fancyLog.error('See build/lib/positron-path-budget.ts and posit-dev/positron#14702.');

	return `${offenders.length} shipped path(s) are longer than the Windows MAX_PATH budget, `
		+ `the longest is ${offenders[0]}`;
}

function formatCount(count: number): string {
	return count.toLocaleString('en-US');
}

function formatBytes(bytes: number): string {
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Logs the file-count result. Returns an error message when a count is over budget. */
function reportFileCounts(result: IFileCountResult, budgets: IFileCountBudgets): string | undefined {
	const { shipped, extensions, gzipCopies, byExtension, offenders } = result;

	fancyLog(`File counts: ${formatCount(extensions.files)} files (${formatBytes(extensions.bytes)}) in `
		+ `${EXTENSIONS_TOTAL_NAME}, budget ${formatCount(extensions.budget)}; `
		+ `${formatCount(shipped.files)} files (${formatBytes(shipped.bytes)}) shipped in total`);
	if (gzipCopies.files > 0) {
		fancyLog(`  ${formatCount(gzipCopies.files)} gzip copies (${formatBytes(gzipCopies.bytes)}) in `
			+ `${EXTENSIONS_TOTAL_NAME} are in the total but outside every budget`);
	}

	const listed = byExtension.filter(count => budgets.byExtension.has(count.name) || count.files > count.budget);
	for (const count of listed) {
		const color = count.files > count.budget ? ansiColors.red : ansiColors.cyan;
		fancyLog(`  ${color(formatCount(count.files).padStart(7))} of ${formatCount(count.budget).padStart(6)}  `
			+ `${formatBytes(count.bytes).padStart(9)}  ${count.name}`);

		for (const pkg of count.packages) {
			fancyLog(ansiColors.gray(`      ${formatCount(pkg.files).padStart(7)}  ${formatBytes(pkg.bytes).padStart(9)}  ${pkg.name}`));
		}
	}

	const rest = byExtension.filter(count => !listed.includes(count));
	fancyLog(`  ${formatCount(rest.reduce((sum, count) => sum + count.files, 0)).padStart(7)} files in `
		+ `${rest.length} other extension(s), each within ${formatCount(budgets.default)}`);

	if (offenders.length === 0) {
		return undefined;
	}

	fancyLog.error(`${offenders.length} file count(s) are over budget:`);
	for (const offender of offenders) {
		fancyLog.error(`  ${ansiColors.yellow(formatCount(offender.files))} of ${formatCount(offender.budget)}  ${offender.name}`);
	}
	fancyLog.error('Bundle the dependencies that caused the growth, or leave out files that no code loads.');
	fancyLog.error('A new extension over the default budget needs its own entry.');
	fancyLog.error('See build/lib/positron-path-budget.ts and posit-dev/positron#16025.');

	return `${offenders.length} file count(s) in the packaged tree are over budget: `
		+ offenders.map(offender => `${offender.name} (${offender.files} of ${offender.budget})`).join(', ');
}

/**
 * Fails the build when an extension, or `extensions/` as a whole, ships more
 * files than its budget, and, with `pathLengths`, when a path is too long for a
 * Windows per-user install or auto-update. Both results are logged before the
 * function throws, so that one build shows every problem.
 *
 * `appRoot` must be the directory that matches the Windows install directory.
 * The paths that this function measures are then the paths that Inno Setup
 * writes. On Windows and Linux, `appRoot` is the packaged output folder. On
 * macOS it is `<product>.app/Contents`, where `Resources/app/...` has the same
 * length as `resources\app\...` on Windows. `extensionsDir` is the path of
 * `extensions/` relative to `appRoot`, with either separator.
 */
export function checkPackagedTree(appRoot: string, extensionsDir: string, options: IPackagedTreeCheckOptions): IPackagedTreeResult {
	const budgets = options.budgets ?? FILE_COUNT_BUDGETS;
	const files = collectFiles(appRoot);
	const pathLengths = options.pathLengths ? summarizePathLengths(files) : undefined;
	const fileCounts = summarizeFileCounts(files, extensionsDir, budgets);

	const errors = [
		pathLengths && reportPathLengths(pathLengths),
		reportFileCounts(fileCounts, budgets)
	].filter(error => error !== undefined);

	if (errors.length) {
		throw new Error(errors.join('; '));
	}

	return { pathLengths, fileCounts };
}
