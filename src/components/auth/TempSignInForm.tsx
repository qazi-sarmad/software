import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { AUTH_MODE } from '../../lib/tempAuth';
import { InlineError } from '../common/InlineError';

/** TEMP_AUTH form. Development builds only; SignInScreen imports it behind import.meta.env.DEV. */
const TempSignInForm: React.FC = () => {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const result = await signIn(email);
    setBusy(false);
    if (!result.ok) setError(result.reason);
  };

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="temp-signin-form">
      <div className="text-apple-11 text-secondary" data-testid="temp-auth-notice">
        {AUTH_MODE}: development stub. Only accounts of the demo tenant are accepted. This is not real authentication.
      </div>
      <label className="block space-y-1">
        <span className="text-apple-12 font-medium text-primary">Email</span>
        <input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full p-2.5 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary outline-none"
        />
      </label>
      <InlineError message={error} testId="signin-error" />
      <button
        type="submit"
        disabled={busy}
        className="w-full px-4 py-2.5 rounded-xl bg-accent text-white font-medium text-apple-13 hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        Sign in
      </button>
    </form>
  );
};

export default TempSignInForm;
