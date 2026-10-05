/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Drives the Claude Agent SDK to run the exploratory-test skill against a
// Positron instance already launched and attached by the workflow.

import { query } from '@anthropic-ai/claude-agent-sdk';
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { missingFiles, readRunDir, skillVersion, writeRunPage } from '../../../.claude/skills/exploratory-test/renderer/html.mjs';
import { parseReport } from '../../../.claude/skills/exploratory-test/renderer/report-parse.mjs';
import { applyVerification, buildVerifyPrompt, fromVerdictLine, hasFindings, observedLinked, readKnownIssues, verifyLogLines } from '../../../.claude/skills/exploratory-test/renderer/finish.mjs';
import { buildKnownIssuesBrief } from '../../../.claude/skills/exploratory-test/renderer/known-issues.mjs';
import { buildStats, readChecks } from '../../../.claude/skills/exploratory-test/renderer/stats.mjs';
import { buildTaskLine, resolveReport, withPrLine, buildCostRecord, renderCostFooter, buildShotsBaseUrl, parsePosIntEnv, renderStepSummary, renderSummaryTarget, runOutcome, turnCapWarning, parseTimeLimit, timeUpHook, WRAP_UP_MINUTES, ENVIRONMENT } from './lib.mjs';

// Dates the report footer's copyright.
const STARTED_AT = new Date();
const WORK_DIR = mustEnv('WORK_DIR');
const REPO_ROOT = mustEnv('REPO_ROOT');
const EXPLORER_PATH = mustEnv('EXPLORER_PATH');
// Beside explorer.md, so both prompts come from the harness checkout rather
// than the branch under test, which may not have this file yet.
const VERIFIER_PATH = join(dirname(EXPLORER_PATH), 'verifier.md');
const BASE_SHA = mustEnv('BASE_SHA');
const HEAD_SHA = mustEnv('HEAD_SHA');
const BRANCH = mustEnv('BRANCH');
const DIFF_STAT = process.env.DIFF_STAT || '(no diff stat provided)';
const CDP_PORT = mustEnv('CDP_PORT');
const MODEL = process.env.MODEL || 'opus';
// What the person asked to test; empty tests the diff.
const FOCUS = process.env.FOCUS || '';
// Unset leaves each model at its own default effort.
const EFFORT = process.env.EFFORT || '';
const MAX_TURNS = parsePosIntEnv('MAX_TURNS', 200, process.env.MAX_TURNS);
// Minutes of exploring, or null for no limit. The agent is not told the limit,
// only when it is up, and is stopped WRAP_UP_MINUTES later.
const TIME_LIMIT = parseTimeLimit(process.env.TIME_LIMIT);
// Set when the hard stop fires, so the outcome and stats can say so.
let timedOut = false;
let timeWasUp = false;
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

// Shots stay relative (`shots/<file>`): index.html and report.md are
// published beside shots/, so they resolve without a base URL in the prompt.
const RENDER_PATH = fileURLToPath(new URL('../../../.claude/skills/exploratory-test/renderer/render.mjs', import.meta.url));
const CI_OVERRIDES = [
		`**Write the run directory to \`${WORK_DIR}\`**, not to any path under \`~/.claude\`. Put \`report.md\`, \`ledger.md\` and \`actions.log\` directly in it, screenshots in \`${WORK_DIR}/shots/\`, and the files your scenarios use in \`${WORK_DIR}/files/\` (the skill's Test files rule).`,
	'**Do NOT clean up the pre-launched instance.** Do not run `stop.sh` against it, do not close the `positron` Playwright session, do not remove the run directory. The container is destroyed when the job ends, and cleanup would delete the screenshots before they are uploaded. Instances you launched yourself are yours to stop.',
	`**Keep the logs in \`${WORK_DIR}/logs/\`.** Follow the skill's Logs section for the pre-launched instance and any you launch. The pre-launched instance's run directory is the only one under \`/tmp/positron-dev-launch/\` when you start, so note it before you launch another. A finding whose log was deleted cannot be checked by the person reading the report.`,
	'**Do not look the PR up.** Leave out the report\'s `PR:` line, which the workflow adds, and start the ledger\'s header line at `Branch:`.',
	`**Do not render the report; check it.** The workflow renders \`index.html\` itself once verification has been added. Instead of the skill's render step, run \`node ${RENDER_PATH} --check "${WORK_DIR}/report.md"\`, fix every line it prints, and run it again until it prints none.`,
];
const CI_OVERRIDES_LIST = CI_OVERRIDES.map((text, i) => `${i + 1}. ${text}`).join('\n');

const CI_TAIL = `

---

# CI run

You are running inside a GitHub Actions container. ${CI_OVERRIDES.length} override${CI_OVERRIDES.length === 1 ? '' : 's'} to the skill above:

${CI_OVERRIDES_LIST}

## What this container has

${ENVIRONMENT}

A path that needs something on the not-available list is the environment, not a finding. Test what you can reach without it -- the UI up to that point, the error a user gets when it is unreachable -- and list the rest as dropped with the missing piece named.

Everything you write here is published: the skill's Credentials section applies to every key listed above.

## The running app

Positron is already launched and a Playwright session named \`positron\` is attached to it on CDP port ${CDP_PORT}. Use it for anything the running app can show you.

When you need a state the running app cannot reach -- a tool absent at startup, a cold cache, a fresh profile -- launch your own instance rather than bending this one. \`launch.sh\` picks free ports and its own run directory, so it runs alongside this one safely. Attach it under a different session name and leave the \`positron\` session alone. Stop the instances you launched once you are done with them; never stop this one. Record any instance you launched under State manipulation in Run details.

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
	const prompt = buildVerifyPrompt(readFileSync(VERIFIER_PATH, 'utf8'), {
		workDir: WORK_DIR, repoRoot: REPO_ROOT, baseSha: BASE_SHA, headSha: HEAD_SHA,
	});

	const chunks = [];
	for await (const message of query({
		prompt,
		options: {
			model: VERIFY_MODEL,
			cwd: REPO_ROOT,
			allowedTools: ['Bash', 'Read', 'Glob', 'Grep'],
			maxTurns: VERIFY_MAX_TURNS,
			effort: 'medium',
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
	return chunks.length ? fromVerdictLine(chunks[chunks.length - 1]) : null;
}

async function main() {
	mkdirSync(join(WORK_DIR, 'shots'), { recursive: true });
	// Fetched by the workflow while the build ran; the verifier and renderer read it from the run directory.
	if (process.env.KNOWN_ISSUES && existsSync(process.env.KNOWN_ISSUES)) {
		copyFileSync(process.env.KNOWN_ISSUES, join(WORK_DIR, 'known-issues.json'));
	}
	const knownIssues = readKnownIssues(WORK_DIR);
	const knownBrief = buildKnownIssuesBrief(knownIssues);

	const systemPrompt = readFileSync(EXPLORER_PATH, 'utf8') + CI_TAIL;

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
		buildTaskLine(FOCUS),
		'',
		...(knownBrief ? [knownBrief, ''] : []),
		'**The build is already the branch.** `out/` was compiled in this job from the ref under test, and the restored caches hold npm dependencies, built-ins and Playwright, never compiled output. Skip the skill\'s build-vs-branch grep and say in Run details that CI compiled it.',
		'',
		'Write the report to `report.md` in the run directory. Return a two or three line summary and nothing else.',
	].join('\n');

	console.log(`[exploratory] WORK_DIR=${WORK_DIR} model=${MODEL} effort=${EFFORT || 'default'} maxTurns=${MAX_TURNS} timeLimit=${TIME_LIMIT ? `${TIME_LIMIT}m` : 'none'}`);
	console.log(`[exploratory] user prompt:\n${userPrompt}`);

	const assistantMessages = [];
	let cost = buildCostRecord(null);
	// Counts assistant messages, which is not what maxTurns limits: the SDK's
	// own num_turns runs about 40% lower (155 messages to 90 turns on one run,
	// 238 to 142 on another). Labelled "msg" so a live log cannot be read as
	// approaching the cap.
	let messageCount = 0;

	// With a time limit: a hook tells the agent when its time is up, and the
	// query is aborted WRAP_UP_MINUTES later if it is still going.
	const abortController = new AbortController();
	let hardStop;
	let timeLimitOptions = {};
	if (TIME_LIMIT) {
		const hook = timeUpHook({
			deadline: Date.now() + TIME_LIMIT * 60000,
			minutes: TIME_LIMIT,
			onTimeUp: () => {
				timeWasUp = true;
				console.log(`[exploratory] time limit: ${TIME_LIMIT}m are up; told the agent to wrap up`);
			},
		});
		// Logged on its first call, so a run shows the hook is wired up at all.
		let hookCalled = false;
		const logged = async input => {
			if (!hookCalled) {
				hookCalled = true;
				console.log(`[exploratory] time limit: hook active on ${input.hook_event_name}`);
			}
			return hook(input);
		};
		timeLimitOptions = { hooks: { PostToolUse: [{ hooks: [logged] }], PostToolUseFailure: [{ hooks: [logged] }] } };
		hardStop = setTimeout(() => {
			timedOut = true;
			console.log(`[exploratory] time limit: stopping the agent ${WRAP_UP_MINUTES}m after its time was up`);
			abortController.abort();
		}, (TIME_LIMIT + WRAP_UP_MINUTES) * 60000);
	}

	try {
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
				// Summarized display returns the notes the model writes between tool
				// calls, which otherwise arrive as empty thinking blocks.
				// gate.mjs and the analyzers still disable thinking for claude-code#63192
				// (a cancelled parallel tool batch wedges the session on a repeating 400).
				// If a run wedges that way, disable it here too.
				thinking: { type: 'adaptive', display: 'summarized' },
				...(EFFORT ? { effort: EFFORT } : {}),
				...(CLAUDE_CODE_PATH ? { pathToClaudeCodeExecutable: CLAUDE_CODE_PATH } : {}),
				...timeLimitOptions,
				abortController,
			},
		})) {
			if (message.type === 'assistant') {
				messageCount++;
				const content = message.message?.content || [];
				const textBlocks = content.filter(b => b.type === 'text').map(b => b.text);
				const notes = content.filter(b => b.type === 'thinking' && b.thinking).map(b => b.thinking);
				if (notes.length) {
					console.log(`[msg ${messageCount}] note: ${notes.join(' ').slice(0, 500)}`);
				}
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
	} catch (err) {
		// The hard stop aborts the query; what the agent wrote so far is still
		// the run's output, so it goes on to the report handling below.
		if (!timedOut) {
			throw err;
		}
		console.log(`[exploratory] the agent was stopped: ${err?.message ?? err}`);
	} finally {
		clearTimeout(hardStop);
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
	// A /test run has the PR from its event; a dispatched one from a lookup of its branch.
	const report = withPrLine(resolveReport(fileReport, assistantMessages), process.env.GITHUB_REPOSITORY, process.env.PR_NUMBER);
	const partial = typeof cost.num_turns === 'number' && cost.num_turns >= MAX_TURNS;
	// Read by the workflow to choose the final reaction and the PR comment.
	// Written before anything below can exit, so a run with no report still
	// says why.
	if (process.env.GITHUB_OUTPUT) {
		appendFileSync(process.env.GITHUB_OUTPUT, `outcome=${runOutcome({ report, numTurns: cost.num_turns, maxTurns: MAX_TURNS, timedOut })}\n`);
	}
	const nearCap = turnCapWarning({ numTurns: cost.num_turns, maxTurns: MAX_TURNS });
	if (nearCap) {
		console.log(nearCap);
	}

	// One line per run that GitHub keeps for 90 days, after the artifact is
	// gone: stats.mjs reads it back to compare skill versions. Written before
	// the page, which links stats.json from Run details.
	const recordStats = markdown => {
		const stats = buildStats({
			where: 'ci',
			date: STARTED_AT.toISOString(),
			run: process.env.GITHUB_RUN_ID,
			version: skillVersion(),
			model: cost.model,
			turns: cost.num_turns,
			maxTurns: MAX_TURNS,
			costUsd: (cost.total_cost_usd ?? 0) + (verifyCost.total_cost_usd ?? 0) || null,
			durationMs: (cost.duration_ms ?? 0) + (verifyCost.duration_ms ?? 0) || null,
			parsed: markdown ? parseReport(markdown) : null,
			checks: readChecks(WORK_DIR),
			timeLimit: TIME_LIMIT ? { minutes: TIME_LIMIT, reached: timeWasUp, stopped: timedOut } : null,
		});
		writeFileSync(join(WORK_DIR, 'stats.json'), `${JSON.stringify(stats, null, 2)}\n`);
		console.log(`[exploratory] stats: ${JSON.stringify(stats)}`);
	};

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
		const run = readRunDir(WORK_DIR);
		// Linked issues the run ran into still need a severity.
		const observed = observedLinked(knownIssues, run.ledger);
		if (VERIFY_ENABLED && !hasFindings(report) && !observed.length) {
			console.log('[verify] skipped: the report has no findings to verify');
		} else if (VERIFY_ENABLED) {
			try {
				verdicts = await verifyReport();
			} catch (err) {
				// A failed verification must not cost the run its report. Say so
				// in the summary rather than dropping it silently.
				console.error(`[verify] failed: ${err}`);
				verifyFailed = true;
				verdicts = `_Verification did not complete: ${err}. ${hasFindings(report) ? 'The findings above are unreviewed.' : 'The known issues above are unrated.'}_`;
			}
			for (const line of verifyLogLines(knownIssues, run.ledger, verifyFailed ? '' : verdicts)) {
				console.log(`[verify] ${line}`);
			}
		}

		// Annotation is best effort and never removes a row, because a wrong
		// FALSE POSITIVE that deleted a real finding would be invisible to
		// everyone. Shared with local runs through finish.mjs.
		const reviewed = verdicts ? applyVerification(report, verdicts, { failed: verifyFailed }) : report;
		reportMarkdown = `${reviewed}\n\n${footer()}\n`;
		// Written with the footer: report.md is published to the CDN on its own,
		// where the step summary's copy of the cost is not reachable.
		writeFileSync(join(WORK_DIR, 'report.md'), reportMarkdown);
		recordStats(reportMarkdown);
		// index.html is what the published run directory's URL already points at,
		// and a rendered page is easier to read than raw markdown with absolute
		// image URLs in it. The markdown stays: the verification pass reads it,
		// and a file you can grep is worth keeping.
		try {
			const parsed = parseReport(reportMarkdown, { ledger: run.ledger });
			await writeRunPage(join(WORK_DIR, 'index.html'), reportMarkdown, parsed, {
				agentPrompts: AGENT_PROMPTS,
				// Coverage is built from the run's ledger when it wrote one.
				ledger: run.ledger,
				// Evidence in the prompt has to open from wherever it is pasted.
				base: REPORT_BASE_URL || WORK_DIR,
				skillVersion: skillVersion(),
				diff: `${BASE_SHA.slice(0, 8)}...${HEAD_SHA.slice(0, 8)}`,
				fileExists: run.fileExists,
				readFile: run.readFile,
				startedAt: STARTED_AT,
				knownIssues,
			});
			// Warned rather than failed: the page still renders, with the missing files unlinked.
			const { logs, files } = missingFiles(parsed, run.fileExists);
			const missing = [...logs, ...files];
			if (missing.length) {
				console.error(`[report] WARN: files listed but not in the run directory: ${missing.join(', ')}`);
			}
		} catch (err) {
			console.error(`[report] could not render HTML, markdown is unaffected: ${err}`);
		}
		summary = renderStepSummary(reportMarkdown, REPORT_BASE_URL);
	} else if (timedOut) {
		summary = `## Exploratory test: stopped at the time limit\n\nThe agent was stopped ${WRAP_UP_MINUTES} minutes after its ${TIME_LIMIT}-minute time limit, before writing a report. \`actions.log\` and any screenshots captured so far are in the artifact.\n\n${footer()}\n`;
	} else if (partial) {
		summary = `## Exploratory test: partial run\n\nThe agent hit the ${MAX_TURNS}-turn cap before writing a report. \`actions.log\` and any screenshots captured so far are in the artifact.\n\n${footer()}\n`;
	} else {
		summary = `## Exploratory test: no report\n\nThe agent produced no report. Check the action logs.\n\n${footer()}\n`;
	}

	if (!report) {
		recordStats(null);
	}

	if (STEP_SUMMARY) {
		appendFileSync(STEP_SUMMARY, renderSummaryTarget(BRANCH, process.env.GITHUB_REPOSITORY, process.env.PR_NUMBER, FOCUS, TIME_LIMIT) + summary);
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
