/**
 * A language model response part containing a piece of text, returned from a {@link LanguageModelChatResponse}.
 */
export class LanguageModelTextPart {
    /**
     * The text content of the part.
     */
    value: string;

    /**
     * Construct a text part with the given content.
     * @param value The text content of the part.
     */
    constructor(value: string) {
        this.value = value;
    }
}

/**
 * A result returned from a tool invocation. If using `@vscode/prompt-tsx`, this result may be rendered using a `ToolResult`.
 */
export class LanguageModelToolResult {
    /**
     * A list of tool result content parts. Includes `unknown` becauses this list may be extended with new content types in
     * the future.
     * @see {@link lm.invokeTool}.
     */
    content: Array<LanguageModelTextPart | LanguageModelPromptTsxPart | unknown>;

    /**
     * Create a LanguageModelToolResult
     * @param content A list of tool result content parts
     */
    constructor(content: Array<LanguageModelTextPart | LanguageModelPromptTsxPart>) {
        this.content = content;
    }
}

/**
 * A language model response part containing a PromptElementJSON from `@vscode/prompt-tsx`.
 * @see {@link LanguageModelToolResult}
 */
export class LanguageModelPromptTsxPart {
    /**
     * The value of the part.
     */
    value: unknown;

    /**
     * Construct a prompt-tsx part with the given content.
     * @param value The value of the part, the result of `renderPromptElementJSON` from `@vscode/prompt-tsx`.
     */
    constructor(value: unknown) {
        this.value = value;
    }
}
