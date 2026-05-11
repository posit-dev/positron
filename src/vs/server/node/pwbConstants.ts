/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from '../../base/common/path.js';
import { fileURLToPath } from 'url';

export const kProxyRegex = new RegExp('\/proxy\/[0-9]+[^a-zA-Z](\/)?');

// --- Start PWB: session-less static URL prefix for cacheable assets ---
// Session-less URL prefix for cacheable static assets (workbench.js/.css, NLS, icons, rsLoginCheck).
// In production the Workbench embedded nginx serves these directly off disk (gzip_static); the
// handler in webClientServer.ts is the dev/standalone fallback. The `product-label` field in
// package.json controls the literal prefix -- "vscode" here, overridden to "positron" in the
// Positron fork's package.json -- so the two products' assets never collide in nginx routing
// or in the browser HTTP cache.
//
// We find package.json by walking up from this module's location. A static require('./../package.json')
// won't work because the source tree layout (src/vs/server/node/) and the bundled output
// (out/server-main.js) resolve relative paths differently, so we resolve at runtime against
// wherever the code is actually loaded from.
function resolveProductLabel(): string {
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 10; i++) {
		const candidate = join(dir, 'package.json');
		if (existsSync(candidate)) {
			try {
				const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { 'product-label'?: string; name?: string };
				if (pkg['product-label']) {
					return pkg['product-label'];
				}
				// Found our root package.json but it has no override: fall through to the default.
				if (pkg.name === 'code-oss-dev') {
					break;
				}
			} catch { /* malformed -- keep walking */ }
		}
		const parent = dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}
	return 'vscode';
}

export const VSCODE_STATIC_PREFIX = `/${resolveProductLabel()}-static`;
// --- End PWB ---
