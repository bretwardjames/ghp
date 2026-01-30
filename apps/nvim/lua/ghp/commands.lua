local M = {}
local ui = require("ghp.ui")

local function get_ghp_path()
  return require("ghp").config.ghp_path
end

local function get_icon(name)
  local icons = require("ghp").config.icons
  if icons and icons[name] then
    return icons[name]
  end
  return ""
end

local function run_ghp(args, callback)
  local cmd = get_ghp_path() .. " " .. args
  vim.fn.jobstart(cmd, {
    stdout_buffered = true,
    on_stdout = function(_, data)
      if callback and data then
        callback(data)
      end
    end,
    on_stderr = function(_, data)
      if data and data[1] ~= "" then
        vim.notify(table.concat(data, "\n"), vim.log.levels.ERROR)
      end
    end,
  })
end

local function run_ghp_sync(args)
  local cmd = get_ghp_path() .. " " .. args
  local result = vim.fn.system(cmd)
  return result, vim.v.shell_error
end

function M.plan(opts)
  opts = opts or {}
  local args = "plan"
  if opts.status then
    args = args .. " --status '" .. opts.status .. "'"
  end
  if opts.mine then
    args = args .. " --mine"
  end
  if opts.shortcut then
    args = args .. " " .. opts.shortcut
  end

  run_ghp(args, function(lines)
    ui.show_float(lines, { title = get_icon("plan") .. "Project Board" })
  end)
end

function M.work(opts)
  opts = opts or {}
  local args = "work"
  if opts.status then
    args = args .. " --status '" .. opts.status .. "'"
  end

  run_ghp(args, function(lines)
    ui.show_float(lines, { title = get_icon("work") .. "My Work" })
  end)
end

function M.open(issue_number)
  if not issue_number then
    issue_number = vim.fn.input("Issue number: ")
  end
  if issue_number == "" then return end

  run_ghp("open " .. issue_number, function(lines)
    ui.show_float(lines, { title = get_icon("issue") .. "Issue #" .. issue_number })
  end)
end

function M.start(issue_number)
  if not issue_number then
    issue_number = vim.fn.input("Issue number: ")
  end
  if issue_number == "" then return end

  -- Run in terminal for interactive prompts
  ui.show_terminal("ghp start " .. issue_number)
end

function M.add(title)
  -- Always run in terminal for editor/interactive prompts
  local cmd = "ghp add"
  if title then
    cmd = cmd .. " '" .. title:gsub("'", "'\\''") .. "'"
  end
  ui.show_terminal(cmd)
end

function M.done(issue_number)
  if not issue_number then
    issue_number = vim.fn.input("Issue number: ")
  end
  if issue_number == "" then return end

  local result, code = run_ghp_sync("done " .. issue_number)
  if code == 0 then
    vim.notify("Marked #" .. issue_number .. " as done", vim.log.levels.INFO)
  else
    vim.notify(result, vim.log.levels.ERROR)
  end
end

function M.move(issue_number, status)
  if not issue_number then
    issue_number = vim.fn.input("Issue number: ")
  end
  if issue_number == "" then return end

  if not status then
    status = vim.fn.input("Move to status: ")
  end
  if status == "" then return end

  local result, code = run_ghp_sync("move " .. issue_number .. " '" .. status .. "'")
  if code == 0 then
    vim.notify("Moved #" .. issue_number .. " to " .. status, vim.log.levels.INFO)
  else
    vim.notify(result, vim.log.levels.ERROR)
  end
end

function M.comment(issue_number)
  if not issue_number then
    issue_number = vim.fn.input("Issue number: ")
  end
  if issue_number == "" then return end

  ui.show_terminal("ghp comment " .. issue_number)
end

function M.pr(opts)
  opts = opts or {}
  local args = "pr"
  if opts.create then
    args = args .. " --create"
  end
  if opts.open then
    args = args .. " --open"
  end

  if opts.create then
    ui.show_terminal("ghp " .. args)
  else
    run_ghp(args, function(lines)
      ui.show_float(lines, { title = get_icon("pr") .. "Pull Request" })
    end)
  end
end

function M.config_edit()
  ui.show_terminal("ghp config --edit")
end

-- Picker functions (uses telescope if available, otherwise vim.ui.select)
function M.pick_plan(opts)
  require("ghp.picker").plan(opts)
end

function M.pick_work(opts)
  require("ghp.picker").work(opts)
end

function M.pick_issues(opts)
  require("ghp.picker").issues(opts)
end

-- Aliases for backwards compatibility
M.telescope_plan = M.pick_plan
M.telescope_work = M.pick_work
M.telescope_issues = M.pick_issues

-- Dashboard functions
function M.dashboard(opts)
  opts = opts or {}
  require("ghp.dashboard").show_split(opts)
end

function M.dashboard_float(opts)
  opts = opts or {}
  require("ghp.dashboard").show_float(opts)
end

function M.dashboard_refresh()
  require("ghp.dashboard").refresh()
end

-- Check if running inside tmux
local function is_tmux()
  return vim.env.TMUX ~= nil
end

-- Get worktree path for an issue
local function get_worktree_path(issue_number)
  local result, code = run_ghp_sync("worktree list --json")
  if code ~= 0 then
    return nil
  end

  local ok, worktrees = pcall(vim.json.decode, result)
  if not ok or not worktrees then
    return nil
  end

  for _, wt in ipairs(worktrees) do
    if wt.issueNumber == tonumber(issue_number) and not wt.isMain then
      return wt.path
    end
  end

  return nil
end

-- Open nvim in a new worktree
local function open_nvim_in_worktree(path, issue_number)
  local config = require("ghp").config.parallel or {}
  local mode = config.open_mode or "auto"
  local auto_claude = config.auto_claude ~= false -- default: true
  local claude_cmd = config.claude_cmd or "claude"
  -- Layout: "panes" (side-by-side in same window) or "windows" (separate tmux windows)
  local layout = config.layout or "panes"

  -- Auto-detect mode
  if mode == "auto" then
    mode = is_tmux() and "tmux" or "tab"
  end

  if mode == "tmux" then
    if is_tmux() then
      local window_name = string.format("nvim-%s", tostring(issue_number))
      local escaped_path = vim.fn.shellescape(path)

      if auto_claude then
        if layout == "windows" then
          -- Separate windows: one for nvim, one for claude
          -- Create nvim window
          vim.fn.system(string.format(
            "tmux new-window -n %s -c %s nvim",
            vim.fn.shellescape(window_name),
            escaped_path
          ))
          -- Create claude window
          local claude_window = string.format("claude-%s", tostring(issue_number))
          vim.fn.system(string.format(
            "tmux new-window -n %s -c %s %s",
            vim.fn.shellescape(claude_window),
            escaped_path,
            vim.fn.shellescape(claude_cmd)
          ))
          vim.notify("Opened nvim + claude in separate windows", vim.log.levels.INFO)
        else
          -- Panes (default): nvim and claude side-by-side in same window
          -- Create window with nvim
          vim.fn.system(string.format(
            "tmux new-window -n %s -c %s nvim",
            vim.fn.shellescape(window_name),
            escaped_path
          ))
          -- Split horizontally and run claude in the new pane
          vim.fn.system(string.format(
            "tmux split-window -h -c %s %s",
            escaped_path,
            vim.fn.shellescape(claude_cmd)
          ))
          -- Focus back on the nvim pane (left pane)
          vim.fn.system("tmux select-pane -L")
          vim.notify("Opened nvim + claude side-by-side: " .. window_name, vim.log.levels.INFO)
        end
      else
        -- No claude, just nvim
        vim.fn.system(string.format(
          "tmux new-window -n %s -c %s nvim",
          vim.fn.shellescape(window_name),
          escaped_path
        ))
        vim.notify("Opened nvim in tmux window: " .. window_name, vim.log.levels.INFO)
      end
      return
    else
      vim.notify("tmux mode requested but not in tmux, falling back to tab", vim.log.levels.WARN)
    end
  end

  if mode == "terminal" and config.terminal_cmd then
    -- Use custom terminal command (escape path for shell)
    local cmd = config.terminal_cmd
      :gsub("{path}", vim.fn.shellescape(path))
      :gsub("{issue}", tostring(issue_number))
    vim.fn.jobstart(cmd, { detach = true })
    vim.notify("Opened nvim in new terminal: " .. path, vim.log.levels.INFO)
    return
  end

  -- Fallback: open in new tab with terminal
  vim.cmd("tabnew")
  vim.cmd("lcd " .. vim.fn.fnameescape(path))
  if auto_claude then
    vim.cmd("terminal " .. claude_cmd)
  else
    vim.cmd("terminal nvim")
  end
  vim.cmd("startinsert")
  vim.notify("Opened nvim in new tab: " .. path, vim.log.levels.INFO)
end

-- Start parallel work on an issue
-- opts.no_open: if true, create worktree but don't open editor (for agent-only workflows)
function M.start_parallel(issue_number, opts)
  opts = opts or {}

  if not issue_number then
    issue_number = vim.fn.input("Issue number: ")
  end
  if issue_number == "" then
    return
  end

  -- Validate issue number is numeric
  if not tostring(issue_number):match("^%d+$") then
    vim.notify("Invalid issue number: " .. issue_number, vim.log.levels.ERROR)
    return
  end

  -- Check if worktree already exists
  local existing_path = get_worktree_path(issue_number)
  if existing_path then
    if opts.no_open then
      vim.notify("Worktree already exists: " .. existing_path, vim.log.levels.INFO)
    else
      vim.notify("Worktree already exists, opening...", vim.log.levels.INFO)
      open_nvim_in_worktree(existing_path, issue_number)
    end
    return existing_path
  end

  -- Create worktree using ghp start --parallel
  vim.notify("Creating worktree for #" .. issue_number .. "...", vim.log.levels.INFO)

  -- Add --no-open to CLI if we don't want to open the terminal
  local cli_args = "start " .. issue_number .. " --parallel --force-defaults"
  if opts.no_open then
    cli_args = cli_args .. " --no-open"
  end

  local result, code = run_ghp_sync(cli_args)

  if code ~= 0 then
    vim.notify("Failed to create worktree:\n" .. result, vim.log.levels.ERROR)
    return nil
  end

  -- Get the worktree path
  local path = get_worktree_path(issue_number)
  if not path then
    vim.notify("Worktree created but couldn't find path", vim.log.levels.ERROR)
    return nil
  end

  if opts.no_open then
    vim.notify("Worktree created: " .. path, vim.log.levels.INFO)
  else
    open_nvim_in_worktree(path, issue_number)
  end

  return path
end

function M.setup()
  -- Register user commands
  vim.api.nvim_create_user_command("GhpPlan", function(opts)
    local shortcut = opts.args ~= "" and opts.args or nil
    M.plan({ shortcut = shortcut })
  end, { nargs = "?" })

  vim.api.nvim_create_user_command("GhpWork", function()
    M.work()
  end, {})

  vim.api.nvim_create_user_command("GhpOpen", function(opts)
    M.open(opts.args ~= "" and opts.args or nil)
  end, { nargs = "?" })

  vim.api.nvim_create_user_command("GhpStart", function(opts)
    M.start(opts.args ~= "" and opts.args or nil)
  end, { nargs = "?" })

  vim.api.nvim_create_user_command("GhpStartParallel", function(opts)
    -- Use bang (!) to create worktree without opening editor
    -- :GhpStartParallel 123 → opens editor
    -- :GhpStartParallel! 123 → creates worktree only (for agent workflows)
    M.start_parallel(opts.args ~= "" and opts.args or nil, { no_open = opts.bang })
  end, { nargs = "?", bang = true, desc = "Start working on issue in a new worktree (use ! to skip opening editor)" })

  vim.api.nvim_create_user_command("GhpAdd", function(opts)
    M.add(opts.args ~= "" and opts.args or nil)
  end, { nargs = "?" })

  vim.api.nvim_create_user_command("GhpDone", function(opts)
    M.done(opts.args ~= "" and opts.args or nil)
  end, { nargs = "?" })

  vim.api.nvim_create_user_command("GhpMove", function(opts)
    local args = vim.split(opts.args, " ", { trimempty = true })
    M.move(args[1], args[2])
  end, { nargs = "+" })

  vim.api.nvim_create_user_command("GhpComment", function(opts)
    M.comment(opts.args ~= "" and opts.args or nil)
  end, { nargs = "?" })

  vim.api.nvim_create_user_command("GhpPr", function(opts)
    if opts.args == "create" then
      M.pr({ create = true })
    elseif opts.args == "open" then
      M.pr({ open = true })
    else
      M.pr()
    end
  end, { nargs = "?" })

  vim.api.nvim_create_user_command("GhpConfig", function()
    M.config_edit()
  end, {})

  -- Telescope commands
  vim.api.nvim_create_user_command("GhpTelescopePlan", function(opts)
    local shortcut = opts.args ~= "" and opts.args or nil
    M.telescope_plan({ shortcut = shortcut })
  end, { nargs = "?" })

  vim.api.nvim_create_user_command("GhpTelescopeWork", function()
    M.telescope_work()
  end, {})

  vim.api.nvim_create_user_command("GhpTelescopeIssues", function()
    M.telescope_issues()
  end, {})

  -- Dashboard commands
  vim.api.nvim_create_user_command("GhpDashboard", function()
    M.dashboard()
  end, { desc = "Show branch dashboard in split" })

  vim.api.nvim_create_user_command("GhpDashboardFloat", function()
    M.dashboard_float()
  end, { desc = "Show branch dashboard in floating window" })

  vim.api.nvim_create_user_command("GhpDashboardRefresh", function()
    M.dashboard_refresh()
  end, { desc = "Refresh current dashboard" })
end

return M
