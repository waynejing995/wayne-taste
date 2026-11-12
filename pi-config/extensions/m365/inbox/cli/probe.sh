# The agent probe: one JSON object for one watched pane. `inbox agent probe` runs it as
# `bash -c "$(cat probe.sh)" probe MUX PANE RESULT WANT`, locally or over ssh where the pane lives. It never writes.
# `$HOME/.local/bin` and `$HOME/.bun/bin` hold tern and omp on hosts where they are installed per user.
# WANT=1 adds `kind` and `tail` (gzip, base64 -w0): from the whole omp session, its newest assistant lines that carry
# text and its newest todo result (a long tool-only run cannot push them out), else the pane text.
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
mux=$1 pane=$2 result=$3 want=$4
# `cap` is the one capture per run. `printf x` keeps its trailing newlines, so the hash matches the old pipe.
alive=false agent= state= session= text= cap= mux_error=
run_mux() {
	tmp=$(mktemp)
	"$@" >"$tmp" 2>&1
	status=$?
	output=$(cat "$tmp"; rm -f "$tmp")
	if [ "$status" -ne 0 ]; then
		case $output in
			*"not found"*|*"no such"*|*"doesn't exist"*|*"does not exist"*|*"unknown"*) return 1 ;;
		esac
		mux_error=$output
		return 2
	fi
	printf '%s' "$output"
	return 0
}
capture_mux() {
	tmp=$(mktemp)
	"$@" >"$tmp" 2>&1
	mux_status=$?
	value=$(cat "$tmp"; rm -f "$tmp")
	if [ "$mux_status" -ne 0 ]; then
		case $value in
			*"not found"*|*"no such"*|*"doesn't exist"*|*"does not exist"*|*"unknown"*) mux_status=1 ;;
			*) mux_error=$value; mux_status=2 ;;
		esac
	fi
}
case $mux in
tern)
  if info=$(run_mux tern process "$pane" --json); then alive=true
  elif [ $? -eq 2 ]; then alive=error; fi
  pid=$(printf '%s' "$info" | sed -n 's/.*"foreground": *{ *"pid": *\([0-9]*\).*/\1/p' | head -1)
  [ -z "$pid" ] && pid=$(printf '%s' "$info" | tr -d '\n' | sed -n 's/.*"foreground": *{[^}]*"pid": *\([0-9]*\).*/\1/p')
  # `bash -lc "omp …"` (how goal sessions are launched) leaves bash in front and omp as its child.
  for p in $pid $(pgrep -P "$pid" 2>/dev/null); do
    s=$(ls -l /proc/$p/fd 2>/dev/null | grep -oE '/[^ ]*/sessions/[^/ ]+/[^/ ]+\.jsonl$' | head -1)
    if [ -n "$s" ]; then session=$s agent=$(cat /proc/$p/comm 2>/dev/null); break; fi
    [ -z "$agent" ] && agent=$(cat /proc/$p/comm 2>/dev/null)
  done
  capture_mux tern capture "$pane"; [ "$mux_status" -eq 0 ] && cap=$value || { [ "$mux_status" -eq 2 ] && alive=error; cap=; }
  text=$(printf '%s' "$cap" | md5sum | cut -c1-16) ;;
herdr)
  if info=$(run_mux herdr agent get "$pane"); then alive=true
  elif [ $? -eq 2 ]; then alive=error; fi
  state=$(printf '%s' "$info" | tr -d '\n' | sed -n 's/.*"agent_status": *"\([a-z]*\)".*/\1/p')
  capture_mux herdr agent read "$pane"; [ "$mux_status" -eq 0 ] && cap=$value || { [ "$mux_status" -eq 2 ] && alive=error; cap=; }
  text=$(printf '%s' "$cap" | md5sum | cut -c1-16) ;;
hc)
  # `hc get` exits non-zero for an unknown terminal; a finished one stays listed with state != live.
  if info=$(run_mux hc get "$pane"); then
    printf '%s' "$info" | tr -d '\n' | grep -q '"state": *"live"' && alive=true
  elif [ $? -eq 2 ]; then alive=error; fi
  state=$(printf '%s' "$info" | tr -d '\n' | sed -n 's/.*"status": *{[^}]*"state": *"\([a-z]*\)".*/\1/p')
  # hc's blocked = waiting on a question; working/done map onto herdr's working/idle.
  [ "$state" = done ] && state=idle
  if value=$(run_mux hc read "$pane"); then cap=$(printf %s "$value" | tail -c 20000); else [ $? -eq 2 ] && alive=error; cap=; fi
  text=$(printf '%s' "$cap" | md5sum | cut -c1-16) ;;
tmux)
  capture_mux tmux display-message -p -t "$pane" '#{pane_dead}'
  if [ "$mux_status" -eq 0 ]; then printf %s "$value" | grep -qx 0 && alive=true
  elif [ "$mux_status" -eq 2 ]; then alive=error; fi
  agent=$(run_mux tmux display-message -p -t "$pane" '#{pane_current_command}' || true)
  capture_mux tmux capture-pane -p -t "$pane"; [ "$mux_status" -eq 0 ] && cap=$value || { [ "$mux_status" -eq 2 ] && alive=error; cap=; }
  text=$(printf '%s' "$cap" | md5sum | cut -c1-16) ;;
esac
[ "$alive" = error ] && { printf 'probe command failed: %s\n' "$mux_error" >&2; exit 1; }
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
rmtime=0 rstatus= ropen= ropen_text= rquestions=false
if [ -n "$result" ] && [ -f "$result" ]; then
  rmtime=$(stat -c %Y "$result")
  block=$(tr -d '\r' < "$result" | awk 'BEGIN { IGNORECASE = 1 } tolower($0) ~ /^[[:space:]]*result[[:space:]]*$/ { buf = ""; next } { buf = buf $0 "\n" } END { printf "%s", buf }')
  # Only the contract's own status template contains `|`. Open text may contain one.
  rstatus=$(printf '%s\n' "$block" | sed -n '/^ *\([-*] \)\?\(\*\*status\(\*\*:\?\|:\*\*\)\|`status`:\|`status:`\|status:\) .*|/!s/^ *\([-*] \)\?\(\*\*status\(\*\*:\?\|:\*\*\)\|`status`:\|`status:`\|status:\) *\([a-z_][a-z_]*\).*/\4/p' | tail -1)
  ropen_text=$(printf '%s\n' "$block" | sed -n 's/^ *\([-*] \)\?\(\*\*open\(\*\*:\?\|:\*\*\)\|`open`:\|`open:`\|open:\) *\(.*\)/\4/p' | tail -1)
  ropen=$(printf '%s' "$ropen_text" | md5sum | cut -c1-16)
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
b64() { printf %s "$1" | base64 -w0; }
printf '{"alive":%s,"agent":"%s","state":"%s","session":"%s","smtime":%s,"waiting":%s,"text":"%s","rmtime":%s,"rstatus":"%s","ropen":"%s","ropen_text":"%s","rquestions":%s,"now":%s%s}\n' \
  "$alive" "$(b64 "$agent")" "$(b64 "$state")" "$(b64 "$session")" "$smtime" "$waiting" "$text" "$rmtime" "$(b64 "$rstatus")" "$ropen" "$(b64 "$ropen_text")" "$rquestions" "$(date +%s)" "$extra"
