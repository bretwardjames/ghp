local M = {}

local function get_float_config()
  return require("ghp").config.float
end

function M.show_float(lines, opts)
  opts = opts or {}
  local float_config = get_float_config()

  -- Calculate dimensions
  local width = math.floor(vim.o.columns * float_config.width)
  local height = math.floor(vim.o.lines * float_config.height)
  local row = math.floor((vim.o.lines - height) / 2)
  local col = math.floor((vim.o.columns - width) / 2)

  -- Create buffer
  local buf = vim.api.nvim_create_buf(false, true)

  -- Filter empty lines at end
  while #lines > 0 and lines[#lines] == "" do
    table.remove(lines)
  end

  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.api.nvim_buf_set_option(buf, "modifiable", false)
  vim.api.nvim_buf_set_option(buf, "bufhidden", "wipe")
  vim.api.nvim_buf_set_option(buf, "filetype", "ghp")

  -- Create window
  local win = vim.api.nvim_open_win(buf, true, {
    relative = "editor",
    width = width,
    height = height,
    row = row,
    col = col,
    style = "minimal",
    border = float_config.border,
    title = opts.title and (" " .. opts.title .. " ") or nil,
    title_pos = "center",
  })

  -- Set window options
  vim.api.nvim_win_set_option(win, "wrap", false)
  vim.api.nvim_win_set_option(win, "cursorline", true)

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
