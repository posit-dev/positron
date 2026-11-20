/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { FilePort } from './ports';

/**
 * A `FilePort` backed by the real file system. Paths are relative to `root`. An absolute
 * path is accepted when it is inside one of `extraRoots` (for example the git directory,
 * which can be outside `root`). A path that resolves outside those roots, lexically or
 * through a symbolic link in one of its parent directories, is an error. `write` replaces a symbolic link at the target path instead of
 * writing through it.
 */
export function createNodeFilePort(root: string, extraRoots: string[] = []): FilePort {
	let caseInsensitive: Promise<boolean> | undefined;

	const resolve = async (relative: string): Promise<string> => {
		const full = path.resolve(root, relative);
		const base = [root, ...extraRoots].find(candidate => isInside(candidate, full));
		if (base === undefined) {
			throw new Error(`Path is outside the project: ${relative}`);
		}
		const realRoot = await fsp.realpath(base).catch(() => base);
		const realParent = await realpathOfNearestParent(path.dirname(full));
		if (!isInside(realRoot, realParent)) {
			throw new Error(`Path is outside the project: ${relative}`);
		}
		return full;
	};

	return {
		async read(file) {
			try {
				return new Uint8Array(await fsp.readFile(await resolve(file)));
			} catch (error) {
				if (isMissing(error)) {
					return undefined;
				}
				throw error;
			}
		},
		async write(file, content, executable) {
			const full = await resolve(file);
			await fsp.mkdir(path.dirname(full), { recursive: true });
			let existing = await fsp.lstat(full).catch(() => undefined);
			if (existing?.isSymbolicLink()) {
				await fsp.rm(full, { force: true });
				existing = undefined;
			}
			if (existing === undefined) {
				// The umask applies to the mode of a new file.
				await fsp.writeFile(full, content, { mode: executable ? 0o777 : 0o666 });
				return;
			}
			await fsp.writeFile(full, content);
			const mode = existing.mode & 0o7777;
			const wanted = executable ? mode | ((mode & 0o444) >> 2) : mode & ~0o111;
			if (wanted !== mode) {
				await fsp.chmod(full, wanted);
			}
		},
		async remove(file) {
			await fsp.rm(await resolve(file), { recursive: true, force: true });
		},
		async move(from, to) {
			const source = await resolve(from);
			const target = await resolve(to);
			await fsp.mkdir(path.dirname(target), { recursive: true });
			await fsp.rename(source, target);
		},
		async stat(file) {
			try {
				const info = await fsp.stat(await resolve(file));
				return { sizeBytes: info.size, isDirectory: info.isDirectory() };
			} catch (error) {
				if (isMissing(error)) {
					return undefined;
				}
				throw error;
			}
		},
		async appendDurable(file, line) {
			const full = await resolve(file);
			await fsp.mkdir(path.dirname(full), { recursive: true });
			const handle = await fsp.open(full, 'a');
			try {
				await handle.appendFile(line);
				await handle.sync();
			} finally {
				await handle.close();
			}
		},
		caseInsensitive() {
			caseInsensitive ??= probeCaseInsensitive(root);
			return caseInsensitive;
		},
	};
}

/** True when `target` is `base` or a path below it. A name such as `..notes` is below `base`. */
function isInside(base: string, target: string): boolean {
	const rel = path.relative(base, target);
	return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

/** The real path of the closest ancestor of `directory` (or `directory` itself) that exists. */
async function realpathOfNearestParent(directory: string): Promise<string> {
	let current = directory;
	for (; ;) {
		try {
			return await fsp.realpath(current);
		} catch (error) {
			const parent = path.dirname(current);
			if (!isMissing(error) || parent === current) {
				throw error;
			}
			current = parent;
		}
	}
}

function isMissing(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException).code;
	return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Creates a file with an upper-case name and looks for it under the lower-case name. */
async function probeCaseInsensitive(root: string): Promise<boolean> {
	await fsp.mkdir(root, { recursive: true });
	const name = `.CHECKPOINTS-CASE-PROBE-${randomUUID().toUpperCase()}`;
	const upper = path.join(root, name);
	await fsp.writeFile(upper, '', { flag: 'wx' });
	try {
		await fsp.stat(path.join(root, name.toLowerCase()));
		return true;
	} catch {
		return false;
	} finally {
		await fsp.rm(upper, { force: true });
	}
}
