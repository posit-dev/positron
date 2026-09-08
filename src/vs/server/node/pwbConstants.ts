/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { existsSync, readFileSync } from 'fs';
import { dirname, join, posix } from '../../base/common/path.js';
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

// Deployment path prefix for Workbench installations mounted under a sub-path (e.g. behind a
// front-end reverse proxy that only routes /rstudio/* to Workbench). rserver passes the session
// URL via RS_SESSION_URL, which looks like "/rstudio/s/<session-id>/" or "/s/<session-id>/" --
// the part before "/s/" is the deployment prefix, and we prepend it to the absolute-from-root
// URLs we emit so the front proxy will actually route them to Workbench. Empty string when
// Workbench is mounted at the origin root or when running outside Workbench.
//
// RS_SESSION_URL is usually just a path, but rserver derives it from the `session_url` the
// homepage passes at launch, and some deployments hand us a fully qualified URL
// ("https://host/s/<session-id>/"). The scheme and host must never survive into the prefix:
// `posix.join('https://host', '/vscode-static', ...)` collapses the "//" and yields
// "https:/host/vscode-static/...", which a browser resolves against the page origin as a *path*
// (per the WHATWG URL relative-slash rules), producing https://host/host/vscode-static/... So
// reduce the value to its path component first, and refuse anything that still isn't a plain
// rooted path.
export function computeDeploymentPrefix(sessionUrl: string | undefined): string {
	if (!sessionUrl) {
		return '';
	}

	let path = sessionUrl;
	const schemeEnd = path.indexOf('://');
	if (schemeEnd !== -1) {
		path = path.substring(schemeEnd + 3); // strip "<scheme>://"
		const hostEnd = path.indexOf('/');
		path = hostEnd === -1 ? '' : path.substring(hostEnd); // strip "<host>[:<port>]"
	} else if (path.startsWith('//')) {
		const hostEnd = path.indexOf('/', 2); // protocol-relative "//host/..."
		path = hostEnd === -1 ? '' : path.substring(hostEnd);
	}

	const idx = path.indexOf('/s/');
	if (idx <= 0) {
		return '';
	}

	const prefix = path.substring(0, idx);
	return prefix.startsWith('/') && !prefix.startsWith('//') ? prefix : '';
}

export const WORKBENCH_DEPLOYMENT_PREFIX = computeDeploymentPrefix(process.env['RS_SESSION_URL']);

const OAUTH_CALLBACK_STATIC_SEGMENT = 'callback-0';

export function resolveSessionlessStaticCallbackRoute(): string {
	return posix.join(
		WORKBENCH_DEPLOYMENT_PREFIX,
		VSCODE_STATIC_PREFIX,
		OAUTH_CALLBACK_STATIC_SEGMENT,
		'static',
		'out/vs/code/browser/workbench/callback.html'
	);
}
// --- End PWB ---

// --- Start PWB: Workbench 2026.05+ ships the nginx route for /<product-label>-static/...; ---
// older Workbenches must use session-scoped URLs.
function hasStaticRoute(): boolean {
	const v = process.env['RSTUDIO_VERSION'];
	if (!v) {
		return false;
	}
	const [year, month] = v.split(/[-+]/)[0].split('.').map(Number);
	if (!Number.isFinite(year) || !Number.isFinite(month)) {
		return false;
	}
	return year > 2026 || (year === 2026 && month >= 5);
}

export const HAS_STATIC_ROUTE = hasStaticRoute();
// --- End PWB ---
