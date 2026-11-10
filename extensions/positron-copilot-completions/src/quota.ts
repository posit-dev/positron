/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CopilotQuota, QuotaSnapshot } from './client.js';

/**
 * Combine a pushed quota update with what is already known. A push may leave
 * out buckets, the reset date, and whether token-based billing is on, so
 * those keep their earlier values.
 */
export function mergeQuota(previous: CopilotQuota | undefined, next: CopilotQuota): CopilotQuota {
	return {
		plan: next.plan ?? previous?.plan,
		tokenBasedBilling: next.tokenBasedBilling ?? previous?.tokenBasedBilling,
		resetDate: next.resetDate ?? previous?.resetDate,
		chat: next.chat ?? previous?.chat,
		completions: next.completions ?? previous?.completions,
		premiumInteractions: next.premiumInteractions ?? previous?.premiumInteractions,
	};
}

/**
 * The status bar tooltip: the status message, followed by the quotas that
 * apply to the user's plan, if known.
 */
export function createStatusTooltip(message: string, quota: CopilotQuota | undefined): string | vscode.MarkdownString {
	if (!quota) {
		return message;
	}

	// Like the server's own quota warnings: Free plans are limited by chat
	// and completions, paid plans by premium requests (or AI credits).
	const buckets: [string, QuotaSnapshot | undefined][] = quota.plan === 'free'
		? [
			[vscode.l10n.t('Completions'), quota.completions],
			[vscode.l10n.t('Chat'), quota.chat],
		]
		: [
			[vscode.l10n.t('Completions'), quota.completions],
			[quota.tokenBasedBilling ? vscode.l10n.t('AI credits') : vscode.l10n.t('Premium requests'), quota.premiumInteractions],
		];
	const shown = buckets.filter((entry): entry is [string, QuotaSnapshot] => entry[1] !== undefined);
	if (shown.length === 0) {
		return message;
	}

	const tooltip = new vscode.MarkdownString();
	tooltip.appendText(message);
	tooltip.appendMarkdown('\n\n');
	for (const [label, snapshot] of shown) {
		tooltip.appendMarkdown('- ');
		tooltip.appendText(describeSnapshot(label, snapshot));
		tooltip.appendMarkdown('\n');
	}
	const resetDate = quota.resetDate && shown.some(([, snapshot]) => !snapshot.unlimited)
		? formatDate(quota.resetDate)
		: undefined;
	if (resetDate) {
		tooltip.appendMarkdown('\n');
		tooltip.appendText(vscode.l10n.t('Resets on {0}', resetDate));
	}
	return tooltip;
}

function describeSnapshot(label: string, snapshot: QuotaSnapshot): string {
	if (snapshot.unlimited) {
		return vscode.l10n.t('{0}: unlimited', label);
	}
	if (snapshot.percentRemaining <= 0 && snapshot.overageEnabled) {
		return vscode.l10n.t('{0}: included amount used, now on paid usage', label);
	}
	const remaining = formatPercent(snapshot.percentRemaining);
	if (snapshot.entitlement !== undefined && snapshot.used !== undefined) {
		return vscode.l10n.t('{0}: {1} of {2} used ({3} left)', label, formatNumber(snapshot.used), formatNumber(snapshot.entitlement), remaining);
	}
	return vscode.l10n.t('{0}: {1} left', label, remaining);
}

function formatNumber(value: number): string {
	return new Intl.NumberFormat(vscode.env.language, { maximumFractionDigits: 1 }).format(value);
}

function formatPercent(percent: number): string {
	return new Intl.NumberFormat(vscode.env.language, { style: 'percent', maximumFractionDigits: 0 }).format(percent / 100);
}

function formatDate(value: string): string | undefined {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return undefined;
	}
	// A bare date parses as midnight UTC; format it in UTC so it isn't shown
	// as the day before in time zones west of UTC.
	const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
	return date.toLocaleDateString(vscode.env.language, {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		timeZone: dateOnly ? 'UTC' : undefined,
	});
}
