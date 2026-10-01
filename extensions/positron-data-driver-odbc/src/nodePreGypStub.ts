/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Stands in for @mapbox/node-pre-gyp in the odbcWorker bundle (see the alias in
// esbuild.mts). odbc calls only find() at runtime, to locate its native binding.
// The real package is an install-time tool, and its dependency tree (tar and
// friends) is most of the files the extension would otherwise ship. esbuild.mts
// copies the binding next to odbcWorker.js, so find() points there.
import * as path from 'path';

export function find(): string {
	return path.join(__dirname, 'odbc.node');
}
