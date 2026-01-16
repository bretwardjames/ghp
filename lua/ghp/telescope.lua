local M = {}

local has_telescope, telescope = pcall(require, "telescope")
if not has_telescope then
  return M
end

local pickers = require("telescope.pickers")
local finders = require("telescope.finders")
local conf = require("telescope.config").values
local actions = require("telescope.actions")
local action_state = require("telescope.actions.state")
local previewers = require("telescope.previewers")

local function get_ghp_path()
  return require("ghp").config.ghp_path
end

-- Parse issue lines from ghp output
local function parse_issues(lines)
  local issues = {}
  for _, line in ipairs(lines) do
    -- Match lines with issue numbers: #123
    local num = line:match("#(%d+)")
    if num then
      -- Clean ANSI codes
      local clean = line:gsub("\27%[[%d;]*m", ""):gsub("^%s+", "")
      table.insert(issues, {
        number = tonumber(num),
        display = clean,
        raw = line,
      })
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

-- Fetch issue details for preview
local function fetch_issue_details(issue_number, callback)
  local cmd = get_ghp_path() .. " open " .. issue_number
  vim.fn.jobstart(cmd, {
    stdout_buffered = true,
    on_stdout = function(_, data)
      if data then
        -- Clean ANSI codes
        local clean = {}
        for _, line in ipairs(data) do
          table.insert(clean, line:gsub("\27%[[%d;]*m", ""))
        end
        callback(clean)
      end
    end,
  })
end

-- Create the issue picker
function M.issues(opts)
  opts = opts or {}
  local ghp_args = opts.args or "plan --mine"
  local title = opts.title or "Issues"

  fetch_issues(ghp_args, function(issues)
    if #issues == 0 then
      vim.notify("No issues found", vim.log.levels.INFO)
      return
    end

    pickers.new(opts, {
      prompt_title = title,
      finder = finders.new_table({
        results = issues,
        entry_maker = function(entry)
          return {
            value = entry,
            display = entry.display,
            ordinal = entry.display,
            number = entry.number,
          }
        end,
      }),
      sorter = conf.generic_sorter(opts),
      previewer = previewers.new_buffer_previewer({
        title = "Issue Details",
        define_preview = function(self, entry)
          -- Show loading message
          vim.api.nvim_buf_set_lines(self.state.bufnr, 0, -1, false, { "Loading..." })

          fetch_issue_details(entry.number, function(details)
            if vim.api.nvim_buf_is_valid(self.state.bufnr) then
              vim.api.nvim_buf_set_lines(self.state.bufnr, 0, -1, false, details)
            end
          end)
        end,
      }),
      attach_mappings = function(prompt_bufnr, map)
        -- Enter: Open issue details
        actions.select_default:replace(function()
          local selection = action_state.get_selected_entry()
          actions.close(prompt_bufnr)
          if selection then
            require("ghp.commands").open(tostring(selection.number))
          end
        end)

        -- s: Start working on issue
        map("i", "<C-s>", function()
          local selection = action_state.get_selected_entry()
          actions.close(prompt_bufnr)
          if selection then
            require("ghp.commands").start(tostring(selection.number))
          end
        end)
        map("n", "s", function()
          local selection = action_state.get_selected_entry()
          actions.close(prompt_bufnr)
          if selection then
            require("ghp.commands").start(tostring(selection.number))
          end
        end)

        -- d: Mark as done
        map("i", "<C-d>", function()
          local selection = action_state.get_selected_entry()
          actions.close(prompt_bufnr)
          if selection then
            require("ghp.commands").done(tostring(selection.number))
          end
        end)
        map("n", "d", function()
          local selection = action_state.get_selected_entry()
          actions.close(prompt_bufnr)
          if selection then
            require("ghp.commands").done(tostring(selection.number))
          end
        end)

        -- c: Comment
        map("i", "<C-c>", function()
          local selection = action_state.get_selected_entry()
          actions.close(prompt_bufnr)
          if selection then
            require("ghp.commands").comment(tostring(selection.number))
          end
        end)
        map("n", "c", function()
          local selection = action_state.get_selected_entry()
          actions.close(prompt_bufnr)
          if selection then
            require("ghp.commands").comment(tostring(selection.number))
          end
        end)

        return true
      end,
    }):find()
  end)
end

-- Picker for project board
function M.plan(opts)
  opts = opts or {}
  opts.args = "plan"
  if opts.status then
    opts.args = opts.args .. " --status '" .. opts.status .. "'"
  end
  if opts.mine then
    opts.args = opts.args .. " --mine"
  end
  if opts.shortcut then
    opts.args = opts.args .. " " .. opts.shortcut
  end
  opts.title = " Project Board"
  M.issues(opts)
end

-- Picker for my work
function M.work(opts)
  opts = opts or {}
  opts.args = "work"
  if opts.status then
    opts.args = opts.args .. " --status '" .. opts.status .. "'"
  end
  opts.title = " My Work"
  M.issues(opts)
end

-- Picker for backlog
function M.backlog(opts)
  opts = opts or {}
  opts.args = "plan --status Backlog"
  opts.title = " Backlog"
  M.issues(opts)
end

-- Picker for in progress
function M.in_progress(opts)
  opts = opts or {}
  opts.args = "plan --status 'In Progress' --mine"
  opts.title = " In Progress"
  M.issues(opts)
end

-- Register telescope extension
return telescope.register_extension({
  exports = {
    issues = M.issues,
    plan = M.plan,
    work = M.work,
    backlog = M.backlog,
    in_progress = M.in_progress,
  },
})
