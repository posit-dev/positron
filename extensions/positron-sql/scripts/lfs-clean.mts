/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Git's clean filter for the SQL analyzer where git-lfs is not installed: reads the module on
 * stdin and writes the Git LFS pointer to it, as git-lfs's own clean filter would.
 *
 * `fetch-analyzer.mts` puts the module where git expects the pointer. With this as the checkout's
 * `filter.lfs.clean`, git reads the module as the pointer it replaced, so the file is unchanged to
 * git, and a checkout that brings a different pointer replaces it, for the next install to fetch.
 * Content that is already a pointer is passed through. Once git-lfs is installed, its
 * `filter.lfs.process` takes precedence over this.
 */

import * as crypto from 'node:crypto';
import { parsePointer } from './lfs.mts';

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) {
	chunks.push(chunk as Buffer);
}
const bytes = Buffer.concat(chunks);

if (parsePointer(bytes)) {
	process.stdout.write(bytes);
} else {
	const oid = crypto.createHash('sha256').update(bytes).digest('hex');
	process.stdout.write(`version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${bytes.length}\n`);
}
