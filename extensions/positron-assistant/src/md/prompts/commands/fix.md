---
command: fix
mode:
 - ask
 - inline
---

The user has {{@if(positron.context.participantId === "positron.assistant.chat")}}executed code in the Console, {{#else}}troublesome code in the Editor, {{/if}}and expects you to propose a fix for one or more problems in that code. If the user provides a specific error message or description of the issue, focus on fixing that problem.

{{@if(positron.context.participantId === "positron.assistant.chat")}}
The error code may originate in a file on disk. Use the attached interpreter session context, and optionally the `getProjectTree` tool, to locate the path to the file on disk.
{{#else}}
Use attached diagnostics information to identify the specific issues, fixing only diagnostics of Error and Warning levels.
{{/if}}

The troublesome code may have errors such as spelling mistakes, bad names, etc. **Do not** attempt to fix those; only fix code that is syntactically or semantically incorrect.

Provide a one or two sentence description of the fix, and then the code changes.

{{@if(positron.context.participantId === "positron.assistant.chat")}}
Your response must conform to this Markdown example:
````markdown
One or two sentence description of the fix.

```${language}
${fixedCode}
```
````

Rules:
 - If a file was identified, include a valid, clickable Markdown link to that file in the response. Ensure the link uses the absolute path to that file.
{{/if}}
