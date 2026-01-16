-- ghp.nvim - GitHub Projects CLI integration for Neovim
-- Requires: ghp-cli (npm install -g ghp-cli)

if vim.g.loaded_ghp then
  return
end
vim.g.loaded_ghp = true

-- Lazy load on first command use
local function ensure_setup()
  if not vim.g.ghp_setup_done then
    require("ghp").setup()
    vim.g.ghp_setup_done = true
  end
end

-- Create commands that auto-setup
vim.api.nvim_create_user_command("GhpPlan", function(opts)
  ensure_setup()
  require("ghp.commands").plan({ shortcut = opts.args ~= "" and opts.args or nil })
end, { nargs = "?" })

vim.api.nvim_create_user_command("GhpWork", function()
  ensure_setup()
  require("ghp.commands").work()
end, {})

vim.api.nvim_create_user_command("GhpOpen", function(opts)
  ensure_setup()
  require("ghp.commands").open(opts.args ~= "" and opts.args or nil)
end, { nargs = "?" })

vim.api.nvim_create_user_command("GhpStart", function(opts)
  ensure_setup()
  require("ghp.commands").start(opts.args ~= "" and opts.args or nil)
end, { nargs = "?" })

vim.api.nvim_create_user_command("GhpAdd", function(opts)
  ensure_setup()
  require("ghp.commands").add(opts.args ~= "" and opts.args or nil)
end, { nargs = "?" })

vim.api.nvim_create_user_command("GhpDone", function(opts)
  ensure_setup()
  require("ghp.commands").done(opts.args ~= "" and opts.args or nil)
end, { nargs = "?" })

vim.api.nvim_create_user_command("GhpMove", function(opts)
  ensure_setup()
  local args = vim.split(opts.args, " ", { trimempty = true })
  require("ghp.commands").move(args[1], args[2])
end, { nargs = "+" })

vim.api.nvim_create_user_command("GhpComment", function(opts)
  ensure_setup()
  require("ghp.commands").comment(opts.args ~= "" and opts.args or nil)
end, { nargs = "?" })

vim.api.nvim_create_user_command("GhpPr", function(opts)
  ensure_setup()
  if opts.args == "create" then
    require("ghp.commands").pr({ create = true })
  elseif opts.args == "open" then
    require("ghp.commands").pr({ open = true })
  else
    require("ghp.commands").pr()
  end
end, { nargs = "?" })

vim.api.nvim_create_user_command("GhpConfig", function()
  ensure_setup()
  require("ghp.commands").config_edit()
end, {})

-- Telescope commands
vim.api.nvim_create_user_command("GhpTelescopePlan", function(opts)
  ensure_setup()
  require("ghp.commands").telescope_plan({ shortcut = opts.args ~= "" and opts.args or nil })
end, { nargs = "?" })

vim.api.nvim_create_user_command("GhpTelescopeWork", function()
  ensure_setup()
  require("ghp.commands").telescope_work()
end, {})

vim.api.nvim_create_user_command("GhpTelescopeIssues", function()
  ensure_setup()
  require("ghp.commands").telescope_issues()
end, {})
