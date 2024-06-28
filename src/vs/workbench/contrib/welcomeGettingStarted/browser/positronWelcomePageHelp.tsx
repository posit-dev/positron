/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import "vs/css!./media/positronGettingStarted";

// React.
import * as React from "react";
import { PropsWithChildren } from "react"; // eslint-disable-line no-duplicate-imports

import { ExternalLink } from "vs/base/browser/ui/ExternalLink/ExternalLink";
import { IOpenerService } from "vs/platform/opener/common/opener";
import { localize } from "vs/nls";

export interface PositronWelcomePageHelpProps {
	openerService: IOpenerService;
}

export const PositronWelcomePageHelp = (
	props: PropsWithChildren<PositronWelcomePageHelpProps>
) => {
	const buildLinks = () => {
		return (
			<div className="welcome-help-links">
				<ExternalLink
					href="https://github.com/posit-dev/positron/wiki"
					openerService={props.openerService}
				>
					{localize(
						"positron.welcome.positronDocumentation",
						"Positron Documentation"
					)}
				</ExternalLink>
				<ExternalLink
					href="https://github.com/posit-dev/positron/discussions"
					openerService={props.openerService}
				>
					Positron Community
				</ExternalLink>
				<ExternalLink
					href="https://github.com/posit-dev/positron/issues"
					openerService={props.openerService}
				>
					Report a bug
				</ExternalLink>
			</div>
		);
	};

	const links = buildLinks();

	// Render.
	return (
		<div className="positron-welcome-page-help welcome-page-section">
			<h2>Help</h2>
			{links}
		</div>
	);
};
