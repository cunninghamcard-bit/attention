import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * "Batteries included" zsh for the embedded terminal, without touching the
 * user's dotfiles: spawn zsh with ZDOTDIR pointing at a generated shim
 * directory. The shim sources the user's own ~/.zshenv/~/.zshrc FIRST (their
 * config always wins), then layers a starship prompt, zoxide, and the plugins
 * vendored inside the Kaku terminal's app bundle (sourced in place, nothing
 * installed) — the same out-of-the-box experience Kaku's setup_zsh.sh wires.
 */

const SHIM_VERSION = 6;
const STAMP = `# arkloop-zsh-shim v${SHIM_VERSION}`;

// The Kaku terminal's app bundle, which vendors the zsh plugins we source.
export const DEFAULT_VENDOR_RESOURCES = "/Applications/Kaku.app/Contents/Resources";

export interface ZshShimOptions {
  homeDir: string;
  /** Shim location; default `<homeDir>/.config/arkloop/zsh`. */
  configDir?: string;
  /** Vendor bundle resources root, injectable for tests. */
  vendorResourcesDir?: string;
}

function zshenvContent(): string {
  return `${STAMP} (generated; safe to delete — it is rebuilt on next terminal)
[[ -f "$HOME/.zshenv" ]] && source "$HOME/.zshenv"
`;
}

function zshrcContent(vendorDir: string): string {
  return `${STAMP} (generated; safe to delete — it is rebuilt on next terminal)
# The user's real config runs first and always wins.
[[ -f "$HOME/.zshrc" ]] && source "$HOME/.zshrc"

_arkloop_vendor=${JSON.stringify(vendorDir)}

# macOS /etc/zshrc points HISTFILE into ZDOTDIR; keep history shared with
# the user's normal shells unless their zshrc chose a custom location.
[[ "\${HISTFILE:-}" == "\${ZDOTDIR}/.zsh_history" ]] && HISTFILE="$HOME/.zsh_history"

# Completions: the vendored zsh-completions, then compinit if the user's rc
# didn't already run it.
[[ -d "$_arkloop_vendor/vendor/zsh-completions/src" ]] && fpath+=("$_arkloop_vendor/vendor/zsh-completions/src")
if ! (( \${+functions[compdef]} )); then
  autoload -Uz compinit && compinit -C
fi

# Prompt: starship, with the vendored preset when the user has no config of
# their own.
if command -v starship >/dev/null 2>&1; then
  if [[ ! -f "\${XDG_CONFIG_HOME:-$HOME/.config}/starship.toml" && -f "$_arkloop_vendor/vendor/starship.toml" ]]; then
    export STARSHIP_CONFIG="$_arkloop_vendor/vendor/starship.toml"
  fi
  eval "$(starship init zsh)"
fi

# Smarter cd.
command -v zoxide >/dev/null 2>&1 && eval "$(zoxide init zsh)"

# Colored ls + intuitive defaults, transcribed from the vendor terminal's zsh
# layer (CLICOLOR/LSCOLORS drive BSD ls colors — this is why its ls looks
# different from a bare shell). Everything yields to the user's own choices:
# env only when unset, aliases only when not already defined.
[[ -n "\${CLICOLOR:-}" ]] || export CLICOLOR=1
[[ -n "\${LSCOLORS:-}" ]] || export LSCOLORS="Gxfxcxdxbxegedabagacad"
# The user's fish config aliases ls to eza (icons, git column, relative time);
# mirror the exact flags here so zsh terminals show the same listing. Guarded:
# only when eza exists and the user's own zshrc didn't define an ls alias.
if command -v eza >/dev/null 2>&1 && ! (( \${+aliases[ls]} )); then
  alias ls='eza -l --icons --git --group-directories-first --time-style=relative'
fi
setopt auto_cd auto_pushd pushd_ignore_dups pushdminus
(( \${+aliases[ll]} ))    || alias ll='ls -lhF'
(( \${+aliases[la]} ))    || alias la='ls -lAhF'
(( \${+aliases[l]} ))     || alias l='ls -CF'
(( \${+aliases[...]} ))   || alias ...='../..'
(( \${+aliases[....]} ))  || alias ....='../../..'
(( \${+aliases[md]} ))    || alias md='mkdir -p'
(( \${+aliases[rd]} ))    || alias rd=rmdir
(( \${+aliases[grep]} ))  || alias grep='grep --color=auto'
(( \${+aliases[egrep]} )) || alias egrep='grep -E --color=auto'
(( \${+aliases[fgrep]} )) || alias fgrep='grep -F --color=auto'
(( \${+aliases[g]} ))     || alias g='git'
(( \${+aliases[gst]} ))   || alias gst='git status'
(( \${+aliases[gd]} ))    || alias gd='git diff'
(( \${+aliases[gl]} ))    || alias gl='git pull'
(( \${+aliases[gp]} ))    || alias gp='git push'
(( \${+aliases[gco]} ))   || alias gco='git checkout'

# Fish-style autosuggestions (skip if the user's rc already loaded one).
if ! (( \${+functions[_zsh_autosuggest_start]} )) && [[ -f "$_arkloop_vendor/vendor/zsh-autosuggestions/zsh-autosuggestions.zsh" ]]; then
  source "$_arkloop_vendor/vendor/zsh-autosuggestions/zsh-autosuggestions.zsh"
fi

# Syntax highlighting loads LAST — it wraps zle widgets.
if [[ -z "\${FAST_HIGHLIGHT_VERSION:-}" ]] && [[ -f "$_arkloop_vendor/vendor/fast-syntax-highlighting/fast-syntax-highlighting.plugin.zsh" ]]; then
  source "$_arkloop_vendor/vendor/fast-syntax-highlighting/fast-syntax-highlighting.plugin.zsh"
fi

unset _arkloop_vendor
`;
}

/**
 * Write (or refresh) the shim and return its directory, null when the shim
 * can't be provisioned — spawn must fall back to a plain shell, never fail.
 */
export function ensureZshShim(options: ZshShimOptions): string | null {
  const dir = options.configDir ?? join(options.homeDir, ".config", "arkloop", "zsh");
  const vendorDir = options.vendorResourcesDir ?? DEFAULT_VENDOR_RESOURCES;
  try {
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of [
      [".zshenv", zshenvContent()],
      [".zshrc", zshrcContent(vendorDir)],
    ] as const) {
      const path = join(dir, name);
      // Regenerate on version bump or manual deletion; leave current files
      // alone so repeated spawns stay cheap.
      let current: string | null = null;
      if (existsSync(path)) current = readFileSync(path, "utf8");
      if (current === null || !current.startsWith(STAMP)) writeFileSync(path, content);
    }
    return dir;
  } catch {
    return null;
  }
}
