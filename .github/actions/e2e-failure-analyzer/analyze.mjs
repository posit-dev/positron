#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Drives the Claude Agent SDK to synthesize an e2e test failure report from
// pre-extracted evidence (failures.json, screenshots, traces, error contexts).
// All data extraction has already happened in earlier action steps -- this
// script reads the structured outputs and asks the model for analysis.

import { query } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync, existsSync, appendFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORK_DIR = mustEnv('WORK_DIR');
const MODEL = process.env.MODEL || 'opus';
const STEP_SUMMARY = process.env.GITHUB_STEP_SUMMARY;
const MAX_TURNS = parsePosIntEnv('MAX_TURNS', 40);
// Repo workspace (sparse-checkout root). Optional: when present, the agent
// reads failing tests' source from $REPO_ROOT/test/e2e/{tests,pages,fixtures}.
const REPO_ROOT = process.env.REPO_ROOT || '';
// Defensive bounds against pathological runs (many failures x long traces).
// Per-attempt cap is ~50x the old 12-line truncation -- never trips on typical
// tests, prevents 500-action timelines from ballooning the prompt.
const MAX_TIMELINE_CHARS = parsePosIntEnv('MAX_TIMELINE_CHARS', 30000);
// Aggregate soft cap. Sonnet 4.5 has ~600KB of input context; we warn well
// before that. Exceeding it doesn't fail -- the model handles oversized
// prompts by failing the request, which we'd see in the action logs anyway.
const PROMPT_WARN_CHARS = parsePosIntEnv('PROMPT_WARN_CHARS', 400000);
// Workaround for claude-agent-sdk-typescript#296 (resolver picks musl over
// glibc on Linux): action.yml installs @anthropic-ai/claude-code globally
// and passes the resolved path here.
const CLAUDE_CODE_PATH = process.env.CLAUDE_CODE_PATH || undefined;

function mustEnv(name) {
	const v = process.env[name];
	if (!v) {
		console.error(`Missing required env var: ${name}`);
		process.exit(2);
	}
	return v;
}

/**
 * Parse a positive-integer env var. Falls back to `fallback` (with a logged
 * warning) for unset, empty, NaN, non-integer, or non-positive values. We
 * silently accept the fallback rather than crashing because misconfiguring a
 * defensive bound shouldn't kill the analyzer -- but the user should know.
 */
function parsePosIntEnv(name, fallback) {
	const raw = process.env[name];
	if (raw === undefined || raw === '') { return fallback; }
	const n = Number(raw);
	if (!Number.isInteger(n) || n <= 0) {
		console.warn(`[analyzer] WARN: invalid ${name}=${raw}, falling back to default ${fallback}`);
		return fallback;
	}
	return n;
}

function readJsonIfExists(path) {
	if (!existsSync(path)) { return null; }
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch (err) {
		console.error(`Failed to parse ${path}: ${err.message}`);
		return null;
	}
}

function discoverProjectDirs(workDir) {
	const out = [];
	for (const name of readdirSync(workDir)) {
		const full = join(workDir, name);
		if (!statSync(full).isDirectory()) { continue; }
		if (!name.startsWith('e2e-')) { continue; }
		const result = readJsonIfExists(join(full, 'result.json'));
		if (result) { out.push({ project: name, dir: full, result }); }
	}
	return out;
}

function renderRunHeader(runInfo) {
	const r = runInfo?.run || {};
	const c = runInfo?.commit || {};
	return [
		`Run: ${r.html_url || runInfo?.runId || '?'}`,
		`Workflow: ${r.name || '?'}`,
		`Branch: ${r.branch || r.head_branch || '?'}`,
		`Commit: ${(r.head_sha || '').slice(0, 12)} -- ${(c.message || '').split('\n')[0]}`,
		`Author: ${c.author || '?'}`,
		`Files changed (${(c.files || []).length}): ${(c.files || []).slice(0, 30).join(', ')}${(c.files || []).length > 30 ? ', ...' : ''}`,
	].join('\n');
}

function renderNonE2eFailures(runInfo) {
	const failed = (runInfo?.failedJobs || []).filter(j => !j.isE2e);
	if (failed.length === 0) { return '(none)'; }
	const logs = runInfo?.nonE2eJobLogs || {};
	return failed.map(j => {
		const excerpt = logs[j.id] ? `\n  Excerpt:\n${indent(String(logs[j.id]).slice(0, 2000), '    ')}` : '';
		return `- Job ${j.id}: ${j.name}${excerpt}`;
	}).join('\n');
}

function renderProjectFailures(projects, historyMap) {
	if (projects.length === 0) { return '(no e2e projects)'; }
	const out = [];
	for (const { project, result } of projects) {
		out.push(`### Project: ${project}`);
		const finalFailures = result.failures || [];
		const allAttempts = result.failedTests || [];
		out.push(`Hard failures (failed all retries): ${finalFailures.length}`);
		out.push(`Total failed attempts (incl. flaky recoveries): ${allAttempts.length}`);

		// Pre-compute deterministic severity per test: HARD = appears in result.failures
		// (failed all retries); FLAKY = only appears in failedTests (recovered on retry).
		// This must be computed here -- the model will misclassify if asked to count attempts.
		// Match on (title, normalizedSpecPath). failures.file is a playwright-normalized
		// absolute path while testDetails.file is project-relative; we strip up to the
		// `tests/` root so the suffixes can be compared directly. Using the full project-
		// relative suffix (not just basename) avoids false matches when two test files in
		// different directories happen to share a basename and a test title.
		const hardKeys = new Set(finalFailures.map(f => `${f.title}|||${normalizeSpecPath(f.file)}`));

		const details = result.testDetails || [];
		for (const t of details) {
			const key = `${t.title}|||${normalizeSpecPath(t.file)}`;
			const severity = hardKeys.has(key) ? 'HARD' : 'FLAKY';
			out.push('');
			out.push(`- Test: ${t.title}`);
			out.push(`  File: ${t.file}`);
			out.push(`  Severity: ${severity} (${severity === 'HARD' ? 'failed all retries' : 'passed on retry'})`);
			out.push(`  Status: ${t.status} (${t.attemptCount} attempt${t.attemptCount === 1 ? '' : 's'})`);
			if (Array.isArray(t.siblingTests) && t.siblingTests.length) {
				// A PASSED sibling that shares this test's fixture/setup proves setup
				// ran and the fixture was provisioned -- so a "not found" failure here
				// is a mid-run lifecycle/race, not a provisioning bug. See rubric.
				const sib = t.siblingTests.map(s => `${s.title} [${s.status}]`).join('; ');
				out.push(`  Other tests in this file: ${sib}`);
			}
			const hist = findHistoryFor(historyMap, t.title, t.file);
			if (hist) {
				out.push(indent(renderHistoryForTest(hist), '  '));
			} else if (historyMap.size > 0) {
				out.push(`  History: no entry for this test (${historyMap.size} tests in history blob)`);
			}
			for (let i = 0; i < (t.attempts || []).length; i++) {
				const a = t.attempts[i];
				out.push(`  Attempt ${i + 1}:`);
				// Prefer the chronological array; fall back to the single legacy path.
				const shots = Array.isArray(a.screenshotPaths) && a.screenshotPaths.length
					? a.screenshotPaths
					: (a.screenshotPath ? [a.screenshotPath] : []);
				if (shots.length === 1) {
					out.push(`    screenshot: ${shots[0]}`);
				} else if (shots.length > 1) {
					out.push(`    screenshots (chronological, last is failure-state):`);
					for (let j = 0; j < shots.length; j++) {
						out.push(`      [${j}] ${shots[j]}`);
					}
				}
				if (a.errorContextPath) { out.push(`    errorContext: ${a.errorContextPath}`); }
				if (a.trace?.timeline) {
					const tl = capTimeline(String(a.trace.timeline));
					out.push(`    trace timeline:\n${indent(tl, '      ')}`);
				}
				if (Array.isArray(a.trace?.errors) && a.trace.errors.length) {
					out.push(`    trace errors: ${a.trace.errors.slice(0, 3).map(e => String(e).split('\n')[0]).join(' | ')}`);
				}
			}
			if (t.logExcerpt) {
				// Error lines mined from the attached kernel/runtime/runner logs.
				// Carries detail the trace lacks (e.g. a kernel's resolved file path),
				// which distinguishes a missing fixture from one deleted mid-run.
				out.push(`  Log excerpt (error lines from attached logs):`);
				out.push(indent(capTimeline(String(t.logExcerpt)), '    '));
			}
		}
	}
	return out.join('\n');
}

/**
 * Normalize an e2e spec file path to the canonical "test/e2e/tests/..." form
 * used by the e2e-test-insights API. Handles four input shapes:
 *
 *   "../C:\\a\\positron\\test\\e2e\\tests\\foo\\bar.test.ts"  (failures.file: absolute)
 *   "tests\\foo\\bar.test.ts"                                  (testDetails.file: relative)
 *   "test/e2e/tests/foo/bar.test.ts"                           (already canonical)
 *   "tests/foo/tests/bar.test.ts"                              (nested `tests/` subdir)
 *
 * All normalize to "test/e2e/tests/<rest>". Used for both severity lookup AND
 * matching against history API keys -- using the full project-relative suffix
 * (not just basename) avoids false matches when two test files in different
 * directories happen to share a basename and a title.
 *
 * Anchors on the specific "/test/e2e/tests/" substring rather than a generic
 * "/tests/" so paths with nested `tests/` subdirectories aren't truncated.
 */
function normalizeSpecPath(file) {
	const fwd = String(file || '').replace(/\\/g, '/');
	// Prefer the most specific anchor: matches absolute Playwright-normalized
	// paths regardless of how deep a `tests/` subdir is nested afterwards.
	const idx = fwd.indexOf('/test/e2e/tests/');
	if (idx >= 0) { return fwd.slice(idx + 1); }
	if (fwd.startsWith('test/e2e/')) { return fwd; }
	if (fwd.startsWith('tests/')) { return `test/e2e/${fwd}`; }
	return fwd;
}

function buildHistoryByKey(history) {
	const map = new Map();
	if (history && Array.isArray(history.tests)) {
		for (const t of history.tests) {
			if (t.test_key) { map.set(t.test_key, t); }
		}
	}
	return map;
}

function findHistoryFor(historyMap, title, file) {
	if (!historyMap || historyMap.size === 0) { return null; }
	const key = `${title}|||${normalizeSpecPath(file)}`;
	return historyMap.get(key) || null;
}

function renderHistoryForTest(entry) {
	const h = entry.history || {};
	const lines = [];
	const passed = h.pass_count ?? 0;
	const total = h.total_runs ?? 0;
	const failRate = h.fail_rate != null ? `${(h.fail_rate * 100).toFixed(0)}%` : '?';
	const passRate = h.pass_rate != null ? `${(h.pass_rate * 100).toFixed(0)}%` : '?';
	lines.push(`History (last ${entry.lookback_days || '?'} days, branch ${entry.branch || '?'}):`);
	lines.push(`  passed ${passed}/${total} (${passRate}), failed ${h.fail_count ?? 0} (${failRate}), flaky ${h.flaky_count ?? 0}, last_status=${h.last_status || '?'}`);
	if (entry.insight) {
		const ins = entry.insight;
		lines.push(`  insight: ${ins.type || '?'}${ins.message ? ` -- "${String(ins.message).slice(0, 80)}"` : ''}${ins.occurrences ? `, ${ins.occurrences} occurrences` : ''}${ins.timing_value ? `, ${ins.timing_label || 'first seen'} ${ins.timing_value}` : ''}`);
	}
	if (Array.isArray(entry.environment_breakdown) && entry.environment_breakdown.length) {
		lines.push('  environments:');
		for (const e of entry.environment_breakdown) {
			const er = e.pass_rate != null ? `${(e.pass_rate * 100).toFixed(0)}%` : '?';
			lines.push(`    ${e.os}/${e.browser}: ${e.passed}/${e.total_runs} (${er}, ${e.failed} failed, ${e.flaky} flaky)`);
		}
	}
	if (Array.isArray(entry.failure_patterns) && entry.failure_patterns.length) {
		const top = entry.failure_patterns[0];
		const pct = top.percentage != null ? ` (${(top.percentage * 100).toFixed(0)}%)` : '';
		lines.push(`  top failure pattern${pct}: "${String(top.pattern || '').replace(/\n/g, ' ').slice(0, 140)}"`);
	}
	return lines.join('\n');
}

function indent(text, prefix) {
	return String(text).split('\n').map(l => prefix + l).join('\n');
}


/**
 * Cap a per-attempt timeline so a single pathological test can't dominate the
 * prompt. Keeps the head AND tail (failures usually hit the tail; the head
 * shows where the test started) and drops the middle with a marker.
 *
 * Guarantees `result.length <= MAX_TIMELINE_CHARS`. Falls back to a hard
 * truncate (with an ellipsis) if the configured cap is too small for a
 * meaningful head+tail split.
 */
function capTimeline(text) {
	const max = MAX_TIMELINE_CHARS;
	if (text.length <= max) { return text; }

	// Reserve a generous fixed budget for the elision marker. The marker is
	// `\n\n[... N chars elided to fit prompt budget ...]\n\n` where N's digit
	// count is bounded by realistic input sizes; 80 chars covers up to ~10^20.
	const MARKER_RESERVE = 80;

	if (max <= MARKER_RESERVE + 2) {
		// Cap is so small there's no room for head + tail + marker. Hard truncate.
		const ellipsis = '...';
		if (max <= ellipsis.length) { return text.slice(0, max); }
		return text.slice(0, max - ellipsis.length) + ellipsis;
	}

	const half = Math.floor((max - MARKER_RESERVE) / 2);
	const head = text.slice(0, half);
	const tail = text.slice(-half);
	const elided = Math.max(0, text.length - 2 * half);
	const marker = `\n\n[... ${elided} chars elided to fit prompt budget ...]\n\n`;

	let result = head + marker + tail;
	// Hard guard: if the marker exceeded MARKER_RESERVE (e.g. astronomical input
	// size with many digits), trim from the tail rather than blowing the budget.
	if (result.length > max) { result = result.slice(0, max); }
	return result;
}

function renderHistorySummary(history, historyMap) {
	if (!history) { return '(no historical data; e2e-test-insights API unavailable or no key)'; }
	if (history.error) { return `(history query error: ${history.error})`; }
	const total = historyMap.size;
	if (total === 0) { return '(history blob present but empty)'; }
	return `Per-test history pre-rendered inline with each failure below. (${total} tests in history blob, lookback ${history.lookback_days || '?'} days, branch ${history.branch || '?'}.)`;
}

const SYSTEM_PROMPT_HEAD = `You are an e2e test failure triage analyst for the Positron IDE project. You produce concise, evidence-based markdown reports for GitHub Actions step summaries.

Apply the analysis rubric below to every failure. It is the shared source of truth for root-cause categories and the reasoning that distinguishes a stale test selector from a real product bug; the e2e-failure-analyzer skill uses the same rubric file, so local triage and this Action reason identically.`;

// Runner-specific instructions appended after the shared rubric: pre-computed
// severity (the Action computes it; the model must not second-guess it) and the
// exact step-summary output contract.
const SYSTEM_PROMPT_TAIL = `This run also provides pre-computed severity and requires a specific output format.

- The Severity for each test is pre-computed and labeled in the input ("Severity: HARD" or "Severity: FLAKY"). Use that label VERBATIM in your output. Do NOT recompute severity from retry counts, root cause, or history -- the input label is authoritative. A test can have root cause "flaky test" and severity "HARD" simultaneously: that means the test failed all retries on this run AND its history shows it's prone to flaking.

Output the FINAL REPORT as your last message. The report MUST be valid GitHub-flavored markdown starting with the heading \`## Summary\`. Do not include images, raw JSON, or commentary outside the report. Do not include any text before \`## Summary\` in the final message.

Report structure:

## Summary

| Test | Platform | Root cause | Severity |
|------|----------|------------|----------|
| <test name> | <project / OS> | <category> | hard \\| flaky |

Order the rows: **all hard-severity failures first, then all flaky-severity failures**. The severity is the label from the input ("Severity: HARD" or "Severity: FLAKY"), not the root cause category. Within each severity group, keep failures from the same test file adjacent. Non-e2e job failures (unit tests, build failures, etc.) are hard severity by definition -- include them as rows in the hard-severity section with the job name as the test name.

## Detailed Analysis

For each distinct failure (or group), provide:
- **<test name>** (<platform>) -- <root cause category>
  - Evidence: <1-2 sentences citing what the screenshot/trace/page snapshot shows>
  - Commit: <relevant changed files, or "no related changes">
  - History: <history line, or "no data available">
  - Action: <what the developer should do>

Constraints:
- Keep the report focused. For runs with many failures, group related ones.
- Use Posit / Positron terminology (workbench, console, runtime, plot view, etc.).
- Do not embed image markdown -- screenshots aren't rendered in step summaries.
- Do not invent file paths, test names, or error messages -- only cite what's in the input.`;

// Minimal degraded-mode rubric used only if rubric.md cannot be read. Keep it
// short and obviously partial -- it is NOT a parallel source of truth.
const RUBRIC_FALLBACK = `## Analysis rubric (fallback -- rubric.md could not be loaded)

For each failure determine: (1) root cause -- one of flaky test | infrastructure issue | product regression | locator drift / stale selector | test environment issue | timeout | test logic bug; (2) a 1-2 sentence evidence-based explanation; (3) a suggested action. For any locator-not-found / not-visible / attribute / text failure, read the error-context page snapshot (errorContextPath) FIRST and decide locator drift (the target's stable text/label is present under different markup -- the test selector is stale) vs product regression (the target is genuinely absent). A bootstrapped extension floated to latest main (e.g. Posit Assistant) is a common drift source with no Positron-side change.`;

/**
 * Load the shared analysis rubric (.claude/skills/e2e-failure-analyzer/rubric.md).
 * Resolves it the same way action.yml resolves the helper scripts -- under
 * REPO_ROOT -- with a fallback relative to this file for ad-hoc runs, and a
 * minimal inline fallback so a missing/moved file never silently drops the rubric.
 */
function loadRubric() {
	const candidates = [
		REPO_ROOT ? join(REPO_ROOT, '.claude/skills/e2e-failure-analyzer/rubric.md') : null,
		fileURLToPath(new URL('../../../.claude/skills/e2e-failure-analyzer/rubric.md', import.meta.url)),
	].filter(Boolean);
	for (const p of candidates) {
		try {
			const text = readFileSync(p, 'utf8').trim();
			if (text) {
				console.log(`[analyzer] loaded analysis rubric from ${p}`);
				return text;
			}
		} catch { /* try next candidate */ }
	}
	console.warn('[analyzer] WARN: could not load rubric.md from any known location; using minimal inline fallback');
	return RUBRIC_FALLBACK;
}

const SYSTEM_PROMPT = `${SYSTEM_PROMPT_HEAD}

--- BEGIN ANALYSIS RUBRIC (.claude/skills/e2e-failure-analyzer/rubric.md) ---
${loadRubric()}
--- END ANALYSIS RUBRIC ---

${SYSTEM_PROMPT_TAIL}`;

async function main() {
	const runInfo = readJsonIfExists(join(WORK_DIR, 'run-info.json'));
	const history = readJsonIfExists(join(WORK_DIR, 'history.json'));
	const projects = discoverProjectDirs(WORK_DIR);

	const historyMap = buildHistoryByKey(history);
	const repoRootLine = REPO_ROOT
		? `REPO_ROOT: ${REPO_ROOT} (test source available at $REPO_ROOT/test/e2e/{tests,pages,fixtures,infra})`
		: 'REPO_ROOT: not set (test source not available; analyze from screenshots/traces only)';
	const sections = [
		'## Run metadata',
		renderRunHeader(runInfo),
		repoRootLine,
		'',
		'## Non-e2e job failures',
		renderNonE2eFailures(runInfo),
		'',
		'## Historical test health (e2e-test-insights)',
		renderHistorySummary(history, historyMap),
		'',
		'## E2E project failures',
		renderProjectFailures(projects, historyMap),
		'',
		'---',
		'Analyze the failures above. Read all referenced screenshots in parallel before writing the report. Output the final markdown report as instructed.',
	];
	const oversizedBanner = sections.join('\n').length > PROMPT_WARN_CHARS
		? `\n> WARNING: This run produced an unusually large evidence bundle (>${Math.round(PROMPT_WARN_CHARS / 1000)}KB of context). Be especially focused -- group related failures aggressively, prefer the most-revealing screenshot per attempt over reading every frame, and keep the report concise.\n`
		: '';
	const userPrompt = oversizedBanner ? `${oversizedBanner}\n${sections.join('\n')}` : sections.join('\n');

	if (userPrompt.length > PROMPT_WARN_CHARS) {
		console.warn(`[analyzer] WARN: prompt size ${userPrompt.length} chars exceeds soft threshold ${PROMPT_WARN_CHARS}. Model may struggle or fail.`);
	}

	console.log(`[analyzer] WORK_DIR=${WORK_DIR}`);
	console.log(`[analyzer] REPO_ROOT=${REPO_ROOT || '(unset)'}`);
	console.log(`[analyzer] model=${MODEL} maxTurns=${MAX_TURNS} claudePath=${CLAUDE_CODE_PATH || '(default)'}`);
	console.log(`[analyzer] projects=${projects.map(p => p.project).join(', ') || '(none)'}`);
	console.log(`[analyzer] user prompt (${userPrompt.length} chars):\n${userPrompt.slice(0, 4000)}${userPrompt.length > 4000 ? '\n...(truncated)' : ''}`);

	const assistantMessages = [];
	let turnCount = 0;

	for await (const message of query({
		prompt: userPrompt,
		options: {
			model: MODEL,
			cwd: WORK_DIR,
			systemPrompt: SYSTEM_PROMPT,
			allowedTools: ['Read', 'Glob', 'Grep'],
			permissionMode: 'bypassPermissions',
			maxTurns: MAX_TURNS,
			// Extended thinking is disabled. With thinking on (the adaptive
			// default), cancelling a parallel tool-call batch corrupts the
			// in-flight thinking blocks and wedges the session with a repeating
			// 400 ("thinking blocks ... cannot be modified", claude-code#63192).
			// The report is built from text blocks only, so no output is lost.
			thinking: { type: 'disabled' },
			...(CLAUDE_CODE_PATH ? { pathToClaudeCodeExecutable: CLAUDE_CODE_PATH } : {}),
		},
	})) {
		if (message.type === 'assistant') {
			turnCount++;
			const content = message.message?.content || [];
			const textBlocks = content.filter(b => b.type === 'text').map(b => b.text);
			const toolUses = content.filter(b => b.type === 'tool_use').map(b => `${b.name}(${JSON.stringify(b.input).slice(0, 200)})`);
			if (textBlocks.length) {
				const joined = textBlocks.join('\n');
				assistantMessages.push(joined);
				console.log(`[turn ${turnCount}] assistant text (${joined.length} chars):\n${joined.slice(0, 1000)}${joined.length > 1000 ? '\n...(truncated)' : ''}`);
			}
			if (toolUses.length) {
				console.log(`[turn ${turnCount}] tool calls: ${toolUses.join(' | ')}`);
			}
		} else if (message.type === 'result') {
			console.log(`[analyzer] usage: input=${message.usage?.input_tokens} output=${message.usage?.output_tokens} cost_usd=${message.total_cost_usd}`);
		}
	}

	const report = pickReport(assistantMessages);
	const header = renderReportHeader(runInfo);
	if (!report) {
		console.error('[analyzer] no markdown report produced');
		writeStepSummary(`${header}\n\n## E2E Failure Analysis\n\n_Analyzer produced no report. Check action logs._\n`);
		process.exit(1);
	}

	const fullReport = `${header}\n\n${report}`;
	writeStepSummary(fullReport);
	writeFileSync(join(WORK_DIR, 'analysis-report.md'), fullReport);
	console.log(`[analyzer] wrote ${fullReport.length} chars to step summary`);
}

function renderReportHeader(runInfo) {
	const r = runInfo?.run || {};
	const c = runInfo?.commit || {};
	const url = r.html_url || '';
	const runId = runInfo?.runId || '';
	const branch = r.branch || r.head_branch || '?';
	const workflow = r.name || 'workflow';
	const sha = (r.head_sha || '').slice(0, 8);
	const subject = (c.message || '').split('\n')[0];
	const linkText = url ? `[${workflow} run #${runId}](${url})` : `${workflow} run #${runId}`;
	const commitSegment = sha ? ` -- commit \`${sha}\`${subject ? ` "${subject}"` : ''}` : '';
	return `> Analyzed ${linkText} on \`${branch}\`${commitSegment}`;
}

function pickReport(messages) {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		const idx = m.indexOf('## Summary');
		if (idx >= 0) { return m.slice(idx); }
	}
	return messages.length ? messages[messages.length - 1] : null;
}

function writeStepSummary(markdown) {
	if (STEP_SUMMARY) {
		appendFileSync(STEP_SUMMARY, markdown + '\n');
	} else {
		console.log('--- BEGIN REPORT ---');
		console.log(markdown);
		console.log('--- END REPORT ---');
	}
}

main().catch(err => {
	console.error('[analyzer] fatal:', err);
	process.exit(1);
});
