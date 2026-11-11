-- Converts NvChad base46's Lua themes into the JSON themes the native
-- appearance plugin embeds.
--
--   lua scripts/base46-themes.lua <base46 checkout> <output dir>
--
-- Each theme file runs in an empty environment: string, math and table,
-- and a require that only answers base46's own override_theme (a no-op
-- outside Neovim) and nvconfig (empty), so a theme cannot reach the file
-- system. polish_hl, the per-theme Neovim highlight tweaks, is dropped.

local src, out = arg[1], arg[2]
if not src or not out then
  io.stderr:write("usage: lua scripts/base46-themes.lua <base46 checkout> <output dir>\n")
  os.exit(2)
end

local stubs = {
  base46 = { override_theme = function(m) return m end },
  nvconfig = {
    ui = { statusline = { theme = "default" }, telescope = { style = "borderless" }, cmp = { style = "default" } },
    base46 = { transparency = false },
  },
}

local function encode(v)
  if type(v) == "string" then
    return string.format("%q", v):gsub("\\\n", "\\n")
  end
  local keys = {}
  for k in pairs(v) do keys[#keys + 1] = k end
  table.sort(keys)
  local parts = {}
  for _, k in ipairs(keys) do
    parts[#parts + 1] = string.format("    %q: %s", k, encode(v[k]))
  end
  return "{\n" .. table.concat(parts, ",\n") .. "\n  }"
end

local function colors(tbl, want, file)
  local res = {}
  for k, v in pairs(tbl or {}) do
    if type(v) == "string" and v:match("^#%x+$") then
      res[k] = v:lower()
    end
  end
  for _, k in ipairs(want) do
    if not res[k] then
      io.stderr:write(file .. ": " .. k .. " is missing\n")
    end
  end
  return res
end

local base30 = { "white", "darker_black", "black", "black2", "one_bg", "one_bg2", "one_bg3", "grey", "grey_fg",
  "grey_fg2", "light_grey", "red", "baby_pink", "pink", "line", "green", "vibrant_green", "nord_blue", "blue",
  "yellow", "sun", "purple", "dark_purple", "teal", "orange", "cyan", "statusline_bg", "lightbg", "pmenu_bg",
  "folder_bg" }
local base16 = {}
for i = 0, 15 do base16[#base16 + 1] = string.format("base%02X", i) end

local list = io.popen('ls "' .. src .. '/lua/base46/themes"')
local count = 0
for file in list:lines() do
  local name = file:match("^(.+)%.lua$")
  if name then
    local env = {
      string = string, math = math, table = table, pairs = pairs, ipairs = ipairs,
      tostring = tostring, tonumber = tonumber, type = type,
      require = function(mod) return stubs[mod] or error("theme requires " .. mod, 0) end,
    }
    local chunk = assert(loadfile(src .. "/lua/base46/themes/" .. file, "t", env))
    local m = chunk()
    local theme = {
      name = name,
      type = m.type,
      base_30 = colors(m.base_30, base30, file),
      base_16 = colors(m.base_16, base16, file),
    }
    local f = assert(io.open(out .. "/" .. name .. ".json", "w"))
    f:write(string.format('{\n  "name": %q,\n  "type": %q,\n  "base_30": %s,\n  "base_16": %s\n}\n',
      theme.name, theme.type, encode(theme.base_30), encode(theme.base_16)))
    f:close()
    count = count + 1
  end
end
list:close()
print(count .. " themes")
