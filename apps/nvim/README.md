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
  cmd = { "GhpPlan", "GhpWork", "GhpOpen", "GhpStart", "GhpAdd", "GhpDone", "GhpPr" },
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
  cmd = { "GhpPlan", "GhpWork", "GhpOpen", "GhpStart", "GhpAdd" },
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
| `:GhpStart [issue]` | Start working on an issue (creates branch, updates status) |
| `:GhpStartParallel [issue]` | Start in a new worktree and open nvim in it |
| `:GhpAdd [title]` | Create a new issue |
| `:GhpDone [issue]` | Mark an issue as done |
| `:GhpMove <issue> <status>` | Move issue to different status |
| `:GhpComment [issue]` | Add comment to an issue |
| `:GhpPr [create\|open]` | View PR status, create PR, or open in browser |
| `:GhpConfig` | Edit ghp-cli config file |
| `:GhpDashboard` | Show branch dashboard in split |
| `:GhpDashboardFloat` | Show branch dashboard in floating window |
| `:GhpDashboardRefresh` | Refresh current dashboard |
| `:GhpPickPlan [shortcut]` | Fuzzy picker for project board |
| `:GhpPickWork` | Fuzzy picker for your work |
| `:GhpPickIssues` | Fuzzy picker for issues |

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

## Parallel Worktrees

Work on multiple issues simultaneously with `:GhpStartParallel`:

```vim
:GhpStartParallel 123    " Create worktree and open nvim in it
```

This will:
1. Create a git worktree for the issue (via `ghp start --parallel`)
2. Open nvim in the new worktree directory

### Open Modes

Configure how nvim opens in the new worktree:

```lua
require("ghp").setup({
  parallel = {
    open_mode = "auto",  -- "auto", "tmux", "terminal", or "tab"
    -- Custom terminal command (for open_mode = "terminal")
    terminal_cmd = "alacritty --working-directory {path} -e nvim",
  },
})
```

| Mode | Behavior |
|------|----------|
| `auto` | Use tmux if available, otherwise tab (default) |
| `tmux` | Open in new tmux window |
| `terminal` | Use custom `terminal_cmd` |
| `tab` | Open nvim in a new neovim tab with terminal |

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
