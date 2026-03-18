/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import child_process from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.dirname(__dirname);

/**
 * Get the build number for Positron.
 */
export const positronBuildNumber =
	process.env.POSITRON_BUILD_NUMBER ??
	child_process.execSync(`node ${REPO_ROOT}/versions/show-version.cjs --build`).toString().trim();

/**
 * Get the release channel for Positron.
 * This controls which CDN path is used for remote server downloads.
 * - 'dailies': Daily builds from main branch (default, retained 60 days)
 * - 'releases': Monthly releases from release branches (retained permanently)
 *
 * Note: This is written to product.json as 'quality' to leverage existing
 * VS Code URL substitution infrastructure (${quality} in URL templates).
 */
export const releaseChannel = process.env.VSCODE_QUALITY ?? 'dailies';
