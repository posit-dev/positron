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
//   PR closed without merging              -> back to the status it had when the PR opened,
//                                             unless another open PR still closes the issue
//                                             or someone has since moved it elsewhere
//   PR merged into the default branch      -> the release milestone for the version in
//                                             product.json at the merge commit, if the issue
//                                             has none; the board's own "Item closed" rule
//                                             moves the issue to Done
//
// The milestone is chosen at merge, not earlier, because a PR that misses a release fork
// ships in the next release. The fork bumps positronVersion on main, so the merge commit
// says which release the change is in.
//
// The status before the PR comes from the issue's board history, so nothing is written
// to the PR. Issues already in Done are never touched.
//
// The second mode, `close-done`, closes every open issue whose board status is Done.
// Dragging an issue to Done on the board does not close it, so without this the issue
// stays open until someone notices.
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
	action: string;
	draft: boolean;
	merged: boolean;
	/** The PR targets the repository's default branch. */
	intoDefaultBranch: boolean;
	/** Current board status; undefined when the issue is not on the board. */
	status: Status | undefined;
	/** Board status when the PR was opened; undefined if it had none. */
	previous: Status | undefined;
	hasMilestone: boolean;
	otherOpenPRs: boolean;
}

/** Pure transition rules. Everything that talks to GitHub lives below. */
export function decide(input: DecisionInput): Decision {
	const { action, draft, merged, intoDefaultBranch, status, previous, hasMilestone, otherOpenPRs } = input;
	// Checked before the board status: by the time this runs the merge may already have
	// closed the issue and moved it to Done.
	if (action === 'closed' && merged) {
		if (!intoDefaultBranch) {
			return { reason: 'merged into a non-default branch; leaving the milestone' };
		}
		if (hasMilestone) {
			return { reason: 'merged; issue already has a milestone' };
		}
		return { setMilestone: true, reason: 'merged; adding the release milestone' };
	}
	if (status === undefined) {
		return { reason: 'issue is not on the board' };
	}
	if (status === 'Done') {
		return { reason: 'issue is already Done' };
	}

	if (action === 'closed') {
		if (otherOpenPRs) {
			return { reason: 'another open PR still closes this issue' };
		}
		if (status !== 'In Progress' && status !== 'PR Ready') {
			return { reason: `someone moved it to ${status}; leaving it` };
		}
		const decision: Decision = { reason: 'PR closed without merging' };
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

/** The release milestone for a Positron version: 2026.12.0 and 2026.12.1 both map to "2026.12.0 Release". */
export function milestoneForVersion<M extends { title: string }>(milestones: M[], version: string): M | undefined {
	const release = /^(\d+\.\d+)\./.exec(version)?.[1];
	return release === undefined ? undefined : milestones.find(m => m.title === `${release}.0 Release`);
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

interface IssueOnBoard {
	number: number;
	itemId: string | undefined;
	status: Status | undefined;
	statusAtPROpen: Status | undefined;
	hasMilestone: boolean;
	otherOpenPRs: boolean;
}

async function loadPR(owner: string, repo: string, pr: number, projectOwner: string, projectNumber: number) {
	const data = await graphql<{
		organization: { projectV2: { id: string; field: { id: string; options: { id: string; name: string }[] } } };
		repository: {
			pullRequest: {
				createdAt: string;
				closingIssuesReferences: {
					nodes: {
						number: number;
						milestone: { number: number } | null;
						projectItems: { nodes: { id: string; project: { number: number }; fieldValueByName: { name: string } | null }[] };
						closedByPullRequestsReferences: { nodes: { number: number; state: string }[] };
						timelineItems: { nodes: StatusChange[] };
					}[];
				};
			};
		};
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
					closingIssuesReferences(first: 20) {
						nodes {
							number
							milestone { number }
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
						}
					}
				}
			}
		}`, { owner, repo, pr, projectOwner, projectNumber });

	const project = data.organization.projectV2;
	const prOpenedAt = data.repository.pullRequest.createdAt;
	const issues: IssueOnBoard[] = data.repository.pullRequest.closingIssuesReferences.nodes.map(n => {
		const item = n.projectItems.nodes.find(i => i.project.number === projectNumber);
		return {
			number: n.number,
			itemId: item?.id,
			status: item?.fieldValueByName?.name as Status | undefined,
			statusAtPROpen: statusAt(n.timelineItems.nodes, projectNumber, prOpenedAt),
			hasMilestone: n.milestone !== null,
			otherOpenPRs: n.closedByPullRequestsReferences.nodes.some(p => p.number !== pr && p.state === 'OPEN'),
		};
	});
	return { project, issues };
}

/** Every open issue on the board whose status is Done. Walks all board items; the board has a few thousand. */
async function openIssuesInDone(projectOwner: string, projectNumber: number): Promise<number[]> {
	const found: number[] = [];
	let cursor: string | null = null;
	for (;;) {
		const data: {
			organization: {
				projectV2: {
					items: {
						pageInfo: { hasNextPage: boolean; endCursor: string | null };
						nodes: { fieldValueByName: { name: string } | null; content: { number?: number; state?: string } | null }[];
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
								content { ... on Issue { number state } }
							}
						}
					}
				}
			}`, { projectOwner, projectNumber, cursor });
		const page = data.organization.projectV2.items;
		for (const item of page.nodes) {
			if (item.fieldValueByName?.name === 'Done' && item.content?.state === 'OPEN' && item.content.number) {
				found.push(item.content.number);
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
	const issues = await openIssuesInDone(projectOwner, projectNumber);
	console.log(`${issues.length} open issue(s) are Done on the board`);
	for (const number of issues) {
		console.log(`  close #${number}`);
		if (!dryRun) {
			await rest('POST', `/repos/${owner}/${repo}/issues/${number}/comments`, {
				body: 'Closing this issue because it is marked Done on the Positron Backlog board.',
			});
			await rest('PATCH', `/repos/${owner}/${repo}/issues/${number}`, { state: 'closed', state_reason: 'completed' });
		}
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

	const { project, issues } = await loadPR(owner, repo, pr.number, projectOwner, projectNumber);
	if (issues.length === 0) {
		console.log(`PR #${pr.number} closes no issues; nothing to do`);
		return;
	}

	let version: string | undefined;
	let milestone: { number: number; title: string } | undefined;

	for (const issue of issues) {
		const decision = decide({
			action,
			draft: Boolean(pr.draft),
			merged: Boolean(pr.merged),
			intoDefaultBranch: pr.base?.ref === event.repository?.default_branch,
			status: issue.status,
			previous: issue.statusAtPROpen,
			hasMilestone: issue.hasMilestone,
			otherOpenPRs: issue.otherOpenPRs,
		});
		console.log(`#${issue.number} (${issue.status ?? 'not on board'}): ${decision.reason}`);

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
			version ??= JSON.parse(await readFile('product.json', 'utf8')).positronVersion as string;
			milestone ??= milestoneForVersion(await rest('GET', `/repos/${owner}/${repo}/milestones?state=open&per_page=100`), version);
			if (milestone) {
				console.log(`  set milestone -> ${milestone.title}`);
				if (!dryRun) {
					await rest('PATCH', `/repos/${owner}/${repo}/issues/${issue.number}`, { milestone: milestone.number });
				}
			} else {
				console.log(`  no open milestone for version ${version}; leaving milestone unset`);
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
