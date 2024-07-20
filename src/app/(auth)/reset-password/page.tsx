import { getDictionary } from "@/dictionaries";
import ResetPasswordForm from "./reset-password-form";

export default async function ResetPasswordPage({
  searchParams: { token },
}: Readonly<{
  searchParams: { token?: string };
}>) {
  const dict = await getDictionary();

  if (!token) {
    throw new Error("Missing token.");
  }

  return (
    <div className="container mx-auto my-4 max-w-[480px] p-4">
      <h1 className="mb-4 text-3xl">{dict.resetPassword.title}</h1>

      <div className="panel space-y-4">
        <p className="opacity-70">{dict.resetPassword.subtitle}</p>

        <ResetPasswordForm dict={dict} token={token} />
      </div>
    </div>
  );
}
