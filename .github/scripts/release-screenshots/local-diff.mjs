#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Local iteration tool for the screenshot diff algorithm. Skips re-running
// the e2e tests by comparing a CI-built generated PNG against the docs
// reference PNG and writing the diff to /tmp.
//
//   node .github/scripts/release-screenshots/local-diff.mjs <name>
//
// Reads $GEN_DIR/<name>.png (default /tmp/ci-shots) and $DOCS_DIR/<name>.png
// (default /tmp/positron-website/images), writes /tmp/<name>-diff.png and
// prints the changed-pixel ratio. Override GEN_DIR / DOCS_DIR via env.
//
// One-time setup:
//   gh api repos/posit-dev/positron/actions/artifacts/<artifact-id>/zip > /tmp/ci-shots.zip
//   unzip -q -o /tmp/ci-shots.zip -d /tmp/ci-shots
//   git clone --depth 1 https://github.com/posit-dev/positron-website.git /tmp/positron-website

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateDiff } from './compare-and-report.mjs';

const GEN_DIR = process.env.GEN_DIR || '/tmp/ci-shots';
const DOCS_DIR = process.env.DOCS_DIR || '/tmp/positron-website/images';

const name = process.argv[2];
if (!name) {
	console.error('usage: local-diff.mjs <name-without-.png>');
	process.exit(2);
}

const gen = await readFile(join(GEN_DIR, `${name}.png`));
const docs = await readFile(join(DOCS_DIR, `${name}.png`));
const result = generateDiff(gen, docs);
if (!result) {
	console.error('generateDiff returned null (size mismatch or unparseable)');
	process.exit(1);
}
const out = `/tmp/${name}-diff.png`;
await writeFile(out, result.buf);
console.log(`changedRatio: ${(result.changedRatio * 100).toFixed(2)}%  →  ${out}`);
