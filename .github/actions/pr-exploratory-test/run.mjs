/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Drives the Claude Agent SDK to run the exploratory-testing skill against a
// Positron instance already launched and attached by the workflow.

import { query } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveReport, buildCostRecord, renderCostFooter, buildShotsBaseUrl, parsePosIntEnv } from './lib.mjs';

const WORK_DIR = mustEnv('WORK_DIR');
const REPO_ROOT = mustEnv('REPO_ROOT');
const SKILL_PATH = mustEnv('SKILL_PATH');
const BASE_SHA = mustEnv('BASE_SHA');
const HEAD_SHA = mustEnv('HEAD_SHA');
const BRANCH = mustEnv('BRANCH');
const DIFF_STAT = process.env.DIFF_STAT || '(no diff stat provided)';
const CDP_PORT = mustEnv('CDP_PORT');
const MODEL = process.env.MODEL || 'opus';
const MAX_TURNS = parsePosIntEnv('MAX_TURNS', 200, process.env.MAX_TURNS);
const REPORT_BASE_URL = buildShotsBaseUrl(process.env.REPORT_BASE_URL || '');
const STEP_SUMMARY = process.env.GITHUB_STEP_SUMMARY;
// Workaround for claude-agent-sdk-typescript#296 (resolver picks musl over
// glibc on Linux): action.yml installs @anthropic-ai/claude-code globally
// and passes the resolved path here.
const CLAUDE_CODE_PATH = process.env.CLAUDE_CODE_PATH || undefined;
// Fails fast with a named error instead of letting the SDK surface an opaque
// auth error when a 1Password resolution comes back empty.
mustEnv('ANTHROPIC_API_KEY');

function mustEnv(name) {
	const v = process.env[name];
	if (!v) {
		console.error(`Missing required env var: ${name}`);
		process.exit(1);
	}
	return v;
}

// Base overrides always apply; the screenshot-linking override is appended
// only when a CDN base URL is actually configured, so an empty
// REPORT_BASE_URL never puts an unusable "published at ``" sentence into the
// prompt (see buildShotsBaseUrl in lib.mjs).
const CI_OVERRIDES = [
	'**You are the tester.** Ignore "Run it in a subagent". Do not delegate; do the exploring yourself.',
	`**Write the run directory to \`${WORK_DIR}\`**, not to any path under \`~/.claude\`. Put \`report.md\` and \`actions.log\` directly in it and screenshots in \`${WORK_DIR}/shots/\`.`,
	'**Do NOT clean up.** Do not run `stop.sh`, do not close the Playwright session, do not remove the run directory. The container is destroyed when the job ends, and cleanup would delete the screenshots before they are uploaded.',
];
if (REPORT_BASE_URL) {
	CI_OVERRIDES.push(`**Link screenshots with their public URL.** The run directory is published at \`${REPORT_BASE_URL}\`. Where the skill says to cite a shot as \`[shots/<file>](shots/<file>)\`, write \`[shots/<file>](${REPORT_BASE_URL}/shots/<file>)\` instead, and embed with \`![](${REPORT_BASE_URL}/shots/<file>)\`. A relative path is unreachable to anyone reading the report outside this container.`);
}
const CI_OVERRIDES_LIST = CI_OVERRIDES.map((text, i) => `${i + 1}. ${text}`).join('\n');

const CI_TAIL = `

---

# CI run

You are running inside a GitHub Actions container. ${CI_OVERRIDES.length} override${CI_OVERRIDES.length === 1 ? '' : 's'} to the skill above:

${CI_OVERRIDES_LIST}

Positron is already launched and a Playwright session named \`positron\` is already attached to it on CDP port ${CDP_PORT}. Do not launch it again. Drive it from the repository root at \`${REPO_ROOT}\` with:

\`\`\`bash
npx @playwright/cli -s=positron snapshot
\`\`\`

Read \`${REPO_ROOT}/.claude/skills/drive-positron/SKILL.md\` for the full command surface before driving.
`;

async function main() {
	mkdirSync(join(WORK_DIR, 'shots'), { recursive: true });

	const systemPrompt = readFileSync(SKILL_PATH, 'utf8') + CI_TAIL;

	const userPrompt = [
		'# Brief',
		'',
		`Checkout: \`${REPO_ROOT}\``,
		`Branch under test: \`${BRANCH}\``,
		`Head: \`${HEAD_SHA}\``,
		`Base: \`${BASE_SHA}\``,
		`Run directory: \`${WORK_DIR}\``,
		'',
		'## What changed',
		'',
		'```',
		DIFF_STAT,
		'```',
		'',
		`See the full diff with \`git -C ${REPO_ROOT} diff ${BASE_SHA}...${HEAD_SHA}\`.`,
		'',
		'## Your task',
		'',
		'Read the diff to work out what the change is meant to do as a user would describe it, and what its blast radius is. Then explore that, as a user, and report genuine problems.',
		'',
		'Prove the build is the branch before exploring, as the skill requires: grep the compiled output under `out/` for a string the diff introduces, and record the check in Run setup.',
		'',
		'Write the report to `report.md` in the run directory. Return a two or three line summary and nothing else.',
	].join('\n');

	console.log(`[exploratory] WORK_DIR=${WORK_DIR} model=${MODEL} maxTurns=${MAX_TURNS}`);
	console.log(`[exploratory] user prompt:\n${userPrompt}`);

	const assistantMessages = [];
	let cost = buildCostRecord(null);
	let turnCount = 0;

	for await (const message of query({
		prompt: userPrompt,
		options: {
			model: MODEL,
			cwd: REPO_ROOT,
			systemPrompt,
			allowedTools: ['Bash', 'Read', 'Glob', 'Grep'],
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
			cost = buildCostRecord(message);
			console.log(`[exploratory] result: ${JSON.stringify(cost)}`);
		}
	}

	writeFileSync(join(WORK_DIR, 'cost.json'), JSON.stringify(cost, null, 2));

	// The agent was told to write report.md itself; that file is authoritative
	// when present. Only fall back to scraping chat text if it is missing or
	// empty, and never overwrite a report that came from the file.
	let fileReport = null;
	try {
		fileReport = readFileSync(join(WORK_DIR, 'report.md'), 'utf8');
	} catch {
		// Expected when the agent never wrote the file; resolveReport falls
		// back to scraping chat text.
	}

	const footer = renderCostFooter(cost, MAX_TURNS);
	const report = resolveReport(fileReport, assistantMessages);
	const partial = typeof cost.num_turns === 'number' && cost.num_turns >= MAX_TURNS;

	let summary;
	if (report) {
		summary = `## Exploratory test\n\n${report}\n\n${footer}\n`;
		if (!(typeof fileReport === 'string' && fileReport.trim().length > 0)) {
			writeFileSync(join(WORK_DIR, 'report.md'), report);
		}
	} else if (partial) {
		summary = `## Exploratory test: partial run\n\nThe agent hit the ${MAX_TURNS}-turn cap before writing a report. \`actions.log\` and any screenshots captured so far are in the artifact.\n\n${footer}\n`;
	} else {
		summary = `## Exploratory test: no report\n\nThe agent produced no report. Check the action logs.\n\n${footer}\n`;
	}

	if (STEP_SUMMARY) {
		appendFileSync(STEP_SUMMARY, summary);
	}
	console.log(summary);

	if (!report) {
		process.exit(1);
	}
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
