/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * On-demand guidance documents served by the `get-guidance` tool.
 *
 * The tool is answered entirely by the main-process server (no window round
 * trip -- see PositronMcpSession), so the content lives here as constants in
 * `common`. The catalog rides in the tool description because clients re-send
 * tool definitions with every request and never compact them; the bodies are
 * loaded only when the model asks, keeping their always-on context cost at
 * zero. Ported from Posit Assistant's bundled data-analysis skills.
 */

import { IMcpCallToolResult, IPositronMcpToolDescriptor } from './positronMcpTools.js';

/** One guidance document: a topic key, a catalog summary, and the markdown body. */
export interface IPositronMcpGuide {
	readonly topic: string;
	/** One-line summary shown in the get-guidance tool's catalog. */
	readonly summary: string;
	/** The markdown guidance returned by the tool. */
	readonly body: string;
}

/** The guides get-guidance serves, in catalog order. */
export const POSITRON_MCP_GUIDES: readonly IPositronMcpGuide[] = [
	{
		topic: 'data-analysis-r',
		summary: 'How to analyze, explore, and visualize data in R the way Posit does: statistical rigor and collaboration norms, tidyverse and base-pipe style, ggplot2 conventions, data-exploration recipes, missing data, inferential statistics, and reading package documentation as text.',
		body: `# Data analysis in R (Positron)

Run all R with the \`execute-code\` tool so it executes in the user's live session
(see that tool's description).

## Approach and rigor

Navigate data analysis with openness to uncertainty and a commitment to
statistical rigor. Rather than maintaining a feeling of "moving forward," call
out ambiguities and unclear results. Use language proportional to the evidence --
avoid describing a pattern as "clear," "striking," or "strong" unless it
genuinely warrants it. In exploratory work, understanding the data and its
context thoroughly matters more than "finishing." For inference or modeling,
careful and correct steps matter more than being exhaustive.

## Collaborating with the user

- **Exploratory tasks** (the user wants to _understand_ something -- "explore
	this data," "what patterns exist?"): do a small amount of work, present what
	you found, and offer 2-3 concrete next steps phrased as directives (e.g.
	"Examine the residuals more closely."). Let the user steer rather than running
	ahead.
- **Deliverable tasks** (a specific artifact -- "make a bar chart of X," "test
	whether X and Y differ"): complete them fully without artificial check-ins,
	and don't expand scope beyond what was asked.
- If the user asks to look at data but doesn't say which dataset, ask first.
- Don't guess at decisions the user could clarify (which subset is the test set,
	whether to drop or impute missing values) -- stop and ask.

## Writing R

- \`library()\` the packages you need.
- Use the base R pipe \`|>\`; don't use the magrittr pipe unless asked.
- Keep comments brief -- skip narration, and comment only when the _reason_ isn't
	obvious. In a pipeline, put the comment on the line before the code:
	\`\`\`r
	df |>
		# Filter to recent observations
		filter(year == 2026) |>
		...
	\`\`\`
- Don't assign results to variables unless you'll need them later -- every
	assignment persists in the user's global environment. Prefer \`nrow(x)\` over
	\`nrow_x <- nrow(x); nrow_x\`.
- Building a Shiny app? Use \`bslib\` for UI and theming.
- When installing packages, don't set \`repos\` -- assume the user's repositories
	are configured as they intend.

## Visualization

- Default to **ggplot2**.
- Return plots directly -- **do not** assign to an intermediate like \`p <- ggplot(...)\`.
- Your first pass should be minimally sufficient; skip extra theming and modeled
	layers (e.g. \`geom_smooth()\`) unless the user asks.
- For a standalone plot, pass the data first: \`ggplot(df, aes(...))\`, not
	\`df |> ggplot(aes(...))\`.
- Avoid \`coord_flip()\`; flip the aesthetic mapping instead (e.g. \`aes(y = manufacturer)\`).
- Don't set arbitrary \`fill\`/\`color\` when there's no color mapping.
- Avoid dual encoding -- don't map one variable to multiple aesthetics.
- For quantities over time, prefer line plots; use bars for counts or aggregates
	over discrete intervals.

## Exploring data

\`\`\`r
library(tidyverse)

# First look.
head(df)

# Distinct values per column (useful for categoricals).
df |> summarise(across(everything(), n_distinct))

# Missing values per column.
df |> summarise(across(everything(), ~sum(is.na(.))))

# Frequencies for a categorical column.
df |> count(categorical_column_name)
\`\`\`

To display a data frame, just evaluate it (\`df\`) -- not \`print(df)\` or \`kable(df)\`.

If the data lives in a remote store, run as much of the pipeline remotely as
possible and only collect locally at the end.

## Missing data

- Watch for \`NA\`; when it appears, be curious about where it came from and call
	the user's attention to it.
- Detect missingness early (\`is.na()\`).
- To find its source, look for correlations between missingness and other
	columns' values, and inspect sample rows containing \`NA\` for patterns.

## Inferential statistics

Refrain from running statistical tests unless asked -- excessive testing inflates
the risk of spurious findings. When you do:

- Don't run a parametric test without reasonable belief that its assumptions hold
	(or checking them). If they're questionable, say so.
- Flag statistical concerns (many tests without correction, a test inappropriate
	for the data).
- Report the test used and why, the statistic with a confidence interval or
	effect size, and a plain-language interpretation. If a result is borderline or
	assumptions are violated, say so.

\`\`\`r
# t-test
library(infer)
df |> t_test(outcome ~ group, order = c("A", "B"))

# Chi-squared test
data |> chisq_test(var1 ~ var2)

# One-way ANOVA
aov(y ~ x, data = data_clean) |> broom::tidy()
\`\`\`

## Reading R package documentation

\`?fn\` and \`help()\` render in the user's Help pane rather than returning text.
To get docs as text:

| What             | How                                                                        |
| ---------------- | -------------------------------------------------------------------------- |
| Function help    | \`tools::Rd2txt(utils:::.getHelpFile(help(fn, package = "pkg")))\`           |
| List help topics | \`library(help = "pkg", character.only = TRUE)\$info[[2]]\`                   |
| List vignettes   | \`library(help = "pkg", character.only = TRUE)\$info[[3]]\`                   |
| Read a vignette  | \`v <- vignette("name", "pkg"); readLines(file.path(v\$Dir, "doc", v\$File))\` |`,
	},
	{
		topic: 'data-analysis-python',
		summary: 'How to analyze, explore, and visualize data in Python the way Posit does: statistical rigor and collaboration norms, choosing a data-frame library (polars vs pandas), data-exploration recipes, missing data, and inferential statistics with scipy.',
		body: `# Data analysis in Python (Positron)

Run all Python with the \`execute-code\` tool so it executes in the user's live
session (see that tool's description).

## Approach and rigor

Navigate data analysis with openness to uncertainty and a commitment to
statistical rigor. Rather than maintaining a feeling of "moving forward," call
out ambiguities and unclear results. Use language proportional to the evidence --
avoid describing a pattern as "clear," "striking," or "strong" unless it
genuinely warrants it. In exploratory work, understanding the data and its
context thoroughly matters more than "finishing." For inference or modeling,
careful and correct steps matter more than being exhaustive.

## Collaborating with the user

- **Exploratory tasks** (the user wants to _understand_ something -- "explore
	this data," "what patterns exist?"): do a small amount of work, present what
	you found, and offer 2-3 concrete next steps phrased as directives (e.g.
	"Examine the residuals more closely."). Let the user steer rather than running
	ahead.
- **Deliverable tasks** (a specific artifact -- "make a bar chart of X," "test
	whether X and Y differ"): complete them fully without artificial check-ins,
	and don't expand scope beyond what was asked.
- If the user asks to look at data but doesn't say which dataset, ask first.
- Don't guess at decisions the user could clarify (which subset is the test set,
	whether to drop or impute missing values) -- stop and ask.

## Writing Python

- \`import\` the packages you need. Avoid wildcard imports, except where it's
	common practice (e.g. plotnine).
- Use the data-manipulation library the project prefers. Before writing polars
	or pandas code, either have a good sense of which the user/project uses (from
	installed packages, existing code, existing data frames, imports, or explicit
	mention), or ask.

## Exploring data

\`\`\`python
import polars as pl

# First look.
df.head()

# Distinct values per column (useful for categoricals).
df.select(pl.all().n_unique())

# Missing values per column.
df.select(pl.all().null_count())

# Frequencies for a categorical column.
df.group_by("categorical_column_name").agg(pl.len())

# Distribution of a numeric column.
df.get_column("numeric_column_name").describe()
\`\`\`

To display a data frame, just evaluate it (\`df\`) for the optimal rendering.

If the data lives in a remote store, run as much of the pipeline remotely as
possible and only collect locally at the end.

## Missing data

- Watch for \`null\`; when it appears, be curious about where it came from and call
	the user's attention to it.
- Detect missingness early (\`is_null\` in polars).
- To find its source, look for correlations between missingness and other
	columns' values, and inspect sample rows containing nulls for patterns.

## Inferential statistics

Refrain from running statistical tests unless asked -- excessive testing inflates
the risk of spurious findings. When you do:

- Don't run a parametric test without reasonable belief that its assumptions hold
	(or checking them). If they're questionable, say so.
- Flag statistical concerns (many tests without correction, a test inappropriate
	for the data).
- Report the test used and why, the statistic with a confidence interval or
	effect size, and a plain-language interpretation. If a result is borderline or
	assumptions are violated, say so.

\`\`\`python
from scipy import stats

# t-test
stats.ttest_ind(group_a, group_b)

# Chi-squared test
stats.chi2_contingency(contingency_table)

# One-way ANOVA
stats.f_oneway(group1, group2, group3)
\`\`\``,
	},
];

/**
 * The get-guidance tool descriptor. Deliberately not part of
 * {@link POSITRON_MCP_TOOLS}: that list is the window-routed set the renderer
 * binds handlers to, while this tool is answered by the main process
 * (PositronMcpSession serves it directly, so it works with every window
 * closed). The session appends it at tools/list time.
 */
export const GET_GUIDANCE_TOOL: IPositronMcpToolDescriptor = {
	name: 'get-guidance',
	description: 'Load Posit\'s curated guidance for a kind of task before starting one it covers, and follow it. Call this before your first data-analysis, plotting, data-cleaning, or statistics task in a conversation, picking the guide that matches the session\'s language; re-load a guide if its content has scrolled out of view. Available guides:\n'
		+ POSITRON_MCP_GUIDES.map(guide => `- ${guide.topic}: ${guide.summary}`).join('\n'),
	inputSchema: {
		type: 'object',
		properties: {
			topic: {
				type: 'string',
				enum: POSITRON_MCP_GUIDES.map(guide => guide.topic),
				description: 'The guide to load.',
			},
		},
		required: ['topic'],
		additionalProperties: false,
	},
	annotations: { readOnlyHint: true, idempotentHint: true },
};

/** Serve a get-guidance call: the guide's body, or an error naming the valid topics. */
export function getGuidance(args: Record<string, unknown>): IMcpCallToolResult {
	const guide = POSITRON_MCP_GUIDES.find(candidate => candidate.topic === args.topic);
	if (!guide) {
		const topics = POSITRON_MCP_GUIDES.map(candidate => candidate.topic).join(', ');
		return {
			content: [{ type: 'text', text: `Unknown guidance topic ${JSON.stringify(args.topic)}. Available topics: ${topics}.` }],
			isError: true,
		};
	}
	return { content: [{ type: 'text', text: guide.body }] };
}
