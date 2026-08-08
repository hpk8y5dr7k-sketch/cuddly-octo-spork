const fs = require("fs");

const ALLOWED_CATEGORIES = [
  "Start Here",
  "Documentation, Knowledge & Learning",
  "Research & Scientific Inquiry",
  "Providers, Runtime & Integration Infrastructure",
  "Remote Control, Notifications & Voice I/O",
  "Alternative Clients",
  "Status Lines",
  "Design & UI/UX",
  "Writing & Prose Quality",
  "Creative Media",
  "Infrastructure & DevOps",
  "Security",
  "Agent Orchestration",
  "Skills",
  "Memory & Context Persistence",
  "Observability & Monitoring",
  "Linting",
];

const REQUIRED_CHECKLIST_ITEMS = [
  "I have visited this repo before with my own eyes",
  "All links are working and publicly accessible",
  "This resource is specific to Claude Code",
  "I have read the CONTRIBUTING.md",
  "I promise I actually did these things",
];
const TRAP_ITEM = "Do not check the following box";

const MIN_STARS = 100;
const MIN_AGE_DAYS = 14;

function parseSections(body) {
  const sections = {};
  const chunks = body.split(/\n(?=### )/);
  for (const chunk of chunks) {
    const m = chunk.match(/^### (.+?)\n([\s\S]*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (value === "_No response_") value = "";
    sections[m[1].trim()] = value;
  }
  return sections;
}

function isChecklistItemChecked(checklistRaw, label) {
  const lines = checklistRaw
    .split("\n")
    .filter((l) => /^- \[[ xX]\]/.test(l.trim()));
  const line = lines.find((l) => l.toLowerCase().includes(label.toLowerCase()));
  return line ? /^- \[[xX]\]/.test(line.trim()) : false;
}

async function ensureLabel(github, owner, repo, name, color, description) {
  try {
    await github.rest.issues.getLabel({ owner, repo, name });
  } catch (e) {
    if (e.status === 404) {
      await github.rest.issues.createLabel({ owner, repo, name, color, description });
    } else {
      throw e;
    }
  }
}

async function getFirstCommitDate(github, owner, repo, defaultBranch) {
  const first = await github.rest.repos.listCommits({
    owner,
    repo,
    sha: defaultBranch,
    per_page: 1,
  });
  const linkHeader = first.headers.link;
  if (!linkHeader || !linkHeader.includes('rel="last"')) {
    return first.data[0]?.commit?.committer?.date ?? null;
  }
  const lastUrlMatch = linkHeader.match(/<([^>]+)>;\s*rel="last"/);
  const lastPageMatch = lastUrlMatch && lastUrlMatch[1].match(/[?&]page=(\d+)/);
  const lastPage = lastPageMatch ? parseInt(lastPageMatch[1], 10) : 1;
  const last = await github.rest.repos.listCommits({
    owner,
    repo,
    sha: defaultBranch,
    per_page: 1,
    page: lastPage,
  });
  return last.data[0]?.commit?.committer?.date ?? null;
}

module.exports = async ({ github, context, core }) => {
  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const issue = context.payload.issue;
  const body = issue.body || "";

  const results = [];
  const pass = (msg) => results.push({ ok: true, msg });
  const fail = (msg) => results.push({ ok: false, msg });
  const warn = (msg) => results.push({ ok: null, msg });

  const sections = parseSections(body);
  const displayName = sections["Display Name"] || "";
  const category = sections["Category"] || "";
  const link = (sections["Link"] || "").trim();
  const authorName = sections["Author Name"] || "";
  const authorLink = (sections["Author Link"] || "").trim();
  const description = sections["Description"] || "";
  const checklistRaw = sections["Checklist"] || "";

  if (displayName.length > 0) {
    pass(`Display name provided: "${displayName}".`);
  } else {
    fail("Display name is missing.");
  }

  if (ALLOWED_CATEGORIES.includes(category)) {
    pass(`Category "${category}" is valid.`);
  } else {
    fail(`Category "${category}" is not one of the allowed categories.`);
  }

  let ghOwner, ghRepo;
  if (/^https:\/\//i.test(link)) {
    pass("Link uses https://.");
    const m = link.match(/^https:\/\/github\.com\/([^/#?]+)\/([^/#?]+)/i);
    if (m) {
      ghOwner = m[1];
      ghRepo = m[2].replace(/\.git$/, "");
    }
  } else {
    fail("Link must start with https://.");
  }

  if (authorName.length > 0) {
    pass(`Author name provided: "${authorName}".`);
  } else {
    fail("Author name is missing.");
  }

  if (/^https:\/\//i.test(authorLink)) {
    pass("Author link uses https://.");
  } else {
    fail("Author link must start with https://.");
  }

  if (description.length >= 10 && description.length <= 500) {
    pass(`Description length is ${description.length} characters.`);
  } else {
    fail(`Description must be 10-500 characters (got ${description.length}).`);
  }

  let checklistOk = true;
  for (const item of REQUIRED_CHECKLIST_ITEMS) {
    if (!isChecklistItemChecked(checklistRaw, item)) {
      checklistOk = false;
      fail(`Required checklist item not checked: "${item}".`);
    }
  }
  if (isChecklistItemChecked(checklistRaw, TRAP_ITEM)) {
    checklistOk = false;
    fail('The "do not check" trap checkbox was checked — please uncheck it.');
  }
  if (checklistOk) {
    pass("All checklist requirements satisfied.");
  }

  if (displayName || link) {
    let readme = "";
    try {
      readme = fs.readFileSync("README.md", "utf8");
    } catch {
      // no README yet; nothing to compare against
    }
    const lowerReadme = readme.toLowerCase();
    const linkNoSlash = link.replace(/\/$/, "").toLowerCase();
    const nameNeedle = displayName.trim().toLowerCase();
    const dup =
      (linkNoSlash.length > 0 && lowerReadme.includes(linkNoSlash)) ||
      (nameNeedle.length > 2 && lowerReadme.includes(`[${nameNeedle}]`));
    if (dup) {
      fail("This link or display name appears to already be present in README.md — please check for duplicates.");
    } else {
      pass("No obvious duplicate found in README.md.");
    }
  }

  if (ghOwner && ghRepo) {
    try {
      const { data: repoData } = await github.rest.repos.get({ owner: ghOwner, repo: ghRepo });
      const stars = repoData.stargazers_count;
      const firstCommitDate = await getFirstCommitDate(github, ghOwner, ghRepo, repoData.default_branch);
      const daysSinceFirstCommit = firstCommitDate
        ? (Date.now() - new Date(firstCommitDate).getTime()) / (1000 * 60 * 60 * 24)
        : null;

      const meetsStars = stars >= MIN_STARS;
      const meetsAge = daysSinceFirstCommit !== null && daysSinceFirstCommit >= MIN_AGE_DAYS;

      if (meetsStars || meetsAge) {
        pass(
          `Maturity requirement met (${stars} stars, ${daysSinceFirstCommit ? daysSinceFirstCommit.toFixed(1) : "?"} days since first commit).`
        );
      } else {
        fail(
          `Maturity requirement not met: ${stars} stars (need ≥${MIN_STARS}) and ${daysSinceFirstCommit ? daysSinceFirstCommit.toFixed(1) : "?"} days since first commit (need ≥${MIN_AGE_DAYS}).`
        );
      }
    } catch (e) {
      warn(`Could not automatically verify repo maturity via the GitHub API (${e.message}). A maintainer should check manually.`);
    }
  } else if (link) {
    warn(
      `Link is not a github.com repository URL — the maturity requirement (${MIN_AGE_DAYS}+ days of history or ${MIN_STARS}+ stars) could not be automatically checked and should be verified manually.`
    );
  }

  const hasFailures = results.some((r) => r.ok === false);

  const lines = results.map((r) => {
    const icon = r.ok === true ? "✅" : r.ok === false ? "❌" : "⚠️";
    return `- ${icon} ${r.msg}`;
  });

  const header = hasFailures
    ? "### ❌ Automated validation found issues"
    : "### ✅ Automated validation passed";

  const footer = hasFailures
    ? "\nPlease edit this issue to address the items above; validation will re-run automatically."
    : "\nYour recommendation has been received. A maintainer will review and approve at their discretion.";

  const commentBody = [header, "", ...lines, footer].join("\n");

  await github.rest.issues.createComment({
    owner,
    repo,
    issue_number: issue.number,
    body: commentBody,
  });

  await ensureLabel(github, owner, repo, "validation-passed", "2ea44f", "Automated validation passed");
  await ensureLabel(github, owner, repo, "validation-failed", "d73a4a", "Automated validation failed");

  for (const name of ["validation-pending", "validation-passed", "validation-failed"]) {
    try {
      await github.rest.issues.removeLabel({ owner, repo, issue_number: issue.number, name });
    } catch (e) {
      if (e.status !== 404) throw e;
    }
  }

  await github.rest.issues.addLabels({
    owner,
    repo,
    issue_number: issue.number,
    labels: [hasFailures ? "validation-failed" : "validation-passed"],
  });

  await core.summary.addHeading("Resource submission validation").addRaw(commentBody, true).write();
};
