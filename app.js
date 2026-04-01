

const STORAGE_KEY   = 'repoready_last_assessment';
const HISTORY_KEY   = 'repoready_history';
const MAX_HISTORY   = 10;

let currentAssessment = null;

/* ── Neural Network Canvas ─────────────────────────────────── */
(function initCanvas() {
  const canvas = document.getElementById('canvas-bg');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const NODES = 65;
  const nodes = Array.from({ length: NODES }, () => ({
    x: Math.random() * window.innerWidth,
    y: Math.random() * window.innerHeight,
    vx: (Math.random() - 0.5) * 0.38,
    vy: (Math.random() - 0.5) * 0.38,
    r: Math.random() * 2.2 + 0.8
  }));

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < NODES; i++) {
      for (let j = i + 1; j < NODES; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const d  = Math.sqrt(dx * dx + dy * dy);
        if (d < 155) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(59,130,246,${(1 - d / 155) * 0.22})`;
          ctx.lineWidth = 0.7;
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.stroke();
        }
      }
    }
    nodes.forEach(n => {
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(96,165,250,0.55)';
      ctx.fill();
      n.x += n.vx;
      n.y += n.vy;
      if (n.x < 0 || n.x > canvas.width)  n.vx *= -1;
      if (n.y < 0 || n.y > canvas.height) n.vy *= -1;
    });
    requestAnimationFrame(draw);
  }
  draw();
})();

/* ── Theme Toggle ───────────────────────────────────────────── */
document.getElementById('togglePill')?.addEventListener('click', function () {
  this.classList.toggle('dark');
});

/* ── localStorage Helpers ───────────────────────────────────── */
function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
  catch { return []; }
}

function saveToHistory(assessment) {
  const history = getHistory();
  // Remove duplicate if same repo exists
  const filtered = history.filter(h => h.repository !== assessment.repository);
  // Prepend latest
  filtered.unshift({
    repository: assessment.repository,
    overallScore: assessment.overallScore,
    timestamp: assessment.timestamp
  });
  // Keep only MAX_HISTORY entries
  const trimmed = filtered.slice(0, MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(assessment));
}

/* ── Score Color Helpers ────────────────────────────────────── */
function scoreColorClass(score) {
  if (score >= 85) return 'color-green';
  if (score >= 70) return 'color-blue';
  if (score >= 50) return 'color-yellow';
  if (score >= 30) return 'color-orange';
  return 'color-red';
}

function recentScoreClass(score) {
  if (score >= 85) return 's-great';
  if (score >= 70) return 's-good';
  if (score >= 50) return 's-mid';
  return 's-low';
}

function ratingClass(rating) {
  if (rating.includes('EXCELLENT')) return 'excellent';
  if (rating.includes('GOOD'))      return 'good';
  if (rating.includes('FAIR'))      return 'fair';
  if (rating.includes('POOR'))      return 'poor';
  return 'critical';
}

/* ── GitHub API Assessment ──────────────────────────────────── */
async function assessRepository(owner, repo) {
  const baseUrl = `https://api.github.com/repos/${owner}/${repo}`;

  try {
    // Repo info
    const repoInfoResponse = await fetch(baseUrl);
    if (!repoInfoResponse.ok) {
      if (repoInfoResponse.status === 403) throw new Error('GitHub API rate limit reached. Please try again later.');
      if (repoInfoResponse.status === 404) throw new Error(`Repository "${owner}/${repo}" not found. Make sure it exists and is public.`);
      throw new Error(`GitHub API error: ${repoInfoResponse.status}`);
    }

    // README
    let readmeContent = '';
    try {
      const r = await fetch(`${baseUrl}/readme`);
      if (r.ok) { const d = await r.json(); readmeContent = atob(d.content); }
    } catch (e) {}

    // LICENSE
    let licenseContent = '', hasLicense = false;
    try {
      let r = await fetch(`${baseUrl}/contents/LICENSE`);
      if (!r.ok) r = await fetch(`${baseUrl}/contents/LICENSE.md`);
      if (r.ok) { const d = await r.json(); licenseContent = atob(d.content); hasLicense = true; }
    } catch (e) {}

    // package.json
    let packageJsonData = null;
    try {
      const r = await fetch(`${baseUrl}/contents/package.json`);
      if (r.ok) { const d = await r.json(); packageJsonData = JSON.parse(atob(d.content)); }
    } catch (e) {}

    // Tests
    let hasTests = false, testFiles = [];
    try {
      const r = await fetch(`${baseUrl}/contents`);
      if (r.ok) {
        const contents = await r.json();
        if (Array.isArray(contents)) {
          contents.forEach(item => {
            if (item.type === 'dir'  && /test|tests?/i.test(item.name))  { hasTests = true; testFiles.push(item.name); }
            if (item.type === 'file' && /test|spec/i.test(item.name))    { hasTests = true; testFiles.push(item.name); }
          });
        }
      }
    } catch (e) {}

    // CI
    let hasCI = false, ciType = null;
    const ciPaths = [
      '.github/workflows/ci.yml', '.github/workflows/test.yml', '.github/workflows/main.yml',
      '.gitlab-ci.yml', '.travis.yml', '.circleci/config.yml'
    ];
    for (const ciPath of ciPaths) {
      try {
        const r = await fetch(`${baseUrl}/contents/${ciPath}`);
        if (r.ok) {
          hasCI = true;
          if (ciPath.includes('github')) ciType = 'GitHub Actions';
          else if (ciPath.includes('gitlab')) ciType = 'GitLab CI';
          else if (ciPath.includes('travis')) ciType = 'Travis CI';
          else ciType = 'CircleCI';
          break;
        }
      } catch (e) {}
    }

    // CITATION
    let hasCitation = false;
    try {
      const r = await fetch(`${baseUrl}/contents/CITATION.cff`);
      if (r.ok) hasCitation = true;
    } catch (e) {}

    // Tags
    let tags = [];
    try {
      const r = await fetch(`${baseUrl}/tags`);
      if (r.ok) tags = await r.json();
    } catch (e) {}

    // Code quality
    let hasCodeQuality = false, qualityDetails = [];
    const qualityPaths = ['pyproject.toml', '.prettierrc', '.eslintrc', '.stylelintrc', 'setup.py'];
    for (const qPath of qualityPaths) {
      try {
        const r = await fetch(`${baseUrl}/contents/${qPath}`);
        if (r.ok) { hasCodeQuality = true; qualityDetails.push(qPath); }
      } catch (e) {}
    }

    // Evaluate
    const readmeEval      = evaluateReadme(readmeContent);
    const licenseEval     = evaluateLicense(hasLicense, licenseContent);
    const testsEval       = evaluateTests(hasTests, packageJsonData, testFiles);
    const ciEval          = evaluateCI(hasCI, ciType);
    const versioningEval  = evaluateVersioning(tags);
    const citationEval    = evaluateCitation(hasCitation, readmeContent);
    const codeQualityEval = evaluateCodeQuality(hasCodeQuality, qualityDetails);

    const totalScore = readmeEval.score + licenseEval.score + testsEval.score +
                       ciEval.score + versioningEval.score + citationEval.score + codeQualityEval.score;

    // Fixes
    const fixes = [];

    if (licenseEval.score < 20)
      fixes.push({ task: "❌ Add a LICENSE file to the root directory (e.g., Apache 2.0 or MIT).", impact: "CRITICAL: LEGAL REQUIREMENT FOR DISTRIBUTION AND REUSE.", priority: "HIGH", priorityLevel: 3 });

    if (testsEval.score === 0)
      fixes.push({ task: "❌ Implement a basic test suite and 'tests/' directory to verify model logic.", impact: "HIGH: ENSURES SCIENTIFIC INTEGRITY AND PREVENTS REGRESSIONS.", priority: "HIGH", priorityLevel: 3 });
    else if (testsEval.score < 20)
      fixes.push({ task: "⚠️ Expand test coverage to include more comprehensive test cases.", impact: "HIGH: CURRENT TESTS ARE LIMITED", priority: "HIGH", priorityLevel: 3 });

    if (ciEval.score === 0)
      fixes.push({ task: "⚠️ Configure GitHub Actions (.github/workflows) to automate tests on every pull request.", impact: "MEDIUM: INCREASES STABILITY AND TRUST IN THE REPOSITORY.", priority: "MEDIUM", priorityLevel: 2 });

    if (citationEval.score === 0)
      fixes.push({ task: "⚠️ Create a CITATION.cff file to allow researchers to easily cite this repository.", impact: "MEDIUM: IMPROVES ACADEMIC IMPACT TRACKING.", priority: "MEDIUM", priorityLevel: 2 });
    else if (citationEval.score < 10)
      fixes.push({ task: "📝 Improve citation information by adding a CITATION.cff file.", impact: "MEDIUM: CURRENT CITATION INFO IS INCOMPLETE", priority: "MEDIUM", priorityLevel: 2 });

    if (readmeEval.score === 0)
      fixes.push({ task: "📖 Create a README file with installation, usage, and project overview.", impact: "MEDIUM: ESSENTIAL FOR PROJECT DOCUMENTATION", priority: "MEDIUM", priorityLevel: 2 });
    else if (readmeEval.score < 20)
      fixes.push({ task: "📖 Enhance README documentation with installation and usage examples.", impact: "MEDIUM: IMPROVES ONSET AND USABILITY", priority: "MEDIUM", priorityLevel: 2 });

    if (versioningEval.score === 0)
      fixes.push({ task: "🏷️ Create version tags for releases (e.g., v1.0.0, v1.0.1).", impact: "MEDIUM: IMPORTANT FOR REPRODUCIBILITY", priority: "MEDIUM", priorityLevel: 2 });

    if (!hasCodeQuality)
      fixes.push({ task: "🎨 Add a code formatting configuration file (.prettierrc, .eslintrc, or pyproject.toml).", impact: "LOW: IMPROVES CODE READABILITY AND MAINTAINABILITY.", priority: "LOW", priorityLevel: 1 });

    if (readmeEval.score >= 20 && readmeEval.score < 25)
      fixes.push({ task: "📝 Add more details to README (structure overview, documentation links).", impact: "LOW: MISSING SOME DOCUMENTATION SECTIONS", priority: "LOW", priorityLevel: 1 });

    if (versioningEval.score > 0 && versioningEval.score < 8)
      fixes.push({ task: "🏷️ Adopt semantic versioning format (v1.0.0, v1.0.1, etc.).", impact: "LOW: CURRENT TAGS NOT FOLLOWING SEMVER", priority: "LOW", priorityLevel: 1 });

    fixes.sort((a, b) => b.priorityLevel - a.priorityLevel);

    const checks = [
      { id: "readme-quality", label: "README Quality",          passed: readmeEval.score >= 20,      score: readmeEval.score,      maxScore: 25, rationale: readmeEval.reason,      impact: "medium" },
      { id: "license",        label: "License",                 passed: licenseEval.score >= 15,     score: licenseEval.score,     maxScore: 20, rationale: licenseEval.reason,     impact: "high" },
      { id: "testing",        label: "Tests",                   passed: testsEval.score >= 15,       score: testsEval.score,       maxScore: 20, rationale: testsEval.reason,       impact: "high" },
      { id: "ci-config",      label: "CI Config",               passed: ciEval.score >= 10,          score: ciEval.score,          maxScore: 15, rationale: ciEval.reason,          impact: "medium" },
      { id: "versioning",     label: "Versioning",              passed: versioningEval.score >= 8,   score: versioningEval.score,  maxScore: 10, rationale: versioningEval.reason,  impact: "medium" },
      { id: "citation",       label: "Citation",                passed: citationEval.score >= 8,     score: citationEval.score,    maxScore: 10, rationale: citationEval.reason,    impact: "medium" },
      { id: "code-quality",   label: "Code Quality & Formatting",passed: codeQualityEval.score >= 10,score: codeQualityEval.score, maxScore: 15, rationale: codeQualityEval.reason, impact: "low" }
    ];

    const summary = generateSummary(readmeEval, licenseEval, testsEval, ciEval, versioningEval, citationEval, totalScore);

    return {
      repository: `${owner}/${repo}`,
      url: `https://github.com/${owner}/${repo}`,
      overallScore: totalScore,
      rating: getRating(totalScore),
      summary,
      checks,
      fixes,
      timestamp: new Date().toLocaleString()
    };

  } catch (error) {
    console.error('Assessment error:', error);
    throw error;
  }
}

/* ── Evaluators ─────────────────────────────────────────────── */
function evaluateReadme(content) {
  if (!content) return { score: 0, reason: 'No README file detected in the root directory.' };
  let score = 0;
  if (/install|setup|getting started|installation|pip install|npm install/i.test(content)) score += 10;
  if (/run|usage|example|quick start|how to use|command/i.test(content))                  score += 10;
  if (/structure|organization|overview/i.test(content))                                    score += 5;
  if (/documentation|docs|reference/i.test(content))                                       score += 5;
  let reason = score >= 25 ? 'The README is professionally structured with comprehensive documentation.'
             : score >= 15 ? 'README contains essential information but could benefit from more detailed setup guides.'
             : score > 0   ? 'README exists but lacks critical setup or usage instructions.'
             :                'No README file detected in the root directory.';
  return { score: Math.min(score, 25), reason };
}

function evaluateLicense(hasLicense, content) {
  if (!hasLicense) return { score: 0, reason: 'No LICENSE file detected. A license is mandatory for legal reuse in research and industry.' };
  const licenseName = content?.split('\n')[0] || 'Unknown';
  const isOpenSource = /MIT|Apache|GPL|BSD|MPL|LGPL/i.test(licenseName);
  return isOpenSource
    ? { score: 20, reason: `${licenseName} license detected. This open-source license enables legal reuse and distribution.` }
    : { score: 10, reason: `License present (${licenseName}) but not a standard open-source license. Consider MIT, Apache-2.0, or GPL.` };
}

function evaluateTests(hasTests, packageJson, testFiles) {
  if (!hasTests && !packageJson?.scripts?.test) return { score: 0, reason: 'No test directories or test configuration files were detected. Research software requires verification suites.' };
  let score = 0, details = [];
  if (hasTests)                   { score += 15; details.push(`Test files/dirs found: ${testFiles.join(', ')}`); }
  if (packageJson?.scripts?.test) { score += 5;  details.push('Test script defined in package.json'); }
  return { score: Math.min(score, 20), reason: `Test infrastructure detected: ${details.join('. ')}.${score < 20 ? ' Consider expanding test coverage.' : ''}` };
}

function evaluateCI(hasCI, ciType) {
  return hasCI
    ? { score: 15, reason: `${ciType} workflow detected. This enables automated testing and continuous integration.` }
    : { score: 0,  reason: 'No CI/CD workflows detected. Automated testing is essential for maintaining repository reliability.' };
}

function evaluateVersioning(tags) {
  if (!tags || tags.length === 0) return { score: 0, reason: 'No release tags detected. Versioning is important for reproducibility and tracking changes.' };
  const semantic = tags.filter(t => /^v?\d+\.\d+\.\d+/.test(t.name));
  if (semantic.length > 0) return { score: 10, reason: `Excellent versioning with ${semantic.length} release tag(s) following semantic versioning.` };
  if (tags.length >= 3)    return { score: 8,  reason: `${tags.length} release tag(s) detected. Consider adopting semantic versioning (v1.0.0 format).` };
  return { score: 5, reason: `${tags.length} release tag(s) detected. Adding more structured versioning would improve reproducibility.` };
}

function evaluateCitation(hasCitationFile, readmeContent) {
  if (hasCitationFile) return { score: 10, reason: 'CITATION.cff file detected, enabling standardized academic attribution.' };
  if (readmeContent && /citation|how to cite|reference|bibtex|doi/i.test(readmeContent))
    return { score: 7, reason: 'Citation information found in README. Consider adding a CITATION.cff file for better integration with academic tools.' };
  return { score: 0, reason: 'No CITATION.cff file or citation information detected. This makes it difficult for researchers to properly cite your work.' };
}

function evaluateCodeQuality(hasConfig, details) {
  return hasConfig
    ? { score: 15, reason: `Code formatting configurations detected: ${details.join(', ')}. This improves code readability and maintainability.` }
    : { score: 0,  reason: 'No explicit formatting configurations (Black, Prettier, ESLint) found. Relies on manual or external style enforcement.' };
}

function getRating(score) {
  if (score >= 85) return 'EXCELLENT - Research Software Ready';
  if (score >= 70) return 'GOOD - Mostly Ready';
  if (score >= 50) return 'FAIR - Needs Improvement';
  if (score >= 30) return 'POOR - Significant Work Needed';
  return 'CRITICAL - Not Ready for Research Use';
}

function generateSummary(readme, license, tests, ci, versioning, citation, totalScore) {
  const good = [], bad = [];
  if (readme.score >= 20)    good.push('professional README documentation'); else if (readme.score > 0) bad.push('incomplete README'); else bad.push('missing README');
  if (license.score >= 15)   good.push('proper licensing');                  else if (license.score > 0) bad.push('non-standard license'); else bad.push('missing LICENSE file');
  if (tests.score >= 15)     good.push('comprehensive test suites');         else if (tests.score > 0) bad.push('limited test coverage'); else bad.push('no test suite');
  if (ci.score >= 10)        good.push('CI/CD automation');                  else bad.push('no CI/CD configuration');
  if (versioning.score >= 8) good.push('robust versioning practices');       else if (versioning.score > 0) bad.push('inconsistent versioning'); else bad.push('no version tags');
  if (citation.score >= 8)   good.push('proper citation metadata');          else bad.push('missing citation information');

  let s = good.length  ? `The repository exhibits ${good.join(', ')}. ` : '';
  if (bad.length) s += `However, it fails several core research-readiness benchmarks due to ${bad.join(', ')}. These omissions create significant barriers for academic reuse, verification, and legal compliance.`;
  else if (good.length) s += 'These practices create a solid foundation for research software.';
  else s = 'The repository needs significant improvements to meet research software standards.';
  return s;
}

/* ── Report Generators ──────────────────────────────────────── */
function generateHTMLReport(assessment) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>RepoReady Report – ${assessment.repository}</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.6;color:#141414;background:#E4E3E0;padding:40px}
    .container{max-width:800px;margin:0 auto;background:white;padding:40px;border:1px solid #141414}
    h1{text-transform:uppercase;letter-spacing:-.02em;border-bottom:2px solid #141414;padding-bottom:10px}
    .score-box{font-size:48px;font-weight:bold;margin:20px 0}
    .summary{font-style:italic;margin-bottom:30px;color:#444}
    .check-item{border-bottom:1px solid #eee;padding:15px 0}
    .check-header{display:flex;justify-content:space-between;font-weight:bold}
    .status-passed{color:#059669}.status-failed{color:#dc2626}
    .rationale{font-size:14px;color:#666;margin-top:5px}
    .fix-list{background:#f9f9f9;padding:20px;border:1px dashed #141414;margin-top:30px}
    .fix-item{margin-bottom:15px;font-size:14px;padding:10px;border-left:3px solid}
    .fix-item.high{border-left-color:#dc2626}.fix-item.medium{border-left-color:#f59e0b}.fix-item.low{border-left-color:#10b981}
    .priority-high{color:#dc2626;font-weight:bold}.priority-medium{color:#f59e0b;font-weight:bold}.priority-low{color:#10b981;font-weight:bold}
    .footer{margin-top:40px;font-size:12px;opacity:.5;text-align:center}
  </style>
</head>
<body>
  <div class="container">
    <h1>RepoReady Assessment Report</h1>
    <div class="score-box">Score: ${assessment.overallScore}/100</div>
    <p class="summary">${assessment.summary}</p>
    <h2>Detailed Assessment</h2>
    ${assessment.checks.map(c => `
      <div class="check-item">
        <div class="check-header">
          <span>${c.label}</span>
          <span class="${c.passed ? 'status-passed' : 'status-failed'}">${c.passed ? 'PASSED' : 'FAILED'} (${c.score}/${c.maxScore})</span>
        </div>
        <div class="rationale">${c.rationale}</div>
      </div>`).join('')}
    <div class="fix-list">
      <h2>Priority Fixes</h2>
      ${assessment.fixes.map(f => `
        <div class="fix-item ${f.priority.toLowerCase()}">
          <div class="${f.priority === 'HIGH' ? 'priority-high' : f.priority === 'MEDIUM' ? 'priority-medium' : 'priority-low'}">[${f.impact}]</div>
          <div>${f.task}</div>
        </div>`).join('')}
    </div>
    <div class="footer">Generated by RepoReady on ${assessment.timestamp}</div>
  </div>
</body>
</html>`;
}

function generateJSONReport(assessment) {
  return JSON.stringify({
    score: assessment.overallScore,
    summary: assessment.summary,
    checks: assessment.checks,
    fixChecklist: assessment.fixes.map(f => ({
      task: f.task, impact: f.impact,
      priority: f.priority === 'HIGH' ? 3 : f.priority === 'MEDIUM' ? 2 : 1
    }))
  }, null, 2);
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ── UI Rendering ───────────────────────────────────────────── */
function renderResults(assessment) {
  currentAssessment = assessment;
  const resultDiv = document.getElementById('result');

  const scoreColor = scoreColorClass(assessment.overallScore);
  const rClass     = ratingClass(assessment.rating);

  resultDiv.innerHTML = `
    <div class="report-actions">
      <button id="downloadHtmlBtn" class="report-btn">📄 Download HTML Report</button>
      <button id="downloadJsonBtn" class="report-btn">💾 Download JSON Report</button>
    </div>

    <div class="score-card">
      <div class="score-header">
        <div class="score-label">OVERALL SCORE</div>
        <div class="score-value ${scoreColor}">${assessment.overallScore}<span class="score-max">/100</span></div>
        <div class="rating ${rClass}">${assessment.rating}</div>
      </div>
      <div class="summary">${assessment.summary}</div>
    </div>

    <div class="assessment-grid">
      ${assessment.checks.map(check => `
        <div class="assessment-card">
          <div class="card-header">
            <div class="card-title">${check.label}</div>
            <div class="card-score ${check.passed ? 'score-good' : 'score-low'}">
              ${check.score}<span class="max">/${check.maxScore}</span>
            </div>
          </div>
          <div class="card-impact ${check.impact}">${check.impact.toUpperCase()} IMPACT</div>
          <div class="card-reason">${check.rationale}</div>
        </div>`).join('')}
    </div>

    <div class="fixes-section">
      <h2 class="section-title">🔧 Priority Fix Checklist</h2>
      <div class="fixes-list">
        ${assessment.fixes.map(fix => `
          <div class="fix-item ${fix.priority.toLowerCase()}">
            <div class="fix-header">
              <div class="fix-title">${fix.task}</div>
              <div class="fix-impact ${fix.priority.toLowerCase()}">${fix.priority}</div>
            </div>
            <div class="fix-description">${fix.impact}</div>
          </div>`).join('')}
      </div>
    </div>

    <div class="info-footer">
      <div class="timestamp">⏱ Report generated: ${assessment.timestamp}</div>
      <div class="repo-info">📦 ${assessment.repository}</div>
    </div>`;

  resultDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });

  setTimeout(() => {
    document.getElementById('downloadHtmlBtn')?.addEventListener('click', () => {
      downloadFile(generateHTMLReport(assessment), `repoready-${assessment.repository.replace('/', '-')}.html`, 'text/html');
      showNotification('✅ HTML report downloaded!', 'success');
    });
    document.getElementById('downloadJsonBtn')?.addEventListener('click', () => {
      downloadFile(generateJSONReport(assessment), `repoready-${assessment.repository.replace('/', '-')}.json`, 'application/json');
      showNotification('✅ JSON report downloaded!', 'success');
    });
  }, 100);
}

/* ── Recent Assessments Panel ───────────────────────────────── */
function renderRecentAssessments() {
  const container = document.getElementById('recentCards');
  if (!container) return;

  const history = getHistory();
  if (history.length === 0) {
    container.innerHTML = '<div class="no-recent">No assessments yet. Analyze a repository to get started.</div>';
    return;
  }

  const clockSVG = `<svg viewBox="0 0 24 24"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><polyline points="12 7 12 12 15 15"/></svg>`;

  container.innerHTML = history.map(item => `
    <div class="recent-row" data-repo="${item.repository}">
      <div class="recent-score ${recentScoreClass(item.overallScore)}">${item.overallScore}</div>
      <div class="recent-info">
        <div class="recent-repo">${item.repository}</div>
        <div class="recent-meta">${clockSVG} ${item.timestamp}</div>
      </div>
      <div class="recent-arrow">›</div>
    </div>`).join('');

  // Click to re-analyze
  container.querySelectorAll('.recent-row').forEach(row => {
    row.addEventListener('click', () => {
      const repoInput = document.getElementById('repoInput');
      if (repoInput) {
        repoInput.value = row.dataset.repo;
        repoInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        repoInput.focus();
      }
    });
  });
}

/* ── Notification ───────────────────────────────────────────── */
function showNotification(message, type) {
  document.querySelector('.notification')?.remove();
  const n = document.createElement('div');
  n.className = `notification ${type}`;
  n.textContent = message;
  n.style.cssText = `
    position:fixed;bottom:24px;right:24px;padding:12px 22px;
    border-radius:12px;background:${type === 'success' ? '#22c55e' : '#f87171'};
    color:white;font-weight:600;font-size:.875rem;z-index:9999;
    box-shadow:0 4px 20px rgba(0,0,0,0.25);
    animation:fadeUp .3s ease both;`;
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 3000);
}

/* ── Loading State ──────────────────────────────────────────── */
function showLoading() {
  const l = document.getElementById('loading');
  const r = document.getElementById('result');
  const b = document.getElementById('assessBtn');
  if (l) l.style.display = 'flex';
  if (r) r.innerHTML = '';
  if (b) b.disabled = true;
}

function hideLoading() {
  const l = document.getElementById('loading');
  const b = document.getElementById('assessBtn');
  if (l) l.style.display = 'none';
  if (b) b.disabled = false;
}

function showError(message) {
  document.getElementById('result').innerHTML = `
    <div class="error-card">
      <h3>❌ Assessment Failed</h3>
      <p>${message}</p>
      <p class="error-hint">Make sure the repository is public and the URL is correct.</p>
      <p class="error-hint">Examples: facebook/react · tensorflow/tensorflow · octocat/Spoon-Knife</p>
    </div>`;
}

/* ── Main Handler ───────────────────────────────────────────── */
async function handleAssessment(input) {
  if (!input) { showError('Please enter a repository URL or owner/repo name.'); return; }

  const clean = input.replace('https://github.com/', '').replace('http://github.com/', '').replace('github.com/', '').replace('.git', '').trim();
  const parts = clean.split('/').filter(Boolean);

  if (parts.length < 2) { showError('Invalid format. Use "owner/repo" or a full GitHub URL.'); return; }

  const [owner, repo] = parts;
  showLoading();

  try {
    const assessment = await assessRepository(owner, repo);
    renderResults(assessment);
    saveToHistory(assessment);
    renderRecentAssessments();
  } catch (error) {
    console.error('Error:', error);
    showError(error.message || 'Failed to assess repository. Please try again.');
  } finally {
    hideLoading();
  }
}

/* ── DOM Ready ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const assessBtn  = document.getElementById('assessBtn');
  const repoInput  = document.getElementById('repoInput');

  if (assessBtn) {
    assessBtn.addEventListener('click', () => handleAssessment(repoInput?.value.trim()));
  }

  if (repoInput) {
    repoInput.addEventListener('keypress', e => {
      if (e.key === 'Enter') handleAssessment(repoInput.value.trim());
    });
  }

  // Restore last result if available
  try {
    const last = localStorage.getItem(STORAGE_KEY);
    if (last) {
      const assessment = JSON.parse(last);
      if (repoInput) repoInput.value = assessment.repository;
      renderResults(assessment);
    }
  } catch (e) {}

  // Render history panel
  renderRecentAssessments();
});
