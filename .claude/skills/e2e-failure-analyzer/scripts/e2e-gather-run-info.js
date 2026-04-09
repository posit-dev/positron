#!/usr/bin/env node
// Gathers all run metadata, failed jobs, artifacts, and commit info in one call.
// Replaces ~6 separate `gh api` invocations from the skill's Step 1.
//
// Usage: node e2e-gather-run-info.js <run-url-or-id> [--repo <owner/repo>]
//
// Output: JSON with:
//   repo, runId, run (metadata), failedJobs, nonE2eJobLogs,
//   artifacts, projects, commit

import { execFileSync } from 'child_process';

const args = process.argv.slice(2);
let runInput = null;
let repoOverride = null;

for (let i = 0; i < args.length; i++) {
	if (args[i] === '--repo' && args[i + 1]) {
		repoOverride = args[++i];
	} else if (!runInput) {
		runInput = args[i];
	}
}

if (!runInput) {
	console.error('Usage: node e2e-gather-run-info.js <run-url-or-id> [--repo <owner/repo>]');
	process.exit(1);
}

// Extract repo and run ID from URL
let repo, runId;
const urlMatch = runInput.match(/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)/);
if (urlMatch) {
	repo = urlMatch[1];
	runId = urlMatch[2];
} else if (/^\d+$/.test(runInput)) {
	runId = runInput;
	repo = repoOverride || 'posit-dev/positron';
} else {
	console.error('Invalid input. Provide a GitHub Actions run URL or numeric run ID.');
	process.exit(1);
}

function gh(...ghArgs) {
	try {
		// Do NOT use shell: true -- the --jq arguments contain pipe characters
		// that cmd.exe would interpret as shell pipes. This works in Git Bash
		// (Claude Code's shell on Windows) where gh resolves as a real binary.
		return execFileSync('gh', ghArgs, {
			encoding: 'utf8',
			stdio: ['pipe', 'pipe', 'pipe'],
			timeout: 60000,
			maxBuffer: 50 * 1024 * 1024, // 50MB - CI logs can be very large
		}).trim();
	} catch (err) {
		process.stderr.write(`Warning: gh command failed: gh ${ghArgs.join(' ')}\n`);
		process.stderr.write(`  ${(err.stderr || err.message || '').toString().trim().slice(0, 500)}\n`);
		return '';
	}
}

// 1. Get run metadata
process.stderr.write('Fetching run metadata...\n');
const runMeta = JSON.parse(
	gh('api', `repos/${repo}/actions/runs/${runId}`,
		'--jq', '{name: .name, conclusion: .conclusion, html_url: .html_url, head_sha: .head_sha, branch: .head_branch}')
	|| '{}'
);

// 2. List all failed jobs (paginated)
process.stderr.write('Listing failed jobs...\n');
const failedJobsRaw = gh('api', `repos/${repo}/actions/runs/${runId}/jobs`, '--paginate',
	'--jq', '.jobs[] | select(.conclusion == "failure") | {id: .id, name: .name}');

const failedJobs = failedJobsRaw
	.split('\n')
	.filter(Boolean)
	.map(line => { try { return JSON.parse(line); } catch { return null; } })
	.filter(Boolean)
	.map(job => ({
		...job,
		isE2e: /e2e/i.test(job.name),
	}));

// 3. Get non-e2e job failure excerpts
const nonE2eJobs = failedJobs.filter(j => !j.isE2e);
const nonE2eJobLogs = {};
for (const job of nonE2eJobs) {
	process.stderr.write(`Fetching logs for non-e2e job: ${job.name}...\n`);
	const logs = gh('api', `repos/${repo}/actions/jobs/${job.id}/logs`);
	const failLines = logs
		.split('\n')
		.filter(l => /(FAIL|Error|error:|##\[error\])/.test(l))
		.slice(-30)
		.map(l => l.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*/, '').trim());
	nonE2eJobLogs[job.id] = failLines.join('\n');
}

// 4. List blob report artifacts
process.stderr.write('Listing blob report artifacts...\n');
const artifactsRaw = gh('api', `repos/${repo}/actions/runs/${runId}/artifacts`,
	'--jq', '.artifacts[] | select(.name | test("^blob-report-")) | .name');
const artifacts = artifactsRaw.split('\n').filter(Boolean).sort();

// Extract unique project names from artifact names like "blob-report-e2e-chromium-1"
const projects = [...new Set(
	artifacts.map(name => {
		const match = name.match(/^blob-report-(.+)-\d+$/);
		return match ? match[1] : null;
	}).filter(Boolean)
)];

// 5. Get commit info
let commit = {};
if (runMeta.head_sha) {
	process.stderr.write('Fetching commit info...\n');
	const commitRaw = gh('api', `repos/${repo}/commits/${runMeta.head_sha}`,
		'--jq', '{message: .commit.message, author: .commit.author.name, files: [.files[].filename]}');
	if (commitRaw) {
		try { commit = JSON.parse(commitRaw); } catch { /* ignore */ }
	}
}

const result = {
	repo,
	runId,
	run: runMeta,
	failedJobs,
	nonE2eJobLogs,
	artifacts,
	projects,
	commit,
};

console.log(JSON.stringify(result, null, 2));
process.stderr.write(`Done. Found ${failedJobs.length} failed jobs, ${projects.length} e2e projects.\n`);
