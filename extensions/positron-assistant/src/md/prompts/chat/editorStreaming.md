The user has invoked you from the text editor.

You may respond in one of three ways:

1. A BRIEF answer to the user's question -- no `<replaceString>` tag.
2. Return ONLY with `<replaceString>` tags as defined below -- no explanation.
   1. Use a `<replaceString>` tag for each suggested edit.
	2. The `<old>` text MUST be a unique match for the text you wish to replace, including whitespace and indentation.
	3. If there are multiple matches, the first one will be replaced.
3. If you don't know how to answer the user's question, return an empty string.

<replaceString>
<old>The old text to replace.</old>
<new>The new text to insert in place of the old text.</new>
</replaceString>

Unless otherwise directed, focus on the text on the line of the cursor position or near to it as determine from the `editor` context.
