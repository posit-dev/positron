/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Markdown to safe HTML, and the small text helpers the page, the lint and the
// action share.

import { Marked } from 'marked';

/** Escapes the characters that would otherwise open markup or close an attribute. */
export function escapeHtml(text) {
	return String(text ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * Returns a URL safe to put in an href or src, or null.
 *
 * A report is not trusted input. The agent writes it while reading a branch's
 * diff, its logs and its UI, so a hostile branch can get a string of its
 * choosing quoted into one -- and the page is published on a report domain
 * shared with every other run. Only http(s), mailto and relative paths
 * survive; `javascript:` and `data:` do not.
 */
export function safeUrl(url) {
	// Browsers ignore control characters and spaces inside a scheme, so
	// `java\nscript:` reaches the same place as `javascript:`. Strip them before
	// deciding what the scheme is, and keep the stripped form.
	const cleaned = String(url ?? '').replace(/[\u0000-\u0020]/g, '');
	if (!cleaned) {
		return null;
	}
	if (/^[a-z][a-z0-9+.-]*:/i.test(cleaned)) {
		return /^(?:https?|mailto):/i.test(cleaned) ? cleaned : null;
	}
	// No scheme, so a relative path. `//host/x` also lands here and resolves to
	// the page's scheme, which is https and already allowed.
	return cleaned;
}

/**
 * The one markdown parser the report uses, configured so nothing in a report
 * can inject markup.
 *
 * marked emits raw HTML verbatim and hrefs unfiltered by default. Every field
 * on the page goes through here, so this is the single place that has to be
 * right rather than each of the thirty call sites.
 */
const marked = new Marked({
	tokenizer: {
		// Only ~~ strikes through: a lone ~ is "about" (~L120), as on most pages but GitHub's.
		del(src) {
			if (/^~(?!~)/.test(src)) {
				return { type: 'text', raw: '~', text: '~' };
			}
			return false;
		},
	},
	renderer: {
		// Raw HTML in a report is something the agent transcribed, so it is text
		// to show, not markup to run.
		html(html) {
			return escapeHtml(html);
		},
		link(href, title, text) {
			const url = safeUrl(href);
			if (!url) {
				return text;
			}
			const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
			return `<a href="${escapeHtml(url)}"${titleAttr}>${text}</a>`;
		},
		image(href, title, text) {
			const url = safeUrl(href);
			if (!url) {
				return escapeHtml(text ?? '');
			}
			return `<img src="${escapeHtml(url)}" alt="${escapeHtml(text ?? '')}" loading="lazy">`;
		},
	},
});

/** Inline markdown to HTML, for the contents of one line or cell. */
export function inline(text) {
	return marked.parseInline(String(text ?? '').trim());
}

/** The text escaped HTML stands for: the entities marked and escapeHtml write. */
export function unescapeHtml(html) {
	return String(html ?? '')
		.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

/** Inline markdown as plain text, for attributes such as a caption or label. */
export function plainText(text) {
	return unescapeHtml(inline(text).replace(/<[^>]*>/g, '')).trim();
}

/** Block markdown to HTML, for a run of lines that may hold lists or code. */
export function block(text) {
	return marked.parse(String(text ?? '').trim());
}

/** Package and tool names written in lowercase by convention; a sentence may start with one. */
export const LOWERCASE_NAMES = new Set(['pandas', 'polars', 'numpy', 'dplyr', 'ggplot2', 'tibble', 'data.table', 'pip', 'uv', 'pak', 'renv', 'reticulate', 'ipykernel', 'matplotlib', 'plotly', 'shiny', 'knitr', 'rmarkdown', 'rlang', 'tidyr', 'readr', 'purrr', 'scikit-learn', 'scipy', 'pyarrow', 'duckdb']);

/**
 * Capitalizes a cell that reads as a sentence.
 *
 * The findings table and Coverage are written as phrases continuing their
 * column header ("user waits 30 s"), but the redesign gives them their own
 * column where they read as statements. Skipped when the cell opens with code,
 * a link or a quote, where a forced capital would corrupt an identifier.
 */
export function sentenceCase(text) {
	const s = String(text ?? '');
	if (!/^[a-z]/.test(s)) {
		return s;
	}
	// A package name keeps its real case: dplyr, not Dplyr.
	if (LOWERCASE_NAMES.has(/^[a-z][\w.-]*/.exec(s)[0])) {
		return s;
	}
	// A bare identifier keeps its case: `polars frame` is prose, `df.copy()` is not.
	if (/^[a-z_][\w.]*\s*[(=[]/.test(s)) {
		return s;
	}
	return s[0].toUpperCase() + s.slice(1);
}

/**
 * A precondition that says nothing but "defaults" is not a precondition.
 *
 * The skill makes the agent state where the finding sits on the configuration
 * axis every time, which is worth keeping: a blank there could mean "needs
 * nothing" or "never checked". But once written, "Shipped defaults." on its own
 * is the absence of a condition, and printing it as a bullet asks the reader to
 * take in a line that tells them nothing. The same line qualified by how the
 * state was manufactured does tell them something, so it stays.
 */
const DEFAULTS_ONLY = /^(?:(?:the\s+)?(?:shipped|stock|product)\s+defaults?|defaults?|default\s+settings?|none)\s*[.!]?$/i;

export function isDefaultsOnly(text) {
	return DEFAULTS_ONLY.test(String(text ?? '').trim());
}

/** The filename at the end of a URL or path, for matching a hero to its caption. */
export function basename(url) {
	return String(url ?? '').split(/[?#]/)[0].split('/').pop();
}

/** A duration in whole minutes, for a run's footer. */
export function formatMinutes(ms) {
	const m = Math.round(ms / 60000);
	// A pass that took forty seconds did happen; "0m" reads as though it did not.
	return m === 0 ? '<1m' : `${m}m`;
}

/** `claude-opus-5-5` reads `Opus 5.5`. An id it does not recognise passes through. */
export function modelDisplayName(id) {
	if (!id) {
		return null;
	}
	// The alias a local run spawns its agents with.
	if (/^(?:opus|sonnet|haiku|fable)$/.test(id)) {
		return `${id[0].toUpperCase()}${id.slice(1)}`;
	}
	const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[[^\]]*\])?$/.exec(id);
	if (!m) {
		return id;
	}
	return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
}

/** A suggested case whose file does not exist yet: `(new file)`. */
export function isNewTestFile(testCase) {
	return /\bnew\b/i.test(testCase.note) && !/\bexists?\b/i.test(testCase.note);
}
