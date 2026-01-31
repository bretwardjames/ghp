-- ghp/agents.lua - Agent dashboard for managing running Claude agents
-- Features: floating window display, workspace filtering, preview/attach/kill/refresh,
-- stale agent detection, and tmux integration for switching to agent windows

local M = {}

local get_agent_worktree_path

-- Highlight groups for the agent dashboard
local function setup_highlights()
  local highlights = {
    GhpAgentRunning = { fg = "#98c379", bold = true },
    GhpAgentStopped = { fg = "#e06c75", bold = true },
    GhpAgentWaiting = { fg = "#e5c07b" },
    GhpAgentStale = { fg = "#e06c75", italic = true },
    GhpAgentIssue = { fg = "#61afef", bold = true },
    GhpAgentTitle = { fg = "#abb2bf" },
    GhpAgentUptime = { fg = "#5c6370" },
    GhpAgentAction = { fg = "#c678dd" },
    GhpAgentHeader = { fg = "#61afef", bold = true },
    GhpAgentKey = { fg = "#98c379", bold = true },
    GhpAgentDim = { fg = "#5c6370" },
    GhpAgentSelected = { bg = "#3e4451" },
  }

  for name, attrs in pairs(highlights) do
    vim.api.nvim_set_hl(0, name, attrs)
  end
end

-- Get ghp CLI path from config
local function get_ghp_path()
  return require("ghp").config.ghp_path
end

-- Helper to parse git worktree list --porcelain output
local function parse_worktree_output(result)
  local worktrees = {}
  local current_path = nil

  for line in result:gmatch("[^\n]+") do
    local path = line:match("^worktree (.+)")
    if path then
      current_path = path
    end

    local branch = line:match("^branch refs/heads/(.+)")
    if branch and current_path then
      worktrees[branch] = current_path
    end
  end

  return worktrees
end

-- Get a mapping of branch names to worktree paths
-- Tries current directory first, then scans ~/.ghp/worktrees/ as fallback
-- Returns a table: { ["branch-name"] = "/path/to/worktree", ... }
local function get_worktree_map()
  -- Try multiple strategies to find worktrees

  -- Strategy 1: Try from current directory (works if nvim is in a repo)
  local result = vim.fn.system("git worktree list --porcelain 2>/dev/null")
  if vim.v.shell_error == 0 and result ~= "" then
    return parse_worktree_output(result)
  end

  -- Strategy 2: Scan ~/.ghp/worktrees/ for repos and get their worktree lists
  -- Note: Git worktrees have a .git FILE (not directory) pointing to main repo
  local ghp_worktrees_dir = vim.fn.expand("~/.ghp/worktrees")
  if vim.fn.isdirectory(ghp_worktrees_dir) == 1 then
    -- Find any worktree by looking for .git file or directory
    local find_cmd = string.format("find %s -maxdepth 4 -name '.git' 2>/dev/null | head -1",
      vim.fn.shellescape(ghp_worktrees_dir))
    local git_path = vim.fn.system(find_cmd)
    git_path = vim.trim(git_path)

    if git_path ~= "" then
      local repo_dir = git_path:gsub("/.git$", "")
      result = vim.fn.system(string.format("git -C %s worktree list --porcelain 2>/dev/null",
        vim.fn.shellescape(repo_dir)))
      if vim.v.shell_error == 0 and result ~= "" then
        return parse_worktree_output(result)
      end
    end
  end

  return {}
end

-- Filter agents to only those belonging to the current workspace
local function filter_agents_for_workspace(agents, worktree_map)
  if not agents or #agents == 0 then
    return agents
  end

  local filtered = {}
  for _, agent in ipairs(agents) do
    -- Check if this agent's branch exists in our worktree map
    if agent.branch and worktree_map[agent.branch] then
      -- Add the worktree path to the agent data for later use
      agent._worktree_path = worktree_map[agent.branch]
      table.insert(filtered, agent)
    end
  end

  return filtered
end

-- Run ghp agents list --json and parse output
local function fetch_agents_data(callback, filter_workspace)
  local cmd = get_ghp_path() .. " agents list --json"

  -- Always get worktree map for path lookups (needed for attach even if not filtering)
  local worktree_map = get_worktree_map()

  -- Track if callback has been invoked to prevent double-invocation
  local callback_invoked = false
  local stdout_data = nil
  local stderr_data = nil

  local job_id = vim.fn.jobstart(cmd, {
    stdout_buffered = true,
    stderr_buffered = true,
    on_stdout = function(_, data)
      if data and #data > 0 then
        stdout_data = table.concat(data, "\n")
      end
    end,
    on_stderr = function(_, data)
      if data and #data > 0 then
        local text = table.concat(data, "\n")
        if vim.trim(text) ~= "" then
          stderr_data = text
        end
      end
    end,
    on_exit = function(_, exit_code)
      if callback_invoked then return end
      callback_invoked = true

      vim.schedule(function()
        -- Handle errors first
        if exit_code ~= 0 then
          local error_msg = stderr_data or ("ghp agents list failed with exit code " .. exit_code)
          callback(nil, error_msg)
          return
        end

        -- Handle empty output
        if not stdout_data or vim.trim(stdout_data) == "" then
          callback({}, nil) -- Empty agent list
          return
        end

        -- Parse JSON
        local ok, result = pcall(vim.json.decode, stdout_data)
        if not ok then
          callback(nil, "JSON parse error: " .. tostring(result))
          return
        end

        if not result then
          callback({}, nil)
          return
        end

        -- Add worktree paths to agents
        for _, agent in ipairs(result) do
          if agent.branch and worktree_map[agent.branch] then
            agent._worktree_path = worktree_map[agent.branch]
          end
        end

        -- Filter to workspace if requested
        if filter_workspace then
          result = filter_agents_for_workspace(result, worktree_map)
        end

        callback(result, nil)
      end)
    end,
  })

  -- Check if job started successfully
  if job_id <= 0 then
    local error_msg = job_id == 0
      and "ghp command not executable (check that ghp is installed and in PATH)"
      or "Failed to start ghp agents list"
    callback(nil, error_msg)
  end
end

-- Pad string to width
local function pad(str, width, align)
  local len = vim.fn.strwidth(str)
  if len >= width then
    return string.sub(str, 1, width)
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

-- Truncate string with ellipsis
local function truncate(str, max_len)
  if vim.fn.strwidth(str) <= max_len then
    return str
  end
  return string.sub(str, 1, max_len - 1) .. "…"
end

-- Format agents data into lines for display
local function format_agents(agents, width)
  local lines = {}
  local inner_width = width - 4

  -- Header
  table.insert(lines, "")
  local header = string.format("  %-6s  %-5s  %-7s  %s", "Issue", "State", "Uptime", "Title / Action")
  table.insert(lines, truncate(header, inner_width))
  table.insert(lines, "  " .. string.rep("─", inner_width - 2))

  if not agents or #agents == 0 then
    table.insert(lines, "")
    table.insert(lines, "  No running agents")
    table.insert(lines, "")
  else
    for _, agent in ipairs(agents) do
      -- Status indicator
      local status_icon
      if agent.status == "running" then
        if agent.waitingForInput then
          status_icon = "⏸"
        else
          status_icon = "●"
        end
      else
        status_icon = "○"
      end

      -- Format: [⚠] #123  ● run   3h 2m  Issue title here
      -- ⚠ = stale agent (worktree missing), ● = status icon, run/wait/stop = state
      local is_stale = not agent._worktree_path
      local stale_marker = is_stale and "⚠ " or "  "
      local issue_str = "#" .. tostring(agent.issueNumber)
      local uptime_str = agent.uptime or "?"
      local title_str = agent.issueTitle or "Unknown"

      -- Calculate available width for title
      local fixed_width = 2 + 6 + 2 + 5 + 2 + 7 + 2 -- stale + issue + gap + status + gap + uptime + gap
      local title_width = inner_width - fixed_width - 2
      title_str = truncate(title_str, title_width)

      local line = string.format("%s%-6s  %s %s  %-7s  %s",
        stale_marker,
        issue_str,
        status_icon,
        agent.waitingForInput and "wait" or (agent.status == "running" and "run " or "stop"),
        uptime_str,
        title_str)
      table.insert(lines, line)

      -- Show current action on second line if present
      if agent.currentAction and agent.currentAction ~= "" then
        local action_str = "         └─ " .. truncate(agent.currentAction, inner_width - 14)
        table.insert(lines, action_str)
      end
    end
  end

  -- Footer with keybindings
  table.insert(lines, "")
  table.insert(lines, "  " .. string.rep("─", inner_width - 2))
  table.insert(lines, "  <CR>/p Preview  │  a Attach  │  x Kill  │  r Refresh  │  q Close")

  return lines
end

-- Apply syntax highlighting to agents buffer
local function apply_agents_syntax(buf, agents)
  local ns = vim.api.nvim_create_namespace("ghp_agents")
  vim.api.nvim_buf_clear_namespace(buf, ns, 0, -1)

  local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
  for i, line in ipairs(lines) do
    local row = i - 1

    -- Header line
    if line:match("^  Issue") then
      vim.api.nvim_buf_add_highlight(buf, ns, "GhpAgentHeader", row, 0, -1)
    end

    -- Agent lines - match #number (with possible stale marker)
    local stale_match = line:match("^⚠")
    local issue_match = line:match("#(%d+)")
    if issue_match then
      local issue_start = line:find("#" .. issue_match)
      if issue_start then
        vim.api.nvim_buf_add_highlight(buf, ns, "GhpAgentIssue", row, issue_start - 1, issue_start + #issue_match)
      end

      -- Highlight stale marker
      if stale_match then
        vim.api.nvim_buf_add_highlight(buf, ns, "GhpAgentStale", row, 0, 2)
      end

      -- Status indicator
      if line:match("● run") then
        local start = line:find("●")
        if start then
          vim.api.nvim_buf_add_highlight(buf, ns, "GhpAgentRunning", row, start - 1, start + 5)
        end
      elseif line:match("⏸ wait") then
        local start = line:find("⏸")
        if start then
          vim.api.nvim_buf_add_highlight(buf, ns, "GhpAgentWaiting", row, start - 1, start + 6)
        end
      elseif line:match("○ stop") then
        local start = line:find("○")
        if start then
          vim.api.nvim_buf_add_highlight(buf, ns, "GhpAgentStopped", row, start - 1, start + 5)
        end
      end

      -- Uptime (dim)
      local uptime_start = line:find("%d+[dhms]")
      if uptime_start then
        vim.api.nvim_buf_add_highlight(buf, ns, "GhpAgentUptime", row, uptime_start - 1, uptime_start + 6)
      end
    end

    -- Current action line
    if line:match("^         └─") then
      vim.api.nvim_buf_add_highlight(buf, ns, "GhpAgentAction", row, 0, -1)
    end

    -- Footer keybindings
    if line:match("Attach") then
      vim.api.nvim_buf_add_highlight(buf, ns, "GhpAgentDim", row, 0, -1)
    end

    -- Separator lines
    if line:match("^  ─+$") then
      vim.api.nvim_buf_add_highlight(buf, ns, "GhpAgentDim", row, 0, -1)
    end
  end
end

-- Store current state
M._current_agents = nil
M._current_buf = nil
M._current_win = nil
M._filter_workspace = true -- Default to workspace filtering

-- Get the agent on the current line
local function get_agent_on_line()
  if not M._current_agents then return nil end

  local line = vim.api.nvim_get_current_line()
  local issue_num = line:match("#(%d+)")
  if not issue_num then return nil end

  issue_num = tonumber(issue_num)
  for _, agent in ipairs(M._current_agents) do
    if agent.issueNumber == issue_num then
      return agent
    end
  end
  return nil
end

-- Kill the selected agent
local function kill_agent(agent)
  if not agent then
    vim.notify("No agent selected", vim.log.levels.WARN)
    return
  end

  local issue_num = tonumber(agent.issueNumber)
  if not issue_num then
    vim.notify("Invalid agent issue number", vim.log.levels.ERROR)
    return
  end

  local cmd = get_ghp_path() .. " agents stop " .. issue_num
  local stderr_output = nil

  local job_id = vim.fn.jobstart(cmd, {
    stderr_buffered = true,
    on_stderr = function(_, data)
      if data and #data > 0 then
        local text = table.concat(data, "\n")
        if vim.trim(text) ~= "" then
          stderr_output = text
        end
      end
    end,
    on_exit = function(_, code)
      vim.schedule(function()
        if code == 0 then
          vim.notify("Stopped agent for #" .. issue_num, vim.log.levels.INFO)
          M.refresh()
        else
          local error_msg = stderr_output or "Unknown error"
          vim.notify("Failed to stop agent: " .. vim.trim(error_msg), vim.log.levels.ERROR)
        end
      end)
    end,
  })

  if job_id <= 0 then
    local error_msg = job_id == 0
      and "ghp command not executable"
      or "Failed to start ghp agents stop"
    vim.notify("Failed to stop agent: " .. error_msg, vim.log.levels.ERROR)
  end
end

-- Find the tmux target (session:window) for an agent
-- Searches all tmux sessions for windows matching:
--   1. The issue number
--   2. The worktree path
--   3. Issue number extracted from branch name
-- Returns session:window_index string (e.g., "ghp:2") or nil if not found
local function find_agent_tmux_target(agent, worktree_path)
  local search_patterns = {
    tostring(agent.issueNumber),
  }
  if worktree_path then
    table.insert(search_patterns, worktree_path)
  end
  if agent.branch then
    local issue_from_branch = agent.branch:match("/(%d+)-")
    if issue_from_branch then
      table.insert(search_patterns, issue_from_branch)
    end
  end

  -- List all windows across all sessions
  local list_cmd = "tmux list-windows -a -F '#{session_name}:#{window_index}:#{window_name}:#{pane_current_path}' 2>/dev/null"
  local all_windows = vim.fn.system(list_cmd)

  if vim.v.shell_error == 0 and all_windows ~= "" then
    for window_line in all_windows:gmatch("[^\n]+") do
      for _, pattern in ipairs(search_patterns) do
        if window_line:find(pattern, 1, true) then
          local session, window_index = window_line:match("^([^:]+):(%d+):")
          if session and window_index then
            return session .. ":" .. window_index
          end
        end
      end
    end
  end

  return nil
end

-- Preview agent's tmux pane content in a floating window
local function preview_agent(agent)
  if not agent then
    vim.notify("No agent selected", vim.log.levels.WARN)
    return
  end

  local worktree_path = get_agent_worktree_path(agent)
  local tmux_target = find_agent_tmux_target(agent, worktree_path)

  if not tmux_target then
    vim.notify("Agent not found in any tmux window", vim.log.levels.WARN)
    return
  end

  -- Capture the pane content
  local capture_cmd = string.format("tmux capture-pane -t %s -p -S -100 2>&1",
    vim.fn.shellescape(tmux_target))
  local content = vim.fn.system(capture_cmd)

  if vim.v.shell_error ~= 0 then
    vim.notify("Failed to capture pane: " .. vim.trim(content), vim.log.levels.ERROR)
    return
  end

  if content == "" then
    vim.notify("Pane content is empty - agent may not have produced output yet", vim.log.levels.WARN)
    return
  end

  -- Create a floating preview buffer
  local lines = vim.split(content, "\n")

  local width = math.floor(vim.o.columns * 0.8)
  local height = math.floor(vim.o.lines * 0.7)
  local row = math.floor((vim.o.lines - height) / 2)
  local col = math.floor((vim.o.columns - width) / 2)

  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.api.nvim_buf_set_option(buf, "modifiable", false)
  vim.api.nvim_buf_set_option(buf, "buftype", "nofile")
  vim.api.nvim_buf_set_option(buf, "filetype", "ghp_agent_preview")

  local win = vim.api.nvim_open_win(buf, true, {
    relative = "editor",
    width = width,
    height = height,
    row = row,
    col = col,
    style = "minimal",
    border = "rounded",
    title = string.format("  Preview: #%d (%s)  ", agent.issueNumber, tmux_target),
    title_pos = "center",
  })

  vim.api.nvim_win_set_option(win, "wrap", false)
  vim.api.nvim_win_set_option(win, "cursorline", true)

  -- Jump to bottom (most recent output)
  vim.api.nvim_win_set_cursor(win, { #lines, 0 })

  -- Keymaps for preview window
  local opts = { buffer = buf, silent = true, nowait = true }

  -- Close preview, return to agent list
  vim.keymap.set("n", "q", function()
    vim.api.nvim_win_close(win, true)
  end, opts)

  vim.keymap.set("n", "<Esc>", function()
    vim.api.nvim_win_close(win, true)
  end, opts)

  -- Full attach from preview
  vim.keymap.set("n", "a", function()
    vim.api.nvim_win_close(win, true)
    -- Close the agent list too if still open
    if M._current_win and vim.api.nvim_win_is_valid(M._current_win) then
      vim.api.nvim_win_close(M._current_win, true)
    end
    M._current_buf = nil
    M._current_win = nil
    -- Switch to tmux
    local result = vim.fn.system("tmux switch-client -t " .. vim.fn.shellescape(tmux_target))
    if vim.v.shell_error ~= 0 then
      vim.notify("Failed to switch to " .. tmux_target .. ": " .. vim.trim(result), vim.log.levels.ERROR)
    else
      vim.notify("Switched to " .. tmux_target, vim.log.levels.INFO)
    end
  end, opts)

  -- Refresh preview
  vim.keymap.set("n", "r", function()
    local new_content = vim.fn.system(capture_cmd)
    if vim.v.shell_error ~= 0 then
      vim.notify("Failed to refresh - pane may no longer exist", vim.log.levels.ERROR)
    elseif new_content == "" then
      vim.notify("Pane content is empty", vim.log.levels.WARN)
    else
      local new_lines = vim.split(new_content, "\n")
      vim.api.nvim_buf_set_option(buf, "modifiable", true)
      vim.api.nvim_buf_set_lines(buf, 0, -1, false, new_lines)
      vim.api.nvim_buf_set_option(buf, "modifiable", false)
      vim.api.nvim_win_set_cursor(win, { #new_lines, 0 })
      vim.notify("Refreshed", vim.log.levels.INFO)
    end
  end, opts)
end

-- Get the worktree path for an agent (looks it up if not cached)
get_agent_worktree_path = function(agent)
  -- Use cached path if available
  if agent._worktree_path then
    return agent._worktree_path
  end

  -- Look it up from git worktree list
  if agent.branch then
    local worktree_map = get_worktree_map()
    return worktree_map[agent.branch]
  end

  return nil
end

-- Attach to the selected agent
local function attach_agent(agent)
  if not agent then
    vim.notify("No agent selected", vim.log.levels.WARN)
    return
  end

  -- Close the agents window first
  if M._current_win and vim.api.nvim_win_is_valid(M._current_win) then
    vim.api.nvim_win_close(M._current_win, true)
  end
  M._current_buf = nil
  M._current_win = nil

  -- Get the worktree path for this agent
  local worktree_path = get_agent_worktree_path(agent)
  if not worktree_path then
    vim.notify(
      "Could not find worktree for agent #" .. agent.issueNumber ..
      ". The worktree may have been deleted.",
      vim.log.levels.ERROR
    )
    return
  end

  -- Check if we're in tmux
  local in_tmux = vim.env.TMUX ~= nil

  if in_tmux then
    -- Search ALL tmux sessions for a window matching this agent
    -- Use -a flag to list windows across all sessions
    local search_patterns = {
      tostring(agent.issueNumber),
      worktree_path,
    }
    if agent.branch then
      -- Extract issue number from branch for matching
      local issue_from_branch = agent.branch:match("/(%d+)-")
      if issue_from_branch then
        table.insert(search_patterns, issue_from_branch)
      end
    end

    -- List all windows across all sessions with format: session:index:name:path
    local list_cmd = "tmux list-windows -a -F '#{session_name}:#{window_index}:#{window_name}:#{pane_current_path}' 2>/dev/null"
    local all_windows = vim.fn.system(list_cmd)

    if vim.v.shell_error ~= 0 then
      vim.notify("Warning: Could not list tmux windows. Creating new window.", vim.log.levels.WARN)
    elseif all_windows ~= "" then
      -- Search for matching window
      for window_line in all_windows:gmatch("[^\n]+") do
        for _, pattern in ipairs(search_patterns) do
          if window_line:find(pattern, 1, true) then
            -- Found a match - extract session:window_index
            local session, window_index = window_line:match("^([^:]+):(%d+):")
            if session and window_index then
              local target = session .. ":" .. window_index
              local result = vim.fn.system("tmux switch-client -t " .. vim.fn.shellescape(target))
              if vim.v.shell_error ~= 0 then
                vim.notify("Failed to switch to " .. target .. ": " .. vim.trim(result), vim.log.levels.ERROR)
              else
                vim.notify("Switched to " .. target, vim.log.levels.INFO)
              end
              return
            end
          end
        end
      end
    end

    -- No existing window found - create new tmux window with claude --resume in the worktree
    vim.notify("Creating new tmux window for agent in " .. worktree_path, vim.log.levels.INFO)
    local new_window_cmd = string.format(
      "tmux new-window -n 'agent-%d' 'cd %s && claude --resume %s'",
      agent.issueNumber,
      vim.fn.shellescape(worktree_path),
      vim.fn.shellescape(agent.id)
    )
    local result = vim.fn.system(new_window_cmd)
    if vim.v.shell_error ~= 0 then
      vim.notify("Failed to create tmux window: " .. vim.trim(result), vim.log.levels.ERROR)
    end
  else
    -- Not in tmux - open terminal in nvim with correct directory
    vim.cmd("tabnew")
    vim.cmd("lcd " .. vim.fn.fnameescape(worktree_path))
    local term_job_id = vim.fn.termopen(string.format("claude --resume %s", vim.fn.shellescape(agent.id)), {
      cwd = worktree_path,
      on_exit = function(_, exit_code)
        if exit_code == 0 then
          vim.notify("Agent session ended normally", vim.log.levels.INFO)
        else
          vim.notify("Agent session exited with error (code " .. exit_code .. ")", vim.log.levels.WARN)
        end
      end,
    })

    if term_job_id <= 0 then
      local error_msg = term_job_id == 0
        and "claude command not executable"
        or "Failed to open terminal"
      vim.notify("Failed to attach: " .. error_msg, vim.log.levels.ERROR)
      vim.cmd("tabclose")
      return
    end

    vim.cmd("startinsert")
  end
end

-- Set up keymaps for the agents buffer
local function setup_keymaps(buf, win)
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

  -- Kill agent (x = close/delete)
  vim.keymap.set("n", "x", function()
    local agent = get_agent_on_line()
    if agent then
      -- Confirm before killing
      vim.ui.select({ "Yes", "No" }, {
        prompt = "Kill agent for #" .. agent.issueNumber .. "?",
      }, function(choice)
        if choice == "Yes" then
          kill_agent(agent)
        end
      end)
    else
      vim.notify("Move cursor to an agent line", vim.log.levels.WARN)
    end
  end, opts)

  -- Preview agent (quick look at tmux pane)
  vim.keymap.set("n", "<CR>", function()
    local agent = get_agent_on_line()
    preview_agent(agent)
  end, opts)

  vim.keymap.set("n", "p", function()
    local agent = get_agent_on_line()
    preview_agent(agent)
  end, opts)

  -- Full attach to agent (switch to tmux window)
  vim.keymap.set("n", "a", function()
    local agent = get_agent_on_line()
    attach_agent(agent)
  end, opts)

  -- Refresh
  vim.keymap.set("n", "r", function()
    M.refresh()
  end, opts)

  -- Help
  vim.keymap.set("n", "?", function()
    vim.notify([[
GHP Agents Keymaps:
  <CR>/p Preview agent output (quick look)
  a      Full attach (switch to tmux window)
  x      Kill/stop the selected agent
  r      Refresh agent list
  q/Esc  Close window

Tip: Use :GhpAgents! to show all agents (not just workspace)
]], vim.log.levels.INFO)
  end, opts)
end

-- Create a floating window with the agent list
-- opts.workspace: if false, show all agents; if true/nil (default), show workspace only
-- opts.width, opts.height: override default floating window dimensions (0.0-1.0)
function M.show_float(opts)
  opts = opts or {}
  local float_config = require("ghp").config.float

  -- Determine if we should filter to workspace (default: true)
  local filter_workspace = opts.workspace ~= false
  M._filter_workspace = filter_workspace

  setup_highlights()

  -- Always get worktree map for path lookups, filter if requested
  fetch_agents_data(function(agents, err)
    if err then
      vim.notify("Agents error: " .. err, vim.log.levels.ERROR)
      return
    end

    vim.schedule(function()
      local title_suffix = filter_workspace and " (workspace)" or " (all)"
      -- Calculate dimensions
      local width = math.floor(vim.o.columns * (opts.width or float_config.width or 0.7))
      local height = math.floor(vim.o.lines * (opts.height or float_config.height or 0.5))
      local row = math.floor((vim.o.lines - height) / 2)
      local col = math.floor((vim.o.columns - width) / 2)

      -- Create buffer
      local buf = vim.api.nvim_create_buf(false, true)
      vim.api.nvim_buf_set_option(buf, "buftype", "nofile")
      vim.api.nvim_buf_set_option(buf, "bufhidden", "wipe")
      vim.api.nvim_buf_set_option(buf, "swapfile", false)

      -- Format and display
      local lines = format_agents(agents, width - 4)
      vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
      vim.api.nvim_buf_set_option(buf, "modifiable", false)
      vim.api.nvim_buf_set_option(buf, "filetype", "ghp_agents")

      -- Create window
      local border_chars = float_config.border or "rounded"
      if border_chars == "rounded" then
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
        title = "  Agents (" .. #agents .. " running)" .. title_suffix .. "  ",
        title_pos = "center",
      })

      -- Set window options
      vim.api.nvim_win_set_option(win, "wrap", false)
      vim.api.nvim_win_set_option(win, "cursorline", true)
      vim.api.nvim_win_set_option(win, "winhighlight", "Normal:Normal,FloatBorder:GhpAgentHeader,CursorLine:GhpAgentSelected")

      -- Apply highlighting
      apply_agents_syntax(buf, agents)

      -- Set up keymaps
      setup_keymaps(buf, win)

      -- Store state
      M._current_agents = agents
      M._current_buf = buf
      M._current_win = win

      -- Move cursor to first agent line (line 4)
      vim.api.nvim_win_set_cursor(win, { 4, 0 })
    end)
  end, filter_workspace)
end

-- Refresh current agents window
function M.refresh()
  if not M._current_buf or not vim.api.nvim_buf_is_valid(M._current_buf) then
    vim.notify("No agents window to refresh", vim.log.levels.WARN)
    return
  end

  local buf = M._current_buf
  local win = M._current_win
  local filter_workspace = M._filter_workspace

  fetch_agents_data(function(agents, err)
    if err then
      vim.notify("Agents refresh error: " .. err, vim.log.levels.ERROR)
      return
    end

    vim.schedule(function()
      if not vim.api.nvim_buf_is_valid(buf) then
        return
      end

      local title_suffix = filter_workspace and " (workspace)" or " (all)"

      -- Get window width for formatting
      local width = 60
      if win and vim.api.nvim_win_is_valid(win) then
        width = vim.api.nvim_win_get_width(win) - 4

        -- Update title
        vim.api.nvim_win_set_config(win, {
          title = "  Agents (" .. #agents .. " running)" .. title_suffix .. "  ",
          title_pos = "center",
        })
      end

      -- Update buffer content
      vim.api.nvim_buf_set_option(buf, "modifiable", true)
      local lines = format_agents(agents, width)
      vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
      vim.api.nvim_buf_set_option(buf, "modifiable", false)

      -- Reapply highlighting
      apply_agents_syntax(buf, agents)

      -- Update state
      M._current_agents = agents

      vim.notify("Refreshed", vim.log.levels.INFO)
    end)
  end, filter_workspace)
end

return M
