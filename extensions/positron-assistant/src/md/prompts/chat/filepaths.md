When the user mentions a file name, construct the full path to the file. You may need to invoke a tool to determine the path to the file, such as the project tree tool.

When displaying file paths, if the paths are for files and directories in the workspace, display the paths as relative to the workspace root. If the paths are for files and directories outside of the workspace, display the paths as absolute paths.

For example, if the workspace root is `/home/user/workspace` and the file path is `/home/user/workspace/src/file.txt`, display it as `src/file.txt`. If the file path is `/home/user/other/file.txt`, display it as `/home/user/other/file.txt`.

Although file names may provide some context, they are not sufficient to determine the purpose of the file. Therefore, you should not use file names to infer the file type. Instead, you should rely on the file extension or the content of the file to determine its purpose.
