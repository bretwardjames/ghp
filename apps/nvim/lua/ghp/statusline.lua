-- Statusline integration for ghp.nvim
-- Provides a lualine-compatible component showing current issue info

local M = {}

-- Cache for issue data
local cache = {
  data = nil,
  branch = nil,
  timestamp = 0,
}

-- Cache for git branch (avoid blocking calls on every refresh)
local branch_cache = {
  value = nil,
  timestamp = 0,
  ttl = 5, -- Short TTL for branch changes
}

-- Guard against concurrent fetches
local is_fetching = false

-- Default config (can be overridden via setup)
M.config = {
  -- Cache TTL in seconds
  cache_ttl = 30,
  -- Max title length before truncating
  max_title_length = 40,
  -- Format string: available tokens are {number}, {title}, {status}
  format = "#{number} {title}",
  -- Show status in brackets after title
  show_status = true,
  -- Status colors (highlight groups or hex colors)
  status_colors = {
    ["Backlog"] = "Comment",
    ["Ready"] = "Function",
    ["In Progress"] = "Keyword",
    ["In Review"] = "String",
    ["Done"] = "DiagnosticOk",
    ["In Beta"] = "DiagnosticWarn",
  },
  -- Default color when status not in map
  default_color = "Normal",
  -- Icon to show before issue info
  icon = " ",
  -- What to show when no issue is linked
  no_issue_text = nil, -- nil = hide component entirely
  -- Auto-add to lualine if installed
  auto_lualine = false,
  -- Which lualine section to add to (lualine_a through lualine_z)
  lualine_section = "lualine_c",
}

-- Get current git branch (cached to avoid blocking on every statusline refresh)
local function get_current_branch()
  local now = os.time()
  if branch_cache.value and (now - branch_cache.timestamp) < branch_cache.ttl then
    return branch_cache.value
  end

  -- Use vim.fn.system which is still sync but faster than io.popen
  local branch = vim.fn.system("git rev-parse --abbrev-ref HEAD 2>/dev/null"):gsub("\n", "")
  if vim.v.shell_error == 0 and branch ~= "" then
    branch_cache.value = branch
    branch_cache.timestamp = now
    return branch
  end

  branch_cache.value = nil
  branch_cache.timestamp = now
  return nil
end

-- Get ghp path from main config
local function get_ghp_path()
  return require("ghp").config.ghp_path
end

-- Fetch issue data async
local function fetch_issue_data(callback)
  local cmd = get_ghp_path() .. " work --json"

  vim.fn.jobstart(cmd, {
    stdout_buffered = true,
    on_stdout = function(_, data)
      if data and #data > 0 then
        local json_str = table.concat(data, "\n")
        local ok, parsed = pcall(vim.json.decode, json_str)
        if ok and parsed then
          callback(parsed)
        else
          callback(nil)
        end
      else
        callback(nil)
      end
    end,
    on_stderr = function(_, _)
      -- Silently ignore errors in statusline
    end,
  })
end

-- Find issue matching current branch
local function find_issue_for_branch(issues, branch)
  if not issues or not branch then
    return nil
  end

  for _, issue in ipairs(issues) do
    if issue.branch == branch then
      return issue
    end
  end

  return nil
end

-- Truncate title if needed
local function truncate_title(title, max_len)
  if not title then
    return ""
  end
  if #title <= max_len then
    return title
  end
  return string.sub(title, 1, max_len - 1) .. "…"
end

-- Format the statusline string
local function format_issue(issue)
  if not issue then
    return M.config.no_issue_text
  end

  local title = truncate_title(issue.title, M.config.max_title_length)
  local result = M.config.format
    :gsub("{number}", tostring(issue.number))
    :gsub("{title}", title)
    :gsub("{status}", issue.status or "")

  if M.config.show_status and issue.status then
    result = result .. " [" .. issue.status .. "]"
  end

  if M.config.icon then
    result = M.config.icon .. result
  end

  return result
end

-- Get color for current status
local function get_status_color(issue)
  if not issue or not issue.status then
    return M.config.default_color
  end

  return M.config.status_colors[issue.status] or M.config.default_color
end

-- Check if cache is still valid
local function is_cache_valid(branch)
  if not cache.data then
    return false
  end
  if cache.branch ~= branch then
    return false
  end
  local now = os.time()
  return (now - cache.timestamp) < M.config.cache_ttl
end

-- Update cache
local function update_cache(branch, issue)
  cache.data = issue
  cache.branch = branch
  cache.timestamp = os.time()
end

-- Refresh cache (called async, updates on next statusline refresh)
local function refresh_cache_async(branch)
  if is_fetching then
    return
  end
  is_fetching = true

  fetch_issue_data(function(issues)
    is_fetching = false
    local issue = find_issue_for_branch(issues, branch)
    update_cache(branch, issue)
    -- Trigger statusline refresh
    vim.cmd("redrawstatus")
  end)
end

-- Main component function for lualine
function M.component()
  local branch = get_current_branch()
  if not branch then
    return M.config.no_issue_text
  end

  -- Check cache - return immediately if valid
  if is_cache_valid(branch) then
    return format_issue(cache.data)
  end

  -- Cache miss or stale - trigger async refresh
  refresh_cache_async(branch)

  -- Return stale cache for current branch while refreshing (prevents flicker)
  if cache.data and cache.branch == branch then
    return format_issue(cache.data)
  end

  return M.config.no_issue_text
end

-- Get color for lualine (uses cached branch to avoid extra calls)
function M.component_color()
  -- Use cached branch value to avoid redundant calls
  if not branch_cache.value or not cache.data or cache.branch ~= branch_cache.value then
    return { fg = M.config.default_color }
  end

  local color = get_status_color(cache.data)

  -- If it's a highlight group name, return it
  if type(color) == "string" and not color:match("^#") then
    return { fg = color }
  end

  -- If it's a hex color, return directly
  return { fg = color }
end

-- Force refresh (useful for manual refresh keybinding)
function M.refresh()
  local branch = get_current_branch()
  if branch then
    cache.timestamp = 0 -- Invalidate cache
    is_fetching = false -- Reset fetch guard
    refresh_cache_async(branch)
  end
end

-- Clear cache entirely
function M.clear_cache()
  cache.data = nil
  cache.branch = nil
  cache.timestamp = 0
  branch_cache.value = nil
  branch_cache.timestamp = 0
  is_fetching = false
end

-- Try to auto-register with lualine
local function auto_register_lualine(section)
  -- Defer to ensure lualine is loaded
  vim.schedule(function()
    local ok, lualine = pcall(require, "lualine")
    if not ok then
      return
    end

    -- Get current lualine config
    local lualine_cfg = require("lualine").get_config()
    if not lualine_cfg or not lualine_cfg.sections then
      return
    end

    -- Add our component to the specified section
    local target = lualine_cfg.sections[section]
    if target then
      table.insert(target, M.lualine)
      lualine.setup(lualine_cfg)
    end
  end)
end

-- Setup function to override config
function M.setup(opts)
  M.config = vim.tbl_deep_extend("force", M.config, opts or {})

  -- Auto-register with lualine if enabled
  if M.config.auto_lualine then
    auto_register_lualine(M.config.lualine_section or "lualine_c")
  end
end

-- Lualine component table (ready to use in lualine config)
-- Usage: require('ghp.statusline').lualine
M.lualine = {
  function()
    return M.component()
  end,
  cond = function()
    -- Only show when in a git repo (uses cached branch)
    return get_current_branch() ~= nil
  end,
  color = function()
    return M.component_color()
  end,
}

return M
