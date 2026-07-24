/*
 * Toolingo ai-explain.js — on-device AI privacy explanation (Phase 6).
 *
 * Privacy guarantees:
 *  - Uses Chrome built-in on-device AI only (window.ai / LanguageModel API).
 *  - NEVER sends cookie values, URLs, or browsing data to any cloud service.
 *  - Only structured, non-identifying findings (counts + labels) are passed to
 *    the on-device model.
 *  - If the API is unavailable, gracefully returns { status: 'unavailable' }.
 */
(function (root) {
  'use strict';

  // Detect the Chrome built-in AI surface (Prompt API, experimental).
  function _getLanguageModel() {
    if (typeof window !== 'undefined') {
      if (window.LanguageModel) return window.LanguageModel;
      if (window.ai && window.ai.languageModel) return window.ai.languageModel;
    }
    return null;
  }

  /**
   * Check availability of the on-device model.
   * Returns one of: 'available' | 'downloadable' | 'downloading' | 'unavailable'
   */
  async function availability() {
    const LM = _getLanguageModel();
    if (!LM) return 'unavailable';
    try {
      const status = await LM.availability();
      // Chrome Prompt API uses: 'readily' | 'after-download' | 'no'
      if (status === 'readily' || status === 'available') return 'available';
      if (status === 'after-download' || status === 'downloadable') return 'downloadable';
      if (status === 'downloading') return 'downloading';
      return 'unavailable';
    } catch (_) {
      return 'unavailable';
    }
  }

  const SYSTEM_PROMPT = [
    'You are a concise privacy assistant for Toolingo, a browser privacy extension.',
    'You receive structured privacy findings for a website.',
    'Respond with plain language that a non-technical user can understand.',
    'Always stay brief: 2–4 sentences of summary, then 2–4 short action bullet points.',
    'Never ask follow-up questions. Never invent facts not in the provided data.',
    'Never reveal raw cookie values, user credentials, or any sensitive data.'
  ].join(' ');

  /**
   * facts object (all fields optional, none contain cookie values):
   *   host: string
   *   https: boolean
   *   sensitivityLabel: string  ('None' | 'Low' | 'Medium' | 'High')
   *   trackingLabel: string
   *   cookieCount: number
   *   thirdPartyCount: number
   *   knownTrackers: number
   *   piiCount: number
   *   blockStats: { pageBlocked: number, lifetimeBlocked: number } | null
   *   fpSignals: { canvas: number, audio: number } | null
   *
   * Returns { summary: string, actions: string[], rawText: string } on success.
   * Returns { error: string } on failure.
   */
  async function explain(facts) {
    const LM = _getLanguageModel();
    if (!LM) return { error: 'unavailable' };

    const avail = await availability();
    if (avail === 'unavailable') return { error: 'unavailable' };

    // Build a privacy-safe, non-identifying prompt from structured findings only.
    const lines = [
      'Privacy findings for: ' + (facts.host || 'this site'),
      'Connection: ' + (facts.https ? 'HTTPS (encrypted)' : 'HTTP (not encrypted)'),
      'Cookies: ' + (facts.cookieCount || 0) + ' total, ' + (facts.thirdPartyCount || 0) + ' third-party',
      'Sensitivity (possible personal data in cookies): ' + (facts.sensitivityLabel || 'None'),
      'Tracking level: ' + (facts.trackingLabel || 'None'),
      'Known tracker domains: ' + (facts.knownTrackers || 0),
      'Cookies with detected PII signals: ' + (facts.piiCount || 0),
    ];
    if (facts.blockStats && facts.blockStats.pageBlocked > 0) {
      lines.push('Tracker requests blocked this page: ' + facts.blockStats.pageBlocked);
    }
    if (facts.fpSignals && (facts.fpSignals.canvas > 0 || facts.fpSignals.audio > 0)) {
      lines.push('Fingerprinting signals detected: canvas=' + (facts.fpSignals.canvas || 0) +
                 ', audio=' + (facts.fpSignals.audio || 0));
    }
    const userPrompt = lines.join('\n') +
      '\n\nPlease explain what this means for the user\'s privacy and suggest 2–4 practical actions.';

    let session;
    try {
      session = await LM.create({
        systemPrompt: SYSTEM_PROMPT
      });
    } catch (e) {
      return { error: String(e && e.message ? e.message : e) };
    }

    try {
      const rawText = await session.prompt(userPrompt);
      session.destroy();

      // Try to extract actions from bullet lines.
      const actionLines = [];
      const summaryLines = [];
      const bulletRe = /^[\u2022\-\*]\s+(.+)$/;
      for (const line of rawText.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        const m = t.match(bulletRe);
        if (m) {
          actionLines.push(m[1].trim());
        } else if (actionLines.length === 0) {
          summaryLines.push(t);
        }
      }
      return {
        summary: summaryLines.join(' ').trim() || rawText.trim(),
        actions: actionLines,
        rawText: rawText
      };
    } catch (e) {
      try { session.destroy(); } catch (_) {}
      return { error: String(e && e.message ? e.message : e) };
    }
  }

  root.PIE_AI_EXPLAIN = {
    availability: availability,
    explain: explain
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
