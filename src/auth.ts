import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
  callbacks: {
    // Only the owner may sign in.
    signIn({ profile }) {
      const allowed = (process.env.ALLOWED_EMAIL ?? "").toLowerCase();
      return Boolean(allowed && profile?.email_verified && profile.email?.toLowerCase() === allowed);
    },
  },
});

/** Local development can skip sign-in. Never honoured in production. */
export const authDisabled = () =>
  process.env.NODE_ENV !== "production" && process.env.AUTH_DISABLED === "true";

export async function requireUser() {
  if (authDisabled()) return { email: "dev@localhost" };
  const session = await auth();
  if (!session?.user?.email) throw new Error("Unauthorized");
  return session.user;
}
