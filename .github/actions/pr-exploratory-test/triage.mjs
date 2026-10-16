/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Where each ai-discovered issue that links to an exploratory-test report
// stands today, for triage-page.mjs. No model calls.
//   node triage.mjs --out triage.json

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fetchReport } from './outcomes-lib.mjs';
import { issueRow, reportLink } from './triage-lib.mjs';

const REPO = 'posit-dev/positron';
const { values: args } = parseArgs({ options: { out: { type: 'string' } } });
const TOKEN = process.env.GH_TOKEN || execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();

async function gh(path) {
	let url = `https://api.github.com${path}`;
	let all = [];
	while (url) {
		const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json' } });
		if (!res.ok) {
			throw new Error(`GitHub GET ${path} failed: ${res.status}`);
		}
		all = [...all, ...await res.json()];
		url = res.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
	}
	return all;
}

async function fetchStats(base) {
	const res = await fetch(`${base}/stats.json`);
	return res.ok ? res.json() : null;
}

// Several issues can come from one run, so read each run once.
const runs = new Map();
const run = base => {
	if (!runs.has(base)) {
		runs.set(base, Promise.all([fetchReport(base).catch(() => null), fetchStats(base).catch(() => null)]));
	}
	return runs.get(base);
};

const issues = (await gh(`/repos/${REPO}/issues?labels=ai-discovered&state=all&per_page=100`)).filter(i => !i.pull_request);
const linked = issues.map(i => [i, reportLink(i.body)]).filter(([, link]) => link);
const rows = await Promise.all(linked.map(async ([issue, link]) => {
	const [report, stats] = await run(link.base);
	const events = issue.milestone?.title === 'Future' && issue.state === 'open' ? await gh(`/repos/${REPO}/issues/${issue.number}/events?per_page=100`) : [];
	return issueRow(issue, link, { report, stats, events });
}));
const data = { rows: rows.sort((a, b) => b.num - a.num) };
console.error(`${rows.length} issues with a report link, ${issues.length - linked.length} without`);
const json = JSON.stringify(data, null, 2);
if (args.out) {
	writeFileSync(args.out, json);
} else {
	process.stdout.write(json);
}
