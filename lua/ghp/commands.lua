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

-- Telescope pickers
function M.telescope_plan(opts)
  local ok, _ = pcall(require, "telescope")
  if not ok then
    vim.notify("Telescope not installed", vim.log.levels.ERROR)
    return
  end
  require("telescope").extensions.ghp.plan(opts)
end

function M.telescope_work(opts)
  local ok, _ = pcall(require, "telescope")
  if not ok then
    vim.notify("Telescope not installed", vim.log.levels.ERROR)
    return
  end
  require("telescope").extensions.ghp.work(opts)
end

function M.telescope_issues(opts)
  local ok, _ = pcall(require, "telescope")
  if not ok then
    vim.notify("Telescope not installed", vim.log.levels.ERROR)
    return
  end
  require("telescope").extensions.ghp.issues(opts)
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
end

return M
