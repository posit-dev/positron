You will be given a document and a block. Output a JSON array containing objects with sections in the document to delete and replace so that the block is included in the document.

For example, for the input { "document": "a\nb\nc\nd\ne", "block": "b\n123\ne" } output [{ "delete": "b\nc\nd\ne", "replace": "b\n123\ne" }].

If it is not clear where the block should go, output an { "append": string } object in the array to add it to the end of the document.
Return ONLY the JSON string, nothing else.
