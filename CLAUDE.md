# Repository-Specific Claude Instructions

## Prompt Transcript Maintenance

When working on this repository, always update the `CLAUDE-PROMPT-TRANSCRIPT.md` file to capture significant human prompts and AI interactions. This file serves as a record of how much work was done by AI versus human input.

### Format Guidelines
- Use "F:" prefix for human prompts from Felix
- Add context about the conversation medium (Claude.ai, Claude Code, GitHub Action)
- Include brief descriptions of completed work when relevant
- Maintain chronological order
- You can elide confirmatory prompts that just approved a presented plan

### When to Update
- After implementing significant features or fixes
- When addressing GitHub issues with @claude mentions  
- Before creating pull requests for substantial changes
- When shifting between different Claude interfaces (ai.claude.com, Claude Code, GitHub Actions)

### Example Entry Format
```
F: [human prompt description]

(Context: via Claude Code for Issue #XX, resulted in PR #YY)
```

### Development Notes
Also reference `DEVELOPMENT-NOTES.md` for additional context about the project's current state and any specific preferences or conventions to follow.

## Project Context
This is a web-based messaging app for smartphone users called "Scratch on the Smartphone" (originally prototyped as a Blood on the Clocktower game assistant). Key technical details:
- Single-page web application
- Uses PubNub for real-time messaging
- Designed for mobile-friendly use
- Role-based messaging system for game management