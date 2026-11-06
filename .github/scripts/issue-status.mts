/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Keeps the Positron Backlog board in step with a pull request that closes an issue.
//
// The PR's closing references ("Fixes #123" and friends, as GitHub resolves them) name
// the issues. For each one on the board:
//
//   draft PR opened / converted to draft   -> In Progress
//   PR opened / marked ready for review    -> PR Ready
//   PR closed without merging, or the      -> back to the status it had when the PR first
//   closing reference edited out of it        referenced it, unless another open PR still
//                                             closes the issue or someone has since moved it
//   PR merged into the default branch      -> the release milestone for the version in
//                                             product.json at the merge commit, replacing a
//                                             missing, planning (Future, 2026 Backlog), or
//                                             older release milestone; the board's own
//                                             "Item closed" rule moves the issue to Done
//
// The milestone is chosen at merge, not earlier, because a PR that misses a release fork
// ships in the next release. The fork bumps positronVersion on main, so the merge commit
// says which release the change is in.
//
// The status before the PR comes from the issue's board history, so nothing is written
// to the PR. Issues already in Done are never touched. Issues in other repositories
// still move on the board but never get a milestone, since milestones belong to a repo.
//
// The second mode, `close-done`, closes every open issue in this repository whose board
// status is Done. Dragging an issue to Done on the board does not close it, so without
// this the issue stays open until someone notices.
//
// Usage:
//   node .github/scripts/issue-status.mts              # react to the pull_request event
//   node .github/scripts/issue-status.mts close-done   # close open issues that are Done
//
// Env and files:
//   product.json          read from the working directory (checked out at the merge commit)
//   GITHUB_TOKEN          token with issues: write, pull-requests: read, organization projects: write
//   GITHUB_REPOSITORY     owner/repo (set by Actions)
//   GITHUB_EVENT_PATH     pull_request event payload (set by Actions)
//   PROJECT_OWNER         org that owns the board, default posit-dev
//   PROJECT_NUMBER        board number, default 2 (Positron Backlog)
//   DRY_RUN               set to 1 to log the plan without changing anything

import { readFile } from 'node:fs/promises';

export type Status = 'Triage' | 'Backlog' | 'Up Next' | 'In Progress' | 'PR Ready' | 'Done';

export interface Decision {
	setStatus?: Status;
	setMilestone?: boolean;
	reason: string;
}

export interface DecisionInput {
	/** The pull_request event action, or 'unlinked' for a closing reference edited out of the PR. */
	action: string;
	/** The PR is still open. */
	open: boolean;
	draft: boolean;
	merged: boolean;
	/** The PR targets the repository's default branch. */
	intoDefaultBranch: boolean;
	/** Current board status; undefined when the issue is not on the board. */
	status: Status | undefined;
	/** Board status when the PR first referenced the issue; undefined if it had none. */
	previous: Status | undefined;
	/** Current milestone title; undefined when it has none. */
	milestone: string | undefined;
	/** Release milestone title for the merge commit's version; only set for merges. */
	release: string | undefined;
	otherOpenPRs: boolean;
}

/** Pure transition rules. Everything that talks to GitHub lives below. */
export function decide(input: DecisionInput): Decision {
	const { action, open, draft, merged, intoDefaultBranch, status, previous, milestone, release, otherOpenPRs } = input;
	// Checked before the board status: by the time this runs the merge may already have
	// closed the issue and moved it to Done.
	if (action === 'closed' && merged) {
		if (!intoDefaultBranch) {
			return { reason: 'merged into a non-default branch; leaving the milestone' };
		}
		if (release === undefined) {
			return { reason: 'merged; no release milestone for this version' };
		}
		if (!isBefore(milestone, release)) {
			return { reason: `merged; keeping ${milestone}` };
		}
		return { setMilestone: true, reason: `merged; ${milestone ?? 'no milestone'} -> ${release}` };
	}
	// An edit to a PR that is already closed must not move its issues again.
	if (action !== 'closed' && !open) {
		return { reason: 'PR is closed' };
	}
	if (status === undefined) {
		return { reason: 'issue is not on the board' };
	}
	if (status === 'Done') {
		return { reason: 'issue is already Done' };
	}

	if (action === 'closed' || action === 'unlinked') {
		if (otherOpenPRs) {
			return { reason: 'another open PR still closes this issue' };
		}
		if (status !== 'In Progress' && status !== 'PR Ready') {
			return { reason: `someone moved it to ${status}; leaving it` };
		}
		const decision: Decision = { reason: action === 'closed' ? 'PR closed without merging' : 'PR no longer closes this issue' };
		if (previous === undefined) {
			decision.reason += '; no status before the PR to restore';
		} else if (previous === status) {
			decision.reason += `; already at its status before the PR, ${status}`;
		} else {
			decision.setStatus = previous;
			decision.reason += `; restoring ${previous}`;
		}
		return decision;
	}

	const target: Status = draft ? 'In Progress' : 'PR Ready';
	// A draft going back and forth should not pull an issue down from PR Ready.
	if (draft && status === 'PR Ready' && action !== 'converted_to_draft') {
		return { reason: 'draft PR, issue already PR Ready' };
	}
	if (status === target) {
		return { reason: `already ${status}` };
	}
	return { setStatus: target, reason: `${draft ? 'draft' : 'ready'} PR -> ${target}` };
}

/** The release milestone title for a Positron version: 2026.12.0 and 2026.12.1 both map to "2026.12.0 Release". */
export function releaseTitle(version: string): string | undefined {
	const release = /^(\d+\.\d+)\./.exec(version)?.[1];
	return release === undefined ? undefined : `${release}.0 Release`;
}

/**
 * Whether `current` should give way to the release milestone `release`: it is missing, a
 * planning milestone (Future, 2026 Backlog), or an earlier release. A same or later release
 * is kept, so a backport's milestone is never pulled back.
 */
export function isBefore(current: string | undefined, release: string): boolean {
	const key = (title: string) => {
		const m = /^(\d+)\.(\d+)\.\d+ Release$/.exec(title);
		return m ? Number(m[1]) * 100 + Number(m[2]) : undefined;
	};
	const currentKey = current === undefined ? undefined : key(current);
	const releaseKey = key(release);
	if (releaseKey === undefined) {
		return false;
	}
	return currentKey === undefined || currentKey < releaseKey;
}

export interface StatusChange {
	createdAt: string;
	status: string;
	project: { number: number } | null;
}

/** The issue's status on one board at a point in time, from its status-change history. */
export function statusAt(changes: StatusChange[], projectNumber: number, at: string): Status | undefined {
	const atMs = new Date(at).getTime();
	const before = changes
		.filter(c => c.project?.number === projectNumber && new Date(c.createdAt).getTime() <= atMs)
		.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
	return (before.at(-1)?.status || undefined) as Status | undefined;
}

export interface CrossReference {
	createdAt: string;
	source: { number?: number; repository?: { nameWithOwner: string } } | null;
}

/**
 * When the PR first referenced the issue: its earliest cross-reference from that PR, but
 * never before the PR opened. A reference added by a later body edit gets the later time,
 * so the restore target is the status the issue had then, not when the PR opened.
 */
export function linkedAt(refs: CrossReference[], pr: number, repo: string, prOpenedAt: string): string {
	const times = refs
		.filter(r => r.source?.number === pr && r.source.repository?.nameWithOwner === repo)
		.map(r => new Date(r.createdAt).getTime());
	const opened = new Date(prOpenedAt).getTime();
	return times.length === 0 ? prOpenedAt : new Date(Math.max(opened, Math.min(...times))).toISOString();
}

/**
 * Issue numbers in `repo` that a PR body closes with a keyword: "Fixes #1", "closes: owner/repo#2",
 * "Resolves https://github.com/owner/repo/issues/3". Used only to spot references removed by an
 * edit; the current set comes from GitHub's own closingIssuesReferences.
 */
export function closingRefs(body: string | null | undefined, repo: string): number[] {
	if (!body) {
		return [];
	}
	const found = new Set<number>();
	const re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?\s+(?:https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/|([\w.-]+\/[\w.-]+)?#)(\d+)\b/gi;
	for (const m of body.matchAll(re)) {
		const target = m[1] ?? m[2];
		if (target === undefined || target.toLowerCase() === repo.toLowerCase()) {
			found.add(Number(m[3]));
		}
	}
	return [...found];
}

// ---------------------------------------------------------------------------
// GitHub plumbing

const API = process.env.GITHUB_API_URL ?? 'https://api.github.com';

async function rest<T>(method: string, path: string, body?: unknown): Promise<T> {
	const res = await fetch(`${API}${path}`, {
		method,
		headers: {
			authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
			accept: 'application/vnd.github+json',
			'content-type': 'application/json',
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	if (!res.ok) {
		throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
	}
	return res.status === 204 ? (undefined as T) : (await res.json() as T);
}

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
	const res = await rest<{ data: T; errors?: { message: string }[] }>('POST', '/graphql', { query, variables });
	if (res.errors?.length) {
		throw new Error(`graphql: ${res.errors.map(e => e.message).join('; ')}`);
	}
	return res.data;
}

const ISSUE_FIELDS = `
	fragment IssueFields on Issue {
		number
		repository { nameWithOwner }
		milestone { title }
		projectItems(first: 10) {
			nodes {
				id
				project { number }
				fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
			}
		}
		closedByPullRequestsReferences(first: 20) { nodes { number state } }
		timelineItems(last: 100, itemTypes: [PROJECT_V2_ITEM_STATUS_CHANGED_EVENT]) {
			nodes { ... on ProjectV2ItemStatusChangedEvent { createdAt status project { number } } }
		}
		crossReferences: timelineItems(last: 50, itemTypes: [CROSS_REFERENCED_EVENT]) {
			nodes { ... on CrossReferencedEvent { createdAt source { ... on PullRequest { number repository { nameWithOwner } } } } }
		}
	}`;

interface IssueNode {
	number: number;
	repository: { nameWithOwner: string };
	milestone: { title: string } | null;
	projectItems: { nodes: { id: string; project: { number: number }; fieldValueByName: { name: string } | null }[] };
	closedByPullRequestsReferences: { nodes: { number: number; state: string }[] };
	timelineItems: { nodes: StatusChange[] };
	crossReferences: { nodes: CrossReference[] };
}

interface IssueOnBoard {
	number: number;
	repo: string;
	itemId: string | undefined;
	status: Status | undefined;
	statusBeforePR: Status | undefined;
	milestone: string | undefined;
	otherOpenPRs: boolean;
}

function toIssue(n: IssueNode, pr: number, prRepo: string, prOpenedAt: string, projectNumber: number): IssueOnBoard {
	const item = n.projectItems.nodes.find(i => i.project.number === projectNumber);
	return {
		number: n.number,
		repo: n.repository.nameWithOwner,
		itemId: item?.id,
		status: item?.fieldValueByName?.name as Status | undefined,
		statusBeforePR: statusAt(n.timelineItems.nodes, projectNumber, linkedAt(n.crossReferences.nodes, pr, prRepo, prOpenedAt)),
		milestone: n.milestone?.title,
		otherOpenPRs: n.closedByPullRequestsReferences.nodes.some(p => p.number !== pr && p.state === 'OPEN'),
	};
}

async function loadPR(owner: string, repo: string, pr: number, projectOwner: string, projectNumber: number) {
	const data = await graphql<{
		organization: { projectV2: { id: string; field: { id: string; options: { id: string; name: string }[] } } };
		repository: { pullRequest: { createdAt: string; closingIssuesReferences: { nodes: IssueNode[] } } };
	}>(`
		query($owner: String!, $repo: String!, $pr: Int!, $projectOwner: String!, $projectNumber: Int!) {
			organization(login: $projectOwner) {
				projectV2(number: $projectNumber) {
					id
					field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } }
				}
			}
			repository(owner: $owner, name: $repo) {
				pullRequest(number: $pr) {
					createdAt
					closingIssuesReferences(first: 20) { nodes { ...IssueFields } }
				}
			}
		}
		${ISSUE_FIELDS}`, { owner, repo, pr, projectOwner, projectNumber });

	const project = data.organization.projectV2;
	const prOpenedAt = data.repository.pullRequest.createdAt;
	const issues = data.repository.pullRequest.closingIssuesReferences.nodes
		.map(n => toIssue(n, pr, `${owner}/${repo}`, prOpenedAt, projectNumber));
	return { project, prOpenedAt, issues };
}

/** Issues in this repo by number, for references an edit removed. Missing numbers (a PR, a typo) are dropped. */
async function loadIssues(owner: string, repo: string, numbers: number[], pr: number, prOpenedAt: string, projectNumber: number) {
	const issues: IssueOnBoard[] = [];
	// One query each: a number that is a PR or does not exist fails its whole query.
	for (const number of numbers) {
		try {
			const data = await graphql<{ repository: { issue: IssueNode } }>(`
				query($owner: String!, $repo: String!, $number: Int!) {
					repository(owner: $owner, name: $repo) { issue(number: $number) { ...IssueFields } }
				}
				${ISSUE_FIELDS}`, { owner, repo, number });
			issues.push(toIssue(data.repository.issue, pr, `${owner}/${repo}`, prOpenedAt, projectNumber));
		} catch (err) {
			console.log(`#${number}: no longer referenced, but could not load it: ${(err as Error).message}`);
		}
	}
	return issues;
}

async function openMilestone(owner: string, repo: string, title: string) {
	for (let page = 1; ; page++) {
		const batch = await rest<{ number: number; title: string }[]>('GET', `/repos/${owner}/${repo}/milestones?state=open&per_page=100&page=${page}`);
		const match = batch.find(m => m.title === title);
		if (match || batch.length < 100) {
			return match ?? null;
		}
	}
}

/** Every open issue in `repo` whose status on the board is Done. Walks all board items; the board has a few thousand. */
async function openIssuesInDone(repo: string, projectOwner: string, projectNumber: number): Promise<number[]> {
	const found: number[] = [];
	let cursor: string | null = null;
	for (;;) {
		const data: {
			organization: {
				projectV2: {
					items: {
						pageInfo: { hasNextPage: boolean; endCursor: string | null };
						nodes: {
							fieldValueByName: { name: string } | null;
							content: { number?: number; state?: string; repository?: { nameWithOwner: string } } | null;
						}[];
					};
				};
			};
		} = await graphql(`
			query($projectOwner: String!, $projectNumber: Int!, $cursor: String) {
				organization(login: $projectOwner) {
					projectV2(number: $projectNumber) {
						items(first: 100, after: $cursor) {
							pageInfo { hasNextPage endCursor }
							nodes {
								fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
								content { ... on Issue { number state repository { nameWithOwner } } }
							}
						}
					}
				}
			}`, { projectOwner, projectNumber, cursor });
		const page = data.organization.projectV2.items;
		for (const item of page.nodes) {
			const c = item.content;
			// The board holds issues from several repos; only this one's can be closed here.
			if (item.fieldValueByName?.name === 'Done' && c?.state === 'OPEN' && c.number && c.repository?.nameWithOwner === repo) {
				found.push(c.number);
			}
		}
		if (!page.pageInfo.hasNextPage) {
			break;
		}
		cursor = page.pageInfo.endCursor;
	}
	return found;
}

async function closeDone(owner: string, repo: string, projectOwner: string, projectNumber: number, dryRun: boolean) {
	const issues = await openIssuesInDone(`${owner}/${repo}`, projectOwner, projectNumber);
	console.log(`${issues.length} open issue(s) are Done on the board`);
	let failed = 0;
	for (const number of issues) {
		console.log(`  close #${number}`);
		if (dryRun) {
			continue;
		}
		// Close first: if that fails, no comment is left behind to repeat tomorrow.
		try {
			await rest('PATCH', `/repos/${owner}/${repo}/issues/${number}`, { state: 'closed', state_reason: 'completed' });
			await rest('POST', `/repos/${owner}/${repo}/issues/${number}/comments`, {
				body: 'Closed because it is marked Done on the Positron Backlog board.',
			});
		} catch (err) {
			failed++;
			console.error(`  failed #${number}: ${(err as Error).message}`);
		}
	}
	if (failed > 0) {
		throw new Error(`${failed} issue(s) could not be closed`);
	}
}

async function main() {
	const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
	const projectOwner = process.env.PROJECT_OWNER ?? 'posit-dev';
	const projectNumber = Number(process.env.PROJECT_NUMBER ?? 2);
	const dryRun = process.env.DRY_RUN === '1';

	if (process.argv[2] === 'close-done') {
		await closeDone(owner, repo, projectOwner, projectNumber, dryRun);
		return;
	}

	const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH!, 'utf8'));
	const action: string = event.action;
	const pr = event.pull_request;
	const thisRepo = `${owner}/${repo}`;

	const { project, prOpenedAt, issues } = await loadPR(owner, repo, pr.number, projectOwner, projectNumber);

	// An edit can drop a closing reference. GitHub only lists what the body closes now, so
	// compare against the body before the edit to find issues the PR let go of.
	let unlinked: IssueOnBoard[] = [];
	if (action === 'edited' && event.changes?.body) {
		const current = new Set(issues.filter(i => i.repo === thisRepo).map(i => i.number));
		const removed = closingRefs(event.changes.body.from, thisRepo).filter(n => !current.has(n));
		unlinked = await loadIssues(owner, repo, removed, pr.number, prOpenedAt, projectNumber);
	}

	if (issues.length === 0 && unlinked.length === 0) {
		console.log(`PR #${pr.number} closes no issues; nothing to do`);
		return;
	}

	const intoDefaultBranch = pr.base?.ref === event.repository?.default_branch;
	let version: string | undefined;
	let release: string | undefined;
	if (action === 'closed' && pr.merged && intoDefaultBranch) {
		version = JSON.parse(await readFile('product.json', 'utf8')).positronVersion as string;
		release = releaseTitle(version);
	}
	let milestone: { number: number; title: string } | null | undefined;

	const work = [...issues.map(issue => ({ issue, action })), ...unlinked.map(issue => ({ issue, action: 'unlinked' }))];
	for (const { issue, action } of work) {
		const label = issue.repo === thisRepo ? `#${issue.number}` : `${issue.repo}#${issue.number}`;
		const decision = decide({
			action,
			open: pr.state === 'open',
			draft: Boolean(pr.draft),
			merged: Boolean(pr.merged),
			intoDefaultBranch,
			status: issue.status,
			previous: issue.statusBeforePR,
			milestone: issue.milestone,
			release,
			otherOpenPRs: issue.otherOpenPRs,
		});
		console.log(`${label} (${issue.status ?? 'not on board'}): ${decision.reason}`);

		if (decision.setStatus) {
			const option = project.field.options.find(o => o.name === decision.setStatus);
			if (!option) {
				throw new Error(`board has no status named ${decision.setStatus}`);
			}
			console.log(`  set status -> ${decision.setStatus}`);
			if (!dryRun) {
				await graphql(`
					mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
						updateProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field, value: { singleSelectOptionId: $option } }) { clientMutationId }
					}`, { project: project.id, item: issue.itemId, field: project.field.id, option: option.id });
			}
		}
		if (decision.setMilestone) {
			if (issue.repo !== thisRepo) {
				console.log(`  milestones are per repo; leaving ${label} alone`);
				continue;
			}
			if (milestone === undefined) {
				milestone = await openMilestone(owner, repo, release!);
			}
			if (milestone) {
				console.log(`  set milestone -> ${milestone.title}`);
				if (!dryRun) {
					await rest('PATCH', `/repos/${owner}/${repo}/issues/${issue.number}`, { milestone: milestone.number });
				}
			} else {
				console.log(`  no open milestone named ${release} (version ${version}); leaving it`);
			}
		}
	}
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
	main().catch(err => {
		console.error(err);
		process.exit(1);
	});
}
