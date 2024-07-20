import { getDictionary } from "@/dictionaries";
import ForgotPasswordForm from "./forgot-password-form";
import Link from "next/link";

export default async function ForgotPasswordPage({
  searchParams: { resetInstructionsSent },
}: Readonly<{
  searchParams: { resetInstructionsSent?: string };
}>) {
  const dict = await getDictionary();

  return (
    <div className="container mx-auto my-4 max-w-[480px] p-4">
      <h1 className="mb-4 text-3xl">{dict.forgotPassword.title}</h1>

      <div className="panel space-y-4">
        <p className="opacity-70">{dict.forgotPassword.subtitle}</p>

        {resetInstructionsSent === "true" && (
          <div className="alert alert-success">
            {dict.forgotPassword.resetInstructionsSent}
          </div>
        )}

        <ForgotPasswordForm dict={dict} />

        <p className="text-center">
          {dict.general.backTo} <Link href="/login">{dict.login.title}</Link>
        </p>
      </div>
    </div>
  );
}
