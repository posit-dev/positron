/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import * as task from './lib/gulp/task.ts';
import * as util from './lib/util.ts';
import * as i18n from './lib/i18n.ts';
import { generateNlsBundles } from './lib/positronNlsBundles.ts';

const REPO_ROOT = path.dirname(import.meta.dirname);

// Same header build/lib/nls.ts stamps on the shipped English nls.messages.js.
// The bundle content is derived from Microsoft's vscode-loc translations (MIT).
const NLS_BUNDLE_FILE_HEADER = `/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/`;

/**
 * Generates per-locale core NLS bundles for the web/server workbench into
 * `out-build-nls/<locale>/nls.messages.js`.
 *
 * Run this AFTER a reh-web build task (e.g. `vscode-reh-web-linux-x64`): it
 * reads the `out-build/nls.keys.json` + `out-build/nls.messages.json` that the
 * build compile emits, and the message indices are only valid for that exact
 * compile. It requires a checkout of https://github.com/microsoft/vscode-loc
 * as a sibling of the repository root (missing checkout is a hard error).
 *
 * The output layout matches the tail of the URL template the server hands the
 * browser (`${nlsCoreBaseUrl}${commit}/${version}/${locale}/nls.messages.js`,
 * see src/vs/server/node/webClientServer.ts), so publishing is a recursive
 * copy of `out-build-nls/` to `<base>/<commit>/<version>/`. Until
 * `nlsCoreBaseUrl` is set in product.json, nothing consumes these files.
 *
 * See build/lib/positronNlsBundles.ts for why this merges English defaults
 * instead of reusing processCoreBundleFormat.
 */
const generateRehWebNlsTask = task.define('vscode-reh-web-nls', task.series(
	util.rimraf('out-build-nls'),
	async () => {
		generateNlsBundles({
			nlsMetadataPath: path.join(REPO_ROOT, 'out-build'),
			vscodeLocI18nPath: path.join(REPO_ROOT, '..', 'vscode-loc', 'i18n'),
			outputPath: path.join(REPO_ROOT, 'out-build-nls'),
			languages: i18n.defaultLanguages,
			fileHeader: NLS_BUNDLE_FILE_HEADER,
		});
	}
));
task.task(generateRehWebNlsTask);
