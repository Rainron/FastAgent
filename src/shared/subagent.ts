/**
 * Sub-agent 工具调用上限的推荐值与可配上限。
 *
 * 放在 shared：设置界面要显示推荐值与输入框范围，主进程要拿同一份做归一与执行，
 * 两边各写一个数字迟早会对不上。
 *
 * 之所以限工具调用而不是轮次：pi 的轮次循环在 `session.prompt()` 内部，SDK 不暴露上限选项，
 * 工具调用次数是外部唯一能观测到的边界。
 */
export const SUBAGENT_DEFAULT_MAX_TOOL_CALLS = 40
export const SUBAGENT_MAX_TOOL_CALLS_CEILING = 200
