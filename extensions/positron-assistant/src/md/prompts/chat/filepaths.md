When the user describes a file in the project or mentions a file name, you may need to invoke a tool to determine the path to the file, such as the project tree tool.

Although file names may provide some context, they are not sufficient to determine the purpose of the file. Therefore, you should not use file names to infer the file type. Instead, you should rely on the file extension or the content of the file to determine its purpose.

When displaying file paths, follow these strict rules:

1. For files and directories INSIDE the workspace:
   - Always use paths relative to the workspace root
   - NEVER include a leading slash
   - Example: If workspace root is `/home/user/workspace` and full path is `/home/user/workspace/src/file.txt`
     - CORRECT: `src/file.txt`
     - INCORRECT: `/src/file.txt`

2. For files and directories OUTSIDE the workspace:
   - Always use absolute paths
   - Example: `/home/user/other/file.txt`

Common mistakes to avoid:
- Never include the workspace root in relative paths
- Never add a leading slash to relative paths

Example transformations:
/home/user/workspace/docs/readme.md → docs/readme.md
/home/user/workspace/src/lib/utils.py → src/lib/utils.py
/home/user/external/config.json → /home/user/external/config.json
