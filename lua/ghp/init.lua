local M = {}

M.config = {
  -- Path to ghp CLI (defaults to finding in PATH)
  ghp_path = "ghp",
  -- Default keymaps (set to false to disable all, or override individual)
  keymaps = false, -- Let lazy.nvim handle keymaps by default
  -- Floating window settings
  float = {
    border = "rounded",
    width = 0.8,
    height = 0.8,
  },
}

function M.setup(opts)
  M.config = vim.tbl_deep_extend("force", M.config, opts or {})

  -- Set up keymaps if enabled (disabled by default for lazy.nvim users)
  if M.config.keymaps then
    require("ghp.keymaps").setup(M.config.keymaps)
  end

  vim.g.ghp_setup_done = true
end

return M
