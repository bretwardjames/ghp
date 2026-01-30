local M = {}

M.config = {
  -- Path to ghp CLI (defaults to finding in PATH)
  ghp_path = "ghp",
  -- Picker: "select" (default, uses vim.ui.select/snacks) or "telescope"
  picker = "select",
  -- Default keymaps (set to false to disable all, or override individual)
  keymaps = false, -- Let lazy.nvim handle keymaps by default
  -- Floating window settings
  float = {
    border = "rounded",
    width = 0.8,
    height = 0.8,
  },
  -- Icons (set to false to disable)
  icons = {
    plan = " ",
    work = " ",
    issue = " ",
    pr = " ",
    dashboard = " ",
  },
  -- Parallel worktree settings
  parallel = {
    -- How to open nvim in new worktree: "auto", "tmux", "terminal", or "tab"
    open_mode = "auto", -- auto-detect tmux, fallback to tab
    -- Terminal command for non-tmux (use {path} and {issue} placeholders)
    terminal_cmd = nil, -- e.g., "alacritty --working-directory {path} -e nvim"
    -- Auto-start claude in the new worktree (default: true)
    auto_claude = true,
    -- Claude command to run (default: "claude")
    claude_cmd = "claude", -- e.g., "claude --model opus" or a different CLI
    -- Layout when auto_claude is enabled: "panes" or "windows"
    -- "panes": nvim and claude side-by-side in same tmux window (default)
    -- "windows": nvim and claude in separate tmux windows
    layout = "panes",
  },
  -- Statusline settings (see ghp.statusline for all options)
  statusline = {
    cache_ttl = 30,
    max_title_length = 40,
    format = "#{number} {title}",
    show_status = true,
    icon = " ",
    -- Show warnings for unassigned issues
    show_unassigned_warning = true,
    -- Auto-add to lualine if installed
    auto_lualine = false,
    -- Which lualine section to add to
    lualine_section = "lualine_c",
    -- Hide branch component (redundant with issue display)
    hide_lualine_branch = true,
  },
}

function M.setup(opts)
  M.config = vim.tbl_deep_extend("force", M.config, opts or {})

  -- Set up keymaps if enabled (disabled by default for lazy.nvim users)
  if M.config.keymaps then
    require("ghp.keymaps").setup(M.config.keymaps)
  end

  -- Set up statusline config
  if M.config.statusline then
    require("ghp.statusline").setup(M.config.statusline)
  end

  vim.g.ghp_setup_done = true
end

return M
