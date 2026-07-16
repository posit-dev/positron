#!/usr/bin/env node
// Queries the e2e-test-insights API for historical test health data.
//
// Usage:
//   node e2e-query-history.js --repo <repo_id> --run-id <workflow_run_id> [options]
//   node e2e-query-history.js --repo <repo_id> --test-keys "name1|||path1,name2|||path2" [options]
//
// Options:
//   --repo <repo_id>          Repository identifier (e.g., "positron") [required]
//   --run-id <id>             GitHub workflow run ID - returns history for all failed/flaked tests
//   --test-keys <keys>        Comma-separated test keys in "testName|||specPath" format
//   --branch <branch>         Branch to filter history by (default: repo's default branch)
//   --lookback-days <days>    Days of history, 1-30 (default: 5)
//   --occurrences-per-pattern <N>  Representative occurrences per failure pattern (default: 0, omitted)
//   --max-patterns <N>             Cap on distinct failure patterns returned (default: server default 3)
//
// Environment variables:
//   E2E_INSIGHTS_API_KEY      API key for authentication [required]. Falls back
//                             to the value in .env.e2e (repo root) if unset --
//                             the same local secrets file used by the e2e
//                             Playwright suite (see test/e2e/.env.e2e.example).
//
// Output: JSON response from the API, or empty object {} if the API is unreachable.
// Exit code 0 always (graceful degradation).

import fs from 'fs';
import path from 'path';

const API_BASE_URL = 'https://connect.posit.it/e2e-test-insights-api';

function readEnvFileVar(envFilePath, varName) {
	const fullPath = path.join(process.cwd(), envFilePath);
	if (!fs.existsSync(fullPath)) {
		return undefined;
	}
	const content = fs.readFileSync(fullPath, 'utf8');
	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
			continue;
		}
		const [key, ...valueParts] = trimmed.split('=');
		if (key !== varName) {
			continue;
		}
		let value = valueParts.join('=').trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		return value;
	}
	return undefined;
}

const apiKey = process.env.E2E_INSIGHTS_API_KEY || readEnvFileVar('.env.e2e', 'E2E_INSIGHTS_API_KEY');

if (!apiKey) {
	process.stderr.write('Warning: E2E_INSIGHTS_API_KEY not set, skipping history lookup.\n');
	console.log('{}');
	process.exit(0);
}

const args = process.argv.slice(2);
let repo = null;
let runId = null;
let testKeys = null;
let branch = null;
let lookbackDays = null;
let occurrencesPerPattern = null;
let maxPatterns = null;

for (let i = 0; i < args.length; i++) {
	switch (args[i]) {
		case '--repo': repo = args[++i]; break;
		case '--run-id': runId = args[++i]; break;
		case '--test-keys': testKeys = args[++i]; break;
		case '--branch': branch = args[++i]; break;
		case '--lookback-days': lookbackDays = args[++i]; break;
		case '--occurrences-per-pattern': occurrencesPerPattern = args[++i]; break;
		case '--max-patterns': maxPatterns = args[++i]; break;
	}
}

if (!repo) {
	console.error('Usage: node e2e-query-history.js --repo <repo_id> --run-id <id> [options]');
	console.log('{}');
	process.exit(0);
}

if (!runId && !testKeys) {
	console.error('Error: either --run-id or --test-keys is required.');
	console.log('{}');
	process.exit(0);
}

// Build query parameters
const params = new URLSearchParams();
params.set('repo_id', repo);
if (runId) params.set('workflow_run_id', runId);
if (testKeys) params.set('test_keys', testKeys);
if (branch) params.set('branch', branch);
if (lookbackDays) params.set('lookback_days', lookbackDays);
if (occurrencesPerPattern) params.set('occurrences_per_pattern', occurrencesPerPattern);
if (maxPatterns) params.set('max_patterns', maxPatterns);

const url = `${API_BASE_URL}/test-health?${params.toString()}`;

async function fetchHistory() {
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 15000);

		const response = await fetch(url, {
			headers: {
				'Authorization': `Key ${apiKey}`,
			},
			signal: controller.signal,
		});
		clearTimeout(timeout);

		if (!response.ok) {
			process.stderr.write(`Warning: API returned ${response.status} ${response.statusText}\n`);
			const body = await response.text().catch(() => '');
			if (body) process.stderr.write(`Response: ${body.slice(0, 500)}\n`);
			console.log('{}');
			return;
		}

		const data = await response.json();
		console.log(JSON.stringify(data, null, 2));
	} catch (err) {
		if (err.name === 'AbortError') {
			process.stderr.write('Warning: API request timed out after 15s, skipping history.\n');
		} else {
			process.stderr.write(`Warning: API request failed: ${err.message}\n`);
		}
		console.log('{}');
	}
}

fetchHistory();
