// ============================================================
// supabase-quiz.js — PLU Blog shared quiz score manager
// Handles: auth session, score saving, best-score upsert
// Usage: include this script in every article page
// ============================================================

const SUPABASE_URL = "https://hcyzifvhizjilysaibyy.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhjeXppZnZoaXpqaWx5c2FpYnl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4MDc4ODEsImV4cCI6MjA5MzM4Mzg4MX0.DgsNgeuZ04KjTCXY9h3XdjE_Fq0uCy92MLOYks0KllY";

// ── Internal helpers ─────────────────────────────────────────

async function supabaseRequest(endpoint, method = "GET", body = null) {
  const session = getSession();
  const headers = {
    "Content-Type": "application/json",
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": `Bearer ${session ? session.access_token : SUPABASE_ANON_KEY}`,
  };
  if (method !== "GET") {
    headers["Prefer"] = "resolution=merge-duplicates"; // enables upsert
  }
  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

function getSession() {
  try {
    const raw = localStorage.getItem("plu_session");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getCurrentUser() {
  const session = getSession();
  return session ? session.user : null;
}

// ── Public API ───────────────────────────────────────────────

/**
 * Save or update a quiz score.
 * Upserts on (user_id, article_id, quiz_type) — keeps the best score.
 *
 * @param {string} articleId  — e.g. "grammar-1", "speaking-3"
 * @param {string} quizType   — "quiz1", "quiz2", or "quiz3"
 * @param {number} score      — integer, e.g. 4 (out of 5)
 * @param {number} total      — total questions, e.g. 5
 * @returns {Promise<{saved: boolean, best: number, message: string}>}
 */
async function saveQuizScore(articleId, quizType, score, total) {
  const user = getCurrentUser();
  if (!user) {
    return { saved: false, best: score, message: "Not logged in — score not saved." };
  }

  try {
    // Check existing best score first
    const existing = await supabaseRequest(
      `lesson_scores?user_id=eq.${user.id}&article_id=eq.${encodeURIComponent(articleId)}&quiz_type=eq.${quizType}&select=score`,
      "GET"
    );

    const previousBest = existing && existing.length > 0 ? existing[0].score : -1;

    if (score <= previousBest) {
      // Not a new best — skip write
      return {
        saved: false,
        best: previousBest,
        message: `Score saved before. Your best is ${previousBest}/${total}.`,
      };
    }

    // Save new best
    await supabaseRequest("lesson_scores", "POST", {
      user_id: user.id,
      article_id: articleId,
      quiz_type: quizType,
      score: score,
      created_at: new Date().toISOString(),
    });

    return {
      saved: true,
      best: score,
      message: `New best score saved: ${score}/${total} 🎉`,
    };
  } catch (err) {
    console.error("[supabase-quiz] saveQuizScore error:", err);
    return { saved: false, best: score, message: "Could not save score. Try again later." };
  }
}

/**
 * Fetch all scores for the current user for a given article.
 *
 * @param {string} articleId — e.g. "grammar-1"
 * @returns {Promise<Array<{quiz_type, score}>>}
 */
async function getArticleScores(articleId) {
  const user = getCurrentUser();
  if (!user) return [];
  try {
    return await supabaseRequest(
      `lesson_scores?user_id=eq.${user.id}&article_id=eq.${encodeURIComponent(articleId)}&select=quiz_type,score`,
      "GET"
    );
  } catch (err) {
    console.error("[supabase-quiz] getArticleScores error:", err);
    return [];
  }
}

/**
 * Show a small save-status message below a quiz.
 * Looks for an element with id="save-status-{quizType}" e.g. "save-status-quiz1"
 *
 * @param {string} quizType
 * @param {string} message
 * @param {boolean} success
 */
function showSaveStatus(quizType, message, success = true) {
  const el = document.getElementById(`save-status-${quizType}`);
  if (!el) return;
  el.textContent = message;
  el.style.color = success ? "#2e7d32" : "#b71c1c";
  el.style.fontWeight = "600";
  el.style.marginTop = "8px";
  el.style.display = "block";
}

/**
 * All-in-one helper: save score + show status message.
 * Call this from your quiz result handler.
 *
 * @param {string} articleId   — e.g. "grammar-1"
 * @param {string} quizType    — "quiz1", "quiz2", or "quiz3"
 * @param {number} score
 * @param {number} total
 */
async function submitQuizScore(articleId, quizType, score, total) {
  const result = await saveQuizScore(articleId, quizType, score, total);
  showSaveStatus(quizType, result.message, result.saved);
  return result;
}

// ── Auto-restore saved scores on page load ───────────────────

/**
 * On page load, fetch saved scores for this article and display them.
 * Expects article pages to have data-article-id on <body> or <main>.
 */
async function restoreSavedScores() {
  const articleId =
    document.body.dataset.articleId ||
    document.querySelector("main")?.dataset.articleId;
  if (!articleId) return;

  const scores = await getArticleScores(articleId);
  if (!scores || scores.length === 0) return;

  scores.forEach(({ quiz_type, score }) => {
    const el = document.getElementById(`save-status-${quiz_type}`);
    if (el) {
      el.textContent = `Your best score: ${score} ✓`;
      el.style.color = "#2e7d32";
      el.style.display = "block";
    }
  });
}

document.addEventListener("DOMContentLoaded", restoreSavedScores);

// ── Exports (works both as module and plain script) ──────────
if (typeof module !== "undefined") {
  module.exports = { saveQuizScore, getArticleScores, submitQuizScore, showSaveStatus };
}
