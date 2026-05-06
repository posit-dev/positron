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
const MAX_TURNS = Number(process.env.MAX_TURNS || 40);
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

function renderProjectFailures(projects) {
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
			for (let i = 0; i < (t.attempts || []).length; i++) {
				const a = t.attempts[i];
				out.push(`  Attempt ${i + 1}:`);
				if (a.screenshotPath) { out.push(`    screenshot: ${a.screenshotPath}`); }
				if (a.errorContextPath) { out.push(`    errorContext: ${a.errorContextPath}`); }
				if (a.trace?.timeline) {
					const tl = String(a.trace.timeline).split('\n').slice(0, 12).join('\n');
					out.push(`    trace timeline (first 12 lines):\n${indent(tl, '      ')}`);
				}
				if (Array.isArray(a.trace?.errors) && a.trace.errors.length) {
					out.push(`    trace errors: ${a.trace.errors.slice(0, 3).map(e => String(e).split('\n')[0]).join(' | ')}`);
				}
			}
		}
	}
	return out.join('\n');
}

function indent(text, prefix) {
	return String(text).split('\n').map(l => prefix + l).join('\n');
}

function renderHistory(history) {
	if (!history) { return '(no historical data; e2e-test-insights API unavailable or no key)'; }
	if (history.error) { return `(history query error: ${history.error})`; }
	return JSON.stringify(history, null, 2).slice(0, 8000);
}

const SYSTEM_PROMPT = `You are an e2e test failure triage analyst for the Positron IDE project. You produce concise, evidence-based markdown reports for GitHub Actions step summaries.

For each failure or group of related failures, determine:
1. Root cause category -- one of: flaky test | infrastructure issue | product regression | test environment issue | timeout | test logic bug
2. Brief explanation (1-2 sentences) referencing specific evidence from screenshots, trace timelines, or logs
3. Suggested action for a developer

Process:
- READ ALL SCREENSHOTS IN PARALLEL with multiple Read tool calls in a single message. Screenshots are the most revealing evidence.
- View error-context markdown files only when screenshots and trace timelines are insufficient.
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

	const userPrompt = [
		'## Run metadata',
		renderRunHeader(runInfo),
		'',
		'## Non-e2e job failures',
		renderNonE2eFailures(runInfo),
		'',
		'## E2E project failures',
		renderProjectFailures(projects),
		'',
		'## Historical test health (e2e-test-insights)',
		renderHistory(history),
		'',
		'---',
		'Analyze the failures above. Read all referenced screenshots in parallel before writing the report. Output the final markdown report as instructed.',
	].join('\n');

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
	if (!report) {
		console.error('[analyzer] no markdown report produced');
		writeStepSummary('## E2E Failure Analysis\n\n_Analyzer produced no report. Check action logs._\n');
		process.exit(1);
	}

	writeStepSummary(report);
	writeFileSync(join(WORK_DIR, 'analysis-report.md'), report);
	console.log(`[analyzer] wrote ${report.length} chars to step summary`);
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
