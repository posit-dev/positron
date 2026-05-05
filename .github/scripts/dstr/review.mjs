/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Octokit } from '@octokit/rest';
import Anthropic from '@anthropic-ai/sdk';

const MAX_DIFF_CHARS = 80_000;
const MAX_FILE_PATCH_CHARS = 15_000;
const MAX_ISSUE_BODY_CHARS = 3_000;
const MAX_COMMENTS_CHARS = 5_000;

const event = JSON.parse(
	readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')
);

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const owner = event.repository.owner.login;
const repo = event.repository.name;
const prNumber = event.issue.number;

const { data: placeholderComment } = await octokit.issues.createComment({
	owner,
	repo,
	issue_number: prNumber,
	body: ':eyes: Analyzing...',
});

try {
	const { data: pr } = await octokit.pulls.get({
		owner,
		repo,
		pull_number: prNumber,
	});

	// --- Fetch linked issues referenced in the PR body/title ---
	const issueRefs = extractIssueNumbers(pr.body ?? '', pr.title);
	const linkedIssues = await fetchLinkedIssues(issueRefs);

	// --- Fetch PR discussion comments (issue comments + review comments) ---
	const prDiscussion = await fetchPRDiscussion();

	// --- Fetch changed files ---
	const files = await octokit.paginate(octokit.pulls.listFiles, {
		owner,
		repo,
		pull_number: prNumber,
		per_page: 100,
	});

	let totalChars = 0;
	const implFiles = [];
	const testFiles = [];

	for (const file of files) {
		const patch = file.patch ?? '[binary or too large]';
		const truncatedPatch =
			patch.length > MAX_FILE_PATCH_CHARS
				? patch.slice(0, MAX_FILE_PATCH_CHARS) +
					`\n... [truncated, ${patch.length - MAX_FILE_PATCH_CHARS} chars omitted]`
				: patch;

		const entry = `## ${file.filename}\nStatus: ${file.status} | +${file.additions} -${file.deletions}\n\n\`\`\`diff\n${truncatedPatch}\n\`\`\`\n`;

		if (totalChars + entry.length > MAX_DIFF_CHARS) {
			const remaining = files.length - implFiles.length - testFiles.length;
			implFiles.push(`\n... [${remaining} more files omitted due to size]\n`);
			break;
		}

		if (isTestFile(file.filename)) {
			testFiles.push(entry);
		} else {
			implFiles.push(entry);
		}
		totalChars += entry.length;
	}

	// --- Build the user prompt ---
	const systemPromptPath = join(
		process.cwd(),
		'.github',
		'scripts',
		'dstr',
		'system-prompt.md'
	);
	const systemPrompt = readFileSync(systemPromptPath, 'utf8');

	let userPrompt = `Review this PR for data science test design input. Apply the relevance gate strictly. If not relevant, output exactly NOT_RELEVANT.

**PR #${prNumber}: ${pr.title}**

### Description
${pr.body ?? '(no description)'}
`;

	if (linkedIssues.length > 0) {
		userPrompt += `\n### Linked Issues\n\n${linkedIssues.join('\n\n')}\n`;
	}

	if (prDiscussion) {
		userPrompt += `\n### PR Discussion\n\n${prDiscussion}\n`;
	}

	userPrompt += `\n### Implementation Files (${implFiles.length} files)\n\n${implFiles.join('\n')}`;

	if (testFiles.length > 0) {
		userPrompt += `\n### Test Files (${testFiles.length} files)\n\n${testFiles.join('\n')}`;
	} else {
		userPrompt += `\n### Test Files\n\nNone included in this PR.\n`;
	}

	const msg = await anthropic.messages.create({
		model: 'claude-sonnet-4-6-20250514',
		max_tokens: 600,
		system: systemPrompt,
		messages: [{ role: 'user', content: userPrompt }],
	});

	const review = msg.content
		.filter((block) => block.type === 'text')
		.map((block) => block.text)
		.join('\n')
		.trim();

	const tokensUsed = `${msg.usage.input_tokens} in / ${msg.usage.output_tokens} out`;

	// --- Handle NOT_RELEVANT: brief acknowledgment ---
	const firstLine = review.split('\n')[0].trim();
	if (firstLine === 'NOT_RELEVANT') {
		await octokit.issues.updateComment({
			owner,
			repo,
			comment_id: placeholderComment.id,
			body: 'Nothing stood out from a data science testing perspective here.',
		});
		process.exit(0);
	}

	// --- Post the review with feedback reactions ---
	await octokit.issues.updateComment({
		owner,
		repo,
		comment_id: placeholderComment.id,
		body: `${review}\n\n---\n<sub>${tokensUsed} | Was this helpful? React \u{1F44D} or \u{1F44E} to this comment</sub>`,
	});
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error('/dstr failed:', message, error);
	await octokit.issues.updateComment({
		owner,
		repo,
		comment_id: placeholderComment.id,
		body: `:x: /dstr encountered an internal error. Check the [workflow logs](${process.env.GITHUB_SERVER_URL}/${owner}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}) for details.`,
	});
	process.exit(1);
}

// --- Helper functions ---

function isTestFile(filename) {
	const lower = filename.toLowerCase();
	return (
		lower.includes('.test.') ||
		lower.includes('.spec.') ||
		lower.includes('.vitest.') ||
		lower.includes('/test/') ||
		lower.includes('/tests/') ||
		lower.includes('/__tests__/') ||
		lower.endsWith('_test.py') ||
		lower.endsWith('_test.go') ||
		lower.endsWith('_test.rs')
	);
}

function extractIssueNumbers(body, title) {
	const text = `${title}\n${body}`;
	const numbers = new Set();

	const hashPattern = /(?:fix(?:es)?|close[sd]?|resolve[sd]?|address(?:es)?)[\s:]*#(\d+)/gi;
	for (const match of text.matchAll(hashPattern)) {
		numbers.add(parseInt(match[1], 10));
	}

	const bareHashPattern = /(?<!\w)#(\d+)/g;
	for (const match of text.matchAll(bareHashPattern)) {
		const num = parseInt(match[1], 10);
		if (num >= 100) numbers.add(num);
	}

	const urlPattern = new RegExp(
		`https?://github\\.com/${owner}/${repo}/issues/(\\d+)`,
		'gi'
	);
	for (const match of text.matchAll(urlPattern)) {
		numbers.add(parseInt(match[1], 10));
	}

	numbers.delete(prNumber);
	return [...numbers];
}

async function fetchLinkedIssues(issueNumbers) {
	const results = [];
	for (const num of issueNumbers.slice(0, 5)) {
		try {
			const { data: issue } = await octokit.issues.get({
				owner,
				repo,
				issue_number: num,
			});
			const body = (issue.body ?? '').slice(0, MAX_ISSUE_BODY_CHARS);
			const labels = issue.labels
				.map((l) => (typeof l === 'string' ? l : l.name))
				.join(', ');
			results.push(
				`**#${num}: ${issue.title}**${labels ? ` [${labels}]` : ''}\n${body}${issue.body && issue.body.length > MAX_ISSUE_BODY_CHARS ? '\n...' : ''}`
			);
		} catch {
			// Issue may be in a different repo or inaccessible
		}
	}
	return results;
}

async function fetchPRDiscussion() {
	const parts = [];
	let totalLen = 0;

	try {
		const { data: issueComments } = await octokit.issues.listComments({
			owner,
			repo,
			issue_number: prNumber,
			per_page: 30,
		});

		for (const c of issueComments) {
			if (c.user?.type === 'Bot') continue;
			if (c.id === placeholderComment.id) continue;

			const entry = `**${c.user?.login}:** ${c.body?.slice(0, 500) ?? ''}\n`;
			if (totalLen + entry.length > MAX_COMMENTS_CHARS) break;
			parts.push(entry);
			totalLen += entry.length;
		}

		const { data: reviewComments } = await octokit.pulls.listReviewComments({
			owner,
			repo,
			pull_number: prNumber,
			per_page: 30,
		});

		for (const c of reviewComments) {
			if (c.user?.type === 'Bot') continue;
			const entry = `**${c.user?.login}** on \`${c.path}\`: ${c.body?.slice(0, 300) ?? ''}\n`;
			if (totalLen + entry.length > MAX_COMMENTS_CHARS) break;
			parts.push(entry);
			totalLen += entry.length;
		}
	} catch {
		// If we can't fetch comments, proceed without them
	}

	return parts.length > 0 ? parts.join('\n') : '';
}
