import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { verifyChain } from '../../lib/ledger';
import { History, ShieldCheck, ShieldAlert, RotateCcw } from '../common/Icons';

export const LedgerScrubBar: React.FC = () => {
  const { ledger, ledgerAsOf, setLedgerAsOf } = useApp();
  const [chainStatus, setChainStatus] = useState<{ valid: boolean; brokenSeq?: number }>({
    valid: true,
  });

  const maxSeq = ledger.length;
  const currentSeq = ledgerAsOf !== null ? ledgerAsOf : maxSeq;

  useEffect(() => {
    verifyChain(ledger).then((res) => {
      setChainStatus(res);
    });
  }, [ledger]);

  if (maxSeq === 0) return null;

  const currentEntry = ledger.find((e) => e.seq === currentSeq) || ledger[ledger.length - 1];

  return (
    <div className="w-full bg-surface border border-hairline rounded-2xl p-4 shadow-apple">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-accent stroke-[1.5]" />
          <span className="text-apple-13 font-semibold text-primary">
            4D Cryptographic Ledger Scrub
          </span>
          <span className="px-2 py-0.5 rounded text-apple-11 font-medium bg-surface-elevated border border-hairline text-secondary tabular-nums">
            Block {currentSeq} of {maxSeq}
          </span>
          {ledgerAsOf !== null && (
            <span className="px-2 py-0.5 rounded text-apple-11 font-medium bg-amber-subtle text-amber">
              Historical As-Of Mode
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Chain Integrity verification badge */}
          {chainStatus.valid ? (
            <span className="flex items-center gap-1.5 text-apple-11 font-medium text-verdigris bg-verdigris-subtle px-2 py-0.5 rounded border border-verdigris">
              <ShieldCheck className="w-3.5 h-3.5 stroke-[1.5]" />
              <span>Chain Sealed &amp; Intact ✓</span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-apple-11 font-medium text-cinnabar bg-cinnabar-subtle px-2 py-0.5 rounded border border-cinnabar">
              <ShieldAlert className="w-3.5 h-3.5 stroke-[1.5]" />
              <span>Chain Tampered at Seq #{chainStatus.brokenSeq}</span>
            </span>
          )}

          {ledgerAsOf !== null && (
            <button
              onClick={() => setLedgerAsOf(null)}
              className="flex items-center gap-1 text-apple-11 font-medium text-accent hover:underline"
            >
              <RotateCcw className="w-3 h-3 stroke-[1.5]" />
              <span>Return to Live</span>
            </button>
          )}
        </div>
      </div>

      {/* Scrub range slider */}
      <div className="space-y-2">
        <input
          type="range"
          min={1}
          max={maxSeq}
          value={currentSeq}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10);
            setLedgerAsOf(val === maxSeq ? null : val);
          }}
          className="w-full cursor-pointer h-1.5 bg-surface-hover rounded-lg appearance-none"
          style={{ accentColor: 'var(--accent-primary)' }}
        />

        {/* Current block metadata readout */}
        {currentEntry && (
          <div className="flex flex-wrap items-center justify-between text-apple-11 text-secondary pt-1 border-t border-hairline gap-2">
            <div className="flex items-center gap-2">
              <span className="font-medium text-primary">{currentEntry.eventType.toUpperCase()}</span>
              <span>•</span>
              <span>{currentEntry.actorName} ({currentEntry.actorRole})</span>
              <span>•</span>
              <span className="truncate max-w-xs">{currentEntry.payloadSummary}</span>
            </div>
            <div className="font-mono text-tertiary tabular-nums">
              Hash: {currentEntry.hash.substring(0, 16)}...
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
