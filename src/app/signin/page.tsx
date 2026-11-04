import { signIn } from "@/auth";

export default function SignIn() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/" });
        }}
        className="w-full max-w-sm rounded-2xl border border-[var(--line)] bg-[var(--card)] p-8 text-center"
      >
        <h1 className="mb-2 text-xl font-semibold">To-do</h1>
        <p className="mb-6 text-sm text-[var(--muted)]">Pipedrive, Slack and your own tasks in one list.</p>
        <button className="w-full rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-white">
          Sign in with Google
        </button>
      </form>
    </main>
  );
}
