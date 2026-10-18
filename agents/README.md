# Agents

This directory holds reusable repository agents.

Each agent is a small, focused workflow for a specific role or safety gate.

## Current agents

- `review-agent`: reusable review gate for branch safety, build validity, test coverage, and repo policy compliance.
- Implementation: `agents/review-agent.js`
- Documentation: `agents/review-agent.md`
- Pattern: each agent has one docs file and one executable script in the same folder.

## Future additions

Add more agents here as the project grows, for example:

- `db-agent`
- `meta-integration-agent`
- `release-agent`

Keep each agent small and role-specific.
