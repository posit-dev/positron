/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fsp from 'fs/promises';
import * as path from 'path';
import { FilePort } from './ports';

/**
 * A `FilePort` backed by the real file system. Paths are relative to `root`, and a path
 * that resolves outside `root` is an error.
 */
export function createNodeFilePort(root: string): FilePort {
	const resolve = (relative: string): string => {
		const full = path.resolve(root, relative);
		const rel = path.relative(root, full);
		if (rel.startsWith('..') || path.isAbsolute(rel)) {
			throw new Error(`Path is outside the project: ${relative}`);
		}
		return full;
	};
	let caseInsensitive: Promise<boolean> | undefined;

	return {
		async read(file) {
			try {
				return new Uint8Array(await fsp.readFile(resolve(file)));
			} catch (error) {
				if (isMissing(error)) {
					return undefined;
				}
				throw error;
			}
		},
		async write(file, content, executable) {
			const full = resolve(file);
			await fsp.mkdir(path.dirname(full), { recursive: true });
			await fsp.writeFile(full, content);
			await fsp.chmod(full, executable ? 0o755 : 0o644);
		},
		async remove(file) {
			await fsp.rm(resolve(file), { recursive: true, force: true });
		},
		async move(from, to) {
			const target = resolve(to);
			await fsp.mkdir(path.dirname(target), { recursive: true });
			await fsp.rename(resolve(from), target);
		},
		async stat(file) {
			try {
				const info = await fsp.stat(resolve(file));
				return { sizeBytes: info.size, isDirectory: info.isDirectory() };
			} catch (error) {
				if (isMissing(error)) {
					return undefined;
				}
				throw error;
			}
		},
		async appendDurable(file, line) {
			const full = resolve(file);
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

function isMissing(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException).code;
	return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Creates a file with an upper-case name and looks for it under the lower-case name. */
async function probeCaseInsensitive(root: string): Promise<boolean> {
	await fsp.mkdir(root, { recursive: true });
	const name = `.CHECKPOINTS-CASE-PROBE-${process.pid}-${Date.now()}`;
	const upper = path.join(root, name);
	await fsp.writeFile(upper, '');
	try {
		await fsp.stat(path.join(root, name.toLowerCase()));
		return true;
	} catch {
		return false;
	} finally {
		await fsp.rm(upper, { force: true });
	}
}
