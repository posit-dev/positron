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

	/**
	 * Resolves `relative` to an absolute path. With `followFinal`, a symbolic link at the
	 * final component must also point inside the root.
	 */
	const resolve = async (relative: string, followFinal = false): Promise<string> => {
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
		if (followFinal && (await fsp.lstat(full).catch(() => undefined))?.isSymbolicLink()) {
			const target = await fsp.realpath(full).catch(async () =>
				path.resolve(path.dirname(full), await fsp.readlink(full)));
			if (!isInside(realRoot, target)) {
				throw new Error(`Path is outside the project: ${relative}`);
			}
		}
		return full;
	};

	return {
		async read(file) {
			try {
				return new Uint8Array(await fsp.readFile(await resolve(file, true)));
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
			// The owner may always run the file; group and others follow their read bits.
			const wanted = executable ? mode | 0o100 | ((mode & 0o044) >> 2) : mode & ~0o111;
			if (wanted !== mode) {
				await fsp.chmod(full, wanted);
			}
		},
		async writeLink(file, target) {
			const full = await resolve(file);
			await fsp.mkdir(path.dirname(full), { recursive: true });
			const existing = await fsp.lstat(full).catch(() => undefined);
			if (existing !== undefined && !existing.isDirectory()) {
				await fsp.rm(full, { force: true });
			}
			await fsp.symlink(target, full);
		},
		async removeEmptyDirectory(file) {
			try {
				await fsp.rmdir(await resolve(file));
				return true;
			} catch (error) {
				const code = (error as NodeJS.ErrnoException).code;
				if (isMissing(error) || code === 'ENOTEMPTY' || code === 'EEXIST') {
					return false;
				}
				throw error;
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
				const info = await fsp.stat(await resolve(file, true));
				return { sizeBytes: info.size, isDirectory: info.isDirectory() };
			} catch (error) {
				if (isMissing(error)) {
					return undefined;
				}
				throw error;
			}
		},
		async lstat(file) {
			try {
				const info = await fsp.lstat(await resolve(file));
				return { sizeBytes: info.size, isDirectory: info.isDirectory(), isSymbolicLink: info.isSymbolicLink(), mtimeMs: info.mtimeMs };
			} catch (error) {
				if (isMissing(error)) {
					return undefined;
				}
				throw error;
			}
		},
		async copyKeepingTime(from, to) {
			const source = await resolve(from, true);
			const target = await resolve(to);
			await fsp.mkdir(path.dirname(target), { recursive: true });
			// A source that changes while it is copied (git rewrote the index) gives a torn copy.
			for (let attempt = 1; ; attempt++) {
				const before = await fsp.stat(source);
				await fsp.copyFile(source, target);
				const after = await fsp.stat(source);
				if (before.size === after.size && before.mtimeMs === after.mtimeMs) {
					await fsp.utimes(target, after.atime, after.mtime);
					return;
				}
				if (attempt === 3) {
					await fsp.rm(target, { force: true });
					throw new Error(`${from} kept changing while it was copied`);
				}
			}
		},
		async appendDurable(file, line) {
			const full = await resolve(file, true);
			await fsp.mkdir(path.dirname(full), { recursive: true });
			// Engine files are never links, so a link here is not one of ours.
			if ((await fsp.lstat(full).catch(() => undefined))?.isSymbolicLink()) {
				throw new Error(`Refusing to append to a symbolic link: ${file}`);
			}
			const handle = await fsp.open(full, 'a');
			try {
				await handle.appendFile(line);
				await handle.sync();
			} finally {
				await handle.close();
			}
		},
		async createExclusive(file, content) {
			const full = await resolve(file);
			await fsp.mkdir(path.dirname(full), { recursive: true });
			let handle;
			try {
				handle = await fsp.open(full, 'wx');
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
					return false;
				}
				throw error;
			}
			try {
				await handle.writeFile(content);
				await handle.sync();
			} finally {
				await handle.close();
			}
			return true;
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
