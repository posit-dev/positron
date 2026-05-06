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

const WORK_DIR = mustEnv('WORK_DIR');
const MODEL = process.env.MODEL || 'claude-sonnet-4-5';
const STEP_SUMMARY = process.env.GITHUB_STEP_SUMMARY;
const MAX_TURNS = parsePosIntEnv('MAX_TURNS', 40);
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

		const details = result.testDetails || [];
		for (const t of details) {
			out.push('');
			out.push(`- Test: ${t.title}`);
			out.push(`  File: ${t.file}`);
			out.push(`  Status: ${t.status} (${t.attemptCount} attempt${t.attemptCount === 1 ? '' : 's'})`);
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
		}
	}
	return out.join('\n');
}

// History keys use forward slashes and a "test/e2e/" prefix; failure `file`
// fields can be Windows-style (backslashes) and relative to test/e2e. Normalize
// so the lookup map hits.
function normalizeSpecPath(file) {
	let p = String(file || '').replace(/\\/g, '/');
	if (!p.startsWith('test/e2e/')) {
		p = `test/e2e/${p}`;
	}
	return p;
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

const SYSTEM_PROMPT = `You are an e2e test failure triage analyst for the Positron IDE project. You produce concise, evidence-based markdown reports for GitHub Actions step summaries.

For each failure or group of related failures, determine:
1. Root cause category -- one of: flaky test | infrastructure issue | product regression | test environment issue | timeout | test logic bug
2. Brief explanation (1-2 sentences) referencing specific evidence from screenshots, trace timelines, or logs
3. Suggested action for a developer

Process:
- READ EVERY SCREENSHOT IN PARALLEL with multiple Read tool calls in a single message. Each attempt may have several screenshots in chronological order; the last is the failure-state, the earlier ones show what the page looked like in the moments leading up to it. Comparing them is often what reveals the real root cause -- the failure message and the final frame can be misleading on their own.
- READ THE FULL TRACE TIMELINE in the prompt. The action sequence (selector clicks, navigations, waits) often shows where a test actually went wrong even if the final error points elsewhere. Don't stop at the last action.
- View error-context markdown files when screenshots and trace timelines are insufficient.
- Multiple tests failing in the same file/suite usually share a root cause -- group them.
- A test that failed then passed on retry is flaky. One that failed all retries is a hard failure.
- Tests tagged \`:soft-fail\` are known flaky.
- If historical data is provided, use it to distinguish regressions from known flakes:
  - 0% pass rate on one platform but 100% on others = deterministic platform regression, NOT flaky
  - Always read environment_breakdown, not just aggregate pass_rate
- Consider the head commit's changed files: do they touch code exercised by the failing test? Mention this in the per-failure analysis when relevant.

Output the FINAL REPORT as your last message. The report MUST be valid GitHub-flavored markdown starting with the heading \`## Summary\`. Do not include images, raw JSON, or commentary outside the report. Do not include any text before \`## Summary\` in the final message.

Report structure:

## Summary

| Test | Platform | Root cause | Severity |
|------|----------|------------|----------|
| <test name> | <project / OS> | <category> | hard \\| flaky |

Include non-e2e job failures (unit tests, build failures, etc.) as additional rows with the job name as the test name.

## Detailed Analysis

For each distinct failure (or group), provide:
- **<test name>** (<platform>) -- <root cause category>
  - Evidence: <1-2 sentences citing what the screenshot/trace shows>
  - Commit: <relevant changed files, or "no related changes">
  - History: <history line per the SKILL.md format, or "no data available">
  - Action: <what the developer should do>

Constraints:
- Keep the report focused. For runs with many failures, group related ones.
- Use Posit / Positron terminology (workbench, console, runtime, plot view, etc.).
- Do not embed image markdown -- screenshots aren't rendered in step summaries.
- Do not invent file paths, test names, or error messages -- only cite what's in the input.`;

async function main() {
	const runInfo = readJsonIfExists(join(WORK_DIR, 'run-info.json'));
	const history = readJsonIfExists(join(WORK_DIR, 'history.json'));
	const projects = discoverProjectDirs(WORK_DIR);

	const historyMap = buildHistoryByKey(history);
	const sections = [
		'## Run metadata',
		renderRunHeader(runInfo),
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
