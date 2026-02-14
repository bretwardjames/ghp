# ghp.nvim

Neovim integration for [ghp-cli](https://github.com/bretwardjames/ghp) - GitHub Projects from your editor.

> **Source**: This plugin is developed in the [GHP monorepo](https://github.com/bretwardjames/ghp/tree/main/apps/nvim) and mirrored here for plugin managers.

## Requirements

- Neovim >= 0.8
- ghp-cli:
  ```bash
  npm install -g @bretwardjames/ghp-cli
  ```
- Authenticated: `ghp auth`

## Installation

### LazyVim

Add to `~/.config/nvim/lua/plugins/ghp.lua`:

```lua
return {
  "bretwardjames/ghp.nvim",
  cmd = { "GhpPlan", "GhpWork", "GhpOpen", "GhpStart", "GhpAdd", "GhpDone", "GhpPr", "GhpAgents" },
  keys = {
    { "<leader>gp", "<cmd>GhpPlan<cr>", desc = "Project Board" },
    { "<leader>gw", "<cmd>GhpWork<cr>", desc = "My Work" },
    { "<leader>ga", "<cmd>GhpAdd<cr>", desc = "Add Issue" },
    { "<leader>gs", "<cmd>GhpStart<cr>", desc = "Start Issue" },
  },
  opts = {},
}
```

### lazy.nvim

```lua
{
  "bretwardjames/ghp.nvim",
  cmd = { "GhpPlan", "GhpWork", "GhpOpen", "GhpStart", "GhpAdd", "GhpDone", "GhpPr", "GhpAgents" },
  config = function()
    require("ghp").setup()
  end,
}
```

### packer.nvim

```lua
use {
  "bretwardjames/ghp.nvim",
  config = function()
    require("ghp").setup()
  end,
}
```

## Configuration

```lua
require("ghp").setup({
  -- Path to ghp CLI (default: finds in PATH)
  ghp_path = "ghp",

  -- Keymaps (set to false to disable)
  keymaps = {
    plan = "<leader>gp",   -- View project board
    work = "<leader>gw",   -- View my work
    add = "<leader>ga",    -- Add new issue
    start = "<leader>gs",  -- Start working on issue
  },

  -- Floating window settings
  float = {
    border = "rounded",    -- none, single, double, rounded, solid, shadow
    width = 0.8,           -- % of screen width
    height = 0.8,          -- % of screen height
  },
})
```

## Parallel Worktrees

Work on multiple issues simultaneously using git worktrees. Each issue gets its own directory with a separate checkout.

```lua
require("ghp").setup({
  parallel = {
    -- How to open editor: "auto" (detect tmux), "tmux", "terminal", or "tab"
    open_mode = "auto",
    -- Auto-start claude in new worktree (default: true)
    auto_claude = true,
    -- Claude command to run
    claude_cmd = "claude", -- e.g., "claude --model opus"
    -- Layout when auto_claude is enabled:
    -- "panes": nvim and claude side-by-side in same tmux window (default)
    -- "windows": nvim and claude in separate tmux windows
    layout = "panes",
    -- Default prompt to send to claude (use {issue}, {path} placeholders)
    claude_prompt = "Working on #{issue}. Read the issue and begin.",
    -- Custom terminal command (for terminal mode)
    terminal_cmd = nil, -- e.g., "alacritty --working-directory {path} -e nvim"
  },
})
```

### Usage

```vim
" Create worktree and open nvim + claude (uses default prompt if configured)
:GhpStartParallel 123

" With inline prompt (overrides default)
:GhpStartParallel 123 Fix the authentication bug and add tests

" Create worktree only (for agent-only workflows)
:GhpStartParallel! 123
:GhpStartParallel! 456
" Then manage agents with :GhpAgents (see issue #141)
```

When inside tmux, `:GhpStartParallel` opens a new tmux window named `nvim-{issue}`.

## PR Review Workflow

Review PRs without affecting issue state. The review commands create worktrees but skip status updates, label changes, and assignment modifications.

```vim
" Review a PR by number (default) - resolves PR → linked issue via branch name
:GhpReview 388

" With custom prompt for Claude
:GhpReview 388 Review the authentication changes for security issues

" If you know the issue number directly, use 'issue' prefix
:GhpReview issue 123

" After submitting review, clean up the worktree (use issue number)
:GhpReviewDone 123

" Force remove (if there are uncommitted changes)
:GhpReviewDone! 123
```

This maps to `ghp start --review --parallel` under the hood. By default, `--review` treats the number as a PR and looks up the linked issue from the PR's branch name.

## Statusline Integration

Show the current issue in your statusline with lualine.

### Auto Setup (Recommended)

```lua
require("ghp").setup({
  statusline = {
    auto_lualine = true,  -- Auto-add to lualine if installed
  },
})
```

This automatically adds the component to `lualine_c`. To use a different section:

```lua
require("ghp").setup({
  statusline = {
    auto_lualine = true,
    lualine_section = "lualine_x",  -- or lualine_a, lualine_b, etc.
  },
})
```

### Manual Setup

If you prefer manual control, add to your lualine config:

```lua
require("lualine").setup({
  sections = {
    lualine_c = {
      -- ... your other components ...
      require("ghp.statusline").lualine,
    },
  },
})
```

This displays: ` #139 nvim: Status line integration [In Progress]`

### Statusline Configuration

```lua
require("ghp").setup({
  statusline = {
    cache_ttl = 30,           -- Cache TTL in seconds
    max_title_length = 40,    -- Truncate long titles
    format = "#{number} {title}", -- Available: {number}, {title}, {status}
    show_status = true,       -- Show [Status] after title
    icon = " ",              -- Icon before issue info (nil to disable)
    no_issue_text = nil,      -- Text when no issue (nil = hide component)
    -- Status colors (highlight groups or hex colors)
    status_colors = {
      ["Backlog"] = "Comment",
      ["In Progress"] = "Keyword",
      ["In Review"] = "String",
      ["Done"] = "DiagnosticOk",
    },
  },
})
```

### Manual Control

```lua
-- Force refresh (useful after ghp start/done)
require("ghp.statusline").refresh()

-- Clear cache
require("ghp.statusline").clear_cache()

-- Get component directly (for custom statuslines)
local text = require("ghp.statusline").component()
local color = require("ghp.statusline").component_color()
```

## Commands

| Command | Description |
|---------|-------------|
| `:GhpPlan [shortcut]` | View project board (optional: use configured shortcut) |
| `:GhpWork` | View items assigned to you |
| `:GhpOpen [issue]` | View issue details |
| `:GhpStart [issue] [--hotfix [ref]]` | Start working on an issue (creates branch, updates status). Use `--hotfix` for hotfix branching |
| `:GhpStartParallel [issue]` | Start in a new worktree and open nvim + claude |
| `:GhpStartParallel! [issue]` | Create worktree only (no editor - for agent workflows) |
| `:GhpReview [pr]` | Review PR in worktree (resolves PR → issue) |
| `:GhpReview issue [num]` | Review issue directly (no PR lookup) |
| `:GhpReviewDone [issue]` | Clean up review worktree |
| `:GhpWorktreeRemove [issue]` | Remove worktree for issue (use `!` to force) |
| `:GhpAdd [title]` | Create a new issue |
| `:GhpDone [issue]` | Mark an issue as done |
| `:GhpMove <issue> <status>` | Move issue to different status |
| `:GhpComment [issue]` | Add comment to an issue |
| `:GhpPr [create\|open]` | View PR status, create PR, or open in browser |
| `:GhpConfig` | Edit ghp-cli config file |
| `:GhpDashboard` | Show branch dashboard in split |
| `:GhpDashboardFloat` | Show branch dashboard in floating window |
| `:GhpDashboardRefresh` | Refresh current dashboard |
| `:GhpAgents` | View running Claude agents (workspace only) |
| `:GhpAgents!` | View all running Claude agents |
| `:GhpAgentsRefresh` | Refresh current agents window |
| `:GhpPickPlan [shortcut]` | Fuzzy picker for project board |
| `:GhpPickWork` | Fuzzy picker for your work |
| `:GhpPickIssues` | Fuzzy picker for issues |
| `:GhpStandup [since]` | Show daily activity summary (e.g., `:GhpStandup 2d`, `:GhpStandup --timeline`) |

## Picker Integration

The picker commands (`GhpPick*`) automatically use the best available picker:

1. **Telescope** - if installed, uses full fuzzy-finding with preview
2. **vim.ui.select** - fallback, enhanced by snacks.nvim or dressing.nvim if installed

### Recommended Setup (LazyVim)

```lua
return {
  "bretwardjames/ghp.nvim",
  cmd = {
    "GhpPlan", "GhpWork", "GhpStart", "GhpAdd",
    "GhpPickPlan", "GhpPickWork", "GhpPickIssues",
  },
  keys = {
    { "<leader>gp", "<cmd>GhpPickPlan<cr>", desc = "Project Board" },
    { "<leader>gw", "<cmd>GhpPickWork<cr>", desc = "My Work" },
    { "<leader>ga", "<cmd>GhpAdd<cr>", desc = "Add Issue" },
    { "<leader>gs", "<cmd>GhpStart<cr>", desc = "Start Issue" },
  },
  opts = {},
}
```

### Telescope-specific Features

If telescope is installed, you get:
- Fuzzy filtering
- Live preview of issue details
- Additional keymaps in the picker:

| Key | Mode | Action |
|-----|------|--------|
| `<CR>` | n/i | Open issue details |
| `<C-s>` / `s` | i/n | Start working on issue |
| `<C-d>` / `d` | i/n | Mark issue as done |
| `<C-c>` / `c` | i/n | Comment on issue |

You can also load the telescope extension directly:

```lua
require("telescope").load_extension("ghp")
require("telescope").extensions.ghp.plan()
```

### vim.ui.select Fallback

Without telescope, the picker uses `vim.ui.select`. Install [snacks.nvim](https://github.com/folke/snacks.nvim) or [dressing.nvim](https://github.com/stevearc/dressing.nvim) to enhance the UI with fuzzy finding.

## Keymaps in Float Windows

When viewing issues in a floating window:

| Key | Action |
|-----|--------|
| `q` / `<Esc>` | Close window |
| `<Enter>` | Open issue under cursor |
| `s` | Start working on issue under cursor |
| `d` | Mark issue as done |
| `c` | Comment on issue |
| `?` | Show help |

## Keymaps in Agents Window

When viewing agents with `:GhpAgents`:

| Key | Action |
|-----|--------|
| `q` / `<Esc>` | Close window |
| `<Enter>` / `p` | Preview agent output (shows tmux pane content) |
| `a` | Attach to agent (switch to tmux window or create terminal) |
| `x` | Kill/stop the selected agent |
| `r` | Refresh agent list |
| `?` | Show help |

Status indicators:
- `●` Running - agent is actively working
- `⏸` Waiting - agent is waiting for input
- `○` Stopped - agent has stopped
- `⚠` Stale - agent's worktree no longer exists

## Workflow

```
:GhpPlan                    " See all issues
                            " Press 's' on an issue to start working
                            " (creates branch, updates status, links issue)

... write code ...

:GhpComment                 " Add progress update
:GhpPr create               " Create PR when ready
:GhpDone                    " Mark complete
```

## License

MIT
