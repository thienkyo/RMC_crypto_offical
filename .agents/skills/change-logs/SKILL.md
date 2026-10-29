---
name: change-logs
description: Checks git code changes (working tree, staged, branch comparison, or commit ranges), summarizes modifications by feature/component, and performs a comprehensive audit to identify anything missing (tests, types, env vars, error handling, edge cases, leftover debug logs, or uncommitted files). Use when asked to check code changes, summarize changes, generate a changelog or PR review, inspect diffs, or verify if anything was missed before committing.
---

# Change Logs & Code Change Audit Skill

## Overview
This skill provides a systematic process to inspect git changes, produce an intelligible summary of what was added or modified, and perform a deep "gap analysis" to identify missing items (e.g., tests, environment variable updates, error handling, type definitions, or uncommitted files).

## When to Use
Activate this skill when the user requests:
- "Check the code changes and summarize what was done."
- "What did I change and did I miss anything?"
- "Review my diff before I commit / push."
- "Create a changelog for my recent changes / branch."
- "Check if anything is missing in this pull request / commit."

---

## Workflow

### Step 1: Detect Scope of Changes
Determine the target range of changes based on user input or project state:

1. **Uncommitted Working Tree (Default if uncommitted changes exist)**:
   - Check status and summary:
     ```bash
     git status --short
     git diff --stat
     git diff --staged --stat
     ```
   - Inspect full diffs:
     ```bash
     git diff
     git diff --staged
     ```
   - Check for untracked files that might belong to the change:
     ```bash
     git ls-files --others --exclude-standard
     ```

2. **Branch Comparison (Feature branch vs main/master/target)**:
   - Identify default/base branch (e.g., `origin/main` or `origin/master`):
     ```bash
     git diff --stat origin/main...HEAD
     git log --oneline origin/main..HEAD
     git diff origin/main...HEAD
     ```

3. **Specific Commit or Range**:
   - For the latest commit:
     ```bash
     git show --stat HEAD
     git show HEAD
     ```
   - For a specific commit range:
     ```bash
     git diff --stat <start-commit>..<end-commit>
     git log --oneline <start-commit>..<end-commit>
     git diff <start-commit>..<end-commit>
     ```

---

### Step 2: Analyze & Summarize Changes
Examine the diff and synthesize the changes into structured categories:

1. **High-Level TL;DR**:
   - A concise 1-3 sentence summary of the core objective and impact of the changes.

2. **Categorized Breakdown**:
   Group modified files and logic into logical buckets:
   - 🚀 **Features & Enhancements**: New capabilities, UI pages/components, API endpoints, or workflows.
   - 🐛 **Bug Fixes**: Resolved issues, edge case corrections, logic fixes.
   - 🔄 **Refactoring & Architecture**: Code restructuring, optimization, extraction of reusable modules (DRY/SOLID).
   - ⚙️ **Config & Infrastructure**: Build configs, dependencies (`package.json`, `requirements.txt`), Dockerfiles, CI/CD.
   - 🗄️ **Database & Models**: Schema adjustments, migrations, ORM entities, seed files.

3. **Component Details**:
   - Reference every affected file with clickable markdown links (`[filename](file:///path/to/file#Lstart-Lend)`).
   - Explain *what* changed and *why*, highlighting any changed behavior or contracts.

---

### Step 3: "Anything Missing?" Gap Analysis Audit
Systematically audit the diff against the following 8 critical checkpoints:

| Checkpoint | What to Look For | Risk if Missed |
| :--- | :--- | :--- |
| **1. Tests & Coverage** | Are new functions, utilities, or endpoints covered by unit/integration tests? Were existing tests updated or broken? | Regressions and undetected runtime bugs. |
| **2. Types & Interfaces** | Are TypeScript types, interfaces, or type annotations updated? Any forbidden `any` types or missing return types? | Type pollution and compile-time misses. |
| **3. Env Variables & Config** | Were new `process.env` or config keys introduced? Is `.env.example` updated with placeholder documentation? | Deployment crashes and missing config on other machines. |
| **4. Database Migrations** | If Prisma, TypeORM, or SQL schemas changed, is there a corresponding migration file and seed update? | Database desynchronization in production/staging. |
| **5. Error Handling & Edge Cases** | Are async calls wrapped in try/catch or error handlers? Are null/undefined checks present for missing data or empty arrays? | Unhandled exceptions and crashes in production. |
| **6. Security & Credentials** | Are there any hardcoded secrets, API keys, tokens, or debug credentials in the code or git history? | Security breach or token leaks. |
| **7. Cleanliness & Leftovers** | Are there leftover `console.log`, `print`, `debugger`, commented-out dead code blocks, or temporary scratch files? | Codebase bloat and cluttered log output. |
| **8. Untracked / Orphaned Files** | Did `git status` show untracked files (`??`) needed for the build? Are there dangling imports pointing to deleted files? | "Works on my machine" failures on CI/CD. |

---

### Step 4: Present the Change Log Report
Present the findings clearly in the following standard format:

```markdown
# 📋 Change Log & Audit Report

## 🎯 Executive Summary
[Brief description of the changes and purpose]

---

## 🔍 Detailed Changes
### 🚀 Features & Enhancements
- [`path/to/file.ts`](file:///absolute/path/to/file.ts#L10-L45): [Description of feature added]

### 🐛 Bug Fixes
- [`path/to/file.ts`](file:///absolute/path/to/file.ts#L60-L75): [Description of fix and bug addressed]

### 🔄 Refactoring & Maintenance
- ...

---

## ⚠️ Anything Missing? (Audit Findings)
### 🔴 Critical / Must Fix Before Commit
- [ ] **[Area]**: [Specific missing requirement, e.g., Missing `.env.example` entry for `NEW_API_KEY`]

### 🟡 Recommended / Quality Improvements
- [ ] **[Area]**: [e.g., Unit tests missing for new helper function `calculateTotals()`]
- [ ] **[Area]**: [e.g., Leftover `console.log` at line 42 in `service.ts`]

### 🟢 Optional / Future Considerations
- [ ] **[Area]**: [e.g., Potential caching optimization for repeat queries]

---

## 📝 Suggested Commit Message(s)
\`\`\`text
feat(scope): concise description of primary change

- Detail 1
- Detail 2

BREAKING CHANGE: (if applicable)
\`\`\`
```

---

## Quick Reference Commands

```bash
# View summary of unstaged and staged changes
git status -s
git diff --stat
git diff --cached --stat

# Search for leftover console logs in modified files
git diff | grep -E '^\+[ ]*(console\.log|debugger|print\()'

# Check untracked files
git status -u
```
