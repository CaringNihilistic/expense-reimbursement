import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Expense Reimbursement",
  description: "Submit, approve and pay employee expense reports.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
