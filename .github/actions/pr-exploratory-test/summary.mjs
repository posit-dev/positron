/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Writes the run's target line from a job that finishes in seconds. A job's
// summary only shows once the job ends, so explore's own would not name the
// PR until the run is over.

import { appendFileSync } from 'node:fs';
import { parseTimeLimit, renderSummaryTarget } from './lib.mjs';

const line = renderSummaryTarget(process.env.BRANCH, process.env.GITHUB_REPOSITORY, process.env.PR_NUMBER, process.env.FOCUS, parseTimeLimit(process.env.TIME_LIMIT));
console.log(line.trim() || 'No target to summarize');
if (line && process.env.GITHUB_STEP_SUMMARY) {
	appendFileSync(process.env.GITHUB_STEP_SUMMARY, line);
}
