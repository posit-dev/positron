/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Drives the Claude Agent SDK to run the exploratory-test skill against a
// Positron instance already launched and attached by the workflow.

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { missingFiles, readRunDir, writeRunPage } from '../../../.claude/skills/exploratory-test/renderer/page/html.mjs';
import { skillVersion } from '../../../.claude/skills/exploratory-test/renderer/page/page-common.mjs';
import { reportFromJson } from '../../../.claude/skills/exploratory-test/renderer/page/report-json.mjs';
import { MAIN_REPLAY_OFF, readKnownIssues } from '../../../.claude/skills/exploratory-test/renderer/agents/finish.mjs';
import { completeRun, costPasses, environmentBrief, environmentLines, EXPLORE_TIME_UP, readEnvironment, withMainReplay } from '../../../.claude/skills/exploratory-test/renderer/pipeline.mjs';
import { ensureCommit, mainBuildBrief, readMainBuild } from '../../../.claude/skills/exploratory-test/renderer/main-build.mjs';
import { mainReplayMs } from '../../../.claude/skills/exploratory-test/renderer/shared/main-check.mjs';
import { buildKnownIssuesBrief, pageIssueRefs } from '../../../.claude/skills/exploratory-test/renderer/known-issues.mjs';
import { buildStats, passStats, readChecks } from '../../../.claude/skills/exploratory-test/renderer/stats.mjs';
import { runSession } from './session.mjs';
import { buildTaskLine, describeChange, takeStepSummary, gitIn, mustEnv, renderCostFooter, buildShotsBaseUrl, parsePosIntEnv, renderStepSummary, runOutcome, turnCapWarning, parseTimeLimit, WRAP_UP_MINUTES, ENVIRONMENT } from './lib.mjs';

// Dates the report footer's copyright.
const STARTED_AT = new Date();
const WORK_DIR = mustEnv('WORK_DIR');
const REPO_ROOT = mustEnv('REPO_ROOT');
const EXPLORER_PATH = mustEnv('EXPLORER_PATH');
const BASE_SHA = mustEnv('BASE_SHA');
const HEAD_SHA = mustEnv('HEAD_SHA');
const BRANCH = mustEnv('BRANCH');
const CDP_PORT = mustEnv('CDP_PORT');
const MODEL = process.env.MODEL || 'opus';
// What the person asked to test; empty tests the diff.
const FOCUS = process.env.FOCUS || '';
// Unset leaves each model at its own default effort.
const EFFORT = process.env.EFFORT || '';
const MAX_TURNS = parsePosIntEnv('MAX_TURNS', 200, process.env.MAX_TURNS);
// Set when the hard stop fires, so the outcome and stats can say so.
let timedOut = false;
let timeWasUp = false;
// The verify pass never drives the app, so it needs far fewer turns than the
// run it checks; two trial passes used 22 and 26 tool calls. Opus caught
// every planted mistake in the plant test that Sonnet missed a quarter of.
const VERIFY_MODEL = process.env.VERIFY_MODEL || 'opus';
const VERIFY_MAX_TURNS = parsePosIntEnv('VERIFY_MAX_TURNS', 60, process.env.VERIFY_MAX_TURNS);
const VERIFY_ENABLED = process.env.VERIFY !== 'false';
// The isolator drives the app, but only to run a few controls in its 12 minutes.
const ISOLATE_MODEL = process.env.ISOLATE_MODEL || 'sonnet';
const ISOLATE_MAX_TURNS = parsePosIntEnv('ISOLATE_MAX_TURNS', 100, process.env.ISOLATE_MAX_TURNS);
// Off for teams whose AI policy does not allow the report's copy-for-agent prompts.
const AGENT_PROMPTS = process.env.AGENT_PROMPTS !== 'false';
const REPORT_BASE_URL = buildShotsBaseUrl(process.env.REPORT_BASE_URL || '');
const STEP_SUMMARY = takeStepSummary();
// Workaround for claude-agent-sdk-typescript#296 (resolver picks musl over
// glibc on Linux): action.yml installs @anthropic-ai/claude-code globally
// and passes the resolved path here.
const CLAUDE_CODE_PATH = process.env.CLAUDE_CODE_PATH || undefined;
// Fails fast with a named error instead of letting the SDK surface an opaque
// auth error when a 1Password resolution comes back empty.
mustEnv('ANTHROPIC_API_KEY');

// Shots stay relative (`shots/<file>`): index.html and report.json are
// published beside shots/, so they resolve without a base URL in the prompt.
const RENDER_PATH = fileURLToPath(new URL('../../../.claude/skills/exploratory-test/renderer/render.mjs', import.meta.url));
const CI_OVERRIDES = [
	`**Write the run directory to \`${WORK_DIR}\`**, not to any path under \`~/.claude\`. Put \`report.json\`, \`ledger.md\` and \`actions.log\` directly in it, screenshots in \`${WORK_DIR}/shots/\`, and the files your scenarios use in \`${WORK_DIR}/files/\` (the skill's Test files rule).`,
	'**Do NOT clean up the pre-launched instance.** Do not run `stop.sh` against it, do not close the `positron` Playwright session, do not remove the run directory. The container is destroyed when the job ends, and cleanup would delete the screenshots before they are uploaded. Instances you launched yourself are yours to stop.',
	`**Keep the logs in \`${WORK_DIR}/logs/\`.** Follow the skill's Logs section for the pre-launched instance and any you launch. The pre-launched instance's run directory is the only one under \`/tmp/positron-dev-launch/\` when you start, so note it before you launch another. A finding whose log was deleted cannot be checked by the person reading the report.`,
	'**Do not look the PR up.** Leave out the report\'s `header.pr`, which the workflow adds, and start the ledger\'s header line at `Branch:`.',
	`**The renderer is \`${RENDER_PATH}\`**, with \`lint-json.mjs\` and \`report.schema.json\` beside it.`,
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

// What the isolator needs to know about this container, after isolator.md.
const ISOLATE_CI_TAIL = `

---

# CI run

The checkout is \`${REPO_ROOT}\`. Positron is already launched, with a Playwright session named \`positron\` attached on CDP port ${CDP_PORT}: the explorer's, in whatever state it left it. Never stop it. Launch your own as isolator.md says. \`npm run prelaunch\` already ran in this job and is the slow part of \`launch.sh\`, so strip it first:

\`\`\`bash
sed 's#node build/lib/preLaunch.ts#true#' \\
  .claude/skills/drive-positron/scripts/launch.sh > /tmp/launch-cold.sh
chmod +x /tmp/launch-cold.sh
\`\`\`

${ENVIRONMENT}
`;

/**
 * Runs one agent the pipeline asks for, as an Agent SDK session.
 *
 * The verifier re-reads the finished report with a fresh agent that never
 * drove the app. The reporting agent cannot audit itself: one run wrote
 * "shipped defaults" on the Only under line and described the fake HOME it
 * had just introduced in the same sentence, then filed the resulting hang as a
 * major defect. A separate agent asked what the setup could explain found the
 * cause in launch.sh in about 80k tokens, under one percent of what the run
 * itself reads. Its verdicts are advisory and never remove a finding.
 */
async function runAgent(step) {
	const maxTurns = { isolate: ISOLATE_MAX_TURNS, verify: VERIFY_MAX_TURNS }[step.role];
	const result = await runSession({
		model: step.model, claudeCodePath: CLAUDE_CODE_PATH, label: step.purpose,
		prompt: step.role === 'isolate' ? step.prompt + ISOLATE_CI_TAIL : step.prompt,
		allowedTools: step.tools, maxTurns, cwd: step.cwd, resume: step.resume,
		timeLimit: step.timeLimitMinutes ?? null, timeUpMessage: step.timeUpMessage,
		// The verifier makes few calls, so each is logged in full for
		// whoever audits the run; the isolator drives the app, like the explorer.
		fullLog: step.role !== 'isolate',
	});
	return { text: result.finalText, model: result.cost.model, durationMs: result.cost.duration_ms, turns: result.cost.num_turns, costUsd: result.cost.total_cost_usd, sessionId: result.sessionId, opened: result.opened };
}

async function main() {
	// The build of main the workflow downloaded while the PR built, or null when
	// it has none; the explorer replays each finding on it, which decides Origin.
	// Without main's commit in the checkout, every `needs` lookup would fail and
	// read as missing. Here, not at load, since the commit may need a fetch.
	// MAIN_REPLAY=off (the workflow's main_replay input) switches it off: no build, no groups.
	const replayOff = process.env.MAIN_REPLAY === 'off';
	const found = !replayOff && process.env.MAIN_BUILD ? readMainBuild(process.env.MAIN_BUILD) : null;
	const MAIN_BUILD = found && ensureCommit(REPO_ROOT, found.commit) ? found : null;
	// Minutes of exploring, or null for no limit, with time for the main replays
	// added. The agent is not told the limit, only when it is up, and is stopped
	// WRAP_UP_MINUTES later.
	const TIME_LIMIT = withMainReplay(parseTimeLimit(process.env.TIME_LIMIT), MAIN_BUILD);
	mkdirSync(join(WORK_DIR, 'shots'), { recursive: true });
	if (replayOff) {
		writeFileSync(join(WORK_DIR, MAIN_REPLAY_OFF), '');
	}
	// Fetched by the workflow while the build ran; the verifier and renderer read it from the run directory.
	if (process.env.KNOWN_ISSUES && existsSync(process.env.KNOWN_ISSUES)) {
		copyFileSync(process.env.KNOWN_ISSUES, join(WORK_DIR, 'known-issues.json'));
	}
	const knownIssues = readKnownIssues(WORK_DIR);
	const knownBrief = buildKnownIssuesBrief(knownIssues);
	if (MAIN_BUILD) {
		copyFileSync(process.env.MAIN_BUILD, join(WORK_DIR, 'main-build.json'));
	}

	const systemPrompt = readFileSync(EXPLORER_PATH, 'utf8') + CI_TAIL;
	const git = gitIn(REPO_ROOT);
	const { stat, upstream } = describeChange({ git, base: BASE_SHA, head: HEAD_SHA });

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
		...(upstream ? [`An upstream merge of ${upstream.files} files. Listed are the ${upstream.seam} where Positron meets it: Positron's own files, upstream files with a \`--- Start Positron ---\` block, and files changed after the merge commit.`, ''] : []),
		'```',
		stat,
		'```',
		'',
		`See the full diff with \`git -C ${REPO_ROOT} diff ${BASE_SHA}...${HEAD_SHA}\`.`,
		'',
		'## Your task',
		'',
		buildTaskLine(FOCUS, upstream),
		'',
		...(knownBrief ? [knownBrief, ''] : []),
		// The app arguments the workflow launched the PR instance with, which a packaged build needs too (--no-sandbox as root).
		...(MAIN_BUILD ? [mainBuildBrief(MAIN_BUILD, { repo: REPO_ROOT, base: BASE_SHA, appArgs: process.env.APP_ARGS ?? '' }), ''] : []),
		environmentBrief(environmentLines(readEnvironment(REPO_ROOT))),
		'',
		'Write the report to `report.json` in the run directory. Return a two or three line summary and nothing else.',
	].join('\n');

	console.log(`[exploratory] WORK_DIR=${WORK_DIR} model=${MODEL} effort=${EFFORT || 'default'} maxTurns=${MAX_TURNS} timeLimit=${TIME_LIMIT ? `${TIME_LIMIT}m` : 'none'} mainBuild=${MAIN_BUILD ? `${MAIN_BUILD.version} (${MAIN_BUILD.commit.slice(0, 10)})` : 'none'}`);
	console.log(`[exploratory] user prompt:\n${userPrompt}`);

	const session = await runSession({
		prompt: userPrompt,
		systemPrompt,
		allowedTools: ['Bash', 'Read', 'Glob', 'Grep'],
		model: MODEL,
		maxTurns: MAX_TURNS,
		cwd: REPO_ROOT,
		timeLimit: TIME_LIMIT,
		timeUpMessage: EXPLORE_TIME_UP,
		effort: EFFORT,
		// Summarized display returns the notes the model writes between tool
		// calls, which otherwise arrive as empty thinking blocks. gate.mjs and the
		// analyzers still disable thinking for claude-code#63192; if a run wedges
		// that way, disable it here too.
		thinking: { type: 'adaptive', display: 'summarized' },
		claudeCodePath: CLAUDE_CODE_PATH,
		label: 'exploratory',
	});
	const cost = session.cost;
	timedOut = session.timedOut;
	timeWasUp = session.timeWasUp;

	writeFileSync(join(WORK_DIR, 'cost.json'), JSON.stringify(cost, null, 2));

	// The agent was told to write report.json itself. A report with problems
	// gets one retry in the same session.
	const explored = { model: cost.model, costUsd: cost.total_cost_usd, turns: cost.num_turns, maxTurns: MAX_TURNS, durationMs: cost.duration_ms };
	const pr = /^\d+$/.test(process.env.PR_NUMBER ?? '') && process.env.GITHUB_REPOSITORY ? { pr: { repo: process.env.GITHUB_REPOSITORY, number: Number(process.env.PR_NUMBER) } } : {};
	const report = await completeRun(WORK_DIR, explored, {
		repo: REPO_ROOT, base: BASE_SHA, head: HEAD_SHA, baseName: process.env.BASE_REF, runAgent, verify: VERIFY_ENABLED, model: VERIFY_MODEL, isolateModel: ISOLATE_MODEL,
		branchCheck: `CI compiled \`out/\` in this job from the ref under test (head \`${HEAD_SHA.slice(0, 10)}\`).`,
		header: { ...pr, headSha: HEAD_SHA },
		log: line => console.log(`[pipeline] ${line}`),
	});
	// The explorer's alone when there is no report to carry the rest.
	const passes = report?.cost.passes ?? costPasses(explored, []);
	const footer = () => renderCostFooter(passes);
	const partial = typeof cost.num_turns === 'number' && cost.num_turns >= MAX_TURNS;
	if (process.env.GITHUB_OUTPUT) {
		appendFileSync(process.env.GITHUB_OUTPUT, `outcome=${runOutcome({ report, numTurns: cost.num_turns, maxTurns: MAX_TURNS, timedOut })}\n`);
	}
	const nearCap = turnCapWarning({ numTurns: cost.num_turns, maxTurns: MAX_TURNS });
	if (nearCap) {
		console.log(nearCap);
	}

	const recordStats = parsed => {
		const stats = buildStats({
			where: 'ci',
			date: STARTED_AT.toISOString(),
			run: process.env.GITHUB_RUN_ID,
			version: skillVersion(),
			...passStats(passes),
			parsed,
			checks: readChecks(WORK_DIR),
			timeLimit: TIME_LIMIT ? { minutes: TIME_LIMIT, reached: timeWasUp, stopped: timedOut } : null,
			mainReplayMs: MAIN_BUILD ? mainReplayMs(existsSync(join(WORK_DIR, 'actions.log')) ? readFileSync(join(WORK_DIR, 'actions.log'), 'utf8') : '') : undefined,
		});
		writeFileSync(join(WORK_DIR, 'stats.json'), `${JSON.stringify(stats, null, 2)}\n`);
		console.log(`[exploratory] stats: ${JSON.stringify(stats)}`);
	};

	let summary;
	if (report) {
		// Read after the pipeline, which writes change-base.json.
		const run = readRunDir(WORK_DIR);
		const parsed = reportFromJson(report, { ledger: run.ledger });
		recordStats(parsed);
		// index.html is what the published run directory's URL already points at.
		try {
			// The previews of the issues the page names, matches included, fetched as a local render fetches them.
			run.issueRefs = await pageIssueRefs(WORK_DIR, report, run.knownIssues).catch(err => {
				console.error(`[report] WARN: could not fetch the issues the report names: ${err}`);
				return run.issueRefs;
			});
			await writeRunPage(join(WORK_DIR, 'index.html'), parsed, { ...run, skillVersion: skillVersion(), agentPrompts: AGENT_PROMPTS, base: REPORT_BASE_URL || WORK_DIR, diff: `${BASE_SHA.slice(0, 8)}...${HEAD_SHA.slice(0, 8)}`, startedAt: STARTED_AT });
			// Warned rather than failed: the page still renders, with the missing files unlinked.
			const { logs, files } = missingFiles(parsed, run.fileExists);
			const missing = [...logs, ...files];
			if (missing.length) {
				console.error(`[report] WARN: files listed but not in the run directory: ${missing.join(', ')}`);
			}
		} catch (err) {
			console.error(`[report] could not render report.json: ${err}`);
		}
		summary = renderStepSummary(report, REPORT_BASE_URL);
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
		// What was tested is announce's summary, written when the run started.
		appendFileSync(STEP_SUMMARY, summary);
	}
	// The full report still goes to the action log. It is the one copy that
	// survives an artifact upload or a CDN publish that did not happen.
	console.log(report ? `${JSON.stringify(report, null, 2)}\n\n${footer()}` : summary);

	if (!report) {
		process.exit(1);
	}
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
