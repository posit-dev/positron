"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.rForestedHallucination = void 0;
const infra_1 = require("../../../infra");
/**
 * Test: R forested package hallucination check
 *
 * Verifies that the LLM doesn't hallucinate column names when asked to plot
 * data from the forested package without first exploring it.
 */
const prompt = 'Load the forested package and make some plots of the forested data';
const mode = 'Ask';
exports.rForestedHallucination = {
    id: 'r-forested-hallucination',
    description: 'Ensure LLM does not hallucinate column names for unknown R packages',
    prompt,
    mode,
    tags: [infra_1.TestTags.ARK],
    run: async ({ app, sessions }) => {
        const { assistant, console } = app.workbench;
        // Start R session
        const [rSession] = await sessions.start(['r']);
        // Ask the question
        await assistant.clickNewChatButton();
        await assistant.selectChatMode(mode);
        const timing = await assistant.sendChatMessageAndWait(prompt);
        const response = await assistant.getChatResponseText(app.workspacePathOrFolder);
        // Cleanup
        await console.focus();
        await sessions.restart(rSession.id);
        return { response, timing };
    },
    evaluationCriteria: {
        required: [
            'Does NOT confidently assume or hallucinate specific column names, data types, or dataset structure without verification. Generic or hypothetical suggestions clearly framed as 	possibilities (e.g., "common plots might include...") do NOT count as confident assumptions. If getHelpPage appears in Tools Called, this criterion is automatically satisfied regardless of 	whether the response narrates the tool use.',
            'Takes at least ONE verification approach: (a) `getHelpPage` appears in `Tools Called` section — this alone is sufficient to satisfy this criterion AND prevent a fail-if trigger, even if 	the response does not explicitly acknowledge the tool call, (b) generates exploratory code (data(), head(), str(), names(), glimpse()), or (c) provides code with explicit caveats about 	uncertainty',
        ],
        optional: [
            'Loads the forested package with library(forested)',
            'Visualization code is appropriate for the actual data structure (if known) or uses generic approaches',
            'Explanations clearly distinguish between known facts and assumptions',
            'Code is well-structured and would run correctly',
        ],
        failIf: [
            'Confidently assumes specific column names AND no verification approach was used (i.e., getHelpPage does not appear in Tools Called, no exploratory code is present, and no explicit caveats 	about uncertainty are included). A response that calls getHelpPage passes this criterion regardless of whether it narrates the tool use. Hypothetical suggestions explicitly conditioned on 	exploring the data first are not considered confident assumptions.',
        ],
    },
};
//# sourceMappingURL=r-forested-hallucination.js.map