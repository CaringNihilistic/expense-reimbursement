import type { Metadata } from "next";

import { login } from "./actions";

export const metadata: Metadata = { title: "Sign in · Expense Reimbursement" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main style={{ maxWidth: "26rem" }}>
      <h1>Sign in</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Expense reimbursement
      </p>

      <form action={login} className="card stack" style={{ marginTop: "1.5rem" }}>
        {error ? <p className="error">That email and password do not match an account.</p> : null}

        <div>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required autoFocus />
        </div>

        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>

        <button type="submit">Sign in</button>
      </form>

      <div className="card stack" style={{ marginTop: "1rem" }}>
        <h2 style={{ margin: 0, fontSize: "0.95rem" }}>Demo accounts</h2>
        <p className="muted" style={{ margin: 0 }}>
          Password for every account: <code>demo1234</code>
        </p>
        <ul className="muted" style={{ margin: 0, paddingLeft: "1.1rem" }}>
          <li>
            <code>meera@northwind.test</code> — approver
          </li>
          <li>
            <code>sandeep@northwind.test</code> — approver who also submits reports, for
            demonstrating that nobody approves their own
          </li>
          <li>
            <code>ayush@northwind.test</code> — employee
          </li>
        </ul>
      </div>
    </main>
  );
}
