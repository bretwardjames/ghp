local M = {}

local function get_ghp_path()
  return require("ghp").config.ghp_path
end

-- Parse issue lines from ghp output
local function parse_issues(lines)
  local issues = {}
  for _, line in ipairs(lines) do
    if line and line ~= "" then
      local num = line:match("#(%d+)")
      if num then
        local clean = line:gsub("\27%[[%d;]*m", ""):gsub("^%s+", "")
        table.insert(issues, {
          number = tonumber(num),
          display = clean,
          raw = line,
        })
      end
    end
  end
  return issues
end

-- Fetch issues using ghp CLI
local function fetch_issues(args, callback)
  local cmd = get_ghp_path() .. " " .. args
  vim.fn.jobstart(cmd, {
    stdout_buffered = true,
    on_stdout = function(_, data)
      if data then
        local issues = parse_issues(data)
        callback(issues)
      end
    end,
    on_stderr = function(_, data)
      if data and data[1] ~= "" then
        vim.notify("ghp error: " .. table.concat(data, "\n"), vim.log.levels.ERROR)
      end
    end,
  })
end

-- Check which picker to use
local function get_picker()
  local config = require("ghp").config
  if config.picker == "telescope" then
    local ok, _ = pcall(require, "telescope")
    if ok then return "telescope" end
  end
  -- Try snacks.picker for preview support
  local ok, snacks = pcall(require, "snacks")
  if ok and snacks.picker then
    return "snacks"
  end
  -- Fallback to vim.ui.select
  return "select"
end

-- Fetch issue details synchronously for preview
local function fetch_issue_details_sync(issue_number)
  local cmd = get_ghp_path() .. " open " .. issue_number
  local result = vim.fn.system(cmd)
  -- Clean ANSI codes and split into lines
  local clean = result:gsub("\27%[[%d;]*m", "")
  return vim.split(clean, "\n")
end

-- Use snacks.picker with preview
local function snacks_pick(args, title, opts, on_select)
  fetch_issues(args, function(issues)
    if #issues == 0 then
      vim.notify("No issues found", vim.log.levels.INFO)
      return
    end

    local items = {}
    for _, issue in ipairs(issues) do
      table.insert(items, {
        text = issue.display,
        issue = issue,
        preview = {
          text = table.concat(fetch_issue_details_sync(issue.number), "\n"),
        },
      })
    end

    require("snacks").picker.pick({
      source = "ghp",
      title = title,
      items = items,
      format = "text",
      preview = "preview",
      confirm = function(picker, item)
        picker:close()
        if item and item.issue and on_select then
          on_select(item.issue)
        end
      end,
    })
  end)
end

-- Use telescope picker
local function telescope_pick(args, title, opts)
  local telescope = require("telescope")
  telescope.load_extension("ghp")

  -- Map args to telescope function
  if args:match("^plan") then
    telescope.extensions.ghp.plan(opts)
  elseif args:match("^work") then
    telescope.extensions.ghp.work(opts)
  else
    telescope.extensions.ghp.issues(vim.tbl_extend("force", opts or {}, { args = args, title = title }))
  end
end

-- Use vim.ui.select picker (enhanced by snacks/dressing if installed)
local function select_pick(args, title, opts, on_select)
  fetch_issues(args, function(issues)
    if #issues == 0 then
      vim.notify("No issues found", vim.log.levels.INFO)
      return
    end

    vim.ui.select(issues, {
      prompt = title .. " > ",
      format_item = function(item)
        return item.display
      end,
    }, function(choice)
      if choice and on_select then
        on_select(choice)
      end
    end)
  end)
end

-- Action menu for an issue
local function show_actions(issue)
  local actions = {
    { label = "Open details", action = "open" },
    { label = "Start working", action = "start" },
    { label = "Mark as done", action = "done" },
    { label = "Add comment", action = "comment" },
  }

  vim.ui.select(actions, {
    prompt = "Action for #" .. issue.number .. " > ",
    format_item = function(item)
      return item.label
    end,
  }, function(choice)
    if not choice then return end

    local commands = require("ghp.commands")
    local num = tostring(issue.number)

    if choice.action == "open" then
      commands.open(num)
    elseif choice.action == "start" then
      commands.start(num)
    elseif choice.action == "done" then
      commands.done(num)
    elseif choice.action == "comment" then
      commands.comment(num)
    end
  end)
end

-- Main picker function - snacks (with preview) > vim.ui.select > telescope if configured
function M.pick(args, title, opts)
  opts = opts or {}

  local picker = get_picker()

  if picker == "telescope" then
    telescope_pick(args, title, opts)
  elseif picker == "snacks" then
    snacks_pick(args, title, opts, function(issue)
      show_actions(issue)
    end)
  else
    select_pick(args, title, opts, function(issue)
      show_actions(issue)
    end)
  end
end

-- Convenience functions
function M.plan(opts)
  opts = opts or {}
  local args = "plan --list"  -- Use list format for picker
  if opts.status then
    args = args .. " --status '" .. opts.status .. "'"
  end
  if opts.mine then
    args = args .. " --mine"
  end
  if opts.shortcut then
    args = args .. " " .. opts.shortcut
  end
  M.pick(args, "Project Board", opts)
end

function M.work(opts)
  opts = opts or {}
  local args = "work --list"  -- Use list format for picker
  if opts.status then
    args = args .. " --status '" .. opts.status .. "'"
  end
  M.pick(args, "My Work", opts)
end

function M.issues(opts)
  opts = opts or {}
  local args = opts.args or "plan --mine"
  local title = opts.title or "Issues"
  M.pick(args, title, opts)
end

return M
