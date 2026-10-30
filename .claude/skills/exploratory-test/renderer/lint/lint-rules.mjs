/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Every rule lint checks, by ID, with its severity. Errors make a repro or its
// evidence wrong, or leave the page unable to show it: they fail the check.
// Warnings are wording and length: worth fixing when quick, never worth
// another check. Stats count problems by ID, and RULES.md names the IDs.

export const LINT_RULES = {
	// report.json's findings against its schema and the ledger
	'schema': 'error',
	'no-ledger': 'error',
	'finding-not-in-ledger': 'error',
	'ledger-finding-missing': 'error',
	'finding-step-not-in-scenario': 'error',
	'finding-step-out-of-order': 'error',
	'finding-step-result': 'error',
	'finding-step-finding': 'error',
	'finding-rate': 'error',
	'evidence-found-and-missing': 'error',
	'header-empty': 'error',
	'feature-missing': 'error',
	'compiled-frames': 'warning',
	'shot-outside-shots': 'error',
	'shot-missing': 'error',
	// a step's or a VERIFY's words
	'verify-acts': 'warning',
	'fixed-wait': 'warning',
	'only-verify-steps': 'error',
	'first-step-escape': 'warning',
	'palette-row-unopened': 'error',
	'repeated-check': 'warning',
	'repeated-action': 'warning',
	'two-actions': 'warning',
	'step-scratch-path': 'error',
	'wait-only-step': 'error',
	'step-starts-with': 'warning',
	'session-id': 'error',
	'step-scenario-id': 'warning',
	// preconditions
	'precondition-runs-command': 'error',
	'precondition-done-in-app': 'error',
	'precondition-running-app': 'error',
	'precondition-the-runs': 'error',
	'precondition-scratch-path': 'error',
	'precondition-step-reference': 'warning',
	'precondition-ui-action': 'warning',
	'precondition-setting-form': 'warning',
	'precondition-setting-file': 'warning',
	'precondition-needs-name': 'warning',
	'precondition-name-length': 'warning',
	// a finding's title, Observed and Expected, and the Result
	'comparison-length': 'warning',
	'title-lowercase': 'warning',
	'title-code': 'warning',
	'title-hedge': 'warning',
	'title-possessive': 'warning',
	'title-parenthetical': 'warning',
	'code-name': 'warning',
	'semicolon': 'warning',
	'judgment-word': 'warning',
	'reference-in-observed': 'warning',
	'digit-grouping': 'warning',
	'result-answers-question': 'warning',
	'result-length': 'warning',
	'severity-value': 'error',
	'rate-format': 'error',
	'tried-once': 'warning',
	'feature-code-name': 'error',
	'points-at-finding': 'error',
	'finding-scenario-id': 'error',
	'cause-lead-length': 'warning',
	'impact-missing': 'error',
	'impact-length': 'warning',
	// screenshots and evidence on a finding
	'shot-no-step': 'error',
	'shot-unknown-scenario': 'error',
	'shot-scenario-uncited': 'error',
	'too-many-shots': 'warning',
	'second-shot-caption': 'warning',
	'evidence-note': 'error',
	'evidence-run-file': 'error',
	'evidence-trailing-note': 'error',
	'log-process-mismatch': 'warning',
	'test-file-missing': 'error',
	'absolute-path': 'error',
	// the ledger
	'ledger-step-scenario-id': 'warning',
	'evidence-file-missing': 'error',
	'evidence-shot-missing': 'error',
	'scenario-id-reused': 'error',
	'status-missing': 'error',
	'status-format': 'error',
	'status-unknown-finding': 'error',
	'failed-result-rate': 'warning',
	'scenario-fails-other-finding': 'error',
	'scenario-no-verify': 'error',
	'result-too-long': 'warning',
	'verify-no-shot': 'error',
	'fail-missing-fields': 'error',
	'shot-cited-twice': 'error',
	'shot-scenario-mismatch': 'error',
	'environment-missing': 'error',
	'environment-first-line': 'error',
	'not-exercised-unlisted': 'error',
	// test files
	'files-outside-files': 'error',
	'files-listed-missing': 'error',
	'files-named-unlisted': 'error',
	'files-saved-unlisted': 'error',
	'file-named-twice': 'warning',
	'file-name-ambiguous': 'error',
	'file-not-saved': 'error',
	// issues linked to the PR
	'issue-line-format': 'error',
	'issue-not-linked': 'error',
	'issue-fix-kind': 'error',
	'issue-linked-kind': 'error',
	'issue-closed-observed': 'error',
	'issue-open-came-back': 'error',
	'issue-needs-finding': 'error',
	'not-run-issue-not-linked': 'error',
	'not-run-issue-kind': 'error',
	'fix-not-accounted': 'error',
	// actions.log and the shots it took
	'log-unstamped': 'error',
	'log-backdated': 'error',
	'log-other-session': 'warning',
	'shot-name-unlogged': 'error',
	'shot-retaken-in-place': 'warning',
	'shot-retaken': 'error',
	'shot-out-of-order': 'error',
	'shot-no-crop': 'warning',
};

/** One lint problem: its rule, that rule's severity, the line shown, and anything else the caller keys it by. */
export function problem(rule, text, extra = {}) {
	const severity = LINT_RULES[rule];
	if (!severity) {
		throw new Error(`unknown lint rule: ${rule}`);
	}
	return { rule, severity, text, ...extra };
}

/** Problems split into the errors to fix before the report is done and the warnings to fix if quick. */
export function splitProblems(problems) {
	return { errors: problems.filter(p => p.severity !== 'warning'), warnings: problems.filter(p => p.severity === 'warning') };
}
