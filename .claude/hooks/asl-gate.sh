#!/bin/bash
# PreToolUse gate on `git commit`, adapted from CMGS/asl's plugin: asl
# layout findings in the Go modules the commit touches block it, and a
# fix/refactor/style/perf commit must not add comment lines. The target
# repository comes from the command (`cd <dir> &&`, `git -C <dir>`), not
# the session's folder; heredoc bodies are ignored.
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')
[ -n "$cmd" ] || exit 0
cmd=$(printf '%s\n' "$cmd" | perl -0pe 's/<<-?\s*["\x27]?(\w+)["\x27]?[^\n]*\n.*?\n[ \t]*\1[ \t]*(\n|\z)/\n/sg')
printf '%s' "$cmd" | grep -qE '(^|[^[:alnum:]_-])git[[:space:]]' || exit 0

# asl: on PATH, else where `go install` puts it.
asl_bin() {
	command -v asl 2>/dev/null && return
	local gobin
	gobin=$(go env GOBIN 2>/dev/null)
	[ -n "$gobin" ] || gobin="$(go env GOPATH 2>/dev/null)/bin"
	[ -x "$gobin/asl" ] && printf '%s' "$gobin/asl"
}

resolve() {
	local d=$1
	d=${d//\"/}
	d=${d//\'/}
	d=${d/#\~/$HOME}
	[[ $d = /* ]] || d="$2/$d"
	printf '%s' "$d"
}

# modules lists the folders, under root, of the go.mod nearest each Go
# file the commit changes.
modules() {
	local root=$1 range=$2 f d
	git -C "$root" diff $range --name-only --diff-filter=ACMR -- '*.go' 'go.mod' 2>/dev/null | while IFS= read -r f; do
		d=$(dirname "$root/$f")
		while [ "$d" != "$root" ] && [ ! -f "$d/go.mod" ]; do d=$(dirname "$d"); done
		[ -f "$d/go.mod" ] && printf '%s\n' "$d"
	done | sort -u
}

gate() {
	local seg=$1 dir=$2 root fail="" findings prefix range="--cached" diff added removed asl mod
	root=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || return 0
	[[ $seg =~ [[:space:]](-a|--all|-am|-qa)([[:space:]]|$) ]] && range="HEAD"
	asl=$(asl_bin)
	if [ -n "$asl" ]; then
		while IFS= read -r mod; do
			[ -n "$mod" ] || continue
			findings=$(cd "$mod" && GOWORK=off "$asl" -forwarder=false ./... 2>&1 | grep -v '^#' | grep -v '^$' | sort -u)
			[ -n "$findings" ] && fail+="asl gate: layout findings in ${mod#$root/} block this commit (fix, then retry):"$'\n'"$findings"$'\n'
		done < <(modules "$root" "$range")
	fi
	if [[ $seg =~ -m[[:space:]]*[\"\']?(fix|refactor|style|perf)(\([^\)]*\))?!?: ]]; then
		prefix=${BASH_REMATCH[1]}
		diff=$(git -C "$root" diff $range -U0 -- '*.go' '*.rs' '*.ts' '*.tsx' 2>/dev/null | grep -E '^[-+][[:space:]]*//')
		diff+=$'\n'$(git -C "$root" diff $range -U0 -- '*.py' 2>/dev/null | grep -E '^[-+][[:space:]]*#[^!]')
		added=$(printf '%s\n' "$diff" | grep -c '^+')
		removed=$(printf '%s\n' "$diff" | grep -c '^-')
		if [ "$added" -gt "$removed" ]; then
			fail+="comment gate: a ${prefix} commit adds comment lines (+$added/-$removed); put the rationale in the commit message:"$'\n'
			fail+=$(printf '%s\n' "$diff" | grep '^+' | head -10)$'\n'
		fi
	fi
	if [ -n "$fail" ]; then
		printf '%s' "$fail" >&2
		exit 2
	fi
}

dir=$cwd
while IFS= read -r seg; do
	seg="${seg#"${seg%%[![:space:]]*}"}"
	[ -n "$seg" ] || continue
	if [[ $seg =~ ^(cd|pushd)[[:space:]]+([^[:space:]]+) ]]; then
		dir=$(resolve "${BASH_REMATCH[2]}" "$dir")
		continue
	fi
	[[ $seg =~ (^|[^[:alnum:]_-])git([[:space:]]+[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$) ]] || continue
	target=$dir
	[[ $seg =~ git[[:space:]]+-C[[:space:]]+([^[:space:]]+) ]] && target=$(resolve "${BASH_REMATCH[1]}" "$dir")
	gate "$seg" "$target"
done < <(printf '%s\n' "$cmd" | perl -pe 's/\s*(&&|\|\||;)\s*/\n/g')
exit 0
