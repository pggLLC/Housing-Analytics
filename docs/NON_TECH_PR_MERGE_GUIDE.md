# 🏠 Housing Analytics: Non-Technical Guide to Merging Pull Requests

> **You can't break anything by reading this guide.** Every step is reversible, and GitHub always lets you undo. Take it one step at a time!

---

## 📋 Table of Contents

1. [What Is a Pull Request? (The Basics)](#1-what-is-a-pull-request-the-basics)
2. [Copilot Agent Session References](#2-copilot-agent-session-references)
3. [Your Current Situation — 13 Open PRs](#3-your-current-situation--13-open-prs)
4. [Step-by-Step: Merge PR #9 — Bug Fixes (Do First!)](#4-step-by-step-merge-pr-9--bug-fixes-do-first)
5. [Step-by-Step: Merge PR #13 — Analysis Sections](#5-step-by-step-merge-pr-13--analysis-sections)
6. [Step-by-Step: Merge PR #15 — Zillow Data Sync](#6-step-by-step-merge-pr-15--zillow-data-sync)
7. [Step-by-Step: Merge PR #16 — Serverless APIs](#7-step-by-step-merge-pr-16--serverless-apis)
8. [Step-by-Step: Merge PR #17 — CAR Data Integration](#8-step-by-step-merge-pr-17--car-data-integration)
9. [Optional: Design System (PRs #10–#14)](#9-optional-design-system-prs-1014)
10. [Optional: Website Monitoring (PR #6)](#10-optional-website-monitoring-pr-6)
11. [Understanding "Update Branch" and Rebasing](#11-understanding-update-branch-and-rebasing)
12. [Decision Tree: Should I Merge This PR?](#12-decision-tree-should-i-merge-this-pr)
13. [Troubleshooting](#13-troubleshooting)
14. [Success Checklist](#14-success-checklist)
15. [Summary and Timeline](#15-summary-and-timeline)
16. [Glossary](#16-glossary)

---

## 1. What Is a Pull Request? (The Basics)

### 🤔 What is a Pull Request (PR)?

Think of your website as a book that many people are working on at the same time. Each person writes their chapter separately. A **Pull Request (PR)** is like saying:

> "Hey, I finished my chapter — can we add it to the main book?"

A PR is a *proposed change* to your website's code. It sits in a waiting room until someone (you!) decides to let it in.

### ✅ What does "Merge" mean?

**Merging** is accepting the change. It's like stamping "APPROVED" on someone's document and filing it into the main folder.

> 📎 **Analogy:** Imagine you and a coworker are both editing the same Word document. You've been making changes in separate copies. "Merging" combines your changes into one final document.

When you merge a PR:
- The new code becomes part of your live website
- The PR is closed and marked "Merged" ✅
- The change is permanent (but always reversible with another change)

### 🔄 What does "Rebase" mean?

**Rebasing** is like updating your chapter to include the latest edits from the rest of the book before yours gets added.

Imagine you wrote Chapter 7 a month ago. Since then, Chapters 1–6 have been rewritten. Before adding your Chapter 7, someone needs to make sure it still makes sense with the updated earlier chapters. That process of "catching up" is called rebasing.

In GitHub's language, when it says **"Update branch"**, it means: "This PR needs to catch up with recent changes before it can be merged."

### 💡 How this guide helps

This guide will walk you through:
- Which PRs to merge and in what order
- How to click the right buttons in GitHub
- What to expect at each step
- How to handle any "Update branch" requests
- What to do if something looks wrong

---

## 2. Copilot Agent Session References

These are the AI-powered Copilot agent sessions that created the code waiting in your PRs. Each session worked on a specific feature.

| 🤖 Session Name | What It Created | PRs | Approximate Date |
|---|---|---|---|
| **Bug Fixes** | Fixed critical JavaScript errors preventing Colorado Deep Dive from loading | PR #9 | Recent |
| **Analysis Sections** | Added State Comparison, AMI Trend Chart, and Policy Simulator to the Colorado Deep Dive page | PR #13 (refined from PR #2) | Recent |
| **Housing Data Integration** | Automated Zillow data sync, new serverless API endpoints, CAR market data | PRs #15, #16, #17 | Recent |
| **Design System Redesign** | Complete visual overhaul: new colors, fonts, dark mode, responsive design, accessibility | PRs #10, #11, #12, #13, #14 | Recent |
| **Website Monitoring** | Automated daily email reports about website health and errors | PR #6 | Earlier |
| **PR Review & Merge Strategy** | Analysis of all open PRs and recommended merge order | This guide | Recent |

> 💬 **Plain English:** Think of each session as a different contractor who worked on your house. The Bug Fixes contractor fixed the plumbing. The Data Integration contractor added new appliances. The Design contractor repainted and remodeled. This guide helps you decide which contractor's work to officially accept.

---

## 3. Your Current Situation — 13 Open PRs

You currently have **13 open pull requests** (including this guide's PR #18). Here's the full picture:

### 📊 All Open PRs at a Glance

| PR # | Title | Priority | Decision |
|---|---|---|---|
| **#9** | Fix critical syntax errors and bug fixes | 🔴 CRITICAL | **Merge first** |
| **#13** | Analysis sections (State Comparison, AMI, Policy Simulator) | 🟠 HIGH | **Merge second** |
| **#15** | Weekly Zillow Research Data Sync | 🟠 HIGH | **Merge third** |
| **#16** | Serverless APIs (Demographics & HUD Market) | 🟠 HIGH | **Merge fourth** |
| **#17** | CAR Market Data Integration | 🟠 HIGH | **Merge fifth** |
| **#10** | Design System: CSS Foundation | 🟡 OPTIONAL | Merge if doing design overhaul |
| **#11** | Design System: Component Library | 🟡 OPTIONAL | Merge after #10 |
| **#12** | Design System: Pages Redesign | 🟡 OPTIONAL | Merge after #11 |
| **#14** | Design System: Dark Mode & Accessibility | 🟡 OPTIONAL | Merge after #12 |
| **#6** | Website Monitoring System | 🟢 LOWER PRIORITY | Merge later |
| **#2** | Analysis Sections (older version) | ❌ CLOSE | Superseded by #13 |
| **#4** | Analysis Sections (older version) | ❌ CLOSE | Superseded by #13 |
| **#18** | This guide! | 📘 INFO | Merge when ready |

### 🗓️ Recommended Timeline

```
Day 1 (30–45 minutes):
  ✅ Merge PR #9  → Fixes critical bugs
  ✅ Merge PR #13 → Adds analysis sections
  ✅ Close PR #2  → Old version, no longer needed
  ✅ Close PR #4  → Old version, no longer needed

Day 1–2 (45–60 minutes):
  ✅ Merge PR #15 → Zillow data automation
  ✅ Merge PR #16 → New API endpoints
  ✅ Merge PR #17 → CAR data integration

Optional — Day 2–3 (60–90 minutes):
  ✅ Merge PR #10 → Design foundation
  ✅ Merge PR #11 → Component library
  ✅ Merge PR #12 → Page redesigns
  ✅ Merge PR #14 → Dark mode & accessibility

Later:
  ✅ Merge PR #6  → Website monitoring
```

---

## 4. Step-by-Step: Merge PR #9 — Bug Fixes (Do First!)

### 🔍 What PR #9 Does (Plain English)

This PR fixes **critical errors** in the JavaScript code that powers your Colorado Deep Dive page. Without these fixes, parts of the page either crash or display incorrectly.

Specifically, it:
- Removed duplicate code that was causing conflicts
- Fixed a syntax error in `co-ami-gap.js` (a JavaScript file)
- Cleaned up `colorado-deep-dive.html` so it loads correctly

> 🚨 **Why it's critical:** If you skip this and merge other PRs first, those new features might not work because they depend on the underlying page being error-free.

### 📋 Step-by-Step Instructions

**Step 1: Open the PR**
1. Go to [github.com/pggLLC/Housing-Analytics](https://github.com/pggLLC/Housing-Analytics)
2. Click the **"Pull requests"** tab at the top of the page
3. You'll see a list of open PRs
4. Click on **"Fix critical syntax errors..."** (PR #9)

**Step 2: Review the PR (optional but recommended)**
1. You'll land on the PR page
2. Scroll down to see the "Files changed" tab — this shows exactly what was modified
3. Green lines = new code added, Red lines = old code removed
4. You don't need to understand the code — just note it looks organized

**Step 3: Check for a green "Merge pull request" button**
1. Scroll to the bottom of the PR page
2. Look for a green button that says **"Merge pull request"**
3. ✅ If it's green: you're ready to merge! Skip to Step 5
4. ⚠️ If it says "Update branch": see [Section 11](#11-understanding-update-branch-and-rebasing) first

**Step 4 (if needed): Update the branch**
1. Click **"Update branch"** button
2. Wait 10–30 seconds for GitHub to process
3. The page will refresh
4. Now the green "Merge pull request" button should appear

**Step 5: Merge the PR**
1. Click the green **"Merge pull request"** button
2. A small box appears asking for a merge message — leave it as-is
3. Click **"Confirm merge"**
4. 🎉 You'll see a purple banner saying "Pull request successfully merged and closed"

**Step 6: Verify it worked**
- [ ] You see the purple "merged" banner
- [ ] The PR status shows "Merged" (purple icon)
- [ ] Visit your Colorado Deep Dive page — it should load without errors

---

## 5. Step-by-Step: Merge PR #13 — Analysis Sections

### 🔍 What PR #13 Does (Plain English)

PR #13 adds **three powerful new analysis tools** to your Colorado Deep Dive page:

1. **State Comparison Tool** — Compare Colorado's housing market against other states
2. **AMI Trend Chart** — See how Area Median Income has changed over time with interactive charts
3. **Policy Simulator** — Explore how different policy decisions affect housing affordability

> 💡 **Why #13 and not #2 or #4?** Great question! PRs #2 and #4 were the *original* versions of these features. PR #13 is the **improved, updated version** that was rebased (caught up) with all the latest code. It's newer and better. Using #2 or #4 at this point would create conflicts and undo recent bug fixes.

### ❌ Why Close PRs #2 and #4?

- **PR #2** was the first draft of the analysis sections. PR #13 contains everything from PR #2 plus improvements.
- **PR #4** was another attempt at the same features, but it diverged and is now outdated.
- Merging all three would cause **conflicts** — like trying to file the same document three times in different versions.

### 📋 Closing PRs #2 and #4 First

**To close PR #2:**
1. Go to Pull Requests and click on PR #2
2. Scroll all the way to the bottom
3. Click **"Close pull request"** (gray button, not green)
4. Optionally add a comment: "Superseded by PR #13 — closing"
5. Click **"Close pull request"** to confirm

**Repeat the same steps for PR #4.**

### 📋 Merging PR #13

Follow the same steps as PR #9 above:

1. Go to Pull Requests → click PR #13
2. Check for the green "Merge pull request" button
3. If you see "Update branch" — click it and wait
4. Click **"Merge pull request"** → **"Confirm merge"**
5. ✅ Done! The analysis sections are now live

**Step 6: Verify it worked**
- [ ] Visit your Colorado Deep Dive page
- [ ] Scroll down — you should see new sections: "State Comparison", "AMI Trends", "Policy Simulator"
- [ ] Try clicking on the interactive elements

---

## 6. Step-by-Step: Merge PR #15 — Zillow Data Sync

### 🔍 What PR #15 Does (Plain English)

PR #15 sets up an **automated system** that downloads fresh housing market data from Zillow's research website every week — without you having to do anything.

Think of it like setting up a newspaper subscription: instead of going to the store to buy a paper every week, the paper just shows up at your door automatically.

This data powers the market trend charts on your website, keeping them up-to-date automatically.

### 🏗️ What it actually creates

- A GitHub Actions workflow file that runs every Sunday night
- Downloads Zillow Research spreadsheets (home values, rental data, etc.)
- Saves the files to your repository automatically
- Keeps your charts and tables current with real market data

> ⚡ **Why it's important:** Without this, your housing data would slowly become stale. With it, your website always shows the latest market conditions.

### 📋 Step-by-Step Instructions

1. Go to Pull Requests → click PR #15
2. Read the description to see what files it adds (optional)
3. Check for green "Merge pull request" button
4. If you see "Update branch" — click it and wait (this one may need updating since PRs #9 and #13 changed things)
5. Click **"Merge pull request"** → **"Confirm merge"**

**How to test it worked:**
- [ ] After merging, go to the **"Actions"** tab at the top of your repository
- [ ] You should see a new workflow called "Zillow Data Sync" or similar
- [ ] It will run automatically each week; you can also click "Run workflow" to trigger it manually
- [ ] After it runs, check the `data/` folder in your repo for new files

---

## 7. Step-by-Step: Merge PR #16 — Serverless APIs

### 🔍 What PR #16 Does (Plain English)

PR #16 creates **two new data endpoints** for your website:

1. **Colorado Demographics API** — Provides current population and housing data for Colorado counties
2. **HUD Market Analysis API** — Connects to HUD (U.S. Department of Housing) data about housing affordability

> 🔌 **Analogy:** Think of an API like a power outlet. Your website's charts and tables plug into these "outlets" to get live data. PR #16 installs two new outlets.

These are built as **serverless functions**, meaning they run in the cloud without you needing to manage a server. They live in the `serverless/` folder of your repo.

### 📋 Step-by-Step Instructions

1. Go to Pull Requests → click PR #16
2. Check for green "Merge pull request" button
3. If "Update branch" appears — click it (you may need this since #9 and #13 changed the codebase)
4. Wait for the page to refresh
5. Click **"Merge pull request"** → **"Confirm merge"**

**Verification:**
- [ ] The PR shows as "Merged" (purple)
- [ ] In your repo file browser, look for the `serverless/` folder — it should contain new `.js` files
- [ ] The website should still load correctly after the merge

---

## 8. Step-by-Step: Merge PR #17 — CAR Data Integration

### 🔍 What PR #17 Does (Plain English)

PR #17 integrates data from **CAR (Colorado Association of REALTORS®)** into your website. This includes:

- Monthly market reports for Colorado counties
- Active listing counts and median prices
- Days on market statistics
- New workflow automation to keep CAR data updated

> 📊 **Why it matters:** CAR data is highly reliable and regularly cited by Colorado real estate professionals. Having it on your site makes it a more authoritative resource.

### ⚠️ Why PR #17 Depends on PRs #15 and #16

PR #17 uses the data infrastructure set up by PRs #15 and #16:
- It uses the same data folder structure created by PR #15
- It references the serverless functions created by PR #16

This is why order matters! If you merge #17 before #15 and #16, it's like trying to plug in a lamp before the outlet is installed.

### 📋 Handling "Update Branch"

PR #17 will almost certainly need you to click **"Update branch"** since multiple PRs have been merged before it. Here's exactly what to do:

1. Go to Pull Requests → click PR #17
2. You will likely see: *"This branch is out-of-date with the base branch"*
3. Click the **"Update branch"** button
4. GitHub will show a loading spinner — wait 15–30 seconds
5. The page will refresh with a green "Merge pull request" button

**Then merge:**
1. Click **"Merge pull request"** → **"Confirm merge"**
2. ✅ CAR data integration is live!

**Verification:**
- [ ] Visit your Colorado market pages
- [ ] Look for new data sections showing CAR statistics
- [ ] Check the Actions tab for new workflow runs

---

## 9. Optional: Design System (PRs #10–#14)

### 🎨 What the Design System Does

PRs #10–#14 are a **complete visual redesign** of your website, created by the Design System Redesign session. Together they:

- Establish consistent colors, fonts, and spacing across all pages
- Add a reusable library of buttons, cards, and navigation components
- Redesign all individual pages to use the new system
- Add dark mode (a dark color scheme for nighttime use)
- Ensure the site meets accessibility standards (usable by people with disabilities)
- Make the site fully responsive (looks great on phones, tablets, and computers)

> ⏱️ **Estimated time:** About 15 minutes for all four PRs if you do them back-to-back

> ⚠️ **Important:** These PRs must be merged IN ORDER: #10 → #11 → #12 → #14. Each one builds on the previous.

### 📋 PR #10: Design System Foundation

**What it adds:** CSS variables (design "rules") for colors, fonts, and spacing.

1. Go to Pull Requests → click PR #10
2. Click "Update branch" if needed
3. Click **"Merge pull request"** → **"Confirm merge"**
4. ✅ Design foundation is in place

### 📋 PR #11: Component Library

**What it adds:** Reusable CSS classes for buttons, cards, navigation, alerts, and more.

1. After PR #10 is merged, go to PR #11
2. Click "Update branch" (you'll almost certainly need this after #10)
3. Click **"Merge pull request"** → **"Confirm merge"**
4. ✅ Component library is live

### 📋 PR #12: Pages Redesign

**What it adds:** Updates all the HTML pages to use the new design components.

1. After PR #11 is merged, go to PR #12
2. Click "Update branch"
3. Click **"Merge pull request"** → **"Confirm merge"**
4. ✅ All pages now look updated!

**Tip:** After this merge, visit your website — you'll see a noticeably different look!

### 📋 PR #14: Dark Mode, Accessibility & Responsive Design

**What it adds:** Dark mode toggle, WCAG 2.1 AA accessibility compliance, print styles, and performance improvements.

1. After PR #12 is merged, go to PR #14
2. Click "Update branch"
3. Click **"Merge pull request"** → **"Confirm merge"**
4. ✅ Full design system complete!

**Verification for the whole design system:**
- [ ] Your website has a noticeably updated, cleaner look
- [ ] There may be a dark/light mode toggle somewhere on the page
- [ ] The site looks good on your phone (try opening it on mobile)
- [ ] Text is readable and buttons are easy to click

---

## 10. Optional: Website Monitoring (PR #6)

### 🔍 What PR #6 Does (Plain English)

PR #6 sets up an **automated health check system** for your website. Every day it:

- Visits all your website pages automatically
- Checks that they load correctly
- Looks for JavaScript errors
- Sends you a **daily email report** with the results

> 📧 **Analogy:** It's like hiring a secret shopper who visits your website every day and sends you a report card.

### 📅 Why It's Lower Priority

This PR doesn't affect what visitors see — it's a behind-the-scenes tool for you as the website owner. The data and design PRs are more impactful for users. That's why we recommend doing this one later.

### 📋 Merge Process

1. Wait until after all the data PRs (#15, #16, #17) are merged — this ensures the monitoring covers the new pages too
2. Go to Pull Requests → click PR #6
3. This one will need "Update branch" (it's been waiting a while!)
4. Click "Update branch" → wait → click **"Merge pull request"** → **"Confirm merge"**

**After merging:**
- [ ] Go to the Actions tab and look for a monitoring workflow
- [ ] You may need to configure an email address for the reports (check the PR description for setup instructions)
- [ ] The first report should arrive within 24 hours

---

## 11. Understanding "Update Branch" and Rebasing

### 🤔 What Does "Update Branch" Mean?

When GitHub shows you an **"Update branch"** button instead of a green "Merge" button, it means:

> "This PR was written a while ago, and since then, other changes have been made to the main codebase. We need to bring this PR up to speed before we can add it."

### 📎 Real-World Analogy

Imagine you and your coworker are both editing a shared document. You made your edits a week ago. Since then, your coworker made significant changes to the beginning of the document. Now, before your edits can be officially added, someone needs to make sure your edits still make sense with the new beginning. That's "updating the branch."

### 🖱️ How to Click the Button

1. Open the PR that needs updating
2. Scroll to the bottom of the PR page
3. Look for a message like: *"This branch is out-of-date with the base branch"*
4. You'll see a button that says **"Update branch"**
5. Click it!
6. GitHub shows a spinning circle — wait 15–60 seconds
7. The page refreshes automatically
8. The green **"Merge pull request"** button should now appear

### ⚙️ What Happens Behind the Scenes

When you click "Update branch," GitHub:
1. Takes all the recent changes from the main codebase
2. Applies them to the PR's branch
3. Checks if any of those changes "conflict" with the PR's changes
4. If no conflicts: great! The button turns green
5. If there ARE conflicts: GitHub will show you a warning (see [Troubleshooting](#13-troubleshooting))

### ✅ Why You Might Need to Do It

You'll almost certainly need to click "Update branch" on PRs #13, #15, #16, and #17 — and definitely on #6. This is completely normal and expected. It just means the PR was created a little while ago and needs to catch up.

---

## 12. Decision Tree: Should I Merge This PR?

Use this table to quickly decide what to do with each PR.

| PR # | Title Summary | Merge? | When? | Why |
|---|---|---|---|---|
| **#9** | Bug Fixes | ✅ YES | **Right now** | Critical — fixes site errors |
| **#13** | Analysis Sections (v3) | ✅ YES | After #9 | Adds important features; best version |
| **#15** | Zillow Data Sync | ✅ YES | After #13 | Automates data; no downsides |
| **#16** | Serverless APIs | ✅ YES | After #15 | Enables live data lookups |
| **#17** | CAR Data Integration | ✅ YES | After #16 | Needs #15 and #16 to work |
| **#10** | Design: CSS Foundation | ✅ OPTIONAL | Anytime after #9 | First step of visual overhaul |
| **#11** | Design: Components | ✅ OPTIONAL | After #10 | Needs #10 first |
| **#12** | Design: Pages | ✅ OPTIONAL | After #11 | Needs #11 first |
| **#14** | Design: Dark Mode | ✅ OPTIONAL | After #12 | Needs #12 first |
| **#6** | Website Monitoring | ✅ LATER | After data PRs | Helpful but not urgent |
| **#2** | Analysis Sections (v1) | ❌ CLOSE | Now | Superseded by #13 |
| **#4** | Analysis Sections (v2) | ❌ CLOSE | Now | Superseded by #13 |
| **#18** | This Guide | ✅ MERGE | Anytime | Documentation |

### 🌲 Quick Decision Flow

```
Is it PR #2 or #4?
  → YES → Close it. It's outdated.
  → NO  → Continue...

Is it PR #9?
  → YES → Merge immediately. It's critical.
  → NO  → Continue...

Is it PR #13, #15, #16, or #17?
  → YES → Merge in that order (may need "Update branch")
  → NO  → Continue...

Is it PR #10, #11, #12, or #14?
  → YES → Merge in order if you want the visual redesign (optional)
  → NO  → Continue...

Is it PR #6?
  → YES → Merge after data PRs when you have time
```

---

## 13. Troubleshooting

### ⚠️ "This branch has conflicts"

**What you see:** A red message saying "This branch has conflicts that must be resolved"

**What it means:** Two different PRs changed the same part of the same file in different ways, and GitHub doesn't know which version to keep.

**What to do:**
1. Don't panic! This happens all the time.
2. This situation is hard to fix without technical help.
3. **Best option:** Contact the Copilot agent that created the PR and ask it to resolve the conflicts for you.
4. **Alternatively:** Post in the repository's Issues tab describing the conflict, and ask for help.
5. If you followed the recommended merge order in this guide, you're much less likely to encounter this.

> 💡 **Prevention:** Always merge PRs in the recommended order. Don't merge PRs that build on each other at the same time.

---

### ⚠️ "Merge failed" or Error Message

**What you see:** A red error message after clicking "Confirm merge"

**What to do:**
1. Take a screenshot of the error message
2. Wait 5 minutes and try again (sometimes it's a temporary GitHub glitch)
3. Try refreshing the page
4. If it keeps failing, open a new Issue in the repository with the error message and screenshot

---

### ⚠️ "Update branch" button doesn't appear

**What you see:** Neither the green "Merge pull request" button nor the "Update branch" button appears

**Possible reasons:**
- The PR is already up to date (check if there's a green merge button instead)
- The repository settings require a review before merging
- You may not have permission to merge (contact the repo owner)

**What to do:**
1. Check if there's already a green "Merge pull request" button — if so, just use that!
2. Look for any yellow or red status messages on the PR page
3. Check the "Checks" section at the bottom to see if automated tests are running

---

### ⚠️ Website looks broken after a merge

**What to do:**
1. Don't panic — this can be reversed!
2. Go to the repository on GitHub
3. Click on **"Commits"** to see the recent changes
4. If you need to revert, open a new Issue or contact a developer
5. Alternatively, create a new PR that reverses the problematic change

> 💚 **Remember:** Git (the system behind GitHub) keeps a complete history of every change ever made. Nothing is ever truly lost.

---

## 14. Success Checklist

After each merge, use this checklist to verify everything went well.

### ✅ After Merging PR #9 (Bug Fixes)

- [ ] PR shows as "Merged" with a purple icon
- [ ] Open your Colorado Deep Dive page in a browser
- [ ] Press F12 (on Windows) or Command+Option+I (on Mac) to open developer tools
- [ ] Click the "Console" tab in developer tools
- [ ] Look for any red error messages — there should be fewer (or none) now
- [ ] The page loads and displays content correctly

### ✅ After Merging PR #13 (Analysis Sections)

- [ ] PR shows as "Merged"
- [ ] Visit the Colorado Deep Dive page
- [ ] Scroll through the entire page
- [ ] You should see at least three new sections you didn't see before
- [ ] Try clicking/interacting with the new sections

### ✅ After Merging PR #15 (Zillow Data Sync)

- [ ] PR shows as "Merged"
- [ ] Go to the **Actions** tab in your repository
- [ ] Look for a new workflow (automated job) related to Zillow
- [ ] The workflow should be listed (even if it hasn't run yet — it runs weekly)

### ✅ After Merging PR #16 (Serverless APIs)

- [ ] PR shows as "Merged"
- [ ] In the repository file browser, find the `serverless/` folder
- [ ] You should see new `.js` files inside
- [ ] The main website pages should still load correctly

### ✅ After Merging PR #17 (CAR Data)

- [ ] PR shows as "Merged"
- [ ] Visit your Colorado market pages
- [ ] Look for new sections showing CAR (Colorado Association of REALTORS®) data
- [ ] Go to the Actions tab and look for new automated workflows

### ✅ After Merging Design PRs (#10–#14, Optional)

- [ ] Each PR shows as "Merged" in order
- [ ] Your website has a noticeably updated look
- [ ] Visit at least 3 different pages to see the consistent new design
- [ ] Try viewing on a phone or tablet — it should look great
- [ ] Try enabling dark mode on your device — the site should switch too

---

## 15. Summary and Timeline

### ⏱️ Total Estimated Time

| Phase | PRs | Time | Result |
|---|---|---|---|
| **Phase 1: Critical** | #9, #13, close #2 & #4 | 15–20 min | Site works correctly with new features |
| **Phase 2: Data** | #15, #16, #17 | 20–30 min | Automated data, new APIs, CAR integration |
| **Phase 3: Design** (optional) | #10–#14 | 30–45 min | Complete visual overhaul |
| **Phase 4: Monitoring** (optional) | #6 | 10 min | Daily health reports |
| **Total (Phase 1+2)** | — | ~45 min | Fully functional with latest data |
| **Total (All Phases)** | — | ~90 min | Complete, polished, monitored website |

### 📋 Master Merge Order

Follow this exact order:

```
1. Close PR #2 (outdated analysis sections)
2. Close PR #4 (outdated analysis sections)
3. Merge PR #9  (bug fixes — CRITICAL)
4. Merge PR #13 (analysis sections — may need Update branch)
5. Merge PR #15 (Zillow data sync — may need Update branch)
6. Merge PR #16 (serverless APIs — may need Update branch)
7. Merge PR #17 (CAR data — will need Update branch)

--- Optional, in order ---
8.  Merge PR #10 (design foundation)
9.  Merge PR #11 (component library — will need Update branch)
10. Merge PR #12 (page redesigns — will need Update branch)
11. Merge PR #14 (dark mode & accessibility — will need Update branch)

--- Later ---
12. Merge PR #6  (website monitoring — will need Update branch)
```

### 🎯 What to Expect After Everything is Merged

Once you've completed Phase 1 and Phase 2:
- Your Colorado Deep Dive page will have three new interactive analysis tools
- Your housing data will update automatically every week with fresh Zillow data
- Two new API endpoints will power live data lookups on your site
- CAR market data will appear on relevant Colorado pages

Once you've completed Phase 3 (optional):
- Your entire website will have a fresh, modern, consistent look
- The site will work beautifully on phones and tablets
- Dark mode will be available for nighttime browsing
- The site will meet accessibility standards

---

## 16. Glossary

A plain-English dictionary of terms used in this guide.

| Term | Plain English Meaning |
|---|---|
| **Pull Request (PR)** | A proposed change to the website waiting for your approval |
| **Merge** | Accepting a proposed change and making it official |
| **Branch** | A separate copy of the codebase where someone made changes |
| **Rebase** | Updating a branch so it includes all the latest changes from the main codebase |
| **Update branch** | GitHub's button for doing a rebase — click it to catch a PR up with recent changes |
| **Conflict** | When two changes edit the same part of the same file in incompatible ways |
| **Commit** | A saved snapshot of changes, like a checkpoint in a video game |
| **Repository (Repo)** | The entire project — all its files, history, and PRs — stored on GitHub |
| **Main branch** | The "official" version of the codebase that powers your live website |
| **GitHub Actions** | Automated scripts that GitHub runs for you (like data downloads or tests) |
| **Workflow** | A set of automated steps that GitHub Actions runs |
| **Serverless function** | A small program that runs in the cloud without needing a dedicated server |
| **API** | A "power outlet" that your website uses to get data from another source |
| **CSS** | The code that controls how your website looks (colors, fonts, layout) |
| **HTML** | The code that describes the content and structure of your web pages |
| **JavaScript** | The code that makes your website interactive (charts, buttons, calculators) |
| **Syntax error** | A typo in code that prevents it from running — like a grammatical error in a sentence |
| **Dark mode** | A color scheme that makes the website background dark (easier on eyes at night) |
| **Responsive design** | A website that automatically adjusts its layout to look good on any screen size |
| **Accessibility (a11y)** | Making a website usable by people with disabilities (vision, motor, hearing) |
| **WCAG 2.1 AA** | A set of accessibility standards; "AA" means a solid middle level of compliance |
| **AMI** | Area Median Income — the middle income in a given area, used to determine housing affordability |
| **CAR** | Colorado Association of REALTORS® — provides reliable Colorado real estate market data |
| **HUD** | U.S. Department of Housing and Urban Development — federal housing agency |
| **Zillow Research** | Zillow's data division that publishes free housing market spreadsheets |

---

## 🔗 Helpful Links

- [GitHub Pull Requests Documentation](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes/merging-a-pull-request)
- [About Merge Conflicts](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/addressing-merge-conflicts/about-merge-conflicts)
- [Keeping your branch up to date](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/keeping-your-pull-request-in-sync-with-the-base-branch)
- [Housing Analytics Repository](https://github.com/pggLLC/Housing-Analytics)
- [Open Pull Requests](https://github.com/pggLLC/Housing-Analytics/pulls)

---

*This guide was created by the PR Review & Merge Strategy Copilot agent session on 2026-02-23. It covers all 12 open pull requests and provides a complete roadmap for integrating the work done across six Copilot agent sessions.*

*Last updated: February 2026*
