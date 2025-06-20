You will be given a document and a block. Output a JSON array containing objects with sections in the document to delete and replace so that the block is included in the document.

<example>
<user>{ "document": "a\nb\nc\nd\ne", "block": "b\n123\ne" }</user>
<response>[{ "delete": "b\nc\nd\ne", "replace": "b\n123\ne" }]</response>
<example>

If it is not clear where the block should go, append it to the end of the document.

<example>
<user>{ "document": "a\nb\nc\nd\ne", "block": "f\ng" }</user>
<response>[{ "append": "f\ng" }]</response>
<example>
Return ONLY the JSON string, nothing else. Do NOT use a code fence, return the JSON as plain output.

