# Superpowers skills

Vendored from [obra/superpowers](https://github.com/obra/superpowers) (MIT license, see `SUPERPOWERS_LICENSE`).

Installed manually by copying the `skills/` directory, because this project runs in a sandboxed
Claude Code on-the-web session where `/plugin` commands are unavailable. This means the
plugin's `SessionStart` hook (which auto-nudges every new session to check skills first) is
NOT active — these skills are invoked the same way as any other project skill, on demand via
the Skill tool or by name.

To pick up upstream updates later, re-run:

```bash
git clone --depth 1 https://github.com/obra/superpowers.git /tmp/superpowers-latest
cp -r /tmp/superpowers-latest/skills/* .claude/skills/
```
