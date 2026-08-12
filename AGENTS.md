# Repository Instructions

- By default, after completing and verifying any code or documentation change, commit it and push the current branch so the deployment workflow runs.
- Never commit or push passwords, API tokens, private keys, `.env` files, Wrangler secrets, or any other credentials. Store production secrets with Wrangler and local secrets only in ignored files.
- Before every push, inspect the staged changes and confirm they contain no secrets or sensitive values.
