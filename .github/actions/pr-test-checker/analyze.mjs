#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Drive the Claude Agent SDK to grade a PR's test coverage. Reads the
// pre-built context.json (PR metadata, classified files, diff) and the
// pr-test-checker SKILL.md, then asks the model for a single graded report.
// Writes the final markdown to comment.md for the upsert step to post.

import { query } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync, existsSync, writeFileSync, realpathSync } from 'node:fs';
import { join, resolve as resolvePath, relative as relativePath, isAbsolute } from 'node:path';
// Shared with the local `pete-local` skill so both paths emit identical skip
// verdicts. Lives in the skill tree (also checked out by the workflow).
import { renderSkipComment } from '../../../.claude/skills/pr-test-checker/scripts/context-core.mjs';

const WORK_DIR = mustEnv('WORK_DIR');
const REPO_ROOT = mustEnv('REPO_ROOT');
const SKILL_PATH = mustEnv('SKILL_PATH');
const MODEL = process.env.MODEL || 'opus';
const MAX_TURNS = parsePosIntEnv('MAX_TURNS', 25);
const PROMPT_WARN_CHARS = parsePosIntEnv('PROMPT_WARN_CHARS', 400_000);
// Same musl-resolver workaround as e2e-failure-analyzer.
const CLAUDE_CODE_PATH = process.env.CLAUDE_CODE_PATH || undefined;

function mustEnv(name) {
	const v = process.env[name];
	if (!v) {
		console.error(`Missing required env var: ${name}`);
		process.exit(2);
	}
	return v;
}

function parsePosIntEnv(name, fallback) {
	const raw = process.env[name];
	if (raw === undefined || raw === '') { return fallback; }
	const n = Number(raw);
	if (!Number.isInteger(n) || n <= 0) {
		console.warn(`[analyzer] WARN: invalid ${name}=${raw}, falling back to ${fallback}`);
		return fallback;
	}
	return n;
}

function readJsonOrExit(path) {
	if (!existsSync(path)) {
		console.error(`Required input missing: ${path}`);
		process.exit(2);
	}
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch (err) {
		console.error(`Failed to parse ${path}: ${err.message}`);
		process.exit(1);
	}
}

// --- Prompt building --------------------------------------------------------

function renderPrHeader(pr, stats) {
	return [
		`PR: #${pr.number} -- ${pr.title}`,
		`Author: ${pr.author}`,
		`Branch: ${pr.headRef} -> ${pr.baseRef}`,
		`URL: ${pr.url}`,
		`Size: +${stats.additions} / -${stats.deletions} across ${stats.fileCount} files`,
		`Test files in PR: ${stats.testFileCount}; Source files in PR: ${stats.sourceFileCount}`,
	].join('\n');
}

function renderPrBody(body) {
	if (!body || !body.trim()) { return '(empty)'; }
	// Cap PR body -- some authors paste huge logs.
	const capped = body.length > 4000 ? body.slice(0, 4000) + '\n[...PR body truncated]' : body;
	return capped;
}

function renderFileTable(files) {
	const lines = ['| File | Category | +/- |', '|------|----------|-----|'];
	for (const f of files) {
		lines.push(`| \`${f.path}\` | ${f.category} | +${f.additions}/-${f.deletions} |`);
	}
	return lines.join('\n');
}

function buildUserPrompt(context) {
	const sections = [
		'## PR metadata',
		renderPrHeader(context.pr, context.stats),
		'',
		'## PR description',
		renderPrBody(context.pr.body),
		'',
		'## Changed files (pre-classified)',
		renderFileTable(context.files),
		'',
		'## Diff',
		'```diff',
		context.diff,
		'```',
		context.diffTruncated ? '\n_Note: diff was truncated. Use Read/Grep to inspect specific files if needed._\n' : '',
		'',
		'## Repo access',
		`REPO_ROOT is the sparse checkout root. Test taxonomy lives in \`CLAUDE.md\` and \`.claude/rules/vitest-tests.md\`. You can Read/Grep/Glob within \`src/\`, \`extensions/\`, and \`test/e2e/\` to find existing coverage.`,
		'',
		'---',
		'Investigate per the SKILL.md steps, then output the final graded report as your last message. Output the report exactly once, in the exact markdown template from the skill.',
	];
	return sections.join('\n');
}

// --- Tool confinement (defense in depth) -------------------------------------

// The agent reads untrusted PR content. Rather than trust it with
// bypassPermissions (which lets Read open any absolute path, e.g.
// /proc/self/environ), we run in the default permission mode and gate every
// tool call through canUseTool: only the read-only tools are allowed, and only
// when their target path stays inside the analysis root (REPO_ROOT, the
// PR-head checkout). This blocks reads of the process environment, the home
// directory, or anything outside the checkout at the source -- a secret can't
// be reached in the first place. The secret-redaction pass below stays as a
// second layer.
const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep']);

/**
 * True if `candidate` (a path or glob, absolute or relative to `root`) resolves
 * to a location inside `root`. Lexical check first; for paths that exist, a
 * realpath check also rejects symlinks that escape the root.
 */
function isWithinRoot(root, candidate) {
	const target = resolvePath(root, candidate);
	const rel = relativePath(root, target);
	const lexicalInside = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
	if (!lexicalInside) {
		return false;
	}
	try {
		const realRel = relativePath(realpathSync(root), realpathSync(target));
		return realRel === '' || (!realRel.startsWith('..') && !isAbsolute(realRel));
	} catch {
		// Target doesn't exist (e.g. a glob pattern with wildcards) -- the
		// lexical check already confirmed it can't escape the root.
		return true;
	}
}

/**
 * Build a canUseTool callback that allows only the read-only tools, and only
 * when every path argument they carry stays inside `root`. Everything else is
 * denied. Fully non-interactive: it always returns an allow/deny decision.
 */
function makeCanUseTool(root) {
	return async (toolName, input) => {
		if (!READ_ONLY_TOOLS.has(toolName)) {
			return { behavior: 'deny', message: `Tool "${toolName}" is not permitted; PETE may only read the checkout via Read/Glob/Grep.` };
		}
		// Collect the location-bearing args for this tool. Grep's `pattern` is a
		// regex and its `glob` is a filename filter, so neither is confined here.
		const candidates = [];
		if (toolName === 'Read') {
			if (typeof input.file_path !== 'string') {
				return { behavior: 'deny', message: 'Read requires a file_path.' };
			}
			candidates.push(input.file_path);
		} else if (toolName === 'Glob') {
			if (typeof input.pattern === 'string') { candidates.push(input.pattern); }
			if (typeof input.path === 'string') { candidates.push(input.path); }
		} else if (toolName === 'Grep') {
			if (typeof input.path === 'string') { candidates.push(input.path); }
		}
		for (const candidate of candidates) {
			if (!isWithinRoot(root, candidate)) {
				return { behavior: 'deny', message: `Path "${candidate}" is outside the analysis root; PETE reads are confined to the PR checkout.` };
			}
		}
		return { behavior: 'allow' };
	};
}

// --- Agent loop --------------------------------------------------------------

async function runAgent(systemPrompt, userPrompt) {
	const assistantMessages = [];
	let turnCount = 0;
	let usage = null;

	for await (const message of query({
		prompt: userPrompt,
		options: {
			model: MODEL,
			cwd: REPO_ROOT,
			systemPrompt,
			// Gate every tool call through canUseTool (see makeCanUseTool): only
			// Read/Glob/Grep, and only inside REPO_ROOT. We deliberately do NOT
			// pre-allow the read tools via `allowedTools` -- a bare allow rule
			// auto-approves and skips the per-call path check. 'default' mode
			// routes un-ruled tool calls to canUseTool, which always returns a
			// decision, so the run stays non-interactive.
			permissionMode: 'default',
			canUseTool: makeCanUseTool(REPO_ROOT),
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
			usage = message.usage;
			console.log(`[analyzer] usage: input=${usage?.input_tokens} output=${usage?.output_tokens} cost_usd=${message.total_cost_usd}`);
		}
	}

	return { assistantMessages, turnCount, usage };
}

// --- Report extraction -------------------------------------------------------

const REPORT_HEADER = `## PETE's assessment`;

function pickReport(messages) {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		const idx = m.indexOf(REPORT_HEADER);
		if (idx >= 0) { return m.slice(idx); }
	}
	return messages.length ? messages[messages.length - 1] : null;
}

// --- Comment markup ----------------------------------------------------------

const COMMENT_MARKER = '<!-- pr-test-checker -->';

function wrapWithMarker(body) {
	return `${COMMENT_MARKER}\n${body}`;
}

// --- Secret redaction (defense in depth) -------------------------------------

// The agent runs over untrusted PR content with bypassPermissions, and its
// report is posted verbatim as a public PR comment. Its tools (Read/Glob/Grep)
// can't run commands and this step's env carries no GitHub token -- but Read
// can open absolute paths (e.g. /proc/self/environ), so a prompt-injection in
// PR content could in theory coax the model into echoing a secret from the
// environment into its report. As a last line of defense, scrub known secret
// shapes -- and the live ANTHROPIC_API_KEY value -- out of the report before it
// is ever written to comment.md. Any hit fails the step so nothing is posted.
const SECRET_PATTERNS = [
	/sk-ant-[A-Za-z0-9_-]{20,}/g,         // Anthropic API keys
	/gh[psour]_[A-Za-z0-9]{20,}/g,        // GitHub tokens (ghp_/gho_/ghs_/ghu_/ghr_)
	/github_pat_[A-Za-z0-9_]{20,}/g,      // GitHub fine-grained PATs
	/-----BEGIN[A-Z ]+PRIVATE KEY-----/g, // PEM private-key headers (App keys)
];

/**
 * Replace any occurrence of the live Anthropic key or a known secret shape with
 * `[REDACTED]`. Returns the scrubbed text and the number of redactions made.
 */
function redactSecrets(text) {
	let redactions = 0;
	let out = text;
	const liveKey = process.env.ANTHROPIC_API_KEY;
	if (liveKey && out.includes(liveKey)) {
		out = out.split(liveKey).join('[REDACTED]');
		redactions++;
	}
	for (const re of SECRET_PATTERNS) {
		out = out.replace(re, () => { redactions++; return '[REDACTED]'; });
	}
	return { text: out, redactions };
}

// --- Main --------------------------------------------------------------------

async function main() {
	const context = readJsonOrExit(join(WORK_DIR, 'context.json'));

	console.log(`[analyzer] PR #${context.pr.number}: ${context.pr.title}`);
	console.log(`[analyzer] files=${context.stats.fileCount} test=${context.stats.testFileCount} source=${context.stats.sourceFileCount} skip=${context.skip?.reason || 'no'}`);

	// Short-circuit: docs/config-only PRs skip the LLM entirely.
	if (context.skip) {
		const skipComment = wrapWithMarker(renderSkipComment(context));
		writeFileSync(join(WORK_DIR, 'comment.md'), skipComment);
		console.log(`[analyzer] short-circuited (${context.skip.reason}); wrote static comment`);
		return;
	}

	const systemPrompt = readFileSync(SKILL_PATH, 'utf8');
	const userPrompt = buildUserPrompt(context);

	if (userPrompt.length > PROMPT_WARN_CHARS) {
		console.warn(`[analyzer] WARN: prompt size ${userPrompt.length} chars exceeds soft threshold ${PROMPT_WARN_CHARS}.`);
	}

	console.log(`[analyzer] model=${MODEL} maxTurns=${MAX_TURNS} claudePath=${CLAUDE_CODE_PATH || '(default)'}`);
	console.log(`[analyzer] user prompt (${userPrompt.length} chars):\n${userPrompt.slice(0, 4000)}${userPrompt.length > 4000 ? '\n...(truncated)' : ''}`);

	const { assistantMessages, turnCount, usage } = await runAgent(systemPrompt, userPrompt);
	console.log(`[analyzer] agent finished after ${turnCount} turn(s); ${assistantMessages.length} assistant text message(s)`);

	const report = pickReport(assistantMessages);
	if (!report) {
		const fallback = [
			'## PETE\'s assessment 🧪',
			'',
			'**Verdict:** ⚪ _Unknown_ -- the analyzer produced no markdown report. Check action logs.',
			'',
			'---',
			'<sub>PETE (Positron Extreme Test Experiment): an LLM-based test-coverage advisor, currently in pilot. Run `/recheck-tests` to retry.</sub>',
		].join('\n');
		writeFileSync(join(WORK_DIR, 'comment.md'), wrapWithMarker(fallback));
		console.error('[analyzer] no markdown report produced; wrote fallback comment');
		process.exit(1);
	}

	const { text: safeReport, redactions } = redactSecrets(report);
	// Always write the scrubbed text (it is what the artifact preserves). If
	// anything was redacted, treat it as a possible prompt-injection exfil
	// attempt: fail the step so the upsert step is skipped and nothing posts,
	// and surface it for a human to inspect the uploaded artifact.
	writeFileSync(join(WORK_DIR, 'comment.md'), wrapWithMarker(safeReport));
	if (redactions > 0) {
		console.error(`::error::[analyzer] redacted ${redactions} secret-shaped string(s) from the report; refusing to post. Possible prompt-injection in PR content -- inspect the uploaded artifact.`);
		process.exit(1);
	}
	console.log(`[analyzer] wrote ${safeReport.length} chars to comment.md (turns=${turnCount}, input_tokens=${usage?.input_tokens}, output_tokens=${usage?.output_tokens})`);
}

main().catch(err => {
	console.error('[analyzer] fatal:', err);
	process.exit(1);
});
