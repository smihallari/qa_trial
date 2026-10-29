import React, { useState, useMemo, useEffect } from 'react';
import rawData from './data.json';

const STORAGE_KEY = 'qa_audit_reviews_v1';

const FAILURE_REASONS = [
  'Hallucinated Fact',
  'Proposal vs Agreement Confusion',
  'Missing Action Item',
  'Wrong Number/Date',
];

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'has', 'had',
  'not', 'are', 'was', 'were', 'will', 'would', 'could', 'should', 'about',
  'into', 'over', 'after', 'before', 'between', 'under', 'again', 'further',
  'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all',
  'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
  'only', 'own', 'same', 'than', 'too', 'very', 'can', 'just', 'now',
  'customer', 'agent', 'called', 'call', 'regarding', 'account'
]);

// Matches currency (£450, $12.50), dates (November 15th, 2026-10-20, 15th), and standalone numbers
const ENTITY_REGEX = /([£$€]\d+(?:,\d{3})*(?:\.\d{1,2})?|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?\b|\b\d{1,2}(?:st|nd|rd|th)\b|\b\d{4}-\d{2}-\d{2}\b|\b\d+(?:\.\d+)?\b)/gi;

function highlightEntities(text) {
  if (!text) return null;
  const parts = text.split(ENTITY_REGEX);
  return parts.map((part, index) => {
    // Odd indices in split() with a single capturing group are always the matched entities
    if (index % 2 === 1) {
      return (
        <mark
          key={index}
          className="bg-amber-200/90 text-slate-950 font-semibold px-1 rounded-sm"
        >
          {part}
        </mark>
      );
    }
    return part;
  });
}

function extractKeywords(text) {
  if (!text) return [];
  const normalized = text.toLowerCase().replace(/[^a-z0-9£$€\s]/g, ' ');
  const tokens = normalized.split(/\s+/).filter(Boolean);

  return Array.from(
    new Set(
      tokens.filter((token) => {
        if (/^[£$€]?\d+/.test(token)) return true;
        return token.length > 3 && !STOPWORDS.has(token);
      })
    )
  );
}

function splitIntoSentences(text) {
  if (!text) return [];
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const STATUS_BADGE = {
  Pending: 'bg-slate-100 text-slate-700 border-slate-300',
  Approved: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  Rejected: 'bg-rose-100 text-rose-800 border-rose-300',
};

export default function App() {
  const calls = useMemo(() => (Array.isArray(rawData) ? rawData : rawData.calls || []), []);

  const [reviews, setReviews] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const [selectedCallId, setSelectedCallId] = useState(() => calls[0]?.id || null);
  const [statusFilter, setStatusFilter] = useState('All');
  const [activeClaim, setActiveClaim] = useState(null);
  const [transcriptSearch, setTranscriptSearch] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(reviews));
    } catch (err) {
      console.error('Failed to persist QA reviews to localStorage:', err);
    }
  }, [reviews]);

  // Reset active claim and search when switching calls
  useEffect(() => {
    setActiveClaim(null);
    setTranscriptSearch('');
  }, [selectedCallId]);

  const getCallReview = (callId) =>
    reviews[callId] || {
      status: 'Pending',
      reasons: [],
      notes: '',
      updatedAt: null,
    };

  const filteredCalls = useMemo(() => {
    return calls.filter((call) => {
      if (statusFilter === 'All') return true;
      const status = reviews[call.id]?.status || 'Pending';
      return status === statusFilter;
    });
  }, [calls, reviews, statusFilter]);

  const selectedCall = useMemo(
    () => calls.find((c) => c.id === selectedCallId) || null,
    [calls, selectedCallId]
  );

  const currentReview = selectedCall ? getCallReview(selectedCall.id) : null;

  const overviewSentences = useMemo(
    () => splitIntoSentences(selectedCall?.summary?.overview),
    [selectedCall]
  );

  const activeKeywords = useMemo(
    () => extractKeywords(activeClaim),
    [activeClaim]
  );

  const updateReview = (patch) => {
    if (!selectedCall) return;
    setReviews((prev) => {
      const existing = prev[selectedCall.id] || {
        status: 'Pending',
        reasons: [],
        notes: '',
      };
      const updated = {
        ...existing,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      // Clear failure reasons if switched to Approved
      if (patch.status === 'Approved') {
        updated.reasons = [];
      }
      return { ...prev, [selectedCall.id]: updated };
    });
  };

  const toggleFailureReason = (reason) => {
    if (!currentReview) return;
    const exists = currentReview.reasons.includes(reason);
    const nextReasons = exists
      ? currentReview.reasons.filter((r) => r !== reason)
      : [...currentReview.reasons, reason];

    updateReview({
      status: 'Rejected',
      reasons: nextReasons,
    });
  };

  const exportResults = () => {
    const payload = calls.map((call) => ({
      id: call.id,
      agent: call.agent,
      customer: call.customer,
      date: call.date,
      ...getCallReview(call.id),
    }));

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qa-audit-results-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const stats = useMemo(() => {
    let approved = 0;
    let rejected = 0;
    calls.forEach((c) => {
      const st = reviews[c.id]?.status;
      if (st === 'Approved') approved++;
      if (st === 'Rejected') rejected++;
    });
    return {
      total: calls.length,
      approved,
      rejected,
      pending: calls.length - approved - rejected,
    };
  }, [calls, reviews]);

  return (
    <div className="h-screen flex flex-col bg-slate-100 text-slate-900 font-sans overflow-hidden">
      {/* Top Header */}
      <header className="h-14 bg-slate-900 text-white px-6 flex items-center justify-between shrink-0 border-b border-slate-800">
        <div className="flex items-center gap-4">
          <h1 className="font-bold text-base tracking-tight">
            Call Summary QA Auditor
          </h1>
          <div className="flex items-center gap-2 text-xs text-slate-300 bg-slate-800 px-3 py-1 rounded-full">
            <span>Total: {stats.total}</span>
            <span className="text-slate-600">|</span>
            <span className="text-emerald-400">Approved: {stats.approved}</span>
            <span className="text-slate-600">|</span>
            <span className="text-rose-400">Rejected: {stats.rejected}</span>
            <span className="text-slate-600">|</span>
            <span className="text-amber-300">Pending: {stats.pending}</span>
          </div>
        </div>

        <button
          onClick={exportResults}
          className="bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-semibold px-3.5 py-2 rounded transition cursor-pointer"
        >
          Export QA Results (JSON)
        </button>
      </header>

      {/* Main 3-Pane Workspace */}
      <div className="flex-1 grid grid-cols-12 overflow-hidden">
        {/* 1. LEFT SIDEBAR: Call Queue */}
        <aside className="col-span-3 bg-white border-r border-slate-200 flex flex-col overflow-hidden">
          <div className="p-3 border-b border-slate-200 bg-slate-50">
            <div className="grid grid-cols-4 gap-1 bg-slate-200/70 p-1 rounded text-xs font-medium">
              {['All', 'Pending', 'Approved', 'Rejected'].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setStatusFilter(tab)}
                  className={`py-1 rounded transition cursor-pointer ${
                    statusFilter === tab
                      ? 'bg-white text-slate-900 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {filteredCalls.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                No calls matching "{statusFilter}"
              </div>
            ) : (
              filteredCalls.map((call) => {
                const rev = getCallReview(call.id);
                const isSelected = call.id === selectedCallId;
                return (
                  <button
                    key={call.id}
                    onClick={() => setSelectedCallId(call.id)}
                    className={`w-full text-left p-3.5 transition flex flex-col gap-1.5 cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-50/80 border-l-4 border-l-indigo-600'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold text-slate-800">
                        {call.id}
                      </span>
                      <span
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                          STATUS_BADGE[rev.status]
                        }`}
                      >
                        {rev.status}
                      </span>
                    </div>

                    <div className="text-xs text-slate-700 font-medium truncate">
                      Cust: <span className="text-slate-900">{call.customer}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span className="truncate">Agent: {call.agent}</span>
                      <span className="font-mono">{call.duration}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* 2. CENTER PANE: AI Summary Under Review */}
        <section className="col-span-4 bg-slate-50 border-r border-slate-200 flex flex-col overflow-hidden">
          <div className="p-3.5 border-b border-slate-200 bg-white flex items-center justify-between">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                AI Generated Summary
              </h2>
              <p className="text-[11px] text-slate-400">
                Click any claim or action item to verify against transcript
              </p>
            </div>
            {activeClaim && (
              <button
                onClick={() => setActiveClaim(null)}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium cursor-pointer"
              >
                Clear Selection
              </button>
            )}
          </div>

          {selectedCall ? (
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {/* Call Metadata Banner */}
              <div className="bg-white p-3 rounded border border-slate-200 text-xs grid grid-cols-2 gap-2">
                <div>
                  <span className="text-slate-400 block">Customer</span>
                  <span className="font-semibold text-slate-800">
                    {selectedCall.customer}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Agent</span>
                  <span className="font-semibold text-slate-800">
                    {selectedCall.agent}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Date</span>
                  <span className="font-mono text-slate-700">
                    {highlightEntities(selectedCall.date)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Sentiment</span>
                  <span className="font-semibold text-slate-800">
                    {selectedCall.summary?.customer_sentiment || 'N/A'}
                  </span>
                </div>
              </div>

              {/* Overview Sentences */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                  Overview Claims ({overviewSentences.length})
                </h3>
                <div className="space-y-2">
                  {overviewSentences.map((sentence, idx) => {
                    const isSelected = activeClaim === sentence;
                    return (
                      <div
                        key={idx}
                        onClick={() =>
                          setActiveClaim(isSelected ? null : sentence)
                        }
                        className={`p-3 rounded border text-sm leading-relaxed cursor-pointer transition ${
                          isSelected
                            ? 'bg-indigo-50 border-indigo-500 ring-2 ring-indigo-500/20'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        {highlightEntities(sentence)}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Action Items */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                  Action Items ({selectedCall.summary?.action_items?.length || 0})
                </h3>
                <div className="space-y-2">
                  {(selectedCall.summary?.action_items || []).map((item, idx) => {
                    const isSelected = activeClaim === item;
                    return (
                      <div
                        key={idx}
                        onClick={() => setActiveClaim(isSelected ? null : item)}
                        className={`p-3 rounded border text-sm flex items-start gap-2.5 cursor-pointer transition ${
                          isSelected
                            ? 'bg-indigo-50 border-indigo-500 ring-2 ring-indigo-500/20'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <span className="text-xs font-mono font-bold text-slate-400 mt-0.5">
                          #{idx + 1}
                        </span>
                        <span className="flex-1 leading-snug">
                          {highlightEntities(item)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-6 text-sm text-slate-400">Select a call</div>
          )}
        </section>

        {/* 3. RIGHT PANE: Ground Truth Transcript */}
        <section className="col-span-5 bg-white flex flex-col overflow-hidden">
          <div className="p-3 border-b border-slate-200 flex items-center justify-between gap-3 bg-white">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 shrink-0">
              Ground Truth Transcript
            </h2>
            <input
              type="text"
              value={transcriptSearch}
              onChange={(e) => setTranscriptSearch(e.target.value)}
              placeholder="Search transcript text..."
              className="w-full max-w-xs text-xs px-3 py-1.5 rounded border border-slate-300 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {activeKeywords.length > 0 && (
            <div className="px-4 py-2 bg-indigo-50 border-b border-indigo-100 flex items-center flex-wrap gap-1.5 text-xs">
              <span className="text-indigo-800 font-medium">
                Matching keywords:
              </span>
              {activeKeywords.map((kw) => (
                <span
                  key={kw}
                  className="bg-indigo-600 text-white px-1.5 py-0.5 rounded font-mono text-[11px]"
                >
                  {kw}
                </span>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {(selectedCall?.transcript || []).map((turn, idx) => {
              const turnKeywords = extractKeywords(turn.text);
              const sharedKeywords = activeKeywords.filter((kw) =>
                turnKeywords.some((tk) => tk.includes(kw) || kw.includes(tk))
              );

              const matchesClaim = sharedKeywords.length > 0;
              const matchesSearch =
                transcriptSearch.trim().length > 0 &&
                turn.text
                  .toLowerCase()
                  .includes(transcriptSearch.trim().toLowerCase());

              const isAgent = turn.speaker.toLowerCase() === 'agent';

              return (
                <div
                  key={idx}
                  className={`p-3 rounded-lg border text-sm transition ${
                    matchesClaim
                      ? 'bg-indigo-50/70 border-indigo-400 ring-2 ring-indigo-500/20'
                      : matchesSearch
                      ? 'bg-amber-50/70 border-amber-400'
                      : 'bg-slate-50/60 border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded ${
                          isAgent
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-purple-100 text-purple-800'
                        }`}
                      >
                        {turn.speaker}
                      </span>
                      <span className="font-mono text-xs text-slate-400">
                        {turn.time}
                      </span>
                    </div>

                    {matchesClaim && (
                      <div className="flex items-center gap-1">
                        {sharedKeywords.map((kw) => (
                          <span
                            key={kw}
                            className="text-[10px] font-mono bg-indigo-100 text-indigo-800 px-1.5 py-0.5 rounded font-semibold"
                          >
                            {kw}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <p className="text-slate-800 leading-relaxed">
                    {highlightEntities(turn.text)}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* 4. BOTTOM STICKY QA VERDICT BAR */}
      {selectedCall && currentReview && (
        <footer className="bg-white border-t border-slate-300 px-6 py-3 shadow-lg z-10 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* Approve / Reject Buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => updateReview({ status: 'Approved' })}
                className={`px-4 py-2 rounded text-xs font-bold uppercase tracking-wider transition cursor-pointer border ${
                  currentReview.status === 'Approved'
                    ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-emerald-50 hover:border-emerald-300'
                }`}
              >
                ✓ Approve 
              </button>

              <button
                onClick={() => updateReview({ status: 'Rejected' })}
                className={`px-4 py-2 rounded text-xs font-bold uppercase tracking-wider transition cursor-pointer border ${
                  currentReview.status === 'Rejected'
                    ? 'bg-rose-600 text-white border-rose-700 shadow-xs'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-rose-50 hover:border-rose-300'
                }`}
              >
                ✕ Reject
              </button>
            </div>

            {/* Failure Reason Checkboxes */}
            <div className="flex items-center flex-wrap gap-3">
              <span className="text-xs font-semibold text-slate-500">
                Failure Reasons:
              </span>
              {FAILURE_REASONS.map((reason) => {
                const checked = currentReview.reasons.includes(reason);
                return (
                  <label
                    key={reason}
                    className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border cursor-pointer select-none transition ${
                      checked
                        ? 'bg-rose-50 border-rose-400 text-rose-900 font-semibold'
                        : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleFailureReason(reason)}
                      className="accent-rose-600 rounded cursor-pointer"
                    />
                    {reason}
                  </label>
                );
              })}
            </div>

            {/* Free-text Notes Input */}
            <div className="flex-1 min-w-[240px]">
              <input
                type="text"
                value={currentReview.notes}
                onChange={(e) => updateReview({ notes: e.target.value })}
                placeholder="Reviewer notes (e.g., Agent proposed £225, customer countered £150 on Nov 1st)..."
                className="w-full text-xs px-3 py-2 rounded border border-slate-300 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}