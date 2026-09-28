/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Turn a raw Playwright capture into a shippable demo clip: trim the startup, crop the letterbox,
 * and convert to MP4.
 *
 * All three of those were manual steps with hand-derived magic numbers. The trim point comes from
 * the black sentinel `startDemo()` holds and the end time from the manifest, so neither has to be
 * found by reading frames. The crop is measured from an actual frame because the capture canvas
 * is 1920x1080 while the window is whatever the window is, leaving a gray (not black) bar that
 * ffmpeg's own `cropdetect` will not find.
 *
 *   npm run demo:postprocess -- [--name <demo-name>] [--keep-webm]
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const DEMO_DIR = path.resolve(path.dirname(process.argv[1]), '../../../demo-videos');

/** Seconds held after the last recorded activity, so the final caption is not clipped. */
const TAIL_SECONDS = 0.8;

function main(): void {
	const args = process.argv.slice(2);
	const name = argValue(args, '--name') ?? newestManifestName();
	const keepWebm = args.includes('--keep-webm');

	if (!name) {
		fail(`No demo manifest found in ${DEMO_DIR}. Record with DEMO_RECORD_VIDEO=1 first.`);
	}

	const manifestFile = path.join(DEMO_DIR, `${name}.manifest.json`);
	if (!fs.existsSync(manifestFile)) {
		fail(`No manifest at ${manifestFile}.`);
	}
	const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'));

	const webm = newestWebm();
	if (!webm) {
		fail(`No .webm capture in ${DEMO_DIR}.`);
	}

	const duration = (manifest.endedAtMs ?? 0) / 1000 + TAIL_SECONDS;
	const total = probeDuration(webm);

	// The crop has to be measured before the trim, not after: `blackdetect` scores blackness over
	// the whole frame, and the gray letterbox around the window keeps a full-viewport black
	// sentinel at roughly 80% of the canvas -- under any useful threshold. Measuring from a frame
	// near the end is safe because the window geometry does not change mid-recording.
	const crop = measureContentRegion(webm, Math.max(0, total - 1));
	const start = findSentinelEnd(webm, (manifest.sentinelMs ?? 300) / 1000, crop, total, duration);

	const out = path.join(DEMO_DIR, `${name}.mp4`);
	run('ffmpeg', [
		'-y',
		'-ss', start.toFixed(2),
		'-t', duration.toFixed(2),
		'-i', webm,
		'-vf', `crop=${crop.w}:${crop.h}:0:0`,
		'-c:v', 'libx264', '-crf', '20', '-preset', 'slow',
		'-pix_fmt', 'yuv420p', '-an',
		out,
	]);

	if (!keepWebm) {
		fs.rmSync(webm, { force: true });
	}

	const sizeMb = (fs.statSync(out).size / 1024 / 1024).toFixed(2);
	console.log('');
	console.log(`  ${out}`);
	console.log(`  ${duration.toFixed(1)}s  ${crop.w}x${crop.h}  ${sizeMb} MB`);
	if (Number(sizeMb) > 10) {
		console.log('  Over GitHub\'s 10 MB limit for free accounts; shorten the demo or raise -crf.');
	}
	console.log('');
	for (const mark of manifest.marks ?? []) {
		console.log(`  ${formatClock(mark.atMs / 1000)}  ${mark.caption}`);
	}
	console.log('');
}

/**
 * Find where the start-of-demo sentinel clears. The capture also opens on black while the window
 * paints, so prefer the interval whose length matches the sentinel and which is not at t=0.
 */
function findSentinelEnd(
	video: string,
	expectedSeconds: number,
	crop: { w: number; h: number },
	total: number,
	duration: number,
): number {
	const output = run('ffmpeg', [
		'-i', video,
		'-vf', `crop=${crop.w}:${crop.h}:0:0,blackdetect=d=0.1:pic_th=0.98:pix_th=0.10`,
		'-an', '-f', 'null', '-',
	], { captureStderr: true });

	const intervals = [...output.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)]
		.map(m => ({ start: Number(m[1]), end: Number(m[2]) }))
		.filter(i => i.start > 1);

	if (intervals.length > 0) {
		intervals.sort((a, b) =>
			Math.abs((a.end - a.start) - expectedSeconds) - Math.abs((b.end - b.start) - expectedSeconds));
		return intervals[0].end;
	}

	// Falling back to 0 would silently ship the startup sequence as the demo. The capture ends
	// when the test does, so working backwards from the end lands close enough to be recognizable
	// as a near miss rather than as a completely different video.
	const guess = Math.max(0, total - duration);
	console.log(`  No sentinel found (demo recorded without startDemo?); guessing ${guess.toFixed(1)}s. Check the result.`);
	return guess;
}

/**
 * Measure the live region of the frame by scanning in from the right and bottom edges for a run
 * of uniform rows/columns. Returns even dimensions, which h264 requires.
 */
function measureContentRegion(video: string, atSeconds: number): { w: number; h: number } {
	const { width, height } = probeDimensions(video);
	const raw = run('ffmpeg', [
		'-ss', atSeconds.toFixed(2),
		'-i', video,
		'-frames:v', '1',
		'-pix_fmt', 'gray',
		'-f', 'rawvideo', '-',
	], { binary: true });

	if (raw.length < width * height) {
		return { w: even(width), h: even(height) };
	}

	const pad = raw[(height - 1) * width + (width - 1)];
	const columnIsPad = (x: number): boolean => {
		for (let y = 0; y < height; y++) {
			if (raw[y * width + x] !== pad) { return false; }
		}
		return true;
	};
	const rowIsPad = (y: number): boolean => {
		for (let x = 0; x < width; x++) {
			if (raw[y * width + x] !== pad) { return false; }
		}
		return true;
	};

	let w = width;
	while (w > 1 && columnIsPad(w - 1)) { w--; }
	let h = height;
	while (h > 1 && rowIsPad(h - 1)) { h--; }

	// A measurement that throws away half the frame is more likely a dark frame than a letterbox.
	if (w < width * 0.5 || h < height * 0.5) {
		return { w: even(width), h: even(height) };
	}
	return { w: even(w), h: even(h) };
}

function probeDuration(video: string): number {
	const out = run('ffprobe', [
		'-v', 'error',
		'-show_entries', 'format=duration',
		'-of', 'csv=p=0',
		video,
	]);
	return Number(out.trim()) || 0;
}

function probeDimensions(video: string): { width: number; height: number } {
	const out = run('ffprobe', [
		'-v', 'error',
		'-select_streams', 'v:0',
		'-show_entries', 'stream=width,height',
		'-of', 'csv=p=0',
		video,
	]);
	const [width, height] = out.trim().split(',').map(Number);
	return { width, height };
}

function newestWebm(): string | null {
	return newestFile(f => f.endsWith('.webm'));
}

function newestManifestName(): string | null {
	const file = newestFile(f => f.endsWith('.manifest.json'));
	return file ? path.basename(file).replace(/\.manifest\.json$/, '') : null;
}

function newestFile(predicate: (f: string) => boolean): string | null {
	if (!fs.existsSync(DEMO_DIR)) {
		return null;
	}
	const files = fs.readdirSync(DEMO_DIR)
		.filter(predicate)
		.map(f => path.join(DEMO_DIR, f))
		.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
	return files[0] ?? null;
}

function run(cmd: string, args: string[], options: { captureStderr?: boolean; binary?: boolean } = {}): any {
	const result = spawnSync(cmd, args, {
		maxBuffer: 1024 * 1024 * 512,
		stdio: ['ignore', 'pipe', 'pipe'],
	});

	if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
		fail(`${cmd} not found on PATH. Install it (brew install ffmpeg) and re-run.`);
	}
	// blackdetect reports on stderr, so that output is the result rather than a failure.
	if (options.captureStderr) {
		return result.stderr.toString();
	}
	if (result.status !== 0) {
		fail(`${cmd} failed:\n${result.stderr.toString().split('\n').slice(-12).join('\n')}`);
	}
	return options.binary ? result.stdout : result.stdout.toString();
}

function argValue(args: string[], flag: string): string | null {
	const i = args.indexOf(flag);
	return i >= 0 ? args[i + 1] : null;
}

const even = (n: number): number => (n % 2 === 0 ? n : n - 1);

const formatClock = (seconds: number): string =>
	`${String(Math.floor(seconds / 60)).padStart(2, '0')}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;

function fail(message: string): never {
	console.error(`postprocess-demo-video: ${message}`);
	process.exit(1);
	throw new Error(message);
}

main();
