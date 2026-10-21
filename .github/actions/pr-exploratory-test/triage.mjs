/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Where each ai-discovered issue that links to an exploratory-test report
// stands today, for triage-page.mjs. With --outcomes, the Shipping impact
// rows, it adds the issues filed by hand that they matched to a finding and
// that mention its PR. No model calls.
//   node triage.mjs [--outcomes rows.jsonl] --out triage.json

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fetchReport } from './outcomes-lib.mjs';
import { issueRow, matchedLinks, reportLink } from './triage-lib.mjs';

const REPO = 'posit-dev/positron';
const { values: args } = parseArgs({ options: { out: { type: 'string' }, outcomes: { type: 'string' } } });
const TOKEN = process.env.GH_TOKEN || execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();

async function gh(path) {
	let url = `https://api.github.com${path}`;
	let all = null;
	while (url) {
		const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json' } });
		if (!res.ok) {
			throw new Error(`GitHub GET ${path} failed: ${res.status}`);
		}
		const data = await res.json();
		if (!Array.isArray(data)) {
			return data;
		}
		all = [...(all ?? []), ...data];
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
const outcomeRows = args.outcomes ? readFileSync(args.outcomes, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
// A matched issue that can't be read, deleted say, is left out rather than failing the page.
const matched = (await Promise.all(matchedLinks(outcomeRows, new Set(linked.map(([i]) => i.number)))
	.map(({ number, link }) => gh(`/repos/${REPO}/issues/${number}`).then(i => [i, link], err => {
		console.error(`[triage] matched #${number} left out: ${err}`);
		return null;
	})))).filter(Boolean);
const toRow = via => async ([issue, link]) => {
	const [report, stats] = await run(link.base);
	const events = issue.milestone?.title === 'Future' && issue.state === 'open' ? await gh(`/repos/${REPO}/issues/${issue.number}/events?per_page=100`) : [];
	return issueRow(issue, link, { report, stats, events, via });
};
const rows = [...await Promise.all(linked.map(toRow('linked'))), ...await Promise.all(matched.map(toRow('matched')))];
const data = { rows: rows.sort((a, b) => b.num - a.num) };
console.error(`${linked.length} issues with a report link, ${issues.length - linked.length} without; ${matched.length} matched by the outcomes job`);
const json = JSON.stringify(data, null, 2);
if (args.out) {
	writeFileSync(args.out, json);
} else {
	process.stdout.write(json);
}
