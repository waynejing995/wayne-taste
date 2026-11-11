# The agent probe: one JSON object for one watched pane. `inbox agent probe` runs it as
# `bash -c "$(cat probe.sh)" probe MUX PANE RESULT WANT`, locally or over ssh where the pane lives. It never writes.
# `$HOME/.local/bin` and `$HOME/.bun/bin` hold tern and omp on hosts where they are installed per user.
# WANT=1 adds `kind` and `tail` (gzip, base64 -w0): from the whole omp session, its newest assistant lines that carry
# text and its newest todo result (a long tool-only run cannot push them out), else the pane text.
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
mux=$1 pane=$2 result=$3 want=$4
# `cap` is the one capture per run. `printf x` keeps its trailing newlines, so the hash matches the old pipe.
alive=false agent= state= session= text= cap=
case $mux in
tern)
  info=$(tern process "$pane" --json 2>/dev/null) && alive=true
  pid=$(printf '%s' "$info" | sed -n 's/.*"foreground": *{ *"pid": *\([0-9]*\).*/\1/p' | head -1)
  [ -z "$pid" ] && pid=$(printf '%s' "$info" | tr -d '\n' | sed -n 's/.*"foreground": *{[^}]*"pid": *\([0-9]*\).*/\1/p')
  # `bash -lc "omp …"` (how goal sessions are launched) leaves bash in front and omp as its child.
  for p in $pid $(pgrep -P "$pid" 2>/dev/null); do
    s=$(ls -l /proc/$p/fd 2>/dev/null | grep -oE '/[^ ]*/sessions/[^/ ]+/[^/ ]+\.jsonl$' | head -1)
    if [ -n "$s" ]; then session=$s agent=$(cat /proc/$p/comm 2>/dev/null); break; fi
    [ -z "$agent" ] && agent=$(cat /proc/$p/comm 2>/dev/null)
  done
  cap=$(tern capture "$pane" 2>/dev/null; printf x); cap=${cap%x}
  text=$(printf '%s' "$cap" | md5sum | cut -c1-16) ;;
herdr)
  info=$(herdr agent get "$pane" 2>/dev/null) && alive=true
  state=$(printf '%s' "$info" | tr -d '\n' | sed -n 's/.*"agent_status": *"\([a-z]*\)".*/\1/p')
  cap=$(herdr agent read "$pane" 2>/dev/null; printf x); cap=${cap%x}
  text=$(printf '%s' "$cap" | md5sum | cut -c1-16) ;;
hc)
  # `hc get` exits non-zero for an unknown terminal; a finished one stays listed with state != live.
  info=$(hc get "$pane" 2>/dev/null) && printf '%s' "$info" | tr -d '\n' | grep -q '"state": *"live"' && alive=true
  state=$(printf '%s' "$info" | tr -d '\n' | sed -n 's/.*"status": *{[^}]*"state": *"\([a-z]*\)".*/\1/p')
  # hc's blocked = waiting on a question; working/done map onto herdr's working/idle.
  [ "$state" = done ] && state=idle
  cap=$(hc read "$pane" 2>/dev/null | tail -c 20000; printf x); cap=${cap%x}
  text=$(printf '%s' "$cap" | md5sum | cut -c1-16) ;;
tmux)
  tmux display-message -p -t "$pane" '#{pane_dead}' 2>/dev/null | grep -qx 0 && alive=true
  agent=$(tmux display-message -p -t "$pane" '#{pane_current_command}' 2>/dev/null)
  cap=$(tmux capture-pane -p -t "$pane" 2>/dev/null; printf x); cap=${cap%x}
  text=$(printf '%s' "$cap" | md5sum | cut -c1-16) ;;
esac
smtime=0 waiting=false
if [ -n "$session" ]; then
  smtime=$(stat -c %Y "$session" 2>/dev/null || echo 0)
  # omp waits for input when its last message is an assistant turn that ended (not a tool call).
  last=$(tail -c 200000 "$session" | grep '"message":{"role":"' | tail -1)
  case $last in
    *'"role":"assistant"'*)
      case $last in
        *'"stopReason":"toolUse"'*) case $last in *'"name":"ask","arguments":'*) [ -z "$state" ] && state=blocked ;; esac ;;
        *'"stopReason":"'*) waiting=true ;;
      esac ;;
  esac
fi
rmtime=0 rstatus= ropen=
if [ -n "$result" ] && [ -f "$result" ]; then
  rmtime=$(stat -c %Y "$result")
  # A line holding `|` is the contract's own template (`status: done | partial | blocked`), never a status.
  rstatus=$(sed -n '/|/!s/^ *\([-*] \)\?\(\*\*status\(\*\*:\?\|:\*\*\)\|`status`:\|`status:`\|status:\) *\([a-z_][a-z_]*\).*/\4/p' "$result" | tail -1)
  # The open items, hashed: the same status and open line rewritten is not news.
  ropen=$(sed -n '/|/!s/^ *\([-*] \)\?\(\*\*open\(\*\*:\?\|:\*\*\)\|`open`:\|`open:`\|open:\) *\(.*\)/\4/p' "$result" | tail -1 | md5sum | cut -c1-16)
fi
extra=
if [ "$want" = 1 ]; then
  if [ -n "$session" ]; then
    kind=jsonl
    # JSON escapes quotes inside strings, so a bare `"type":"text"` is a real content item, never quoted text.
    tail64=$( { grep -F '"message":{"role":"assistant"' "$session" | grep -F '"type":"text"' | tail -n 20
                grep -F '"message":{"role":"toolResult"' "$session" | grep -F '"toolName":"todo"' | tail -n 1; } | gzip -c | base64 -w0)
  else kind=pane; tail64=$(printf '%s' "$cap" | gzip -c | base64 -w0); fi
  extra=",\"kind\":\"$kind\",\"tail\":\"$tail64\""
fi
printf '{"alive":%s,"agent":"%s","state":"%s","session":"%s","smtime":%s,"waiting":%s,"text":"%s","rmtime":%s,"rstatus":"%s","ropen":"%s","now":%s%s}\n' \
  "$alive" "$agent" "$state" "$session" "$smtime" "$waiting" "$text" "$rmtime" "$rstatus" "$ropen" "$(date +%s)" "$extra"
