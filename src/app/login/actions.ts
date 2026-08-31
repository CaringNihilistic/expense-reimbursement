"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { authenticate, createSession, destroySession } from "@/lib/auth";

const LoginInput = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

export async function login(formData: FormData): Promise<void> {
  const parsed = LoginInput.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  // One message for a malformed email, an unknown account and a wrong
  // password alike — telling a stranger which of the three it was is how
  // account enumeration starts.
  if (!parsed.success) redirect("/login?error=1");

  const user = await authenticate(parsed.data.email, parsed.data.password);
  if (!user) redirect("/login?error=1");

  await createSession(user.id);
  redirect("/dashboard");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
