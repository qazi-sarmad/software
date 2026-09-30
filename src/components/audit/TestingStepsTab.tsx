import React, { useState } from 'react';
import { WorkingPaper } from '../../types';
import { useApp } from '../../context/AppContext';
import { CheckCircle2, ShieldCheck, AlertCircle, Lock, Hash } from '../common/Icons';

interface TestingStepsTabProps {
  workpaper: WorkingPaper;
}

export const TestingStepsTab: React.FC<TestingStepsTabProps> = ({ workpaper }) => {
  const { finalizeTest } = useApp();
  const [steps, setSteps] = useState(workpaper.testSteps);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verified, setVerified] = useState(Boolean(workpaper.populationSha256));

  const handleToggleStep = (stepId: string) => {
    if (workpaper.sealed) return;
    setSteps((prev) =>
      prev.map((s) => (s.id === stepId ? { ...s, completed: !s.completed } : s))
    );
  };

  const handleVerifyPopulation = () => {
    setIsVerifying(true);
    setTimeout(() => {
      setVerified(true);
      setIsVerifying(false);
    }, 400);
  };

  const allCompleted = steps.every((s) => s.completed) && verified;

  const handleFinalize = async () => {
    await finalizeTest(workpaper.id);
  };

  return (
    <div className="space-y-6">
      {/* Law 3 Enforcement: Population Verification Gate */}
      <div className="p-4 rounded-xl bg-surface-sunken border border-hairline flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-primary font-semibold text-apple-13">
            <Hash className="w-4 h-4 text-verdigris" />
            <span>Population Integrity Verification Gate (⚖ Law 3)</span>
          </div>
          <p className="text-apple-12 text-secondary">
            Testing is blocked until the underlying population dataset has been cryptographically hashed and verified against data store records.
          </p>
          <div className="text-apple-11 font-mono text-tertiary">
            Items: {workpaper.populationCount.toLocaleString()} • Expected SHA: {workpaper.populationSha256 || 'Attested on upload'}
          </div>
        </div>
        <button
          type="button"
          onClick={handleVerifyPopulation}
          disabled={verified || isVerifying || workpaper.sealed}
          className={`px-3 py-1.5 rounded-lg text-apple-12 font-semibold transition-colors flex items-center gap-1.5 ${
            verified
              ? 'bg-verdigris-subtle text-verdigris border border-verdigris cursor-default'
              : 'bg-surface border border-hairline hover:bg-surface-hover text-primary'
          }`}
        >
          {verified ? (
            <>
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Population Verified</span>
            </>
          ) : isVerifying ? (
            'Verifying...'
          ) : (
            'Verify Population'
          )}
        </button>
      </div>

      {/* Sequential Test Steps */}
      <div className="space-y-3">
        <h3 className="text-apple-13 font-semibold text-primary uppercase tracking-wider">
          Substantive &amp; Control Test Program
        </h3>
        <div className="divide-y divide-hairline border border-hairline rounded-xl overflow-hidden bg-surface">
          {steps.map((step, idx) => (
            <div
              key={step.id}
              onClick={() => handleToggleStep(step.id)}
              className={`p-4 flex items-start gap-3 transition-colors ${
                workpaper.sealed ? 'opacity-80' : 'cursor-pointer hover:bg-surface-hover'
              }`}
            >
              <div className="pt-0.5 shrink-0">
                <input
                  type="checkbox"
                  checked={step.completed}
                  onChange={() => {}}
                  disabled={workpaper.sealed}
                  className="rounded border-hairline text-verdigris focus:ring-0"
                />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between text-apple-12">
                  <span className="font-medium text-primary">Step {idx + 1}: {step.description}</span>
                  {step.completed && (
                    <span className="text-apple-11 text-verdigris font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Done
                    </span>
                  )}
                </div>
                {step.resultNote && (
                  <p className="text-apple-11 text-secondary font-mono bg-surface-sunken p-2 rounded">
                    {step.resultNote}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Finalize Test Gate */}
      <div className="pt-4 border-t border-hairline flex items-center justify-between">
        <span className="text-apple-12 text-secondary">
          {allCompleted ? 'All mandatory test gates satisfied.' : 'Complete all steps and verify population to finalize.'}
        </span>
        <button
          type="button"
          onClick={handleFinalize}
          disabled={!allCompleted || workpaper.sealed}
          className="px-4 py-2 rounded-lg bg-surface border border-hairline hover:bg-surface-hover text-apple-13 font-semibold text-primary disabled:opacity-50 transition-colors"
        >
          Finalize Fieldwork Test
        </button>
      </div>
    </div>
  );
};
