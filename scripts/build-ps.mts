/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const DAEMONS = ['watch-client-transpile', 'watch-client', 'watch-extensions', 'watch-e2e'];

const FINISH_PATTERN: Record<string, RegExp> = {
	'watch-client-transpile': /Finished transpilation/,
	'watch-client': /Finished compilation/,
	'watch-extensions': /Finished compilation/,
	'watch-e2e': /Found \d+ errors?\. Watching for file changes/,
};

const ANSI_ESCAPE = /\x1b\[[0-9;]*m/g;
// Matches both 12h (6:12:55 PM) and 24h gulp-style ([18:12:55]) timestamps
const TIMESTAMP_RE = /(?:\[(\d{1,2}:\d{2}:\d{2})\]|(\d{1,2}:\d{2}:\d{2}\s*[AP]M))/;
const DEEMON_MARKER = /\[deemon\] (Spawned|Attached to running) build daemon/;

function getIPCHandle(commandPath: string, args: string[], cwd: string): string {
	const scope = createHash('md5')
		.update(commandPath)
		.update(args.toString())
		.update(cwd)
		.digest('hex');
	if (process.platform === 'win32') {
		return `\\\\.\\pipe\\daemon-${scope}`;
	}
	return join(process.env['XDG_RUNTIME_DIR'] || tmpdir(), `daemon-${scope}.sock`);
}

interface ProcessEntry {
	pid: number;
	ppid: number;
	rss: number;
	cputime: number;
}

interface TreeStats {
	rss: number;
	cpu: number;
}

function parseProcessTable(): ProcessEntry[] {
	try {
		const output = execSync('ps -eo pid=,ppid=,rss=,cputime=', { encoding: 'utf-8' });
		const entries: ProcessEntry[] = [];
		for (const line of output.split('\n')) {
			const parts = line.trim().split(/\s+/);
			if (parts.length < 4) { continue; }
			const [pid, ppid, rss, cputime] = parts;
			entries.push({
				pid: Number(pid),
				ppid: Number(ppid),
				rss: Number(rss),
				cputime: parseCputime(cputime),
			});
		}
		return entries;
	} catch {
		return [];
	}
}

/** Parse cputime string (H:MM:SS or M:SS.ff) to seconds */
function parseCputime(s: string): number {
	const parts = s.split(':');
	if (parts.length === 3) {
		return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + parseFloat(parts[2]);
	}
	if (parts.length === 2) {
		return Number(parts[0]) * 60 + parseFloat(parts[1]);
	}
	return parseFloat(s) || 0;
}

function getDescendants(pid: number, table: ProcessEntry[]): ProcessEntry[] {
	const result: ProcessEntry[] = [];
	const queue = [pid];
	while (queue.length > 0) {
		const parent = queue.pop()!;
		for (const entry of table) {
			if (entry.ppid === parent) {
				result.push(entry);
				queue.push(entry.pid);
			}
		}
	}
	return result;
}

function findDaemonPid(name: string, cwd: string): number | undefined {
	const suffix = `deemon --daemon npm run ${name}`;
	try {
		const output = execSync('ps -eo pid=,command=', { encoding: 'utf-8' });
		for (const line of output.trim().split('\n')) {
			const trimmed = line.trim();
			const spaceIdx = trimmed.indexOf(' ');
			if (spaceIdx === -1) { continue; }
			const cmd = trimmed.slice(spaceIdx + 1).trim();
			if (!cmd.includes(cwd)) { continue; }
			if (!cmd.endsWith(suffix)) { continue; }
			return Number(trimmed.slice(0, spaceIdx));
		}
	} catch { /* no match */ }
	return undefined;
}

function getTreeStats(daemonPid: number, table: ProcessEntry[]): TreeStats {
	const self = table.find(e => e.pid === daemonPid);
	const descendants = getDescendants(daemonPid, table);
	const allProcesses = self ? [self, ...descendants] : descendants;
	let rss = 0;
	let cpu = 0;
	for (const p of allProcesses) {
		rss += p.rss;
		cpu += p.cputime;
	}
	return { rss, cpu };
}

function formatRss(kbytes: number): string {
	const mb = kbytes / 1024;
	if (mb >= 1024) { return `${(mb / 1024).toFixed(1)}G`; }
	return `${Math.round(mb)}M`;
}

function formatCpu(seconds: number): string {
	if (seconds < 60) { return `${seconds.toFixed(1)}s`; }
	const totalSeconds = Math.round(seconds);
	const minutes = Math.floor(totalSeconds / 60);
	const secs = totalSeconds % 60;
	if (minutes < 60) { return `${minutes}m${secs}s`; }
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return `${hours}h${remainingMinutes}m`;
}

interface DaemonInfo {
	status: 'running' | 'stopped';
	uptime?: string;
	uptimeMs?: number;
	lastCompiled?: string;
	rss?: string;
	cpu?: string;
}

function checkDaemon(name: string, cwd: string): Promise<'running' | 'stopped'> {
	const handle = getIPCHandle('npm', ['run', name], cwd);
	return new Promise((resolve) => {
		const socket = createConnection(handle, () => {
			socket.destroy();
			resolve('running');
		});
		socket.once('error', () => resolve('stopped'));
	});
}

function formatUptime(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) { return `${seconds}s`; }
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) { return `${minutes}m`; }
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return `${hours}h ${remainingMinutes}m`;
}

async function getSocketUptime(name: string, cwd: string): Promise<string | undefined> {
	const handle = getIPCHandle('npm', ['run', name], cwd);
	try {
		const st = await stat(handle);
		const age = Date.now() - st.birthtimeMs;
		return formatUptime(age);
	} catch {
		return undefined;
	}
}

const TALK = 1;

function getLastCompiled(name: string, cwd: string): Promise<string | undefined> {
	const handle = getIPCHandle('npm', ['run', name], cwd);
	const pattern = FINISH_PATTERN[name];
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			socket.destroy();
			resolve(undefined);
		}, 3000);

		const socket = createConnection(handle, () => {
			socket.write(new Uint8Array([TALK]));
		});

		let pending = '';
		let lastTimestamp: string | undefined;
		let hasFinished = false;

		socket.on('data', (data: Buffer) => {
			pending += data.toString();
			const lines = pending.split('\n');
			pending = lines.pop() || '';
			for (const line of lines) {
				const clean = line.replace(ANSI_ESCAPE, '');
				if (DEEMON_MARKER.test(clean)) {
					clearTimeout(timer);
					socket.destroy();
					resolve(lastTimestamp || (hasFinished ? 'idle' : undefined));
					return;
				}
				if (pattern.test(clean)) {
					hasFinished = true;
					const m = clean.match(TIMESTAMP_RE);
					if (m) { lastTimestamp = m[1] || m[2]; }
				}
			}
		});

		socket.once('error', () => {
			clearTimeout(timer);
			resolve(undefined);
		});
	});
}

async function getDaemonInfo(name: string, cwd: string, table: ProcessEntry[]): Promise<DaemonInfo> {
	const status = await checkDaemon(name, cwd);
	if (status === 'stopped') { return { status }; }

	const [uptime, lastCompiled] = await Promise.all([
		getSocketUptime(name, cwd),
		getLastCompiled(name, cwd),
	]);

	let rss: string | undefined;
	let cpu: string | undefined;
	let uptimeMs: number | undefined;
	const pid = findDaemonPid(name, cwd);
	if (pid && table.length > 0) {
		const stats = getTreeStats(pid, table);
		rss = formatRss(stats.rss);
		cpu = formatCpu(stats.cpu);
	}

	const handle = getIPCHandle('npm', ['run', name], cwd);
	try {
		const st = await stat(handle);
		uptimeMs = Date.now() - st.birthtimeMs;
	} catch { /* ignore */ }

	return { status, uptime, lastCompiled, rss, cpu, uptimeMs };
}

const KILL = 0;

function stopDaemon(name: string, cwd: string): Promise<'killed' | 'not running'> {
	const handle = getIPCHandle('npm', ['run', name], cwd);
	return new Promise((resolve) => {
		const socket = createConnection(handle, () => {
			socket.write(new Uint8Array([KILL]));
			socket.destroy();
			resolve('killed');
		});
		socket.once('error', () => resolve('not running'));
	});
}

async function stopDaemonAndWait(name: string, cwd: string): Promise<'killed' | 'not running'> {
	const result = await stopDaemon(name, cwd);
	if (result === 'killed') {
		// Wait for the daemon to fully exit so its socket becomes non-connectable.
		// Without this, an immediate re-run of --stop can connect to the dying
		// daemon and falsely report another kill.
		for (let i = 0; i < 20; i++) {
			const status = await checkDaemon(name, cwd);
			if (status === 'stopped') { break; }
			await new Promise((r) => setTimeout(r, 100));
		}
	}
	return result;
}

function getWorktrees(): { path: string; branch: string }[] {
	const output = execSync('git worktree list --porcelain', { encoding: 'utf-8' });
	const worktrees: { path: string; branch: string }[] = [];
	let current: { path?: string; branch?: string } = {};
	for (const line of output.split('\n')) {
		if (line.startsWith('worktree ')) {
			current = { path: line.slice('worktree '.length) };
		} else if (line.startsWith('branch ')) {
			current.branch = line.slice('branch '.length).replace('refs/heads/', '');
		} else if (line === '' && current.path) {
			worktrees.push({ path: current.path, branch: current.branch || '(detached)' });
			current = {};
		}
	}
	if (current.path) {
		worktrees.push({ path: current.path, branch: current.branch || '(detached)' });
	}
	return worktrees;
}

type WorktreeState = 'stopped' | 'starting' | 'ready';

function getWorktreeStateValue(daemons: Record<string, DaemonInfo>): WorktreeState {
	const infos = Object.values(daemons);
	const allStopped = infos.every(i => i.status === 'stopped');
	if (allStopped) { return 'stopped'; }
	const allCompiled = infos.every(i => i.status === 'stopped' || i.lastCompiled);
	if (allCompiled) { return 'ready'; }
	return 'starting';
}

function getWorktreeStateDisplay(daemons: Record<string, DaemonInfo>): string {
	const state = getWorktreeStateValue(daemons);
	if (state !== 'starting') { return `[${state}]`; }
	const infos = Object.values(daemons);
	const startingDaemons = infos.filter(i => i.status === 'running' && !i.lastCompiled);
	const maxUptimeMs = Math.max(...startingDaemons.map(i => i.uptimeMs || 0));
	const duration = maxUptimeMs > 0 ? ` ${formatUptime(maxUptimeMs)}` : '';
	return `[starting${duration}]`;
}

const allMode = process.argv.includes('--all');
const jsonMode = process.argv.includes('--json');
const stopMode = process.argv.includes('--stop');
const worktrees = allMode ? getWorktrees() : [{ path: process.cwd(), branch: '' }];

if (stopMode) {
	const allResults = await Promise.all(
		worktrees.map(async (wt) => {
			const statuses = await Promise.all(
				DAEMONS.map((name) => stopDaemonAndWait(name, wt.path))
			);
			const daemons: Record<string, string> = {};
			for (let i = 0; i < DAEMONS.length; i++) {
				daemons[DAEMONS[i]] = statuses[i];
			}
			return { worktree: wt.path, branch: wt.branch, daemons };
		})
	);

	for (const { worktree, branch, daemons } of allResults) {
		if (allMode) {
			// allow-any-unicode-next-line
			console.log(`\n${basename(worktree)} (${branch})\n${'─'.repeat(50)}`);
		}
		for (const name of DAEMONS) {
			if (daemons[name] === 'killed') {
				console.log(`[${name}] killed`);
			}
		}
	}
} else {
	const table = parseProcessTable();
	const allResults = await Promise.all(
		worktrees.map(async (wt) => {
			const infos = await Promise.all(
				DAEMONS.map((name) => getDaemonInfo(name, wt.path, table))
			);
			const daemons: Record<string, DaemonInfo> = {};
			for (let i = 0; i < DAEMONS.length; i++) {
				daemons[DAEMONS[i]] = infos[i];
			}
			return { worktree: wt.path, branch: wt.branch, daemons };
		})
	);

	if (jsonMode) {
		const jsonOutput = allResults.map(({ worktree, branch, daemons }) => ({
			worktree, branch, daemons,
			state: getWorktreeStateValue(daemons),
		}));
		console.log(JSON.stringify(jsonOutput, null, 2));
	} else {
		for (const { worktree, branch, daemons } of allResults) {
			const worktreeState = getWorktreeStateDisplay(daemons);
			if (allMode) {
				// allow-any-unicode-next-line
				console.log(`\n${basename(worktree)} (${branch}) ${worktreeState}\n${'─'.repeat(60)}`);
			} else {
				console.log(worktreeState);
			}
			console.log(`${'DAEMON'.padEnd(25)} ${'STATUS'.padEnd(10)} ${'UPTIME'.padEnd(10)} ${'RAM'.padEnd(8)} ${'CPU'.padEnd(8)} LAST COMPILED`);
			for (const name of DAEMONS) {
				const info = daemons[name];
				const uptime = info.uptime || '-';
				const lastCompiled = info.lastCompiled || '-';
				const rss = info.rss || '-';
				const cpu = info.cpu || '-';
				console.log(`${name.padEnd(25)} ${info.status.padEnd(10)} ${uptime.padEnd(10)} ${rss.padEnd(8)} ${cpu.padEnd(8)} ${lastCompiled}`);
			}
		}
	}
}
