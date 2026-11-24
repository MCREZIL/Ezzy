# Labcoder

Describe a task, pick a language (Python, Java, JavaScript, C++, CSS and 13 more), and Claude writes the code.
One click commits the file to a GitHub repo. Hosted on Render.

**Backend:** Node.js + Express (`server.js`), Anthropic API for generation, GitHub Contents API for commits.
**Frontend:** a single static page (`public/index.html`), password-protected.

## 1. Run locally
```bash
npm install
cp .env.example .env   # fill in the values, then:
export $(grep -v '^#' .env | xargs) && npm start
```
Open http://localhost:3000.

## 2. Push this project to GitHub
Create a new repo (for example `labcoder`) and push this folder to it.

## 3. Create the repo that receives generated code
Best practice: use a **separate** repo (for example `lab-generated-code`) so commits never redeploy the app.
Then create a **fine-grained personal access token** at GitHub > Settings > Developer settings, limited to that one repo, with
*Contents: Read and write*.

## 4. Deploy on Render
1. Render dashboard > **New > Blueprint**, pick your `labcoder` repo. Render reads `render.yaml`.
2. Fill in the secret variables when prompted:
   - `ANTHROPIC_API_KEY`: from console.anthropic.com
   - `ACCESS_PASSWORD`: a long passphrase; this is the login for the tool
   - `GITHUB_TOKEN`: the token from step 3
   - `GITHUB_REPO`: `your-username/lab-generated-code`
3. Deploy. Your tool is live at `https://labcoder.onrender.com` (or the URL Render shows).

Files are committed to `generated/<language>/<filename>` on the `main` branch (change with `GITHUB_BRANCH`).

## Notes
- The free Render plan sleeps after inactivity, so the first load can take about 30 seconds.
- Every generation uses your Anthropic credits. The access password and a 20 requests/minute limit protect against misuse.
- Always read generated code before running or committing it.
