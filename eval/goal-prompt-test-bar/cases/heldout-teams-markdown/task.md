Read `/workspace/skill/SKILL.md` completely, follow it as the supplied Wayne Goal
Prompt skill, and read only the direct resources it routes this task to.

Compose a goal prompt only; do not modify files or dispatch it. The raw intent is:

> User: "chat pane 里看 Teams 消息有两个问题：别人发的 Windows 共享路径
> `\\fileserver\share\logs` 显示出来少了反斜杠；有人发一条以 `- ` 或 `# ` 开头的普通
> 消息，pane 里变成了列表或者标题。修一下，pane 那边的渲染器会把转义还原。"

The Teams fetcher is `/srv/tasks/groups/tasks/scripts/fetch_teams.py`
(`html_to_markdown` feeds the chat pane). The task context file is
`~/.wayne/projects/example/runs/teams-literal-markdown/context.md` (it does not exist yet; the executor creates it).

Return the copy-paste goal block and the required confirmation question.
