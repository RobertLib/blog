import { getDictionary } from "@/dictionaries";
import Link from "next/link";
import RegisterForm from "./register-form";

export default async function RegisterPage() {
  const dict = await getDictionary();

  return (
    <div className="container mx-auto my-4 max-w-[480px] p-4">
      <h1 className="mb-4 text-3xl">{dict.register.title}</h1>

      <div className="panel">
        <RegisterForm dict={dict} />

        <p className="mt-4 text-center">
          {dict.general.or}, <Link href="/login">{dict.login.title}</Link>
        </p>
      </div>
    </div>
  );
}
