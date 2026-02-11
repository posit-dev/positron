import { Task, TaskExecution, tasks } from 'vscode';

export async function executeTask(task: Task): Promise<TaskExecution> {
    return tasks.executeTask(task);
}
