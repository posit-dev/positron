#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Fetch PR metadata, classify each changed file, and emit a context.json the
// agent driver can consume. Runs the cheap heuristic pre-filter so docs-only
// and config-only PRs never invoke the LLM.
//
// Usage: node gather-pr-context.mjs <pr-number> <output-path>
// Requires: gh CLI authenticated; env GH_TOKEN or auth cache.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

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
// Defensive cap on the diff we send to the model. Sonnet handles >100k tokens
// fine but huge diffs are usually generated/vendored code where deep analysis
// adds no value. The agent can still Read individual files via tools.
const MAX_DIFF_CHARS = Number(process.env.MAX_DIFF_CHARS) || 120_000;

function gh(args) {
	try {
		return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
	} catch (err) {
		console.error(`gh ${args.join(' ')} failed:`, err.message);
		process.exit(1);
	}
}

// --- Fetch PR metadata and file list ----------------------------------------

const prJson = JSON.parse(gh([
	'pr', 'view', String(prNumber),
	'--repo', REPO,
	'--json', 'number,title,body,author,additions,deletions,files,baseRefName,headRefName,url',
]));

const diffRaw = gh(['pr', 'diff', String(prNumber), '--repo', REPO]);
const diffTruncated = diffRaw.length > MAX_DIFF_CHARS;
const diff = diffTruncated
	? diffRaw.slice(0, MAX_DIFF_CHARS) + `\n\n[... diff truncated at ${MAX_DIFF_CHARS} chars; ${diffRaw.length - MAX_DIFF_CHARS} chars elided ...]`
	: diffRaw;

// --- Classify each changed file ---------------------------------------------

// Categories drive the rubric: the agent grades source changes against tests
// at the appropriate level. Order matters -- the first matching pattern wins.
const CATEGORIES = [
	// Tests (any of these counts as "has tests")
	{ name: 'test-vitest', match: p => /\.vitest\.(ts|tsx)$/.test(p) },
	{ name: 'test-e2e', match: p => p.startsWith('test/e2e/') },
	{ name: 'test-ext-host', match: p => p.startsWith('extensions/') && /(\.test|\.integrationTest)\.tsx?$/.test(p) },
	{ name: 'test-mocha', match: p => p.startsWith('src/') && /(\.test|\.integrationTest)\.tsx?$/.test(p) },
	{ name: 'test-other', match: p => /\/(test|tests|__tests__)\//.test(p) },

	// Docs / config / lockfiles -- not source, not tests
	{ name: 'docs', match: p => /\.(md|mdx)$/i.test(p) || /^(LICENSE|NOTICE)(\.txt)?$/i.test(p) || /CHANGELOG\.md$/i.test(p) || /CONTRIBUTING\.md$/i.test(p) || /README/i.test(p) },
	{ name: 'lockfile', match: p => /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/i.test(p) },
	{ name: 'config-repo', match: p => p.startsWith('.github/') || p.startsWith('.vscode/') || /^\.(editorconfig|gitignore|gitattributes)$/.test(p) },
	{ name: 'config-build', match: p => p.startsWith('build/azure-pipelines/') || p.startsWith('build/checksums/') || p.startsWith('build/lib/i18n/') },
	{ name: 'config-ts', match: p => /tsconfig.*\.json$/.test(p) || /vitest\.(config|workspace)\./.test(p) || /playwright\.config\./.test(p) || /eslint\.config\./.test(p) || /\.eslintrc/.test(p) || /\.prettierrc/.test(p) },
	{ name: 'config-pkg', match: p => /\/package\.json$/.test(p) || p === 'package.json' },
	{ name: 'config-release', match: p => p === 'product.json' || p.startsWith('versions/') },

	// Source (everything else falling into known source roots)
	{ name: 'source-positron', match: p => p.startsWith('src/') },
	{ name: 'source-extension', match: p => p.startsWith('extensions/') },
	{ name: 'source-e2e-infra', match: p => p.startsWith('test/e2e/') }, // unreachable -- e2e tests already caught above
	{ name: 'source-other', match: () => true },
];

function classify(path) {
	for (const c of CATEGORIES) {
		if (c.match(path)) { return c.name; }
	}
	return 'source-other';
}

const files = (prJson.files || []).map(f => ({
	path: f.path,
	additions: f.additions ?? 0,
	deletions: f.deletions ?? 0,
	category: classify(f.path),
}));

// --- Decide whether to skip -------------------------------------------------

// Skip categories: every changed file falls into one of these and the PR is
// chore-shaped (no source touched, no tests touched). Matches the conjunctive
// rule from positron-pr-test-report.
const SKIP_CATEGORIES = new Set([
	'docs', 'lockfile', 'config-repo', 'config-build', 'config-ts',
	'config-pkg', 'config-release',
]);

// Title-based skip (release/version/dep bumps). Match positron-pr-test-report.
const SKIP_TITLE_PREFIXES = ['chore(deps):', 'build:', 'docs:', 'ci:', 'Bump '];
const titleSkip = SKIP_TITLE_PREFIXES.some(p => prJson.title.startsWith(p));

const allFilesSkippable = files.length > 0 && files.every(f => SKIP_CATEGORIES.has(f.category));

let skip = null;
if (files.length === 0) {
	skip = { reason: 'empty-pr', detail: 'No files changed.' };
} else if (titleSkip) {
	skip = { reason: 'title-prefix', detail: `Title starts with a chore/release prefix.` };
} else if (allFilesSkippable) {
	skip = { reason: 'docs-or-config-only', detail: 'All changed files are docs, config, or lockfiles.' };
}

// --- Summary counters (for the agent's prompt header) -----------------------

const counts = files.reduce((acc, f) => {
	acc[f.category] = (acc[f.category] || 0) + 1;
	return acc;
}, {});

const testCount = files.filter(f => f.category.startsWith('test-')).length;
const sourceCount = files.filter(f => f.category.startsWith('source-')).length;

// --- Emit context.json ------------------------------------------------------

const context = {
	pr: {
		number: prJson.number,
		title: prJson.title,
		body: prJson.body || '',
		author: prJson.author?.login || '?',
		url: prJson.url,
		baseRef: prJson.baseRefName,
		headRef: prJson.headRefName,
	},
	stats: {
		additions: prJson.additions ?? 0,
		deletions: prJson.deletions ?? 0,
		fileCount: files.length,
		testFileCount: testCount,
		sourceFileCount: sourceCount,
		categoryCounts: counts,
	},
	files,
	diff,
	diffTruncated,
	skip,
};

writeFileSync(outPath, JSON.stringify(context, null, 2));
console.log(`[gather] wrote ${outPath} -- ${files.length} files, ${testCount} test, ${sourceCount} source, skip=${skip?.reason || 'no'}`);
