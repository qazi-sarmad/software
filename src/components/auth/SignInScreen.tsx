import React, { Suspense, lazy } from 'react';

// The TEMP_AUTH form exists only in development builds. In production this resolves to null and the module is not bundled.
const TempSignInForm = import.meta.env.DEV ? lazy(() => import('./TempSignInForm')) : null;

/** Shown whenever there is no authenticated session. It renders no application data. */
export const SignInScreen: React.FC = () => (
  <div className="min-h-screen bg-canvas text-primary flex items-center justify-center px-6" data-testid="signin-screen">
    <div className="w-full max-w-sm space-y-6 p-8 rounded-2xl bg-surface border border-hairline">
      <div>
        <h1 className="text-apple-28 font-bold tracking-tight">Provio</h1>
        <p className="text-apple-13 text-secondary mt-1">Sign in to your organisation workspace.</p>
      </div>
      {TempSignInForm ? (
        <Suspense fallback={<div className="text-apple-13 text-secondary">Loading…</div>}>
          <TempSignInForm />
        </Suspense>
      ) : (
        <div role="alert" className="text-apple-13 text-secondary" data-testid="signin-unavailable">
          Sign-in is not available in this build. Authentication has not been configured.
        </div>
      )}
    </div>
  </div>
);
