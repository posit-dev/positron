/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Shared, deterministic core for the PR test checker. Both context gatherers
// import this so a PR and a local branch with the same diff produce identical
// classification, skip decisions, and context.json shape -- the parity
// guarantee between the CI workflow and the local `pete-local` skill.
//
// Pure (no I/O, no network, no `gh`/`git`). Each gatherer is a thin adapter
// that acquires raw fields (from the GitHub API or from local git) and hands
// them to `buildContext()`.

// Defensive cap on the diff sent to the model. Large diffs are usually
// generated/vendored code where deep analysis adds no value; the grader can
// still Read individual files via tools. Env-overridable so both paths honor
// the same knob.
export const MAX_DIFF_CHARS = Number(process.env.MAX_DIFF_CHARS) || 120_000;

// Categories drive the rubric: the grader weighs source changes against tests
// at the appropriate level. Order matters -- the first matching pattern wins.
const CATEGORIES = [
	// Tests (any of these counts as "has tests")
	{ name: 'test-vitest', match: p => /\.vitest\.(ts|tsx)$/.test(p) },
	{ name: 'test-e2e', match: p => p.startsWith('test/e2e/') },
	{ name: 'test-ext-host', match: p => p.startsWith('extensions/') && /(\.test|\.integrationTest)\.tsx?$/.test(p) },
	{ name: 'test-mocha', match: p => p.startsWith('src/') && /(\.test|\.integrationTest)\.tsx?$/.test(p) },
	{ name: 'test-other', match: p => /\/(test|tests|__tests__)\//.test(p) },

	// Docs / config / lockfiles -- not source, not tests
	{ name: 'docs', match: p => /\.(md|mdx)$/i.test(p) || /^(LICENSE|NOTICE)(\.txt)?$/i.test(p) || /CHANGELOG\.md$/i.test(p) || /CONTRIBUTING\.md$/i.test(p) || /(^|\/)README(\.[^\/]+)?$/i.test(p) },
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

// Skip categories: when every changed file falls into one of these and the PR
// is chore-shaped (no source touched, no tests touched). Matches the
// conjunctive rule from positron-pr-test-report.
const SKIP_CATEGORIES = new Set([
	'docs', 'lockfile', 'config-repo', 'config-build', 'config-ts',
	'config-pkg', 'config-release',
]);

// Title-based skip (release/version/dep bumps). Match positron-pr-test-report.
const SKIP_TITLE_PREFIXES = ['chore(deps):', 'build:', 'docs:', 'ci:', 'Bump '];

/**
 * Build the context object the grader consumes from raw, source-agnostic
 * inputs. `gather-pr-context.mjs` supplies these from the GitHub API;
 * `gather-local-context.mjs` supplies them from local git. The output schema is
 * identical regardless of source.
 *
 * @param {object} raw
 * @param {{ number: number|null, title: string, body: string, author: string, url: string, baseRef: string, headRef: string }} raw.pr
 * @param {number} raw.additions Total additions across the change.
 * @param {number} raw.deletions Total deletions across the change.
 * @param {Array<{ path: string, additions: number, deletions: number }>} raw.files Changed files (unclassified).
 * @param {string} raw.diff The full unified diff (untruncated; truncated here).
 */
export function buildContext(raw) {
	const files = (raw.files || []).map(f => ({
		path: f.path,
		additions: f.additions ?? 0,
		deletions: f.deletions ?? 0,
		category: classify(f.path),
	}));

	const diffTruncated = raw.diff.length > MAX_DIFF_CHARS;
	const diff = diffTruncated
		? raw.diff.slice(0, MAX_DIFF_CHARS) + `\n\n[... diff truncated at ${MAX_DIFF_CHARS} chars; ${raw.diff.length - MAX_DIFF_CHARS} chars elided ...]`
		: raw.diff;

	const titleSkip = SKIP_TITLE_PREFIXES.some(p => raw.pr.title.startsWith(p));
	const allFilesSkippable = files.length > 0 && files.every(f => SKIP_CATEGORIES.has(f.category));

	let skip = null;
	if (files.length === 0) {
		skip = { reason: 'empty-pr', detail: 'No files changed.' };
	} else if (titleSkip) {
		skip = { reason: 'title-prefix', detail: `Title starts with a chore/release prefix.` };
	} else if (allFilesSkippable) {
		skip = { reason: 'docs-or-config-only', detail: 'All changed files are docs, config, or lockfiles.' };
	}

	const counts = files.reduce((acc, f) => {
		acc[f.category] = (acc[f.category] || 0) + 1;
		return acc;
	}, {});
	const testCount = files.filter(f => f.category.startsWith('test-')).length;
	const sourceCount = files.filter(f => f.category.startsWith('source-')).length;

	return {
		pr: {
			number: raw.pr.number,
			title: raw.pr.title,
			body: raw.pr.body || '',
			author: raw.pr.author || '?',
			url: raw.pr.url || '',
			baseRef: raw.pr.baseRef,
			headRef: raw.pr.headRef,
		},
		stats: {
			additions: raw.additions ?? 0,
			deletions: raw.deletions ?? 0,
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
}

function formatCategoryCounts(counts) {
	const entries = Object.entries(counts || {}).sort((a, b) => b[1] - a[1]);
	if (entries.length === 0) { return '(none)'; }
	return entries.map(([k, v]) => `${k} (${v})`).join(', ');
}

/**
 * Render the static "Not applicable" comment for PRs the pre-filter
 * short-circuits (docs/config-only, chore titles, empty diffs). Shared so the
 * CI workflow and the local skill emit identical skip verdicts.
 */
export function renderSkipComment(context) {
	const { skip } = context;
	const reasonText = {
		'empty-pr': 'No files changed.',
		'title-prefix': 'PR title indicates a chore / dependency / docs bump.',
		'docs-or-config-only': 'All changed files are docs, config, or lockfiles -- no source behavior to test.',
	}[skip.reason] || skip.detail || 'Skipped by pre-filter.';

	return [
		'## PETE\'s assessment 🧪',
		'',
		`**Verdict:** 🟡 Not applicable -- ${reasonText}`,
		'',
		`### What changed`,
		`${context.stats.fileCount} file(s), categorized as: ${formatCategoryCounts(context.stats.categoryCounts)}.`,
		'',
		'---',
		`<sub>PETE (Positron Extreme Test Experiment): an LLM-based test-coverage advisor, currently in pilot. Nothing to test here! A pre-filter handled this PR, so we skipped the LLM check. Comment \`/pete\` if that's wrong.</sub>`,
	].join('\n');
}
