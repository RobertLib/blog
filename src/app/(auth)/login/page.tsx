import { getDictionary } from "@/dictionaries";
import Link from "next/link";
import LoginForm from "./login-form";

export default async function LoginPage() {
  const dict = await getDictionary();

  return (
    <div className="container mx-auto my-4 max-w-[480px] p-4">
      <h1 className="mb-4 text-3xl">{dict.login.title}</h1>

      <div className="panel">
        <LoginForm dict={dict} />

        <p className="mt-4 text-center">
          {dict.general.or}, <Link href="/register">{dict.register.title}</Link>
        </p>
      </div>
    </div>
  );
}
