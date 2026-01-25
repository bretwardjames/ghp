local M = {}

function M.setup(keymaps)
  local commands = require("ghp.commands")

  if keymaps.plan then
    vim.keymap.set("n", keymaps.plan, commands.plan, { desc = "GHP: View project board" })
  end

  if keymaps.work then
    vim.keymap.set("n", keymaps.work, commands.work, { desc = "GHP: View my work" })
  end

  if keymaps.add then
    vim.keymap.set("n", keymaps.add, commands.add, { desc = "GHP: Add new issue" })
  end

  if keymaps.start then
    vim.keymap.set("n", keymaps.start, commands.start, { desc = "GHP: Start working on issue" })
  end

  if keymaps.open then
    vim.keymap.set("n", keymaps.open, commands.open, { desc = "GHP: Open issue details" })
  end

  if keymaps.done then
    vim.keymap.set("n", keymaps.done, commands.done, { desc = "GHP: Mark issue as done" })
  end

  if keymaps.pr then
    vim.keymap.set("n", keymaps.pr, commands.pr, { desc = "GHP: PR status" })
  end

  if keymaps.dashboard then
    vim.keymap.set("n", keymaps.dashboard, commands.dashboard, { desc = "GHP: Branch dashboard" })
  end

  if keymaps.dashboard_float then
    vim.keymap.set("n", keymaps.dashboard_float, commands.dashboard_float, { desc = "GHP: Branch dashboard (float)" })
  end
end

return M
