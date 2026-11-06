/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { join } from 'path';
import type { FullResult, Reporter } from '@playwright/test/reporter';
import { secretValues } from './appEnv';
import { scanPaths } from './secretScan';

const CANARY_NAME = 'E2E_LEAK_CANARY_KEY';
const MARKER_DIR = 'secret-scan';
const MARKER = join(MARKER_DIR, 'clean');
// The upload set. Crash dumps are never uploaded, so they are not scanned.
const SCAN_DIRS = ['test-results', 'playwright-report', 'blob-report', 'test-logs', join('test', 'assistant-inspect-ai')];

/**
 * Runs last in CI. Writes secret-scan/clean only when nothing in the upload set
 * holds a secret; upload steps are gated on that file. Prints names, never values.
 */
export default class SecretScanReporter implements Reporter {
	printsToStdio(): boolean {
		return false;
	}

	onBegin(): void {
		// A run killed before onEnd must not leave an old marker behind.
		fs.rmSync(MARKER, { force: true });
	}

	async onEnd(_result: FullResult): Promise<{ status: 'failed' } | undefined> {
		// Remove first so a stale marker can never survive a failed scan.
		fs.rmSync(MARKER, { force: true });

		const secrets = secretValues(process.env);
		if (!secrets.some(s => s.name === CANARY_NAME)) {
			console.error(`[secret-scan] ${CANARY_NAME} is missing, so the scan cannot be trusted. No marker written.`);
			return { status: 'failed' };
		}

		const paths = [...SCAN_DIRS];
		if (process.env.PW_JSON_FILE) {
			paths.push(process.env.PW_JSON_FILE);
		}

		try {
			const hits = await scanPaths(paths, secrets);
			if (hits.length > 0) {
				console.error(`[secret-scan] ${hits.length} hit(s). No marker written.`);
				for (const hit of hits) {
					console.error(`[secret-scan] ${hit.file}  ${hit.name}  ${hit.encoding}`);
				}
				return { status: 'failed' };
			}
			fs.mkdirSync(MARKER_DIR, { recursive: true });
			fs.writeFileSync(MARKER, '');
			console.error(`[secret-scan] clean (${paths.length} paths)`);
			return undefined;
		} catch (err) {
			console.error(`[secret-scan] scan failed: ${err instanceof Error ? err.message : String(err)}. No marker written.`);
			return { status: 'failed' };
		}
	}
}
