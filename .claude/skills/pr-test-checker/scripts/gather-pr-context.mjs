#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Fetch PR metadata + diff from the GitHub API and emit a context.json the
// agent driver can consume. The classification, skip pre-filter, and context
// schema live in the shared `context-core.mjs` so this and the local gatherer
// produce identical output for the same diff. This file is a thin `gh` adapter.
//
// Usage: node gather-pr-context.mjs <pr-number> <output-path>
// Requires: gh CLI authenticated; env GH_TOKEN or auth cache.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { buildContext } from './context-core.mjs';

const [, , prNumberArg, outPath] = process.argv;
if (!prNumberArg || !outPath) {
	console.error('Usage: gather-pr-context.mjs <pr-number> <output-path>');
	process.exit(2);
}
const prNumber = Number(prNumberArg);
if (!Number.isInteger(prNumber) || prNumber <= 0) {
	console.error(`Invalid PR number: ${prNumberArg}`);
	process.exit(2);
}

const REPO = process.env.GITHUB_REPOSITORY || 'posit-dev/positron';

function gh(args) {
	try {
		return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
	} catch (err) {
		console.error(`gh ${args.join(' ')} failed:`, err.message);
		process.exit(1);
	}
}

// --- Fetch raw PR metadata, file list, and diff -----------------------------

const prJson = JSON.parse(gh([
	'pr', 'view', String(prNumber),
	'--repo', REPO,
	'--json', 'number,title,body,author,additions,deletions,files,baseRefName,headRefName,url',
]));

const diffRaw = gh(['pr', 'diff', String(prNumber), '--repo', REPO]);

// --- Hand raw fields to the shared core -------------------------------------

const context = buildContext({
	pr: {
		number: prJson.number,
		title: prJson.title,
		body: prJson.body || '',
		author: prJson.author?.login || '?',
		url: prJson.url,
		baseRef: prJson.baseRefName,
		headRef: prJson.headRefName,
	},
	additions: prJson.additions ?? 0,
	deletions: prJson.deletions ?? 0,
	files: (prJson.files || []).map(f => ({
		path: f.path,
		additions: f.additions ?? 0,
		deletions: f.deletions ?? 0,
	})),
	diff: diffRaw,
});

writeFileSync(outPath, JSON.stringify(context, null, 2));
console.log(`[gather] wrote ${outPath} -- ${context.stats.fileCount} files, ${context.stats.testFileCount} test, ${context.stats.sourceFileCount} source, skip=${context.skip?.reason || 'no'}`);
