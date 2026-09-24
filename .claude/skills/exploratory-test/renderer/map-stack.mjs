/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Rewrites a stack's compiled frames to repo-relative source lines, and keeps
// 10 frames per stack. Usage:
//   node map-stack.mjs [--root <checkout>] [file]    (reads stdin without a file)
// Frames with no map, and node: frames, are left as they are.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_FRAMES = 10;
const FRAME = /^(\s*)at (.*?)(\(?)((?:vscode-file:\/\/vscode-app|file:\/\/)?[^\s()]+\.js):(\d+):(\d+)(\)?)\s*$/;

/** The compiled file under `root` that a frame's URL or path names. */
function compiledFile(url, root) {
	let path = url.replace(/^vscode-file:\/\/vscode-app/, '').replace(/^file:\/\//, '');
	try { path = decodeURIComponent(path); } catch { /* keep it encoded */ }
	if (!isAbsolute(path)) { return join(root, path); }
	if (existsSync(path)) { return path; }
	// An installed app or another checkout: rejoin from whichever segment comes first.
	const at = ['/out/', '/extensions/'].map(s => path.indexOf(s)).filter(i => i >= 0).sort((a, b) => a - b)[0];
	return at === undefined ? path : join(root, path.slice(at + 1));
}

function readMap(file) {
	const js = readFileSync(file, 'utf8');
	const url = /\/\/# sourceMappingURL=(\S+)\s*$/.exec(js)?.[1];
	if (!url) { return null; }
	if (url.startsWith('data:')) { return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64').toString(); }
	const mapFile = join(dirname(file), url);
	return existsSync(mapFile) ? readFileSync(mapFile, 'utf8') : null;
}

/** The source a map names, relative to `root` when it is inside it. */
function sourcePath(source, file, root) {
	let path = source.replace(/^file:\/\//, '');
	const webpack = /^webpack:\/\/[^/]*\/(?:\.\/)?(.*)$/.exec(path);
	if (webpack) {
		// Relative to the extension, which is the directory above its build output.
		const pkg = /^(.*?)\/(?:out|dist)\//.exec(file)?.[1] ?? dirname(file);
		path = join(pkg, webpack[1]);
	}
	try { path = decodeURIComponent(path); } catch { /* keep it encoded */ }
	const abs = resolve(dirname(file), path);
	const rel = relative(root, abs);
	if (!rel.startsWith('..') && !isAbsolute(rel)) { return rel; }
	// Core maps name the checkout that built them; find the same file under root.
	const parts = abs.split('/');
	for (let i = 1; i < parts.length - 1; i++) {
		const suffix = parts.slice(i).join('/');
		if (existsSync(join(root, suffix))) { return suffix; }
	}
	return path;
}

/**
 * @param {string} text a log excerpt with one or more stacks
 * @param {string} root the checkout the app ran from
 * @param {(root: string) => { TraceMap: any, originalPositionFor: any }} [loadTraceMapping]
 */
export function mapStack(text, root, loadTraceMapping = defaultTraceMapping) {
	let tm;
	const maps = new Map();
	const traceFor = file => {
		if (!maps.has(file)) {
			let trace = null;
			try {
				const map = existsSync(file) ? readMap(file) : null;
				if (map) {
					tm ??= loadTraceMapping(root);
					trace = new tm.TraceMap(map, file);
				}
			} catch { /* no usable map */ }
			maps.set(file, trace);
		}
		return maps.get(file);
	};

	const out = [];
	let frames = 0;
	let dropped = 0;
	let indent = '';
	const flush = () => {
		if (dropped) { out.push(`${indent}... ${dropped} more`); }
		frames = dropped = 0;
	};
	for (const line of String(text).split('\n')) {
		if (!/^\s*at\s/.test(line)) {
			flush();
			out.push(line);
			continue;
		}
		indent = /^\s*/.exec(line)[0];
		if (++frames > MAX_FRAMES) { dropped++; continue; }
		const m = FRAME.exec(line);
		if (!m) { out.push(line); continue; }
		const [, lead, fn, open, url, l, c, close] = m;
		const file = compiledFile(url, root);
		const trace = traceFor(file);
		const pos = trace && tm.originalPositionFor(trace, { line: Number(l), column: Number(c) - 1 });
		out.push(pos?.source ? `${lead}at ${fn}${open}${sourcePath(pos.source, file, root)}:${pos.line}${close}` : line);
	}
	flush();
	return out.join('\n');
}

function defaultTraceMapping(root) {
	return createRequire(join(root, 'package.json'))('@jridgewell/trace-mapping');
}

// Node resolves symlinks for import.meta.url but not argv, as on macOS's /var.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	const r = args.indexOf('--root');
	const root = resolve(r >= 0 ? args.splice(r, 2)[1] : process.cwd());
	const input = args[0] ? readFileSync(args[0], 'utf8') : readFileSync(0, 'utf8');
	process.stdout.write(mapStack(input, root));
}
