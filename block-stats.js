/*
 * Toolingo block-stats.js — tracker-block counters (Phase 4).
 *
 * Stores:
 *   blockedLifetime  — total blocks since the stat was first initialised
 *   blockedByTab     — { [tabId]: count } for the current session
 *
 * All storage is on-device via chrome.storage.local.
 * Exported as PIE_BLOCK_STATS on globalThis / self (for importScripts + popup).
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'pie_block_stats';

  // In-memory tab counters (reset on service-worker restart — acceptable,
  // since per-tab counts are ephemeral: they show "this page" blocks).
  const tabCounters = {};

  async function _read() {
    try {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      const raw = (data && data[STORAGE_KEY]) || {};
      return {
        blockedLifetime: (typeof raw.blockedLifetime === 'number' && raw.blockedLifetime >= 0)
          ? raw.blockedLifetime : 0
      };
    } catch (_) {
      return { blockedLifetime: 0 };
    }
  }

  async function _write(obj) {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: obj });
    } catch (_) {}
  }

  /** Call when a request is blocked. tabId may be undefined for non-tab contexts. */
  async function recordBlock(tabId) {
    const stored = await _read();
    stored.blockedLifetime = (stored.blockedLifetime || 0) + 1;
    await _write(stored);
    if (tabId != null && tabId >= 0) {
      tabCounters[tabId] = (tabCounters[tabId] || 0) + 1;
    }
  }

  /** Reset per-tab counter on navigation (call from tabs.onUpdated). */
  function resetTab(tabId) {
    if (tabId != null) delete tabCounters[tabId];
  }

  /** Remove per-tab counter on tab close. */
  function removeTab(tabId) {
    if (tabId != null) delete tabCounters[tabId];
  }

  /** Return stats for the message API. */
  async function getStats(tabId) {
    const stored = await _read();
    return {
      lifetimeBlocked: stored.blockedLifetime || 0,
      pageBlocked: (tabId != null && tabCounters[tabId]) ? tabCounters[tabId] : 0
    };
  }

  root.PIE_BLOCK_STATS = {
    recordBlock: recordBlock,
    resetTab: resetTab,
    removeTab: removeTab,
    getStats: getStats
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
