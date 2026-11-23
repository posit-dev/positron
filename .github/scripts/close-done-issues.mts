/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Closes every open issue in this repository whose status on the Positron Backlog board is
// Done. Dragging an issue to Done on the board does not close it, so without this the issue
// stays open until someone notices.
//
// Usage:
//   node .github/scripts/close-done-issues.mts
//
// Env:
//   GITHUB_TOKEN          token with issues: write, organization projects: read
//   GITHUB_REPOSITORY     owner/repo (set by Actions)
//   PROJECT_OWNER         org that owns the board, default posit-dev
//   PROJECT_NUMBER        board number, default 2 (Positron Backlog)
//   DRY_RUN               set to 1 to log what would close without closing anything

export interface BoardItem {
	fieldValueByName: { name: string } | null;
	content: { number?: number; state?: string; repository?: { nameWithOwner: string } } | null;
}

/** Open issues in `repo` that are Done. The board also holds issues from other repos and PRs. */
export function openInDone(items: BoardItem[], repo: string): number[] {
	return items
		.filter(i => i.fieldValueByName?.name === 'Done' && i.content?.state === 'OPEN' && i.content.repository?.nameWithOwner === repo)
		.map(i => i.content!.number!);
}

interface BoardPage {
	pageInfo: { hasNextPage: boolean; endCursor: string | null };
	nodes: BoardItem[];
}

export interface BoardResponse {
	data?: { organization: { projectV2: { items: BoardPage } | null } | null } | null;
	errors?: { message: string }[];
}

/**
 * The page of items in a board query response. Items from repos the token can't read come back
 * with null content plus an error; those are warnings, so one private-repo item can't fail the run.
 */
export function boardPage(res: BoardResponse, warn: (msg: string) => void = console.warn): BoardPage {
	const errors = res.errors?.map(e => e.message).join('; ');
	const page = res.data?.organization?.projectV2?.items;
	if (!page) {
		throw new Error(`graphql: ${errors ?? 'board not found'}`);
	}
	if (errors) {
		warn(`graphql (partial): ${errors}`);
	}
	return page;
}

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
	return await res.json() as T;
}

/** Every item on the board; it has a few thousand, so this pages through 100 at a time. */
async function boardItems(projectOwner: string, projectNumber: number): Promise<BoardItem[]> {
	const items: BoardItem[] = [];
	let cursor: string | null = null;
	for (;;) {
		const res: BoardResponse = await rest('POST', '/graphql', {
			query: `
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
				}`,
			variables: { projectOwner, projectNumber, cursor },
		});
		const page = boardPage(res);
		items.push(...page.nodes);
		if (!page.pageInfo.hasNextPage) {
			return items;
		}
		cursor = page.pageInfo.endCursor;
	}
}

async function main() {
	const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
	const projectOwner = process.env.PROJECT_OWNER ?? 'posit-dev';
	const projectNumber = Number(process.env.PROJECT_NUMBER ?? 2);
	const dryRun = process.env.DRY_RUN === '1';

	const issues = openInDone(await boardItems(projectOwner, projectNumber), `${owner}/${repo}`);
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
		} catch (err) {
			failed++;
			console.error(`  failed to close #${number}: ${(err as Error).message}`);
			continue;
		}
		try {
			await rest('POST', `/repos/${owner}/${repo}/issues/${number}/comments`, {
				body: 'Closed because it is marked Done on the Positron Backlog board.',
			});
		} catch (err) {
			console.warn(`  closed #${number}, but could not comment: ${(err as Error).message}`);
		}
	}
	if (failed > 0) {
		throw new Error(`${failed} issue(s) could not be closed`);
	}
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
	main().catch(err => {
		console.error(err);
		process.exit(1);
	});
}
