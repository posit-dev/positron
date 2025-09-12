You will be given a document and a block. Output JSON Lines (`jsonl`) containing objects with sections in the document to delete and replace so that the block is included in the document.

<example>
<user>{ "document": "a\nb\nc\nd\ne", "block": "b\n123\ne" }</user>
<response>{ "delete": "b\nc", "replace": "b\n123" }
{ "delete": "d\ne", "replace": "d\nf" }</response>
<example>

Keep the text to be deleted as small as possible, while still uniquely identifying within the text of the document.

Correct:
<example>
<user>{ "document": "abcdef\nhijklm", "block": "abcdef" }</user>
<response>{ "delete": "cd", "replace": "12" }</response>
<example>

...versus...

Incorrect:
<example>
<user>{ "document": "abcdef\nhijklm", "block": "abcdef" }</user>
<response>{ "delete": "abcdef", "replace": "ab12ef" }</response>
<example>


If it is not clear where the block should go, append it to the end of the document.

<example>
<user>{ "document": "a\nb\nc\nd\ne", "block": "f\ng" }</user>
<response>{ "append": "f\ng" }</response>
<example>

Return ONLY the JSON Lines (`jsonl`) string, nothing else. Do NOT use a code fence, return the JSON Lines as plain output.

JSON Lines rules:
- Each Line is a Valid JSON Value
	The most common values will be objects or arrays, but any JSON value is permitted. e.g. null is a valid value but a blank line is not.

- Line Terminator is '\n'
	This means '\r\n' is also supported because surrounding white space is implicitly ignored when parsing JSON values.
