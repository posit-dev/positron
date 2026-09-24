/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Drives the Claude Agent SDK to run the exploratory-test skill against a
// Positron instance already launched and attached by the workflow.

import { query } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderReportHtml } from './html.mjs';
import { resolveReport, withPrLine, buildCostRecord, renderCostFooter, buildShotsBaseUrl, parsePosIntEnv, parseVerdicts, annotateFindingsTable, hasFindings, renderStepSummary, runOutcome } from './lib.mjs';

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
// The verify pass never drives the app, so it needs far fewer turns than the
// run it checks; two trial passes used 22 and 26 tool calls.
const VERIFY_MODEL = process.env.VERIFY_MODEL || 'sonnet';
const VERIFY_MAX_TURNS = parsePosIntEnv('VERIFY_MAX_TURNS', 60, process.env.VERIFY_MAX_TURNS);
const VERIFY_ENABLED = process.env.VERIFY !== 'false';
// Off for teams whose AI policy does not allow the report's copy-for-agent prompts.
const AGENT_PROMPTS = process.env.AGENT_PROMPTS !== 'false';
// The verification bills separately from the explore pass, so its cost record
// outlives the function that produces it.
let verifyCost = buildCostRecord(null);
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
	'**Do NOT clean up the pre-launched instance.** Do not run `stop.sh` against it, do not close the `positron` Playwright session, do not remove the run directory. The container is destroyed when the job ends, and cleanup would delete the screenshots before they are uploaded. Instances you launched yourself are yours to stop.',
	`**Keep the logs of any instance you launch.** \`stop.sh\` takes the run directory with it, and \`code.log\` is the only record of what the app did. Copy it to \`${WORK_DIR}/logs/<cdp-port>-code.log\` before you stop that instance. A finding whose log was deleted cannot be checked by the person reading the report, and the container is destroyed at job end anyway, so there is nothing to tidy up for.`,
	'**Do not render the report.** Skip the skill\'s `render.mjs` step; the workflow renders `index.html` itself once verification has been added.',
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

Positron is already launched and a Playwright session named \`positron\` is attached to it on CDP port ${CDP_PORT}. Use it for anything the running app can show you.

When you need a state the running app cannot reach -- a tool absent at startup, a cold cache, a fresh profile -- launch your own instance rather than bending this one. \`launch.sh\` picks free ports and its own run directory, so it runs alongside this one safely. Attach it under a different session name and leave the \`positron\` session alone. Stop the instances you launched once you are done with them; never stop this one. Record any instance you launched in Run setup.

## Cold start

\`npm run prelaunch\` already ran in this job. \`launch.sh\` runs it again and it is the slow part, so strip it once and reuse the result:

\`\`\`bash
sed 's#node build/lib/preLaunch.ts#true#' \\
  .claude/skills/drive-positron/scripts/launch.sh > /tmp/launch-cold.sh
chmod +x /tmp/launch-cold.sh
\`\`\`

To make a tool read as absent, drop its directory from PATH for the new process rather than moving the binary on disk -- nothing to restore afterwards:

\`\`\`bash
COLD_PATH=$(echo "$PATH" | sed -e 's#:/root/.local/bin##' -e 's#:/root/.venv/bin##')
env PATH="$COLD_PATH" /tmp/launch-cold.sh --source-user-data-dir /tmp/positron-seed -- <app args>
\`\`\`

Attach the result under its own session name and stop it with \`stop.sh --cdp-port <port>\` when you are done with it.

The Python extension caches uv and conda detection for the extension host's lifetime, and reloading the window does not restart the extension host. A fresh instance is the only reliable way to make one of those tools read as absent.

Drive the pre-launched instance from the repository root at \`${REPO_ROOT}\` with:

\`\`\`bash
npx @playwright/cli -s=positron snapshot
\`\`\`

Read \`${REPO_ROOT}/.claude/skills/drive-positron/SKILL.md\` for the full command surface before driving.
`;

/**
 * Re-reads the finished report with a fresh agent that never drove the app.
 *
 * The reporting agent cannot audit itself: one run wrote "shipped defaults" on
 * the Only under line and described the fake HOME it had just introduced in the
 * same sentence, then filed the resulting hang as a major defect. A separate
 * agent asked what the setup could explain and found the cause in launch.sh in
 * about 80k tokens, under one percent of what the run itself reads.
 *
 * Read-only and advisory. Verdicts are appended, never applied: a pass that can
 * delete findings can bury real ones where nobody sees it happen.
 */
// Takes no report: the verifier is pointed at report.md on disk rather than
// handed its text, so that it reads the same bytes the reviewer will.
async function verifyReport() {
	const prompt = [
		'You are verifying an exploratory-test report written by a different agent. Decide, for each finding, whether it is a genuine product defect. Be adversarial: the report is a claim, not evidence.',
		'',
		`Report: \`${join(WORK_DIR, 'report.md')}\``,
		`The reporting agent's own action log, with timestamps: \`${join(WORK_DIR, 'actions.log')}\``,
		`Repository: \`${REPO_ROOT}\`. Read files at a ref with \`git show <ref>:<path>\`. Do not modify anything.`,
		'',
		`See the change under test with \`git -C ${REPO_ROOT} diff ${BASE_SHA}...${HEAD_SHA}\`.`,
		'',
		'For EACH finding, answer these three questions explicitly:',
		'',
		"1. Does the code support the report's stated cause hypothesis? Read the files it names and quote the lines that confirm or contradict it.",
		'2. Could anything the reporting agent did to its own test environment produce the reported symptom? Read the action log and Run details for how it set the machine up, then ask whether that setup, rather than the product, explains what it saw.',
		'3. Is the `Introduced?` value consistent with the diff? A defect in code the diff did not touch is not introduced by this change, though it may be newly reachable because of it.',
		'',
		'Then give a verdict per finding: CONFIRMED, FALSE POSITIVE, or UNRESOLVED (say what evidence is missing).',
		'',
		'Also flag any place where the report asserts a check it could not have performed as described.',
		'',
		'Start your reply with a single machine-readable line, exactly this shape, one entry per finding in the table:',
		'',
		'VERDICTS: 1=CONFIRMED; 2=FALSE POSITIVE',
		'',
		'It is read to annotate the findings table, so use only CONFIRMED, FALSE POSITIVE or UNRESOLVED, and number the findings as the table does.',
		'',
		'Then keep it short. The table column is what a reviewer reads; this section is for what the column cannot say.',
		'',
		'- A finding you CONFIRM gets one line: what convinced you.',
		'- A finding you dispute or cannot resolve gets a short paragraph: the evidence that contradicts it, or what is missing.',
		'- End with one line naming anything the report claimed but could not have checked, or `No process issues.`',
		'',
		'No preamble, no restating the finding, no summary of the report. Do not write any files.',
	].join('\n');

	const chunks = [];
	for await (const message of query({
		prompt,
		options: {
			model: VERIFY_MODEL,
			cwd: REPO_ROOT,
			allowedTools: ['Bash', 'Read', 'Glob', 'Grep'],
			maxTurns: VERIFY_MAX_TURNS,
			thinking: { type: 'disabled' },
			stderr: data => process.stderr.write(`[verify stderr] ${data}`),
			...(CLAUDE_CODE_PATH ? { pathToClaudeCodeExecutable: CLAUDE_CODE_PATH } : {}),
		},
	})) {
		if (message.type === 'assistant') {
			const text = (message.message?.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
			if (text) {
				chunks.push(text);
			}
		} else if (message.type === 'result') {
			verifyCost = buildCostRecord(message);
			console.log(`[verify] result: ${JSON.stringify(verifyCost)}`);
			writeFileSync(join(WORK_DIR, 'verify-cost.json'), JSON.stringify(verifyCost, null, 2));
		}
	}
	return chunks.length ? chunks[chunks.length - 1] : null;
}

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
		'**The build is already the branch.** `out/` was compiled in this job from the ref under test, and the restored caches hold npm dependencies, built-ins and Playwright, never compiled output. Skip the skill\'s build-vs-branch grep and say in Run details that CI compiled it.',
		'',
		'Write the report to `report.md` in the run directory. Return a two or three line summary and nothing else.',
	].join('\n');

	console.log(`[exploratory] WORK_DIR=${WORK_DIR} model=${MODEL} maxTurns=${MAX_TURNS}`);
	console.log(`[exploratory] user prompt:\n${userPrompt}`);

	const assistantMessages = [];
	let cost = buildCostRecord(null);
	// Counts assistant messages, which is not what maxTurns limits: the SDK's
	// own num_turns runs about 40% lower (155 messages to 90 turns on one run,
	// 238 to 142 on another). Labelled "msg" so a live log cannot be read as
	// approaching the cap.
	let messageCount = 0;

	for await (const message of query({
		prompt: userPrompt,
		options: {
			model: MODEL,
			cwd: REPO_ROOT,
			systemPrompt,
			allowedTools: ['Bash', 'Read', 'Glob', 'Grep'],
			// No permissionMode: 'bypassPermissions'. The CLI refuses
			// --dangerously-skip-permissions under euid 0 and the job container
			// runs as root, so it exited 1 before doing any work. The
			// allowedTools list above is what actually grants the tools.
			// Forward the CLI's stderr: without it the SDK discards it and a
			// refusal to start is indistinguishable from a crash.
			stderr: data => process.stderr.write(`[claude-code stderr] ${data}`),
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
			messageCount++;
			const content = message.message?.content || [];
			const textBlocks = content.filter(b => b.type === 'text').map(b => b.text);
			const toolUses = content.filter(b => b.type === 'tool_use').map(b => `${b.name}(${JSON.stringify(b.input).slice(0, 200)})`);
			if (textBlocks.length) {
				const joined = textBlocks.join('\n');
				assistantMessages.push(joined);
				console.log(`[msg ${messageCount}] assistant text (${joined.length} chars):\n${joined.slice(0, 1000)}${joined.length > 1000 ? '\n...(truncated)' : ''}`);
			}
			if (toolUses.length) {
				console.log(`[msg ${messageCount}] tool calls: ${toolUses.join(' | ')}`);
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

	// Lazy: verifyCost is not filled in until the verification below has run, and
	// rendering this eagerly left the verify line and the total out of every
	// footer. In the order they ran; the gate bills in its own job.
	const footer = () => renderCostFooter([
		{ label: 'explore', main: true, cost },
		{ label: 'verify', cost: verifyCost },
	], MAX_TURNS);
	// Only a /test run has a PR in its event; a dispatched run has none.
	const report = withPrLine(resolveReport(fileReport, assistantMessages), process.env.GITHUB_REPOSITORY, process.env.PR_NUMBER);
	const partial = typeof cost.num_turns === 'number' && cost.num_turns >= MAX_TURNS;
	// Read by the workflow to choose the final reaction and the PR comment.
	// Written before anything below can exit, so a run with no report still
	// says why.
	if (process.env.GITHUB_OUTPUT) {
		appendFileSync(process.env.GITHUB_OUTPUT, `outcome=${runOutcome({ report, numTurns: cost.num_turns, maxTurns: MAX_TURNS })}\n`);
	}

	// What goes in report.md, and what goes in the job summary. They used to be
	// the same string: the summary is a signpost now, and the report is the
	// thing it points at.
	let reportMarkdown = null;
	let summary;
	if (report) {
		// The report opens with its own "# Exploratory test: ..." heading, so a
		// wrapper heading here would render two titles. The partial and
		// no-report branches below still need one: they have no report to
		// supply it. Written when the reply was the only copy, or the PR line
		// changed it.
		if (report !== fileReport) {
			writeFileSync(join(WORK_DIR, 'report.md'), report);
		}

		// Verification runs against report.md on disk, so it has to come after
		// the fallback write above.
		let verdicts = null;
		let verifyFailed = false;
		if (VERIFY_ENABLED && !hasFindings(report)) {
			console.log('[verify] skipped: the report has no findings to verify');
		} else if (VERIFY_ENABLED) {
			try {
				verdicts = await verifyReport();
			} catch (err) {
				// A failed verification must not cost the run its report. Say so
				// in the summary rather than dropping it silently.
				console.error(`[verify] failed: ${err}`);
				verifyFailed = true;
				verdicts = `_Verification did not complete: ${err}. The findings above are unreviewed._`;
			}
		}

		// The column is what a reviewer scanning the table actually sees; the
		// section below carries the reasoning. Annotation is best effort and
		// never removes a row, because a wrong FALSE POSITIVE that deleted a
		// real finding would be invisible to everyone.
		// Collapsed, and last: the Verified column is what a reviewer reads, and
		// this is the reasoning behind it. A failed pass stays open, because
		// "these findings are unreviewed" is not a detail to hide behind a
		// click. The blank lines around the markdown are load bearing.
		const preamble = 'A second agent re-read this report with the repository but without driving the app. Advisory only: no finding was changed or removed.';
		const section = verifyFailed
			? `## Verification\n\n${verdicts}\n`
			: `<details>\n<summary>Verification details</summary>\n\n${preamble}\n\n${verdicts}\n\n</details>\n`;
		const reviewed = verdicts
			? `${annotateFindingsTable(report, parseVerdicts(verdicts))}\n\n${section}`
			: report;
		reportMarkdown = `${reviewed}\n\n${footer()}\n`;
		// Written with the footer: report.md is published to the CDN on its own,
		// where the step summary's copy of the cost is not reachable.
		writeFileSync(join(WORK_DIR, 'report.md'), reportMarkdown);
		// index.html is what the published run directory's URL already points at,
		// and a rendered page is easier to read than raw markdown with absolute
		// image URLs in it. The markdown stays: the verification pass reads it,
		// and a file you can grep is worth keeping.
		try {
			writeFileSync(join(WORK_DIR, 'index.html'), renderReportHtml(reportMarkdown, {
				agentPrompts: AGENT_PROMPTS,
				// Evidence in the prompt has to open from wherever it is pasted.
				base: REPORT_BASE_URL || WORK_DIR,
				diff: `${BASE_SHA.slice(0, 8)}...${HEAD_SHA.slice(0, 8)}`,
			}));
		} catch (err) {
			console.error(`[report] could not render HTML, markdown is unaffected: ${err}`);
		}
		summary = renderStepSummary(reportMarkdown, REPORT_BASE_URL);
	} else if (partial) {
		summary = `## Exploratory test: partial run\n\nThe agent hit the ${MAX_TURNS}-turn cap before writing a report. \`actions.log\` and any screenshots captured so far are in the artifact.\n\n${footer()}\n`;
	} else {
		summary = `## Exploratory test: no report\n\nThe agent produced no report. Check the action logs.\n\n${footer()}\n`;
	}

	if (STEP_SUMMARY) {
		appendFileSync(STEP_SUMMARY, summary);
	}
	// The full report still goes to the action log. It is the one copy that
	// survives an artifact upload or a CDN publish that did not happen.
	console.log(reportMarkdown ?? summary);

	if (!report) {
		process.exit(1);
	}
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
