#!/usr/bin/env node
// Inspects Playwright blob report JSONL files to find failed tests and their
// associated trace/log/screenshot resource hashes.
//
// Usage:
//   node e2e-inspect-blobs.js <blob-dir> [--test-ids id1,id2,...]
//
// Without --test-ids: scans all blobs for failed tests and prints their IDs.
// With --test-ids: finds trace/log attachments for the specified test IDs.
//
// Output: JSON with failedTests and/or attachments

import { readFileSync, readdirSync, existsSync, mkdirSync, unlinkSync, rmdirSync } from 'fs';
import { join, resolve } from 'path';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';

const args = process.argv.slice(2);
let blobDir = null;
let testIds = null;

for (let i = 0; i < args.length; i++) {
	if (args[i] === '--test-ids' && args[i + 1]) {
		testIds = new Set(args[i + 1].split(',').map(s => s.trim()));
		i++;
	} else if (!blobDir) {
		blobDir = args[i];
	}
}

if (!blobDir) {
	console.error('Usage: node e2e-inspect-blobs.js <blob-dir> [--test-ids id1,id2,...]');
	process.exit(1);
}

const resolved = resolve(blobDir);
if (!existsSync(resolved)) {
	console.error(`Directory not found: ${resolved}`);
	process.exit(1);
}

const FAIL_STATUSES = new Set(['failed', 'timedOut', 'interrupted']);

// Find all zip files in the blob directory
const zipFiles = readdirSync(resolved).filter(f => f.endsWith('.zip'));
if (zipFiles.length === 0) {
	console.error('No zip files found in blob directory.');
	process.exit(1);
}

const result = {
	blobDir: resolved,
	blobCount: zipFiles.length,
	failedTests: [],
	attachments: [],
};

// Build a testId -> {title, file} lookup from onProject events across all blobs.
// onProject contains the full suite tree with test metadata that onTestEnd lacks.
const testMeta = new Map();

function collectTestMeta(suite, filePath) {
	for (const entry of suite.entries || []) {
		if (entry.testId) {
			testMeta.set(entry.testId, {
				title: entry.title,
				file: suite.location?.file || filePath,
			});
		}
		if (entry.entries) {
			collectTestMeta(entry, filePath);
		}
	}
}

for (const zipFile of zipFiles) {
	const zipPath = join(resolved, zipFile);
	const tmpDir = join(tmpdir(), `blob-inspect-${zipFile.replace('.zip', '')}`);

	// Extract report.jsonl from the blob zip
	try {
		mkdirSync(tmpDir, { recursive: true });
		execFileSync('unzip', ['-o', zipPath, 'report.jsonl', '-d', tmpDir], {
			stdio: ['pipe', 'pipe', 'pipe'],
		});
	} catch {
		continue; // skip blobs without report.jsonl
	}

	const jsonlPath = join(tmpDir, 'report.jsonl');
	if (!existsSync(jsonlPath)) continue;

	const lines = readFileSync(jsonlPath, 'utf8').split('\n').filter(Boolean);

	for (const line of lines) {
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}

		// Pass 1: Build test metadata lookup from onProject events
		if (event.method === 'onProject') {
			for (const suite of event.params?.project?.suites || []) {
				collectTestMeta(suite, suite.title);
			}
		}

		// Mode 1: Find failed tests
		if (!testIds && event.method === 'onTestEnd') {
			const status = event.params?.result?.status;
			if (FAIL_STATUSES.has(status)) {
				const id = event.params.test?.testId;
				const meta = testMeta.get(id) || {};
				result.failedTests.push({
					testId: id,
					title: meta.title || null,
					file: meta.file || null,
					status,
					blob: zipFile,
				});
			}
		}

		// Mode 2: Find attachments for specific test IDs
		if (testIds && event.method === 'onAttach') {
			if (testIds.has(event.params?.testId)) {
				for (const att of event.params.attachments || []) {
					// Extract the resource hash from the path (last component before .zip)
					const attPath = att.path || '';
					const hashMatch = attPath.match(/([a-f0-9]{40})\./);
					result.attachments.push({
						testId: event.params.testId,
						name: att.name,
						contentType: att.contentType,
						path: attPath,
						resourceHash: hashMatch ? hashMatch[1] : null,
						blob: zipFile,
					});
				}
			}
		}
	}

	// Clean up extracted jsonl
	try {
		unlinkSync(jsonlPath);
		rmdirSync(tmpDir);
	} catch {
		// best effort cleanup
	}
}

console.log(JSON.stringify(result, null, 2));
