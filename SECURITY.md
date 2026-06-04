# Security Policy

## Supported Versions

This project is pre-1.0. Security fixes are applied to the latest main branch.

## Reporting a Vulnerability

Please open a private security advisory on GitHub if available, or contact the maintainer through the repository profile.

Do not include secrets, production tokens, customer data, or private workspace URLs in issues.

## Design Boundary

`ai-command-bus` is a routing and approval framework. It should not be configured to perform high-risk external actions without a human approval gate.

Recommended default:

- allow read, summarize, classify, draft, and test tasks
- require approval for publish, delete, pay, buy, account change, or customer messaging tasks
- log every dispatch and submission with a task ID
