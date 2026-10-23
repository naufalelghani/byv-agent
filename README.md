# byv-agent

A Claude Code plugin bundling four specialist agents for an autonomous software-development workflow:

- Planning & Research
- Backend Engineer
- Frontend Engineer
- Security & QA Auditor

The lead agent coordinates planning, implementation, integration, independent QA, and bounded repair cycles. Invoke the command with a detailed project request:

```text
/byv-agent:autonomous Build a web app with authentication, role-based access, responsive UI, API tests, and security QA.
```

## A Project Built on Dreams

![A quiet purple sky filled with stars, overlooking a distant city at dusk](docs/images/dreams-sky.png)

I created BYV Agent with a simple belief: technology can be both powerful and beautiful. Inspired by the *state of the art*, I see software as a blend of engineering, art, elegance, and structure — where thoughtful design and meaningful functionality come together.

This project is also inspired by *La La Land* and the feeling behind *City of Stars (Mia & Sebastian’s Theme)*. It reminds me of the dreams people hold for their future — the things they hope to become, the worlds they want to build, and the possibilities they refuse to give up on. BYV Agent is part of my own journey toward those dreams: a small step today, with hope for what tomorrow may bring.

## Frontend design skills (bundled)

The Frontend Engineer includes two plugin skills:
- `frontend-design` — design process, visual hierarchy, responsive implementation, accessibility, and interaction states.
- `ui-ux-pro-max` — structured selection/review of visual direction, design tokens, palettes, typography, layout, and UX.

They live in the plugin's `skills/` directory and are available when the plugin is installed. **No separate skill installation or manual setup is required.** The Frontend Engineer is instructed to load them for relevant UI tasks. They are used as contextual guidance, not as rigid templates; project requirements and accessibility take precedence.

## Backend documentation skill (Context7)

The Backend Engineer is instructed to load the bundled `context7` skill for framework, library, SDK, database, and backend API documentation. It uses Context7 MCP documentation lookup when those tools are available in the Claude Code runtime, and falls back transparently to repository evidence if they are not. The skill file is included with the plugin; **live Context7 lookup still requires Context7 MCP to be configured in the runtime**.

## Install from this GitHub marketplace

In Claude Code:

```text
/plugin marketplace add naufalelghani/byv-agent
/plugin install byv-agent@byv-agent
```

Local testing from the repository root:

```bash
claude --plugin-dir .
```

## Agent Teams and autonomous mode

Agent Teams is an experimental Claude Code capability and must be available/enabled in the runtime. The plugin cannot silently change global user settings or guarantee that a team can spawn. In PowerShell, for the current terminal session:

```powershell
$env:CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1"
claude --enable-auto-mode
```

Choose Auto mode and the highest effort supported by the selected model (for example, `/effort max`, if available). Auto mode is not a blanket permission bypass. Use an isolated worktree/repository, review diffs, and avoid exposing production credentials.

## Structure

```
.claude-plugin/
  plugin.json
  marketplace.json
agents/
  planning-research.md
  backend-engineer.md
  frontend-engineer.md
  security-qa.md
skills/
  frontend-design/
    SKILL.md
  ui-ux-pro-max/
    SKILL.md
  context7/
    SKILL.md
commands/
  autonomous.md
LICENSE
README.md
```

## Notes

- The Security & QA agent is intentionally read-only for application source.
- Parallel implementation depends on runtime support and task/file boundaries.
- The lead must report actual verification results and any unresolved risks.
- Review changes before deploying or using them in production.

## License

MIT. See [LICENSE](LICENSE).
