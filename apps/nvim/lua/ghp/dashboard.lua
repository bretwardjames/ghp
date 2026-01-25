-- ghp/dashboard.lua - Branch dashboard buffer integration
-- Displays branch changes, commits, and files in a dedicated buffer

local M = {}

-- Border characters for drawing the dashboard
local border = {
  top_left = "╔",
  top_right = "╗",
  bottom_left = "╚",
  bottom_right = "╝",
  horizontal = "═",
  vertical = "║",
  t_left = "╠",
  t_right = "╣",
  t_top = "╦",
  t_bottom = "╩",
  cross = "╬",
}

-- Highlight groups for the dashboard
local function setup_dashboard_highlights()
  local highlights = {
    GhpDashboardBorder = { fg = "#61afef" },
    GhpDashboardTitle = { fg = "#61afef", bold = true },
    GhpDashboardBranch = { fg = "#98c379", bold = true },
    GhpDashboardBase = { fg = "#5c6370" },
    GhpDashboardStats = { fg = "#c678dd" },
    GhpDashboardAdded = { fg = "#98c379" },
    GhpDashboardModified = { fg = "#e5c07b" },
    GhpDashboardDeleted = { fg = "#e06c75" },
    GhpDashboardRenamed = { fg = "#61afef" },
    GhpDashboardHash = { fg = "#e5c07b" },
    GhpDashboardSubject = { fg = "#abb2bf" },
    GhpDashboardSection = { fg = "#61afef", bold = true },
    GhpDashboardDim = { fg = "#5c6370" },
    GhpDashboardKey = { fg = "#98c379", bold = true },
    GhpDashboardInsertion = { fg = "#98c379" },
    GhpDashboardDeletion = { fg = "#e06c75" },
  }

  for name, attrs in pairs(highlights) do
    vim.api.nvim_set_hl(0, name, attrs)
  end
end

-- Get ghp CLI path from config
local function get_ghp_path()
  return require("ghp").config.ghp_path
end

-- Run ghp dashboard --json and parse output
local function fetch_dashboard_data(callback)
  local cmd = get_ghp_path() .. " dashboard --json"
  vim.fn.jobstart(cmd, {
    stdout_buffered = true,
    on_stdout = function(_, data)
      if data and #data > 0 then
        local json_str = table.concat(data, "\n")
        -- Try to parse JSON
        local ok, parsed = pcall(vim.json.decode, json_str)
        if ok and parsed then
          callback(parsed, nil)
        else
          callback(nil, "Failed to parse dashboard data")
        end
      end
    end,
    on_stderr = function(_, data)
      if data and data[1] ~= "" then
        callback(nil, table.concat(data, "\n"))
      end
    end,
  })
end

-- Build a horizontal line
local function make_line(width, left_char, mid_char, right_char)
  return left_char .. string.rep(mid_char, width - 2) .. right_char
end

-- Pad string to width
local function pad(str, width, align)
  local len = vim.fn.strwidth(str)
  if len >= width then
    return str
  end
  local padding = width - len
  if align == "center" then
    local left = math.floor(padding / 2)
    local right = padding - left
    return string.rep(" ", left) .. str .. string.rep(" ", right)
  elseif align == "right" then
    return string.rep(" ", padding) .. str
  else
    return str .. string.rep(" ", padding)
  end
end

-- Format dashboard data into lines for display
local function format_dashboard(data, width)
  local lines = {}
  local inner_width = width - 4 -- Account for borders and padding

  -- Top border with title
  local title = "  Branch Dashboard: " .. data.branch .. "  "
  local title_width = vim.fn.strwidth(title)
  local border_left = math.floor((width - title_width - 2) / 2)
  local border_right = width - title_width - border_left - 2
  table.insert(lines, border.top_left .. string.rep(border.horizontal, border_left) .. title .. string.rep(border.horizontal, border_right) .. border.top_right)

  -- Base branch
  local base_line = "  Base: " .. data.baseBranch
  table.insert(lines, border.vertical .. pad(base_line, width - 2, "left") .. border.vertical)

  -- Separator
  table.insert(lines, border.t_left .. string.rep(border.horizontal, width - 2) .. border.t_right)

  -- Stats header
  local stats_text = string.format("  Files Changed (%d)  |  +%d  -%d",
    data.stats.filesChanged,
    data.stats.insertions,
    data.stats.deletions)
  table.insert(lines, border.vertical .. pad(stats_text, width - 2, "left") .. border.vertical)

  -- Thin separator
  table.insert(lines, border.vertical .. "  " .. string.rep("-", width - 6) .. "  " .. border.vertical)

  -- File list
  if data.files and #data.files > 0 then
    for _, file in ipairs(data.files) do
      local status_icon
      if file.status == "added" then
        status_icon = "+"
      elseif file.status == "deleted" then
        status_icon = "-"
      elseif file.status == "renamed" then
        status_icon = ">"
      else
        status_icon = "~"
      end
      local file_line = "  " .. status_icon .. " " .. file.path
      -- Truncate if too long
      if vim.fn.strwidth(file_line) > inner_width then
        file_line = string.sub(file_line, 1, inner_width - 3) .. "..."
      end
      table.insert(lines, border.vertical .. pad(file_line, width - 2, "left") .. border.vertical)
    end
  else
    table.insert(lines, border.vertical .. pad("  (no files changed)", width - 2, "left") .. border.vertical)
  end

  -- Separator before commits
  table.insert(lines, border.t_left .. string.rep(border.horizontal, width - 2) .. border.t_right)

  -- Commits section
  local commits_header = string.format("  Commits (%d)", data.commits and #data.commits or 0)
  table.insert(lines, border.vertical .. pad(commits_header, width - 2, "left") .. border.vertical)

  if data.commits and #data.commits > 0 then
    for _, commit in ipairs(data.commits) do
      local commit_line = "  " .. commit.hash .. " " .. commit.subject
      -- Truncate if too long
      if vim.fn.strwidth(commit_line) > inner_width then
        commit_line = string.sub(commit_line, 1, inner_width - 3) .. "..."
      end
      table.insert(lines, border.vertical .. pad(commit_line, width - 2, "left") .. border.vertical)
    end
  else
    table.insert(lines, border.vertical .. pad("  (no commits)", width - 2, "left") .. border.vertical)
  end

  -- Bottom border
  table.insert(lines, border.bottom_left .. string.rep(border.horizontal, width - 2) .. border.bottom_right)

  -- Keybindings footer (outside box)
  table.insert(lines, "")
  table.insert(lines, "  <CR> Open file  |  d Diff  |  c Commits  |  r Refresh  |  q Close")

  return lines
end

-- Apply syntax highlighting to dashboard buffer
local function apply_dashboard_syntax(buf)
  -- Use extmarks for highlighting
  local ns = vim.api.nvim_create_namespace("ghp_dashboard")

  local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
  for i, line in ipairs(lines) do
    local row = i - 1

    -- Border characters
    if line:match("^[" .. border.top_left .. border.bottom_left .. border.t_left .. border.vertical .. "]") then
      -- Highlight whole line as border, but we'll override specific parts
    end

    -- Status icons in file list
    local status_match = line:match("^" .. border.vertical .. "  ([+~->])")
    if status_match then
      local col = 3 -- After border and spaces
      if status_match == "+" then
        vim.api.nvim_buf_add_highlight(buf, ns, "GhpDashboardAdded", row, col, col + 1)
      elseif status_match == "-" then
        vim.api.nvim_buf_add_highlight(buf, ns, "GhpDashboardDeleted", row, col, col + 1)
      elseif status_match == "~" then
        vim.api.nvim_buf_add_highlight(buf, ns, "GhpDashboardModified", row, col, col + 1)
      elseif status_match == ">" then
        vim.api.nvim_buf_add_highlight(buf, ns, "GhpDashboardRenamed", row, col, col + 1)
      end
    end

    -- Commit hashes (7 char hex after border)
    local hash_match = line:match("^" .. border.vertical .. "  (%x%x%x%x%x%x%x)")
    if hash_match then
      vim.api.nvim_buf_add_highlight(buf, ns, "GhpDashboardHash", row, 3, 10)
    end

    -- Stats line
    if line:match("Files Changed") then
      -- Highlight + and - numbers
      local plus_start, plus_end = line:find("+%d+")
      if plus_start then
        vim.api.nvim_buf_add_highlight(buf, ns, "GhpDashboardInsertion", row, plus_start - 1, plus_end)
      end
      local minus_start, minus_end = line:find("-%d+")
      if minus_start then
        vim.api.nvim_buf_add_highlight(buf, ns, "GhpDashboardDeletion", row, minus_start - 1, minus_end)
      end
    end

    -- Section headers
    if line:match("Commits %(%d+%)") or line:match("Files Changed") then
      vim.api.nvim_buf_add_highlight(buf, ns, "GhpDashboardSection", row, 0, -1)
    end

    -- Footer keybindings
    if line:match("<CR>") then
      vim.api.nvim_buf_add_highlight(buf, ns, "GhpDashboardDim", row, 0, -1)
    end
  end
end

-- Store current dashboard data for refresh
M._current_data = nil
M._current_buf = nil
M._current_win = nil

-- Set up keymaps for the dashboard buffer
local function setup_dashboard_keymaps(buf, win, data)
  local opts = { buffer = buf, silent = true, nowait = true }

  -- Close
  vim.keymap.set("n", "q", function()
    if vim.api.nvim_win_is_valid(win) then
      vim.api.nvim_win_close(win, true)
    end
    M._current_buf = nil
    M._current_win = nil
  end, opts)

  vim.keymap.set("n", "<Esc>", function()
    if vim.api.nvim_win_is_valid(win) then
      vim.api.nvim_win_close(win, true)
    end
    M._current_buf = nil
    M._current_win = nil
  end, opts)

  -- Open file under cursor
  vim.keymap.set("n", "<CR>", function()
    local line = vim.api.nvim_get_current_line()
    -- Extract file path from line (after status icon)
    local file_path = line:match("^" .. border.vertical .. "  [+~->] (.+)" .. border.vertical .. "$")
    if file_path then
      file_path = vim.trim(file_path)
      -- Close dashboard and open file
      if vim.api.nvim_win_is_valid(win) then
        vim.api.nvim_win_close(win, true)
      end
      M._current_buf = nil
      M._current_win = nil
      vim.cmd("edit " .. vim.fn.fnameescape(file_path))
    end
  end, opts)

  -- Show diff for file under cursor
  vim.keymap.set("n", "d", function()
    local line = vim.api.nvim_get_current_line()
    local file_path = line:match("^" .. border.vertical .. "  [+~->] (.+)" .. border.vertical .. "$")
    if file_path then
      file_path = vim.trim(file_path)
      -- Open diff in vertical split
      if vim.api.nvim_win_is_valid(win) then
        vim.api.nvim_win_close(win, true)
      end
      M._current_buf = nil
      M._current_win = nil
      -- Use git diff
      local base = data.baseBranch or "main"
      vim.cmd("vnew")
      vim.cmd("setlocal buftype=nofile bufhidden=wipe noswapfile")
      vim.cmd("setlocal filetype=diff")
      vim.fn.termopen("git diff " .. base .. "...HEAD -- " .. vim.fn.shellescape(file_path))
    end
  end, opts)

  -- Commits tab (show only commits)
  vim.keymap.set("n", "c", function()
    -- Close current and open with commits focus
    if vim.api.nvim_win_is_valid(win) then
      vim.api.nvim_win_close(win, true)
    end
    M._current_buf = nil
    M._current_win = nil
    -- Run ghp dashboard --commits in a terminal
    require("ghp.ui").show_terminal("ghp dashboard --commits")
  end, opts)

  -- Refresh
  vim.keymap.set("n", "r", function()
    M.refresh()
  end, opts)

  -- Help
  vim.keymap.set("n", "?", function()
    vim.notify([[
GHP Dashboard Keymaps:
  <CR>   Open file under cursor
  d      Show diff for file under cursor
  c      Show commits view
  r      Refresh dashboard
  q/Esc  Close dashboard
]], vim.log.levels.INFO)
  end, opts)
end

-- Create a split window with the dashboard
function M.show_split(opts)
  opts = opts or {}
  local split_cmd = opts.vertical and "vnew" or "new"
  local width = opts.width or 60

  setup_dashboard_highlights()

  fetch_dashboard_data(function(data, err)
    if err then
      vim.notify("Dashboard error: " .. err, vim.log.levels.ERROR)
      return
    end

    vim.schedule(function()
      -- Create split
      vim.cmd(split_cmd)
      local buf = vim.api.nvim_get_current_buf()
      local win = vim.api.nvim_get_current_win()

      -- Set buffer options
      vim.api.nvim_buf_set_option(buf, "buftype", "nofile")
      vim.api.nvim_buf_set_option(buf, "bufhidden", "wipe")
      vim.api.nvim_buf_set_option(buf, "swapfile", false)
      vim.api.nvim_buf_set_option(buf, "modifiable", true)
      vim.api.nvim_buf_set_name(buf, "ghp://dashboard")

      -- Get actual window width
      local win_width = vim.api.nvim_win_get_width(win)
      local display_width = math.min(win_width - 2, width)

      -- Format and display
      local lines = format_dashboard(data, display_width)
      vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
      vim.api.nvim_buf_set_option(buf, "modifiable", false)
      vim.api.nvim_buf_set_option(buf, "filetype", "ghp_dashboard")

      -- Apply highlighting
      apply_dashboard_syntax(buf)

      -- Set up keymaps
      setup_dashboard_keymaps(buf, win, data)

      -- Store state
      M._current_data = data
      M._current_buf = buf
      M._current_win = win
    end)
  end)
end

-- Create a floating window with the dashboard
function M.show_float(opts)
  opts = opts or {}
  local float_config = require("ghp").config.float

  setup_dashboard_highlights()

  fetch_dashboard_data(function(data, err)
    if err then
      vim.notify("Dashboard error: " .. err, vim.log.levels.ERROR)
      return
    end

    vim.schedule(function()
      -- Calculate dimensions
      local width = math.floor(vim.o.columns * (opts.width or float_config.width))
      local height = math.floor(vim.o.lines * (opts.height or float_config.height))
      local row = math.floor((vim.o.lines - height) / 2)
      local col = math.floor((vim.o.columns - width) / 2)

      -- Create buffer
      local buf = vim.api.nvim_create_buf(false, true)
      vim.api.nvim_buf_set_option(buf, "buftype", "nofile")
      vim.api.nvim_buf_set_option(buf, "bufhidden", "wipe")
      vim.api.nvim_buf_set_option(buf, "swapfile", false)

      -- Format and display
      local display_width = width - 4 -- Account for window padding
      local lines = format_dashboard(data, display_width)
      vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
      vim.api.nvim_buf_set_option(buf, "modifiable", false)
      vim.api.nvim_buf_set_option(buf, "filetype", "ghp_dashboard")

      -- Create window
      local border_chars = float_config.border
      if float_config.border == "rounded" then
        border_chars = { "╭", "─", "╮", "│", "╯", "─", "╰", "│" }
      end

      local win = vim.api.nvim_open_win(buf, true, {
        relative = "editor",
        width = width,
        height = height,
        row = row,
        col = col,
        style = "minimal",
        border = border_chars,
        title = "  Branch Dashboard  ",
        title_pos = "center",
      })

      -- Set window options
      vim.api.nvim_win_set_option(win, "wrap", false)
      vim.api.nvim_win_set_option(win, "cursorline", true)
      vim.api.nvim_win_set_option(win, "winhighlight", "Normal:Normal,FloatBorder:GhpDashboardBorder,CursorLine:Visual")

      -- Apply highlighting
      apply_dashboard_syntax(buf)

      -- Set up keymaps
      setup_dashboard_keymaps(buf, win, data)

      -- Store state
      M._current_data = data
      M._current_buf = buf
      M._current_win = win
    end)
  end)
end

-- Refresh current dashboard
function M.refresh()
  if not M._current_buf or not vim.api.nvim_buf_is_valid(M._current_buf) then
    vim.notify("No dashboard to refresh", vim.log.levels.WARN)
    return
  end

  local buf = M._current_buf
  local win = M._current_win

  fetch_dashboard_data(function(data, err)
    if err then
      vim.notify("Dashboard refresh error: " .. err, vim.log.levels.ERROR)
      return
    end

    vim.schedule(function()
      if not vim.api.nvim_buf_is_valid(buf) then
        return
      end

      -- Get window width for formatting
      local width = 60
      if win and vim.api.nvim_win_is_valid(win) then
        width = vim.api.nvim_win_get_width(win) - 4
      end

      -- Update buffer content
      vim.api.nvim_buf_set_option(buf, "modifiable", true)
      local lines = format_dashboard(data, width)
      vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
      vim.api.nvim_buf_set_option(buf, "modifiable", false)

      -- Reapply highlighting
      apply_dashboard_syntax(buf)

      -- Update state
      M._current_data = data

      vim.notify("Dashboard refreshed", vim.log.levels.INFO)
    end)
  end)
end

return M
