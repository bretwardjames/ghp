local M = {}

local function get_float_config()
  return require("ghp").config.float
end

-- Define highlight groups
local function setup_highlights()
  local highlights = {
    GhpIssueNumber = { fg = "#61afef", bold = true },      -- Blue for #123
    GhpIssueType = { fg = "#e5c07b", bold = true },        -- Yellow for Bug/Feature
    GhpTitle = { fg = "#abb2bf" },                          -- Default text
    GhpAssignee = { fg = "#56b6c2" },                       -- Cyan for @user
    GhpStatus = { fg = "#c678dd" },                         -- Purple for status
    GhpStatusTodo = { fg = "#e06c75" },                     -- Red for Todo/Backlog
    GhpStatusInProgress = { fg = "#e5c07b" },               -- Yellow for In Progress
    GhpStatusDone = { fg = "#98c379" },                     -- Green for Done
    GhpPriority = { fg = "#e06c75", bold = true },          -- Red for priority
    GhpSize = { fg = "#61afef" },                           -- Blue for size
    GhpLabel = { fg = "#c678dd", italic = true },           -- Purple for labels
    GhpDim = { fg = "#5c6370" },                            -- Gray for dim text
    GhpHeader = { fg = "#61afef", bold = true, underline = true },
    GhpBorder = { fg = "#61afef" },
    GhpDraft = { fg = "#5c6370", italic = true },
    GhpFooter = { fg = "#5c6370" },                          -- Gray for footer
    GhpFooterKey = { fg = "#98c379", bold = true },          -- Green for keys
  }

  for name, attrs in pairs(highlights) do
    vim.api.nvim_set_hl(0, name, attrs)
  end
end

-- Apply syntax highlighting to buffer
local function apply_highlights(buf)
  -- Clear existing matches
  vim.fn.clearmatches()

  -- Issue numbers: #123
  vim.fn.matchadd("GhpIssueNumber", "#\\d\\+")

  -- Assignees: @username
  vim.fn.matchadd("GhpAssignee", "@[a-zA-Z0-9_-]\\+")

  -- Draft issues
  vim.fn.matchadd("GhpDraft", "\\<draft\\>")

  -- Common statuses
  vim.fn.matchadd("GhpStatusTodo", "\\<\\(Todo\\|Backlog\\|New\\)\\>")
  vim.fn.matchadd("GhpStatusInProgress", "\\<\\(In Progress\\|In Review\\|Doing\\)\\>")
  vim.fn.matchadd("GhpStatusDone", "\\<\\(Done\\|Closed\\|Complete\\)\\>")

  -- Issue types
  vim.fn.matchadd("GhpIssueType", "\\<\\(Bug\\|Feature\\|Task\\|Enhancement\\|Epic\\|Story\\)\\>")

  -- Priority indicators
  vim.fn.matchadd("GhpPriority", "\\<\\(High\\|Urgent\\|Critical\\|P0\\|P1\\)\\>")
  vim.fn.matchadd("GhpSize", "\\<\\(Small\\|Medium\\|Large\\|XL\\|XXL\\|\\d\\+ points\\?\\)\\>")

  -- Section headers (lines with counts like "Status (5)")
  vim.fn.matchadd("GhpHeader", "^[A-Za-z ]\\+ (\\d\\+)")

  -- Dim lines starting with ─ or ...
  vim.fn.matchadd("GhpDim", "^[─┌┐└┘├┤┬┴┼].*")
  vim.fn.matchadd("GhpDim", "^\\.\\.\\..*")

  -- Footer
  vim.fn.matchadd("GhpFooter", "^  ⏎.*")
  vim.fn.matchadd("GhpFooterKey", "⏎\\|\\<[sdcq]\\>\\|?")
end

function M.show_float(lines, opts)
  opts = opts or {}
  local float_config = get_float_config()

  setup_highlights()

  -- Calculate dimensions
  local width = math.floor(vim.o.columns * float_config.width)
  local height = math.floor(vim.o.lines * float_config.height)
  local row = math.floor((vim.o.lines - height) / 2)
  local col = math.floor((vim.o.columns - width) / 2)

  -- Create buffer
  local buf = vim.api.nvim_create_buf(false, true)

  -- Filter empty lines at end and strip ANSI codes
  local clean_lines = {}
  for _, line in ipairs(lines) do
    -- Strip ANSI escape codes
    local clean = line:gsub("\27%[[%d;]*m", "")
    table.insert(clean_lines, clean)
  end
  while #clean_lines > 0 and clean_lines[#clean_lines] == "" do
    table.remove(clean_lines)
  end

  -- Add footer with keybindings
  table.insert(clean_lines, "")
  table.insert(clean_lines, "─────────────────────────────────────────────────────────────────────────────────")
  table.insert(clean_lines, "  ⏎ Open  │  s Start  │  d Done  │  c Comment  │  ? Help  │  q Close")

  vim.api.nvim_buf_set_lines(buf, 0, -1, false, clean_lines)
  vim.api.nvim_buf_set_option(buf, "modifiable", false)
  vim.api.nvim_buf_set_option(buf, "bufhidden", "wipe")
  vim.api.nvim_buf_set_option(buf, "filetype", "ghp")

  -- Create window with fancy border
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
    title = opts.title and ("  " .. opts.title .. "  ") or nil,
    title_pos = "center",
  })

  -- Set window options
  vim.api.nvim_win_set_option(win, "wrap", false)
  vim.api.nvim_win_set_option(win, "cursorline", true)
  vim.api.nvim_win_set_option(win, "winhighlight", "Normal:Normal,FloatBorder:GhpBorder,CursorLine:Visual")

  -- Apply syntax highlighting
  vim.api.nvim_win_call(win, function()
    apply_highlights(buf)
  end)

  -- Keymaps for the float
  local function close()
    if vim.api.nvim_win_is_valid(win) then
      vim.api.nvim_win_close(win, true)
    end
  end

  vim.keymap.set("n", "q", close, { buffer = buf, silent = true })
  vim.keymap.set("n", "<Esc>", close, { buffer = buf, silent = true })

  -- Open issue under cursor with Enter
  vim.keymap.set("n", "<CR>", function()
    local line = vim.api.nvim_get_current_line()
    local issue_num = line:match("#(%d+)")
    if issue_num then
      close()
      require("ghp.commands").open(issue_num)
    end
  end, { buffer = buf, silent = true })

  -- Start working on issue under cursor with 's'
  vim.keymap.set("n", "s", function()
    local line = vim.api.nvim_get_current_line()
    local issue_num = line:match("#(%d+)")
    if issue_num then
      close()
      require("ghp.commands").start(issue_num)
    end
  end, { buffer = buf, silent = true })

  -- Mark done with 'd'
  vim.keymap.set("n", "d", function()
    local line = vim.api.nvim_get_current_line()
    local issue_num = line:match("#(%d+)")
    if issue_num then
      require("ghp.commands").done(issue_num)
      close()
      -- Refresh the view
      vim.defer_fn(function()
        require("ghp.commands").plan()
      end, 500)
    end
  end, { buffer = buf, silent = true })

  -- Comment with 'c'
  vim.keymap.set("n", "c", function()
    local line = vim.api.nvim_get_current_line()
    local issue_num = line:match("#(%d+)")
    if issue_num then
      close()
      require("ghp.commands").comment(issue_num)
    end
  end, { buffer = buf, silent = true })

  -- Help with '?'
  vim.keymap.set("n", "?", function()
    vim.notify([[
ghp.nvim keymaps:
  q/<Esc>  Close
  <Enter>  Open issue details
  s        Start working on issue
  d        Mark issue as done
  c        Comment on issue
  ?        Show this help
]], vim.log.levels.INFO)
  end, { buffer = buf, silent = true })

  return buf, win
end

function M.show_terminal(cmd)
  local float_config = get_float_config()

  -- Calculate dimensions
  local width = math.floor(vim.o.columns * float_config.width)
  local height = math.floor(vim.o.lines * float_config.height)
  local row = math.floor((vim.o.lines - height) / 2)
  local col = math.floor((vim.o.columns - width) / 2)

  -- Create buffer and window first
  local buf = vim.api.nvim_create_buf(false, true)
  local win = vim.api.nvim_open_win(buf, true, {
    relative = "editor",
    width = width,
    height = height,
    row = row,
    col = col,
    style = "minimal",
    border = float_config.border,
  })

  -- Run terminal in the buffer
  vim.fn.termopen(cmd, {
    on_exit = function(_, code)
      if code == 0 then
        vim.defer_fn(function()
          if vim.api.nvim_win_is_valid(win) then
            vim.api.nvim_win_close(win, true)
          end
        end, 1000)
      end
    end,
  })

  -- Enter insert mode for terminal
  vim.cmd("startinsert")

  return buf, win
end

return M
