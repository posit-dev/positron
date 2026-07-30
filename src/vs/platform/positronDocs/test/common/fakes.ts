/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDocsArchive, IDocsFileStore, IDocsHttpClient, IDocsHttpGetOptions, IDocsHttpResponse, IDocsLogger } from '../../common/positronDocsIO.js';

/**
 * Deterministic stand-in for a real sha256. Only equality matters in these
 * tests, and exporting it lets a test compute the digest a checksum file should
 * carry without duplicating the algorithm.
 */
export function fakeDigest(contents: string): string {
	let hash = 0;
	for (let i = 0; i < contents.length; i++) {
		hash = (Math.imul(hash, 31) + contents.charCodeAt(i)) | 0;
	}
	return (hash >>> 0).toString(16).padStart(64, '0');
}

/**
 * In-memory file store. Directories are implicit: a path is a directory if any
 * stored key starts with it plus a slash.
 */
export class FakeFileStore implements IDocsFileStore {
	readonly files = new Map<string, string>();
	/** Directories created explicitly via mkdir; implicit ones live in `files` keys. */
	readonly dirs = new Set<string>();
	/** Set to a path prefix to make every write under it fail, simulating a full disk. */
	failWritesUnder: string | undefined;
	/** Digest overrides, keyed by path. Defaults to a hash of the contents. */
	readonly digests = new Map<string, string>();

	constructor(initial: Record<string, string> = {}) {
		for (const [path, contents] of Object.entries(initial)) {
			this.files.set(path, contents);
		}
	}

	private isDir(path: string): boolean {
		const prefix = `${path}/`;
		for (const key of this.files.keys()) {
			if (key.startsWith(prefix)) {
				return true;
			}
		}
		return this.dirs.has(path);
	}

	async exists(path: string): Promise<boolean> {
		return this.files.has(path) || this.isDir(path);
	}

	async readFile(path: string): Promise<string> {
		const contents = this.files.get(path);
		if (contents === undefined) {
			throw new Error(`ENOENT: ${path}`);
		}
		return contents;
	}

	async writeFile(path: string, data: string | Uint8Array): Promise<void> {
		if (this.failWritesUnder && path.startsWith(this.failWritesUnder)) {
			throw new Error(`ENOSPC: no space left on device, write '${path}'`);
		}
		// Decode rather than record a length: the cache writes downloaded zip
		// bytes through this method, and FakeArchive must be able to read them
		// back as its fake-zip payload string.
		this.files.set(path, typeof data === 'string' ? data : new TextDecoder().decode(data));
	}

	async mkdir(path: string): Promise<void> {
		this.dirs.add(path);
	}

	async rename(from: string, to: string): Promise<void> {
		for (const [key, value] of [...this.files]) {
			if (key === from || key.startsWith(`${from}/`)) {
				this.files.delete(key);
				this.files.set(to + key.slice(from.length), value);
			}
		}
		for (const key of [...this.dirs]) {
			if (key === from || key.startsWith(`${from}/`)) {
				this.dirs.delete(key);
				this.dirs.add(to + key.slice(from.length));
			}
		}
	}

	async delete(path: string): Promise<void> {
		for (const key of [...this.files.keys()]) {
			if (key === path || key.startsWith(`${path}/`)) {
				this.files.delete(key);
			}
		}
		for (const key of [...this.dirs]) {
			if (key === path || key.startsWith(`${path}/`)) {
				this.dirs.delete(key);
			}
		}
	}

	async readdir(path: string): Promise<string[]> {
		const prefix = `${path}/`;
		const names = new Set<string>();
		for (const key of [...this.files.keys(), ...this.dirs]) {
			if (key.startsWith(prefix)) {
				names.add(key.slice(prefix.length).split('/')[0]);
			}
		}
		return [...names];
	}

	async isDirectory(path: string): Promise<boolean> {
		// A path present in `files` holds contents, so it is a file.
		return this.files.has(path) ? false : this.isDir(path);
	}

	async sha256(path: string): Promise<string> {
		const override = this.digests.get(path);
		if (override !== undefined) {
			return override;
		}
		const contents = this.files.get(path);
		if (contents === undefined) {
			throw new Error(`ENOENT: ${path}`);
		}
		return fakeDigest(contents);
	}

	/** Every file path currently stored under `dir`, recursively. */
	listUnder(dir: string): string[] {
		return [...this.files.keys()].filter(key => key.startsWith(`${dir}/`)).sort();
	}
}

export interface IFakeHttpRoute {
	readonly status: number;
	readonly body?: string;
	readonly etag?: string;
	/** Throw instead of responding, simulating DNS or connection failure. */
	readonly throws?: string;
	/** Response size in bytes for the maxBytes check; defaults to body length. */
	readonly byteLength?: number;
}

export class FakeHttpClient implements IDocsHttpClient {
	readonly getCalls: string[] = [];
	readonly headCalls: string[] = [];
	private readonly routes = new Map<string, IFakeHttpRoute>();

	route(url: string, route: IFakeHttpRoute): this {
		this.routes.set(url, route);
		return this;
	}

	async get(url: string, options?: IDocsHttpGetOptions): Promise<IDocsHttpResponse> {
		this.getCalls.push(url);
		const route = this.routes.get(url) ?? { status: 404 };
		if (route.throws) {
			throw new Error(route.throws);
		}
		const size = route.byteLength ?? route.body?.length ?? 0;
		if (options?.maxBytes !== undefined && size > options.maxBytes) {
			throw new Error(`docs bundle exceeds ${options.maxBytes} bytes`);
		}
		if (options?.etag !== undefined && route.etag !== undefined && options.etag === route.etag) {
			return { status: 304, etag: route.etag };
		}
		if (route.status !== 200) {
			return { status: route.status };
		}
		return { status: 200, etag: route.etag, body: new TextEncoder().encode(route.body ?? '') };
	}

	async head(url: string): Promise<IDocsHttpResponse> {
		this.headCalls.push(url);
		const route = this.routes.get(url) ?? { status: 404 };
		if (route.throws) {
			throw new Error(route.throws);
		}
		return { status: route.status, etag: route.etag };
	}
}

/**
 * Fake archive. A "zip" is the string the file store holds at its path, of the
 * form `zip:<json object of entry name to contents>`.
 *
 * JSON rather than a flat `name=contents;...` encoding: entry contents include
 * bundle.json and Markdown, so any separator character can legitimately appear
 * inside a value. A flat format would silently mis-split instead of failing.
 */
export class FakeArchive implements IDocsArchive {
	constructor(private readonly files: FakeFileStore) { }

	private parse(zipPath: string): Array<[string, string]> {
		const raw = this.files.files.get(zipPath);
		if (raw === undefined || !raw.startsWith('zip:')) {
			throw new Error(`end of central directory record signature not found: ${zipPath}`);
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw.slice(4));
		} catch {
			throw new Error(`end of central directory record signature not found: ${zipPath}`);
		}
		return Object.entries(parsed as Record<string, string>);
	}

	async entryNames(zipPath: string): Promise<string[]> {
		return this.parse(zipPath).map(([name]) => name);
	}

	async extract(zipPath: string, targetPath: string): Promise<void> {
		for (const [name, contents] of this.parse(zipPath)) {
			await this.files.writeFile(`${targetPath}/${name}`, contents);
		}
	}
}

/** Build the fake-zip payload string for a set of entries. */
export function fakeZip(entries: Record<string, string>): string {
	return `zip:${JSON.stringify(entries)}`;
}

export function recordingLogger(): IDocsLogger & { readonly infos: string[]; readonly warns: string[] } {
	const infos: string[] = [];
	const warns: string[] = [];
	return { infos, warns, info: (m: string) => { infos.push(m); }, warn: (m: string) => { warns.push(m); } };
}
