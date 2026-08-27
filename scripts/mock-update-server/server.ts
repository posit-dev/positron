/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Mock Positron update feed. Serves the `releases.json` documents that
 * `AbstractUpdateService` (`src/vs/platform/update/electron-main/abstractUpdateService.ts`)
 * fetches, so the update flow can be exercised from a source build without the real CDN.
 *
 * It is not part of the shipped product. See README.md for the whole workflow.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

// `scripts/package.json` declares commonjs, so require rather than import; see
// `scripts/mock-policy-server/server.ts`, which does the same.
const http = require('node:http') as typeof import('node:http');
const fs = require('node:fs') as typeof import('node:fs');
const path = require('node:path') as typeof import('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_PORT = 8902;

/** The version currently advertised by the feed; `/publish` replaces it while the server runs. */
let advertised = { version: '', commit: '' };

function parseArgs(argv: string[]): { port: number; version?: string; commit?: string } {
	const args: { port: number; version?: string; commit?: string } = { port: DEFAULT_PORT };

	for (let i = 0; i < argv.length; i++) {
		const value = argv[i + 1];
		switch (argv[i]) {
			case '--port': args.port = Number(value); i++; break;
			case '--version': args.version = value; i++; break;
			case '--commit': args.commit = value; i++; break;
			case '--help':
				console.log('Usage: npm run mock-update-server -- [--port N] [--version 2026.09.0-2] [--commit abc1234]');
				process.exit(0);
		}
	}

	return args;
}

/**
 * One build newer than the source tree, so the default feed advertises an update to a dev build
 * that has no version overrides in product.overrides.json.
 */
function nextVersion(): string {
	const product = JSON.parse(fs.readFileSync(path.join(ROOT, 'product.json'), 'utf8'));
	return `${product.positronVersion}-${Number(product.positronBuildNumber ?? 0) + 1}`;
}

/**
 * A plausible download name for the platform. Nothing downloads it -- the dev flow opens it
 * externally at most -- but a mismatched extension is confusing when it shows up in a log.
 */
function downloadName(platform: string): string {
	const [family, arch] = platform.split('/');
	switch (family) {
		case 'mac': return `Positron-darwin-${advertised.version}-${arch}.zip`;
		case 'win': return `Positron-${advertised.version}-${arch}.exe`;
		case 'deb': return `positron_${advertised.version}_${arch}.deb`;
		case 'rpm': return `positron-${advertised.version}-${arch}.rpm`;
		default: return `positron-${advertised.version}-${arch ?? family}.tar.gz`;
	}
}

/** Matches the shape of the real feed; `IUpdate` reads `version`, `productVersion`, and `url`. */
function releaseDocument(platform: string): string {
	return JSON.stringify({
		version: advertised.version,
		pub_date: new Date().toISOString().replace('T', ' ').replace(/\..*/, ' UTC'),
		name: advertised.version,
		url: `https://cdn.posit.co/positron/releases/${platform}/${downloadName(platform)}`,
		commit: advertised.commit,
		productVersion: advertised.version,
		sha256hash: '0'.repeat(64),
		codeoss_version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
	}, undefined, '\t');
}

/**
 * Positron's main process fetches the feed through Electron's `net.request`, which uses
 * Chromium's HTTP cache. A response carrying only `Last-Modified` gets heuristic freshness
 * (10% of its age), so an edited feed can be replayed from cache and the update check appears
 * to find a version that is no longer served. Refuse to be cached at all.
 */
function send(res: ServerResponse, status: number, body: string, contentType: string): void {
	res.writeHead(status, {
		'Content-Type': contentType,
		'Content-Length': Buffer.byteLength(body),
		'Cache-Control': 'no-store, no-cache, must-revalidate',
		'Pragma': 'no-cache',
		'Expires': '0',
	});
	res.end(body);
}

function handle(req: IncomingMessage, res: ServerResponse): void {
	const pathname = (req.url ?? '/').split('?')[0];
	console.log(`${new Date().toLocaleTimeString()} ${req.method} ${req.url}`);

	// Replace the advertised version, e.g. while an update is already pending, to exercise the
	// overwrite flow: `curl localhost:8902/publish/2026.09.0-3`
	const publish = /^\/publish\/([^/]+)(?:\/([^/]+))?$/.exec(pathname);
	if (publish) {
		advertised = { version: publish[1], commit: publish[2] ?? advertised.commit };
		const message = `feed now advertises ${advertised.version} (commit ${advertised.commit})`;
		console.log(message);
		send(res, 200, `${message}\n`, 'text/plain');
		return;
	}

	// `${updateUrl}/${channel}/${platform}/releases.json` for every platform the update services
	// build, so any channel, architecture and OS resolves:
	//
	//   darwin   mac/arm64        + /releases.json
	//   linux    deb|rpm/x86_64   + /releases.json
	//   win32    win/x86_64       + /<target>-releases.json   (target is 'user', 'system', or
	//                                                          undefined in a source build)
	//
	// Snap has no HTTP feed -- it updates through the snap store -- so there is nothing to mock.
	const feed = /^\/positron\/[^/]+\/(.+?)\/(?:[^/]+-)?releases\.json$/.exec(pathname);
	if (feed) {
		send(res, 200, releaseDocument(feed[1]), 'application/json');
		return;
	}

	// `${updateUrl}/${channel}/release-notes/release-${version}.md`, so the release notes button
	// in the update tooltip has something to open.
	const releaseNotes = /^\/positron\/[^/]+\/release-notes\/release-(.+)\.md$/.exec(pathname);
	if (releaseNotes) {
		send(res, 200, `# Positron ${releaseNotes[1]}\n\nMock release notes served by scripts/mock-update-server.\n`, 'text/markdown');
		return;
	}

	send(res, 404, `no mock for ${pathname}\n`, 'text/plain');
}

const args = parseArgs(process.argv.slice(2));
advertised = { version: args.version ?? nextVersion(), commit: args.commit ?? 'a'.repeat(7) };

http.createServer(handle).listen(args.port, '127.0.0.1', () => {
	console.log(`Mock update feed on http://localhost:${args.port}/positron advertising ${advertised.version}`);
	console.log(`Publish another version with: curl localhost:${args.port}/publish/<version>[/<commit>]`);
});
