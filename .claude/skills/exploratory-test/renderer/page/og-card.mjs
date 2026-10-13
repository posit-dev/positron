/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The image chat apps show when a published report's link is pasted: one chip
// per severity with findings, from the og-card/ SVG templates.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'og-card');
// Bundled only, so every machine renders the same image.
const FONTS = ['IBMPlexSans-Regular.ttf', 'IBMPlexSans-SemiBold.ttf'].map(f => join(DIR, 'fonts', f));
const ORDER = ['major', 'moderate', 'minor'];

export const CARD_FILE = 'og.png';
export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/** Drops the chips with no findings, centres the rest, and sizes each count to fit its circle. */
export function fillCard(svg, counts) {
	const shown = ORDER.filter(k => (counts[k] || 0) > 0);
	const step = svg.match(/<g id="slots" data-step-x="(?<x>[\d.-]+)" data-step-y="(?<y>[\d.-]+)"/);
	if (!step) {
		throw new Error('card.svg: missing <g id="slots" data-step-x data-step-y>');
	}
	const stepX = Number(step.groups.x);
	const stepY = Number(step.groups.y);
	svg = svg.replace(/<g data-sev="(?<sev>\w+)">(?<body>[\s\S]*?)<\/g>\n/g, (...args) => {
		const { sev, body } = args.at(-1);
		const i = shown.indexOf(sev);
		if (i < 0) {
			return '';
		}
		const offset = i - (shown.length - 1) / 2;
		return `<g data-sev="${sev}" transform="translate(${offset * stepX} ${offset * stepY})">${body}</g>\n`;
	});
	// data-sizes lists the font size for 1, 2 and 3+ digits; the baseline moves with it.
	svg = svg.replace(/<text(?<pre>[^>]*?) data-sizes="(?<sizes>[\d. ]+)"(?<post>[^>]*)>\{(?<sev>major|moderate|minor)\}/g, (...args) => {
		const { pre, sizes, post, sev } = args.at(-1);
		const options = sizes.trim().split(/\s+/).map(Number);
		const size = options[Math.min(String(counts[sev] || 0).length, options.length) - 1];
		const attrs = (pre + post)
			.replace(/ font-size="[\d.]+"/, ` font-size="${size}"`)
			.replace(/ y="[\d.-]+"/, ` y="${Math.round(size * 0.355)}"`);
		return `<text${attrs}>{${sev}}`;
	});
	return svg.replace(/\{(?<sev>major|moderate|minor)\}/g, (...args) => String(counts[args.at(-1).sev] || 0));
}

/** The card as a PNG; with no findings, the "No findings" card. */
export async function renderCard(counts = {}) {
	const { Resvg } = await import('@resvg/resvg-js');
	const total = ORDER.reduce((n, k) => n + (counts[k] || 0), 0);
	const svg = total === 0
		? readFileSync(join(DIR, 'card-none.svg'), 'utf8')
		: fillCard(readFileSync(join(DIR, 'card.svg'), 'utf8'), counts);
	return new Resvg(svg, {
		font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'IBM Plex Sans' },
		fitTo: { mode: 'width', value: CARD_WIDTH },
	}).render().asPng();
}

/** Writes the card to `file`; false when it could not, so the page leaves the image out. */
export async function writeCard(file, counts) {
	try {
		writeFileSync(file, await renderCard(counts));
		return true;
	} catch (err) {
		console.error(`og-card: no link image, the page is published without one: ${err}`);
		return false;
	}
}
