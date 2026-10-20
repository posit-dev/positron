/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Intake sweep: fetch the GitHub-side queues and bucket them by what each item
// is actually waiting on. Jira is handled by the skill body (Atlassian MCP).
//
// Run from the repo root:
//   node .claude/skills/positron-intake-rotation/scripts/sweep.ts                 # markdown report
//   node .claude/skills/positron-intake-rotation/scripts/sweep.ts --json          # raw JSON
//   node .claude/skills/positron-intake-rotation/scripts/sweep.ts --no-discussions
//   node .claude/skills/positron-intake-rotation/scripts/sweep.ts --stale-days 14      # threshold for "gone quiet"
//   node .claude/skills/positron-intake-rotation/scripts/sweep.ts --discussion-days 30 # activity window for discussions
//   node .claude/skills/positron-intake-rotation/scripts/sweep.ts --fast               # re-check mode, newest only

import { execFile } from 'node:child_process';

const REPO = 'posit-dev/positron';
const PROJECT = 2;
const TEAM_ASSOC = new Set(['MEMBER', 'OWNER', 'COLLABORATOR']);

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const skipDiscussions = argv.includes('--no-discussions');
// Discussions the team has never replied to are surfaced regardless of age --
// the correct filter yields ~21 repo-wide, so there is no noise to trim. This
// only marks which of them count as "new" in the verdict line.
const RECENT_DAYS = 30;
// Read a numeric flag. Guards two traps: a missing flag makes indexOf return -1
// (so +1 reads argv[0], a real argument), and `Number(x) || fallback` throws away
// an explicit 0.
function numFlag(name: string, fallback: number): number {
	const i = argv.indexOf(name);
	if (i === -1) { return fallback; }
	const n = Number(argv[i + 1]);
	return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const fast = argv.includes('--fast');
const staleDays = numFlag('--stale-days', 14);
// Consecutive all-triaged pages (100 issues each) before --fast gives up looking.
const FAST_CLEAN_PAGES = numFlag('--fast-clean-pages', 3);
// No age filter by default. --fast applies one so the ordered early-stop is
// valid, which also makes --fast mean "anything new since the full sweep".
const discussionDays = numFlag('--discussion-days', fast ? RECENT_DAYS : Infinity);

const now = Date.now();
const days = (iso: string) => (now - new Date(iso).getTime()) / 86400000;
const round = (n: number) => Math.round(n);

// --- GitHub response shapes (only the fields the queries ask for) -------------

interface Login {
	login: string;
}

interface Comment {
	author: Login | null;
	authorAssociation: string;
	createdAt: string;
}

interface IssueNode {
	number: number;
	createdAt: string;
	projectItems: {
		nodes: {
			project: { number: number } | null;
			fieldValueByName: { name?: string } | null;
		}[];
	};
}

interface IssueDetail {
	number: number;
	title: string;
	url: string;
	state: string;
	createdAt: string;
	updatedAt: string;
	author: Login | null;
	authorAssociation: string;
	issueType: { name: string } | null;
	labels: { nodes: { name: string }[] };
	reactions: { totalCount: number };
	comments: { totalCount: number; nodes: Comment[] };
	body: string | null;
}

interface DiscussionComment {
	authorAssociation: string;
	createdAt: string;
	replies: { nodes: { authorAssociation: string; createdAt: string }[] };
}

interface DiscussionNode {
	number: number;
	title: string;
	url: string;
	createdAt: string;
	updatedAt: string;
	isAnswered: boolean;
	author: Login | null;
	authorAssociation: string;
	category: { name: string; isAnswerable: boolean } | null;
	comments: { totalCount: number; nodes: DiscussionComment[] };
}

interface Connection<T> {
	totalCount: number;
	pageInfo: { hasNextPage: boolean; endCursor: string | null };
	nodes: T[];
}

// --- Report shapes -------------------------------------------------------------

type Bucket = 'user-replied' | 'untouched' | 'needs-status' | 'waiting-on-user' | 'gone-quiet';

interface QueuedIssue {
	number: number;
	repo: string;
}

interface ScanResult {
	queue: QueuedIssue[];
	offBoard: number[];
	pages: number;
	scanned: number;
	totalOpen: number;
	stoppedEarly: boolean;
	oldestScanned: string | null;
}

interface BucketedIssue {
	number: number;
	title: string;
	url: string;
	author: string;
	authorIsTeam: boolean;
	type: string | null;
	labels: string[];
	areaLabels: string[];
	hasAreaLabel: boolean;
	infoNeeded: boolean;
	thumbsUp: number;
	commentCount: number;
	ageDays: number;
	bucket: Bucket;
	waitingDays: number | null;
	reportedVersion: string | null;
	hasVersionBlock: boolean;
	bodyChars: number;
}

interface NeedsReply {
	number: number;
	title: string;
	url: string;
	author: string;
	authorIsTeam: boolean;
	category: string;
	answerable: boolean;
	commentCount: number;
	ageDays: number;
	quietDays: number;
	neverAnswered: boolean;
}

interface DiscussionScan {
	needsReply: NeedsReply[];
	total: number;
	scanned: number;
	truncated?: boolean;
}

interface SweepResult {
	generatedAt: string;
	staleDays: number;
	fast: boolean;
	scan: Omit<ScanResult, 'queue'> & { queueSize: number };
	issues: BucketedIssue[];
	discussions: DiscussionScan;
}

// --- gh helpers ----------------------------------------------------------------

function gh(args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile('gh', args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
			if (err) { reject(new Error(`gh ${args[0]} ${args[1] || ''} failed: ${stderr || err.message}`)); return; }
			resolve(stdout);
		});
	});
}

async function graphql<T>(query: string, vars: Record<string, string | number | null | undefined> = {}): Promise<T> {
	const args = ['api', 'graphql', '-f', `query=${query}`];
	for (const [k, v] of Object.entries(vars)) {
		if (v === null || v === undefined) { continue; }
		args.push(typeof v === 'number' ? '-F' : '-f', `${k}=${v}`);
	}
	return JSON.parse(await gh(args)) as T;
}

// --- Pass 1: enumerate open issues, read project Status inline ----------------
// Deliberately NOT a scan of the project board's items() connection. That
// connection silently omits archived items, which made triaged-and-archived
// issues (e.g. #811, Status "Done", archived) look like they were never added to
// the board at all. Enumerating open issues instead is complete, ~40% faster
// (19 pages vs 26), and detects genuinely off-board issues for free.
//
// `includeArchived: true` is required, not optional -- without it, an archived
// item disappears and its issue looks off-board again.
const OPEN_ISSUES_QUERY = `
query($owner: String!, $repo: String!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    issues(first: 100, states: OPEN, after: $cursor,
           orderBy: { field: CREATED_AT, direction: DESC }) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        createdAt
        projectItems(first: 5, includeArchived: true) {
          nodes {
            project { number }
            fieldValueByName(name: "Status") {
              ... on ProjectV2ItemFieldSingleSelectValue { name }
            }
          }
        }
      }
    }
  }
}`;

async function scanQueue(): Promise<ScanResult> {
	const [owner, name] = REPO.split('/');
	const queue: QueuedIssue[] = [];
	const offBoard: number[] = [];
	let cursor: string | null = null, pages = 0, scanned = 0, cleanStreak = 0;
	let stoppedEarly = false, oldestScanned: string | null = null, totalOpen = 0;

	for (; ;) {
		const data: { data: { repository: { issues: Connection<IssueNode> } } } =
			await graphql(OPEN_ISSUES_QUERY, { owner, repo: name, cursor });
		const conn = data.data.repository.issues;
		totalOpen = conn.totalCount;
		pages++;
		let hitsThisPage = 0;

		for (const n of conn.nodes) {
			scanned++;
			oldestScanned = n.createdAt;
			const item = n.projectItems.nodes.find(p => p.project?.number === PROJECT);
			if (!item) { offBoard.push(n.number); continue; }
			if (item.fieldValueByName?.name) { continue; } // has a Status -> not intake's
			queue.push({ number: n.number, repo: REPO });
			hitsThisPage++;
		}

		cleanStreak = hitsThisPage ? 0 : cleanStreak + 1;
		if (!conn.pageInfo.hasNextPage) { break; }
		// --fast: issues are newest-first and untriaged ones cluster at the new
		// end, so N consecutive pages with no hits is a decent stopping rule.
		// Adaptive, unlike a fixed `updatedAt` window -- which would filter out
		// the gone-quiet bucket by definition, since those are exactly the items
		// nobody has touched recently.
		if (fast && cleanStreak >= FAST_CLEAN_PAGES) { stoppedEarly = true; break; }
		cursor = conn.pageInfo.endCursor;
	}

	return { queue, offBoard, pages, scanned, totalOpen, stoppedEarly, oldestScanned };
}

// --- Pass 2: detail only for the survivors -----------------------------------
const DETAIL_QUERY = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      number title url state createdAt updatedAt
      author { login }
      authorAssociation
      issueType { name }
      labels(first: 30) { nodes { name } }
      reactions(content: THUMBS_UP) { totalCount }
      comments(last: 30) {
        totalCount
        nodes { author { login } authorAssociation createdAt }
      }
      body
    }
  }
}`;

async function fetchDetail({ number, repo }: QueuedIssue): Promise<IssueDetail | null> {
	const [owner, name] = repo.split('/');
	const data = await graphql<{ data: { repository: { issue: IssueDetail | null } } }>(
		DETAIL_QUERY, { owner, repo: name, number });
	return data.data.repository.issue;
}

// --- Bucketing ---------------------------------------------------------------
// The distinction that matters: an unstatused issue may be brand new, or it may
// be one we already answered and are waiting on. Same empty Status field, very
// different next action.
function bucketIssue(iss: IssueDetail): BucketedIssue {
	const labels = iss.labels.nodes.map(l => l.name);
	const infoNeeded = labels.includes('info needed');
	const comments = iss.comments.nodes;
	const teamComments = comments.filter(c => TEAM_ASSOC.has(c.authorAssociation));
	const lastTeam = teamComments.at(-1) ?? null;
	const last = comments.at(-1) ?? null;
	const lastIsTeam = last ? TEAM_ASSOC.has(last.authorAssociation) : false;

	let bucket: Bucket;
	let waitingDays: number | null = null;
	if (infoNeeded && last && !lastIsTeam) {
		bucket = 'user-replied';
		waitingDays = round(days(last.createdAt));
	} else if (infoNeeded && lastTeam && days(lastTeam.createdAt) > staleDays) {
		bucket = 'gone-quiet';
		waitingDays = round(days(lastTeam.createdAt));
	} else if (infoNeeded) {
		bucket = 'waiting-on-user';
		waitingDays = lastTeam ? round(days(lastTeam.createdAt)) : round(days(iss.createdAt));
	} else if (!lastTeam) {
		bucket = 'untouched';
		waitingDays = round(days(iss.createdAt));
	} else {
		bucket = 'needs-status';
		waitingDays = round(days(lastTeam.createdAt));
	}

	// Signals the drill-in uses; cheap to compute here, saves a re-read.
	const body = iss.body || '';
	const hasVersionBlock = /Positron Version:|Version: Positron|Code - OSS/i.test(body);
	const versionMatch = body.match(/Positron(?: Version)?:?\s*(\d{4}\.\d{2}\.\d+[^\s,)]*)/i);
	const areaLabels = labels.filter(l => /^(area|lang|theme):/.test(l));

	return {
		number: iss.number,
		title: iss.title,
		url: iss.url,
		author: iss.author?.login ?? '(ghost)',
		authorIsTeam: TEAM_ASSOC.has(iss.authorAssociation),
		type: iss.issueType?.name ?? null,
		labels,
		areaLabels,
		hasAreaLabel: areaLabels.length > 0,
		infoNeeded,
		thumbsUp: iss.reactions.totalCount,
		commentCount: iss.comments.totalCount,
		ageDays: round(days(iss.createdAt)),
		bucket,
		waitingDays,
		reportedVersion: versionMatch ? versionMatch[1].replace(/[.,;:]+$/, '') : null,
		hasVersionBlock,
		bodyChars: body.length,
	};
}

// --- Discussions -------------------------------------------------------------
// "Needs a Posit reply" means NOBODY from the team has ever replied -- not "the
// user had the last word". Those are wildly different sets: 21 vs 186 as of Aug
// 2026. A thread where we answered and the reporter wrote back has been handled.
//
// Team answers also get posted as nested replies inside a thread, so scanning
// only top-level comments misses them (that alone moved the last-word count from
// 140 to 186). Both levels are checked.
const DISCUSSION_QUERY = `
query($owner: String!, $repo: String!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    discussions(first: 50, after: $cursor, states: OPEN, orderBy: { field: UPDATED_AT, direction: DESC }) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        number title url createdAt updatedAt isAnswered
        author { login }
        authorAssociation
        category { name isAnswerable }
        comments(first: 40) {
          totalCount
          nodes {
            authorAssociation createdAt
            replies(first: 20) { nodes { authorAssociation createdAt } }
          }
        }
      }
    }
  }
}`;

async function scanDiscussions(): Promise<DiscussionScan> {
	const [owner, name] = REPO.split('/');
	const needsReply: NeedsReply[] = [];
	// Results are ordered UPDATED_AT DESC, and updatedAt is always >= the last
	// comment date, so once updatedAt falls outside the window every remaining
	// discussion does too. Stopping there is exact, not a heuristic. Only done
	// under --fast, because the backlog age bands need the full page-through.
	const cutoff = (fast && Number.isFinite(discussionDays))
		? now - discussionDays * 86400000
		: null;
	let cursor: string | null = null, total = 0, scanned = 0, truncated = false;
	for (; ;) {
		const data: { data: { repository: { discussions: Connection<DiscussionNode> } } } =
			await graphql(DISCUSSION_QUERY, { owner, repo: name, cursor });
		const d = data.data.repository.discussions;
		total = d.totalCount;
		for (const n of d.nodes) {
			scanned++;
			if (n.category?.name === 'Announcements') { continue; }
			// A community-accepted answer counts as resolved even if no Posit
			// person replied.
			if (n.isAnswered) { continue; }

			// Any team comment anywhere in the thread means this was handled.
			// Derived from authorAssociation, so there is no roster to go stale.
			let teamReplied = false;
			let lastActivity = new Date(n.createdAt).getTime();
			for (const c of n.comments.nodes) {
				for (const x of [c, ...c.replies.nodes]) {
					if (TEAM_ASSOC.has(x.authorAssociation)) { teamReplied = true; }
					const ts = new Date(x.createdAt).getTime();
					if (ts > lastActivity) { lastActivity = ts; }
				}
			}
			if (teamReplied) { continue; }

			needsReply.push({
				number: n.number,
				title: n.title,
				url: n.url,
				author: n.author?.login ?? '(ghost)',
				authorIsTeam: TEAM_ASSOC.has(n.authorAssociation),
				category: n.category?.name ?? '?',
				answerable: !!n.category?.isAnswerable,
				commentCount: n.comments.totalCount,
				ageDays: round(days(n.createdAt)),
				quietDays: round(days(new Date(lastActivity).toISOString())),
				neverAnswered: n.comments.totalCount === 0,
			});
		}
		if (!d.pageInfo.hasNextPage) { break; }
		const last = d.nodes.at(-1);
		if (cutoff !== null && last && new Date(last.updatedAt).getTime() < cutoff) {
			truncated = true;
			break;
		}
		cursor = d.pageInfo.endCursor;
	}
	return { needsReply, total, scanned, truncated };
}

// --- Report ------------------------------------------------------------------
const BUCKET_ORDER: Bucket[] = ['user-replied', 'untouched', 'needs-status', 'waiting-on-user', 'gone-quiet'];
const BUCKET_LABEL: Record<Bucket, string> = {
	'user-replied': 'User replied -- re-assess and drop `info needed`',
	'untouched': 'Untouched -- full triage needed',
	'needs-status': 'Team engaged, Status still empty -- likely just needs `Triage`',
	'waiting-on-user': 'Waiting on user -- no action, just tracking',
	'gone-quiet': `Gone quiet (>${staleDays}d) -- consider closing`,
};

function renderIssue(i: BucketedIssue): string {
	const bits = [`${i.ageDays}d old`];
	if (i.waitingDays !== null && i.bucket !== 'untouched') { bits.push(`${i.waitingDays}d since last move`); }
	if (i.type) { bits.push(i.type); }
	bits.push(i.hasAreaLabel ? i.areaLabels.join(' ') : 'NO AREA LABEL');
	if (i.thumbsUp) { bits.push(`${i.thumbsUp} thumbsup`); }
	if (i.commentCount) { bits.push(`${i.commentCount} comments`); }
	if (i.reportedVersion) {
		bits.push(`reported ${i.reportedVersion}`);
	} else if (!i.hasVersionBlock) {
		bits.push('no version info');
	}
	if (i.bodyChars < 200) { bits.push('very short body'); }
	return `- **#${i.number}** ${i.title}\n  - @${i.author} | ${bits.join(' | ')}\n  - ${i.url}`;
}

function render(r: SweepResult): string {
	const L: string[] = [];
	// Computed up front: both the header and the verdict must quote the same
	// in-window number, not the raw count of everything that was paged.
	const activeDiscussions = r.discussions.needsReply.filter(d => d.quietDays <= discussionDays);
	const recentDiscussions = activeDiscussions.filter(d => d.ageDays <= RECENT_DAYS);
	L.push(`# positron intake sweep -- ${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z`);
	L.push('');
	L.push(`Issue queue: **${r.issues.length}** open issue(s) on project #${PROJECT} with no Status. `
		+ `Scanned ${r.scan.scanned} of ${r.scan.totalOpen} open issues (${r.scan.pages} pages). `
		+ (r.discussions.truncated
			? `Discussions with no Posit reply, opened in the last ${discussionDays}d: `
			+ `**${activeDiscussions.length}** (of ${r.discussions.total} open; older not counted).`
			: `Discussions with no Posit reply: **${activeDiscussions.length}** `
			+ `of ${r.discussions.total} open, ${recentDiscussions.length} from the last `
			+ `${RECENT_DAYS}d.`));
	L.push('');

	if (r.scan.stoppedEarly) {
		L.push(`> **\`--fast\`: partial scan.** Stopped after ${FAST_CLEAN_PAGES} consecutive pages `
			+ `with no unstatused issues, having checked the newest ${r.scan.scanned} open issues `
			+ `(back to ${r.scan.oldestScanned?.slice(0, 10)}). An older issue that was never triaged `
			+ `would be missed. Run without \`--fast\` before relying on this being the whole queue.`);
		L.push('');
	}

	// Verdict up front. "Waiting on user" needs no action, so a queue that is
	// entirely waiting is a quiet day -- say so instead of making it be read.
	const actionable = r.issues.filter(i => i.bucket !== 'waiting-on-user');
	const parts: string[] = [];
	if (actionable.length) { parts.push(`${actionable.length} issue(s) need action`); }
	// Only recent unanswered discussions count as work. A 2-year-old feature wish
	// nobody replied to is not something anyone is waiting on today.
	if (recentDiscussions.length) {
		parts.push(`${recentDiscussions.length} new discussion(s) with no Posit reply`);
	}
	if (r.scan.offBoard.length) { parts.push(`${r.scan.offBoard.length} issue(s) off-board`); }
	if (parts.length) {
		L.push(`**Verdict:** ${parts.join('; ')}. `
			+ `${r.issues.length - actionable.length} issue(s) are waiting on the user (no action).`);
	} else {
		L.push(`**Verdict:** nothing actionable on the GitHub side. `
			+ `All ${r.issues.length} queued issue(s) are waiting on the user. Still check Jira.`);
	}
	L.push('');

	if (r.scan.offBoard.length) {
		L.push(`> **Not on project #${PROJECT}** (${r.scan.offBoard.length}): `
			+ r.scan.offBoard.slice(0, 20).map(n => `#${n}`).join(', ')
			+ '. These bypass the queue entirely -- add them to the board.');
		L.push('');
	}

	L.push('## Issue queue');
	L.push('');
	if (!r.issues.length) {
		L.push('_Empty -- every open issue on the board has a Status._');
	} else {
		for (const b of BUCKET_ORDER) {
			const items = r.issues.filter(i => i.bucket === b);
			if (!items.length) { continue; }
			const sorted = items.sort((x, y) => (y.waitingDays ?? 0) - (x.waitingDays ?? 0));
			L.push(`### ${BUCKET_LABEL[b]} (${items.length})`);
			L.push('');
			for (const i of sorted) { L.push(renderIssue(i)); }
			L.push('');
		}
	}

	if (!skipDiscussions) {
		L.push('## Discussions with no Posit reply');
		L.push('');
		// Newest first: a thread nobody answered last week matters more than one
		// from 2024. Age is shown so stale ones are obvious rather than hidden.
		const items = r.discussions.needsReply
			.filter(d => d.quietDays <= discussionDays)
			.sort((a, b) => a.ageDays - b.ageDays);

		if (!items.length) {
			L.push(discussionDays === Infinity
				? '_None. Every open discussion has had a reply from someone at Posit._'
				: `_None opened in the last ${discussionDays}d without a Posit reply._`);
		} else {
			const recent = items.filter(d => d.ageDays <= RECENT_DAYS);
			const older = items.filter(d => d.ageDays > RECENT_DAYS);
			const line = (d: NeedsReply) => {
				const bits = [d.category, `${d.ageDays}d old`];
				bits.push(d.neverAnswered ? 'NO COMMENTS AT ALL' : `${d.commentCount} comments, none from Posit`);
				if (d.answerable) { bits.push('answerable'); }
				if (d.authorIsTeam) { bits.push('opened by a team member'); }
				return `- **#${d.number}** ${d.title}\n  - @${d.author} | ${bits.join(' | ')}\n  - ${d.url}`;
			};

			if (recent.length) {
				L.push(`### New (last ${RECENT_DAYS}d) -- these are the ones that matter (${recent.length})`);
				L.push('');
				for (const d of recent) { L.push(line(d)); }
				L.push('');
			} else {
				L.push(`_Nothing from the last ${RECENT_DAYS}d is unanswered -- the rotation is keeping up._`);
				L.push('');
			}

			if (older.length) {
				L.push(`### Older, still never answered (${older.length})`);
				L.push('');
				for (const d of older) { L.push(line(d)); }
				L.push('');
				L.push('_Mostly old feature wishes. Worth a pass if you want to close the loop, '
					+ 'but nobody is actively waiting._');
			}
		}

		if (r.discussions.truncated) {
			L.push('');
			L.push(`_\`--fast\`: stopped paging once results fell outside ${discussionDays}d (exact, since `
				+ 'results are ordered by last update). Older never-answered threads were not counted._');
		}
		L.push('');
	}

	L.push('## Next');
	L.push('');
	L.push('Jira is not in this report -- fetch open `PSTRNESC` (Positron Escalations) tickets via the');
	L.push('Atlassian MCP (narrow `fields`, no `description`) as described in SKILL.md, then rank');
	L.push('everything together. Drill into one item with `/positron-intake-rotation <number|KEY>`.');
	return L.join('\n');
}

// --- Main --------------------------------------------------------------------
try {
	const scan = await scanQueue();
	const [details, discussions] = await Promise.all([
		Promise.all(scan.queue.map(fetchDetail)),
		skipDiscussions ? Promise.resolve<DiscussionScan>({ needsReply: [], total: 0, scanned: 0 }) : scanDiscussions(),
	]);
	const result: SweepResult = {
		generatedAt: new Date().toISOString(),
		staleDays,
		fast,
		scan: {
			pages: scan.pages,
			scanned: scan.scanned,
			totalOpen: scan.totalOpen,
			queueSize: scan.queue.length,
			stoppedEarly: scan.stoppedEarly,
			oldestScanned: scan.oldestScanned,
			offBoard: scan.offBoard.sort((a, b) => b - a),
		},
		issues: details.filter((d): d is IssueDetail => d !== null).map(bucketIssue),
		discussions,
	};
	process.stdout.write(asJson ? JSON.stringify(result, null, 2) : render(result));
	process.stdout.write('\n');
} catch (err) {
	console.error(`sweep failed: ${err instanceof Error ? err.message : String(err)}`);
	process.exit(1);
}
